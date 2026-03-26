import { db } from "@/db";
import { channels, channelMembers } from "@/db";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

function getUserId(req: NextRequest): string | null {
  return req.headers.get("x-user-id");
}

// GET /api/channels/join/:code — resolve invite code to channel
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { code } = await params;

  try {
    const rows = await db
      .select({
        id: channels.id,
        name: channels.name,
        description: channels.description,
        isPublic: channels.isPublic,
      })
      .from(channels)
      .where(eq(channels.inviteCode, code))
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json({ error: "Invalid invite code" }, { status: 404 });
    }

    const channel = rows[0];

    // Public channels: auto-register as member
    // Private channels: only resolve — user must enter password via /api/channels/[id]/join
    if (channel.isPublic) {
      await db
        .insert(channelMembers)
        .values({ channelId: channel.id, userId, role: "member" })
        .onConflictDoNothing();
    }

    return NextResponse.json({ channel });
  } catch (err) {
    console.error("Failed to resolve invite code:", err);
    return NextResponse.json({ error: "Failed to resolve invite code" }, { status: 500 });
  }
}
