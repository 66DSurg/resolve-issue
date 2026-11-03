---
name: resolve-issue
description: Takes ONE issue (bug report, feature request, tracker issue #N, a pasted screenshot of a defect) to a VERIFIED BRANCH through a ranked diagnosis, spec, plan, parallel build with an adversarial verifier per task, gates and docs, then stops for a human yes before anything is merged or pushed. Use when the user says "fix issue #N", "resolve #N", "work this issue", "take this bug", "build this feature end to end", "diagnose only #N", or pastes a bug report to be fixed, even when the fix looks like one line, because one-line fixes are the ones that ship the wrong cause.
---

# resolve-issue

Take one issue from report to a verified branch, then stop.

This skill is the distilled process from months of agent-driven work on one production app: about 70 ad-hoc workflows and around 600 raw lessons, merged into about 400 in `references/lessons.md`. Every instruction here exists because skipping it once cost a build cycle, a bad release or a user's trust. The ids in square brackets (`[DG-1]`) point to the lesson and its origin story. Lessons that hold only for one kind of product live in opt-in domain packs (`references/packs/`).

Scope: **issue → verified branch.** Merging to the main line, pushing, tagging and releasing are outside this skill. Each needs its own human yes [HG-1, HG-2].

## The loop

```
pre-flight ─▶ size + announce ─▶ DIAGNOSE ─▶ SPEC ─▶ PLAN ─▶ BUILD ║ VERIFY ⟲ REPAIR ─▶ VIEW ─▶ GATES ─▶ DOCS ─▶ HARVEST ─▶ STOP
(questions                       rank,       root    real    parallel waves, fresh      UI:     fixed    only if side-issue summary
that change                      probe,      cause,  code,   adversarial verifier       shots   list;    spec    drafts for from data
the build)                       measure     scope   units   per task, repair 1         before, commits  says so the main
                                                             tier up (max 3)            after   verified         loop
```

Every stage is a separate agent. Its output passes into the next stage's prompt unparaphrased: compact fields, or a pointer into a committed file (each task reads its plan section at the plan's commit) [OR-1, CO-9]. The run happens in the background so the conversation stays free [OR-2]. Agents inside the run never stop to ask questions. They rank the real alternatives, let evidence decide, and record what they decided. Questions for the human belong in pre-flight and at the final yes [OR-16]. Some questions do need an answer: a data-loss menu [SP-11], a shared component's changed flow nobody can vouch for [SP-17], a change to privacy or security behaviour [SP-18], a behaviour choice a repair cannot settle [VF-5]. **Each first goes to a decide step** [SP-20]: one agent lists 2 to 4 options with its recommendation, runs the profile ranker and classifies criticality (vault crypto, irreversible deletion no ADR mandates, money, legal or consent, a locked ADR, production access, a security weakening, plus `decisions.critical`). Code makes it AUTO only when it is not critical, the recommendation is the ranker's top and the margin is at least `decisions.margin` (0.2). AUTO goes into `decisions` and the run continues, at most 3 times per run. Anything else stops as `decision_required` with the options, the recommendation, the ranking and why it was not auto; relaunch with the human's answer in `decisions`. `decisions.auto: false` means always ask.

VIEW runs only when the spec sets `user_visible`. It screenshots before and after on test data, judges them against `docs.design` and the ux pack, and builds nothing; a defect this branch caused gets one repair, then a human decides [VF-23]. HARVEST turns every stage's side findings into issue drafts for Step 4 [OR-27].

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

Law 9 binds agents. Filing side issues to the project's own tracker (Step 4) is a main-loop action, done after the audit and listed in the summary, never by an agent inside a run [OR-27].

Add the project's own laws from its profile (for example, "migrations are additive only" [DI-25] or "no raw colours outside the design tokens" [VF-25]).

## Step 0: load or create the project profile

Look for `.claude/resolve-issue.yml` in the repo. If it is missing, run first-run discovery as described in `references/project-profile.md`. It finds the real install, typecheck, lint, test, e2e, build and docs commands, the tracker, the label mapping, the docs locations and the commit conventions, and writes the profile for the human to review. Never guess a command. A guessed command looks exactly like a broken build.

If the repo is nested inside another repo, run `git remote -v` first and never apply the parent's settings [PF-2].

