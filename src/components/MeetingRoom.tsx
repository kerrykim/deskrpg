"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import ChatInput from "./ChatInput";
import type {
  CharacterAppearance,
  LegacyCharacterAppearance,
} from "@/lib/lpc-registry";
import { compositeCharacter } from "@/lib/sprite-compositor";
import MinutesModal from "./MinutesModal";
import { useT } from "@/lib/i18n";
import { Pause, Play } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Participant {
  id: string;
  name: string;
  appearance: CharacterAppearance | LegacyCharacterAppearance | null;
  type: "user" | "npc";
}

interface MeetingMessage {
  id: string;
  sender: string;
  senderId: string;
  senderType: "user" | "npc";
  content: string;
  timestamp: number;
}

interface PollStatus {
  status?: string;
  raises?: string[];
  passes?: string[];
}

interface MeetingRoomProps {
  channelId: string;
  character: {
    id: string;
    name: string;
    appearance: CharacterAppearance | LegacyCharacterAppearance;
  };
  socket: Socket | null;
  npcs: { id: string; name: string; appearance: unknown }[];
  onLeave: () => void;
}

// ---------------------------------------------------------------------------
// Avatar component — renders LPC sprite on a tiny canvas
// ---------------------------------------------------------------------------

function SpriteAvatar({
  appearance,
  size = 48,
}: {
  appearance: CharacterAppearance | LegacyCharacterAppearance | null;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !appearance) return;
    const canvas = canvasRef.current;

    // Composite the full spritesheet, then draw just the "down idle" frame
    const offscreen = document.createElement("canvas");
    compositeCharacter(offscreen, appearance)
      .then(() => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = size;
        canvas.height = size;
        // Draw row 2 (facing down), frame 0 — each frame is 64x64
        ctx.clearRect(0, 0, size, size);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(offscreen, 0, 128, 64, 64, 0, 0, size, size);
      })
      .catch(() => {
        // Failed to composite — just leave blank
      });
  }, [appearance, size]);

  if (!appearance) {
    return (
      <div
        className="rounded-full bg-surface-raised flex items-center justify-center text-text-secondary text-caption font-bold"
        style={{ width: size, height: size }}
      >
        ?
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="rounded-full bg-surface-raised"
      style={{ width: size, height: size, imageRendering: "pixelated" }}
    />
  );
}

// ---------------------------------------------------------------------------
// Seat layout — arrange participants around a table
// ---------------------------------------------------------------------------

interface Seat {
  participant: Participant;
  x: number; // percent
  y: number; // percent
  isChair: boolean; // is this the chairperson (current user)?
}

function computeSeats(
  currentUser: Participant,
  others: Participant[],
): Seat[] {
  const seats: Seat[] = [];

  // Rectangular long table layout:
  // Chairperson at the head (top center)
  // Others distributed along left and right sides, then bottom
  //
  //        [Chair - YOU]
  //   [P1]               [P2]
  //   [P3]               [P4]
  //   [P5]               [P6]
  //        [P7]

  seats.push({ participant: currentUser, x: 50, y: 3, isChair: true });

  if (others.length === 0) return seats;

  // Split into: left side, right side, bottom
  // For 1 person: bottom center
  // For 2: left + right
  // For 3+: alternate left/right, overflow to bottom
  if (others.length === 1) {
    seats.push({ participant: others[0], x: 50, y: 95, isChair: false });
    return seats;
  }

  const left: Participant[] = [];
  const right: Participant[] = [];
  let bottom: Participant | null = null;

  for (let i = 0; i < others.length; i++) {
    if (i === others.length - 1 && others.length % 2 === 1) {
      // Odd last person goes to bottom center
      bottom = others[i];
    } else if (i % 2 === 0) {
      left.push(others[i]);
    } else {
      right.push(others[i]);
    }
  }

  // Place left side (evenly spaced vertically)
  for (let i = 0; i < left.length; i++) {
    const t = (i + 1) / (left.length + 1);
    seats.push({ participant: left[i], x: 5, y: 10 + t * 80, isChair: false });
  }

  // Place right side
  for (let i = 0; i < right.length; i++) {
    const t = (i + 1) / (right.length + 1);
    seats.push({ participant: right[i], x: 95, y: 10 + t * 80, isChair: false });
  }

  // Bottom center
  if (bottom) {
    seats.push({ participant: bottom, x: 50, y: 95, isChair: false });
  }

  return seats;
}

// ---------------------------------------------------------------------------
// MeetingControlBar — mode toggle, next turn, direct speak, stop
// ---------------------------------------------------------------------------

