import { db } from "@/db";
import { channels, channelMembers } from "@/db";
import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";

function getUserId(req: NextRequest): string | null {
  return req.headers.get("x-user-id");
}

// DELETE /api/channels/:id/members/:userId — kick member (owner only)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const currentUserId = getUserId(req);
  if (!currentUserId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: channelId, userId: targetUserId } = await params;

  try {
    const [channel] = await db
      .select({ ownerId: channels.ownerId })
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);

    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    if (channel.ownerId !== currentUserId) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

    if (targetUserId === currentUserId) {
      return NextResponse.json({ error: "Cannot kick the owner" }, { status: 400 });
    }

    const deleted = await db
      .delete(channelMembers)
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, targetUserId)))
      .returning();

    if (deleted.length === 0) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    try {
      const socketPort = (parseInt(process.env.PORT || "3000", 10)) + 1;
      await fetch(`http://localhost:${socketPort}/_internal/emit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "member:kicked",
          targetUserId,
          payload: { channelId, reason: "kicked" },
        }),
      });
    } catch {}

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to kick member:", err);
    return NextResponse.json({ error: "Failed to kick member" }, { status: 500 });
  }
}
