#!/usr/bin/env bash
# Stamp a per-issue copy of the canonical workflow template, so the run's name
# carries the issue id. Never hand-edit the copies; vary runs through args. [OR-3, OR-4]
# Usage: stamp-workflow.sh <issue-id> [out-dir]   (out-dir defaults to .claude/workflows)
set -euo pipefail
id="${1:?usage: stamp-workflow.sh <issue-id> [out-dir]}"
[[ "$id" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "bad issue id: $id" >&2; exit 2; }
out="${2:-.claude/workflows}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$out"
sed "s/__ISSUE__/$id/g" "$here/templates/workflow.js" > "$out/resolve-issue-$id.js"
echo "$out/resolve-issue-$id.js"
