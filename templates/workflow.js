// resolve-issue: Claude Code Workflow template.
//
// Do not run or edit this file directly. Stamp a per-issue copy first, so the run's
// name carries the issue id [OR-3, OR-4]:
//   scripts/stamp-workflow.sh 123   → .claude/workflows/resolve-issue-123.js
// Then launch it with Workflow({scriptPath, args}). All per-issue variation lives in
// args [OR-5]. The script cannot read files, so the main loop reads
// .claude/resolve-issue.yml and passes it in as args.profile (and args.tiers) [OR-6].
//
// args = {
//   issue:        { id: '123', title: '...', url: '...' },
//   reportPath:   '/abs/path/report.md',        // the human's VERBATIM report [PF-11]
//   screenshots:  ['/abs/path/shot.png'],
//   profile:      { ...parsed .claude/resolve-issue.yml },
//   tiers:        { diagnose: {model, effort}, ... },   // defaults to profile.tiers
//   mainCheckout: '/abs/main', worktree: '/abs/wt/123-slug', branch: 'fix/123-slug', base: 'origin/main',
//   ports:        { backend: 5301, frontend: 5302 },
//   size:         'small' | 'medium' | 'large',
//   specPath:     'docs/issues/2026-10-31-slug/spec.md', planPath: '.../plan.md',
//   e2e:          false,                         // run e2e inside the run? [TG-10]
//   ruledOut: [], suspects: [], priorAttempts: [], contextDocs: [],   // [DG-10, DG-11]
//   attempt:      1,
//   busyPaths:    [],                            // paths another process is editing [OR-13]
//   otherWorktrees: [],
//   maxParallel:  4,
// }
// Returns a COMPACT result for the post-run audit and the summary [OR-18, OR-26]: status, root cause,
// a gates table, the commit list, merged and deduped findings by severity [VF-31], follow-ups to file,
// and paths. Capped at RETURN_CAP characters; full per-stage outputs stay in the run journal and in
// the spec and plan files.
// The run ends at a verified branch. It never pushes, tags or releases [HG-1].

export const meta = {
  name: 'resolve-issue-__ISSUE__',
  description: 'Issue __ISSUE__: diagnose → spec → plan → parallel build → per-task adversarial verify/repair → gates → docs → summary. Stops at a verified branch.',
  whenToUse: 'One tracker issue, after pre-flight, sizing and worktree setup are done in the main loop.',
  phases: [
    { title: 'Diagnose', detail: 'rank candidate causes, probe, confirm. No fixes' },
    { title: 'Spec', detail: 'root cause at the shared seam, scope, tests, docs impact' },
    { title: 'Plan', detail: 'real code, structured units, disjoint files per wave, symptom check' },
    { title: 'Build', detail: 'one builder per task, waves over the dependency graph' },
    { title: 'Verify', detail: 'fresh adversarial verifier per task, repair one tier up, max 3 rounds' },
    { title: 'Gates', detail: 'full gate list, whole-log failure grep, known-flaky set' },
    { title: 'Docs', detail: 'docs-impact decision, changelog under Unreleased, claim check' },
    { title: 'Summary', detail: 'plain-English summary draft for the human' },
  ],
}

const A = args || {}
const P = A.profile || {}
const T = A.tiers || P.tiers || {}
const ISSUE = A.issue || { id: '?', title: '?' }
const SIZE = A.size || 'medium'
const MAX_PAR = Math.max(1, A.maxParallel || (P.budget && P.budget.max_parallel_builders) || 4)
const REPAIR_ROUNDS = 3 // [VF-5]
const RETURN_CAP = 20000 // characters of JSON returned to the main loop [OR-26]
const SEVERITIES = ['defect', 'test-gap', 'doc-copy', 'follow-up', 'bookkeeping'] // triage order [VF-31]

// ---------- helpers ----------

function opts(stage, extra) {
  const t = T[stage] || {}
  const o = Object.assign({}, extra)
  if (t.model) o.model = t.model // null/absent = inherit the session model
  if (t.effort) o.effort = t.effort
  return o
}

function list(xs) {
  return xs && xs.length ? xs.map((x) => `  - ${typeof x === 'string' ? x : JSON.stringify(x)}`).join('\n') : '  (none)'
}

function cmds() {
  const c = P.commands || {}
  return Object.keys(c).map((k) => `  ${k}: ${Array.isArray(c[k]) ? c[k].join(' && ') : c[k]}`).join('\n') || '  (see profile)'
}

