# Project-local Claude-like auto mode

## Goal
Add project-local Pi guardrails under `.pi/extensions/`, modeled on Claude Code auto mode.

## Steps
1. Add project-local extension entrypoint that loads the existing `pi-automode` implementation when available, so enforcement stays aligned with its tested classifier, deny/ask precedence, hard-deny checks, read-only fast path, fail-closed behavior, status UI, and `/automode` commands.
2. Add project-local config with auto mode enabled and defaults preserved; avoid `permissions.allow`, which `pi-automode` does not support.
3. Add a project README/config note documenting trust, activation, limits, and verification commands.
4. Run Pi config/type checks and inspect effective configuration.

## Success checks
- Extension is discovered from `.pi/extensions/`.
- `/automode status` shows enabled in this project.
- Existing global config is not modified.
- No raw project content is logged or sent by new code.
- Guardrails fail closed for classifier failures and retain deterministic hard-deny behavior.