## Step 1: pre-flight

Do this inline, before launching anything. It is cheap, and it prevents the most expensive mistakes.

1. **Make sure a tracker issue exists**, even for a hot-fix, and cite only issue numbers that really exist [PF-1].
2. **Capture the human's report verbatim**, plus screenshots, as files that every stage can read. Paraphrase loses the detail that separates the real symptom from a neighbouring one [PF-11]. Scrub identifiers first [PS-1, PS-2]. If the issue has an `## Agent Brief` comment, save it next to the report: its acceptance criteria and out-of-scope list go into the spec.
3. **Read the prior decisions.** That means ADRs, decision notes, memory, and earlier attempts on the same surface. Flag any conflict with a locked decision, and treat notes as possibly stale until the code confirms them [PF-4, PF-5, PF-6, DG-11].
   - **3b. Check it is not already built or already rejected.** Search the code and docs for the issue's glossary concept, not only its words, and read `.out-of-scope/` if the repo has one. A hit stops the run: tell the human what exists or was rejected, and recommend closing, re-scoping or reopening the decision [PF-5].
4. **Check feasibility** of any new dependency, data source or token before you spec on top of it, on every platform the product targets [PF-7, PF-8, PF-9, PF-10, PF-12].
5. **Ask only the questions that change what gets built.** Ask them one at a time, each with your recommended answer. For everything else, start, and write your assumptions into the spec [PF-3]. The question that matters most is usually the one that separates the reported symptom from a neighbouring one: which screen, which flow, which data [DG-15]. A fact only the reporter has moves the issue to `needs-info` with the question for them. It never becomes an assumption.
6. **A destructive or data-loss-sensitive request** never goes straight to a build. It gets a decision menu first [SP-11]. So does a shared component's changed default whose effect on some caller's flow nobody knows [SP-17].
7. **Check shared state against runs already going.** With `env.shared_db: true`, warn before a second run that touches DB functions, and run them one after the other. Each run overrides the runner's `env.fixed_paths` with its own log directory [IS-17, IS-18]. Logs and screenshots go under `<scratch>/<issue>/logs`, outside the worktree; if a log directory sits inside one, `git check-ignore` must cover it before launch [IS-19].

## Step 2: size it, budget it, announce it

| Size | Typical shape | Agents |
|---|---|---|
| trivial | decided from the actual diff: no code path changes (copy, typos, comments, config with no behaviour change) | no run. Edit inline, run the gates, write a one-line summary |
| small | one cause, 1 to 2 files, no UI flow change | 1 diagnoser, 1 spec+plan agent, 1 task and its verifier, gates. Symptom check only without a measured repro; docs only if the spec says so |
| medium | one cause, several files or a UI flow | 2 diagnosers on different angles, 3 to 6 tasks, a verifier per task, +1 VIEW when user-visible, +1 harvest when there are findings |
| large | multi-slice feature or several causes | split into sub-issues first and run the smallest first [PL-6]. Cap each run at about 9 tasks [PL-7] |

Trivial is never guessed up front. Make the edit, read `git diff`, and if it touches any code path, revert it and run it as small. Anything that changes behaviour keeps diagnosis and the negative control.

Announce the size, the agent count, the budget and whether auto-decide is on in one line [SZ-1, SP-20]. A small run then starts. A medium or large announce is a question and waits for a yes, because an accidental run costs hours: "Medium: 2 diagnosers, ~5 build tasks, 5 verifiers, in the background. Go? (Or: stop after the plan for review.)" "Diagnose only" runs with `stopAfter: 'diagnose'`. A plan review runs with `stopAfter: 'plan'`, then relaunches with `resumeFrom: 'build'`. Both default off [SP-1].

Respect the human's declared caps (for example "max 3 runs at once"). Count the runs already going before you launch, and queue the rest as issues [SZ-2]. Batch several small, independent issues into one run, with a per-item verify loop and one shared gates pass [SZ-3]. Model and effort per stage come from the profile's tier table. See `references/cost.md`.

## Step 3: run the pipeline

Pick the engine your harness has:

