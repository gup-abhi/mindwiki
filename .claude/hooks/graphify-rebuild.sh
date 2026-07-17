#!/usr/bin/env bash
# graphify-rebuild: SessionStart hook.
# Re-extracts code files and refreshes graphify-out/graph.json (no LLM).
# This is the real implementation of the auto-rebuild CLAUDE.md describes.
# Runs ~1s; never blocks the session even if graphify is missing or fails.
set -uo pipefail

command -v graphify >/dev/null 2>&1 || exit 0
graphify update . >/dev/null 2>&1 || true
exit 0
