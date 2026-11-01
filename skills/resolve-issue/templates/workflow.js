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
//   scratchDir:   '/abs/scratch',                // OUTSIDE the worktree: logs → <scratchDir>/<issue>/logs, screenshots → .../screenshots [IS-19]
//   openIssues:   [{ number: 12, title: '...', labels: ['bug'] }],  // fetched by the main loop with the tracker CLI; the harvest dedupes against it [OR-27]
//   decisions:    [],                            // the human's answers to an earlier decision_required, verbatim; spec rows cite them by index [SP-18]
// }
// Returns a COMPACT result for the post-run audit [OR-18, OR-26]: status, root cause, a gates table,
// the commit list, merged and deduped findings by severity [VF-31], follow-ups to file, per-stage
// metrics, paths, and a summary rendered from that data (no summary agent). Capped at RETURN_CAP
// characters; full per-stage outputs stay in the run journal and in the spec and plan files.
// When the spec says user_visible, a VIEW agent screenshots before/after and judges them (it builds nothing).
// A final HARVEST stage turns side findings into issue drafts (side_issues, bundle_issue); the main loop files them.
// Wall-clock time is not available here: the main loop records start and end in the run log.
// The run ends at a verified branch. It never pushes, tags or releases [HG-1].

export const meta = {
  name: 'resolve-issue-__ISSUE__',
  description: 'Issue __ISSUE__: diagnose → spec → plan → parallel build → per-task adversarial verify/repair → gates (+ verify gates commits) → docs if affected → side-issue harvest. VIEW lens when user-visible. Stops at a verified branch.',
  whenToUse: 'One tracker issue, after pre-flight, sizing and worktree setup are done in the main loop.',
  phases: [
    { title: 'Diagnose', detail: 'rank candidate causes, probe, confirm. No fixes' },
    { title: 'Spec', detail: 'root cause at the shared seam, scope, tests, docs impact' },
    { title: 'Plan', detail: 'real code, structured units, symptom check when the repro was not measured' },
    { title: 'Build', detail: 'one builder per task, waves over the dependency graph' },
    { title: 'Verify', detail: 'fresh adversarial verifier per task, repair one tier up, max 3 rounds' },
    { title: 'View', detail: 'only when the spec says user_visible: before/after screenshots judged against the design docs; branch defects get 1 repair' },
    { title: 'Gates', detail: 'fixed gate list, whole-log failure grep, known-flaky set; a fresh verifier over any gates commits' },
    { title: 'Docs', detail: 'only when the spec says docs are affected; changelog under Unreleased, claim check' },
    { title: 'Harvest', detail: 'side findings from every stage → deduped issue drafts for the main loop to file' },
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
const SHA = /^[0-9a-f]{7,40}$/ // a builder's commit ids must look like this [BD-22]
const SAME_CAUSE_ROUNDS = 2 // repairs after which an unchanged behaviour-choice failure stops the task [VF-5]
const SCRATCH = A.scratchDir ? `${A.scratchDir}/${ISSUE.id}` : `${A.worktree}-scratch` // never inside the worktree [IS-19]
const LOG_DIR = `${SCRATCH}/logs`
const SHOT_DIR = `${SCRATCH}/screenshots`
const DECISIONS = A.decisions || []
const OPEN_ISSUES = A.openIssues || []
const KINDS = ['bug', 'ux', 'a11y', 'perf', 'docs', 'infra', 'test']
const SERIOUS = ['privacy', 'security', 'data-loss', 'broken-flow', 'wrong-state'] // each its own issue; anything else is 'minor' and bundled [OR-27]
const STALE_STAGES = ['verify', 'view', 'gates', 'docs'] // a finding true only until one of these ran [VF-32]

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

// spec rows a human decision settles [SP-18]; result is set before any prompt runs
const decidedRows = () => ((result.spec && result.spec.privacy_security_rows) || []).filter((x) => x && Number.isInteger(x.decision_ref) && DECISIONS[x.decision_ref] !== undefined).map((x) => Object.assign({}, x, { decision: DECISIONS[x.decision_ref] }))

const joinCmd = (v) => (Array.isArray(v) ? v.join(' && ') : v)

function cmds() {
  const c = P.commands || {}
  return Object.keys(c).map((k) => `  ${k}: ${joinCmd(c[k])}`).join('\n') || '  (see profile)'
}

// The gates agent runs exactly this list, in order. No improvising [TG-6].
function gateCmds() {
  const c = P.commands || {}
  const out = Object.keys(c).filter((k) => c[k] && !['install', 'post_install', 'e2e', 'e2e_isolated', 'docs_checks'].includes(k)).map((k) => `${k}: ${joinCmd(c[k])}`)
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
  'Stay in your worktree, branch and ports. Kill every server you start by process group, then prove it gone with ps.',
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
Logs: write server and test logs under ${LOG_DIR}/<port>/ (OUTSIDE the worktree, never committed), never a fixed shared path or a directory inside the worktree${((P.env && P.env.fixed_paths) || []).length ? ` (the test runner writes these fixed paths; override them: ${P.env.fixed_paths.join(', ')})` : ''} [IS-18, IS-19].
${P.env && P.env.shared_db ? 'The dev database is SHARED with other worktrees: functions or migrations another run applied may be there, and yours land on theirs. Use this run\'s own schema or database name when the profile gives one; a failure from another branch\'s DB objects is reported, never fixed [IS-17, TG-11].\n' : ''}Ports: use ONLY backend ${A.ports && A.ports.backend} and frontend ${A.ports && A.ports.frontend} with strict-port flags. NEVER use ${((P.ports && P.ports.reserved) || []).join(', ') || 'the developer default ports'}. Check ownership with lsof before starting a server. Start each server in its own process group (setsid, or record its PGID) and stop it with kill -- -<PGID>; then prove with \`ps -eo pid,pgid,ppid,command\` that none of your processes survive (orphans with PPID 1, such as a dev server's bundler child, count), not just with lsof [IS-20].
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
    side_findings: { type: 'array', description: 'real problems you saw that are NOT this issue\'s cause', items: { type: 'object', properties: { severity: { type: 'string', enum: SEVERITIES }, finding: { type: 'string' }, file: { type: ['string', 'null'] } }, required: ['severity', 'finding'] } },
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
  caller_flows: {
    type: 'array',
    description: 'only when a shared component\'s default or behaviour changes: one row per caller [SP-17]',
    items: {
      type: 'object',
      properties: { caller: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' }, intended: { type: 'string', enum: ['yes', 'no', 'unsure'] } },
      required: ['caller', 'before', 'after', 'intended'],
    },
  },
  user_visible: { type: 'boolean', description: 'true when the change alters what a user sees on any screen; turns on the VIEW lens' },
  view_targets: { type: 'array', items: { type: 'string' }, description: 'when user_visible: each affected screen and state to screenshot, e.g. "settings / empty", "record page / locked"' },
  privacy_security_change: { type: 'boolean', description: 'true when the change alters what is on screen or in the DOM when locked or logged out, or how long data lives (caches, storage, retention, logs) [SP-18]' },
  privacy_security_rows: {
    type: 'array',
    description: 'when privacy_security_change: one row per surface. decision_ref is the index of the human decision in the run\'s decisions list that settles the row, else null. Never settled by you or a ranker [SP-18]',
    items: {
      type: 'object',
      properties: { surface: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' }, decision_ref: { type: ['integer', 'null'] } },
      required: ['surface', 'before', 'after', 'decision_ref'],
    },
  },
}
const SPEC_REQ = ['root_cause', 'shared_seam', 'mechanism_explains_reported_data', 'user_change', 'out_of_scope', 'docs_impact', 'user_visible', 'privacy_security_change']
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
  properties: {
    plan_path: { type: 'string' },
    tasks: { type: 'array', items: TASK },
    serial_reason: { type: ['string', 'null'], description: 'only when every task must run after the one before: the real dependency, in one sentence [PL-15]' },
  },
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
    commits: { type: 'array', items: { type: 'string' }, description: 'full SHAs you created, from git log; anything else rejects the task [BD-22]' },
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
          severity: { type: 'string', enum: SEVERITIES, description: 'defect = wrong behaviour a user could hit, wrong persisted state, or a security or eligibility hole in this branch\'s code; test-gap = untested path; doc-copy = wrong or misleading text; follow-up = real but out of scope; bookkeeping = trailers, ticks, formatting' },
          finding: { type: 'string', description: 'one sentence, naming file:line or the screen' },
          file: { type: ['string', 'null'], description: 'the repo path the finding is about, if any' },
          until_stage: { type: ['string', 'null'], enum: STALE_STAGES.concat([null]), description: 'when the finding is true only until a later stage runs ("acceptance pending", "not yet committed"): that stage; else null [VF-32]' },
        },
        required: ['severity', 'finding'],
      },
    },
    negative_controls: {
      type: 'array',
      description: 'one per acceptance row of the task [VF-3]',
      items: {
        type: 'object',
        properties: { row: { type: 'string' }, result: { type: 'string', enum: ['red', 'green', 'infra_error'] }, detail: { type: 'string' } },
        required: ['row', 'result'],
      },
    },
    failing_test: { type: ['string', 'null'], description: 'when failing: the test that fails' },
    failure_cause: { type: ['string', 'null'], description: 'when failing: its root cause, one sentence' },
    behaviour_choice: { type: 'boolean', description: 'true when the failure hinges on an undecided product behaviour, not a code fault [VF-5]' },
    privacy_security_change: { type: ['string', 'null'], description: 'a change to what is on screen or in the DOM when locked or logged out, or to how long data lives, that no human-decided spec row covers: what changed, one sentence; else null [SP-18]' },
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

const VIEW = {
  type: 'object',
  properties: {
    screenshots: { type: 'array', items: { type: 'object', properties: { target: { type: 'string' }, viewport: { type: 'string' }, before: { type: ['string', 'null'] }, after: { type: ['string', 'null'] } }, required: ['target', 'viewport', 'before', 'after'] } },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          cause: { type: 'string', enum: ['branch', 'pre-existing'], description: 'branch = absent in the before shot, present after' },
          severity: { type: 'string', enum: SEVERITIES },
          kind: { type: 'string', enum: KINDS },
          finding: { type: 'string', description: 'one sentence naming the screen, state and viewport' },
          screenshots: { type: 'array', items: { type: 'string' } },
          file: { type: ['string', 'null'] },
        },
        required: ['cause', 'severity', 'finding', 'screenshots'],
      },
    },
    processes_left: { type: 'integer', description: 'processes of yours still alive per ps after cleanup; must be 0' },
  },
  required: ['screenshots', 'findings', 'processes_left'],
}

const HARVEST = {
  type: 'object',
  properties: {
    side_issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          body: { type: 'string' },
          kind: { type: 'string', enum: KINDS },
          severity: { type: 'string', enum: SERIOUS.concat(['minor']) },
          evidence: { type: 'array', items: { type: 'string' }, description: 'file:line at HEAD, or a screenshot path from this run' },
          duplicate_of: { type: ['integer', 'null'] },
          bundle: { type: 'boolean' },
        },
        required: ['title', 'body', 'kind', 'severity', 'evidence', 'duplicate_of', 'bundle'],
      },
    },
    dropped: { type: 'array', items: { type: 'object', properties: { finding: { type: 'string' }, reason: { type: 'string' } }, required: ['finding', 'reason'] } },
  },
  required: ['side_issues', 'dropped'],
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
Real problems you meet that are NOT this issue's cause go in side_findings (severity, one sentence with file:line); never chase them.
${preamble()}`

const SPEC_RULES = `Spec rules: fix the root cause at the shared seam every caller routes through, with the smallest change that fully resolves the REPORTED symptom.
Include: exact user-facing copy; what changes for the user, in plain words (user_change); tests: the regression test is the diagnosis reproduction, at the highest level that still reproduces the reported symptom, and fails before the fix; name the interface each test drives (page, route, CLI, public function); an acceptance fixture shaped like the reporter's anonymised data; docs impact ("none" plus a real justification, or the files);
EXPLICITLY OUT OF SCOPE (adjacent cleanup becomes follow-up issues, listed by title); what agents cannot validate (manual checks); honest risks; assumptions made instead of asking.${A.agentBriefPath ? `\nThe agent brief at ${A.agentBriefPath} is input: its acceptance criteria and out-of-scope list carry into the spec (the "Agent brief:" line).` : ''}
If no diagnosed mechanism produces the symptom on the reported data, say so (mechanism_explains_reported_data=false) and specify the measurement needed or a fix correct regardless plus in-product evidence capture.
If the change contradicts an ADR, write "Contradicts ADR-NNNN … but worth reopening because …". For data-sensitive changes, write the load-bearing invariant and its catastrophic failure mode.
Prefer the fix that works with already-deployed state. Delete low-value broken paths rather than repairing them. Use glossary terms.
If the change alters a shared component's default or behaviour, walk EVERY caller's flow (not just its import) and fill caller_flows: caller, flow before, flow after, intended yes|no|unsure. A row the report, spec and ADRs do not settle is "unsure"; never assume it [SP-17].
Set user_visible=true when the change alters what a user sees on any screen, and list each affected screen and state (locked, loading, empty, error where they apply) in view_targets.
If the change alters what is on screen or in the DOM when the app is locked or logged out, or how long data lives (caches, storage, retention, logs), or what goes to a third party or error reporting (telemetry, Sentry-like services), set privacy_security_change=true and add one privacy_security_rows row per surface.
That is ALWAYS the human's decision: never yours, never a ranker's, however confident. A row's decision_ref is the index of the human decision below that settles it, else null [SP-18].
If a diagnosis raised a decision_required menu (destructive or data-loss-sensitive), settle it ONLY from the human decisions below: spec the option they chose and cite its index; if none of them settles it, return decision_required with the menu again [SP-11, SP-19].\nHuman decisions for this run (verbatim, by index):
${DECISIONS.length ? DECISIONS.map((d, i) => `  [${i}] ${d}`).join('\n') : '  (none)'}`

const PLAN_RULES = `Plan rules: the plan is where each build task's code is written. Put ACTUAL code and exact signatures in it. Banned: "TBD", "add appropriate handling", "similar to Task N".
Use ${SMALL ? 'exactly 1 task' : '3 to 9 tasks (slice hard at about 10)'}, root fix first. Each task is a vertical slice that delivers observable behaviour through a real interface; never split by layer.
The root-fix task is test-first, as checkbox steps: write the failing test through the interface it names → run it and SEE it fail → implement → see it pass → typecheck/lint → commit explicit paths. Other tasks add tests where they change behaviour.
List every file each task touches and mark depends_on accurately. File overlap is used only to schedule waves (tasks sharing a file never run at once). Docs belong to the docs stage, never to a task.
Copy the relevant laws into each task. Tell tasks which shared components and helpers to reuse instead of re-implementing them. Tests prefer real collaborators to mocks.
Return the tasks as structured units; "instructions" is that task's full section, verbatim, code included.
Aim for parallel waves: a depends_on edge means a task needs another's code, not just its order. If every task truly must follow the one before, say why in serial_reason [PL-15].`

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

const replanPrompt = (spec, plan, shape) => `You are RE-PLANNING issue ${ISSUE.id} [PL-15]. The plan at ${plan.plan_path} has ${shape.tasks} tasks that the scheduler would run in ${shape.waves} waves: fully serial.
Rewrite it for parallelism: keep a depends_on edge only where a task needs another's code, and split shared files so independent tasks touch disjoint files. Update ${A.planPath} and commit it.
If serial really is right, keep the tasks and give the real dependency in serial_reason.
Current tasks: ${JSON.stringify(plan.tasks.map((t) => ({ id: t.id, title: t.title, files: t.files, depends_on: t.depends_on })))}
${PLAN_RULES}
Spec summary: ${JSON.stringify(spec)}
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
8. NEGATIVE CONTROL, one per ACCEPTANCE ROW (each criterion in ACCEPTANCE), recorded in negative_controls [VF-3]. Make a throwaway detached worktree at the last sha (outside ${A.worktree}), run a REAL dependency install there (${(P.commands && P.commands.install) || 'the frozen-lockfile install'}; never symlink dependency dirs, module mocks break)${P.commands && P.commands.post_install ? `, then ${joinCmd(P.commands.post_install)}` : ''}, and link only the env and secrets [IS-16].
   For each row, remove only the guard or code that row is about, run that row's tests, expect RED, and restore. A row whose tests stay GREEN is "green": its tests do not prove it. Then remove the throwaway worktree. Never stash or revert inside ${A.worktree}; other tasks are live there.
   The assertions must fail on the bad outcome (not merely "not throw"), and the component under test must not be mocked.
   A test that cannot load or start (module not found, missing codegen, install error) is an INFRASTRUCTURE error, never RED: fix the setup and rerun; if you cannot, record that row as infra_error.
9. The reported symptom (${A.reportPath}) is resolved for the reporter's data shape; reason explicitly about those rows.
10. Claims in docs and comments are true. 11. The feature is reachable from the UI. 12. Any gate is correct in both directions (no leak, full coverage).
13. None of the build pitfalls in ${SKILL}/references/verification.md section 2 (stripped fields, orphaned triggers, cache-masked indicators, unhandled promise chains, route order, effect loops, silent not_configured, hardcoded formats, and the rest).
14. Each test drives the interface it names. A test that imports internals (private helpers, module internals no caller uses) is a test-gap finding.
15. Privacy and security behaviour [SP-18]: does the diff change what is on screen or in the DOM when the app is locked or logged out, or how long data lives (caches, storage, retention, logs)? Human-decided rows from the spec: ${JSON.stringify(decidedRows())}. Any such change those rows do not cover goes in privacy_security_change, in one sentence; else null.
A finding that is true only until a later stage runs ("acceptance pending", "not yet committed", "gates not run") names that stage in until_stage [VF-32].
Kill any server you start. code_defect=true ONLY for real logic defects, not bookkeeping. unfinished_work must name files and symbols precisely.
Put everything else you noticed in non_blocking_findings, each with a severity (defect | test-gap | doc-copy | follow-up | bookkeeping) and the file it is about. Tag honestly: a reachable wrong behaviour (a page stuck loading, a raw 500, misleading copy) is a defect or doc-copy even if it is outside this task [VF-31, VF-11].
Wrong persisted state (a stale field left behind, a record that should have been cleared) or a security or eligibility hole (someone allowed who should not be) in THIS branch's code is a defect, never a follow-up [VF-31].
A defect in this task's own files sends the task back for repair even if everything else passes.
When failing, name failing_test and failure_cause. Set behaviour_choice=true only when the failure hinges on an undecided product behaviour (what SHOULD happen), not a code fault [VF-5].
${preamble()}`

const viewPrompt = (round, prior) => `You are the VIEW agent (the visual lens) for issue ${ISSUE.id}, round ${round}. You BUILD NOTHING and fix nothing: you look and report.
The spec (${SPEC_REF}) says this change is user-visible. Targets (screen / state):
${list(result.spec.view_targets)}
For each screen also capture the states the spec names among locked, loading, empty and error.
1. BEFORE: make a throwaway detached worktree at ${BASE}, OUTSIDE ${A.worktree}. Do a real install (${(P.commands && P.commands.install) || 'the frozen-lockfile install'})${P.commands && P.commands.post_install ? ` then ${joinCmd(P.commands.post_install)}` : ''}, link only the env and secrets [IS-16]. Start the app on this run's ports with TEST DATA ONLY (synthetic accounts and records; never production, staging or a real user's data). Screenshot every target at 390x844 and at 1440x900 [VF-23]. Stop its servers by process group, then remove the worktree.
2. AFTER: the same targets, viewports and data in ${A.worktree} at HEAD.
Screenshots go in ${SHOT_DIR}/round-${round}/ as <screen>-<state>-<viewport>-<before|after>.png. That directory is outside the worktree; never copy a screenshot into it or commit one [IS-19].
3. Judge the AFTER shots against the design docs (${[].concat((P.docs && P.docs.design) || []).join(', ') || 'none in the profile'}) and ${SKILL}/references/packs/ux.md, and compare them with BEFORE.
4. Each finding: cause "branch" when the BEFORE shot does not show it and AFTER does (this branch caused it), "pre-existing" when BEFORE shows it too; a severity (defect = a visual defect a user would hit: overlap, clipping, unreadable text, a blank or stuck state, a control out of reach); a kind; the screenshot paths; the file if you can name it.
${prior && prior.length ? `Round 1 found these branch defects and a repair was made. Check that each is gone:\n${list(prior.map((f) => f.finding))}\n` : ''}Report processes_left from ps after cleanup; it must be 0.
${preamble()}`

const viewRepairPrompt = (defects, files) => `You are REPAIRING visual defects that this branch caused in issue ${ISSUE.id}. An independent VIEW agent compared before and after screenshots. Fix EXACTLY these:
${defects.map((f) => `- ${f.finding} (screenshots: ${(f.screenshots || []).join(', ') || 'none'})`).join('\n')}
Files you may touch: ${files.join(', ')}. Commit the fix (explicit paths, trailers). Do not weaken any test. Report commands and real output.
${preamble()}`

const harvestPrompt = (items) => `You are the HARVEST agent for issue ${ISSUE.id}. You build nothing and file nothing: you DRAFT side issues. The main loop re-checks each draft against the code and files it.
Findings and follow-ups from every stage of this run (stale ones already dropped), JSON:
${JSON.stringify(items).slice(0, 30000)}
Open issues on the tracker (dedupe against these):
${list(OPEN_ISSUES.map((i) => `#${i.number} ${i.title}${(i.labels || []).length ? ` [${i.labels.join(', ')}]` : ''}`))}
Rules [OR-27]:
1. Re-read each item against the code at HEAD (git diff ${BASE}...HEAD shows this branch). A defect in THIS branch's code is never a side issue: put it in dropped with reason "branch defect: not repaired" so the audit sees it.
2. Drop anything ${A.worktree}/.out-of-scope/ (if it exists) or a closed wontfix decision rejects, anything no longer true, and bookkeeping. Every drop goes in dropped with its reason.
3. One draft per distinct problem. If an open issue already covers it, set duplicate_of to its number and write the body as a COMMENT adding only the new evidence.
4. severity: privacy, security, data-loss, broken-flow (a user cannot finish a task) or wrong-state (wrong persisted data) for serious problems; everything else is minor. kind: ${KINDS.join(' | ')}.
5. evidence: file:line at HEAD or a screenshot path from this run, at least one. Claim only what the evidence shows.
6. The body starts "Found while resolving #${ISSUE.id}." and holds no names, record numbers, birth dates or customer data [PS-1, PS-2]. Never attach or reference a screenshot of real user data.
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
A gate that cannot load or start (module not found, missing codegen, install error) is an environment problem, never a red result: run install${P.commands && P.commands.post_install ? ` and ${joinCmd(P.commands.post_install)}` : ''}, then rerun [IS-16].
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

const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

async function runTask(t, prefix) {
  const b = await call(buildPrompt(t, prefix), opts('build', { label: `build ${t.id}`, phase: 'Build', schema: BUILD }))
  if (!b) return { id: t.id, title: t.title, status: 'failed', reason: 'agent died (build)', attempts: [] } // [OR-9]
  const shas = []
  let bad = [] // commit ids in the latest builder/repair report that are not SHAs [BD-22]
  const take = (r) => {
    const cs = (r.commits || []).map(String)
    bad = cs.filter((s) => !SHA.test(s))
    shas.push(...cs.filter((s) => SHA.test(s)))
  }
  take(b)
  const deviations = (b.deviations || []).slice()
  const attempts = []
  let v = null
  for (let round = 0; round <= REPAIR_ROUNDS; round++) {
    if (bad.length) {
      // a report without real SHAs is a builder failure: straight to repair, no verifier [BD-22]
      v = {
        passed: false, code_defect: false, summary: 'builder report rejected: commit ids are not SHAs',
        checks: [{ check: 'builder reported real commit SHAs', ok: false, detail: bad.join(' | ') }],
        unfinished_work: `Your report listed commit ids that are not SHAs: ${bad.map((s) => JSON.stringify(s)).join(', ')}. Commit the task if it is not committed, then report the full SHA of every commit from \`git log\`.`,
      }
      attempts.push({ round, passed: false, code_defect: false, bad_commits: bad, summary: v.summary, non_blocking: [] })
    } else {
      v = await call(verifyPrompt(t, shas, deviations), opts('verify', { label: `verify ${t.id} #${round + 1}`, phase: 'Verify', schema: VERDICT }))
      if (!v) v = await call(verifyPrompt(t, shas, deviations), opts('verify', { label: `re-verify ${t.id} #${round + 1}`, phase: 'Verify', schema: VERDICT })) // a null verdict is never a pass
      if (!v) {
        attempts.push({ round, verdict: null })
        return { id: t.id, title: t.title, status: 'failed', reason: 'verifier died twice', commits: shas, attempts, build: b }
      }
      if (v.privacy_security_change) {
        // a privacy or security behaviour change no human decided: never repaired or ranked away [SP-18]
        attempts.push({ round, passed: false, code_defect: false, summary: v.summary, non_blocking: v.non_blocking_findings || [] })
        return {
          id: t.id, title: t.title, status: 'decision_required', reason: 'privacy or security behaviour change with no human decision',
          decision_required: `${t.id}: ${v.privacy_security_change} This changes privacy or security behaviour; decide whether it is intended, then relaunch with the answer in decisions [SP-18].`,
          commits: shas, attempts, build: b, repairs: round,
        }
      }
      const nb = (v.non_blocking_findings || []).slice()
      let own = []
      const why = []
      if (v.passed) {
        // a pass that carries a defect in the task's own files is a rejection [VF-11]
        own = nb.filter((f) => f && typeof f === 'object' && f.severity === 'defect' && touchesTask(f, t))
        why.push(...own.map((f) => `- ${f.finding}`))
        // a pass needs a red negative control for every acceptance row [VF-3]
        const nc = v.negative_controls || []
        if (!nc.length) why.push('- No negative control recorded. Run one for EACH acceptance row.')
        for (const c of nc) {
          if (c && c.result === 'green') why.push(`- Acceptance row "${c.row}" stays GREEN with its guard removed: add a test that fails without it.`)
          if (c && c.result === 'infra_error') nb.push({ severity: 'test-gap', finding: `negative control for "${c.row}" not run: infrastructure error (${c.detail || 'no detail'})` }) // never read as RED [IS-16]
        }
      }
      if (why.length) {
        v = Object.assign({}, v, {
          passed: false,
          code_defect: v.code_defect || own.length > 0,
          unfinished_work: [v.unfinished_work, 'The verifier passed this task, but:', ...why].filter(Boolean).join('\n'),
          checks: (v.checks || []).concat([{ check: 'no defect in the task\'s files; every acceptance row has a red negative control', ok: false, detail: why.join(' | ') }]),
        })
      }
      const sig = v.passed || !v.failing_test ? null : `${norm(v.failing_test)}|${norm(v.failure_cause)}`
      attempts.push({ round, passed: v.passed, code_defect: v.code_defect, summary: v.summary, promoted_defects: own.length, sig, behaviour_choice: !!v.behaviour_choice, non_blocking: nb.filter((f) => !own.includes(f)) })
      if (v.passed) return { id: t.id, title: t.title, status: 'verified', commits: shas, attempts, build: b, repairs: round }
      // same test, same cause after 2 repairs, and the cause is a behaviour choice: a human decides, no third repair [VF-5]
      const prev = attempts[attempts.length - 2]
      if (round >= SAME_CAUSE_ROUNDS && sig && v.behaviour_choice && prev && prev.sig === sig) {
        return {
          id: t.id, title: t.title, status: 'decision_required', reason: `same failure after ${round} repairs, and it is a behaviour choice`,
          decision_required: `${t.id}: ${v.failing_test} fails because ${v.failure_cause}. Decide the intended behaviour, then relaunch this task.`,
          unfinished_work: v.unfinished_work, commits: shas, attempts, build: b, repairs: round,
        }
      }
    }
    if (round === REPAIR_ROUNDS) break
    const r = await call(repairPrompt(t, v), opts('repair', { label: `repair ${t.id} #${round + 1}`, phase: 'Verify', schema: BUILD }))
    if (r) take(r)
    if (r && r.deviations) deviations.push(...r.deviations)
  }
  return { id: t.id, title: t.title, status: 'failed', reason: 'rejected after repairs', unfinished_work: v.unfinished_work, commits: shas, attempts, build: b, repairs: REPAIR_ROUNDS }
}

// ---------- wave scheduling [OR-8, PL-4, OR-11, PL-15] ----------

// ready = all deps done; a dependency id that is not in the plan counts as satisfied; nothing ready (a cycle) → the first alone
function readyOf(remaining, done, ids) {
  const ready = remaining.filter((t) => (t.depends_on || []).every((d) => done.has(d) || !ids.has(d)))
  return ready.length ? ready : [remaining[0]]
}
// file overlap only schedules: tasks sharing a file never run in the same wave, capped by maxParallel [SZ-2]
function pickWave(ready, cap) {
  const wave = []
  const used = new Set()
  for (const t of ready) {
    if (wave.length >= cap) break
    if ((t.files || []).some((f) => used.has(f))) continue
    ;(t.files || []).forEach((f) => used.add(f))
    wave.push(t)
  }
  return wave
}
// waves the scheduler would run with unlimited builders; serial = medium, more than 2 tasks, one wave each
function planShape(tasks) {
  const ids = new Set(tasks.map((t) => t.id))
  const done = new Set()
  let rem = tasks.slice()
  let waves = 0
  while (rem.length) {
    const w = pickWave(readyOf(rem, done, ids), Infinity)
    w.forEach((t) => done.add(t.id))
    rem = rem.filter((t) => !w.includes(t))
    waves++
  }
  return { tasks: tasks.length, waves, serial: SIZE === 'medium' && tasks.length > 2 && waves === tasks.length }
}

// ---------- symptom check verdict, computed here rather than by the model [PL-1] ----------

function fitVerdict(options) {
  const ps = (options || []).filter((o) => o && typeof o.p === 'number').sort((a, b) => b.p - a.p)
  if (ps.length < 2 || !ps.some((o) => o.kind === 'reported')) return 'close' // malformed: unsure, so back to diagnosis
  if (Math.round((ps[0].p - ps[1].p) * 1000) <= CLOSE_P * 1000) return 'close'
  return ps[0].kind === 'reported' ? 'reported' : 'neighbour'
}

// ---------- findings and the compact return [VF-31, OR-26] ----------

// stages that ran and passed; a finding true only until one of them ran is stale [VF-32]
function passedStages(r) {
  const ts = (r.tasks || []).filter(Boolean)
  return {
    verify: ts.length > 0 && ts.every((t) => t.status === 'verified'),
    view: !!(r.view && !(r.view_branch_defects || []).length),
    gates: !!(r.gates && r.gates.all_green),
    docs: !!(r.docs && (r.docs.decided_at === 'spec' || (r.docs_verdict && r.docs_verdict.passed))),
  }
}

// One list from every stage: dedupe on normalised text, keep the most severe tag, record which stages said it,
// and drop stale findings whose condition a later, passing stage settled [VF-31, VF-32].
function mergeFindings(r) {
  const merged = new Map()
  const passed = passedStages(r)
  let superseded = 0
  const add = (f, source) => {
    const item = typeof f === 'string' ? { finding: f } : f || {}
    if (!item.finding) return
    if (item.until_stage && passed[item.until_stage]) return void superseded++
    const sev = SEVERITIES.includes(item.severity) ? item.severity : 'defect' // untagged counts as a defect, so it gets re-read
    const ev = [item.file].concat(item.screenshots || []).filter(Boolean)
    const key = norm(item.finding)
    const prev = merged.get(key)
    if (!prev) return merged.set(key, Object.assign({ severity: sev, finding: item.finding, sources: [source] }, ev.length ? { evidence: ev } : {}, item.cause === 'branch' ? { branch: true } : {}))
    if (SEVERITIES.indexOf(sev) < SEVERITIES.indexOf(prev.severity)) prev.severity = sev
    if (!prev.sources.includes(source)) prev.sources.push(source)
    if (ev.length) prev.evidence = [...new Set((prev.evidence || []).concat(ev))]
  }
  for (const d of r.diagnoses || []) for (const f of (d && d.side_findings) || []) add(f, 'diagnose')
  for (const t of r.tasks || []) for (const a of (t && t.attempts) || []) for (const f of a.non_blocking || []) add(f, t.id)
  for (const f of (r.view && r.view.findings) || []) add(f, 'view')
  for (const f of (r.gates_verdict && r.gates_verdict.non_blocking_findings) || []) add(f, 'gates')
  for (const f of (r.docs_verdict && r.docs_verdict.non_blocking_findings) || []) add(f, 'docs')
  const findings = {}
  for (const sev of SEVERITIES) findings[sev] = []
  for (const m of merged.values()) findings[m.severity].push(m)
  return { findings, superseded }
}

// Harvest drafts, checked in code: real open-issue numbers, a title match the agent missed, severity decides
// bundle, the "found while" line, identifier scrub, no evidence = no draft. Minor drafts render as ONE issue [OR-27].
function shapeDrafts(h) {
  const open = new Set(OPEN_ISSUES.map((i) => i.number))
  const titleMatch = (t) => {
    const n = norm(t)
    const hit = OPEN_ISSUES.find((i) => { const m = norm(i.title); return m === n || (Math.min(m.length, n.length) >= 12 && (m.includes(n) || n.includes(m))) })
    return hit ? hit.number : null
  }
  const pats = (P.privacy && P.privacy.identifier_patterns) || []
  const scrub = (x) => pats.reduce((acc, p) => acc.replace(new RegExp(p, 'g'), '[redacted]'), String(x || ''))
  const found = `Found while resolving #${ISSUE.id}`
  const dropped = ((h && h.dropped) || []).slice()
  const drafts = []
  const seen = new Set()
  for (const d of (h && h.side_issues) || []) {
    if (!d || !d.title) continue
    if (!(d.evidence || []).length) { dropped.push({ finding: d.title, reason: 'no evidence' }); continue }
    if (seen.has(norm(d.title))) continue
    seen.add(norm(d.title))
    const severity = SERIOUS.includes(d.severity) ? d.severity : 'minor'
    let body = scrub(d.body)
    if (!body.includes(found)) body = `${found}.\n\n${body}`
    drafts.push({
      title: scrub(d.title), body, kind: KINDS.includes(d.kind) ? d.kind : 'bug', severity, evidence: d.evidence,
      duplicate_of: open.has(d.duplicate_of) ? d.duplicate_of : titleMatch(d.title),
      bundle: severity === 'minor',
    })
  }
  const minor = drafts.filter((d) => d.bundle && !d.duplicate_of)
  const bundle_issue = minor.length
    ? { title: `Minor issues found while resolving #${ISSUE.id} (${minor.length})`, body: [`${found}.`, ''].concat(minor.map((d) => `- [${d.kind}] ${d.title} (${d.evidence.join(', ')})`)).join('\n') }
    : null
  return { side_issues: drafts, bundle_issue, dropped }
}

function metrics(r) {
  const ts = (r.tasks || []).filter(Boolean)
  const attempts = [].concat(...ts.map((t) => t.attempts || []))
  return {
    tasks: ts.length,
    verified: ts.filter((t) => t.status === 'verified').length,
    tasks_with_code_defect: ts.filter((t) => (t.attempts || []).some((a) => a.code_defect)).length, // [CO-2]
    repairs: ts.reduce((n, t) => n + (t.repairs || 0), 0),
    verifier_rejections: attempts.filter((a) => a.passed === false && !a.bad_commits).length + (r.gates_verdict && r.gates_verdict.passed === false ? 1 : 0),
    promoted_defects: attempts.reduce((n, a) => n + (a.promoted_defects || 0), 0),
    bad_commit_reports: attempts.filter((a) => a.bad_commits).length, // [BD-22]
    gates_commits: (r.gates && r.gates.commits && r.gates.commits.length) || 0,
    view_repairs: r.view_repair ? 1 : 0,
    superseded_findings: mergeFindings(r).superseded, // [VF-32]
    agents: STAGES.reduce((n, s) => n + s.agents, 0),
    stages: STAGES,
  }
}

function compact(r) {
  const { findings } = mergeFindings(r)
  const g = r.gates
  const viewCommits = ((r.view_repair && r.view_repair.commits) || []).filter((x) => SHA.test(String(x)))
  const commits = [...new Set([].concat(...(r.tasks || []).map((t) => (t && t.commits) || []), viewCommits, (g && g.commits) || [], (r.docs && r.docs.commits) || []))]
  const cands = [].concat(...(r.diagnoses || []).map((d) => d.candidates || [])).sort((a, b) => (b.rank_p || 0) - (a.rank_p || 0))
  return {
    issue: r.issue, size: r.size, status: r.status, stage: r.stage || null, reason: r.reason || null,
    decision_required: r.decision_required || null,
    root_cause: r.spec ? r.spec.root_cause : (r.diagnoses || []).map((d) => d.findings).join(' | ') || null,
    confirmed_by: [].concat(...(r.diagnoses || []).map((d) => d.evidence || [])).slice(0, 2).join('; ') || null,
    ranking: cands.slice(0, 3).map((x) => ({ cause: x.cause, p: typeof x.rank_p === 'number' ? x.rank_p : null, verdict: x.verdict })),
    shared_seam: (r.spec && r.spec.shared_seam) || null,
    user_change: (r.spec && r.spec.user_change) || null,
    plan_waves: r.plan_waves || null, // tasks, waves, replanned, serial_reason [PL-15]
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
    view: r.spec && r.spec.user_visible ? {
      ran: !!r.view, screenshots_dir: SHOT_DIR, screenshots: r.view ? (r.view.screenshots || []).length : 0,
      repaired: !!r.view_repair, branch_defects_open: (r.view_branch_defects || []).length, processes_left: r.view ? r.view.processes_left : null,
    } : null,
    commits,
    findings, // defects and test gaps first; the post-run audit re-triages this list [VF-11]
    side_issues: r.harvest ? r.harvest.side_issues : [], // drafts; the main loop re-checks and files them [OR-27]
    bundle_issue: r.harvest ? r.harvest.bundle_issue : null,
    side_issue_label: (P.labels && P.labels['needs-triage']) || 'needs-triage',
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
    ...(c.view ? [`View: ${c.view.ran ? `${c.view.screenshots} screenshot sets in ${c.view.screenshots_dir}; branch defects open ${c.view.branch_defects_open}${c.view.repaired ? ' (after 1 repair)' : ''}` : 'did not run'}`] : []),
    `Side issues to file: ${c.side_issues.filter((d) => !d.bundle && !d.duplicate_of).length} separate, ${c.bundle_issue ? `1 bundle of ${c.side_issues.filter((d) => d.bundle && !d.duplicate_of).length}` : 'no bundle'}, ${c.side_issues.filter((d) => d.duplicate_of).length} comments on open issues`,
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
    c.side_issues.forEach((d) => { d.body = clip(d.body, n * 2) })
    if (c.bundle_issue) c.bundle_issue.body = clip(c.bundle_issue.body, n * 4)
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
  // A diagnosis menu stops the run until the human answers. Diagnosis never sees DECISIONS (and is served from cache on resume),
  // so once answers exist the menu goes on to the spec, which sees both and re-raises decision_required if they don't settle it [SP-11, SP-19].
  if (decision && !DECISIONS.length) return finish(Object.assign(result, { status: 'decision_required', stage: 'diagnose', decision_required: decision.decision_required })) // [SP-11]
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
  // a shared component's changed default: any caller whose new flow is not known to be intended is the human's call [SP-17]
  const unsure = (result.spec.caller_flows || []).filter((x) => x && x.intended === 'unsure')
  if (unsure.length) {
    return finish(Object.assign(result, {
      status: 'decision_required', stage: 'spec',
      decision_required: 'A shared component changes, and these callers\' new flow is not known to be intended:\n' + unsure.map((x) => `- ${x.caller}: before "${x.before}"; after "${x.after}". Intended?`).join('\n'),
    }))
  }
  // privacy or security behaviour: the human decides, never the spec agent or a ranker [SP-18]
  const psRows = result.spec.privacy_security_rows || []
  const decided = decidedRows()
  if (result.spec.privacy_security_change && (!psRows.length || decided.length < psRows.length)) {
    const open = psRows.filter((x) => !decided.some((d) => d.surface === (x && x.surface)))
    return finish(Object.assign(result, {
      status: 'decision_required', stage: 'spec',
      decision_required: 'This change alters privacy or security behaviour (screen or DOM while locked, data lifetime, telemetry or third-party egress, or access; each row names its surface). Decide each row, then relaunch with ONLY the answers added to decisions [OR-28]:\n'
        + (open.length ? open.map((x) => `- ${x.surface}: before "${x.before}"; after "${x.after}". Intended?`).join('\n') : '- (the spec named no surface: which screens or data change?)'),
    }))
  }
  if (!result.spec.mechanism_explains_reported_data) log('Spec: no diagnosed mechanism fully explains the reported data. Proceeding with a fix that is correct regardless, plus evidence capture [SP-3].')

  stage('Plan')
  if (!SMALL) result.plan = await call(planPrompt(result.spec), opts('plan', { label: 'plan', schema: PLAN }))
  if (!result.plan || !(result.plan.tasks || []).length) return finish(Object.assign(result, { status: 'failed', stage: 'plan', reason: result.plan ? 'plan returned no tasks' : 'agent died' }))
  // the plan reports its wave count; a fully serial medium plan gets one re-plan [PL-15]
  if (!SMALL) {
    let shape = planShape(result.plan.tasks)
    if (shape.serial && !result.plan.serial_reason) {
      const re = await call(replanPrompt(result.spec, result.plan, shape), opts('plan', { label: 'replan', schema: PLAN }))
      if (re && (re.tasks || []).length) result.plan = re
      shape = Object.assign(planShape(result.plan.tasks), { replanned: true })
    }
    result.plan_waves = Object.assign(shape, { serial_reason: result.plan.serial_reason || null })
    log(`Plan: ${shape.tasks} tasks in ${shape.waves} waves${shape.replanned ? ' after one re-plan' : ''}${result.plan.serial_reason ? `; serial because ${result.plan.serial_reason}` : ''}.`)
  }
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
  const wave = pickWave(readyOf(remaining, new Set(Object.keys(byId)), ids), MAX_PAR) // [OR-8, PL-4, OR-11, SZ-2]
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

// VIEW lens: only for user-visible changes. A defect this branch caused gets ONE repair, then a human decides [VF-23]
const branchDefects = (v) => ((v && v.findings) || []).filter((f) => f && f.cause === 'branch' && f.severity === 'defect')
if (result.spec.user_visible) {
  stage('View')
  result.view = await call(viewPrompt(1), opts('verify', { label: 'view #1', phase: 'View', schema: VIEW }))
  let bd = branchDefects(result.view)
  if (bd.length) {
    const hit = tasks.filter((t) => bd.some((f) => touchesTask(f, t)))
    const files = [...new Set([].concat(...(hit.length ? hit : tasks).map((t) => t.files || [])))]
    result.view_repair = await call(viewRepairPrompt(bd, files), opts('repair', { label: 'repair view #1', phase: 'View', schema: BUILD }))
    result.view = await call(viewPrompt(2, bd), opts('verify', { label: 'view #2', phase: 'View', schema: VIEW }))
    bd = branchDefects(result.view)
    if (bd.length) result.view_decision = 'Visual defects this branch caused remain after one repair:\n' + bd.map((f) => `- ${f.finding} (${(f.screenshots || []).join(', ')})`).join('\n')
  }
  result.view_branch_defects = result.view ? bd : []
}

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

// HARVEST: side findings from every stage become issue drafts; skipped when there is nothing to harvest [OR-27]
{
  const { findings } = mergeFindings(result)
  const items = [].concat(...SEVERITIES.filter((s) => s !== 'bookkeeping').map((s) => findings[s].filter((f) => !f.branch)))
    .concat(((result.spec && result.spec.out_of_scope) || []).map((f) => ({ severity: 'follow-up', finding: f, sources: ['spec'] })))
    .concat(((result.gates && result.gates.remaining_failures) || []).map((f) => ({ severity: 'defect', finding: f, sources: ['gates'] })))
  if (items.length) {
    stage('Harvest')
    const h = await call(harvestPrompt(items), opts('harvest', { label: 'harvest', schema: HARVEST }))
    if (!h) log('Harvest agent died: the main loop drafts side issues from the findings list.')
    result.harvest = shapeDrafts(h)
  }
}

const allVerified = result.tasks.every((t) => t && t.status === 'verified')
const viewOk = !result.spec.user_visible || (result.view && !result.view_branch_defects.length)
result.status = allVerified && viewOk && result.gates && result.gates.all_green && result.gates_commits_verified !== false ? 'verified' : 'partial'
const decisions = result.tasks.filter((t) => t && t.status === 'decision_required').map((t) => t.decision_required) // [VF-5]
if (result.view_decision) decisions.push(result.view_decision)
if (decisions.length) Object.assign(result, { status: 'decision_required', decision_required: decisions.join('\n') })
return finish(result) // compact and capped, summary rendered from the data [OR-26]
