import { db } from "@/db";
import { channels } from "@/db";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getUserId } from "@/lib/internal-rpc";

// GET /api/channels/:id/gateway — owner-only, returns full gatewayConfig
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const [channel] = await db
    .select({ ownerId: channels.ownerId, gatewayConfig: channels.gatewayConfig })
    .from(channels)
    .where(eq(channels.id, id))
    .limit(1);

  if (!channel) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (channel.ownerId !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const gc = channel.gatewayConfig as Record<string, unknown> | null;
  return NextResponse.json({
    gatewayConfig: gc ? { url: gc.url ?? null, token: gc.token ?? null } : null,
  });
}

// PUT /api/channels/:id/gateway — owner-only, saves gatewayConfig
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const [channel] = await db
    .select({ ownerId: channels.ownerId })
    .from(channels)
    .where(eq(channels.id, id))
    .limit(1);

  if (!channel) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (channel.ownerId !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const { url, token } = body as { url?: string; token?: string };

  const gatewayConfig = {
    url: typeof url === "string" ? url.trim() || null : null,
    token: typeof token === "string" ? token.trim() || null : null,
  };

  await db
    .update(channels)
    .set({ gatewayConfig, updatedAt: new Date() })
    .where(eq(channels.id, id));

  // Emit cache invalidation via internal socket endpoint (non-critical)
  try {
    const socketPort = (parseInt(process.env.PORT ?? "3000") + 1).toString();
    await fetch(`http://localhost:${socketPort}/_internal/emit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "gateway:config-updated",
        room: id,
        payload: { channelId: id },
      }),
    });
  } catch {
    console.warn("Failed to emit gateway:config-updated socket event");
  }

  return NextResponse.json({ ok: true });
}
