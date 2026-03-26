import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { npcs, channels } from "@/db";
import { eq } from "drizzle-orm";
import { internalRpc, getUserId } from "@/lib/internal-rpc";
import { injectTaskPrompt } from "@/lib/task-prompt";

async function verifyNpcOwnership(req: NextRequest, npcId: string) {
  const userId = getUserId(req);
  if (!userId) return { error: "Unauthorized", status: 401 };

  const [npc] = await db.select().from(npcs).where(eq(npcs.id, npcId));
  if (!npc) return { error: "NPC not found", status: 404 };

  const [channel] = await db.select().from(channels).where(eq(channels.id, npc.channelId));
  if (!channel || channel.ownerId !== userId) {
    return { error: "Only channel owner can modify NPCs", status: 403 };
  }

  return { npc, channel, userId };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await verifyNpcOwnership(req, id);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

    const { npc, channel } = result;
    const body = await req.json();
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.name?.trim()) updates.name = body.name.trim().slice(0, 100);
    if (body.appearance) updates.appearance = body.appearance;

    // Handle persona/identity/soul updates
    const existingConfig = (npc.openclawConfig as Record<string, unknown> | null) || {};
    const existingAgentId = existingConfig.agentId as string | null;

    // Handle agent connection change
    if (body.agentAction === "select" && body.agentId) {
      updates.openclawConfig = {
        ...existingConfig,
        agentId: body.agentId,
        sessionKeyPrefix: `ot-${id.slice(0, 8)}-${body.agentId}`,
      };
    } else if (body.agentAction === "create" && body.agentId) {
      // Create agent via RPC
      await internalRpc(npc.channelId, "agents.create", { name: body.agentId, workspace: `/workspace/${body.agentId}` });

      // Write persona files
      if (body.identity?.trim()) {
        await internalRpc(npc.channelId, "agents.files.set", {
          agentId: body.agentId,
          name: "IDENTITY.md",
          content: injectTaskPrompt(body.identity.trim()),
        });
      }
      if (body.soul?.trim()) {
        await internalRpc(npc.channelId, "agents.files.set", {
          agentId: body.agentId,
          name: "SOUL.md",
          content: body.soul.trim(),
        });
      }

      updates.openclawConfig = {
        ...existingConfig,
        agentId: body.agentId,
        sessionKeyPrefix: `ot-${id.slice(0, 8)}-${body.agentId}`,
        personaConfig: { identity: injectTaskPrompt(body.identity?.trim() || ""), soul: body.soul?.trim() || "" },
      };
    }

    if (body.passPolicy !== undefined) {
      const currentConfig = (updates.openclawConfig as Record<string, unknown>) || existingConfig;
      updates.openclawConfig = {
        ...currentConfig,
        passPolicy: body.passPolicy?.trim() || null,
      };

      // Also write to IDENTITY.md if agent exists
      if (existingAgentId && body.passPolicy?.trim()) {
        try {
          let identityContent = "";
          try {
            const currentIdentity = await internalRpc(npc.channelId, "agents.files.get", {
              agentId: existingAgentId, name: "IDENTITY.md",
            });
            identityContent = (currentIdentity as { content?: string })?.content || "";
          } catch { /* file may not exist yet */ }

          const sectionHeader = "## 회의 행동 가이드";
          const newSection = `${sectionHeader}\n${body.passPolicy.trim()}`;
          const updated = identityContent.includes(sectionHeader)
            ? identityContent.replace(/## 회의 행동 가이드[\s\S]*?(?=\n## |$)/, newSection)
            : identityContent + "\n\n" + newSection;

          await internalRpc(npc.channelId, "agents.files.set", {
            agentId: existingAgentId, name: "IDENTITY.md", content: updated,
          });
        } catch (err) {
          console.warn("Failed to update IDENTITY.md with pass policy:", err);
        }
      }
    }

    if (body.identity !== undefined || body.soul !== undefined || body.persona !== undefined) {
      const newIdentity = body.identity?.trim() ?? body.persona?.trim() ?? "";
      const newSoul = body.soul?.trim() ?? "";

      // If NPC has an agent and identity/soul changed, update on gateway via RPC
      if (existingAgentId && (body.identity !== undefined || body.soul !== undefined)) {
        try {
          if (newIdentity) {
            await internalRpc(npc.channelId, "agents.files.set", {
              agentId: existingAgentId,
              name: "IDENTITY.md",
              content: injectTaskPrompt(newIdentity),
            });
          }
          if (newSoul) {
            await internalRpc(npc.channelId, "agents.files.set", {
              agentId: existingAgentId,
              name: "SOUL.md",
              content: newSoul,
            });
          }
        } catch (err) {
          console.warn("Failed to update persona files on gateway:", err);
        }
      }

      // Update openclawConfig in DB
      updates.openclawConfig = {
        ...existingConfig,
        persona: newIdentity.slice(0, 500), // backward compat
        personaConfig: {
          identity: injectTaskPrompt(newIdentity),
          soul: newSoul,
        },
      };
    }

    const [updated] = await db.update(npcs).set(updates).where(eq(npcs.id, id)).returning();
    return NextResponse.json({ npc: updated });
  } catch (err) {
    console.error("Failed to update NPC:", err);
    return NextResponse.json({ error: "Failed to update NPC" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await verifyNpcOwnership(req, id);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

    const { npc } = result;

    // If NPC has an agent, remove it from the gateway via RPC
    const openclawConfig = npc.openclawConfig as Record<string, unknown> | null;
    const agentId = openclawConfig?.agentId as string | null;

    if (agentId) {
      try {
        await internalRpc(npc.channelId, "agents.delete", { agentId, deleteFiles: true });
      } catch (err) {
        console.warn(`Failed to remove agent ${agentId} from gateway (proceeding with NPC deletion):`, err);
      }
    }

    await db.delete(npcs).where(eq(npcs.id, id));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to delete NPC:", err);
    return NextResponse.json({ error: "Failed to delete NPC" }, { status: 500 });
  }
}
