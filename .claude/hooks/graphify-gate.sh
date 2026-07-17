#!/usr/bin/env bash
# graphify-gate: PreToolUse hook for Grep|Glob.
# Blocks the FIRST Grep/Glob per session with instructions to query the
# Graphify knowledge graph first; allows every call after that (block-first,
# allow-retry). No-op if the graph hasn't been built yet.
#
# Wired in .claude/settings.json under hooks.PreToolUse (matcher "Glob|Grep").
set -euo pipefail

input="$(cat)"

# Only gate when a graph actually exists — otherwise there is nothing to query.
if [ ! -f graphify-out/graph.json ]; then
  exit 0
fi

# Session-scoped marker so we block only the first Grep/Glob of the session.
session_id="$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
[ -z "$session_id" ] && session_id="nosession"
marker="${TMPDIR:-/tmp}/graphify-gate-${session_id}"

# Already nudged this session → let it through.
if [ -f "$marker" ]; then
  exit 0
fi

# First hit: record it, then block with guidance.
touch "$marker"
cat <<'JSON'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "graphify: A knowledge graph of this codebase exists. Per CLAUDE.md, query it before grepping/globbing. Run the /graphify skill with `query \"<your question>\"` (or read graphify-out/GRAPH_REPORT.md for god nodes + community structure). Only fall back to Grep/Glob if the graph returns nothing — this block is a one-time-per-session nudge; the same call will now succeed if you retry."
  }
}
JSON
exit 0
