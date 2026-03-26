import { db } from "@/db";
import { meetingMinutes, channelMembers, channels } from "@/db";
import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { getUserId } from "@/lib/internal-rpc";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const [row] = await db.select().from(meetingMinutes).where(eq(meetingMinutes.id, id)).limit(1);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Verify channel membership
    const [channel] = await db.select({ ownerId: channels.ownerId }).from(channels).where(eq(channels.id, row.channelId)).limit(1);
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

    const isOwner = channel.ownerId === userId;
    if (!isOwner) {
      const [member] = await db.select({ role: channelMembers.role }).from(channelMembers)
        .where(and(eq(channelMembers.channelId, row.channelId), eq(channelMembers.userId, userId))).limit(1);
      if (!member) return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }

    return NextResponse.json({ minutes: row });
  } catch (err) {
    console.error("Failed to fetch meeting:", err);
    return NextResponse.json({ error: "Failed to fetch meeting" }, { status: 500 });
  }
}
