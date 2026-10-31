# Spec: <issue id> <title in glossary terms>

- Issue: <link>. Attempt: <N> on this surface (earlier: <links>)
- Report: <path to verbatim report> · Screenshots: <paths, kept local>
- Agent brief: <path to the saved "## Agent Brief" comment | none>. Its acceptance criteria go under Tests and its out-of-scope list under Scope.
- Size: <small | medium | large> · Date: <YYYY-MM-DD>

## Symptom (verbatim)

> <the reporter's words, scrubbed of identifiers. Refer to records as opaque id prefix + date + type>

Distinguishing question asked of the reporter: <question → answer, or "assumed: …">

## Root cause

<The mechanism, with file:line. How it was confirmed: probe/test, measured values.>

Rankings used:

| Option | p | Verdict |
|---|---|---|
| <cause a> | 0.00 | confirmed / ruled out / open |

Overruled by evidence: <none | which ranking, and the evidence that won>

If no diagnosed mechanism produces the symptom on the reported data, say so here, and specify either the measurement still needed or a fix that is correct regardless plus in-product evidence capture.

## Fix

- Shared seam: <the one place every caller routes through>
- Change: <the smallest change that fully resolves the symptom>
- Siblings of the same class found: <list, and whether they are fixed here or filed>
- What it newly arms downstream: <constraints / indexes / triggers, or "nothing">
- Works with already-deployed state: <how existing users and data are unaffected>

## Load-bearing invariant (data-sensitive changes)

<"absent stamp = adopt, never wipe">. Catastrophic failure mode: <…>. Its tests are the gate.

## Callers of a changed shared component

Only when a shared component's default or behaviour changes. Walk each caller's flow, not just its import. Any "unsure" row is a question for the human before build [SP-17].

| Caller | Flow before | Flow after | Intended? (yes / no / unsure) |
|---|---|---|---|

## What changes for the user

<one or two plain sentences; the run's summary quotes this line>

## User-facing copy (exact)

| Where | Text |
|---|---|

## Tests

Each test names the interface it drives (page, route, CLI, public function), never an internal helper.

- Regression = the diagnosis reproduction, at the highest level that still reproduces the reported symptom; it fails before the fix: <name, file, interface>. Negative control: <how the verifier will make it fail>
- Acceptance on the reporter's data shape (anonymised): <fixture, interface>
- UI: real page, mobile + desktop screenshots: <yes / n/a>

## Scope

- In scope: <…>
- EXPLICITLY OUT OF SCOPE: <…> (follow-up issues: <#…>)
- Cannot be validated by agents (manual check): <real device, vendor, hardware>

## Decisions

- ADRs read: <…>. Contradicts: <none | "Contradicts ADR-NNNN … but worth reopening because …">
- Assumptions made instead of asking: <…>

## Docs impact

<the files to update | none: real justification>. "none" means no docs agent runs, so the justification has to hold.

## Risks

<honest risks>

## Laws for this change

1. <project law>
2. <task-specific law the verifier greps for>
