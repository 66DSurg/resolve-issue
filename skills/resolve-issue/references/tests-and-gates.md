# Tests and gates

The gates stage runs exactly the gate list built from the profile, in order, and reports what passed, failed and was skipped [TG-6]. It may fix only failures it can tie to files this branch changed, one commit per fix, and a fresh verifier then reviews those commits. Failures it cannot tie to the branch go in `remaining_failures`, unchanged. The main loop's own re-run of the gates (SKILL.md Step 4) stays the authoritative one [VF-10]. It can commit, so give it at least medium effort and a model that follows instructions reliably [TG-32, CO-3].

## Contents

1. Running the gates
2. Reading results honestly
3. What you may and may not change
4. Fixtures and test data
5. Guard tests (turning slips into facts)
6. CI and deploy gating (when the issue touches CI)

---

## 1. Running the gates

- **Run every gate layer before every commit**: typecheck, lint/format, unit, e2e, build and doc checks. Put the test counts in the commit message [TG-1].
- **After any edit, run the whole affected suite**, not only the file you touched [TG-4].
- **After merging two branches that were each green**, re-run the full gates, e2e included, on the combined result [TG-5].
- **Decide per issue whether e2e runs inside the run.** If it needs shared resources (a DB, default ports) that another worktree is using, skip it there and run it from the main checkout at merge. Report "skipped" as skipped, never as passed [TG-10]. When it does run in a worktree, use the isolated runner in `references/isolation.md` [IS-4].
- **When the test runner is unavailable**, fall back to typecheck, build and a static diff review. Rely on CI for the definitive run, and say plainly that this is what you did [TG-12].
- **Run DB-touching tests against a real database** before calling them done [TG-15]. Mocks pass while the real DB rejects the operation through row-level security or constraints.
- **If CI checks run only on pull requests** and you commit straight to the main line, run those checks locally in every gate pass [TG-22].
- **A check that needs a PR or CI context to run at all** (it reads PR metadata or CI-only variables) is not a local gate. It goes in the profile's `ci_only` list, the gates stage reports it as ci_only, and a local failure of it never makes the run red [TG-34].
- **Stub paid external calls** in tests by default and assert zero billed calls [CO-4].
- **Do not run a suite while another agent rebuilds the same frontend**, because it causes spurious failures [IS-12].

## 2. Reading results honestly

- **Save the FULL output to a file**, grep all of it for `failed` and `flaky`, and compare the passed count with the previous run. Never judge from the tail [TG-2]. Some runners print "N failed" above "N passed".

  ```bash
  <test cmd> > "$LOG" 2>&1; status=$?
  command grep -nE '\b[0-9]+ (failed|flaky)\b|FAIL' "$LOG"; echo "runner exit: $status"
  ```
- **Tell your own command's exit code apart from the test result** [TG-3]. A trailing grep that finds nothing exits 1, and `grep -c` printing 0 breaks `&&` chains.
- **Compare the failing SET against the documented known-flaky set** in the profile. A failure is non-blocking only if it matches the known set. A new failure in the touched area blocks [TG-8, DG-18].
- **To diagnose red e2e specs**, run each failing spec alone and in the full run. Passing alone but failing in the run means ordering or shared state. Failing alone means the spec has its own cause. Require green twice in a row [TG-9].
- **Tell agents which shared-environment failures are expected** and not theirs to fix. They report them and change nothing [TG-11].
- **Long tests that wait on external APIs while holding DB connections can exhaust the pool.** Raise the limits, close connections between tests, or run those specs one at a time [TG-16].
- **If a concurrent session deploys without tests**, treat staging and production as suspect and run the whole suite once things settle [TG-33].

Gates result schema:

```json
{
  "all_green": false,
  "gates": [{"command": "...", "passed": true, "skipped": false, "output_tail": "...", "log_path": "..."}],
  "failures_fixed": ["..."],
  "remaining_failures": ["spec name + first error line"],
  "known_flaky_matched": ["..."]
}
```

## 3. What you may and may not change

**Change a TEST only when it asserts behaviour the app deliberately no longer has, and cite the commit.** Never skip, retry-wrap, raise timeouts, loosen assertions or weaken a guard to go green. If that seems necessary, stop and report [TG-7]. Pressure to go green tempts agents into cheating, and verifiers reject it.

## 4. Fixtures and test data

- **Fixtures copy REAL formats**: date strings, separators, totals rows, embedded sub-tables. They satisfy real constraints and model the scenario they claim, so "three different people" get three different identities [TG-14]. A green gate once hid a date bug that imported 0 of 105 real rows.
- **A dry run on a real, scrubbed file is the true gate for ingestion code.** Print aggregates only [TG-14, PS-6].
- **Fresh-fixture e2e never reproduces legacy-data bugs.** When a feature adds a field that other code depends on, ship a backfill, defensive handling of the absent value, and a legacy-state fixture [TG-13].
- **Fixture names are obviously synthetic** [PS-4].

## 5. Guard tests

**Turn each repeated slip into a guard test** [TG-23]. Examples: version consistency, route-to-proxy allowlist, raw controls outside the shared primitives, dev tooling imported into the app, retired identifiers, allowed public-form fields. Conventions drift, and a failing test is a fact.

- **A shared component plus documentation is not enough.** Add a guard that fails when a page re-implements the control [TG-24, UX-6].
- **Allowlists of existing violations are shrink-only.** Any count change other than downward fails. Aim to delete the allowlist [TG-25].
- **Exemption lists clean themselves.** An exemption that matches nothing fails the check [TG-26].
- **Every generated file has a `--check` mode** that CI runs [TG-27].
- **Automation that acts on shared state runs its own unit tests first** and refuses to act if they fail [TG-28].

## 6. CI and deploy gating

Apply these when the issue touches CI or deploy config, or when you notice the gap and file it as a follow-up.

- **CI must gate deploys on tests.** If the platform cannot enforce a required check, put the gate in the deploy script: deploy only commits that CI stamped green with an immutable per-commit marker ref (for example `refs/ci-green/<sha>`), never a moving branch [TG-17].
- **A green badge does not prove the suite ran.** Check that the job actually executed and reported counts, and make critical jobs required [TG-18].
- **Add a new suite as non-required** and promote it after about 10 consecutive green runs [TG-19].
- **Give heavy jobs a timeout, treat a timeout as red**, and shard large browser suites before they wedge [TG-20].
- **Use `if: !cancelled()`** (or the platform's equivalent) for checks that must always run [TG-21].
- **Give checks that depend on history or tags a full fetch** (`fetch-depth: 0`), and say what a shallow clone skips [TG-29].
- **When a branch push and a tag push hit the same commit, queue** the CI runs instead of cancelling one [TG-30].
- **Lint deploy and shell scripts in CI**, for example with shellcheck [TG-31].
- **Pin the CI runtime version** to exactly what the hosts run [IS-14].
