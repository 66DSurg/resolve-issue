# Process: stage by stage

This file gives the entry criteria, work, output and exit criteria for every stage, plus the orchestration rules that hold the stages together. The engine-specific mechanics are in `templates/workflow.js` (the Workflow tool) and `templates/subagent-fallback.md` (the Agent tool). The stages are the same for both, and the same again when you run them sequentially yourself.

## Contents

1. Orchestration rules (apply to every stage)
2. Stage 0: pre-flight
3. Stage 1: diagnose
4. Stage 2: spec
5. Stage 3: plan
6. Stage 4: build
7. Stage 5: verify and repair
8. Stage 6: gates
9. Stage 7: docs
10. Stage 8: summary and stop
11. Automation around the loop (bots, triage, queue)

---

## 1. Orchestration rules

**One pipeline, applied by default.** The pipeline is diagnose → spec → plan → build (in parallel where independent) → adversarial verify per task with a repair loop → gates → docs (only if affected) → summary → STOP. Each stage is a separate agent, and its output passes verbatim into the next stage's prompt [OR-1]. A single-blob run hides failures and takes hours.

**Background by default.** Launch the run in the background and keep talking with the human [OR-2].

**One canonical template.** Keep one workflow template, stamp per-issue copies with `scripts/stamp-workflow.sh`, and never hand-edit a copy. All per-issue variation goes in launch args [OR-3]. The run's display name carries the issue id, so concurrent runs can be told apart [OR-4].

**Launch args carry everything.** They include the issue ids, branch, worktree path, the human's verbatim report, screenshot paths, extra context docs, the diagnose and spec focus, the spec path, ports, whether e2e is allowed, the env file path, the commit tag, the ranker command, the tier table, and the ruled-out and suspect lists [OR-5]. Scripts that cannot read files get the profile and tiers from you as args. The config file stays the single source of truth, and each run carries a copy [OR-6].

**One shared preamble in every prompt.** It states the working directory and branch, the forbidden actions, the privacy law, where context lives, the decision rule (rank, then let evidence win), the port and server rules, how to source the test env, the doc locations, the commit format and trailers, the files never to stage, and the paths another process is editing right now [OR-7, OR-13]. Subagents start with no context. Every rule that lived only in the orchestrator's head was broken by some subagent.

**Wave scheduler.** Run every task whose dependencies are done, in parallel. If nothing is ready because of a cycle or a bad id, run the first remaining task alone. Treat a dependency on an id that is not in the plan as satisfied [OR-8]. Planner graphs are sometimes inconsistent, and they must not deadlock the run.

**File safety bounds parallelism.** Two agents never edit the same file at once, so tasks that share files run in sequence [OR-11, PL-4]. When parallel agents must touch a shared registry or design-system file, each one re-reads it immediately before editing and makes the smallest change it can. Expensive shared resources, such as a render queue, run one at a time [OR-12].

**Do not fan out browser suites.** Builders run typecheck and build. One serial test sweep runs at gates [OR-14]. Parallel browser suites saturate the machine and wedge the runner.

**Dead agents are failures.** A null result is recorded as "agent died". A null verdict triggers re-verification and is never a pass [OR-9]. If planned units are missing at the end, dispatch a completion agent for exactly those units instead of re-running everything [OR-10].

**Long e2e in the foreground.** An agent that runs a long suite does so in the foreground, with a long explicit timeout, and commits in the same turn. You check git status after every run and finish anything that stalled [OR-17].

**Structured returns.** Every run returns the diagnosis, the plan path, per-task results (attempts, verdicts, unfinished work), gates and docs as data [OR-18]. That data feeds the summary, the post-run audit and the repair-rate metric [CO-2].

**Build in parallel, release serially.** The version and changelog are singletons. Parallel runs end in one integrated release, done in the main loop, and each release re-reads the current version fresh [OR-15, GR-9].

## 2. Stage 0: pre-flight (inline, before launch)

Entry: a request that names or describes an issue.

Work:
- Make sure a tracker issue exists [PF-1]. Check the repo identity with `git remote -v` [PF-2]. Load the profile.
- Store the human's report verbatim, with screenshots, as files [PF-11]. Scrub identifiers [PS-1].
- Read the prior decisions and earlier attempts. Flag conflicts. Treat notes as stale until the code confirms them [PF-4, PF-5, PF-6].
- Check that every dependency, data source and access token the plan will lean on is feasible [PF-7, PF-8, PF-9, PF-10].
- Ask only the questions that change the build, one at a time, each with a recommendation [PF-3].
- Size the run, announce it, and check the concurrency caps [SZ-1, SZ-2].
- Create the worktree, branch and ports [IS-1, IS-3].

Exit: the profile is loaded, the report files exist, the size is announced, the worktree is ready, and the open questions are either answered or written down as assumptions.

## 3. Stage 1: diagnose

Entry: report files, profile, ruled-out and suspect lists, and prior attempts.
Agents: 1 for a small issue, 2 on different angles for medium and up [DG-12]. Use the strongest model at high effort [DG-6, CO-1].
Work: follow `references/diagnosis.md`. Trace the path, list the candidates, rank them, probe, and confirm. Fix nothing.
Output: structured diagnosis (method, findings, evidence, candidates with verdicts, ruled_out, open_questions, confidence) [DG-9].
Exit: either a confirmed cause, or an explicit statement of which candidates remain and what measurement would settle them. If the change is destructive, the exit is a decision menu, and the run stops for the human [SP-11].