const LAWS = [
  'Rank, never confirm: before committing to a cause or approach, list >=2 alternatives (yours included) and force a relative ranking. Never ask "am I right?"',
  'Evidence beats ranking: probe and measure; when they disagree, evidence wins and you record the overrule.',
  'Fix the REPORTED symptom at the shared seam every caller routes through; look for siblings of the same class.',
  'Every fix carries a regression test that fails on the old code and passes on the new.',
  'Read whole logs: save full output to a file and grep it for "failed"; compare failing SETS, not counts or tails.',
  'Never skip, retry-wrap, loosen, raise timeouts on, or delete a test or guard to go green. Stop and report instead.',
  'Stage explicit paths only. Never `git add -A` / `git add .`.',
  'Stay in your worktree, branch and ports. Kill every server you start.',
  'Never push, tag, bump the version, change repo settings or secrets, or trigger CI. Destructive git (force-push, reset --hard, clean, branch -D, checkout .) is forbidden.',
  'No sensitive identifiers (names, record numbers, birth dates, customer PII) in code, fixtures, commits, docs or output. No production or staging DB/log access.',
  'Only do the task you are given. Do not invent additional work; note adjacent problems as follow-ups.',
  'Never claim fixed/passing/done without the command and its real output.',
].concat(P.laws || [])

const PREAMBLE = `
=== SHARED CONTEXT (applies to you) ===
Issue ${ISSUE.id}: ${ISSUE.title}${ISSUE.url ? ` (${ISSUE.url})` : ''}
Working directory: ${A.worktree}. Start EVERY shell command with: cd "${A.worktree}" &&
Branch: ${A.branch} (base ${A.base || 'origin/' + ((P.repo && P.repo.main_branch) || 'main')}).
Off-limits: the main checkout ${A.mainCheckout || '(main checkout)'} and these worktrees:
${list(A.otherWorktrees)}
Paths another process is editing right now. Do not touch them:
${list(A.busyPaths)}

Reported symptom (VERBATIM): read ${A.reportPath}. Screenshots:
${list(A.screenshots)}
Spec: ${A.specPath || '(scratch)'}  Plan: ${A.planPath || '(scratch)'}
Context docs:
${list(A.contextDocs)}
Glossary: ${(P.docs && P.docs.glossary) || 'n/a'}. ADRs: ${(P.docs && P.docs.adr_dir) || 'n/a'}. Use glossary terms in names and prose.

Project commands:
${cmds()}
CI-only checks (they need a PR or CI context; never run them as gates, report them as ci_only) [TG-34]:
${list(P.ci_only)}
Env: source ${(P.env && P.env.source) || '(none)'} before tests. Secrets are LINKED from the main checkout; never create dummy secrets or copy secret values.
Ports: use ONLY backend ${A.ports && A.ports.backend} and frontend ${A.ports && A.ports.frontend} with strict-port flags. NEVER use ${((P.ports && P.ports.reserved) || []).join(', ') || 'the developer default ports'}. Check ownership with lsof before starting a server; kill every server you started before you finish.
Search with \`command grep -rn\` or \`rg\` (shell wrappers can skip files).

Decision rule: do not stop or ask the human. Rank the real alternatives${P.ranker && P.ranker.cmd ? ` with \`${P.ranker.cmd}\` (JSON on stdin, >=2 options)` : ' explicitly with probabilities'}, let evidence decide, and record what you decided and why.

Commits: subject "${(P.git && P.git.subject) || '<summary> (#{n})'}" with n=${ISSUE.id}; message body ends with these trailers, exactly:
${list((P.git && P.git.trailers) || [])}
Stage explicit paths only. Never stage:
${list((P.git && P.git.never_stage) || [])}
If git reports index.lock, wait a few seconds and retry; never delete a lock that may be live.

