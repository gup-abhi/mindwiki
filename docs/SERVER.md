# MindWiki — Server Architecture

MindWiki runs on Cloudflare Workers and V8 isolates, not Node.js. The server is a thin auth and encrypted-blob boundary: it stores ciphertext and account metadata, and never reads journal or wiki content.

## Wrangler environments

`server/wrangler.toml` defines three isolated targets:

- The default target is local Miniflare with local KV/R2 state.
- `staging` deploys `mindwiki-server-staging`.
- `production` deploys `mindwiki-server-production`.

Each remote target has its own KV namespace, R2 bucket, Durable Object binding, and `JWT_SECRET`. The checked-in staging/production identifiers intentionally contain valid-syntax sentinel IDs and bucket names until resources are provisioned. `server/scripts/verify-deploy-config.sh` refuses deployment while a sentinel remains. Resource IDs and bucket names are safe to commit; credentials and secrets are not.

```bash
cd server
npm install
wrangler dev
./scripts/verify-deploy-config.sh staging
./scripts/verify-deploy-config.sh production
```

Set secrets separately for each environment:

```bash
wrangler secret put JWT_SECRET --env staging
wrangler secret put JWT_SECRET --env production
```

The app's notifications are local-only. There is no APNs/FCM relay or push KV namespace, and server-side notification work must never carry journal content.

## Routes and privacy boundary

Public routes include health, registration, login, recovery, pairing redemption, and refresh. Authenticated routes cover logout, device management, recovery, pairing, subscription status, account deletion, encrypted sync upload, delta, and count-only audit.

`GET /health` returns only `{ "ok": true }` and does not require authentication. It is suitable for uptime and deployment checks.

Sync v2 accepts only validated envelopes containing an opaque sync ID, table name, timestamp, and ciphertext. R2 keys contain the account ID, protocol version, table, and opaque sync ID. Delta returns encrypted envelopes; audit returns counts and validation status only. Raw journal/wiki text never enters a request, response, log, route, or deployment smoke check.

Account deletion writes a marker, purges the account's R2 prefix, removes account-owned KV records, and records completion. Deletion is idempotent for the marker retention period. Logout revokes the current session family.

## Durable Object coordination

`AUTH_COORDINATOR` serializes normalized-email reservation and refresh-token claims. KV remains the durable metadata store; passwords, recovery material, master keys, refresh tokens, and journal content are never stored in plaintext by the server.

## Deployment workflow

`.github/workflows/deploy-server.yml` is manual by design:

1. Provision separate staging and production KV namespaces, R2 buckets, and Durable Object bindings. Replace only the matching sentinel identifiers in `server/wrangler.toml`.
2. Configure `JWT_SECRET` in each Cloudflare environment and configure the protected GitHub environments with `CF_API_TOKEN` and `SMOKE_BASE_URL`.
3. Run `Deploy Server` with `environment=staging`. The workflow installs dependencies, typechecks, rejects placeholders, deploys the staging Worker, and runs the privacy-safe smoke suite.
4. Review the staging Worker version and smoke output. Promote production separately by selecting `environment=production`, entering `PROMOTE`, and passing the protected production environment review.
5. Keep the prior Worker version and configuration available until the next staging promotion is verified.

The workflow does not deploy on push and does not automatically promote production.

## Privacy-safe smoke checks

```bash
cd server
./scripts/smoke.sh https://staging.example.invalid
```

The runner generates a disposable account and checks health, registration, login, refresh, encrypted upload, delta, count-only audit, logout, and account deletion. It uses fixed synthetic hashes and opaque synthetic ciphertext. It does not print response bodies, tokens, ciphertext, account IDs, or authored content.

## Rollback

Record the Worker version from every staging and production deployment. For rollback, identify the last known-good version in Cloudflare deployment history, use the Cloudflare version rollback control for the affected Worker, and rerun `server/scripts/smoke.sh` against that environment URL.

Do not alter KV, R2, or Durable Object resources during an application rollback. If a binding or migration changed, stop promotion and follow the migration-specific recovery plan before serving traffic. Production rollback is manual and protected; it is never triggered automatically by a smoke-test failure.

Never commit API tokens, JWT secrets, private keys, or `.dev.vars`.
