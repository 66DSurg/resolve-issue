# Plan: <issue id> <title>

Spec: <path>. Base: <branch @ sha>. Worktree: <path>. Ports: <backend>/<frontend>.

Rules for this plan: write ACTUAL code and exact signatures. No "TBD", no "add appropriate handling", no "similar to Task N". Use 1 task for small, 3 to 9 for medium. Each task is a vertical slice that delivers observable behaviour through a real interface, root fix first. Use file-disjointness only to schedule waves: tasks that share a file never run at once. Docs belong to the docs stage, not to a task. Test-first steps are mandatory for the root-fix task; other tasks add tests where they change behaviour. Tests drive the interface they name and prefer real collaborators to mocks.

## Waves

| Wave | Tasks (parallel) |
|---|---|
| 1 | T1 |
| 2 | T2, T3 |

Waves: <W> for <N> tasks. If W = N on a medium plan, give the real dependency here (`serial_reason`), or the run sends the plan back once for parallelism [PL-15].

## T1: <title>

- Files: `<path>`, `<path>` (and nothing else)
- Depends on: none
- Laws: <numbers from the spec>

Steps:
- [ ] (root-fix task) Write the failing test in `<test path>`, driving `<interface: page | route | CLI | public function>`. For the root fix this is the diagnosis reproduction:
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
- [ ] Tick these boxes, then commit, staging explicit paths only and including this plan file: `git add <paths> <plan path> && git commit -m "<subject> (#<n>)" -m "<trailers>"`

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
