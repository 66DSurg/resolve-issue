---
name: resolve-issue
description: Takes ONE issue (bug report, feature request, tracker issue #N, a pasted screenshot of a defect) all the way to a VERIFIED BRANCH. The stages are a ranked diagnosis, a spec, a plan containing real code, a build that runs independent tasks in parallel, an adversarial verifier for every task with repair one model tier up, the full test gates and a docs pass. It then stops so a human can say yes before anything is merged, pushed or released. Use it whenever the user says "fix issue #N", "resolve #N", "work this issue", "implement this issue", "take this bug", "this is broken again", "build this feature end to end", pastes a bug report or a user complaint, or asks which issue to do next. Use it even when they do not name the skill and even when the fix looks like one line, because the one-line fixes are the ones that ship the wrong cause.
---

# resolve-issue

Take one issue from report to a verified branch, then stop.

This skill is the distilled process from months of agent-driven work on one production app: about 70 ad-hoc workflows and around 600 raw lessons, merged into about 390 in `references/lessons.md`. Every instruction here exists because skipping it once cost a build cycle, a bad release or a user's trust. The ids in square brackets (`[DG-1]`) point to the lesson and its origin story. Read the lesson when a rule seems arbitrary. The reason is usually a concrete failure.

Scope: **issue → verified branch.** Merging to the main line, pushing, tagging and releasing are outside this skill. Each needs its own human yes [HG-1, HG-2].

## The loop

```
pre-flight ─▶ size + announce ─▶ DIAGNOSE ─▶ SPEC ─▶ PLAN ─▶ BUILD ║ VERIFY ⟲ REPAIR ─▶ GATES ─▶ DOCS ─▶ SUMMARY ─▶ STOP
 (questions                        rank,       root     real     parallel   fresh adversarial     full     only if    plain
  that change                      probe,      cause,   code,    waves on   verifier per task,    suite,   affected   English
  the build)                       measure     scope    units    disjoint   repair 1 tier up      e2e?
                                                                 files      (max 3 rounds)
```

Every stage is a separate agent. Its output passes VERBATIM into the next stage's prompt [OR-1]. The run happens in the background so the conversation stays free [OR-2]. Agents inside the run never stop to ask questions. They rank the real alternatives, let evidence decide, and record what they decided. Questions for the human belong in pre-flight and at the final yes [OR-16].

## The laws

These are non-negotiable. Inject them into every agent prompt as numbered laws, and give the verifier the same list to check mechanically. Soft guidance gets ignored under pressure, and numbered laws that a verifier enforces get respected [SP-14, OR-7].

1. **Rank, never confirm.** Before committing to a cause or a plan, list at least two alternatives, your favourite included, and force a relative ranking. Never ask "am I right?" [DG-1, DG-2].
2. **Evidence beats ranking.** A ranking informs and never decides. Read the code, probe, and measure. When the two disagree, evidence wins and the overrule gets recorded [DG-3, DG-8].
3. **Fix the reported symptom, at the shared seam.** Fix the root cause at the one place every caller routes through, then look for sibling bugs of the same class [DG-15, DG-25, SP-4].
4. **Prove the test can fail.** Every fix carries a regression test that fails on the old code and passes on the new [VF-3].
5. **Read the whole log.** Grep the full test output for `failed`. Compare the failing SET, not the count or the tail [TG-2, TG-8].
6. **Never weaken a test or guard to go green.** Stop and report instead [TG-7].
7. **Stage explicit paths only.** No `git add -A`. After any background run, check `git status` and `git ls-files -d` [GR-1, VF-15].
8. **Stay isolated.** Each run gets its own worktree, branch and ports, links the real secrets, and kills every server it started [IS-1, IS-2, IS-3].
9. **No push, tag, release, settings or secrets changes by agents.** Destructive git stays blocked. Doubt means hold [HG-1, HG-5, HG-10].
10. **No sensitive identifiers anywhere.** Keep names, record numbers, birth dates and customer PII out of issues, commits, docs and fixtures. Agents get no production access [PS-1, PS-5].
11. **Only do the task you were given.** Put adjacent cleanup into follow-up issues [BD-2, SP-5].
12. **Never claim fixed, deployed or green from indirect evidence** [CM-3, VF-10].

Add the project's own laws from its profile (for example, "migrations are additive only" [DI-25] or "no raw colours outside the design tokens" [VF-25]).

## Step 0: load or create the project profile

Look for `.claude/resolve-issue.yml` in the repo. If it is missing, run first-run discovery as described in `references/project-profile.md`. It finds the real install, typecheck, lint, test, e2e, build and docs commands, the tracker, the label mapping, the docs locations and the commit conventions, and writes the profile for the human to review. Never guess a command. A guessed command looks exactly like a broken build.

If the repo is nested inside another repo, run `git remote -v` first and never apply the parent's settings [PF-2].

## Step 1: pre-flight

Do this inline, before launching anything. It is cheap, and it prevents the most expensive mistakes.

1. **Make sure a tracker issue exists**, even for a hot-fix, and cite only issue numbers that really exist [PF-1].
2. **Capture the human's report verbatim**, plus screenshots, as files that every stage can read. Paraphrase loses the detail that separates the real symptom from a neighbouring one [PF-11]. Scrub identifiers first [PS-1, PS-2].
3. **Read the prior decisions.** That means ADRs, decision notes, memory, and earlier attempts on the same surface. Flag any conflict with a locked decision, and treat notes as possibly stale until the code confirms them [PF-4, PF-5, PF-6, DG-11].
4. **Check feasibility** of any new dependency, data source or token before you spec on top of it, on every platform the product targets [PF-7, PF-8, PF-9, PF-10, PF-12].
5. **Ask only the questions that change what gets built.** Ask them one at a time, each with your recommended answer. For everything else, start, and write your assumptions into the spec [PF-3]. The question that matters most is usually the one that separates the reported symptom from a neighbouring one: which screen, which flow, which data [DG-15].
6. **A destructive or data-loss-sensitive request** never goes straight to a build. It gets a decision menu first [SP-11].

## Step 2: size it, budget it, announce it

| Size | Typical shape | Agents |
|---|---|---|
| small | one cause, 1 to 2 files, no UI flow change | 1 diagnoser, 1 builder, 1 verifier, gates, docs if affected |
| medium | one cause, several files or a UI flow | 2 diagnosers on different angles, 3 to 6 tasks, a verifier per task |
| large | multi-slice feature or several causes | split into sub-issues first and run the smallest first [PL-6]. Cap each run at about 9 tasks [PL-7] |

Announce the size, the agent count and the budget in one line before starting [SZ-1]. An example: "Medium: 2 diagnosers, ~5 build tasks, 5 verifiers. Running in the background."

Respect the human's declared caps (for example "max 3 runs at once"). Count the runs already going before you launch, and queue the rest as issues [SZ-2]. Batch several small, independent issues into one run, with a per-item verify loop and one shared gates pass [SZ-3]. Model and effort per stage come from the profile's tier table. See `references/cost.md`.

## Step 3: run the pipeline

Pick the engine your harness has:

- **Workflow tool available** (Claude Code): stamp a per-issue copy of `templates/workflow.js` with `scripts/stamp-workflow.sh <issue-id>`, so that the run's name carries the issue id [OR-3, OR-4]. Then launch it with the args described at the top of the template. Workflow scripts cannot read files, so you read the profile and the tier table and pass both in as args [OR-6].
- **Agent/Task subagents only**: follow `templates/subagent-fallback.md`. It is the same loop, driven by you.
- **No subagents** (another agent harness, or a plain session): run the stages sequentially yourself, as described in `references/process.md`. Run the verifier pass in a fresh context if you can get one. If you cannot, switch hats explicitly and assume your own work is wrong.

Before launch, create the isolated worktree and branch and assign spare ports (`references/isolation.md`). Write the spec and plan under the profile's `spec_dir`. The default is `docs/issues/<date>-<slug>/spec.md` and `plan.md`. A value of `none` means a scratch directory [DC-5].

Stage detail lives in these files, which you should read when that stage runs or when you write its prompt:

| Stage | Read |
|---|---|
| any, entry/exit criteria | `references/process.md` |
| diagnose | `references/diagnosis.md` |
| spec, plan | `references/spec-and-plan.md`, `templates/spec.md`, `templates/plan.md` |
| build, verify, repair | `references/verification.md` |
| gates | `references/tests-and-gates.md` |
| worktrees, ports, env | `references/isolation.md` |
| docs | `references/docs.md` |
| anything touching user data | `references/privacy.md`, `references/design-principles.md` |
| commits, merge, deploy machinery | `references/git-and-handoff.md` |
| tiers, budget | `references/cost.md` |
| talking to the human | `references/communication.md` |

## Step 4: after the run returns, audit before you believe it

Subagents misreport, and runtimes delete files. Do all of the following before you say anything is done [VF-10, VF-15, OR-17]:

1. Run `git status` and `git ls-files -d` in the worktree. Restore unexpected deletions without touching new work [VF-15].
2. Run `git log <base>..HEAD` and check that every commit carries the required trailers. An unattributed commit counts as rogue until it is explained [GR-4].
3. Cross-check the plan's unit list against the tree. A planned unit with no implementation is a STOP, so dispatch a completion agent for exactly those units [VF-13, OR-10].
4. Re-run the gates yourself. Save the full output and grep all of it for `failed` [VF-10, TG-2].
5. Confirm that every server the run started is gone and the developer's ports are untouched [IS-8].
6. Re-read every finding a verifier marked "non-blocking". Several such findings turn out to be real defects [VF-11].

## Step 5: hand off and stop

Write the summary in the format in `references/communication.md`. It covers the confirmed root cause and how it was confirmed, the rankings used, what changed for the user, the gate results, the commit list, and exactly what the human should check by hand [CM-7]. Then stop.

| Action | Who decides |
|---|---|
| commits on the issue branch inside its worktree | agents, with trailers, explicit paths only |
| merge into the main line | human yes |
| push | a human yes **for each push**. An earlier "ship it" does not carry forward [HG-2]. Any stricter gate the human declares (a yes per commit, say) applies on top [HG-18] |
| version bump, tag, release, deploy | human yes, done in the main loop, never inside a run [GR-9] |
| repo settings, secrets, CI triggers | human only [HG-1] |
| closing the issue | only when the work reaches production and the reporter has confirmed it [GR-10, DG-15] |

When the human says "push it" in this turn, push without asking "are you sure?" [HG-3]. When the permission system blocks an action, do not route around it. Hand the human the exact command [HG-6].

## Feed the lessons back

When a run teaches something new, append it to `references/lessons.md` under the right stage. Use the same format (the rule, why it matters, and a one-line anonymised origin), give it the next free id, and cite it from the stage reference that should apply it. Do this in the same change [DC-21]. Run `python3 scripts/check.py`. It fails if any lesson is never applied and if anything private leaks into the skill [TG-23].
