# Diagnosis

Wrong diagnoses were the most expensive failure in the history behind this skill. In one month, three confident hypotheses each cost a full build workflow, and one release shipped a real fix for a bug the reporter did not have [DG-6, DG-15]. Diagnosis needs only one or two agents, so give it the strongest model and the highest effort. It is cheap in absolute terms [DG-6, CO-1].

## Contents

1. The method
2. Rank, don't confirm
3. Probing and measuring
4. Heuristics by symptom
5. Diagnosis prompt template
6. Output schema

---

## 1. The method

Do these five steps in order. Skipping steps produces confident wrong answers [DG-7].

1. **Trace the real code path end to end**, citing file:line, from the entry point the user touched to the place the symptom appears.
2. **List every candidate cause**, your favourite included.
3. **Rank them** (section 2).
4. **Gather evidence that tells the top candidates apart.** Ideally that is a failing test or a scripted reproduction (section 3).
5. **State the confirmed cause**, or say which candidates remain and what measurement would settle them.

Do not fix anything during diagnosis. A fix made during diagnosis hides which hypothesis was tested.

Before you start:
- **Seed the prompt with the history.** Give the agent an "ALREADY RULED OUT, do not re-investigate" list and a "KNOWN SUSPECTS, confirm or eliminate each" list from earlier attempts [DG-10]. If the surface has failed before, say so plainly ("this is the FOURTH attempt") and make the agent read the earlier issues, specs and plans first [DG-11].
- **Pass the verbatim report and screenshots** as file paths [PF-11].
- **Use the project's glossary terms** in hypotheses and test names [SP-8].
- **Search with the real grep binary** (`command grep -rn`, or `rg`) in agent prompts. Shell wrappers can silently skip files they misdetect as binary, for example a source file that contains em-dashes, and a symbol then looks absent when it is not [DG-29].

For medium and larger issues, run **two independent diagnosers on different angles**, for example "what the component receives" and "where two paths diverge". The spec agent reconciles them and reads the code itself wherever they disagree [DG-12].

## 2. Rank, don't confirm

Never ask a model, or yourself, "is my hypothesis right?" Write the symptom, list the candidates, and force a relative choice [DG-1]. On historical bugs with known causes, absolute "is this sound?" judgments scored 2/4 and rated a known-wrong cause sound at 0.77. Relative ranking scored 6/6.

**The ranker.** The profile's `ranker.cmd` can name any command that reads JSON on stdin and prints a probability distribution over the options. That might be a script calling a third-party ranking model, or a cheap model prompted to return probabilities. With no ranker configured, ask a FRESH subagent with no stake in the answer to rank the options and return probabilities. Do not tell it which option is yours.

```json
{
  "context": "background the ranker should assume (no sensitive data)",
  "questions": {
    "cause": {
      "question": "Which mechanism best explains: <symptom, verbatim>?",
      "options": { "a": "...", "b": "...", "c": "..." }
    },
    "fits_report": {
      "question": "Does the planned fix address the reported symptom or a neighbouring one?",
      "options": { "reported": "...", "neighbour_x": "...", "neighbour_y": "..." }
    }
  }
}
```

Rules for the ranker:
- **Refuse fewer than two options**, and batch independent questions into one call [DG-2]. A single option quietly turns the question back into "am I right?".
- **It informs and never decides.** When evidence and ranking disagree, evidence wins. Say so, and record the overrule in the diagnosis and the ADR [DG-3, DC-7]. In one case a ranker put "this repair path never runs" at 0.73, and a measurement then showed the path ran twice per unlock.
- **Re-rank when you learn a fact.** Rankings can flip completely once the new fact is in the prompt. One option fell from 0.65 to 0.00 after a CI-versus-production divergence was added [DG-4].
- **When you score the ranker on past cases**, have someone who does not know the answer write the distractors. The correct option otherwise tends to be the most specific one [DG-5].
- **Keep the ranker a development tool.** It never sees sensitive data, and shipped code must never import it. Enforce that with a guard test [PS-19].
- **Use it at three moments.** Use it before committing to a diagnosis, before launching a build (the plan symptom check [PL-1]), and when ranking the queue [CM-6].

## 3. Probing and measuring

**Do not theorise.** If reading the code cannot settle a question, write a probe: a temporary test or scratch script. Run it and report MEASURED values along with the method [DG-8]. Plausible mechanisms are often wrong. A text-wipe bug blamed on whole-field selection was refuted by watching the caret in a real browser.

**Reproduce through the real entry point.** Use the real page, or a harness that clicks and dumps the DOM, and vary one input at a time until the symptom appears. Keep the reproduction as the regression test and delete the throwaway probes [DG-14]. Logic-level tests miss render-level bugs.

