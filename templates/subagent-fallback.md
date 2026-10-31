# Running the loop with the Agent tool (no Workflow tool)

This is the same pipeline as `templates/workflow.js`, driven by you, the main loop, using the Agent (Task) tool. Copy the prompts from the template's prompt functions. They are plain text and work unchanged. Build the shared preamble once, from the profile, and paste it at the end of every prompt [OR-7].

Where the harness supports it, run each subagent in the background, so the conversation stays free [OR-2].

## Steps

1. **Diagnose.** Launch 1 diagnoser (small) or 2 on different angles (medium and up) in ONE message, so they run in parallel [DG-12]. Use the diagnose prompt, the strongest model and high effort [DG-6]. Ask each to end with the JSON in `references/diagnosis.md` §6.
   - If any diagnosis returns `decision_required`, STOP and show the human the menu [SP-11].
   - `stopAfter: 'diagnose'` ("diagnose only") ends here.
2. **Spec.** Run 1 agent with both diagnoses pasted verbatim. It writes `spec.md` and returns the SPEC JSON.
3. **Plan.** Run 1 agent. It writes `plan.md` and returns the task list as JSON. For a small issue, steps 2 and 3 are one agent writing one task, with the spec in the root-fix commit body (the template's spec-plan prompt). Parse that list, and from here on iterate over it, never over a list you typed [PL-3].
4. **Symptom check**, only when no diagnosis measured a reproduction. Run 1 fresh agent with the fit prompt, then compute the verdict yourself from its probabilities: top two within 0.2 is close. If it is not `reported`, go back to step 1 with what you learned [PL-1]. `stopAfter: 'plan'` ends here; resume at step 5 from the committed plan.
5. **Build in waves.** Keep these in a scratch file, `run-state.json`: `done`, `failed`, `remaining`.
   - Ready = remaining tasks whose `depends_on` are all done, or are ids not in the plan. If none are ready, take the first remaining task alone [OR-8].
   - From the ready tasks, take a wave whose `files` are pairwise disjoint, up to `max_parallel_builders` [PL-4, SZ-2]. A task whose dependency failed is `blocked`, so do not build it.
   - Launch the wave's builders in ONE message (parallel).
6. **Verify each task** as soon as its builder returns, with a FRESH agent (never the builder's context) running the verifier prompt [VF-1]. Give it the SHAs, the task, the acceptance criteria and the builder's declared deviations, never the builder's report. A pass with a `defect` finding in the task's own files counts as a rejection. A missing or garbled verdict means re-verify, never pass [OR-9]. The negative control runs in a throwaway worktree with a real dependency install, never symlinked dependencies [IS-16]. Each builder commits its plan ticks with its task, and verifiers ignore uncommitted ticks [BD-21].
   - Append every verdict's `non_blocking_findings` (each tagged defect, test-gap, doc-copy, follow-up or bookkeeping) to `findings` in `run-state.json`. Dedupe on normalised text and keep the most severe tag [VF-31].
7. **Repair.** On rejection, launch a repair agent one tier up from build, with `unfinished_work` verbatim. Then re-verify. Do at most 3 rounds, then mark the task failed [VF-5].
8. **Completeness**, when the plan has more than one task. Run 1 agent to cross-check the plan's units against the tree, and run a completion build for exactly the missing units [VF-13, OR-10].
9. **Gates.** Run 1 agent with the gates prompt and its fixed command list [TG-6]. If it committed anything, run 1 fresh verifier over `git diff <head_before>..HEAD`. Then re-run the gate commands yourself before you believe the result [VF-10]. Do not run the profile's `ci_only` checks [TG-34].
10. **Docs**, only when the spec's docs impact is not "none". Run 1 agent. If it updated docs, run 1 verifier on the doc claims [VF-6].
11. **Audit and summary.** Do SKILL.md Step 4, then Step 5. Write the summary from `run-state.json` in the shape in `references/communication.md`, not from memory. Work from the merged findings list, defects and test gaps first, and keep the subagents' long outputs in files you reference by path rather than pasting them into the summary [OR-26]. Stop.

## Without any subagents

Run the same steps yourself, in order, writing each stage's output to a file before you start the next one. Then read that file as the next stage's input, so the hand-offs stay verbatim [OR-1]. For every verify step, start from the diff and the spec, not from your memory of building it, and assume your own work is wrong until a command proves otherwise. Self-verification is weaker than a fresh agent, so say in the summary that the verification was done in the same context [CM-3].