## 4. Stage 2: spec

Entry: the diagnoses, verbatim.
Agents: 1, at a strong tier. It reconciles the diagnosers and reads the code itself wherever they disagree [DG-12].
Work: follow `references/spec-and-plan.md` and write `templates/spec.md` to the spec path.
Exit: the spec names the root cause and the shared seam, the scope and the explicit non-scope, the exact user-facing copy, the tests (at least one that fails before the fix), the docs impact and the honest risks [SP-4, SP-6]. If no diagnosed mechanism produces the reported symptom on the reported data, the spec says so [SP-3].

## 5. Stage 3: plan

Entry: the spec.
Agents: 1, at a top tier, because errors here multiply across every task [PL-2, CO-1].
Work: write `templates/plan.md`, with actual code and TDD checkboxes. Return the tasks as structured data (id, title, files, depends_on, instructions, acceptance) [PL-2, PL-3]. Cap the count at about 9 [PL-7]. Tasks in the same wave touch disjoint files [PL-4].
Before build: run the symptom check. Is this plan aimed at the reported symptom or a neighbouring one? Ask it as a ranking question [PL-1].
Exit: the plan file is saved and the task list is parsed. Build iterates over this list and never over a hardcoded one [PL-3].

## 6. Stage 4: build

Entry: one plan task plus the preamble.
Agents: one per task, at the build tier (mid model, medium effort) [CO-1].
Work: follow the builder rule in `references/verification.md`. Execute the task exactly, tick its boxes, run its tests, commit only its own files, and report any deviation [BD-1, BD-2].
Exit: a commit on the issue branch, with trailers, and a report listing the commands run and their real output.

## 7. Stage 5: verify and repair

Entry: the task, the builder's commit, and the spec.
Agents: one FRESH verifier per task, at the strongest tier, never cheapened [VF-1, VF-6].
Work: run the rubric in `references/verification.md`, including the negative control [VF-3].
Exit: passed, or a repair. Repairs get up to 3 rounds, one tier UP from build, using the verifier's `unfinished_work` verbatim [VF-5]. After the third failure, the task is reported as failed with its evidence. It is never reported as a pass.

## 8. Stage 6: gates

Entry: all tasks are either verified or reported failed.
Agents: 1, mid tier at medium effort or higher, because it can commit [TG-32].
Work: follow `references/tests-and-gates.md`. Run the full gate list from the profile, save the logs, grep for failures, compare against the known-flaky set, and fix and commit as it goes. Weakening a test is not allowed [TG-6, TG-7].
Exit: a structured gates result. Skipped gates are reported as skipped [TG-10].

## 9. Stage 7: docs

Entry: the gates result and the list of changed files.
Agents: 1, mid tier. A verifier checks its claims [VF-6].
Work: follow `references/docs.md`. Make the docs-impact decision, update the user and developer docs, put the changelog entry under Unreleased, and update the indexes [DC-1, DC-4].
Exit: either docs are updated or "no docs needed" is recorded with a real justification.

## 10. Stage 8: summary and stop

Return the structured result. You (the main loop) then run the post-run audit from SKILL.md Step 4, write the plain-English summary (`references/communication.md`) and stop. Version bumps, the final commit to the main line, push and release all wait for the human [HG-1, GR-9].

## 11. Automation around the loop

These rules apply if the project runs bots for triage, queue ranking or housekeeping (closing issues, nudges) next to this skill.

- **Loop-safe bots.** A bot skips events it authored itself, changes only labels and comments (never the body, which emits "edited"), and serialises jobs that write shared state [OR-19]. Know the platform's event semantics. On GitHub, a label change emits `labeled`, not `edited` [OR-20].
- **AI steps fail soft.** On a missing key, an API error or a refusal, the item stays "pending", and a deterministic job lists it for a human [OR-21]. Validate the shape of AI output even when the API promises structure. Vendor endpoints die silently, for example by answering every request with HTTP 200 and the text "OK" [OR-22].
- **Deterministic ranking and closing.** Sort by the labels the AI applied, break ties oldest first, and upsert one sticky comment found by an HTML marker. AI is confined to one classification step [OR-23]. When re-classifying, clear the earlier mutually exclusive labels first [OR-24].
- **Map role names to real labels in one table.** This skill's canonical roles (needs-triage, ready, in-progress, blocked, keep-open) map to the repo's real strings through `labels:` in the profile [OR-25].
- **Ranking the queue.** Include the untriaged items that the default order cannot rank [PL-11]. Re-rank every one to three resolved items in a long campaign [PL-12]. Track every follow-up as a real issue [PL-13]. Deferred work stays rankable at a low priority and is never hidden [SP-2]. Asked "what next?", rank the queue and act on a clear winner. See `references/communication.md` [CM-6]. When the order surprises the human, audit its inputs (labels, priority fields, the rubric) before defending it [PL-14].
- **Surface-only triage.** Triage classifies, labels and ranks. It never fixes code or opens PRs [HG-13]. The pinned queue issue and anything labelled keep-open are protected from automated closing [HG-14].
