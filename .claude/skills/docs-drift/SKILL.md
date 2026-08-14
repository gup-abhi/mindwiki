---
name: docs-drift
description: Compare MindWiki documentation with executable package, CI, Wrangler, Expo, test, and Claude Code configuration.
argument-hint: "[all|server|testing|claude|native]"
---

# Documentation drift audit

Read-only unless the user asks to update docs.

Compare claims against executable sources, prioritizing:

- `CLAUDE.md` ↔ current directory/test/config layout;
- `package.json`, `server/package.json`, `demo/package.json` ↔ documented commands;
- `.github/workflows/*.yml` ↔ deployment and CI docs;
- `server/wrangler.toml` ↔ documented environments and bindings;
- `app.json` and native configs ↔ release docs;
- `.claude/settings.json`, `.claude/skills/`, `.claude/agents/` ↔ Claude setup docs.

Known issue to re-verify, not assume: deploy workflow calls `wrangler deploy --env production`, while the production Wrangler environment may be absent and `docs/SERVER.md` may describe an older automatic trigger.

Report each mismatch with the authoritative executable file, stale documentation location, operational consequence, and smallest documentation or configuration correction. Do not expose secret values.
