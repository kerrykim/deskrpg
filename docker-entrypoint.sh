#!/bin/sh
set -e

# Auto-migrate: run SQL migrations via Node.js before starting the server
if [ -d "/app/drizzle" ] && [ "$DB_TYPE" != "sqlite" ]; then
  node /app/migrate.js
fi

exec node server.js
