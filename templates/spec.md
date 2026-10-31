# Spec: <issue id> <title in glossary terms>

- Issue: <link>. Attempt: <N> on this surface (earlier: <links>)
- Report: <path to verbatim report> · Screenshots: <paths, kept local>
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

## User-facing copy (exact)

| Where | Text |
|---|---|

## Tests

- Regression (fails before the fix): <name, file>. Negative control: <how the verifier will make it fail>
- Acceptance on the reporter's data shape (anonymised): <fixture>
- UI: real page, mobile + desktop screenshots: <yes / n/a>

## Scope

- In scope: <…>
- EXPLICITLY OUT OF SCOPE: <…> (follow-up issues: <#…>)
- Cannot be validated by agents (manual check): <real device, vendor, hardware>

## Decisions

- ADRs read: <…>. Contradicts: <none | "Contradicts ADR-NNNN … but worth reopening because …">
- Assumptions made instead of asking: <…>

## Docs impact

<updated: which files | none: real justification>

## Risks

<honest risks>

## Laws for this change

1. <project law>
2. <task-specific law the verifier greps for>
