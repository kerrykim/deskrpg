// migrate.js — Runs SQL migration files in order on startup
// Tracks applied migrations in a _migrations table to avoid re-running.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const MIGRATIONS_DIR = path.join(__dirname, "drizzle");

async function migrate() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log("[migrate] No DATABASE_URL — skipping migrations.");
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    // Create tracking table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Get already-applied migrations
    const { rows: applied } = await pool.query("SELECT name FROM _migrations ORDER BY name");
    const appliedSet = new Set(applied.map((r) => r.name));

    // Find SQL files, sorted by name
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let count = 0;
    for (const file of files) {
      if (appliedSet.has(file)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
      console.log(`[migrate] Applying ${file}...`);

      try {
        await pool.query(sql);
        await pool.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
        count++;
      } catch (err) {
        // Tolerate "already exists" errors for idempotent migrations
        if (err.code === "42P07" || err.code === "42701" || err.code === "42710") {
          console.log(`[migrate] ${file}: already applied (marking as done)`);
          await pool.query("INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", [file]);
        } else {
          console.error(`[migrate] ${file} FAILED:`, err.message);
          throw err;
        }
      }
    }

    console.log(`[migrate] Done. ${count} new migration(s) applied, ${appliedSet.size} already applied.`);
  } finally {
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error("[migrate] Fatal error:", err);
  process.exit(1);
});
