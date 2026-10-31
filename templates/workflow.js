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
//   agentBriefPath: '/abs/path/agent-brief.md',  // the issue's "## Agent Brief" comment, if any
//   screenshots:  ['/abs/path/shot.png'],
//   profile:      { ...parsed .claude/resolve-issue.yml, merged over the defaults in references/project-profile.md },
//   tiers:        { diagnose: {model, effort}, ... },   // defaults to profile.tiers
//   skillDir:     '/abs/path/to/resolve-issue',  // so agents can read references/packs/*.md
//   packs:        ['ux'],                        // domain packs on; defaults to profile.packs. Diagnosis can add more
//   mainCheckout: '/abs/main', worktree: '/abs/wt/123-slug', branch: 'fix/123-slug', base: 'origin/main',
//   ports:        { backend: 5301, frontend: 5302 },
//   size:         'small' | 'medium' | 'large',  // small: one spec+plan agent, 1 task, no spec file unless profile.small_spec_file
//   specPath:     'docs/issues/2026-10-31-slug/spec.md', planPath: '.../plan.md',
//   e2e:          false,                         // run e2e inside the run? [TG-10]
//   ruledOut: [], suspects: [], priorAttempts: [], contextDocs: [],   // [DG-10, DG-11]
//   attempt:      1,
//   busyPaths:    [],                            // paths another process is editing [OR-13]
//   otherWorktrees: [],
//   maxParallel:  4,
//   stopAfter:    null | 'diagnose' | 'plan',    // opt-in human checkpoint; null (default) runs to the end [SP-1]
//   resumeFrom:   null | 'build',                // 'build' reads the committed plan at planPath and builds it
// }
// Returns a COMPACT result for the post-run audit [OR-18, OR-26]: status, root cause, a gates table,
// the commit list, merged and deduped findings by severity [VF-31], follow-ups to file, per-stage
// metrics, paths, and a summary rendered from that data (no summary agent). Capped at RETURN_CAP
// characters; full per-stage outputs stay in the run journal and in the spec and plan files.
// Wall-clock time is not available here: the main loop records start and end in the run log.
// The run ends at a verified branch. It never pushes, tags or releases [HG-1].

export const meta = {
  name: 'resolve-issue-__ISSUE__',
  description: 'Issue __ISSUE__: diagnose → spec → plan → parallel build → per-task adversarial verify/repair → gates (+ verify gates commits) → docs if affected. Stops at a verified branch.',
  whenToUse: 'One tracker issue, after pre-flight, sizing and worktree setup are done in the main loop.',
  phases: [
    { title: 'Diagnose', detail: 'rank candidate causes, probe, confirm. No fixes' },
    { title: 'Spec', detail: 'root cause at the shared seam, scope, tests, docs impact' },
    { title: 'Plan', detail: 'real code, structured units, symptom check when the repro was not measured' },
    { title: 'Build', detail: 'one builder per task, waves over the dependency graph' },
    { title: 'Verify', detail: 'fresh adversarial verifier per task, repair one tier up, max 3 rounds' },
    { title: 'Gates', detail: 'fixed gate list, whole-log failure grep, known-flaky set; a fresh verifier over any gates commits' },
    { title: 'Docs', detail: 'only when the spec says docs are affected; changelog under Unreleased, claim check' },
  ],
}

const A = args || {}
const P = A.profile || {}
const T = A.tiers || P.tiers || {}
const ISSUE = A.issue || { id: '?', title: '?' }
const SIZE = A.size || 'medium'
const SMALL = SIZE === 'small'
const BASE = A.base || 'origin/' + ((P.repo && P.repo.main_branch) || 'main')
const SKILL = A.skillDir || '(the resolve-issue skill directory)'
const PACKS = new Set(A.packs || P.packs || [])
const SPEC_IN_COMMIT = SMALL && !P.small_spec_file // small: the spec lives in the root-fix commit body
const SPEC_REF = SPEC_IN_COMMIT ? 'the root-fix commit body (no spec file for a small issue)' : A.specPath || '(scratch)'
const MAX_PAR = Math.max(1, A.maxParallel || (P.budget && P.budget.max_parallel_builders) || 4)
const REPAIR_ROUNDS = 3 // [VF-5]
const RETURN_CAP = 20000 // characters of JSON returned to the main loop [OR-26]
const SEVERITIES = ['defect', 'test-gap', 'doc-copy', 'follow-up', 'bookkeeping'] // triage order [VF-31]
const CLOSE_P = 0.2 // symptom check: the top two within this are "close" [PL-1]

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

const joinCmd = (v) => (Array.isArray(v) ? v.join(' && ') : v)

function cmds() {
  const c = P.commands || {}
  return Object.keys(c).map((k) => `  ${k}: ${joinCmd(c[k])}`).join('\n') || '  (see profile)'
}

