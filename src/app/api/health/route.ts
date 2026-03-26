import { db } from "@/db";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

const startTime = Date.now();

export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({
      status: "ok",
      db: "connected",
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  } catch {
    return NextResponse.json(
      { status: "error", db: "disconnected" },
      { status: 503 }
    );
  }
}
