# Build, verify, repair

Implementers' self-reports are optimistic, so every task gets a fresh adversarial verifier the moment it finishes [VF-1]. This file holds the builder rule, the build pitfalls the verifier also checks for, the verifier rubric, the repair loop, and the extra checks for UI, data, deploys and docs.

## Contents

1. Builder rule
2. Build pitfalls (builder avoids, verifier checks)
3. Verifier prompt and rubric
4. Negative controls
5. Verdict schema and repair loop
6. UI acceptance and the VIEW lens
7. Data, races, experiments
8. Deploy and environment checks
9. Verifying the verifiers

---

## 1. Builder rule

Put this in every build prompt:

> Execute the plan's task exactly. Run its tests, tick its checkboxes, and commit the ticked plan file together with your own files, by explicit path, in the task commit. If the plan's code does not compile against reality, fix it to match and REPORT the deviation. Report the commands you ran and their real output. Only do the task you are given: do not invent additional work [BD-1, BD-2].

Commit ids in the builder's report must be real SHAs (`/^[0-9a-f]{7,40}$/`), checked in code. A report with a placeholder such as "HEAD of <branch>" is a builder failure and goes straight to repair, without a verifier [BD-22].

Ticks left uncommitted dirty the tree and turn up as noise in every verifier report, so they go in the task commit, or the plan drops checkboxes [BD-21]. The middle rule is the one that worked. Builders that redesigned freely broke parallel slices, and builders that applied broken code blindly broke the build.

- **Zero new dependencies by default.** If one seems necessary, stop and note it. When it is allowed, pin the exact version and install it in the worktree [BD-15].
- **Pin validated external model ids** in code and in every environment, list the known-bad ids, and keep a real-API check [BD-13].

## 2. Build pitfalls

Each of these shipped at least once. The builder avoids them, and the verifier greps for them.

| Pitfall | Rule | Lesson |
|---|---|---|
| Validators that strip unknown fields drop a new field silently | When you add a field, grep every write path and every validator | [BD-3] |
| A refactor removes a trigger and the side effect is orphaned | Wire the replacement explicitly and test the downstream effect | [BD-4] |
| A warning indicator never renders | Never gate an indicator on a field a cache can fill | [BD-5] |
| Mocked modules break when they gain an export, and mocks hide real behaviour | Prefer real collaborators. Where a module is mocked, update every mock of it when you add an export | [BD-6] |
| A reused page shows the previous record's data | Re-read every derived or decrypted field when the route param changes | [BD-7] |
| A promise chain fails silently | Give every `void promise.then(...)` a rejection handler | [BD-8] |
| A literal route never matches | Check registration order. A parameterised route registered first swallows the literal | [BD-9] |
| A reactive effect loops forever and hangs a test file | Use a once-per-episode latch that re-arms only on a genuine completion event | [BD-10] |
| A feature is silently off in production | Do not skip silently on missing config ("not_configured"). Fail loudly or show it in a health view | [BD-11] |
| An import nulls every date | Detect formats from the column's actual values and never hardcode one | [BD-12] |
| A fix never reaches users | Bust stale caches and service workers, so clients actually get the new code | [BD-14] |
| Automation is untestable | Split it into pure, unit-tested decision logic plus a thin I/O runner | [BD-16] |
| "What does this function do today?" means archaeology | Each re-appliable definition (DB function, view, config block) lives in exactly one current-form file | [BD-17] |
| A disabled create-time check moves the failure to first use | Require a test that exercises each new item | [BD-18] |
| Configs that must agree drift (proxy routes, dev proxy, edge) | Keep ONE list, generate the rest, and guard new entries | [BD-19] |
| A business rule is restated inline and drifts | Define it in one view or function, with a static guard against restatement | [BD-20] |

## 3. Verifier prompt and rubric

Every verifier is FRESH (it shares no context with the builder), uses the strongest model, and is never cheapened [VF-1, VF-6]. Prompt it like this:

> You did not write this. Assume it is wrong until your own commands prove otherwise. Never trust the implementer's report. Fix nothing. If you are unsure, fail. The authority order is mockup > spec > plan.

The verifier gets the commit SHAs, the task, its acceptance criteria and the builder's declared deviations. It never gets the builder's report: the claims in it anchor the verdict [VF-1].

Checklist. Each item exists because a verifier once missed that class of defect [VF-2]:

