import { db, jsonForDb, isPostgres } from "@/db";
import { characters } from "@/db";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { validateAppearance } from "@/lib/lpc-registry";

function getUserId(req: NextRequest): string | null {
  return req.headers.get("x-user-id");
}

const MAX_CHARACTERS = 5;

export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await db
    .select()
    .from(characters)
    .where(eq(characters.userId, userId))
    .orderBy(characters.createdAt);

  const parsed = isPostgres ? result : result.map((c) => ({
    ...c,
    appearance: typeof c.appearance === "string" ? JSON.parse(c.appearance) : c.appearance,
  }));
  return NextResponse.json({ characters: parsed });
}

export async function POST(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, appearance } = body;

  if (!name || !appearance) {
    return NextResponse.json({ error: "name and appearance are required" }, { status: 400 });
  }

  if (name.length < 1 || name.length > 50) {
    return NextResponse.json({ error: "name must be 1-50 characters" }, { status: 400 });
  }

  const existing = await db
    .select()
    .from(characters)
    .where(eq(characters.userId, userId));

  if (existing.length >= MAX_CHARACTERS) {
    return NextResponse.json({ error: `maximum ${MAX_CHARACTERS} characters allowed` }, { status: 400 });
  }

  const validationError = validateAppearance(appearance);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const [character] = await db
    .insert(characters)
    .values({ userId, name, appearance: jsonForDb(appearance) })
    .returning();

  return NextResponse.json({ character }, { status: 201 });
}
