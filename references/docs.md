# Docs

Docs are part of done. The docs-impact DECISION is made for every change, in the spec [DC-1]. The docs stage runs only when that decision is not "none", so a "none" needs a justification that holds.

## The docs stage

Scope [DC-4]:
1. **User docs** wherever behaviour changed. Keep the content current, not just the version stamp. Write in plain language and state privacy guarantees accurately. A changelog entry does not count as user docs [DC-2].
2. **Developer docs** for the changed code.
3. **The glossary**, only if a term was resolved [SP-8].
4. **The changelog, under `## Unreleased`**, never under the version file or a released section [DC-4, GR-8].
5. **Rebuild the docs, rerun the doc checks, and index any new spec, plan or ADR** in the same change [DC-5].

Rules:
- **Docs must never promise what the code does not do.** Check every sentence against the code. The changelog claims only what shipped. Never claim production is fixed unless the deploy path really ships the change [DC-3]. The verifier checks the claims [VF-6].
- **The PR states "docs updated" or "no docs needed" plus a real justification.** If CI can enforce exactly one choice and a minimum length, it should [DC-1].
- **Add an ADR only when the decision is hard to reverse, surprising, and a real trade-off** [DC-6]. Ground it in cited evidence and never invent a rationale. Record the rankings, the decision and any overrules inside it [DC-7], plus each rejected alternative and why it lost, so a later "why not X?" is answered from the docs [DC-22]. Decide whether to amend an existing ADR or create a new one.
- **Number ADRs sequentially without backfilling gaps.** Give each exactly one owning overview page, and generate the index with a CI check [DC-8].
- **Keep a source-of-truth matrix** [DC-9]: shipped state in the changelog, the version in one VERSION file, decisions in ADRs, terms in the glossary. Do not duplicate release narratives in READMEs or agent-context files. Agent-context files hold operating rules only [DC-20].
- **Doc checkers only verify; someone still writes the docs.** Check the API inventory both ways: every endpoint documented, and every documented endpoint real. API specs may be a subset but never stale [DC-10].
- **Run a link and path checker** over the gateway docs and agent-context files, including paths inside code spans, plus a structure check for the required sections [DC-11].
- **Internal docs**: each shipped slice updates the page that owns what it changed, stamps a "verified" field with the release, and redeploys. Build internal docs strictly (links, ownership, word budgets) [DC-12]. Monitor the deployed docs site's version against VERSION, warning softly and never blocking [DC-13].
- **Keep each external ID or asset manifest in exactly one file**, and drift-check every copy by format, placement and content hash, naming the command that fixes a mismatch [DC-14].
- **File follow-up docs or video issues after the merge**, based on what was actually built, after checking what the build already updated [DC-16].
- **Mark superseded notes obsolete**, with a pointer to what replaced them [DC-17].
- **Document the known gaps in an automation's coverage** instead of presenting it as complete [DC-18].
- **When trimming docs**, aim for shorter and current, but never delete load-bearing content: runbook steps, gotchas, invariants, exact commands. Update every link when you move files [DC-19].
- **After any run that taught something, write the lesson back** into `references/lessons.md` (see SKILL.md, "Feed the lessons back") [DC-21].

## Docs result schema

```json
{"docs_impact": "updated|none", "justification": "...", "files": ["..."], "changelog_entry": "...", "checks": [{"command": "...", "passed": true}]}
```