function MeetingControlBar({
  mode, isWaiting, currentSpeaker, npcs, lastSpokeTimes,
  onSetMode, onNextTurn, onDirectSpeak, onAbortTurn, onStop,
  t,
}: {
  mode: "auto" | "manual" | "directed";
  isWaiting: boolean;
  currentSpeaker: { npcId: string; npcName: string } | null;
  npcs: { id: string; name: string }[];
  lastSpokeTimes: Record<string, number>;
  onSetMode: (mode: "auto" | "manual") => void;
  onNextTurn: () => void;
  onDirectSpeak: (npcId: string) => void;
  onAbortTurn: () => void;
  onStop: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const modeLabel = mode === "auto" ? t("meeting.modeAuto") : mode === "manual" ? t("meeting.modeManual") : t("meeting.modeDirected");

  const formatElapsed = (npcId: string) => {
    const lastTime = lastSpokeTimes[npcId];
    if (!lastTime) return t("meeting.waiting");
    const sec = Math.floor((Date.now() - lastTime) / 1000);
    if (sec < 60) return t("meeting.secAgo", { sec });
    return t("meeting.minAgo", { min: Math.floor(sec / 60) });
  };

  return (
    <div className="border-t border-border bg-surface/80">
      {mode !== "auto" && (
        <div className="px-3 py-2 border-b border-border flex flex-wrap gap-1.5">
          <span className="text-caption text-text-dim self-center mr-1">NPC:</span>
          {npcs.map((npc) => {
            const isSpeaking = currentSpeaker?.npcId === npc.id;
            return (
              <button
                key={npc.id}
                onClick={() => onDirectSpeak(npc.id)}
                className={`px-2 py-1 rounded text-caption font-medium transition ${
                  isSpeaking
                    ? "bg-npc text-black animate-pulse"
                    : "bg-surface-raised hover:bg-surface-raised text-npc"
                }`}
              >
                {npc.name} <span className="text-text-muted ml-0.5">{formatElapsed(npc.id)}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="px-3 py-2 flex items-center gap-2">
        <button
          onClick={() => onSetMode(mode === "auto" ? "manual" : "auto")}
          className="px-2 py-1.5 rounded bg-surface-raised hover:bg-surface-raised text-text text-body"
          title={mode === "auto" ? t("meeting.pauseManual") : t("meeting.playAuto")}
        >
          {mode === "auto" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button
          onClick={onNextTurn}
          disabled={mode === "auto" || !isWaiting}
          className={`px-2 py-1.5 rounded text-body ${
            mode !== "auto" && isWaiting
              ? "bg-surface-raised hover:bg-surface-raised text-text"
              : "bg-surface text-text-dim cursor-not-allowed"
          }`}
          title={t("meeting.nextTurnBtn")}
        >
          ⏭
        </button>
        <button
          onClick={onStop}
          className="px-2 py-1.5 rounded bg-danger-bg hover:bg-danger-hover text-text text-body"
          title={t("meeting.stopMeeting")}
        >
          ⏹
        </button>
        <span className="ml-auto text-caption text-text-muted">
          {mode === "auto" && !isWaiting && (
            <span className="text-success animate-pulse">{t("meeting.autoProgress")}</span>
          )}
          {mode !== "auto" && isWaiting && (
            <span className="text-npc">{t("meeting.nextTurn")}</span>
          )}
          {!isWaiting && mode !== "auto" && currentSpeaker && (
            <span className="text-npc">{t("meeting.isSpeaking", { name: currentSpeaker.npcName })}</span>
          )}
        </span>
        <span className="text-micro bg-surface-raised px-1.5 py-0.5 rounded text-text-secondary">
          {modeLabel}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MeetingRoom Component
// ---------------------------------------------------------------------------

export default function MeetingRoom({
  channelId,
  character,
  socket,
  npcs,
  onLeave,
}: MeetingRoomProps) {
  const t = useT();
  const [messages, setMessages] = useState<MeetingMessage[]>([]);
  const [npcStreams, setNpcStreams] = useState<Record<string, string>>({});
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [input, setInput] = useState("");
  const [cooldown, setCooldown] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const joinedRef = useRef(false);

  // --- New state for broker-driven discussions ---
  const [meetingActive, setMeetingActive] = useState(false);
  const [meetingTopic, setMeetingTopic] = useState("");
  const [startingMeeting, setStartingMeeting] = useState(false);
  const [currentSpeaker, setCurrentSpeaker] = useState<{
    npcId: string;
    npcName: string;
  } | null>(null);
  const [pollStatus, setPollStatus] = useState<PollStatus | null>(null);
  const [meetingMode, setMeetingMode] = useState<"auto" | "manual" | "directed">("auto");
  const [isWaitingInput, setIsWaitingInput] = useState(false);
  const [isInitiator, setIsInitiator] = useState(false);
  const [lastSpokeTimes, setLastSpokeTimes] = useState<Record<string, number>>({});

  // Start dialog settings
  const [startMode, setStartMode] = useState<"auto" | "manual">("auto");
  const [hybridMode, setHybridMode] = useState(false);
  const [hybridResumeMode, setHybridResumeMode] = useState<"manual" | "timer">("manual");
  const [hybridResumeSeconds, setHybridResumeSeconds] = useState(30);
  const [selectedNpcIds, setSelectedNpcIds] = useState<Set<string>>(new Set());
  const [maxTurns, setMaxTurns] = useState(20);

  // Post-meeting state
  const [meetingEnded, setMeetingEnded] = useState(false);
  const [lastMeetingResult, setLastMeetingResult] = useState<{
    topic: string;
    keyTopics: string[];
    conclusions: string | null;
    minutesId: string | null;
    totalTurns: number;
    durationSeconds: number | null;
  } | null>(null);
  const [showMinutesModal, setShowMinutesModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Build current user as participant
  const currentUser: Participant = {
    id: socket?.id || "self",
    name: character.name,
    appearance: character.appearance,
    type: "user",
  };

  // Build NPC participants
  const npcParticipants: Participant[] = npcs.map((npc) => ({
    id: `npc-${npc.id}`,
    name: npc.name,
    appearance: npc.appearance as CharacterAppearance | LegacyCharacterAppearance | null,
    type: "npc" as const,
  }));

  // Merge remote users + NPCs for "others"
  const otherParticipants = [
    ...participants.filter((p) => p.id !== socket?.id),
    ...npcParticipants,
  ];

  const seats = computeSeats(currentUser, otherParticipants);

  // Auto-select all NPCs when npcs prop changes
  useEffect(() => {
    setSelectedNpcIds(new Set(npcs.map((n) => n.id)));
  }, [npcs]);

  // Join meeting room on mount
  useEffect(() => {
    if (!socket || joinedRef.current) return;
    joinedRef.current = true;

    socket.emit("meeting:join", {
      channelId,
      characterName: character.name,
      appearance: character.appearance,
    });

    // Listen for state sync (on join)
    const handleState = (data: {
      participants: { id: string; name: string; appearance: unknown }[];
      messages: MeetingMessage[];
    }) => {
      setParticipants(
        data.participants.map((p) => ({
          ...p,
          appearance: p.appearance as CharacterAppearance | LegacyCharacterAppearance | null,
          type: "user" as const,
        })),
      );
      // Start with empty chat — past messages are preserved in meeting minutes DB
      setMessages([]);
    };

    const handleParticipantJoined = (data: {
      id: string;
      name: string;
      appearance: unknown;
    }) => {
      setParticipants((prev) => {
        if (prev.some((p) => p.id === data.id)) return prev;
        return [
          ...prev,
          {
            id: data.id,
            name: data.name,
            appearance: data.appearance as CharacterAppearance | LegacyCharacterAppearance | null,
            type: "user" as const,
          },
        ];
      });
    };

    const handleParticipantLeft = (data: { id: string }) => {
      setParticipants((prev) => prev.filter((p) => p.id !== data.id));
    };

    const handleMessage = (msg: MeetingMessage) => {
      setMessages((prev) => [...prev.slice(-99), msg]);
    };

    const handleNpcStream = (data: {
      npcId: string;
      npcName?: string;
      chunk: string;
      done: boolean;
    }) => {
      if (data.done) {
        // Track last spoke time
        setLastSpokeTimes((prev) => ({ ...prev, [data.npcId]: Date.now() }));
        // Finalize: move from stream buffer to messages
        setNpcStreams((prev) => {
          const content = prev[data.npcId];
          if (content) {
            const npc = npcs.find((n) => n.id === data.npcId);
            const senderName = data.npcName || npc?.name || data.npcId;
            const finalMsg: MeetingMessage = {
              id: `msg-${Date.now()}-${data.npcId}`,
              sender: senderName,
              senderId: `npc-${data.npcId}`,
              senderType: "npc",
              content,
              timestamp: Date.now(),
            };
            setMessages((msgs) => [...msgs.slice(-99), finalMsg]);
          }
          const next = { ...prev };
          delete next[data.npcId];
          return next;
        });
        setCurrentSpeaker(null);
      } else {
        if (data.chunk) {
          setNpcStreams((prev) => ({
            ...prev,
            [data.npcId]: (prev[data.npcId] || "") + data.chunk,
          }));
        }
      }
    };

    const handleNpcTurnStart = (data: { npcId: string; npcName: string }) => {
      setCurrentSpeaker({ npcId: data.npcId, npcName: data.npcName });
    };

    const handlePollStatus = (data: PollStatus) => {
      setPollStatus(data);
    };

    const handleMeetingEnd = (data: {
      transcript?: string;
      keyTopics?: string[];
      conclusions?: string | null;
      minutesId?: string | null;
      totalTurns?: number;
      durationSeconds?: number | null;
    }) => {
      setMeetingActive(false);
      setCurrentSpeaker(null);
      setPollStatus(null);

      setMeetingEnded(true);
      setLastMeetingResult({
        topic: meetingTopic,
        keyTopics: data.keyTopics || [],
        conclusions: data.conclusions || null,
        minutesId: data.minutesId || null,
        totalTurns: data.totalTurns || 0,
        durationSeconds: data.durationSeconds || null,
      });

      if (data.transcript) {
        const transcriptMsg: MeetingMessage = {
          id: `transcript-${Date.now()}`,
          sender: "System",
          senderId: "system",
          senderType: "npc",
          content: `[Meeting ended]\n${data.transcript}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev.slice(-99), transcriptMsg]);
      }
    };

    const handleMeetingError = (data: { error: string }) => {
      const errorMsg: MeetingMessage = {
        id: `error-${Date.now()}`,
        sender: "System",
        senderId: "system",
        senderType: "npc",
        content: `[Error] ${data.error}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev.slice(-99), errorMsg]);
    };

    const handleModeChanged = (data: { mode: "auto" | "manual" | "directed"; by: string; initiatorId?: string }) => {
      setMeetingMode(data.mode);
      setIsWaitingInput(data.mode !== "auto");
    };

    const handleWaitingInput = (data: { pollResult?: PollStatus | null }) => {
      setIsWaitingInput(true);
      if (data.pollResult) setPollStatus(data.pollResult);
    };

    const handleTurnAborted = (data: { npcId: string }) => {
      setLastSpokeTimes((prev) => ({ ...prev, [data.npcId]: Date.now() }));
      setNpcStreams((prev) => {
        const content = prev[data.npcId];
        if (content) {
          const npc = npcs.find((n) => n.id === data.npcId);
          const finalMsg: MeetingMessage = {
            id: `msg-${Date.now()}-abort-${data.npcId}`,
            sender: npc?.name || data.npcId,
            senderId: `npc-${data.npcId}`,
            senderType: "npc",
            content: content + " " + t("meeting.aborted"),
            timestamp: Date.now(),
          };
          setMessages((msgs) => [...msgs, finalMsg]);
        }
        const next = { ...prev };
        delete next[data.npcId];
        return next;
      });
      setCurrentSpeaker(null);
    };

    socket.on("meeting:state", handleState);
    socket.on("meeting:participant-joined", handleParticipantJoined);
    socket.on("meeting:participant-left", handleParticipantLeft);
    socket.on("meeting:message", handleMessage);
    socket.on("meeting:npc-stream", handleNpcStream);
    socket.on("meeting:npc-turn-start", handleNpcTurnStart);
    socket.on("meeting:poll-status", handlePollStatus);
    socket.on("meeting:end", handleMeetingEnd);
    socket.on("meeting:error", handleMeetingError);
    socket.on("meeting:mode-changed", handleModeChanged);
    socket.on("meeting:waiting-input", handleWaitingInput);
    socket.on("meeting:turn-aborted", handleTurnAborted);

    return () => {
      socket.off("meeting:state", handleState);
      socket.off("meeting:participant-joined", handleParticipantJoined);
      socket.off("meeting:participant-left", handleParticipantLeft);
      socket.off("meeting:message", handleMessage);
      socket.off("meeting:npc-stream", handleNpcStream);
      socket.off("meeting:npc-turn-start", handleNpcTurnStart);
      socket.off("meeting:poll-status", handlePollStatus);
      socket.off("meeting:end", handleMeetingEnd);
      socket.off("meeting:error", handleMeetingError);
      socket.off("meeting:mode-changed", handleModeChanged);
      socket.off("meeting:waiting-input", handleWaitingInput);
      socket.off("meeting:turn-aborted", handleTurnAborted);
      socket.emit("meeting:leave", { channelId });
      joinedRef.current = false;
    };
  }, [socket, channelId]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, npcStreams]);

  // Refocus input whenever it loses focus (e.g. DOM changes from NPC streaming)
  const refocusInput = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleStartDiscussion = useCallback(() => {
    const topic = meetingTopic.trim();
    if (!topic || startingMeeting || !socket) return;
    setStartingMeeting(true);
    socket.emit("meeting:start-discussion", {
      channelId,
      topic,
      selectedNpcIds: Array.from(selectedNpcIds),
      settings: {
        initialMode: startMode,
        maxTotalTurns: maxTurns,
        hybridMode,
        hybridAutoResumeMs: hybridMode && hybridResumeMode === "timer"
          ? hybridResumeSeconds * 1000
          : null,
      },
    });
    setMeetingActive(true);
    setIsInitiator(true);
    setMeetingMode(startMode);
    setStartingMeeting(false);
  }, [meetingTopic, startingMeeting, socket, channelId, selectedNpcIds, startMode, maxTurns, hybridMode, hybridResumeMode, hybridResumeSeconds]);

  const handleEndMeeting = useCallback(() => {
    if (!socket) return;
    socket.emit("meeting:stop", { channelId });
  }, [socket, channelId]);

  const handleSetMode = useCallback((mode: "auto" | "manual") => {
    if (!socket) return;
    socket.emit("meeting:set-mode", { channelId, mode });
  }, [socket, channelId]);

  const handleNextTurn = useCallback(() => {
    if (!socket) return;
    socket.emit("meeting:next-turn", { channelId });
    setIsWaitingInput(false);
  }, [socket, channelId]);

  const handleDirectSpeak = useCallback((npcId: string) => {
    if (!socket) return;
    socket.emit("meeting:direct-speak", { channelId, npcId });
    setIsWaitingInput(false);
  }, [socket, channelId]);

  const handleAbortTurn = useCallback(() => {
    if (!socket) return;
    socket.emit("meeting:abort-turn", { channelId });
  }, [socket, channelId]);

  const handleSend = useCallback((msg?: string) => {
    const trimmed = (msg ?? input).trim();
    if (!trimmed || cooldown || !socket) return;
    if (!msg) setInput("");
    if (meetingActive) {
      socket.emit("meeting:user-speak", { channelId, message: trimmed });
    } else {
      socket.emit("meeting:chat", { channelId, message: trimmed });
    }
    setCooldown(true);
    setTimeout(() => setCooldown(false), 2000);
  }, [input, cooldown, socket, channelId, meetingActive]);

  // Collect streaming NPC messages for display
  const streamingEntries = Object.entries(npcStreams);

  // Shared meeting start form (used in pre-meeting and post-meeting views)
  const renderMeetingStartForm = () => (
    <>
      <input
        type="text"
        value={meetingTopic}
        onChange={(e) => setMeetingTopic(e.target.value.slice(0, 200))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleStartDiscussion();
          }
        }}
        placeholder={t("meeting.topicPlaceholder")}
        className="w-full bg-surface-raised text-text px-3 py-2 rounded border border-border focus:ring-2 focus:ring-primary-light focus:border-transparent focus:outline-none text-body"
        maxLength={200}
      />
      {/* NPC Participant selection */}
      <div className="space-y-2 pt-2 border-t border-border">
        <p className="text-caption text-text-dim font-medium">{t("meeting.npcParticipants")}</p>
        {npcs.length === 0 ? (
          <p className="text-caption text-text-dim italic">{t("meeting.noNpcs")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {npcs.map((npc) => {
              const isSelected = selectedNpcIds.has(npc.id);
              return (
                <label
                  key={npc.id}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-caption cursor-pointer border transition-colors ${
                    isSelected
                      ? "border-info bg-info/15 text-info"
                      : "border-border bg-surface-raised/50 text-text-muted"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => {
                      const next = new Set(selectedNpcIds);
                      if (e.target.checked) {
                        next.add(npc.id);
                      } else {
                        next.delete(npc.id);
                      }
                      setSelectedNpcIds(next);
                    }}
                    className="accent-info w-3 h-3"
                  />
                  {npc.name}
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Turn count slider */}
      <div className="space-y-1.5 pt-2 border-t border-border">
        <div className="flex items-center justify-between">
          <p className="text-caption text-text-dim font-medium">
            {t("meeting.maxTurns")}: <span className="text-info font-semibold">{maxTurns}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-caption text-text-dim">5</span>
          <input
            type="range"
            min={5}
            max={50}
            step={5}
            value={maxTurns}
            onChange={(e) => setMaxTurns(Number(e.target.value))}
            className="flex-1 accent-info"
          />
          <span className="text-caption text-text-dim">50</span>
        </div>
      </div>

      <div className="space-y-2 pt-2 border-t border-border">
        <p className="text-caption text-text-dim font-medium">{t("meeting.settings")}</p>
        <div className="flex items-center gap-3 text-caption">
          <span className="text-text-muted w-16">{t("meeting.startMode")}</span>
          <label className="flex items-center gap-1 text-text-secondary cursor-pointer">
            <input type="radio" name="startMode" checked={startMode === "auto"} onChange={() => setStartMode("auto")} className="accent-primary" />
            {t("meeting.modeAuto")}
          </label>
          <label className="flex items-center gap-1 text-text-secondary cursor-pointer">
            <input type="radio" name="startMode" checked={startMode === "manual"} onChange={() => setStartMode("manual")} className="accent-primary" />
            {t("meeting.modeManual")}
          </label>
        </div>
        <label className="flex items-center gap-2 text-caption text-text-secondary cursor-pointer">
          <input type="checkbox" checked={hybridMode} onChange={(e) => setHybridMode(e.target.checked)} className="accent-primary" />
          {t("meeting.hybridModeDesc")}
        </label>
        {hybridMode && (
          <div className="ml-5 space-y-1">
            <label className="flex items-center gap-1 text-caption text-text-muted cursor-pointer">
              <input type="radio" name="hybridResume" checked={hybridResumeMode === "manual"} onChange={() => setHybridResumeMode("manual")} className="accent-primary" />
              {t("meeting.manualResume")}
            </label>
            <label className="flex items-center gap-1 text-caption text-text-muted cursor-pointer">
              <input type="radio" name="hybridResume" checked={hybridResumeMode === "timer"} onChange={() => setHybridResumeMode("timer")} className="accent-primary" />
              <input type="number" min={5} max={120} value={hybridResumeSeconds} onChange={(e) => setHybridResumeSeconds(Math.max(5, Math.min(120, Number(e.target.value) || 30)))} className="w-12 bg-surface-raised text-text px-1 py-0.5 rounded border border-border text-caption text-center" disabled={hybridResumeMode !== "timer"} />
              {t("meeting.timerResumeAfter")}
            </label>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="fixed inset-0 z-5 flex flex-col bg-bg text-text">
      {/* Main content: table + chat side by side */}
      <div className="flex-1 flex min-h-0 pt-[44px]">
        {/* Left: Meeting Table visualization */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 flex items-center justify-center p-4">
          <div className="relative w-full max-w-[500px]" style={{ height: `${Math.min(90, Math.max(40, 25 + seats.length * 12))}vh` }}>
            {/* Rectangular long table — height scales with participant count */}
            <div className="absolute left-[18%] right-[18%] top-[8%] bottom-[8%] rounded-lg bg-npc/10 border-2 border-npc/30 shadow-lg" />
            <div className="absolute left-[20%] right-[20%] top-[10%] bottom-[10%] rounded-md bg-npc/10 border border-npc/30" />

            {/* Table label */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-npc/40 text-body font-semibold tracking-wider uppercase">
                {t("meeting.table")}
              </span>
            </div>

            {/* Seats */}
            {seats.map((seat, i) => {
              const isClickableNpc = seat.participant.type === "npc" && meetingActive && isInitiator;
              return (
                <div
                  key={seat.participant.id + "-" + i}
                  className={`absolute flex flex-col items-center gap-1 -translate-x-1/2 -translate-y-1/2 ${isClickableNpc ? "cursor-pointer group" : ""}`}
                  style={{ left: `${seat.x}%`, top: `${seat.y}%` }}
                  onClick={isClickableNpc ? () => handleDirectSpeak(seat.participant.id.replace("npc-", "")) : undefined}
                >
                  <div
                    className={`relative ${
                      seat.isChair
                        ? "ring-2 ring-primary rounded-full"
                        : seat.participant.type === "npc"
                          ? "ring-2 ring-npc rounded-full"
                          : ""
                    } ${isClickableNpc ? "group-hover:ring-npc group-hover:ring-4 transition-all" : ""}`}
                  >
                    <SpriteAvatar appearance={seat.participant.appearance} size={80} />
                    {seat.isChair && (
                      <div className="absolute -top-1 -right-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center text-micro font-bold">
                        C
                      </div>
                    )}
                    {/* Speech bubble when NPC is speaking */}
                    {currentSpeaker &&
                      seat.participant.id === `npc-${currentSpeaker.npcId}` && (() => {
                        const streamText = npcStreams[currentSpeaker.npcId] || "";
                        const preview = streamText.length > 40 ? "..." + streamText.slice(-40) : streamText;
                        return (
                          <div className="absolute -top-12 left-1/2 -translate-x-1/2 max-w-[180px] z-10">
                            <div className="bg-white text-gray-900 text-micro leading-tight px-2.5 py-1.5 rounded-lg shadow-lg relative">
                              {preview || "..."}
                              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rotate-45" />
                            </div>
                          </div>
                        );
                      })()}
                    {/* Hover tooltip for clickable NPC seats */}
                    {isClickableNpc && (
                      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-npc text-black text-micro font-bold px-1.5 rounded-full whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                        {t("meeting.directSpeak")}
                      </div>
                    )}
                  </div>
                  <span
                    className={`text-caption font-medium max-w-[100px] truncate ${
                      seat.isChair
                        ? "text-primary-light"
                        : seat.participant.type === "npc"
                          ? "text-npc"
                          : "text-text-secondary"
                    }`}
                  >
                    {seat.participant.name}
                  </span>
                </div>
              );
            })}
          </div>
          </div>
          {meetingActive && isInitiator && (
            <MeetingControlBar
              mode={meetingMode}
              isWaiting={isWaitingInput}
              currentSpeaker={currentSpeaker}
              npcs={npcs}
              lastSpokeTimes={lastSpokeTimes}
              onSetMode={handleSetMode}
              onNextTurn={handleNextTurn}
              onDirectSpeak={handleDirectSpeak}
              onAbortTurn={handleAbortTurn}
              onStop={handleEndMeeting}
              t={t}
            />
          )}
        </div>

        {/* Right: Chat Panel */}
        <div className="w-[360px] flex flex-col border-l border-border bg-bg/95 shrink-0 h-full">
          {/* Chat header */}
          <div className="px-4 py-2 border-b border-border bg-surface/80 flex items-center justify-between flex-shrink-0">
            <div>
              <span className="text-title text-text-secondary">{t("meeting.groupChat")}</span>
              <span className="text-caption text-text-dim ml-2">
                {seats.length} {t("meeting.participantCount")}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowMinutesModal(true)}
                className="px-2.5 py-1 bg-surface-raised hover:bg-surface-raised border border-border rounded-lg text-info text-caption"
              >
                {t("minutes.title")}
              </button>
              {meetingActive && !isInitiator && (
                <button
                  onClick={onLeave}
                  className="px-2 py-1 rounded text-caption font-semibold bg-surface-raised hover:bg-surface-raised text-text shrink-0"
                >
                  {t("common.leave")}
                </button>
              )}
            </div>
          </div>

          {/* Poll status bar */}
          {meetingActive && pollStatus && (
            <div className="px-3 py-1.5 bg-surface border-b border-border text-caption text-text-muted flex flex-wrap gap-1 items-center">
              <span className="text-npc font-semibold">{t("meeting.polling")}</span>
              {pollStatus.raises && pollStatus.raises.length > 0 && (
                <span className="text-success">
                  {t("meeting.raiseLabel")} {pollStatus.raises.join(", ")}
                </span>
              )}
              {pollStatus.passes && pollStatus.passes.length > 0 && (
                <span className="text-text-dim">
                  {t("meeting.passLabel")} {pollStatus.passes.join(", ")}
                </span>
              )}
              {pollStatus.status && (
                <span className="text-text-muted">{pollStatus.status}</span>
              )}
            </div>
          )}

          {/* Messages or Topic Input */}
          {meetingActive ? (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Active meeting messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
                {messages.length === 0 && streamingEntries.length === 0 && (
                  <div className="text-text-dim text-body italic py-8 text-center">
                    {t("meeting.discussionStarted")}
                  </div>
                )}
                {messages.map((msg) => {
                  const isMe = msg.senderId === socket?.id;
                  const isNpc = msg.senderType === "npc";
                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                    >
                      <div className="max-w-[85%]">
                        {!isMe && (
                          <div
                            className={`text-micro font-medium mb-0.5 ${
                              isNpc ? "text-npc" : "text-text-muted"
                            }`}
                          >
                            {msg.sender}
                          </div>
                        )}
                        <div
                          className={`px-3 py-2 rounded-lg text-body ${
                            isMe
                              ? "bg-primary text-white"
                              : isNpc
                                ? "bg-surface-raised text-text border border-npc/30"
                                : msg.senderId === "system"
                                  ? "bg-surface text-text-muted border border-border italic text-caption"
                                  : "bg-surface-raised text-text"
                          }`}
                        >
                          {msg.content}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Speaking indicator above streaming */}
                {currentSpeaker && (
                  <div className="flex justify-start">
                    <div className="text-micro text-npc italic px-1">
                      {t("meeting.isSpeaking", { name: currentSpeaker.npcName })}
                    </div>
                  </div>
                )}

                {/* Streaming NPC messages */}
                {streamingEntries.map(([npcId, content]) => {
                  const npc = npcs.find((n) => n.id === npcId);
                  const speakerName =
                    currentSpeaker?.npcId === npcId
                      ? currentSpeaker.npcName
                      : npc?.name || npcId;
                  return (
                    <div key={`stream-${npcId}`} className="flex justify-start">
                      <div className="max-w-[85%]">
                        <div className="text-micro font-medium mb-0.5 text-npc">
                          {speakerName}
                        </div>
                        <div className="px-3 py-2 rounded-lg text-body bg-surface-raised text-text border border-npc/30">
                          {content}
                          <span className="inline-block w-1.5 h-4 bg-npc ml-0.5 animate-pulse" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Input for active meeting */}
              <div className="flex-shrink-0">
                <ChatInput
                  onSend={(msg) => handleSend(msg)}
                  placeholder={t("meeting.speakToMeeting")}
                  cooldown={cooldown}
                  accentColor="indigo"
                  autoFocus
                />
              </div>
            </div>
          ) : meetingEnded && lastMeetingResult ? (
            /* ---- Post-meeting hybrid view ---- */
            <div className="flex-1 flex flex-col min-h-0">
              {/* Scrollable content */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {/* Completion badge */}
                <div className="flex justify-center">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-success/15 border border-success/40 text-success text-body font-semibold rounded-full">
                    {t("meeting.ended")}
                  </span>
                </div>

                {/* Summary card */}
                <div className="bg-surface rounded-lg p-4 border border-border space-y-3">
                  <h3 className="text-title text-text">{lastMeetingResult.topic}</h3>

                  {/* Stats grid */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-surface-raised/50 rounded px-3 py-2 text-center">
                      <div className="text-heading font-bold text-info">{seats.length}</div>
                      <div className="text-micro text-text-muted">{t("meeting.participantCount")}</div>
                    </div>
                    <div className="bg-surface-raised/50 rounded px-3 py-2 text-center">
                      <div className="text-heading font-bold text-npc">{lastMeetingResult.totalTurns}</div>
                      <div className="text-micro text-text-muted">{t("meeting.totalTurns")}</div>
                    </div>
                  </div>

                  {/* Key topics & conclusions */}
                  {lastMeetingResult.keyTopics.length > 0 || lastMeetingResult.conclusions ? (
                    <>
                      {lastMeetingResult.keyTopics.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-caption text-text-dim font-medium">{t("meeting.keyTopics")}</p>
                          <ul className="space-y-0.5">
                            {lastMeetingResult.keyTopics.map((topic, i) => (
                              <li key={i} className="text-caption text-text-secondary flex items-start gap-1.5">
                                <span className="text-info mt-0.5">•</span>
                                <span>{topic}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {lastMeetingResult.conclusions && (
                        <div className="space-y-1">
                          <p className="text-caption text-text-dim font-medium">{t("meeting.conclusions")}</p>
                          <p className="text-caption text-text-secondary leading-relaxed">{lastMeetingResult.conclusions}</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-caption text-text-dim italic text-center py-2">{t("meeting.noSummary")}</p>
                  )}
                </div>

                {/* Divider */}
                <div className="border-t border-border" />

                {/* New meeting form */}
                <div className="space-y-3">
                  <h4 className="text-title text-text-secondary text-center">{t("meeting.newMeeting")}</h4>
                  {renderMeetingStartForm()}
                </div>
              </div>

              {/* Fixed bottom bar */}
              <div className="px-4 py-3 border-t border-border bg-surface/80 flex items-center gap-2 flex-shrink-0">
                <div className="relative">
                  <button
                    onClick={() => setShowExportMenu((v) => !v)}
                    className="px-3 py-2 rounded text-caption font-semibold bg-surface-raised hover:bg-surface-raised text-text-secondary border border-border"
                  >
                    {t("meeting.export")}
                  </button>
                  {showExportMenu && (
                    <div className="absolute bottom-full left-0 mb-1 bg-surface border border-border rounded-lg shadow-lg py-1 min-w-[140px] z-10">
                      <button
                        onClick={async () => {
                          if (!lastMeetingResult.minutesId) return;
                          try {
                            const res = await fetch(`/api/channels/${channelId}/minutes/${lastMeetingResult.minutesId}`);
                            const data = await res.json();
                            if (data.markdown) {
                              const blob = new Blob([data.markdown], { type: "text/markdown" });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `meeting-${lastMeetingResult.topic.slice(0, 30)}.md`;
                              a.click();
                              URL.revokeObjectURL(url);
                            }
                          } catch { /* ignore */ }
                          setShowExportMenu(false);
                        }}
                        className="w-full px-3 py-1.5 text-left text-caption text-text-secondary hover:bg-surface-raised"
                      >
                        {t("meeting.exportMd")}
                      </button>
                      <button
                        onClick={async () => {
                          if (!lastMeetingResult.minutesId) return;
                          try {
                            const res = await fetch(`/api/channels/${channelId}/minutes/${lastMeetingResult.minutesId}`);
                            const data = await res.json();
                            if (data.markdown) {
                              await navigator.clipboard.writeText(data.markdown);
                            }
                          } catch { /* ignore */ }
                          setShowExportMenu(false);
                        }}
                        className="w-full px-3 py-1.5 text-left text-caption text-text-secondary hover:bg-surface-raised"
                      >
                        {t("meeting.exportClipboard")}
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    setMeetingEnded(false);
                    setLastMeetingResult(null);
                    setMessages([]);
                    handleStartDiscussion();
                  }}
                  disabled={!meetingTopic.trim() || startingMeeting || selectedNpcIds.size === 0}
                  className={`flex-1 px-4 py-2 rounded font-semibold text-body ${
                    meetingTopic.trim() && !startingMeeting && selectedNpcIds.size > 0
                      ? "bg-primary hover:bg-primary-hover text-white"
                      : "bg-surface-raised text-text-dim cursor-not-allowed"
                  }`}
                >
                  {t("meeting.startDiscussion")}
                </button>
              </div>
            </div>
          ) : (
            /* ---- Pre-meeting view ---- */
            <div className="flex-1 flex flex-col min-h-0">
              {/* Existing messages area */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
                {messages.length === 0 ? (
                  <div className="text-text-dim text-body italic py-4 text-center">
                    {t("meeting.noMessages")}
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isMe = msg.senderId === socket?.id;
                    const isNpc = msg.senderType === "npc";
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                      >
                        <div className="max-w-[85%]">
                          {!isMe && (
                            <div
                              className={`text-micro font-medium mb-0.5 ${
                                isNpc ? "text-npc" : "text-text-muted"
                              }`}
                            >
                              {msg.sender}
                            </div>
                          )}
                          <div
                            className={`px-3 py-2 rounded-lg text-body ${
                              isMe
                                ? "bg-primary text-white"
                                : isNpc
                                  ? "bg-surface-raised text-text border border-npc/30"
                                  : "bg-surface-raised text-text"
                            }`}
                          >
                            {msg.content}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Topic input form */}
              <div className="px-4 py-4 border-t border-border bg-surface/60 flex-shrink-0">
                <div className="bg-surface rounded-lg p-4 flex flex-col gap-3 border border-border">
                  <p className="text-body text-text-muted font-medium text-center">
                    {t("meeting.discussionIntro")}
                  </p>
                  {renderMeetingStartForm()}
                  <button
                    onClick={handleStartDiscussion}
                    disabled={!meetingTopic.trim() || startingMeeting || selectedNpcIds.size === 0}
                    className={`w-full px-4 py-2 rounded font-semibold text-body ${
                      meetingTopic.trim() && !startingMeeting && selectedNpcIds.size > 0
                        ? "bg-primary hover:bg-primary-hover text-white"
                        : "bg-surface-raised text-text-dim cursor-not-allowed"
                    }`}
                  >
                    {startingMeeting ? t("meeting.starting") : t("meeting.startDiscussion")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {showMinutesModal && (
        <MinutesModal channelId={channelId} onClose={() => setShowMinutesModal(false)} />
      )}
    </div>
  );
}