1. The files changed as described, and **the scope is limited to the task's files** (`git show --stat HEAD`) [PL-4].
2. The task's named tests exist AND pass when **you** run them. Only those: the full suites and e2e belong to the gates stage, unless a named test is e2e [CO-9].
3. Typecheck and lint are clean for the touched packages.
4. A commit exists with the required trailers and issue tag [GR-4].
5. The diff contains no `TODO`, `FIXME` or "not implemented".
6. The plan's checkboxes are ticked in a commit. Uncommitted ticks in the working tree belong to another live task: ignore them, they are not a finding [BD-21].
7. The law checks pass, by grep [VF-25]. Examples: forbidden user-facing vocabulary, destructive DDL (`drop`, `truncate`, `delete` in auto-run migrations [DI-25]), new unique constraints, secrets in output, raw colours instead of tokens, sensitive identifiers in fixtures, commits and docs [PS-1].
8. **The negative control** (section 4).
9. **The reported symptom is resolved.** Reason explicitly about the reporter's actual (anonymised) rows [VF-8].
10. The claims in docs and comments are true. The verifier checks prose as well as code [VF-6, DC-3].
11. The feature is reachable: there is a link or route to it, and it is not blocked by another path [VF-24].
12. A gate is checked in both directions: it does not leak onto routes it should not cover, AND it covers every route it should [VF-12].
13. None of the build pitfalls in section 2 appear in the diff.
14. Each test drives the interface it names. A test that imports internals (private helpers, module internals no caller uses) is a `test-gap` finding [DG-14].
15. **Privacy and security behaviour.** Does the diff change what is on screen or in the DOM when the app is locked or logged out, or how long data lives? Any such change that no decided spec row or run decision covers goes in `privacy_security_change`. The decide step settles it when allowed (one repair applies the choice); otherwise the task stops as `decision_required`, with no repair [SP-18, SP-20].

## 4. Negative controls

**Prove the regression test can fail** [VF-3]. Stash or revert the fix, or plant a bad input, and watch the test go red. Then restore. A test that passes on the old code and the new code alike proves nothing.

**One control per acceptance row, not per task** [VF-3]. For each row, remove only the guard that row is about and run its tests. Each row is recorded in `negative_controls` as `red`, `green` or `infra_error`. A `green` row, or no controls at all, turns a pass into a repair. One proven row says nothing about the next: a mutation check once found an eligibility row whose own tests stayed green with its guard removed.

**An infrastructure error is never RED** [IS-16]. After the install, run the profile's `commands.post_install` (codegen, framework sync). A test that cannot load (module not found, missing codegen, install error) is a setup problem: fix it and rerun. If you cannot, record `infra_error`, which reaches the findings as a test gap.

- In a shared worktree, do it in a throwaway detached worktree, never by stashing where other tasks are live. That throwaway worktree gets a **real dependency install** (a frozen-lockfile install), never dependency directories symlinked from another checkout. Link only the env and secrets [IS-16]. Symlinked dependencies resolve modules from the other checkout, module mocks break, and the control goes red for the wrong reason.

- Assertions must fail on the bad outcome, not merely "not throw".
- The component under test must not be mocked.
- **Look for the test that enshrined the bug**, for example an "anti-collision" test that used two genuinely different people and so never tested the dangerous same-person case [DG-27].
- For race fixes, the race test fails reliably before the fix and passes repeatedly after it, with no retries. Failing 3/3 before and passing 30/30 after is the standard [VF-22].

## 5. Verdict schema and repair loop

```json
{
  "passed": false,
  "checks": [{"check": "negative control", "ok": false, "detail": "test still green with fix reverted"}],
  "unfinished_work": "precise, naming files and symbols",
  "code_defect": true,
  "non_blocking_findings": [{"severity": "defect", "finding": "settings page stays on Loading when the list is empty (settings/+page.svelte:42)"}],
  "summary": "one line"
}
```

