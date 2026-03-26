import { db } from "@/db";
import { channels, channelMembers } from "@/db";
import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { verifyPassword } from "@/lib/password";

function getUserId(req: NextRequest): string | null {
  return req.headers.get("x-user-id");
}

// POST /api/channels/:id/join
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    // Check if channel exists
    const [channel] = await db
      .select()
      .from(channels)
      .where(eq(channels.id, id))
      .limit(1);

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    // Check if already a member
    const [existing] = await db
      .select()
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, id), eq(channelMembers.userId, userId)))
      .limit(1);

    if (existing) {
      return NextResponse.json({
        channel: { id: channel.id, name: channel.name, description: channel.description },
      });
    }

    // Private channel: require password
    if (!channel.isPublic) {
      const body = await req.json().catch(() => ({}));
      const { password } = body;

      if (!password || typeof password !== "string") {
        return NextResponse.json({ error: "password_required" }, { status: 401 });
      }

      if (!channel.password) {
        return NextResponse.json({ error: "Channel misconfigured" }, { status: 500 });
      }

      const valid = await verifyPassword(password, channel.password);
      if (!valid) {
        return NextResponse.json({ error: "wrong_password" }, { status: 401 });
      }
    }

    // Register as member
    await db.insert(channelMembers).values({
      channelId: id,
      userId,
      role: "member",
    });

    return NextResponse.json({
      channel: { id: channel.id, name: channel.name, description: channel.description },
    });
  } catch (err) {
    console.error("Failed to join channel:", err);
    return NextResponse.json({ error: "Failed to join channel" }, { status: 500 });
  }
}
