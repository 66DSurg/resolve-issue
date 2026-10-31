# Plan: <issue id> <title>

Spec: <path>. Base: <branch @ sha>. Worktree: <path>. Ports: <backend>/<frontend>.

Rules for this plan: write ACTUAL code and exact signatures. No "TBD", no "add appropriate handling", no "similar to Task N". Use 3 to 9 tasks. Tasks in the same wave touch disjoint files. Order: root fix → diagnostics and guards → docs.

## Waves

| Wave | Tasks (parallel) |
|---|---|
| 1 | T1 |
| 2 | T2, T3 |

## T1: <title>

- Files: `<path>`, `<path>` (and nothing else)
- Depends on: none
- Laws: <numbers from the spec>

Steps:
- [ ] Write the failing test in `<test path>`:
  ```ts
  // exact test code
  ```
- [ ] Run `<cmd>` and SEE it fail with: `<expected failure>`
- [ ] Implement in `<path>`:
  ```ts
  // exact code
  ```
- [ ] Run `<cmd>` and see it pass
- [ ] Run typecheck and lint: `<cmd>`
- [ ] Commit, staging explicit paths only: `git add <paths> && git commit -m "<subject> (#<n>)" -m "<trailers>"`

Acceptance: <observable outcome the verifier checks, including the negative control>

## T2: <title>

…

## Machine-readable units

The plan agent ALSO returns these as structured output. The build iterates over the returned list, never over a hand-written one.

```json
[
  {"id": "T1", "title": "...", "files": ["..."], "depends_on": [], "instructions": "the T1 section verbatim", "acceptance": "..."}
]
```
