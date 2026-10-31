# resolve-issue

A Claude Code skill that takes **one issue** from report to a **verified branch**. It diagnoses by ranking the candidate causes, writes a spec, writes a plan that contains real code, builds the independent tasks in parallel, verifies every task with a fresh adversarial agent and repairs it one model tier up, runs the full gates and the docs pass, and then **stops**. Merge, push and release each wait for a human yes.

Built while making Case Logbook (caselogbook.com) by Dr Biswajit Dutta Baruah

## Why

Agents are good at writing a fix. The trouble is that they are just as good at writing a confident fix for the wrong cause, reporting green from the tail of a log, sweeping stray files into a commit, or hijacking the developer's dev server. This skill is the process that survived about 70 agent-driven workflows on one production app. Around 600 raw lessons were merged into about 390 general ones, each with a one-line origin story, in [`references/lessons.md`](references/lessons.md). Every instruction in the skill cites the lesson behind it (`[DG-1]`), and a check fails if any core lesson is listed without being applied. Lessons that encode one product's taste (UX, product judgment, runtime cost, imports, tool quirks) sit in opt-in packs under [`references/packs/`](references/packs/), switched on per project with `packs:` in the profile or by a diagnosis that meets a pack's trigger.

Some of the lessons that changed outcomes most:

- **Rank, don't confirm.** Absolute "is this hypothesis sound?" judgments scored 2/4 on bugs with known causes, and one rated a known-wrong cause sound at 0.77. Forced relative ranking scored 6/6.
- **Fix the reported symptom, not a neighbouring one.** One release shipped a real fix for a bug the reporter did not have.
- **Prove the regression test can fail**, by reverting the fix and watching it go red.
- **Grep the whole log for "failed".** One tail said "119 passed" while one test had failed.
- **Audit the tree after every background run.** One runtime teardown deleted 259 tracked files, and `git add -A` would have committed the deletions.
- **Save money on mechanical stages, never on judgment.** Probe a cheap model before you give it write access. One cheap tier invented a task and committed to the main line under the human's name.

## Install

Claude Code, personal skill:

```bash
git clone https://github.com/66DSurg/resolve-issue ~/.claude/skills/resolve-issue
```

Or per project: clone it into `.claude/skills/resolve-issue` in the repo. The repository root is the skill (`SKILL.md` sits at the top).

Other agents: the core is plain Markdown. Point your agent at `SKILL.md`. It falls back to Agent-tool subagents (`templates/subagent-fallback.md`) or to a plain sequential run (`references/process.md`).

## Quick start

```
> resolve issue #123
```

The first time it runs in a repo, the skill discovers your real commands, ports, docs locations, labels and commit trailers. It writes `.claude/resolve-issue.yml` and asks you only about the gaps that matter. See [`references/project-profile.md`](references/project-profile.md) and [`templates/profile.example.yml`](templates/profile.example.yml).

After that, each issue goes like this:

1. **Pre-flight.** The skill asks only the questions that change what gets built, one at a time, each with a recommended answer. Everything else becomes a written assumption in the spec.
2. **Size and announce.** For example: "Medium: 2 diagnosers, ~5 build tasks, 5 verifiers. Running in the background." It respects your concurrency caps.
3. **Run.** The run happens in its own git worktree, on its own branch and spare ports. The spec and plan land in `docs/issues/<date>-<slug>/` (configurable, or `none` for scratch).
4. **Audit.** The skill checks `git status`, `git ls-files -d` and the commit trailers, re-runs the gates itself, and confirms its servers are gone.
5. **Summary.** You get a short, phone-readable summary covering the root cause and how it was confirmed, what changes for the user, the gates, the commits, and what to check by hand.

## How it works

```
pre-flight → size → DIAGNOSE → SPEC → PLAN → BUILD ║ VERIFY ⟲ REPAIR → GATES → DOCS → SUMMARY → STOP
```

| Stage | Agents | Tier |
|---|---|---|
| diagnose | 1 (small) or 2 on different angles | strongest, high effort |
| spec, plan | 1 each | strongest |
| symptom check | 1 ranking: "does this plan fix the reported symptom or a neighbour?" | strongest |
| build | 1 per task, waves on disjoint files | mid |
| verify | 1 fresh adversarial verifier per task, with a negative control | strongest, never cheapened |
| repair | up to 3 rounds per task | one tier above build |
| gates | 1, full suite, whole-log failure grep, known-flaky SET | mid, medium or higher |
| docs | 1, plus a claim verifier | mid |

In Claude Code with the Workflow tool, `scripts/stamp-workflow.sh <id>` makes a per-issue copy of [`templates/workflow.js`](templates/workflow.js). Without it, the same loop runs through Agent subagents.

## The stop points

| Action | Who |
|---|---|
| commits on the issue branch, in its worktree | agents (explicit paths, trailers) |
| merge to the main line | you |
| push | you, **each push** |
| version bump, tag, release, deploy | you, done in the main session, never inside a run |
| repo settings, secrets, CI triggers | you |
| closing the issue | after it reaches production and the reporter confirms |

Agents never get production access, never write sensitive identifiers into issues, commits or docs, and never weaken a test to go green.

## Contributing a lesson

Found a new failure mode? Add it to `references/lessons.md` under the right stage (or to a pack, if it only holds for one kind of product), in the same format (the rule, why it matters, a one-line anonymised origin). Give it the next free id and cite it from the stage reference that should apply it. A lesson that stops earning its place is marked `status: archived` or moved to a pack; ids are never reused. Then run:

```bash
python3 scripts/check.py          # every core lesson applied, no dangling or duplicate ids, no private data
node scripts/test-workflow.mjs    # dry-run of the workflow template with mocked agents
```

## License

MIT. See [LICENSE](LICENSE).
