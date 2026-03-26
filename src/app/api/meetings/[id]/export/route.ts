import { db } from "@/db";
import { meetingMinutes } from "@/db";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getUserId } from "@/lib/internal-rpc";

function formatMinutesMarkdown(m: {
  topic: string;
  createdAt: Date;
  participants: unknown;
  totalTurns: number;
  durationSeconds: number | null;
  keyTopics: unknown;
  conclusions: string | null;
  transcript: string;
}): string {
  const participants = (m.participants as { name: string }[]) || [];
  const keyTopics = (m.keyTopics as string[]) || [];
  const duration = m.durationSeconds
    ? `${Math.floor(m.durationSeconds / 60)}분 ${m.durationSeconds % 60}초`
    : "N/A";

  let md = `# 회의록: ${m.topic}\n\n`;
  md += `**날짜:** ${new Date(m.createdAt).toLocaleString("ko-KR")}\n`;
  md += `**참가자:** ${participants.map(p => p.name).join(", ")}\n`;
  md += `**총 턴:** ${m.totalTurns} | **소요 시간:** ${duration}\n\n`;

  if (keyTopics.length > 0) {
    md += `## 📌 주요 주제\n`;
    keyTopics.forEach(t => { md += `- ${t}\n`; });
    md += "\n";
  }

  if (m.conclusions) {
    md += `## ✅ 결론\n${m.conclusions}\n\n`;
  }

  md += `## 💬 전체 대화\n${m.transcript}\n`;
  return md;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const format = req.nextUrl.searchParams.get("format") || "md";

  try {
    const [row] = await db.select().from(meetingMinutes).where(eq(meetingMinutes.id, id)).limit(1);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const markdown = formatMinutesMarkdown(row);

    if (format === "clipboard") {
      return NextResponse.json({ text: markdown });
    }

    // Default: markdown download
    return new NextResponse(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="meeting-${id.slice(0, 8)}.md"`,
      },
    });
  } catch (err) {
    console.error("Failed to export meeting:", err);
    return NextResponse.json({ error: "Failed to export meeting" }, { status: 500 });
  }
}