// The gates agent runs exactly this list, in order. No improvising [TG-6].
function gateCmds() {
  const c = P.commands || {}
  const out = Object.keys(c).filter((k) => c[k] && !['install', 'e2e', 'e2e_isolated', 'docs_checks'].includes(k)).map((k) => `${k}: ${joinCmd(c[k])}`)
  for (const d of c.docs_checks || []) out.push(`docs: ${d}`)
  if (A.e2e && (c.e2e_isolated || c.e2e)) out.push(`e2e: ${c.e2e_isolated || c.e2e}`)
  return out
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

// A function, not a constant: diagnosis can switch on more domain packs.
const preamble = () => `
=== SHARED CONTEXT (applies to you) ===
Issue ${ISSUE.id}: ${ISSUE.title}${ISSUE.url ? ` (${ISSUE.url})` : ''}
Working directory: ${A.worktree}. Start EVERY shell command with: cd "${A.worktree}" &&
Branch: ${A.branch} (base ${BASE}).
Off-limits: the main checkout ${A.mainCheckout || '(main checkout)'} and these worktrees:
${list(A.otherWorktrees)}
Paths another process is editing right now. Do not touch them:
${list(A.busyPaths)}

Reported symptom (VERBATIM): read ${A.reportPath}. Screenshots:
${list(A.screenshots)}
${A.agentBriefPath ? `Agent brief (its acceptance criteria and out-of-scope list are binding): ${A.agentBriefPath}\n` : ''}Spec: ${SPEC_REF}  Plan: ${A.planPath || '(scratch)'}
Context docs:
${list(A.contextDocs)}
Glossary: ${(P.docs && P.docs.glossary) || 'n/a'}. ADRs: ${(P.docs && P.docs.adr_dir) || 'n/a'}. Use glossary terms in names and prose.
Domain packs on for this run (read each; its rules apply like the laws' guidance): ${PACKS.size ? [...PACKS].map((n) => `${SKILL}/references/packs/${n}.md`).join(', ') : '(none)'}

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
    evidence: { type: 'array', items: { type: 'string' }, description: 'MEASURED values from probes or a scripted repro; empty if nothing was measured' },
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
    packs: { type: 'array', items: { type: 'string' }, description: 'names of domain packs whose trigger this issue meets' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['method', 'findings', 'evidence', 'candidates', 'ruled_out', 'open_questions', 'confidence'],
}

const SPEC_PROPS = {
  spec_path: { type: ['string', 'null'], description: 'null when the spec lives in the commit body' },
  root_cause: { type: 'string' },
  shared_seam: { type: 'string' },
  mechanism_explains_reported_data: { type: 'boolean' },
  user_change: { type: 'string', description: 'one or two plain sentences: what changes for the user' },
  decision_required: { type: ['string', 'null'] },
  out_of_scope: { type: 'array', items: { type: 'string' } },
  manual_checks: { type: 'array', items: { type: 'string' } },
  docs_impact: { type: 'string', description: '"none" when no docs change is needed (justify in docs_justification); otherwise the doc files to update' },
  docs_justification: { type: 'string' },
  assumptions: { type: 'array', items: { type: 'string' } },
  laws: { type: 'array', items: { type: 'string' } },
}
const SPEC_REQ = ['root_cause', 'shared_seam', 'mechanism_explains_reported_data', 'user_change', 'out_of_scope', 'docs_impact']
const SPEC = { type: 'object', properties: SPEC_PROPS, required: ['spec_path'].concat(SPEC_REQ) }

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

// small issues and resume: spec fields and plan units in one return
const SPECPLAN = {
  type: 'object',
  properties: Object.assign({}, SPEC_PROPS, PLAN.properties),
  required: SPEC_REQ.concat(PLAN.required),
}

const FIT = {
  type: 'object',
  properties: {
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: { option: { type: 'string' }, kind: { type: 'string', enum: ['reported', 'neighbour'] }, p: { type: 'number' } },
        required: ['option', 'kind', 'p'],
      },
    },
    reason: { type: 'string' },
  },
  required: ['options', 'reason'],
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
          file: { type: ['string', 'null'], description: 'the repo path the finding is about, if any' },
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
    head_before: { type: 'string', description: 'output of `git rev-parse HEAD` before you changed anything' },
    all_green: { type: 'boolean' },
    gates: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, passed: { type: 'boolean' }, skipped: { type: 'boolean' }, output_tail: { type: 'string' }, log_path: { type: 'string' } }, required: ['command', 'passed', 'skipped', 'output_tail'] } },
    failures_fixed: { type: 'array', items: { type: 'string' } },
    commits: { type: 'array', items: { type: 'string' } },
    ci_only: { type: 'array', items: { type: 'string' }, description: 'profile checks not run because they need a PR or CI context' },
    remaining_failures: { type: 'array', items: { type: 'string' } },
    known_flaky_matched: { type: 'array', items: { type: 'string' } },
  },
  required: ['head_before', 'all_green', 'gates', 'failures_fixed', 'remaining_failures'],
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
through the real entry point, and report MEASURED values and the method in evidence; (5) state the confirmed cause, or what remains open and what would settle it.
Heuristics: sibling path works? diff its inputs to the shared dependency. Silent "success" endpoint? check the exact input matches a real record first.
Runner hangs? run one trivial known-good test, then bisect. Model returns empty? swap one model at a time. Derived output contradicts itself? look for a missing upstream input.
Ask what a one-line fix would newly arm downstream. Look for a test that asserts the dangerous behaviour as correct.
If two plausible symptoms share this surface, give the one question that separates them (distinguishing_question).
If the only fixes are destructive or lose data, fill decision_required with a menu (each option: what survives, what is lost).
Domain packs live in ${SKILL}/references/packs/. The first paragraph of each says when it applies; return in packs every name whose trigger this issue meets.
Delete throwaway probes; keep a reproduction only if it is a proper regression test (and say where).
${preamble()}`

const SPEC_RULES = `Spec rules: fix the root cause at the shared seam every caller routes through, with the smallest change that fully resolves the REPORTED symptom.
Include: exact user-facing copy; what changes for the user, in plain words (user_change); tests: the regression test is the diagnosis reproduction, at the highest level that still reproduces the reported symptom, and fails before the fix; name the interface each test drives (page, route, CLI, public function); an acceptance fixture shaped like the reporter's anonymised data; docs impact ("none" plus a real justification, or the files);
EXPLICITLY OUT OF SCOPE (adjacent cleanup becomes follow-up issues, listed by title); what agents cannot validate (manual checks); honest risks; assumptions made instead of asking.${A.agentBriefPath ? `\nThe agent brief at ${A.agentBriefPath} is input: its acceptance criteria and out-of-scope list carry into the spec (the "Agent brief:" line).` : ''}
If no diagnosed mechanism produces the symptom on the reported data, say so (mechanism_explains_reported_data=false) and specify the measurement needed or a fix correct regardless plus in-product evidence capture.
If the change contradicts an ADR, write "Contradicts ADR-NNNN … but worth reopening because …". For data-sensitive changes, write the load-bearing invariant and its catastrophic failure mode.
Prefer the fix that works with already-deployed state. Delete low-value broken paths rather than repairing them. Use glossary terms.`

const PLAN_RULES = `Plan rules: the plan is where each build task's code is written. Put ACTUAL code and exact signatures in it. Banned: "TBD", "add appropriate handling", "similar to Task N".
Use ${SMALL ? 'exactly 1 task' : '3 to 9 tasks (slice hard at about 10)'}, root fix first. Each task is a vertical slice that delivers observable behaviour through a real interface; never split by layer.
The root-fix task is test-first, as checkbox steps: write the failing test through the interface it names → run it and SEE it fail → implement → see it pass → typecheck/lint → commit explicit paths. Other tasks add tests where they change behaviour.
List every file each task touches and mark depends_on accurately. File overlap is used only to schedule waves (tasks sharing a file never run at once). Docs belong to the docs stage, never to a task.
Copy the relevant laws into each task. Tell tasks which shared components and helpers to reuse instead of re-implementing them. Tests prefer real collaborators to mocks.
Return the tasks as structured units; "instructions" is that task's full section, verbatim, code included.`

const specPrompt = (diags) => `You are writing the SPEC for issue ${ISSUE.id}. Write it to ${A.specPath} using the house template (templates/spec.md of the resolve-issue skill, or the exemplar in ${(P.docs && P.docs.index) || 'the docs index'}).
Diagnoses (verbatim, ${diags.length} independent angle(s)). Where they disagree, read the code yourself and decide:
${JSON.stringify(diags, null, 2)}

${SPEC_RULES}
Commit the spec file (explicit path).
${preamble()}`

const planPrompt = (spec) => `You are writing the PLAN for issue ${ISSUE.id}. Read the spec at ${spec.spec_path} first. Write the plan to ${A.planPath} (templates/plan.md format) and commit it.
${PLAN_RULES}
Spec summary: ${JSON.stringify(spec)}
${preamble()}`

const specPlanPrompt = (diags) => `You are writing the SPEC and the PLAN for SMALL issue ${ISSUE.id}, in one pass.
Diagnosis (verbatim). Read the code yourself wherever it is thin:
${JSON.stringify(diags, null, 2)}

${SPEC_IN_COMMIT
    ? 'Write NO spec file. The spec goes in the root-fix task\'s commit body: root cause and how it was confirmed, shared seam, the regression test and the interface it drives, out of scope, docs impact. Put that commit body in the task\'s commit step. Return spec_path=null.'
    : `Write the spec to ${A.specPath} (templates/spec.md format) and commit it.`}
Write the plan to ${A.planPath} (templates/plan.md format) and commit it. Return the spec fields and the plan units together.
${SPEC_RULES}
${PLAN_RULES}
${preamble()}`

const loadPlanPrompt = () => `You are RESUMING issue ${ISSUE.id} at the build stage, after a human reviewed the committed plan. Read the plan at ${A.planPath} and the spec (${SPEC_REF}) as committed on ${A.branch}.
Return the spec fields and the plan's tasks as structured units, each task's section verbatim. Modify nothing.
${preamble()}`

const fitPrompt = (spec, plan) => `Symptom check before build [PL-1]. Read the verbatim report at ${A.reportPath}, the spec (${spec.spec_path || SPEC_REF}) and the plan at ${plan.plan_path}.
Question: does this plan fix the REPORTED symptom, or a NEIGHBOURING one? List the reported symptom (kind "reported") plus at least two real neighbouring symptoms on the same surface (kind "neighbour"), and give each a probability (sum to 1). Do not modify any file.
${preamble()}`

const buildPrompt = (t, prefix) => `${prefix || ''}You are the BUILDER for task ${t.id} of issue ${ISSUE.id}: ${t.title}.
Files you may touch (and nothing else): ${t.files.join(', ')}
Execute the plan's task exactly: run its tests, tick its checkboxes in ${A.planPath}, and commit the ticked plan file TOGETHER with your own files, by explicit path, in the task commit. Never leave ticks uncommitted [BD-21].
If the plan's code does not compile against reality, fix it to match and REPORT the deviation. Report the commands you ran and their real output.
Only do the task you are given; do not invent additional work. Do not add dependencies; if one seems necessary, stop and report.
Run typecheck/build for what you touched, not the full browser suites. When you add a field, grep every write path and validator; when you add an export to a mocked module, update every mock of it.
TASK (verbatim from the plan):
${t.instructions}
ACCEPTANCE: ${t.acceptance}
${preamble()}`

// The verifier gets the commits, the task and its acceptance, and the builder's declared deviations.
// Never the builder's report: its claims anchor the verdict [VF-1].
const verifyPrompt = (t, shas, deviations) => `You are an ADVERSARIAL VERIFIER for task ${t.id} of issue ${ISSUE.id}: ${t.title}.
You did not write this. Assume it is wrong until your own commands prove otherwise. Fix NOTHING. If unsure, fail.
Authority order: mockup > spec (${SPEC_REF}) > plan (${A.planPath}). Commits to check: ${shas.join(' ') || '(none reported: find them with git log)'}.
TASK (verbatim from the plan):
${t.instructions}
ACCEPTANCE: ${t.acceptance}
Deviations from the plan the builder declared (claims to check, not facts):
${list(deviations)}
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
13. None of the build pitfalls in references/verification.md section 2 (stripped fields, orphaned triggers, cache-masked indicators, unhandled promise chains, route order, effect loops, silent not_configured, hardcoded formats, and the rest).
14. Each test drives the interface it names. A test that imports internals (private helpers, module internals no caller uses) is a test-gap finding.
Kill any server you start. code_defect=true ONLY for real logic defects, not bookkeeping. unfinished_work must name files and symbols precisely.
Put everything else you noticed in non_blocking_findings, each with a severity (defect | test-gap | doc-copy | follow-up | bookkeeping) and the file it is about. Tag honestly: a reachable wrong behaviour (a page stuck loading, a raw 500, misleading copy) is a defect or doc-copy even if it is outside this task [VF-31, VF-11].
A defect in this task's own files sends the task back for repair even if everything else passes.
${preamble()}`

const repairPrompt = (t, v) => `You are REPAIRING task ${t.id} of issue ${ISSUE.id}: ${t.title}. A previous attempt was rejected by an independent verifier. Fix EXACTLY this:
${v.unfinished_work}
Failed checks: ${JSON.stringify((v.checks || []).filter((c) => !c.ok))}
Files you may touch: ${t.files.join(', ')}. Commit the fix (explicit paths, trailers). Do not weaken any test. Report commands and real output.
Original task (verbatim):
${t.instructions}
${preamble()}`

const completePrompt = (tasks) => `You are a COMPLETENESS CHECKER for issue ${ISSUE.id}. Cross-check the plan's units against the actual tree on ${A.branch} (git log ${BASE}..HEAD, plus the files themselves).
Units: ${JSON.stringify(tasks.map((t) => ({ id: t.id, title: t.title, files: t.files, acceptance: t.acceptance })))}
Return the ids of units with no real implementation (missing or stubbed). Modify nothing.
${preamble()}`

const gatesPrompt = () => `You are the GATES agent for issue ${ISSUE.id}. First record \`git rev-parse HEAD\` as head_before.
Run EXACTLY these commands, in this order, and no others:
${list(gateCmds().length ? gateCmds() : ['(no gate commands in the profile: report all_green=false and stop)'])}
E2E in this run: ${A.e2e ? 'YES, as listed above; run it in the foreground with a long timeout' : 'NO. Report e2e as skipped (it runs from the main checkout at merge). Never report skipped as passed'}.
For each gate: save the FULL output to a log file, grep ALL of it for "failed" and "flaky", and record the exit code separately from your own grep's exit code.
Known-flaky SET: ${JSON.stringify(P.known_flaky || [])}. A failure inside this set is non-blocking ONLY if it matches. A new failure in the touched area blocks.
You may fix ONLY a failure you can tie to a file this branch changed (\`git diff --name-only ${BASE}...HEAD\`). Everything else goes in remaining_failures, unchanged.
Every fix is its own commit, listed in commits; a fresh verifier will review each one. Do NOT run the CI-only checks from the shared context; list them in ci_only [TG-34].
To triage a red spec, run it alone and in the full run; require green twice in a row.
Change a TEST only when it asserts behaviour the app deliberately no longer has, and cite the commit. Never skip, retry-wrap, raise timeouts, loosen or weaken anything. If that seems necessary, stop and report.
Kill every server you start and prove zero listeners on the run's ports at the end.
${preamble()}`

const gatesVerifyPrompt = (g) => `You are an ADVERSARIAL VERIFIER of the commits the GATES agent made for issue ${ISSUE.id}. Nobody else reviews them. Assume they are wrong until your own commands prove otherwise. Fix NOTHING. If unsure, fail.
The gates agent says it started at ${g.head_before || '(not reported: fail check 1)'} and made: ${(g.commits || []).join(' ')}. It says it fixed:
${list(g.failures_fixed)}
1. \`git log --format='%H %s' ${g.head_before || '<head_before>'}..HEAD\` lists exactly those commits, nothing more.
2. Read \`git diff ${g.head_before || '<head_before>'}..HEAD\`. Each hunk fixes a named gate failure, and nothing else.
3. Every touched file is one this branch already changed (\`git diff --name-only ${BASE}...${g.head_before || '<head_before>'}\`) or a test that exercises one of them.
4. Nothing was weakened: no skip/only, retry wrapper, raised timeout, loosened or deleted assertion, deleted test. A test may change only where it asserts behaviour the app deliberately no longer has, citing the commit.
5. Trailers present; laws hold by grep; no TODO/FIXME. 6. Re-run the gate commands those commits were meant to fix, and see them pass.
code_defect=true ONLY for real logic defects. Tag every non-blocking finding with a severity and file [VF-31].
${preamble()}`

const docsPrompt = (gates) => `You are the DOCS agent for issue ${ISSUE.id}. The spec says docs are affected: ${result.spec ? result.spec.docs_impact : '(see spec)'}. Check that against this change (git diff ${BASE}...HEAD).
Update the user docs where behaviour changed (content, not just stamps; plain language; accurate privacy claims), the developer docs for the changed code, the glossary only if a term was resolved,
and the changelog under "${(P.docs && P.docs.unreleased_heading) || '## Unreleased'}" in ${(P.docs && P.docs.changelog) || 'CHANGELOG.md'} (never the version file, never a released section).
Link the spec and plan from ${(P.docs && P.docs.index) || 'the docs index'}. Add an ADR only if the decision is hard to reverse, surprising and a real trade-off, grounded in cited evidence, with the rankings and any overrules.
Never document behaviour that cannot fire. Check every sentence against the code. Run the doc checks. Commit explicit paths.
If on reading the diff nothing user- or developer-facing changed after all: docs_impact="none" with a real justification.
Gates result: ${JSON.stringify(gates).slice(0, 8000)}
${preamble()}`

const docsVerifyPrompt = (d) => `You are an ADVERSARIAL VERIFIER of documentation for issue ${ISSUE.id}. For every claim in these changed docs, find the code that makes it true, or fail it.
Check that the changelog entry is under the Unreleased heading and claims only what shipped. Fix nothing.
Tag every non-blocking finding with a severity (defect | test-gap | doc-copy | follow-up | bookkeeping) [VF-31].
Docs result: ${JSON.stringify(d)}
${preamble()}`

// ---------- per-stage metrics [CO-2] ----------

// Token deltas per phase from budget.spent(); wall-clock time is the main loop's job.
const STAGES = []
let cur = null
const spentNow = () => (typeof budget !== 'undefined' && budget && typeof budget.spent === 'function' ? budget.spent() : null)
function closeStage() {
  if (!cur) return
  const now = spentNow()
  STAGES.push({ stage: cur.stage, agents: cur.agents, spent: now != null && cur.from != null ? now - cur.from : null })
  cur = null
}
function stage(title) {
  closeStage()
  phase(title)
  cur = { stage: title, agents: 0, from: spentNow() }
}
function call(prompt, o) {
  if (cur) cur.agents++
  return agent(prompt, o)
}

// ---------- per-task loop: build → verify → repair (one tier up) ----------

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// does a finding name one of the task's files? (full path, or basename as a whole word)
function touchesTask(f, t) {
  if (f.file && (t.files || []).includes(f.file)) return true
  const text = `${f.file || ''} ${f.finding || ''}`
  return (t.files || []).some((p) => p && new RegExp(`(^|[^\\w.-])(${esc(p)}|${esc(p.split('/').pop())})(?=$|[^\\w-])`).test(text))
}

async function runTask(t, prefix) {
  const b = await call(buildPrompt(t, prefix), opts('build', { label: `build ${t.id}`, phase: 'Build', schema: BUILD }))
  if (!b) return { id: t.id, title: t.title, status: 'failed', reason: 'agent died (build)', attempts: [] } // [OR-9]
  const shas = (b.commits || []).slice()
  const deviations = (b.deviations || []).slice()
  const attempts = []
  let v = null
  for (let round = 0; round <= REPAIR_ROUNDS; round++) {
    v = await call(verifyPrompt(t, shas, deviations), opts('verify', { label: `verify ${t.id} #${round + 1}`, phase: 'Verify', schema: VERDICT }))
    if (!v) v = await call(verifyPrompt(t, shas, deviations), opts('verify', { label: `re-verify ${t.id} #${round + 1}`, phase: 'Verify', schema: VERDICT })) // a null verdict is never a pass
    if (!v) {
      attempts.push({ round, verdict: null })
      return { id: t.id, title: t.title, status: 'failed', reason: 'verifier died twice', commits: shas, attempts, build: b }
    }
    const nb = v.non_blocking_findings || []
    // a pass that carries a defect in the task's own files is a rejection [VF-11]
    const own = v.passed ? nb.filter((f) => f && typeof f === 'object' && f.severity === 'defect' && touchesTask(f, t)) : []
    if (own.length) {
      v = Object.assign({}, v, {
        passed: false,
        code_defect: true,
        unfinished_work: [v.unfinished_work, 'The verifier passed this task but found defects in its own files. Fix them:', ...own.map((f) => `- ${f.finding}`)].filter(Boolean).join('\n'),
        checks: (v.checks || []).concat([{ check: 'no defect findings in the task\'s files', ok: false, detail: own.map((f) => f.finding).join(' | ') }]),
      })
    }
    attempts.push({ round, passed: v.passed, code_defect: v.code_defect, summary: v.summary, promoted_defects: own.length, non_blocking: nb.filter((f) => !own.includes(f)) })
    if (v.passed) return { id: t.id, title: t.title, status: 'verified', commits: shas, attempts, build: b, repairs: round }
    if (round === REPAIR_ROUNDS) break
    const r = await call(repairPrompt(t, v), opts('repair', { label: `repair ${t.id} #${round + 1}`, phase: 'Verify', schema: BUILD }))
    if (r && r.commits) shas.push(...r.commits)
    if (r && r.deviations) deviations.push(...r.deviations)
  }
  return { id: t.id, title: t.title, status: 'failed', reason: 'rejected after repairs', unfinished_work: v.unfinished_work, commits: shas, attempts, build: b, repairs: REPAIR_ROUNDS }
}

// ---------- symptom check verdict, computed here rather than by the model [PL-1] ----------

function fitVerdict(options) {
  const ps = (options || []).filter((o) => o && typeof o.p === 'number').sort((a, b) => b.p - a.p)
  if (ps.length < 2 || !ps.some((o) => o.kind === 'reported')) return 'close' // malformed: unsure, so back to diagnosis
  if (Math.round((ps[0].p - ps[1].p) * 1000) <= CLOSE_P * 1000) return 'close'
  return ps[0].kind === 'reported' ? 'reported' : 'neighbour'
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
  for (const f of (r.gates_verdict && r.gates_verdict.non_blocking_findings) || []) add(f, 'gates')
  for (const f of (r.docs_verdict && r.docs_verdict.non_blocking_findings) || []) add(f, 'docs')
  const out = {}
  for (const sev of SEVERITIES) out[sev] = []
  for (const m of merged.values()) out[m.severity].push(m)
  return out
}

function metrics(r) {
  const ts = (r.tasks || []).filter(Boolean)
  const attempts = [].concat(...ts.map((t) => t.attempts || []))
  return {
    tasks: ts.length,
    verified: ts.filter((t) => t.status === 'verified').length,
    tasks_with_code_defect: ts.filter((t) => (t.attempts || []).some((a) => a.code_defect)).length, // [CO-2]
    repairs: ts.reduce((n, t) => n + (t.repairs || 0), 0),
    verifier_rejections: attempts.filter((a) => a.passed === false).length + (r.gates_verdict && r.gates_verdict.passed === false ? 1 : 0),
    promoted_defects: attempts.reduce((n, a) => n + (a.promoted_defects || 0), 0),
    gates_commits: (r.gates && r.gates.commits && r.gates.commits.length) || 0,
    agents: STAGES.reduce((n, s) => n + s.agents, 0),
    stages: STAGES,
  }
}

function compact(r) {
  const findings = mergeFindings(r)
  const g = r.gates
  const commits = [...new Set([].concat(...(r.tasks || []).map((t) => (t && t.commits) || []), (g && g.commits) || [], (r.docs && r.docs.commits) || []))]
  const cands = [].concat(...(r.diagnoses || []).map((d) => d.candidates || [])).sort((a, b) => (b.rank_p || 0) - (a.rank_p || 0))
  return {
    issue: r.issue, size: r.size, status: r.status, stage: r.stage || null, reason: r.reason || null,
    decision_required: r.decision_required || null,
    root_cause: r.spec ? r.spec.root_cause : (r.diagnoses || []).map((d) => d.findings).join(' | ') || null,
    confirmed_by: [].concat(...(r.diagnoses || []).map((d) => d.evidence || [])).slice(0, 2).join('; ') || null,
    ranking: cands.slice(0, 3).map((x) => ({ cause: x.cause, p: typeof x.rank_p === 'number' ? x.rank_p : null, verdict: x.verdict })),
    shared_seam: (r.spec && r.spec.shared_seam) || null,
    user_change: (r.spec && r.spec.user_change) || null,
    symptom_check: r.symptom_check ? { verdict: r.symptom_check.verdict, reason: r.symptom_check.reason } : null,
    paths: {
      spec: r.spec ? r.spec.spec_path || SPEC_REF : A.specPath || null,
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
    gates_commits_verified: r.gates_commits_verified === undefined ? null : r.gates_commits_verified,
    docs: r.docs ? { docs_impact: r.docs.docs_impact, justification: r.docs.justification, files: r.docs.files, decided_at: r.docs.decided_at || 'docs', verified: r.docs_verdict ? r.docs_verdict.passed : null } : null,
    commits,
    findings, // defects and test gaps first; the post-run audit re-triages this list [VF-11]
    follow_ups: findings['follow-up'].map((f) => f.finding).concat((r.spec && r.spec.out_of_scope) || []),
    manual_checks: (r.spec && r.spec.manual_checks) || [],
    metrics: metrics(r),
  }
}

// The human-facing summary, rendered from the data: nothing a model could embellish [CM-7, CM-3].
function renderSummary(c) {
  const word = { verified: 'verified', partial: 'partially verified', failed: 'failed' }[c.status] || String(c.status).replace(/_/g, ' ')
  const tick = (x) => (x.skipped ? 'skipped' : x.passed ? '✓' : '✗')
  const F = c.findings
  const open = []
    .concat(c.tasks.filter((t) => t && t.status !== 'verified').map((t) => `${t.id} ${t.status}`))
    .concat(c.gates ? c.gates.remaining_failures : [])
    .concat(c.decision_required ? ['decision required (menu in the result)'] : [])
  const next = c.status === 'stopped'
    ? (c.stage === 'plan' ? 'review the plan, then relaunch with resumeFrom: \'build\'.' : 'review the diagnosis, then relaunch without stopAfter.')
    : 'your yes to merge; then a separate yes to push.'
  return [
    `${c.issue.id} ${c.issue.title}: ${word}${c.stage ? ` (at ${c.stage})` : ''}${c.reason ? `. ${c.reason}` : ''}`,
    `Root cause: ${c.root_cause || 'not established'}. Confirmed by: ${c.confirmed_by || 'nothing measured'}.`,
    `Ranking: ${c.ranking.length ? c.ranking.map((x) => `${x.cause} p=${x.p === null ? '?' : x.p} (${x.verdict})`).join('; ') : 'none recorded'}.`,
    `What changes for the user: ${c.user_change || 'not stated'}.`,
    `Gates: ${c.gates ? c.gates.table.map((x) => `${x.command} ${tick(x)}`).join(', ') + (c.gates.ci_only.length ? ` (ci_only: ${c.gates.ci_only.length})` : '') : 'not run'}${c.gates_commits_verified === null ? '' : `; gates commits verified: ${c.gates_commits_verified ? 'yes' : 'NO'}`}`,
    `Findings: defects ${F.defect.length}; test gaps ${F['test-gap'].length}; doc/copy ${F['doc-copy'].length}; follow-ups to file ${c.follow_ups.length}`,
    `Commits (git log ${BASE}..HEAD): ${c.commits.map((s) => String(s).slice(0, 7)).slice(0, 12).join(' ') || 'none'}`,
    `Check by hand: ${c.manual_checks.join('; ') || 'the reporter\'s own flow'}`,
    `Open: ${open.join('; ') || 'nothing'}`,
    `Next: ${next}`,
  ].join('\n')
}

// Shrink until it fits: clip prose, then drop the lowest severities. Defects and test gaps go last.
function capReturn(c) {
  const size = () => JSON.stringify(c).length
  const clip = (x, n) => (typeof x === 'string' && x.length > n ? x.slice(0, n) + ' …[clipped; see journal]' : x)
  const clipAll = (n) => {
    c.summary = clip(c.summary, n * 4); c.root_cause = clip(c.root_cause, n); c.decision_required = clip(c.decision_required, n * 4)
    c.user_change = clip(c.user_change, n); c.confirmed_by = clip(c.confirmed_by, n); c.reason = clip(c.reason, n * 4)
    c.ranking.forEach((x) => { x.cause = clip(x.cause, n) })
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
  closeStage()
  const c = compact(r)
  c.summary = renderSummary(c)
  return capReturn(c)
}

// ---------- pipeline ----------

const result = { issue: ISSUE, size: SIZE, status: 'running', diagnoses: [], spec: null, plan: null, symptom_check: null, tasks: [], gates: null, docs: null }
const splitSpecPlan = (sp) => {
  const plan = { plan_path: sp.plan_path, tasks: sp.tasks }
  const spec = Object.assign({}, sp)
  delete spec.plan_path; delete spec.tasks
  return { spec, plan }
}

if (A.resumeFrom === 'build') {
  stage('Plan')
  const sp = await call(loadPlanPrompt(), opts('plan', { label: 'load plan', schema: SPECPLAN }))
  if (!sp || !(sp.tasks || []).length) return finish(Object.assign(result, { status: 'failed', stage: 'plan', reason: sp ? 'committed plan has no tasks' : 'agent died' }))
  Object.assign(result, splitSpecPlan(sp))
} else {
  stage('Diagnose')
  const angles = SMALL
    ? ['end-to-end trace of the reported path']
    : ['what the failing component or function actually receives (inputs, props, payloads, state)', 'where the working path and the failing path diverge']
  result.diagnoses = (await parallel(angles.map((a, i) => () =>
    call(diagPrompt(a), opts('diagnose', { label: `diagnose ${i + 1}`, phase: 'Diagnose', schema: DIAG }))))).filter(Boolean)
  if (!result.diagnoses.length) return finish(Object.assign(result, { status: 'failed', stage: 'diagnose', reason: 'all diagnosers died' }))
  for (const d of result.diagnoses) for (const n of d.packs || []) PACKS.add(n)
  const decision = result.diagnoses.find((d) => d.decision_required)
  if (decision) return finish(Object.assign(result, { status: 'decision_required', decision_required: decision.decision_required })) // [SP-11]
  if (A.stopAfter === 'diagnose') return finish(Object.assign(result, { status: 'stopped', stage: 'diagnose' }))

  if (SMALL) {
    stage('Spec')
    const sp = await call(specPlanPrompt(result.diagnoses), opts('spec', { label: 'spec plan', schema: SPECPLAN }))
    if (!sp) return finish(Object.assign(result, { status: 'failed', stage: 'spec', reason: 'agent died' }))
    Object.assign(result, splitSpecPlan(sp))
  } else {
    stage('Spec')
    result.spec = await call(specPrompt(result.diagnoses), opts('spec', { label: 'spec', schema: SPEC }))
    if (!result.spec) return finish(Object.assign(result, { status: 'failed', stage: 'spec', reason: 'agent died' }))
  }
  if (result.spec.decision_required) return finish(Object.assign(result, { status: 'decision_required', decision_required: result.spec.decision_required }))
  if (!result.spec.mechanism_explains_reported_data) log('Spec: no diagnosed mechanism fully explains the reported data. Proceeding with a fix that is correct regardless, plus evidence capture [SP-3].')

  stage('Plan')
  if (!SMALL) result.plan = await call(planPrompt(result.spec), opts('plan', { label: 'plan', schema: PLAN }))
  if (!result.plan || !(result.plan.tasks || []).length) return finish(Object.assign(result, { status: 'failed', stage: 'plan', reason: result.plan ? 'plan returned no tasks' : 'agent died' }))
  if (result.plan.tasks.length > 10) log(`Plan has ${result.plan.tasks.length} tasks (cap is about 9). Consider slicing into sub-issues [PL-7].`)
  // the symptom check runs only when no diagnosis measured a reproduction [PL-1, DG-8]
  const measured = result.diagnoses.every((d) => d.confidence === 'high' && (d.evidence || []).length > 0)
  if (!measured) {
    result.symptom_check = await call(fitPrompt(result.spec, result.plan), opts('verify', { label: 'symptom check', phase: 'Plan', schema: FIT }))
    if (result.symptom_check) {
      result.symptom_check.verdict = fitVerdict(result.symptom_check.options)
      if (result.symptom_check.verdict !== 'reported') {
        return finish(Object.assign(result, { status: 'plan_mismatch', reason: `symptom check: ${result.symptom_check.verdict}. ${result.symptom_check.reason}` })) // back to diagnosis
      }
    }
  }
  if (A.stopAfter === 'plan') return finish(Object.assign(result, { status: 'stopped', stage: 'plan' }))
}
const tasks = result.plan.tasks

stage('Build')
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
  // file overlap only schedules: tasks sharing a file never run in the same wave [PL-4, OR-11], capped by maxParallel [SZ-2]
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

// completeness: plan units vs tree [VF-13]; dispatch a completion agent for exactly the missing ones [OR-10].
// One task has its own verifier looking at exactly that unit, so the cross-check adds nothing there.
if (tasks.length > 1) {
  const comp = await call(completePrompt(tasks), opts('verify', { label: 'completeness', phase: 'Verify', schema: COMPLETE }))
  const missing = comp ? comp.missing.filter((id) => ids.has(id) && byId[id] && byId[id].status === 'verified') : []
  if (missing.length) {
    log(`Completeness: ${missing.join(', ')} verified but missing from the tree. Dispatching completion.`)
    const redoTasks = tasks.filter((t) => missing.includes(t.id))
    const redo = await parallel(redoTasks.map((t) => () =>
      runTask(t, `COMPLETION: an independent check found this unit missing or stubbed in the tree (${comp.detail}). Implement exactly this unit.\n`)))
    redoTasks.forEach((t, i) => { byId[t.id] = redo[i] ? Object.assign(redo[i], { completion: true }) : { id: t.id, title: t.title, status: 'failed', reason: 'agent died (completion)' } })
  }
  result.completeness = comp
}
result.tasks = tasks.map((t) => byId[t.id])

stage('Gates')
result.gates = await call(gatesPrompt(), opts('gates', { label: 'gates', schema: GATES }))
if (result.gates && (result.gates.commits || []).length) {
  // gates commits are code nobody else reviews: one fresh verifier over head_before..HEAD [VF-1, TG-7]
  result.gates_verdict = await call(gatesVerifyPrompt(result.gates), opts('verify', { label: 'verify gates', phase: 'Gates', schema: VERDICT }))
  result.gates_commits_verified = !!(result.gates_verdict && result.gates_verdict.passed)
}

stage('Docs')
if (/^none\b/i.test(String(result.spec.docs_impact || '').trim())) {
  // decided at spec, with its justification; no docs agent [DC-1]
  result.docs = { docs_impact: 'none', justification: result.spec.docs_justification || result.spec.docs_impact, files: [], decided_at: 'spec' }
} else {
  result.docs = await call(docsPrompt(result.gates), opts('docs', { label: 'docs', schema: DOCS }))
  if (result.docs && result.docs.docs_impact === 'updated') {
    result.docs_verdict = await call(docsVerifyPrompt(result.docs), opts('verify', { label: 'verify docs', phase: 'Docs', schema: VERDICT })) // [VF-6]
  }
}

const allVerified = result.tasks.every((t) => t && t.status === 'verified')
result.status = allVerified && result.gates && result.gates.all_green && result.gates_commits_verified !== false ? 'verified' : 'partial'
return finish(result) // compact and capped, summary rendered from the data [OR-26]
