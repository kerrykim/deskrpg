# DeskRPG

2D pixel art multiplayer virtual office game. Create LPC characters, join channels, walk around, chat with AI NPCs, and communicate with other players in real-time.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router) |
| Game Engine | Phaser.js 3 (WebGL, arcade physics) |
| ORM | Drizzle ORM |
| Database | PostgreSQL 16 (default) / SQLite (lite mode) |
| Real-time | Socket.io |
| Auth | JWT (jose) + bcryptjs |
| AI | OpenRouter API via OpenClaw Gateway |
| Deploy | Docker Compose + Caddy |

## Quick Start

### With Docker (PostgreSQL) — Recommended

```bash
git clone https://github.com/dandacompany/deskrpg.git
cd deskrpg
npm install
cp .env.example .env.local
npm run setup                 # starts PostgreSQL + syncs schema
npm run dev                   # http://localhost:3000
```

### Without Docker (SQLite)

No Docker? No problem. Run with SQLite instead.

```bash
git clone https://github.com/dandacompany/deskrpg.git
cd deskrpg
npm install
npm run setup:lite            # configures SQLite + syncs schema
npm run dev                   # http://localhost:3000
```

> For production, change `JWT_SECRET` in `.env.local` to a random string (`openssl rand -hex 32`).

## Database

### PostgreSQL (Default)

The default mode. Schema is defined in `src/db/schema.ts`.

```bash
# Interactive schema sync (prompts for destructive changes)
npm run db:push

# Force schema sync (no prompts — use for fresh DBs)
npm run db:setup

# Open Drizzle Studio (browser DB explorer)
npm run db:studio

# Generate SQL migration files
npm run db:migrate
```

### SQLite (Lite Mode)

For lightweight self-hosting without a separate database server.

```bash
DB_TYPE=sqlite npm run dev
```

Schema: `src/db/schema-sqlite.ts`. Data stored in `data/deskrpg.db`.

## Docker Deployment

### Full Stack (PostgreSQL + App + SSH Tunnel)

```bash
docker compose up -d --build
```

Ports: App `3102:3000`, Socket `3103:3001`, DB `5437:5432`

Database migrations run automatically on container startup.

### Deployment Profiles

Three Docker Compose profiles are available in `docker/`:

| File | Description |
|------|-------------|
| `docker/docker-compose.yml` | Full stack with PostgreSQL + SSH tunnel proxy |
| `docker/docker-compose.external.yml` | PostgreSQL only (bring your own gateway) |
| `docker/docker-compose.lite.yml` | SQLite mode (no DB container needed) |

```bash
# SQLite-only deployment
docker compose -f docker/docker-compose.lite.yml up -d --build
```

## Project Structure

```
src/
├── app/
│   ├── api/           # REST API routes (auth, channels, characters, npcs, etc.)
│   ├── game/          # Main game page (Phaser + chat UI)
│   ├── channels/      # Channel list, create, join
│   ├── characters/    # Character select + create (LPC customizer)
│   └── auth/          # Login / register
├── components/        # React components (ChatPanel, NpcHireModal, MeetingRoom, etc.)
├── game/
│   ├── EventBus.ts    # Phaser <-> React event bridge
│   └── scenes/        # BootScene, GameScene
├── lib/               # Utilities (sprite compositor, JWT, i18n, etc.)
├── db/
│   ├── schema.ts      # PostgreSQL Drizzle schema
│   ├── schema-sqlite.ts  # SQLite Drizzle schema
│   ├── index.ts       # DB connection (auto-selects PG/SQLite via DB_TYPE)
│   ├── server-db.js   # CJS Drizzle wrapper for server.js
│   └── normalize.js   # JSON field PG/SQLite compatibility
server.js              # Custom server: Next.js standalone + Socket.io
migrate.js             # Auto-migration runner (Docker startup)
docker-compose.yml     # Production deployment
```

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run setup` | Start PostgreSQL (Docker) + sync schema |
| `npm run setup:lite` | Configure SQLite mode + sync schema (no Docker) |
| `npm run dev` | Start dev server (Next.js + Socket.io) |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm run db:push` | Sync schema to DB (interactive) |
| `npm run db:setup` | Sync schema to DB (force, no prompts) |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run db:migrate` | Generate migration SQL files |
| `npm run lint` | Run ESLint |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes (PG mode) | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | Secret for JWT signing |
| `DB_TYPE` | No | `postgresql` | Database type: `postgresql` or `sqlite` |
| `SQLITE_PATH` | No | `data/deskrpg.db` | SQLite database file path |
| `OPENCLAW_WS_URL` | No | — | OpenClaw gateway WebSocket URL |
| `OPENCLAW_TOKEN` | No | — | OpenClaw gateway auth token |

## License

See [LICENSE](LICENSE) for details.
