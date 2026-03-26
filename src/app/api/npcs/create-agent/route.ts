import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { channels } from "@/db";
import { eq } from "drizzle-orm";
import { PERSONA_PRESETS } from "@/lib/npc-persona-presets";
import { internalRpc, getUserId } from "@/lib/internal-rpc";
import { injectTaskPrompt } from "@/lib/task-prompt";

export async function POST(req: NextRequest) {
  try {
    const userId = getUserId(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { channelId, agentId, identity, soul } = await req.json();

    if (!channelId || !agentId?.trim()) {
      return NextResponse.json({ error: "Missing channelId or agentId" }, { status: 400 });
    }

    const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    if (channel.ownerId !== userId) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

    // Create agent via RPC
    await internalRpc(channelId, "agents.create", { name: agentId.trim(), workspace: `/workspace/${agentId.trim()}` });

    // Write persona files (with task protocol injection)
    if (identity?.trim()) {
      await internalRpc(channelId, "agents.files.set", {
        agentId: agentId.trim(),
        name: "IDENTITY.md",
        content: injectTaskPrompt(identity.trim()),
      });
    }
    if (soul?.trim()) {
      await internalRpc(channelId, "agents.files.set", {
        agentId: agentId.trim(),
        name: "SOUL.md",
        content: soul.trim(),
      });
    }

    // Write meeting protocol if available
    const defaultMeetingProtocol = PERSONA_PRESETS[0]?.meetingProtocol || "";
    if (defaultMeetingProtocol) {
      await internalRpc(channelId, "agents.files.set", {
        agentId: agentId.trim(),
        name: "AGENTS.md",
        content: defaultMeetingProtocol,
      });
    }

    return NextResponse.json({ success: true, agentId: agentId.trim() });
  } catch (err) {
    console.error("Failed to create agent:", err);
    const message = err instanceof Error ? err.message : "Failed to create agent";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
