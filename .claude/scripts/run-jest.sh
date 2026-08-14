#!/usr/bin/env bash
# Serialize Jest across the main checkout and all Claude worktrees.
set -euo pipefail

project_dir="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
git_common_dir="$(git -C "$project_dir" rev-parse --path-format=absolute --git-common-dir)"
lock_id="$(printf '%s' "$git_common_dir" | sha256sum | cut -d' ' -f1)"
lock_file="${TMPDIR:-/tmp}/mindwiki-jest-${lock_id}.lock"

exec 9>"$lock_file"
if ! flock -n 9; then
  printf 'Another MindWiki Jest process is running. Wait for it to finish; do not run Jest concurrently.\n' >&2
  exit 75
fi

cd "$project_dir"
exec yarn test --runInBand "$@"
