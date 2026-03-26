import { db } from "@/db";
import { meetingMinutes, channelMembers, channels } from "@/db";
import { NextRequest, NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { getUserId } from "@/lib/internal-rpc";

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const channelId = req.nextUrl.searchParams.get("channelId");
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 });

  // Verify channel membership
  const [channel] = await db.select({ ownerId: channels.ownerId }).from(channels).where(eq(channels.id, channelId)).limit(1);
  if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });

  const isOwner = channel.ownerId === userId;
  if (!isOwner) {
    const [member] = await db.select({ role: channelMembers.role }).from(channelMembers)
      .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId))).limit(1);
    if (!member) return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  try {
    const rows = await db.select({
      id: meetingMinutes.id,
      topic: meetingMinutes.topic,
      totalTurns: meetingMinutes.totalTurns,
      durationSeconds: meetingMinutes.durationSeconds,
      participants: meetingMinutes.participants,
      keyTopics: meetingMinutes.keyTopics,
      createdAt: meetingMinutes.createdAt,
    }).from(meetingMinutes)
      .where(eq(meetingMinutes.channelId, channelId))
      .orderBy(desc(meetingMinutes.createdAt))
      .limit(50);

    return NextResponse.json({ minutes: rows });
  } catch (err) {
    console.error("Failed to fetch meetings:", err);
    return NextResponse.json({ error: "Failed to fetch meetings" }, { status: 500 });
  }
}