- **Workflow tool available** (Claude Code): stamp a per-issue copy of `templates/workflow.js` with `scripts/stamp-workflow.sh <issue-id>`, so that the run's name carries the issue id [OR-3, OR-4]. Then launch it with the args described at the top of the template, including `scratchDir` and `openIssues` (open issues' number, title and labels, fetched first with the tracker CLI, for example `gh issue list --state open --limit 500 --json number,title,labels`; skip it when `issues.auto_file` is false). Workflow scripts cannot read files, so you read the profile, merge it over the defaults in `references/project-profile.md`, and pass it in with the tier table, the domain packs and the skill's path [OR-6].
- **Agent/Task subagents only**: follow `templates/subagent-fallback.md`. It is the same loop, driven by you.
- **No subagents** (another agent harness, or a plain session): run the stages sequentially yourself, as described in `references/process.md`. Run the verifier pass in a fresh context if you can get one. If you cannot, switch hats explicitly and assume your own work is wrong.

**Lean worker.** Stages run as the `resolve-worker` agent type: core tools only, no MCP, skills, subagents or web, CLAUDE.md kept [CO-9]. Before the first run, check that the type resolves (`.claude/agents/resolve-worker.md` in the repo, or `~/.claude/agents/`; agent files load only at session start, so RESTART Claude Code after installing). If it is missing, offer to copy `templates/agents/resolve-worker.md` there (a config change, so ask). Until then the run falls back by itself: an unresolved type is retried once as the default agent, logged once, and recorded as `metrics.agent_type_fallback`. Rules a worker must follow go in `profile.laws`, never only in memory. Details and the opt-in switches are in `references/project-profile.md`.

Before launch, create the isolated worktree and branch and assign spare ports (`references/isolation.md`). Write the spec and plan under the profile's `spec_dir`. The default is `docs/issues/<date>-<slug>/spec.md` and `plan.md`. A value of `none` means a scratch directory [DC-5].

Stage detail lives in these files, which you should read when that stage runs or when you write its prompt:

| Stage | Read |
|---|---|
| any, entry/exit criteria | `references/process.md` |
| diagnose | `references/diagnosis.md` |
| spec, plan | `references/spec-and-plan.md`, `templates/spec.md`, `templates/plan.md` |
| build, verify, repair, view | `references/verification.md` |
| harvest, filing side issues | `references/process.md` §9b |
| gates | `references/tests-and-gates.md` |
| worktrees, ports, env | `references/isolation.md` |
| docs | `references/docs.md` |
| anything touching user data | `references/privacy.md`, `references/design-principles.md` |
| one product's domain (UX, product scope, imports, runtime cost, tool quirks) | `references/packs/`, when on via `packs:` or a diagnosis trigger |
| commits, merge, deploy machinery | `references/git-and-handoff.md` |
| tiers, budget | `references/cost.md` |
| talking to the human | `references/communication.md` |

## Composes with

Use these skills when they are installed. The inline rules in this skill are the fallback when they are not.

- `grill-with-docs`: the design grill for feature issues and multi-slice features [SP-1, SP-2].
- `domain-modeling`: glossary and ADR writes, in the repo's own ADR format. Rankings stay in the spec.
- `triage`: follow-up issues, filed as `needs-triage` with its AI disclaimer, and "which issue next?" questions.
- `codebase-design`: the vocabulary behind "shared seam" in law 3.
- `git-guardrails-claude-code`: the hook that blocks destructive git, recommended during discovery [HG-5].

## Step 4: after the run returns, audit before you believe it

Subagents misreport, and runtimes delete files. The run returns a compact result (status, root cause, gates table, commits, merged findings by severity, follow-ups) and keeps the full stage outputs in its journal and in the spec and plan files [OR-26]. Read the compact result, open the journal only for what it points to, and do all of the following before you say anything is done [VF-10, VF-15, OR-17]:

