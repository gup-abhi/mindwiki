# MindWiki Claude Code setup

Project instructions remain in `../CLAUDE.md`. This directory holds executable Claude Code workflows and domain specialists.

## Automatic hooks

- `SessionStart` → `hooks/graphify-rebuild.sh`: refreshes the generated code graph without blocking startup.
- First `Grep`/`Glob` → `hooks/graphify-gate.sh`: enforces graph-first navigation once per session.
- Every `Bash` call → `hooks/jest-guard.sh`: denies direct Jest commands so agents cannot create competing test processes.

Run Jest from the repository root through:

```bash
bash .claude/scripts/run-jest.sh [test paths or Jest flags]
```

The runner uses Git's shared common directory to hold one lock across the main checkout and every worktree, then adds `--runInBand`.

## Skills

| Command | Use |
|---|---|
| `/verify [focused\|full\|ci]` | Select and run project quality gates sequentially. |
| `/privacy-review [scope]` | Audit zero-knowledge, auth, recovery, sync, logging, routing, notification, and accessibility boundaries. |
| `/native-debug <target> <symptom>` | Diagnose Expo/React Native, device, SQLCipher, SecureStore, Argon2, or llama.rn failures. |
| `/docs-drift [scope]` | Compare documentation with package, CI, Wrangler, Expo, test, and Claude configuration. |

Skills replace legacy project files under `.claude/commands/` and provide the slash-command interface.

## Subagents

- `privacy-security-reviewer`: privacy-sensitive diffs and threat boundaries.
- `wiki-pipeline-reviewer`: entry → local LLM → wiki → graph behavior and quality.
- `native-device-debugger`: Android/iOS and physical-device investigation.
- `cloudflare-backend-reviewer`: Worker, KV/R2, encrypted sync, auth, and deployment review.

Delegate to these specialists when their boundary is involved; do not invoke all of them for routine changes.

## MCP policy

No project `.mcp.json` is required now:

- Keep the authenticated GitHub MCP for PR, issue, CI, and review operations.
- Keep Claude memory search for device-proven decisions and project history not derivable from source.
- Keep Graphify as the existing skill + hooks rather than adding a duplicate Graphify MCP transport.
- Do not add deployment-capable Cloudflare tooling until `server/wrangler.toml`, the manual deploy workflow, and production environment agree.
- Do not add filesystem/database MCPs; built-in tools cover source access, while broader data access increases privacy exposure.
- The locally configured Ruflo server is currently unhealthy. Repair or remove it from local user configuration separately; project workflows do not depend on it.

## Verification boundaries

Jest mocks native modules. A passing suite does not verify SQLCipher encryption, Keychain/Keystore, Argon2, notifications, camera, Fabric touch behavior, or llama.rn inference. Use the exact physical-device gate for changes to those areas.

Never include journal text, authored wiki content, master keys, tokens, or recovery phrases in prompts, logs, test fixtures copied from users, or MCP payloads.
