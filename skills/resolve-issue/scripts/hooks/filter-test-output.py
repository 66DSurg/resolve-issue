#!/usr/bin/env python3
"""Opt-in PreToolUse hook (profile filter_test_output: true) [CO-9]. Stdlib only.

Rewrites a Bash test-runner command so the agent sees the failing lines plus the
head and tail of the output, while the FULL log stays on disk and the exit code
stays the runner's own. It never cuts silently: the last line always names the
log and the real exit code. Commands that already redirect output are left alone.

Install (scoped to the lean worker only) in the copied agent file's frontmatter:
  hooks:
    PreToolUse:
      - matcher: Bash
        hooks:
          - type: command
            command: python3 <skill>/scripts/hooks/filter-test-output.py
Logs go to $RESOLVE_LOG_DIR (default: $TMPDIR), outside the worktree [IS-19].
"""
import json
import os
import re
import shlex
import sys

RUNNER = re.compile(r"(^|[;&|(]\s*|\s)(bun (run )?test|npm (run )?test|pnpm (run )?test|yarn test|npx (vitest|jest|playwright test)|vitest|jest|pytest|go test|cargo test|playwright test)\b")


def rewrite(cmd, log):
    if not RUNNER.search(cmd) or re.search(r"(^|[^2&])>\s*\S", cmd):
        return None
    q = shlex.quote(log)
    return (
        f"{{ {cmd} ; }} > {q} 2>&1; rc=$?; "
        f"grep -nE 'fail|error|✗' {q} | head -40; echo '…'; tail -5 {q}; "
        f"echo \"… truncated, full log at {log} exit=$rc\"; exit $rc"
    )


def main():
    data = json.load(sys.stdin)
    inp = data.get("tool_input") or {}
    if data.get("tool_name") != "Bash" or not inp.get("command"):
        return
    d = os.environ.get("RESOLVE_LOG_DIR") or os.environ.get("TMPDIR") or "/tmp"
    log = os.path.join(d, f"test-{os.getpid()}-{abs(hash(inp['command'])) % 10**8}.log")
    new = rewrite(inp["command"], log)
    if new:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "updatedInput": dict(inp, command=new)}}))


if __name__ == "__main__":
    main()