NON-NEGOTIABLE LAWS (violating any fails the task):
${LAWS.map((l, i) => `${i + 1}. ${l}`).join('\n')}
=== END SHARED CONTEXT ===
`

// ---------- schemas ----------

const DIAG = {
  type: 'object',
  properties: {
    method: { type: 'string' },
    findings: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          cause: { type: 'string' },
          rank_p: { type: 'number' },
          verdict: { type: 'string', enum: ['confirmed', 'ruled_out', 'open'] },
          evidence: { type: 'string' },
        },
        required: ['cause', 'verdict', 'evidence'],
      },
    },
    ruled_out: { type: 'array', items: { type: 'string' } },
    open_questions: { type: 'array', items: { type: 'string' } },
    distinguishing_question: { type: ['string', 'null'] },
    decision_required: { type: ['string', 'null'], description: 'menu of options (what survives / what is lost) when the fix is destructive or data-loss-sensitive; else null' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['method', 'findings', 'evidence', 'candidates', 'ruled_out', 'open_questions', 'confidence'],
}

const SPEC = {
  type: 'object',
  properties: {
    spec_path: { type: 'string' },
    root_cause: { type: 'string' },
    shared_seam: { type: 'string' },
    mechanism_explains_reported_data: { type: 'boolean' },
    decision_required: { type: ['string', 'null'] },
    out_of_scope: { type: 'array', items: { type: 'string' } },
    manual_checks: { type: 'array', items: { type: 'string' } },
    docs_impact: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
    laws: { type: 'array', items: { type: 'string' } },
  },
  required: ['spec_path', 'root_cause', 'shared_seam', 'mechanism_explains_reported_data', 'out_of_scope', 'docs_impact'],
}

const TASK = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    depends_on: { type: 'array', items: { type: 'string' } },
    instructions: { type: 'string', description: 'the full task section from the plan, verbatim, including code and checkboxes' },
    acceptance: { type: 'string' },
  },
  required: ['id', 'title', 'files', 'depends_on', 'instructions', 'acceptance'],
}

const PLAN = {
  type: 'object',
  properties: { plan_path: { type: 'string' }, tasks: { type: 'array', items: TASK } },
  required: ['plan_path', 'tasks'],
}

const FIT = {
  type: 'object',
  properties: {
    options: { type: 'array', items: { type: 'object', properties: { option: { type: 'string' }, p: { type: 'number' } }, required: ['option', 'p'] } },
    verdict: { type: 'string', enum: ['reported', 'neighbour', 'close'] },
    reason: { type: 'string' },
  },
  required: ['options', 'verdict', 'reason'],
}

const BUILD = {
  type: 'object',
  properties: {
    commits: { type: 'array', items: { type: 'string' }, description: 'full SHAs you created' },
    files_changed: { type: 'array', items: { type: 'string' } },
    commands_run: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, output_tail: { type: 'string' } }, required: ['command', 'output_tail'] } },
    deviations: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['commits', 'files_changed', 'commands_run', 'deviations'],
}

const VERDICT = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    checks: { type: 'array', items: { type: 'object', properties: { check: { type: 'string' }, ok: { type: 'boolean' }, detail: { type: 'string' } }, required: ['check', 'ok', 'detail'] } },
    unfinished_work: { type: 'string', description: 'precise, naming files and symbols; empty if passed' },
    code_defect: { type: 'boolean', description: 'true ONLY for real logic defects, not bookkeeping' },
    non_blocking_findings: {
      type: 'array',
      description: 'everything you noticed that did not fail the task, each tagged with a severity [VF-31]',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: SEVERITIES, description: 'defect = wrong behaviour a user could hit; test-gap = untested path; doc-copy = wrong or misleading text; follow-up = real but out of scope; bookkeeping = trailers, ticks, formatting' },
          finding: { type: 'string', description: 'one sentence, naming file:line or the screen' },
        },
        required: ['severity', 'finding'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['passed', 'checks', 'unfinished_work', 'code_defect', 'summary'],
}

const COMPLETE = {
  type: 'object',
  properties: { missing: { type: 'array', items: { type: 'string' } }, detail: { type: 'string' } },
  required: ['missing', 'detail'],
}

const GATES = {
  type: 'object',
  properties: {
    all_green: { type: 'boolean' },
    gates: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, passed: { type: 'boolean' }, skipped: { type: 'boolean' }, output_tail: { type: 'string' }, log_path: { type: 'string' } }, required: ['command', 'passed', 'skipped', 'output_tail'] } },
    failures_fixed: { type: 'array', items: { type: 'string' } },
    commits: { type: 'array', items: { type: 'string' } },
    ci_only: { type: 'array', items: { type: 'string' }, description: 'profile checks not run because they need a PR or CI context' },
    remaining_failures: { type: 'array', items: { type: 'string' } },
    known_flaky_matched: { type: 'array', items: { type: 'string' } },
  },
  required: ['all_green', 'gates', 'failures_fixed', 'remaining_failures'],
}

const DOCS = {
  type: 'object',
  properties: {
    docs_impact: { type: 'string', enum: ['updated', 'none'] },
    justification: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    changelog_entry: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' } },
    checks: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, passed: { type: 'boolean' } }, required: ['command', 'passed'] } },
  },
  required: ['docs_impact', 'justification', 'files'],
}

// ---------- prompts ----------

const diagPrompt = (angle) => `You are DIAGNOSING issue ${ISSUE.id}. Do not fix anything.
This is attempt ${A.attempt || 1} on this surface.${(A.priorAttempts || []).length ? ' Read these earlier attempts FIRST:\n' + list(A.priorAttempts) : ''}
ALREADY RULED OUT (do not re-investigate):
${list(A.ruledOut)}
KNOWN SUSPECTS (confirm or eliminate each):
${list(A.suspects)}
Your angle: ${angle}.

Method, in order [DG-7]: (1) trace the real code path end to end, from the entry point the user touched, citing file:line;
(2) list EVERY candidate cause, the obvious one included; (3) rank them relatively, never yes/no;
(4) gather evidence that tells the top candidates apart: write and run a probe, a failing test or a scripted repro
through the real entry point, and report MEASURED values and the method; (5) state the confirmed cause, or what remains open and what would settle it.
Heuristics: sibling path works? diff its inputs to the shared dependency. Silent "success" endpoint? check the exact input matches a real record first.
Runner hangs? run one trivial known-good test, then bisect. Model returns empty? swap one model at a time. Derived output contradicts itself? look for a missing upstream input.
Ask what a one-line fix would newly arm downstream. Look for a test that asserts the dangerous behaviour as correct.
If two plausible symptoms share this surface, give the one question that separates them (distinguishing_question).
If the only fixes are destructive or lose data, fill decision_required with a menu (each option: what survives, what is lost).
Delete throwaway probes; keep a reproduction only if it is a proper regression test (and say where).
${PREAMBLE}`

const specPrompt = (diags) => `You are writing the SPEC for issue ${ISSUE.id}. Write it to ${A.specPath} using the house template (templates/spec.md of the resolve-issue skill, or the exemplar in ${(P.docs && P.docs.index) || 'the docs index'}).
Diagnoses (verbatim, ${diags.length} independent angle(s)). Where they disagree, read the code yourself and decide:
${JSON.stringify(diags, null, 2)}