1. Run `git status` and `git ls-files -d` in the worktree. Restore unexpected deletions without touching new work [VF-15].
2. Run `git log <base>..HEAD` and check that every commit carries the required trailers. An unattributed commit counts as rogue until it is explained [GR-4].
3. Cross-check the plan's unit list against the tree. A planned unit with no implementation is a STOP, so dispatch a completion agent for exactly those units [VF-13, OR-10].
4. Re-run the gates yourself, independently of the run's gates agent, from the profile's gate list. Save the full output and grep all of it for `failed` [VF-10, TG-2]. Checks recorded as `ci_only` need a PR or CI context and are not local gates. If one sits in the gate list and fails for that reason, move it to `ci_only` in the profile rather than calling the run red [TG-34]. `gates_commits_verified: false` means the gates agent's own commits failed review: treat the gates as red until you have read them.
5. Confirm that every server the run started is gone, by process group and `ps`, not only `lsof`, and that the developer's ports are untouched [IS-8, IS-20].
6. Re-triage the merged findings list, defects and test gaps first [VF-31]. "Non-blocking" is the verifier's opinion, not a verdict: re-read each finding against the code and promote any that a user could hit (a page stuck loading, a raw 500, misleading copy). Fix real defects before handoff, and file follow-ups as issues [VF-11].
7. **File the side issues** the run drafted (`side_issues`, `bundle_issue`) unless the profile sets `issues.auto_file: false` [OR-27]. Re-check each draft against the code first and drop any that is not true or is this branch's own defect (that one goes back to repair). Re-dedupe against a fresh open-issue list fetched now, by concept as well as title: an issue filed after the run's snapshot counts [OR-27]. For a `duplicate_of` draft, comment on that issue with its body. File each serious draft (`bundle: false`) as its own issue, and the minor ones as the ONE bundle issue, each with its `labels` (needs-triage plus `labels.side_issue` when set) [OR-29]. A `branch_defects` entry is never filed: repair it. Scan every body for identifiers before it leaves [PS-2]. Replace the summary's last line with "New issues filed: #…" (or "none").
8. Append one line to `.claude/resolve-issue-runs.jsonl`: date, issue, size, status, wall-clock start and end, the run's `metrics` (stages, repairs, verifier rejections, gates commits), finding counts by severity, how many findings you promoted at this audit, and the side issues filed. Add the `auto_decisions` count and `metrics.cost`, the output of `python3 scripts/run-cost.py <the run's transcript dir>`: `metrics.stages[].spent` counts output tokens only, about 8% of the cost [CO-9]. Without it, nobody can tell whether a tier or a stage change helped [CO-2]. With 3 or more runs in the log, add one cross-run trend line to the summary (repairs per task, decision stops per run, auto-decisions per run).

## Step 5: hand off and stop

The run returns a summary draft rendered from its own data, in the terse format in `references/communication.md`, with its Insights bullets and any auto-decisions for review. Correct it with what the audit found. It covers the confirmed root cause and how it was confirmed, the rankings used, what changed for the user, the gate results, the commit list, and exactly what the human should check by hand [CM-7]. Then stop.

| Action | Who decides |
|---|---|
| commits on the issue branch inside its worktree | agents, with trailers, explicit paths only |
| merge into the main line | human yes |
| push | a human yes **for each push**. An earlier "ship it" does not carry forward [HG-2]. Any stricter gate the human declares (a yes per commit, say) applies on top [HG-18] |
| version bump, tag, release, deploy | human yes, done in the main loop, never inside a run [GR-9] |
| repo settings, secrets, CI triggers | human only [HG-1] |
| a decision point inside the run | the decide step, when not critical and the recommendation and ranker agree with margin (max 3, listed in the summary for review); otherwise the human [SP-20] |
| closing the issue | only when the work reaches production and the reporter has confirmed it [GR-10, DG-15] |

When the human says "push it" in this turn, push without asking "are you sure?" [HG-3]. When the permission system blocks an action, do not route around it. Hand the human the exact command [HG-6].

## Feed the lessons back

When a run teaches something new, append it to `references/lessons.md` under the right stage. Use the same format (the rule, why it matters, and a one-line anonymised origin), give it the next free id, and cite it from the stage reference that should apply it. Do this in the same change [DC-21]. A lesson that only holds for one kind of product goes in the matching pack under `references/packs/`.

Lessons also leave. When one stops earning its place (the tool changed, or it is one product's taste), move it to a pack or mark its line `status: archived` with a one-line reason, drop its citations, and never reuse its id. Run `python3 scripts/check.py`. It fails if a core lesson that is not archived is never applied, if an id is defined twice, and if anything private leaks into the skill [TG-23].
