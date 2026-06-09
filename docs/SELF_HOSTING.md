# Self-hosting the sync server with Coolify (Miniflare in a container)

> For **testing the app against a persistent, internet-reachable backend you
> control** — not a production Cloudflare deploy. The server is a Cloudflare
> Worker; here it runs via `wrangler dev` (Miniflare) inside a container that
> Coolify manages (TLS, domain, restarts). For the real edge deploy, see
> [SERVER.md](./SERVER.md).

## Architecture

```
phone ──HTTPS──▶ Coolify proxy (Traefik, your domain, auto Let's Encrypt)
                   └─▶ container: wrangler dev / Miniflare (0.0.0.0:8787)
                         └─ KV + R2 persisted to /app/.wrangler  ← MOUNT A VOLUME
```

Coolify terminates TLS on your domain and proxies to the container's port 8787.
Auth traffic (password hashes, tokens, key escrow) only ever crosses the network
over HTTPS.

## ⚠️ The one thing you must not skip: the persistent volume

Miniflare persists KV (accounts, tokens, escrow) and R2 (encrypted sync blobs) to
`/app/.wrangler` **inside the container**. Container filesystems are wiped on every
redeploy. **Without a persistent volume mounted at `/app/.wrangler`, every deploy
deletes all accounts and all synced data.** The server is zero-knowledge — losing
this is unrecoverable (no password reset exists; recovery is the user's recovery
phrase only).

## Container files (in this repo, `server/`)

- `Dockerfile` — node:22, `npm ci`, runs `wrangler dev --ip 0.0.0.0 --port 8787`.
- `docker-entrypoint.sh` — writes `.dev.vars` from the `JWT_SECRET` env var, then
  execs wrangler.
- `.dockerignore` — keeps local `node_modules`, `.wrangler`, `.dev.vars` out of
  the image.

## Coolify setup

1. **New Resource → Application → your Git repo** (the MindWiki repo).
2. **Build Pack:** Dockerfile. **Base Directory:** `/server` (so the build
   context is `server/` and it uses `server/Dockerfile`).
3. **Port:** set the exposed/ports value to **8787**.
4. **Environment variable:** add `JWT_SECRET`. Generate a strong one:
   ```bash
   openssl rand -hex 32
   ```
   Paste the output as the value. (Runtime var, not build-time.)
5. **Persistent Storage:** add a volume → **Destination Path** `/app/.wrangler`.
   (Source can be a Coolify-managed named volume.) This is the non-negotiable
   step above.
6. **Domain:** set `https://api.yourdomain.com` in Coolify. Coolify configures
   Traefik + Let's Encrypt automatically once the DNS **A record** for that domain
   points at the VM and ports 80/443 are open.
7. **Deploy.**

### Health check

`GET /` returns `401 Unauthorized` (the auth middleware, no token, never touches
KV) — that confirms the worker is alive but is not a 2xx. If Coolify's HTTP health
check marks the container unhealthy, either disable the HTTP health check (the
container-running check is enough for testing) or ask me to add a tiny public
`GET /health` → `200` route to the worker.

## Verify

From your laptop, after the deploy goes green and DNS resolves:

```bash
curl -i https://api.yourdomain.com/      # expect: HTTP/2 401  Unauthorized + a valid (trusted) cert
```

`401` over HTTPS with a trusted cert = the full stack is up.

## Point the app at it

In the **repo root** create `.env.local` (gitignored):

```
EXPO_PUBLIC_API_URL=https://api.yourdomain.com
```

`EXPO_PUBLIC_*` is inlined **at build time**, so a JS-only Fast Refresh is not
enough — do a full `yarn expo run:android`. Then register a new account from the
app: that's the real end-to-end check (writes KV + R2 on the VM). Cross-device
sync now works over the internet via your domain.

## Operations

- **Update / deploy:** push to the repo → redeploy in Coolify (or enable
  auto-deploy on push). The persistent volume survives redeploys.
- **Logs:** Coolify's log viewer for the container. (The server never logs user
  content.)
- **Backup:** the `/app/.wrangler` volume — it holds only ciphertext blobs +
  account metadata, but losing it loses all accounts.

## Caveats

- `wrangler dev` is a **dev runtime** — fine for testing, not hardened for
  production load. The eventual production path is a real Cloudflare deploy
  (KV namespace + R2 bucket + `wrangler deploy`) per [SERVER.md](./SERVER.md).
