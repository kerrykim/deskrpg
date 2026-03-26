import { NextResponse } from "next/server";
import { NPC_PRESETS } from "@/lib/npc-presets";

export async function GET() {
  return NextResponse.json({ presets: NPC_PRESETS });
}
