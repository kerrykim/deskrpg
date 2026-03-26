import { NextRequest, NextResponse } from "next/server";

function getUserId(req: NextRequest): string | null {
  return req.headers.get("x-user-id");
}

// POST /api/channels/test-gateway — validate gateway config (actual connection test happens after channel creation)
export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ ok: false, agents: [], error: "Gateway URL is required" });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ ok: false, agents: [], error: "Invalid gateway URL format" });
    }

    // Config looks valid — actual connection test will happen after channel creation via RPC
    return NextResponse.json({
      ok: true,
      agents: [],
      message: "Gateway config validated. Connection will be established when channel is created.",
    });
  } catch (err) {
    console.error("Gateway validation failed:", err);
    return NextResponse.json({
      ok: false,
      agents: [],
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}
