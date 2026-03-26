// Custom server — wraps Next.js standalone with Socket.io on a single port
// Hooks into startServer's httpServer after it starts

const path = require("node:path");
const { Server } = require("socket.io");
const { OpenClawGateway } = require("./src/lib/openclaw-gateway.js");
const { parseNpcResponse, isValidTaskAction } = require("./src/lib/task-parser.js");
const { TaskManager } = require("./src/lib/task-manager.js");
const { withTaskReminder } = require("./src/lib/task-prompt.js");

const dir = __dirname;
process.env.NODE_ENV = "production";
process.chdir(dir);

const currentPort = parseInt(process.env.PORT, 10) || 3000;
const hostname = process.env.HOSTNAME || "0.0.0.0";

// Load Next.js config from standalone build
const nextConfig = require(path.join(dir, ".next", "required-server-files.json")).config;
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);

require("next");
const { startServer } = require("next/dist/server/lib/start-server");

async function main() {
  const { jwtVerify } = await import("jose");

  const { db, schema } = require("./src/db/server-db.js");
  const { eq, and } = require("drizzle-orm");
  const { parseJson } = require("./src/db/normalize.js");
  const taskManager = new TaskManager(db, schema);
  const { MeetingBroker } = require("./src/lib/meeting-broker.js");

  // Start Next.js (this creates and listens on the HTTP server)
  const server = await startServer({
    dir,
    isDev: false,
    config: nextConfig,
    hostname,
    port: currentPort,
    allowRetry: false,
  });

  // Get the underlying HTTP server from the return value
  // startServer returns { port, hostname } but the HTTP server is
  // already listening. We need to access it differently.
  //
  // Alternative: use the http module to find the listening server
  const http = require("node:http");
  const net = require("node:net");

  // Find the server listening on our port
  let httpServer = null;

  // Monkey-patch approach: intercept the server that startServer created
  // Actually, startServer in newer Next.js returns the server directly
  // Let's try accessing it from the global connections

  // Simpler: create Socket.io on a separate internal port, proxy via Caddy path
  const SOCKET_PORT = currentPort + 1; // 3001
  const socketHttpServer = http.createServer();
  const io = new Server(socketHttpServer, {
    path: "/socket.io",
    cors: { origin: "*" },
  });

  // JWT helpers
  function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("Missing JWT_SECRET");
    return new TextEncoder().encode(secret);
  }

  async function authenticateSocket(socket) {
    try {
      const cookieHeader = socket.handshake.headers.cookie || "";
      const tokenMatch = cookieHeader.match(/token=([^;]+)/);
      if (!tokenMatch) return null;
      const { payload } = await jwtVerify(tokenMatch[1], getJwtSecret());
      return { userId: payload.userId, nickname: payload.nickname };
    } catch {
      return null;
    }
  }

  // In-memory state
  const players = new Map();
  const npcConfigCache = new Map();
  const lastChatTime = new Map();
  const meetingRooms = new Map(); // channelId → { participants: Set, messages: [] }
  const activeBrokers = new Map(); // channelId -> MeetingBroker instance
  const discussionInitiators = new Map(); // channelId → userId
  const userSockets = new Map(); // userId → socketId (one socket per user)
  const channelOwners = new Map(); // channelId → ownerId
  const channelGateways = new Map(); // channelId → OpenClawGateway instance
  const channelChatHistory = new Map(); // channelId -> message[] (all messages kept for session lifetime)
  const pendingReports = new Map(); // channelId → [{npcId, message}]
  const npcChatHistory = new Map(); // `${channelId}:${npcId}` -> message[] (all messages kept for session lifetime)
  const CHAT_COOLDOWN_MS = 2000;

  async function getNpcConfig(npcId) {
    if (npcConfigCache.has(npcId)) return npcConfigCache.get(npcId);
    try {
      const rows = await db.select({
        name: schema.npcs.name,
        openclawConfig: schema.npcs.openclawConfig,
        channelId: schema.npcs.channelId,
      }).from(schema.npcs).where(eq(schema.npcs.id, npcId));
      if (rows.length === 0) return null;
      const r = rows[0];
      const openclawConfig = parseJson(r.openclawConfig);
      const config = { ...openclawConfig, _channelId: r.channelId, _name: r.name };
      npcConfigCache.set(npcId, config);
      return config;
    } catch (err) {
      console.error("[npc] DB error:", err);
      return null;
    }
  }

  async function getOrConnectGateway(channelId) {
    if (channelGateways.has(channelId)) {
      const gw = channelGateways.get(channelId);
      if (gw.isConnected()) return gw;
      gw.disconnect();
      channelGateways.delete(channelId);
    }

    try {
      const rows = await db.select({ gatewayConfig: schema.channels.gatewayConfig }).from(schema.channels).where(eq(schema.channels.id, channelId));
      const config = parseJson(rows[0]?.gatewayConfig);
      if (!config?.url || !config?.token) return null;

      const gateway = new OpenClawGateway();
      await gateway.connect(config.url, config.token);
      channelGateways.set(channelId, gateway);
      console.log(`[gateway] Connected to ${config.url} for channel ${channelId.slice(0, 8)}`);
      return gateway;
    } catch (err) {
      console.error(`[gateway] Failed to connect for channel ${channelId.slice(0, 8)}:`, err.message);
      return null;
    }
  }

  async function streamNpcResponse(socket, npcId, npcConfig, userId, message) {
    const agentId = npcConfig.agentId || npcConfig.agent_id || null;
    if (!agentId) {
      socket.emit("npc:response", { npcId, chunk: "[This NPC has no AI agent connected]", done: true });
      return "";
    }

    const channelId = npcConfig._channelId;
    const gateway = channelId ? await getOrConnectGateway(channelId) : null;
    if (!gateway) {
      socket.emit("npc:response", { npcId, chunk: "[Gateway not connected]", done: true });
      return "";
    }

    const sessionKey = `${npcConfig.sessionKeyPrefix || npcId}-dm-${userId}`;

    try {
      const response = await gateway.chatSend(agentId, sessionKey, message, (delta) => {
        socket.emit("npc:response", { npcId, chunk: delta, done: false });
      });
      socket.emit("npc:response", { npcId, chunk: "", done: true });
      return response;
    } catch (err) {
      console.error("[npc] Chat error:", err.message);
      socket.emit("npc:response", { npcId, chunk: "[AI Gateway error]", done: true });
      return "";
    }
  }

  async function generateMeetingSummary(gateway, agentId, sessionKeyPrefix, meetingId, topic, transcript) {
    const summaryPrompt = `다음 회의 내용을 분석하여 JSON으로 응답하세요.

회의 주제: ${topic}

${transcript}

응답 형식 (JSON만, 다른 텍스트 없이):
{
  "keyTopics": ["주제1", "주제2", "주제3"],
  "conclusions": "결론 요약 2-3문장"
}`;

    try {
      const sessionKey = `${sessionKeyPrefix}-summary-${meetingId}`;
      const response = await Promise.race([
        gateway.chatSend(agentId, sessionKey, summaryPrompt, () => {}),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Summary timeout")), 60000)),
      ]);
      const text = response || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          keyTopics: Array.isArray(parsed.keyTopics) ? parsed.keyTopics : [],
          conclusions: typeof parsed.conclusions === "string" ? parsed.conclusions : null,
        };
      }
      return { keyTopics: [], conclusions: null };
    } catch (err) {
      console.warn("[meeting] Summary generation failed:", err.message);
      return { keyTopics: [], conclusions: null };
    }
  }

  async function getNpcConfigsForChannel(channelId) {
    try {
      const rows = await db.select({
        id: schema.npcs.id,
        name: schema.npcs.name,
        openclawConfig: schema.npcs.openclawConfig,
      }).from(schema.npcs).where(eq(schema.npcs.channelId, channelId));
      return rows.map(r => {
        const config = parseJson(r.openclawConfig) || {};
        return {
          id: r.id,
          name: r.name,
          agentId: config.agentId || config.agent_id || null,
          sessionKeyPrefix: config.sessionKeyPrefix || config.session_key_prefix || "",
          role: "Participant",
          passPolicy: config.passPolicy || null,
        };
      });
    } catch (err) {
      console.error("[meeting] Failed to load NPCs:", err);
      return [];
    }
  }

  function isMeetingController(channelId, userId) {
    return discussionInitiators.get(channelId) === userId
        || channelOwners.get(channelId) === userId;
  }

  io.on("connection", async (socket) => {
    const user = await authenticateSocket(socket);
    if (!user) { socket.disconnect(true); return; }
    console.log(`[socket] Connected: ${user.nickname} (${socket.id})`);

    socket.on("player:join", async (data) => {
      // Verify channel membership
      try {
        const memberRows = await db.select({ role: schema.channelMembers.role })
          .from(schema.channelMembers)
          .where(and(eq(schema.channelMembers.channelId, data.mapId), eq(schema.channelMembers.userId, user.userId)));
        if (memberRows.length === 0) {
          socket.emit("join-error", { error: "Not a member of this channel" });
          return;
        }
      } catch (err) {
        console.error("[socket] Membership check failed:", err);
        // Allow join on DB error (safety net should not block)
      }

      // Cache channel owner and connect gateway
      try {
        const ownerRows = await db.select({ ownerId: schema.channels.ownerId })
          .from(schema.channels).where(eq(schema.channels.id, data.mapId));
        if (ownerRows.length > 0) {
          channelOwners.set(data.mapId, ownerRows[0].ownerId);
        }
        // Connect gateway (non-blocking)
        getOrConnectGateway(data.mapId).catch(() => {});
      } catch (err) {
        console.error("[socket] Channel cache failed:", err);
      }

      // Enforce single channel per user — disconnect previous session
      const prevSocketId = userSockets.get(user.userId);
      if (prevSocketId && prevSocketId !== socket.id) {
        const prevSocket = io.sockets.sockets.get(prevSocketId);
        if (prevSocket) {
          prevSocket.emit("session:kicked", { reason: "다른 위치에서 접속하여 현재 세션이 종료되었습니다." });
          prevSocket.disconnect(true);
        }
        players.delete(prevSocketId);
      }

      const playerState = {
        id: socket.id, userId: user.userId,
        characterId: data.characterId, characterName: data.characterName,
        appearance: data.appearance, mapId: data.mapId,
        x: data.x, y: data.y, direction: "down", animation: "idle",
      };
      players.set(socket.id, playerState);
      userSockets.set(user.userId, socket.id);
      socket.join(data.mapId);
      const mapPlayers = Array.from(players.values()).filter(p => p.mapId === data.mapId && p.id !== socket.id);
      console.log(`[socket] ${user.nickname} joined room ${data.mapId} (${mapPlayers.length} others in room)`);
      socket.emit("players:state", { players: mapPlayers });
      // Send channel chat history to the joining player
      const chatHistory = channelChatHistory.get(data.mapId);
      if (chatHistory && chatHistory.length > 0) {
        socket.emit("chat:history", { messages: chatHistory });
      }
      // Send pending NPC reports
      const pendingList = pendingReports.get(data.mapId);
      if (pendingList && pendingList.length > 0) {
        for (const report of pendingList) {
          socket.emit("npc:report-ready", report);
        }
        pendingReports.delete(data.mapId);
      }
      socket.to(data.mapId).emit("player:joined", playerState);
    });

    socket.on("player:move", (data) => {
      const player = players.get(socket.id);
      if (!player) return;
      Object.assign(player, { x: data.x, y: data.y, direction: data.direction, animation: data.animation });
      socket.to(player.mapId).emit("player:moved", { id: socket.id, ...data });
    });

    socket.on("npc:chat", async (data) => {
      const { npcId, message } = data || {};
      if (!npcId || !message) return;
      const trimmed = String(message).trim().slice(0, 500);
      if (!trimmed) return;
      const now = Date.now();
      if (now - (lastChatTime.get(socket.id) || 0) < CHAT_COOLDOWN_MS) {
        socket.emit("npc:response", { npcId, chunk: "[Wait before sending.]", done: true });
        return;
      }
      lastChatTime.set(socket.id, now);
      const npcConfig = await getNpcConfig(npcId);
      if (!npcConfig) { socket.emit("npc:response", { npcId, chunk: "[NPC not found]", done: true }); return; }
      const player = players.get(socket.id);
      const historyKey = player ? `${player.mapId}:${npcId}` : npcId;
      const npcHistory = npcChatHistory.get(historyKey) || [];
      npcHistory.push({ role: "player", content: trimmed, timestamp: Date.now() });
      // 매 메시지에 태스크 프로토콜 리마인더 주입 (LLM 프로토콜 준수 강화)
      const messageToSend = withTaskReminder(trimmed);
      const response = await streamNpcResponse(socket, npcId, npcConfig, user.userId, messageToSend);
      if (response) {
        console.log(`[npc:chat] ${npcConfig._name}(${npcId}) → response (${response.length} chars)`);
        npcHistory.push({ role: "npc", content: response, timestamp: Date.now() });

        // Task Parser: 응답에서 태스크 메타데이터 추출
        const parsed = parseNpcResponse(response);
        console.log(`[npc:chat] Task parser: ${parsed.tasks.length} task(s) found`, parsed.tasks.length > 0 ? JSON.stringify(parsed.tasks) : "");

        // 태스크 처리 (클라이언트는 done:true에서 json:task 블록을 직접 strip)
        if (parsed.tasks.length > 0) {
          for (const taskAction of parsed.tasks) {
            if (!isValidTaskAction(taskAction)) {
              console.warn("[TaskManager] Invalid task action:", taskAction);
              continue;
            }
            try {
              const assignerId = player?.characterId;
              if (!assignerId) { console.warn("[TaskManager] No characterId for socket", socket.id); continue; }
              const channelId = npcConfig._channelId;
              const task = await taskManager.handleTaskAction(taskAction, channelId, npcId, assignerId);
              if (task) {
                io.to(player.mapId).emit("task:updated", { task, action: taskAction.action });
              }
            } catch (err) {
              console.error("[TaskManager] Error handling task action:", err);
            }
          }
        }

        // Notify client that NPC has a completed response — client will check distance and move NPC if needed
        socket.emit("npc:response-complete", { npcId, npcName: npcConfig._name || npcId });
      }
      npcChatHistory.set(historyKey, npcHistory);
    });

    socket.on("task:list", async ({ channelId, npcId }) => {
      try {
        const tasks = npcId
          ? await taskManager.getTasksByNpc(npcId)
          : await taskManager.getTasksByChannel(channelId);
        socket.emit("task:list-response", { tasks, npcId: npcId || null });
      } catch (err) {
        console.error("[TaskManager] Error fetching tasks:", err);
        socket.emit("task:list-response", { tasks: [], npcId: npcId || null });
      }
    });

    socket.on("task:delete", async ({ taskId }) => {
      try {
        const player = players.get(socket.id);
        if (!player) return;
        // 채널 소속 태스크만 삭제 가능 (권한 체크)
        const deleted = await taskManager.deleteTask(taskId, player.mapId);
        if (deleted) {
          io.to(player.mapId).emit("task:deleted", { taskId });
        }
      } catch (err) {
        console.error("[TaskManager] Error deleting task:", err);
      }
    });

    socket.on("npc:history", ({ npcId }) => {
      const player = players.get(socket.id);
      if (!player || !npcId) return;
      const historyKey = `${player.mapId}:${npcId}`;
      const history = npcChatHistory.get(historyKey) || [];
      socket.emit("npc:history", { npcId, messages: history });
    });

    socket.on("npc:reset-chat", ({ npcId }) => {
      const player = players.get(socket.id);
      if (!player || !npcId) return;
      const historyKey = `${player.mapId}:${npcId}`;
      npcChatHistory.delete(historyKey);
      console.log(`[npc] Chat history reset for ${npcId} in channel ${player.mapId}`);
    });

    socket.on("meeting:join", ({ channelId, characterName, appearance: meetingAppearance }) => {
      if (!channelId) return;
      let room = meetingRooms.get(channelId);
      if (!room) { room = { participants: new Set(), messages: [] }; meetingRooms.set(channelId, room); }
      room.participants.add(socket.id);
      socket.join(`meeting-${channelId}`);

      // Use client-provided data as fallback when player hasn't joined the game map
      const player = players.get(socket.id);
      const displayName = player?.characterName || characterName || user.nickname || "Unknown";
      const displayAppearance = player?.appearance || meetingAppearance || null;

      // Store meeting-specific info for this socket
      if (!player) {
        players.set(socket.id, {
          id: socket.id, userId: user.userId,
          characterName: displayName, appearance: displayAppearance,
          mapId: channelId, x: 0, y: 0, direction: "down", animation: "idle",
        });
      }

      const participantList = Array.from(room.participants).map(sid => {
        const p = players.get(sid);
        return p ? { id: sid, name: p.characterName, appearance: p.appearance } : null;
      }).filter(Boolean);
      socket.emit("meeting:state", { participants: participantList, messages: room.messages.slice(-50) });

      socket.to(`meeting-${channelId}`).emit("meeting:participant-joined", {
        id: socket.id, name: displayName, appearance: displayAppearance,
      });
      console.log(`[meeting] ${displayName} joined meeting in channel ${channelId}`);
    });

    socket.on("meeting:leave", ({ channelId }) => {
      if (!channelId) return;
      const room = meetingRooms.get(channelId);
      if (room) {
        room.participants.delete(socket.id);
        socket.leave(`meeting-${channelId}`);
        socket.to(`meeting-${channelId}`).emit("meeting:participant-left", { id: socket.id });
      }
    });

    socket.on("meeting:chat", async ({ channelId, message }) => {
      if (!channelId || !message) return;
      const now = Date.now();
      if (now - (lastChatTime.get(socket.id) || 0) < CHAT_COOLDOWN_MS) return;
      lastChatTime.set(socket.id, now);

      const player = players.get(socket.id);
      const trimmed = String(message).trim().slice(0, 500);
      if (!trimmed) return;

      const userMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sender: player?.characterName || "Unknown",
        senderId: socket.id,
        senderType: "user",
        content: trimmed,
        timestamp: Date.now(),
      };

      let room = meetingRooms.get(channelId);
      if (!room) { room = { participants: new Set(), messages: [] }; meetingRooms.set(channelId, room); }
      room.messages.push(userMessage);
      if (room.messages.length > 100) room.messages.splice(0, room.messages.length - 100);

      io.to(`meeting-${channelId}`).emit("meeting:message", userMessage);

      // If a broker is running, inject user message into the discussion
      const broker = activeBrokers.get(channelId);
      if (broker && broker.isRunning()) {
        const userName = player?.characterName || user.nickname;
        broker.addUserMessage(userName, trimmed);
      }
    });

    socket.on("meeting:start-discussion", async ({ channelId, topic, settings, selectedNpcIds }) => {
      if (!channelId || !topic) return;
      if (activeBrokers.has(channelId)) {
        socket.emit("meeting:error", { error: "A meeting is already in progress" });
        return;
      }

      const gateway = await getOrConnectGateway(channelId);
      if (!gateway) {
        socket.emit("meeting:error", { error: "No AI Gateway connected" });
        return;
      }

      const npcConfigs = await getNpcConfigsForChannel(channelId);
      let aiNpcs = npcConfigs.filter(n => n.agentId);

      // Filter by user's selected NPCs (if provided)
      const selectedIds = selectedNpcIds;
      if (selectedIds && selectedIds.length > 0) {
        const selectedSet = new Set(selectedIds);
        aiNpcs = aiNpcs.filter(n => selectedSet.has(n.id));
      }

      if (aiNpcs.length === 0) {
        socket.emit("meeting:error", { error: "No AI NPCs in this channel" });
        return;
      }

      const participants = aiNpcs.map(n => ({
        agentId: n.agentId,
        displayName: n.name,
        role: n.role || "Participant",
        passPolicy: n.passPolicy || null,
      }));

      const meetingParticipants = [
        ...aiNpcs.map(n => ({ id: n.id, name: n.name, type: "npc", agentId: n.agentId })),
      ];
      const room = meetingRooms.get(channelId);
      if (room) {
        for (const sid of room.participants) {
          const p = players.get(sid);
          if (p) meetingParticipants.push({ id: sid, name: p.characterName, type: "player" });
        }
      }

      const meetingId = `meet-${Date.now()}`;
      const brokerInstance = new MeetingBroker(
        {
          topic,
          participants,
          gateway,
          sessionKeyPrefix: aiNpcs[0].sessionKeyPrefix || channelId.slice(0, 8),
          meetingId,
          settings: settings || {},
          quota: {
            maxTotalTurns: settings?.maxTotalTurns || 50,
          },
        },
        {
          onPollStart: () => {
            io.to(`meeting-${channelId}`).emit("meeting:poll-status", { status: "polling" });
          },
          onPollResult: (raises, passes) => {
            io.to(`meeting-${channelId}`).emit("meeting:poll-status", {
              raises: raises.map(r => ({ name: r.agent.displayName, reason: r.reason })),
              passes,
            });
          },
          onTurnStart: (agent) => {
            io.to(`meeting-${channelId}`).emit("meeting:npc-turn-start", {
              npcId: agent.agentId,
              npcName: agent.displayName,
            });
          },
          onTurnChunk: (agentId, chunk) => {
            io.to(`meeting-${channelId}`).emit("meeting:npc-stream", {
              npcId: agentId,
              chunk,
              done: false,
            });
          },
          onTurnEnd: (agentId, fullResponse) => {
            io.to(`meeting-${channelId}`).emit("meeting:npc-stream", {
              npcId: agentId,
              npcName: participants.find(p => p.agentId === agentId)?.displayName || agentId,
              chunk: "",
              done: true,
            });
            // Store in meeting room messages
            const room = meetingRooms.get(channelId);
            if (room) {
              const agent = participants.find(p => p.agentId === agentId);
              room.messages.push({
                id: `msg-${Date.now()}-${agentId}`,
                sender: agent?.displayName || agentId,
                senderId: `npc-${agentId}`,
                senderType: "npc",
                content: fullResponse,
                timestamp: Date.now(),
              });
              if (room.messages.length > 100) room.messages.splice(0, room.messages.length - 100);
            }
          },
          onModeChanged: (mode, by) => {
            io.to(`meeting-${channelId}`).emit("meeting:mode-changed", { mode, by });
          },
          onWaitingInput: (pollResult) => {
            io.to(`meeting-${channelId}`).emit("meeting:waiting-input", { pollResult });
          },
          onTurnAborted: (npcId) => {
            io.to(`meeting-${channelId}`).emit("meeting:turn-aborted", { npcId });
          },
          onMeetingEnd: async (transcript, durationSeconds) => {
            // Generate AI summary
            let summary = { keyTopics: [], conclusions: null };
            const firstAgent = participants[0];
            if (gateway && firstAgent) {
              summary = await generateMeetingSummary(
                gateway, firstAgent.agentId,
                brokerInstance.config.sessionKeyPrefix, brokerInstance.config.meetingId,
                topic, transcript,
              );
            }

            // Save to database
            let minutesId = null;
            try {
              const [minutesRow] = await db.insert(schema.meetingMinutes).values({
                channelId,
                topic,
                transcript,
                participants: JSON.stringify(meetingParticipants),
                totalTurns: brokerInstance.turns.length,
                durationSeconds: durationSeconds || null,
                initiatorId: discussionInitiators.get(channelId) || null,
                keyTopics: JSON.stringify(summary.keyTopics),
                conclusions: summary.conclusions,
              }).returning();
              minutesId = minutesRow?.id;
            } catch (err) {
              console.error("[meeting] Failed to save minutes:", err.message);
            }

            // Emit to clients with enriched data
            io.to(`meeting-${channelId}`).emit("meeting:end", {
              transcript,
              keyTopics: summary.keyTopics,
              conclusions: summary.conclusions,
              minutesId,
              totalTurns: brokerInstance.turns.length,
              durationSeconds,
            });

            activeBrokers.delete(channelId);
            discussionInitiators.delete(channelId);
            console.log(`[meeting] Discussion ended in channel ${channelId} (${durationSeconds}s)`);
          },
          onError: (error) => {
            io.to(`meeting-${channelId}`).emit("meeting:error", { error });
          },
        },
      );

      activeBrokers.set(channelId, brokerInstance);
      discussionInitiators.set(channelId, user.userId);
      console.log(`[meeting] Discussion started in channel ${channelId}: "${topic}" with ${participants.length} agents`);

      brokerInstance.run().catch(err => {
        console.error("[meeting] Broker error:", err);
        activeBrokers.delete(channelId);
        discussionInitiators.delete(channelId);
        io.to(`meeting-${channelId}`).emit("meeting:error", { error: "Meeting ended due to error" });
      });

      io.to(`meeting-${channelId}`).emit("meeting:mode-changed", {
        mode: settings?.initialMode || "auto",
        by: user.userId,
        initiatorId: user.userId,
      });
    });

    socket.on("meeting:user-speak", ({ channelId, message }) => {
      if (!channelId || !message) return;
      const broker = activeBrokers.get(channelId);
      if (!broker || !broker.isRunning()) return;
      const player = players.get(socket.id);
      const userName = player?.characterName || user.nickname;
      const trimmed = String(message).trim().slice(0, 500);
      if (!trimmed) return;

      broker.addUserMessage(userName, trimmed);

      // Also broadcast as a regular meeting message for the UI
      const room = meetingRooms.get(channelId);
      const userMessage = {
        id: `msg-${Date.now()}-user`,
        sender: userName,
        senderId: socket.id,
        senderType: "user",
        content: trimmed,
        timestamp: Date.now(),
      };
      if (room) {
        room.messages.push(userMessage);
        if (room.messages.length > 100) room.messages.splice(0, room.messages.length - 100);
      }
      io.to(`meeting-${channelId}`).emit("meeting:message", userMessage);
    });

    socket.on("meeting:stop", ({ channelId }) => {
      if (!channelId) return;
      const broker = activeBrokers.get(channelId);
      if (broker) {
        broker.stop();
        discussionInitiators.delete(channelId);
        console.log(`[meeting] Discussion manually stopped in channel ${channelId}`);
      }
    });

    socket.on("meeting:set-mode", ({ channelId, mode }) => {
      if (!channelId || !mode) return;
      if (!isMeetingController(channelId, user.userId)) {
        socket.emit("meeting:error", { error: "Permission denied" });
        return;
      }
      if (!["auto", "manual", "directed"].includes(mode)) {
        socket.emit("meeting:error", { error: "Invalid mode" });
        return;
      }
      const broker = activeBrokers.get(channelId);
      if (!broker || !broker.isRunning()) return;
      broker.setMode(mode);
    });

    socket.on("meeting:next-turn", ({ channelId }) => {
      if (!channelId) return;
      if (!isMeetingController(channelId, user.userId)) {
        socket.emit("meeting:error", { error: "Permission denied" });
        return;
      }
      const broker = activeBrokers.get(channelId);
      if (!broker || !broker.isRunning()) return;
      broker.nextTurn();
    });

    socket.on("meeting:direct-speak", ({ channelId, npcId }) => {
      if (!channelId || !npcId) return;
      if (!isMeetingController(channelId, user.userId)) {
        socket.emit("meeting:error", { error: "Permission denied" });
        return;
      }
      const broker = activeBrokers.get(channelId);
      if (!broker || !broker.isRunning()) return;
      const agent = broker.config.participants.find(p => p.agentId === npcId);
      if (!agent || !agent.agentId) {
        socket.emit("meeting:error", { error: "NPC not found or has no agent" });
        return;
      }
      broker.directSpeak(npcId);
    });

    socket.on("meeting:abort-turn", ({ channelId }) => {
      if (!channelId) return;
      if (!isMeetingController(channelId, user.userId)) {
        socket.emit("meeting:error", { error: "Permission denied" });
        return;
      }
      const broker = activeBrokers.get(channelId);
      if (!broker || !broker.isRunning()) return;
      broker.abortCurrentTurn();
    });

    // --- NPC Movement ---
    socket.on("npc:call", ({ channelId, npcId }) => {
      if (!channelId || !npcId) return;
      const player = players.get(socket.id);
      if (!player) return;
      io.to(channelId).emit("npc:come-to-player", {
        npcId,
        targetPlayerId: socket.id,
      });
      console.log(`[npc] ${player.characterName} called NPC ${npcId} in ${channelId}`);
    });

    socket.on("npc:return-home", ({ channelId, npcId }) => {
      if (!channelId || !npcId) return;
      io.to(channelId).emit("npc:returning", { npcId });
    });

    socket.on("npc:position-update", ({ channelId, npcId, x, y, direction }) => {
      if (!channelId || !npcId) return;
      socket.to(channelId).emit("npc:position-sync", { npcId, x, y, direction });
    });

    socket.on("npc:arrived", ({ channelId, npcId }) => {
      if (!channelId || !npcId) return;
      socket.to(channelId).emit("npc:stop-moving", { npcId });
      console.log(`[npc] NPC ${npcId} arrived at player in ${channelId}`);
    });

    // Channel chat (user-to-user)
    socket.on("chat:send", ({ message }) => {
      const player = players.get(socket.id);
      if (!player) return;
      const trimmed = String(message || "").trim().slice(0, 500);
      if (!trimmed) return;
      const now = Date.now();
      if (now - (lastChatTime.get(socket.id) || 0) < CHAT_COOLDOWN_MS) return;
      lastChatTime.set(socket.id, now);

      const chatMessage = {
        id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sender: player.characterName || user.nickname,
        senderId: socket.id,
        content: trimmed,
        timestamp: now,
      };
      // Store in channel chat history
      const history = channelChatHistory.get(player.mapId) || [];
      history.push(chatMessage);
      channelChatHistory.set(player.mapId, history);
      io.to(player.mapId).emit("chat:message", chatMessage);
    });

    // NPC management broadcasts (re-broadcast to room)
    socket.on("npc:broadcast-add", (npcData) => {
      const player = players.get(socket.id);
      if (!player) return;
      socket.to(player.mapId).emit("npc:added", npcData);
      npcConfigCache.delete(npcData.id);
    });

    socket.on("npc:broadcast-update", (data) => {
      const player = players.get(socket.id);
      if (!player) return;
      socket.to(player.mapId).emit("npc:updated", data);
      if (data.npcId) npcConfigCache.delete(data.npcId);
    });

    socket.on("npc:broadcast-remove", (data) => {
      const player = players.get(socket.id);
      if (!player) return;
      socket.to(player.mapId).emit("npc:removed", data);
      if (data.npcId) npcConfigCache.delete(data.npcId);
    });

    // Map editing broadcasts (owner only)
    socket.on("map:object-add", (data) => {
      const player = players.get(socket.id);
      if (!player) return;
      if (channelOwners.get(player.mapId) !== user.userId) return;
      socket.to(player.mapId).emit("map:object-added", data);
    });

    socket.on("map:object-remove", (data) => {
      const player = players.get(socket.id);
      if (!player) return;
      if (channelOwners.get(player.mapId) !== user.userId) return;
      socket.to(player.mapId).emit("map:object-removed", data);
    });

    socket.on("map:tiles-update", (data) => {
      const player = players.get(socket.id);
      if (!player) return;
      if (channelOwners.get(player.mapId) !== user.userId) return;
      socket.to(player.mapId).emit("map:tiles-updated", data);
    });

    socket.on("disconnect", () => {
      const player = players.get(socket.id);
      if (player) {
        socket.to(player.mapId).emit("player:left", { id: socket.id });
        players.delete(socket.id);
        if (userSockets.get(user.userId) === socket.id) {
          userSockets.delete(user.userId);
        }

        // Disconnect gateway if channel is now empty
        const leftChannelId = player.mapId;
        if (leftChannelId) {
          const remaining = Array.from(players.values()).filter(p => p.mapId === leftChannelId);
          if (remaining.length === 0) {
            const gw = channelGateways.get(leftChannelId);
            if (gw) {
              gw.disconnect();
              channelGateways.delete(leftChannelId);
              console.log(`[gateway] Disconnected from channel ${leftChannelId.slice(0, 8)} (empty)`);
            }
          }
        }
      }
      // Clean up meeting room participation
      for (const [chId, room] of meetingRooms.entries()) {
        if (room.participants.has(socket.id)) {
          room.participants.delete(socket.id);
          socket.to(`meeting-${chId}`).emit("meeting:participant-left", { id: socket.id });
        }
      }
      // Stop broker if no participants remain
      for (const [chId, broker] of activeBrokers.entries()) {
        const room = meetingRooms.get(chId);
        if (room && room.participants.size === 0) {
          broker.stop();
          activeBrokers.delete(chId);
        }
      }
      lastChatTime.delete(socket.id);
    });
  });

  // Internal HTTP endpoints for cross-process communication
  socketHttpServer.on("request", (req, res) => {
    if (!req.url || !req.url.startsWith("/_internal")) return;

    res.setHeader("Content-Type", "application/json");

    // POST /_internal/rpc — proxy RPC calls from API routes to gateway
    if (req.method === "POST" && req.url === "/_internal/rpc") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", async () => {
        try {
          const { channelId, method, params } = JSON.parse(body);
          const gateway = await getOrConnectGateway(channelId);
          if (!gateway) {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Gateway not connected" }));
            return;
          }
          const result = await gateway._rpcRequest(method, params || {});
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, result }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    // POST /_internal/emit
    if (req.method === "POST" && req.url === "/_internal/emit") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const { event, room, targetUserId, payload } = JSON.parse(body);

          // Gateway reconnection on config change
          if (event === "gateway:config-updated" && payload?.channelId) {
            const gw = channelGateways.get(payload.channelId);
            if (gw) {
              gw.disconnect();
              channelGateways.delete(payload.channelId);
            }
          }

          if (targetUserId) {
            const socketId = userSockets.get(targetUserId);
            if (socketId) {
              io.to(socketId).emit(event, payload);
              if (event === "member:kicked" && payload?.channelId) {
                const targetSocket = io.sockets.sockets.get(socketId);
                if (targetSocket) {
                  targetSocket.leave(payload.channelId);
                }
              }
            }
          } else if (room) {
            io.to(room).emit(event, payload);
          }

          res.writeHead(200);
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Invalid request" }));
        }
      });
      return;
    }

    // GET /_internal/room-members?channelId=X
    if (req.method === "GET" && req.url.startsWith("/_internal/room-members")) {
      const url = new URL(req.url, "http://localhost");
      const channelId = url.searchParams.get("channelId");

      if (!channelId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "channelId required" }));
        return;
      }

      const roomSockets = io.sockets.adapter.rooms.get(channelId);
      const userIds = [];

      if (roomSockets) {
        for (const socketId of roomSockets) {
          const player = players.get(socketId);
          if (player && player.userId) {
            userIds.push(player.userId);
          }
        }
      }

      res.writeHead(200);
      res.end(JSON.stringify({ userIds }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  });

  socketHttpServer.listen(SOCKET_PORT, hostname, () => {
    console.log(`[socket.io] Listening on http://${hostname}:${SOCKET_PORT}`);
  });
}

main().catch(err => { console.error(err); process.exit(1); });
