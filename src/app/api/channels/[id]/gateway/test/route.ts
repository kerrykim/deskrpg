import { db } from "@/db";
import { channels } from "@/db";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { internalRpc, getUserId } from "@/lib/internal-rpc";

// POST /api/channels/:id/gateway/test — owner-only, tests gateway connection
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  // Verify ownership
  const [channel] = await db
    .select({ ownerId: channels.ownerId })
    .from(channels)
    .where(eq(channels.id, id))
    .limit(1);

  if (!channel) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (channel.ownerId !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    const result = await internalRpc(id, "agents.list");
    return NextResponse.json({
      ok: true,
      agents: result.agents || [],
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : "Connection failed",
    });
  }
}
