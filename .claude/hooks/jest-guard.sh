#!/usr/bin/env bash
# Require Claude-driven Jest runs to use the shared cross-worktree mutex.
set -euo pipefail

input="$(cat)"
command="$(INPUT="$input" python3 - <<'PY'
import json
import os

try:
    payload = json.loads(os.environ["INPUT"])
except (KeyError, json.JSONDecodeError):
    print("")
else:
    print(payload.get("tool_input", {}).get("command", ""))
PY
)"

if [[ "$command" =~ (^|[[:space:];|&])(yarn[[:space:]]+(run[[:space:]]+)?(test|jest)|npm[[:space:]]+(test|run[[:space:]]+test|exec[[:space:]]+jest)|npx[[:space:]]+jest|([^[:space:];|&]*/)?jest)([[:space:]]|$) ]]; then
  cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "MindWiki Jest runs must be serialized across agents and worktrees. From the repository root, use: bash .claude/scripts/run-jest.sh [test paths or Jest flags]. The wrapper adds --runInBand and holds the shared lock."
  }
}
JSON
fi
