// scripts/seed-channel.ts
// Usage: npx dotenv -e .env.local -- npx tsx scripts/seed-channel.ts

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

async function seed() {
  console.log("Seeding default channel...");

  // Find the owner user — prefer 'dante', fallback to first user
  let users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.nickname, "dante"))
    .limit(1);

  if (users.length === 0) {
    users = await db.select().from(schema.users).limit(1);
  }

  if (users.length === 0) {
    console.error("No users found. Create a user first.");
    await pool.end();
    process.exit(1);
  }

  const ownerId = users[0].id;
  console.log(`  Owner: dante (${ownerId})`);

  // Upsert the default channel
  const existing = await db
    .select()
    .from(schema.channels)
    .where(eq(schema.channels.inviteCode, "office01"))
    .limit(1);

  let channelId: string;

  if (existing.length > 0) {
    channelId = existing[0].id;
    await db
      .update(schema.channels)
      .set({
        name: "DeskRPG Office",
        description: "The default office space",
        ownerId,
        isPublic: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.channels.id, channelId));
    console.log(`  Updated existing channel: ${channelId}`);
  } else {
    const [channel] = await db
      .insert(schema.channels)
      .values({
        name: "DeskRPG Office",
        description: "The default office space",
        ownerId,
        isPublic: true,
        inviteCode: "office01",
        maxPlayers: 50,
        mapData: null, // uses default buildOfficeMap()
        mapConfig: null,
      })
      .returning();
    channelId = channel.id;
    console.log(`  Created channel: ${channelId}`);
  }

  // Update existing NPCs to reference this channel
  const npcs = await db.select().from(schema.npcs);
  for (const npc of npcs) {
    if (!npc.channelId) {
      await db
        .update(schema.npcs)
        .set({ channelId })
        .where(eq(schema.npcs.id, npc.id));
      console.log(`  Linked NPC '${npc.name}' to channel`);
    }
  }

  console.log("Done!");
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  pool.end();
  process.exit(1);
});
