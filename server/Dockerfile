# Runs the Cloudflare Worker via `wrangler dev` (Miniflare) inside a container so
# Coolify can manage it (TLS, domain, restarts). NOT a production edge deploy —
# see docs/SELF_HOSTING.md. KV + R2 persist to /app/.wrangler — mount a Coolify
# persistent volume there or accounts are lost on every redeploy.
FROM node:22-slim

WORKDIR /app

# Install deps first for layer caching. wrangler is a devDependency, so install
# the full tree (do not set NODE_ENV=production here).
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# wrangler must bind 0.0.0.0 so Coolify's proxy can reach the container.
EXPOSE 8787

# Don't phone home from a server.
ENV WRANGLER_SEND_METRICS=false

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]
