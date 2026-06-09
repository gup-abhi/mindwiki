#!/bin/sh
# wrangler dev reads Worker vars/secrets from .dev.vars (not the process env), so
# materialize it from the JWT_SECRET environment variable Coolify injects.
set -e

if [ -z "$JWT_SECRET" ]; then
  echo "FATAL: JWT_SECRET env var is required" >&2
  exit 1
fi

printf 'JWT_SECRET=%s\n' "$JWT_SECRET" > /app/.dev.vars

# Bind 0.0.0.0 for the proxy; non-interactive for a headless container.
# KV + R2 persist under /app/.wrangler/state (mount a volume at /app/.wrangler).
exec node_modules/.bin/wrangler dev \
  --ip 0.0.0.0 \
  --port 8787 \
  --show-interactive-dev-session=false
