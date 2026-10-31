# Spec and plan

The spec decides WHAT changes and where. The plan writes the code each build task will apply. Both are design artifacts saved in the repo at predictable paths (`<spec_dir>/<date>-<slug>/spec.md` and `plan.md`) and linked from an index [DC-5]. They are not the issue queue. Live issue state stays in the tracker and is never mirrored in local Markdown [SP-10].

Templates: `templates/spec.md` and `templates/plan.md`.

## Contents

1. Before the spec
2. Spec rules
3. Data-sensitive and destructive changes
4. Plan rules
5. Task sizing and ordering
6. The symptom check before build

---

## 1. Before the spec

- **Multi-slice features get grilled first.** Before speccing the next slice, test it against the glossary, the ADRs and the original design. Then run spec, plan and build in one background run [SP-1]. Without this, later slices drift. In one case, grilling a drifted slice produced three ADRs and a new slice order.
- **Feature issues get a design grill, and plain bugs go straight to the pipeline** [SP-2].
- **Check the glossary.** Use the project's terms in titles, hypotheses, test names and the spec. A missing term is a signal: either you are inventing language, or there is a real gap to record [SP-8]. Before introducing a new term, check that it does not collide with an existing one, since near-identical names for different concepts confuse users and agents [SP-9].
- **Give the spec agent a file map** of the key files and an exemplar spec to copy the house format from [SP-13].

## 2. Spec rules

1. **Root cause, at the shared seam.** Fix the place every caller routes through, using the smallest change that fully resolves the symptom [SP-4]. When three input surfaces share one buggy helper, the fix goes in the helper.
2. **Say so when nothing fits.** If no diagnosed mechanism actually produces the reported symptom on the reported data, the spec says so. It then either specifies the measurement still needed, or specifies a fix that is correct regardless, together with in-product evidence capture, so the next report carries its own proof [SP-3, DG-28]. Never paper over the gap.
3. **Exact user-facing copy.** Write the actual strings. Use one canonical term per concept and no developer words [UX-14].
4. **Tests.** The regression test is the diagnosis reproduction, at the highest level that still reproduces the reported symptom, and it fails before the fix [DG-14]. Each test names the interface it drives (page, route, CLI, public function), and none imports internals. Name the reporter's anonymised data shape as an acceptance fixture [VF-8, TG-14]. If the issue carries an agent brief, its acceptance criteria join these.
5. **Docs impact**, decided now [DC-1].
6. **Scope boundaries.** List what is in scope and what is EXPLICITLY OUT OF SCOPE. List what the agent cannot validate (real devices, hardware, vendor behaviour) as needing a manual check, and never fake it [SP-6, VF-9]. Keep scope to what was reported, and file adjacent cleanup as separate, numbered follow-up issues [SP-5].
7. **Contradicting an ADR.** Write "Contradicts ADR-NNNN … but worth reopening because …". Never silently override a decision [SP-7, PF-5].
8. **Several inputs, one store.** When several inputs feed one capability (import, manual entry, voice), each input gets its own spec, and all of them write to one shared, source-agnostic store [SP-15].
9. **Keep "applies to this user?" separate from "has this user paid?".** Applicability hides a module. Entitlement locks it [SP-16].
10. **Prefer what works with already-deployed state.** A "cleaner" fix that strands existing users or data is worse [PL-8]. Flipping a credential setting would have stranded every passkey already enrolled on real phones.
11. **Delete rather than repair low-value broken paths** [PL-9]. Deleting code is the cheapest fix.
12. **Honest risks**, including what the change newly arms downstream [DG-26].
13. **Assumptions.** Every pre-flight question you did not ask gets written here with the answer you assumed [PF-3].
14. **A shared component's default changes: walk every caller's flow.** Fill the spec's caller table (caller, flow before, flow after, intended yes/no/unsure; `caller_flows` in the run). Listing the callers is not enough: walk what each one now does. Any "unsure" row stops the run at spec as `decision_required` for the human, never a build assumption [SP-17]. A sheet that turned modal by default once made one caller's question block the screen behind it, and a tap outside discarded unsaved edits.
15. **Privacy and security behaviour is the human's call.** If the change alters what is on screen or in the DOM when the app is locked or logged out, or how long data lives (caches, storage, retention, logs), set `privacy_security_change` and add one `privacy_security_rows` row per surface (surface, before, after, `decision_ref`). A row is settled only by a human answer passed in as `decisions`, cited by index; until then the run stops at spec as `decision_required`. Never settle it with a ranking [SP-18].
16. **User-visible?** Set `user_visible` when the change alters what any user sees, and list each affected screen and state in `view_targets`. That turns on the VIEW lens (`references/verification.md` §6).