**Settle the deployed state before anything else.** Agents have no production access [PS-5]. Reproduce locally, and list any production-only fact as an open question for the human.

**Confirm the root cause from evidence before blaming anyone.** Read each agent's actual commands and the timing of the symptom [DG-20]. When 259 tracked files vanished after a run, the transcripts showed only read-only commands, which put the cause in the runtime's teardown.

**Read framework source when timing matters.** When behaviour depends on a framework's internal timing, reproduce the bug and read the dependency's source before you pick a fix [DG-24].

## 4. Heuristics by symptom

| Symptom | First move | Lesson |
|---|---|---|
| One path works, its sibling fails | Diff the inputs each sends to the shared dependency. The single difference is usually the whole bug | [DG-13] |
| Silent failure on an endpoint that always reports success (anti-enumeration, fire-and-forget) | Check the cheapest precondition first: does the exact input, byte for byte, match a real record? | [DG-16] |
| Test runner hangs with no output | Run one trivial known-good file. If it passes, the runner is fine, so bisect by file | [DG-17] |
| Several tests red | Read the failing SET. Run exactly those specs on the pre-change commit to see what was already failing | [DG-18] |
| AI/model call returns empty or wrong output with no error | Treat the model as a variable. Swap one model at a time and confirm with a real-API e2e test | [DG-19] |
| A data defect | Confirm it on a second, independent dataset before planning, so one combined correction can fix it | [DG-21] |
| Derived output contradicts itself | Look for a missing upstream input first, and fix inputs before displays | [DG-22] |
| The same kind of fix keeps recurring | Look for the structural cause: the tool, runner or process forcing the bad pattern | [DG-23] |
| A cause is found | Search for siblings of the same class and fix them at the shared seam | [DG-25] |
| A "one-line fix" | Ask what it newly arms downstream (constraints, indexes, triggers), and trace the new failure path | [DG-26] |
| Any bug | Look for the test that asserted the dangerous behaviour as correct | [DG-27] |
| Users keep reporting the same logic as broken | Ship a self-explaining diagnostic ("why weren't these grouped?") with the fix. It must not leak private data | [DG-28] |
| Many specs fail at once, all needing one optional service | Check the environment before the code | [IS-10] |

**Tell the reported symptom from a neighbouring one.** When two plausible symptoms share a surface, the diagnosis names the one question that separates them: which screen, which flow, which rows. The orchestrator asks the reporter that question. The issue stays open until the reporter confirms the fix in their own environment [DG-15, VF-7].

## 5. Diagnosis prompt template

```
You are diagnosing issue <ID>: <title>.
Reported symptom (verbatim): <report file path>. Screenshots: <paths>.
This is attempt <N> on this surface. Read first: <earlier issues/specs/plans>.
ALREADY RULED OUT (do not re-investigate): <list>.
KNOWN SUSPECTS (confirm or eliminate each): <list>.
Your angle: <e.g. "what the component receives" | "where the two paths diverge">.

Method, in order: (1) trace the real code path end to end with file:line;
(2) list every candidate cause, including the obvious one; (3) rank them
with <ranker cmd | a relative ranking you justify>, never a yes/no check;
(4) gather evidence that tells the top candidates apart: write and run a
probe or a failing test, and report measured values and the method;
(5) state the confirmed cause or what is still open and what would settle it.
Do not fix anything. Do not query production. Use command grep or rg.
If evidence contradicts the ranking, evidence wins: say so.
<shared preamble + laws>
```

## 6. Output schema

```json
{
  "method": "what you ran and read",
  "findings": "the mechanism, with file:line",
  "evidence": ["measured value + how it was measured"],
  "candidates": [{"cause": "...", "rank_p": 0.0, "verdict": "confirmed|ruled_out|open", "evidence": "..."}],
  "ruled_out": ["..."],
  "open_questions": ["... and what would settle it"],
  "distinguishing_question": "the one question to ask the reporter, or null",
  "decision_required": null,
  "packs": ["names of domain packs whose trigger this issue meets"],
  "confidence": "high|medium|low"
}
```

`evidence` holds measured values only. When every diagnosis is high-confidence with measured evidence, the run skips the symptom check, so never pad it with reasoning [DG-8]. `packs` switches on the matching files in `references/packs/` for the rest of the run.

`decision_required` is a menu of options when the fix is destructive or loses data. For each option it says what survives and what is lost, and the run stops so the human can choose [SP-11].

**Probes.** Write throwaway probes under the scratch dir, or delete them before returning, and list any left behind [DG-30].