Every non-blocking finding carries a severity: `defect` (wrong behaviour a user could hit, wrong persisted state, or a security or eligibility hole in this branch's code; never filed as a follow-up), `test-gap`, `doc-copy` (wrong or misleading text), `follow-up` (real but out of scope) or `bookkeeping`. The run merges all verifiers' findings into one deduped list, keeping the most severe tag on a duplicate, and the summary lists defects and test gaps first [VF-31].

**Stale findings are dropped.** A finding that is true only until a later stage runs ("acceptance pending", "not yet committed") carries `until_stage`; the merge drops it once that stage passed and counts it in `metrics.superseded_findings` [VF-32].

**A pass that carries a `defect` finding in the task's own files is a rejection.** The run turns it into `unfinished_work` and sends it to repair, so a defect never rides along on a green verdict [VF-11].

**A pass whose `unfinished_work` names only files outside the task is a side finding.** The run moves it into the findings list as a follow-up for the harvest and clears it from the verdict, so it never fails the task or reaches the task's repair prompt [VF-34].

`code_defect` is true only for real logic defects, not bookkeeping such as a missing trailer or an unticked box. Keeping the two apart keeps the repair-rate metric honest [VF-4, CO-2].

**Repair loop** [VF-5]:
- Run up to 3 rounds of repair and re-verify per task.
- Repair runs one model tier UP from build. The task has already failed once on the cheaper model, and repairing on the same tier repeats the same mistake.
- The repair prompt is: "A previous attempt was rejected. Fix exactly this:" followed by `unfinished_work`, verbatim.
- A null verdict (the verifier died) means re-verify, never pass [OR-9].
- After the third failure, report the task as failed, with the evidence.
- **A behaviour choice stops the loop.** A failing verdict names `failing_test`, `failure_cause` and `behaviour_choice`. When the same test fails for the same cause after two repairs and the cause is an undecided product behaviour, the decide step settles it if it may (the next repair implements the chosen behaviour); otherwise the task stops as `decision_required` with the question for the human. No third repair [VF-5, SP-20].

**Re-triage "non-blocking" findings by severity**, from the merged list, defects and test gaps first. Several turn out to be real: a 500 where a 400 belonged, an empty input reaching a payment provider as an opaque 502, a silent fail-open, a page stuck on Loading [VF-11, VF-31].

**Docs get one repair round.** When the docs verifier rejects the docs, one repair agent fixes the docs to match the code and a second verifier checks them. Still rejected, the run is `partial` with reason "docs not verified", never `verified` [VF-33].

**Gates commits get their own verifier.** When the gates agent commits a fix, one fresh verifier reviews `git diff <head_before>..HEAD`: each hunk fixes a named gate failure in this branch's files, and nothing was weakened. The result is `gates_commits_verified` [TG-7].

**Never trust a subagent's claims.** Re-run the gates yourself, independently, after a run reports green, and check the tree [VF-10]. One re-run found nine broken test files, and a ship agent once reported "zero commits" that actually existed.

**Cross-check the plan against the tree before handoff.** A planned unit with no implementation is a STOP [VF-13].

**Block dead features.** A release agent that refuses to ship docs describing behaviour that cannot fire, even with green gates, is the standard to hold [VF-14].

**After any background or multi-agent run**, run `git status` and `git ls-files -d`. Restore unexpected deletions without touching new work, re-run the gates, and commit explicit paths [VF-15].

## 6. UI acceptance and the VIEW lens

- **Drive the real page** [VF-7]. Seed the user's data shape, click the real control, and assert on the rendered DOM. Every UI state must render something visible [UX-4]. Two dedup fixes had green gates while production showed a blank section after the click.
- **Use the reporter's real data shape**, anonymised, as the acceptance fixture [VF-8].
- **Nothing is fixed until the reporter confirms it** in their environment. Keep the issue open until then [VF-7, DG-15].
- **Take screenshots at mobile and desktop widths, before and after the change** [VF-23]. Bugs are often viewport-specific.
- **When test doubles cannot reproduce a real-device or real-vendor bug**, for example a virtual authenticator or a mocked SDK, say the fix is pending real-device verification [VF-9].
- **Render diagrams and visual docs in a real browser** to check that the diagram renders, labels meet a minimum size, and dialogs open, close on Escape and return focus [VF-27].
- **The VIEW lens** runs when the spec sets `user_visible: true`: one agent, after the build tasks verify and before the gates [VF-23]. It builds nothing.
  - It starts the app on the run's ports with test data only, screenshots every `view_targets` screen before (the base commit, in a control worktree with a real install [IS-16]) and after (the run's worktree), at 390×844 and 1440×900, plus the states the spec names: locked, loading, empty, error.
  - It judges the after shots against the profile's `docs.design` and `references/packs/ux.md`, comparing them with the before shots, and returns findings with `cause` (branch or pre-existing), a severity, a kind and the screenshot paths.
  - A `defect` the branch caused goes to repair like a verifier rejection, one round only. Still there after it, the run ends `decision_required` with the shots. A pre-existing finding is never repaired here: it flows to the harvest as a side issue [OR-27].
  - Screenshots go under `<scratch>/<issue>/screenshots`, outside the worktree, and are never committed [IS-19]. Its servers stop by process group, proved with `ps` [IS-20].
- **Check generated links** (redirect and base URLs) point at a host the user can reach before handing one over. Verify with a dedicated test account, so verification does not use up the user's one-time tokens [VF-19].

## 7. Data, races, experiments

- **Prove data scripts idempotent.** Re-run in dry mode right after the real run and expect zero writes. On synthetic data, run a deterministic double pass: the second pass creates nothing, yet a genuine second record still lands [VF-18].
- **Build a discrepancy detector** that compares your computed totals with the totals the source states about itself. It catches both over- and under-counting [VF-21].
- **Declare an experiment's keep rule up front.** Discard changes whose measured gain is below the bar, and close on measurement, not opinion [VF-20].
- **Have a domain expert validate domain content.** The builder is not the validator outside their own field [VF-28].

## 8. Deploy and environment checks

Use these when the issue touches deploy machinery, or when the human asks you to confirm a deploy:

- **Confirm production against the real app's health or version endpoint** plus the deploy log, never against a sibling site that may embed the main branch's version [VF-16].
- **After a deploy, probe the new route itself**, expecting its real status and content type, not just /health. The health check can flip before the proxy reloads [VF-17].
- **Long-lived cache headers apply to 404 fallbacks too.** Verify assets at the origin first, and avoid immutable caching on paths that may be requested before they exist [VF-29].
- **"Tests passed" is not "deploy works".** Keep build, migrate and health-check failures aborting on the host even after a CI gate exists [VF-30].

## 9. Verifying the verifiers

- **Self-test the checker.** Plant known defects and confirm the review tooling surfaces them before you trust it [VF-26].
- **Encode invariants as greppable checks backed by guard tests**, so they do not live only in prose [VF-25, TG-23].