## 3. Data-sensitive and destructive changes

- **Never build a destructive path from a vague request.** The diagnosis produces a "decision required" menu, and each option says what survives and what is lost. The human chooses [SP-11].
- **Write the load-bearing invariant and its catastrophic failure mode into the spec**, for example "absent stamp = adopt, never wipe", and make its tests the gate [SP-12]. The obvious implementation is often the catastrophic one.
- Read `references/privacy.md` and the data-integrity section of `references/design-principles.md` before speccing anything that touches user records.

## 4. Plan rules

1. **The plan contains actual code.** Give it top-tier reasoning. Write exact signatures and the code itself. The root-fix task gets checkbox test-first steps: write the failing test, run it and SEE it fail, implement, see it pass, run checks, commit. Other tasks add tests where they change behaviour. Ban "TBD", "add appropriate handling" and "similar to Task N" [PL-2]. A concrete plan lets a cheaper builder simply apply it.
2. **Return the units as structured data.** Each unit has `id`, `title`, `files`, `depends_on`, `instructions` and `acceptance`. The plan is also saved in the repo, and the build iterates over the returned list. Never hardcode build units in a script written before the plan exists [PL-3]. Hardcoded lists drop units, and half-features nearly ship.
3. **Vertical slices, scheduled by files.** Each task delivers observable behaviour through a real interface; never split by layer. File overlap is used only to schedule: tasks that share a file never run in the same wave, and the verifier checks scope with `git show --stat HEAD` [PL-4, OR-11].
4. **Small tasks, marked for independence.** Independent tasks run in parallel, dependent ones in series, and each gets its own verifier and repair loop [PL-5]. A `depends_on` edge means a task needs another's code, not just its order.
5. **Report the wave count.** The run computes the waves the scheduler would run. A medium plan with more than two tasks and one task per wave goes back ONCE for a re-plan that asks for parallelism, or for `serial_reason`, the real dependency in one sentence [PL-15]. A nine-task plan once ran as nine waves of one.
6. **Per-task laws. Copy the relevant laws into each task, so the verifier can grep for them [SP-14, VF-25].
7. **Reuse the shared primitives. Tell build tasks which shared components exist (`ui/` controls, helpers), so they do not re-implement them [UX-6].

## 5. Task sizing and ordering

- **Split big issues into linked sub-issues and fix the smallest first** [PL-6].
- **Cap the count.** One task for a small issue, 3 to 9 for medium, and slice hard at about 10 [PL-7].
- **Root fix first** [PL-7], so the user's symptom is fixed even if later tasks fail. Docs belong to the docs stage, not to a task.
- **Small issues** get one combined spec-and-plan agent. The spec goes in the root-fix commit body unless the profile sets `small_spec_file: true`.
- **Architecture reviews** follow their own flow: scan the whole codebase, produce a visual report, grill the chosen candidate against the code, record an ADR, file an issue, then build [PL-10]. A "strong" candidate can collapse under grilling.

## 6. The symptom check before build

When no diagnosis measured a reproduction (confidence below high, or no measured evidence), ask the ranker before the build: "Does this plan fix <reported symptom, verbatim> or a neighbouring symptom?" Give it the real neighbours as options [PL-1]. A build is the most expensive place to discover the mismatch. The verdict is computed from the probabilities, not taken from the model: the top two within 0.2 is close. If it is close, or picks a neighbour, go back to diagnosis. A measured repro already answers the question, so the check is skipped.
