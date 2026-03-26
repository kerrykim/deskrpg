import { NextRequest, NextResponse } from "next/server";
import { db, jsonForDb } from "@/db";
import { npcs, channels } from "@/db";
import { eq, count } from "drizzle-orm";
import { getUserId } from "@/lib/internal-rpc";
// @ts-ignore
import { injectTaskPrompt } from "@/lib/task-prompt";

export async function GET(req: NextRequest) {
  try {
    const channelId = req.nextUrl.searchParams.get("channelId");
    let rows;
    if (channelId) {
      rows = await db.select().from(npcs).where(eq(npcs.channelId, channelId));
    } else {
      rows = await db.select().from(npcs);
    }
    const result = rows.map((npc) => ({
      id: npc.id,
      name: npc.name,
      positionX: npc.positionX,
      positionY: npc.positionY,
      direction: npc.direction,
      appearance: npc.appearance,
      hasAgent: !!(npc.openclawConfig as Record<string, unknown> | null)?.agentId,
      agentId: ((npc.openclawConfig as Record<string, unknown> | null)?.agentId as string) || null,
    }));
    return NextResponse.json({ npcs: result });
  } catch (err) {
    console.error("Failed to fetch NPCs:", err);
    return NextResponse.json({ error: "Failed to fetch NPCs" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const {
      channelId, name, persona, appearance, positionX, positionY, direction,
      agentId, agentAction, identity, soul,
    } = body;

    if (!channelId || !name?.trim() || !appearance || positionX == null || positionY == null) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // At least persona or identity must be provided (unless selecting existing agent)
    if (!persona?.trim() && !identity?.trim() && agentAction !== "select") {
      return NextResponse.json({ error: "Missing persona or identity" }, { status: 400 });
    }

    // Verify channel ownership
    const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    if (channel.ownerId !== userId) return NextResponse.json({ error: "Only channel owner can hire NPCs" }, { status: 403 });

    // Check NPC count limit (max 10)
    const [{ value: npcCount }] = await db.select({ value: count() }).from(npcs).where(eq(npcs.channelId, channelId));
    if (npcCount >= 10) {
      return NextResponse.json({ error: "Maximum 10 NPCs per channel" }, { status: 400 });
    }

    // Build openclawConfig based on agent action
    let openclawConfig: Record<string, unknown>;

    if (agentAction === "create" && agentId) {
      // Agent was already created via /api/npcs/create-agent
      openclawConfig = {
        agentId,
        sessionKeyPrefix: `ot-${channelId.slice(0, 8)}-${agentId}`,
        personaConfig: {
          identity: injectTaskPrompt(identity?.trim() || persona?.trim() || ""),
          soul: soul?.trim() || "",
        },
      };
    } else if (agentAction === "select" && agentId) {
      // Select an existing agent on the gateway
      openclawConfig = {
        agentId,
        sessionKeyPrefix: `ot-${channelId.slice(0, 8)}-${agentId}`,
      };
    } else {
      // No agent — backward compat: store persona in openclawConfig
      const identityText = identity?.trim() || persona?.trim() || "";
      openclawConfig = {
        agentId: null,
        sessionKeyPrefix: "",
        persona: identityText.slice(0, 500), // backward compat
        ...(identityText ? {
          personaConfig: {
            identity: injectTaskPrompt(identityText),
            soul: soul?.trim() || "",
          },
        } : {}),
      };
    }

    // Insert NPC
    const [npc] = await db.insert(npcs).values({
      channelId,
      name: name.trim().slice(0, 100),
      positionX,
      positionY,
      direction: ["up", "down", "left", "right"].includes(direction) ? direction : "down",
      appearance: jsonForDb(appearance),
      openclawConfig: jsonForDb(openclawConfig),
    }).returning();

    return NextResponse.json({ npc }, { status: 201 });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
      return NextResponse.json({ error: "This tile is already occupied" }, { status: 409 });
    }
    console.error("Failed to create NPC:", err);
    return NextResponse.json({ error: "Failed to create NPC" }, { status: 500 });
  }
}