Rules: fix the root cause at the shared seam every caller routes through, with the smallest change that fully resolves the REPORTED symptom.
Include: exact user-facing copy; tests (one fails before the fix; an acceptance fixture shaped like the reporter's anonymised data); docs impact;
EXPLICITLY OUT OF SCOPE (adjacent cleanup becomes follow-up issues, listed by title); what agents cannot validate (manual checks); honest risks; assumptions made instead of asking.
If no diagnosed mechanism produces the symptom on the reported data, say so (mechanism_explains_reported_data=false) and specify the measurement needed or a fix correct regardless plus in-product evidence capture.
If the change contradicts an ADR, write "Contradicts ADR-NNNN … but worth reopening because …". For data-sensitive changes, write the load-bearing invariant and its catastrophic failure mode.
Prefer the fix that works with already-deployed state. Delete low-value broken paths rather than repairing them. Use glossary terms.
Commit the spec file (explicit path).
${PREAMBLE}`

const planPrompt = (spec) => `You are writing the PLAN for issue ${ISSUE.id}. Read the spec at ${spec.spec_path} first. Write the plan to ${A.planPath} (templates/plan.md format) and commit it.
The plan is where each build task's code is written. Put ACTUAL code, exact signatures and checkbox TDD steps in it (write the failing test → run it and SEE it fail → implement → see it pass → typecheck/lint → commit explicit paths).
Banned: "TBD", "add appropriate handling", "similar to Task N". Use 3 to 9 tasks (slice hard at about 10). Order: root fix first, then diagnostics and guards, then docs.
Tasks that can run in the same wave MUST touch disjoint files; list every file each task touches. Mark depends_on accurately.
Copy the relevant laws into each task. Tell tasks which shared components and helpers to reuse instead of re-implementing them.
Return the tasks as structured units; "instructions" is that task's full section, verbatim, code included.
Spec summary: ${JSON.stringify(spec)}
${PREAMBLE}`

const fitPrompt = (spec, plan) => `Symptom check before build [PL-1]. Read the verbatim report at ${A.reportPath}, the spec at ${spec.spec_path} and the plan at ${plan.plan_path}.
Question: does this plan fix the REPORTED symptom, or a NEIGHBOURING one? List the reported symptom plus at least two real neighbouring symptoms on the same surface as options, and give each a probability (sum to 1).
verdict = "reported" if the reported option clearly wins, "neighbour" if a neighbour wins, "close" if the top two are within 0.2. Do not modify any file.
${PREAMBLE}`

const buildPrompt = (t, prefix) => `${prefix || ''}You are the BUILDER for task ${t.id} of issue ${ISSUE.id}: ${t.title}.
Files you may touch (and nothing else): ${t.files.join(', ')}
Execute the plan's task exactly: run its tests, tick its checkboxes in ${A.planPath}, and commit the ticked plan file TOGETHER with your own files, by explicit path, in the task commit. Never leave ticks uncommitted [BD-21].
If the plan's code does not compile against reality, fix it to match and REPORT the deviation. Report the commands you ran and their real output.
Only do the task you are given; do not invent additional work. Do not add dependencies; if one seems necessary, stop and report.
Run typecheck/build for what you touched, not the full browser suites. When you add a field, grep every write path and validator; when you add an export, update every mock of that module.
TASK (verbatim from the plan):
${t.instructions}
ACCEPTANCE: ${t.acceptance}
${PREAMBLE}`

const verifyPrompt = (t, shas, b) => `You are an ADVERSARIAL VERIFIER for task ${t.id} of issue ${ISSUE.id}: ${t.title}.
You did not write this. Assume it is wrong until your own commands prove otherwise. Never trust the implementer's report. Fix NOTHING. If unsure, fail.
Authority order: mockup > spec (${A.specPath}) > plan (${A.planPath}). Commits to check: ${shas.join(' ') || '(none reported: find them with git log)'}.
Implementer's report (do not trust it): ${JSON.stringify(b)}
Checklist (record every item in checks):
1. Scope: \`git show --stat <sha>\` for each commit touches only: ${t.files.join(', ')} (plus its ticks in ${A.planPath}).
2. The named tests exist AND pass when YOU run them. 3. Typecheck and lint are clean.
4. Each commit has the required trailers and issue tag. 5. No TODO/FIXME/"not implemented" in the diff. 6. The task's plan checkboxes are ticked IN A COMMIT. Ignore uncommitted plan ticks in the working tree; they are another task's, not a finding [BD-21].
7. Law checks by grep (every numbered law; destructive DDL; new unique constraints; secrets; sensitive identifiers in fixtures, commits or docs).
8. NEGATIVE CONTROL: prove the regression test can fail. Make a throwaway detached worktree at the last sha (outside ${A.worktree}), run a REAL dependency install there (${(P.commands && P.commands.install) || 'the frozen-lockfile install'}; never symlink dependency dirs, module mocks break) and link only the env and secrets [IS-16],
   restore ONLY the non-test files to their pre-task versions there, run the test, and expect RED. Then remove the throwaway worktree. Never stash or revert inside ${A.worktree}; other tasks are live there.
   The assertions must fail on the bad outcome (not merely "not throw"), and the component under test must not be mocked.
9. The reported symptom (${A.reportPath}) is resolved for the reporter's data shape; reason explicitly about those rows.
10. Claims in docs and comments are true. 11. The feature is reachable from the UI. 12. Any gate is correct in both directions (no leak, full coverage).
13. None of the known build pitfalls: stripped fields, orphaned triggers, cache-masked indicators, unhandled promise chains, route order, effect loops, silent not_configured, hardcoded formats.
Kill any server you start. code_defect=true ONLY for real logic defects, not bookkeeping. unfinished_work must name files and symbols precisely.
Put everything else you noticed in non_blocking_findings, each with a severity (defect | test-gap | doc-copy | follow-up | bookkeeping). Tag honestly: a reachable wrong behaviour (a page stuck loading, a raw 500, misleading copy) is a defect or doc-copy even if it is outside this task [VF-31, VF-11].
${PREAMBLE}`

const repairPrompt = (t, v) => `You are REPAIRING task ${t.id} of issue ${ISSUE.id}: ${t.title}. A previous attempt was rejected by an independent verifier. Fix EXACTLY this:
${v.unfinished_work}
Failed checks: ${JSON.stringify((v.checks || []).filter((c) => !c.ok))}
Files you may touch: ${t.files.join(', ')}. Commit the fix (explicit paths, trailers). Do not weaken any test. Report commands and real output.
Original task (verbatim):
${t.instructions}
${PREAMBLE}`

const completePrompt = (tasks) => `You are a COMPLETENESS CHECKER for issue ${ISSUE.id}. Cross-check the plan's units against the actual tree on ${A.branch} (git log ${A.base || 'origin/main'}..HEAD, plus the files themselves).
Units: ${JSON.stringify(tasks.map((t) => ({ id: t.id, title: t.title, files: t.files, acceptance: t.acceptance })))}
Return the ids of units with no real implementation (missing or stubbed). Modify nothing.
${PREAMBLE}`

const gatesPrompt = () => `You are the GATES agent for issue ${ISSUE.id}. Run the FULL gate list from the project commands until green, fixing and committing as you go.
E2E in this run: ${A.e2e ? `YES. Use the isolated runner on the assigned ports${P.commands && P.commands.e2e_isolated ? ` (${P.commands.e2e_isolated})` : ''}; run it in the foreground with a long timeout` : 'NO. Report e2e as skipped (it runs from the main checkout at merge). Never report skipped as passed'}.
For each gate: save the FULL output to a log file, grep ALL of it for "failed" and "flaky", and record the exit code separately from your own grep's exit code.
Known-flaky SET: ${JSON.stringify(P.known_flaky || [])}. A failure inside this set is non-blocking ONLY if it matches. A new failure in the touched area blocks.
Do NOT run the CI-only checks from the shared context (they fail outside a PR or CI by design); list them in ci_only [TG-34]. Return the SHAs of any commits you make in commits.
To triage a red spec, run it alone and in the full run; require green twice in a row.
Change a TEST only when it asserts behaviour the app deliberately no longer has, and cite the commit. Never skip, retry-wrap, raise timeouts, loosen or weaken anything. If that seems necessary, stop and report.
Failures in the shared environment that are not caused by this branch: report them and change nothing. Kill every server you start and prove zero listeners on the run's ports at the end.
${PREAMBLE}`

const docsPrompt = (gates) => `You are the DOCS agent for issue ${ISSUE.id}. Decide docs impact for this change (git diff ${A.base || 'origin/main'}...HEAD).
If affected: update the user docs where behaviour changed (content, not just stamps; plain language; accurate privacy claims), the developer docs for the changed code, the glossary only if a term was resolved,
and the changelog under "${(P.docs && P.docs.unreleased_heading) || '## Unreleased'}" in ${(P.docs && P.docs.changelog) || 'CHANGELOG.md'} (never the version file, never a released section).
Link the spec and plan from ${(P.docs && P.docs.index) || 'the docs index'}. Add an ADR only if the decision is hard to reverse, surprising and a real trade-off, grounded in cited evidence, with the rankings and any overrules.
Never document behaviour that cannot fire. Check every sentence against the code. Run the doc checks. Commit explicit paths.
If not affected: docs_impact="none" with a real justification.
Gates result: ${JSON.stringify(gates).slice(0, 8000)}
${PREAMBLE}`

const docsVerifyPrompt = (d) => `You are an ADVERSARIAL VERIFIER of documentation for issue ${ISSUE.id}. For every claim in these changed docs, find the code that makes it true, or fail it.
Check that the changelog entry is under the Unreleased heading and claims only what shipped. Fix nothing.
Tag every non-blocking finding with a severity (defect | test-gap | doc-copy | follow-up | bookkeeping) [VF-31].
Docs result: ${JSON.stringify(d)}
${PREAMBLE}`

// ---------- per-task loop: build → verify → repair (one tier up) ----------

async function runTask(t, prefix) {
  const b = await agent(buildPrompt(t, prefix), opts('build', { label: `build ${t.id}`, phase: 'Build', schema: BUILD }))
  if (!b) return { id: t.id, title: t.title, status: 'failed', reason: 'agent died (build)', attempts: [] } // [OR-9]
  const shas = (b.commits || []).slice()
  const attempts = []
  let v = null
  for (let round = 0; round <= REPAIR_ROUNDS; round++) {
    v = await agent(verifyPrompt(t, shas, b), opts('verify', { label: `verify ${t.id} #${round + 1}`, phase: 'Verify', schema: VERDICT }))
    if (!v) v = await agent(verifyPrompt(t, shas, b), opts('verify', { label: `re-verify ${t.id} #${round + 1}`, phase: 'Verify', schema: VERDICT })) // a null verdict is never a pass
    if (!v) {
      attempts.push({ round, verdict: null })
      return { id: t.id, title: t.title, status: 'failed', reason: 'verifier died twice', commits: shas, attempts, build: b }
    }
    attempts.push({ round, passed: v.passed, code_defect: v.code_defect, summary: v.summary, non_blocking: v.non_blocking_findings || [] })
    if (v.passed) return { id: t.id, title: t.title, status: 'verified', commits: shas, attempts, build: b, repairs: round }
    if (round === REPAIR_ROUNDS) break
    const r = await agent(repairPrompt(t, v), opts('repair', { label: `repair ${t.id} #${round + 1}`, phase: 'Verify', schema: BUILD }))
    if (r && r.commits) shas.push(...r.commits)
  }
  return { id: t.id, title: t.title, status: 'failed', reason: 'rejected after repairs', unfinished_work: v.unfinished_work, commits: shas, attempts, build: b, repairs: REPAIR_ROUNDS }
}

// ---------- findings and the compact return [VF-31, OR-26] ----------

// One list from every verifier: dedupe on normalised text, keep the most severe tag, record which tasks said it.
function mergeFindings(r) {
  const merged = new Map()
  const add = (f, source) => {
    const item = typeof f === 'string' ? { finding: f } : f || {}
    if (!item.finding) return
    const sev = SEVERITIES.includes(item.severity) ? item.severity : 'defect' // untagged counts as a defect, so it gets re-read
    const key = String(item.finding).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const prev = merged.get(key)
    if (!prev) return merged.set(key, { severity: sev, finding: item.finding, sources: [source] })
    if (SEVERITIES.indexOf(sev) < SEVERITIES.indexOf(prev.severity)) prev.severity = sev
    if (!prev.sources.includes(source)) prev.sources.push(source)
  }
  for (const t of r.tasks || []) for (const a of (t && t.attempts) || []) for (const f of a.non_blocking || []) add(f, t.id)
  for (const f of (r.docs_verdict && r.docs_verdict.non_blocking_findings) || []) add(f, 'docs')
  const out = {}
  for (const sev of SEVERITIES) out[sev] = []
  for (const m of merged.values()) out[m.severity].push(m)
  return out
}

function compact(r) {
  const findings = mergeFindings(r)
  const g = r.gates
  const commits = [...new Set([].concat(...(r.tasks || []).map((t) => (t && t.commits) || []), (g && g.commits) || [], (r.docs && r.docs.commits) || []))]
  return {
    issue: r.issue, size: r.size, status: r.status, stage: r.stage || null, reason: r.reason || null,
    decision_required: r.decision_required || null,
    root_cause: r.spec ? r.spec.root_cause : (r.diagnoses || []).map((d) => d.findings).join(' | ') || null,
    shared_seam: (r.spec && r.spec.shared_seam) || null,
    symptom_check: r.symptom_check ? { verdict: r.symptom_check.verdict, reason: r.symptom_check.reason } : null,
    paths: {
      spec: (r.spec && r.spec.spec_path) || A.specPath || null,
      plan: (r.plan && r.plan.plan_path) || A.planPath || null,
      gate_logs: g ? (g.gates || []).map((x) => x.log_path).filter(Boolean) : [],
      journal: 'full diagnoses, build reports, verdicts and gate output are in this run\'s journal',
    },
    tasks: (r.tasks || []).map((t) => t && { id: t.id, title: t.title, status: t.status, reason: t.reason, repairs: t.repairs, commits: t.commits || [], unfinished_work: t.unfinished_work, completion: t.completion }),
    gates: g ? {
      all_green: g.all_green,
      table: (g.gates || []).map((x) => ({ command: x.command, passed: x.passed, skipped: x.skipped, log_path: x.log_path })),
      remaining_failures: g.remaining_failures || [], known_flaky_matched: g.known_flaky_matched || [], ci_only: g.ci_only || P.ci_only || [],
    } : null,
    docs: r.docs ? { docs_impact: r.docs.docs_impact, justification: r.docs.justification, files: r.docs.files, verified: r.docs_verdict ? r.docs_verdict.passed : null } : null,
    commits,
    findings, // defects and test gaps first; the post-run audit re-triages this list [VF-11]
    follow_ups: findings['follow-up'].map((f) => f.finding).concat((r.spec && r.spec.out_of_scope) || []),
    manual_checks: (r.spec && r.spec.manual_checks) || [],
    metrics: r.metrics || null,
    summary: r.summary || null,
  }
}

// Shrink until it fits: clip prose, then drop the lowest severities. Defects and test gaps go last.
function capReturn(c) {
  const size = () => JSON.stringify(c).length
  const clip = (x, n) => (typeof x === 'string' && x.length > n ? x.slice(0, n) + ' …[clipped; see journal]' : x)
  const clipAll = (n) => {
    c.summary = clip(c.summary, n * 4); c.root_cause = clip(c.root_cause, n); c.decision_required = clip(c.decision_required, n * 4)
    for (const sev of SEVERITIES) c.findings[sev].forEach((f) => { f.finding = clip(f.finding, n) })
    c.follow_ups = c.follow_ups.map((f) => clip(f, n))
    c.tasks.forEach((t) => { if (t) t.unfinished_work = clip(t.unfinished_work, n) })
  }
  const drop = (sev) => { c.findings_omitted = Object.assign(c.findings_omitted || {}, { [sev]: c.findings[sev].length }); c.findings[sev] = [] }
  const steps = [
    () => clipAll(1500), () => drop('bookkeeping'), () => clipAll(300), () => drop('doc-copy'), () => drop('follow-up'),
    () => { c.findings.defect = c.findings.defect.slice(0, 40); c.findings['test-gap'] = c.findings['test-gap'].slice(0, 40); c.follow_ups = c.follow_ups.slice(0, 20) },
    () => clipAll(120),
  ]
  for (const step of steps) { if (size() <= RETURN_CAP) break; step(); c.clipped = true }
  c.return_chars = size()
  c.return_chars = size() // again, now counting the field itself
  return c
}

function finish(r) {
  return capReturn(compact(r))
}

// ---------- pipeline ----------

const result = { issue: ISSUE, size: SIZE, status: 'running', diagnoses: [], spec: null, plan: null, symptom_check: null, tasks: [], gates: null, docs: null, summary: null }

phase('Diagnose')
const angles = SIZE === 'small'
  ? ['end-to-end trace of the reported path']
  : ['what the failing component or function actually receives (inputs, props, payloads, state)', 'where the working path and the failing path diverge']
result.diagnoses = (await parallel(angles.map((a, i) => () =>
  agent(diagPrompt(a), opts('diagnose', { label: `diagnose ${i + 1}`, phase: 'Diagnose', schema: DIAG }))))).filter(Boolean)
if (!result.diagnoses.length) return finish(Object.assign(result, { status: 'failed', stage: 'diagnose', reason: 'all diagnosers died' }))
const decision = result.diagnoses.find((d) => d.decision_required)
if (decision) return finish(Object.assign(result, { status: 'decision_required', decision_required: decision.decision_required })) // [SP-11]

phase('Spec')
result.spec = await agent(specPrompt(result.diagnoses), opts('spec', { label: 'spec', schema: SPEC }))
if (!result.spec) return finish(Object.assign(result, { status: 'failed', stage: 'spec', reason: 'agent died' }))
if (result.spec.decision_required) return finish(Object.assign(result, { status: 'decision_required', decision_required: result.spec.decision_required }))
if (!result.spec.mechanism_explains_reported_data) log('Spec: no diagnosed mechanism fully explains the reported data. Proceeding with a fix that is correct regardless, plus evidence capture [SP-3].')

phase('Plan')
result.plan = await agent(planPrompt(result.spec), opts('plan', { label: 'plan', schema: PLAN }))
if (!result.plan || !(result.plan.tasks || []).length) return finish(Object.assign(result, { status: 'failed', stage: 'plan', reason: result.plan ? 'plan returned no tasks' : 'agent died' }))
const tasks = result.plan.tasks
if (tasks.length > 10) log(`Plan has ${tasks.length} tasks (cap is about 9). Consider slicing into sub-issues [PL-7].`)
result.symptom_check = await agent(fitPrompt(result.spec, result.plan), opts('verify', { label: 'symptom check', phase: 'Plan', schema: FIT }))
if (result.symptom_check && result.symptom_check.verdict !== 'reported') {
  return finish(Object.assign(result, { status: 'plan_mismatch', reason: `symptom check: ${result.symptom_check.verdict}. ${result.symptom_check.reason}` })) // back to diagnosis
}

phase('Build')
const ids = new Set(tasks.map((t) => t.id))
const byId = {}
const failed = new Set()
let remaining = tasks.slice()
while (remaining.length) {
  if (budget.total && budget.remaining() < 100000) { log(`Budget nearly spent; ${remaining.length} task(s) not started.`); break } // no silent caps
  // a task whose dependency failed is blocked, not built
  const blocked = remaining.filter((t) => (t.depends_on || []).some((d) => failed.has(d)))
  for (const t of blocked) { byId[t.id] = { id: t.id, title: t.title, status: 'blocked', reason: 'a dependency failed' }; failed.add(t.id) }
  remaining = remaining.filter((t) => !blocked.includes(t))
  if (!remaining.length) break
  // ready = all deps done; a dependency id that is not in the plan counts as satisfied; if nothing is ready (cycle), run the first alone [OR-8]
  let ready = remaining.filter((t) => (t.depends_on || []).every((d) => byId[d] || !ids.has(d)))
  if (!ready.length) ready = [remaining[0]]
  // disjoint files within a wave [PL-4, OR-11], capped by maxParallel [SZ-2]
  const wave = []
  const used = new Set()
  for (const t of ready) {
    if (wave.length >= MAX_PAR) break
    if ((t.files || []).some((f) => used.has(f))) continue
    ;(t.files || []).forEach((f) => used.add(f))
    wave.push(t)
  }
  log(`Wave: ${wave.map((t) => t.id).join(', ')} (${remaining.length - wave.length} queued)`)
  const outs = await parallel(wave.map((t) => () => runTask(t)))
  wave.forEach((t, i) => {
    const r = outs[i] || { id: t.id, title: t.title, status: 'failed', reason: 'agent died' }
    byId[t.id] = r
    if (r.status !== 'verified') failed.add(t.id)
  })
  remaining = remaining.filter((t) => !wave.includes(t))
}
for (const t of remaining) byId[t.id] = { id: t.id, title: t.title, status: 'not_started', reason: 'budget' }

// completeness: plan units vs tree [VF-13]; dispatch a completion agent for exactly the missing ones [OR-10]
const comp = await agent(completePrompt(tasks), opts('verify', { label: 'completeness', phase: 'Verify', schema: COMPLETE }))
const missing = comp ? comp.missing.filter((id) => ids.has(id) && byId[id] && byId[id].status === 'verified') : []
if (missing.length) {
  log(`Completeness: ${missing.join(', ')} verified but missing from the tree. Dispatching completion.`)
  const redoTasks = tasks.filter((t) => missing.includes(t.id))
  const redo = await parallel(redoTasks.map((t) => () =>
    runTask(t, `COMPLETION: an independent check found this unit missing or stubbed in the tree (${comp.detail}). Implement exactly this unit.\n`)))
  redoTasks.forEach((t, i) => { byId[t.id] = redo[i] ? Object.assign(redo[i], { completion: true }) : { id: t.id, title: t.title, status: 'failed', reason: 'agent died (completion)' } })
}
result.tasks = tasks.map((t) => byId[t.id])
result.completeness = comp

phase('Gates')
result.gates = await agent(gatesPrompt(), opts('gates', { label: 'gates', schema: GATES }))

phase('Docs')
result.docs = await agent(docsPrompt(result.gates), opts('docs', { label: 'docs', schema: DOCS }))
if (result.docs && result.docs.docs_impact === 'updated') {
  result.docs_verdict = await agent(docsVerifyPrompt(result.docs), opts('verify', { label: 'verify docs', phase: 'Docs', schema: VERDICT })) // [VF-6]
}

phase('Summary')
const verified = result.tasks.filter((t) => t && t.status === 'verified').length
const buildDefects = result.tasks.filter((t) => t && (t.attempts || []).some((a) => a.code_defect)).length
result.metrics = { tasks: tasks.length, verified, tasks_with_code_defect: buildDefects, repairs: result.tasks.reduce((n, t) => n + ((t && t.repairs) || 0), 0) } // [CO-2]
result.status = verified === tasks.length && result.gates && result.gates.all_green ? 'verified' : 'partial'
result.summary = await agent(`Draft the end-of-run summary for the human, in this exact shape, plain English, short enough for a phone. Do NOT claim anything the data below does not show; report skipped as skipped.
<issue> <title>: <verified | partially verified | failed>
Root cause: … Confirmed by: …
Ranking: … ; overruled by evidence: …
What changes for the user: …
Gates: …
Findings (defects and test gaps first, then doc/copy; follow-ups as issues to file): …
Commits (git log ${A.base || 'origin/main'}..HEAD, run it):
Check by hand: …
Open: …
Next: your yes to merge; then a separate yes to push.
Data: ${JSON.stringify(finish(result))}
${PREAMBLE}`, opts('docs', { label: 'summary' }))

return finish(result) // compact and capped [OR-26]
