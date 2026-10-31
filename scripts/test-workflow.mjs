// Dry-run templates/workflow.js against mocked agents: exercises the wave scheduler, the repair loop,
// dead-agent handling, the symptom check, the merged findings list, the compact return cap, the small
// path, the verification holes (builder report, defect-on-pass, gates commits), stopAfter/resumeFrom,
// the rendered summary, per-stage metrics, and the second-dogfood rules: wave count and one re-plan,
// SHA-only commit ids, per-acceptance-row negative controls, caller-flow decisions, the behaviour-choice
// stop in repair, post_install. Run: node scripts/test-workflow.mjs
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const src = readFileSync(new URL('../templates/workflow.js', import.meta.url), 'utf8').replace('export const meta', 'const meta')
const AsyncFn = Object.getPrototypeOf(async () => {}).constructor
const wf = new AsyncFn('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', src)
const H = (s) => Buffer.from(s).toString('hex') // a mock commit id that is a valid SHA
const IS_SHA = /^[0-9a-f]{7,40}$/

const TASKS = [
  { id: 'T1', title: 'root fix', files: ['a.ts'], depends_on: [], instructions: 'x', acceptance: 'y' },
  { id: 'T2', title: 'guard', files: ['b.ts'], depends_on: ['T1'], instructions: 'x', acceptance: 'y' },
  { id: 'T3', title: 'diag', files: ['b.ts'], depends_on: ['T1', 'T9'], instructions: 'x', acceptance: 'y' }, // shares b.ts; T9 dangling
  { id: 'T4', title: 'cycle', files: ['c.ts'], depends_on: ['T5'], instructions: 'x', acceptance: 'y' },
  { id: 'T5', title: 'cycle', files: ['d.ts'], depends_on: ['T4'], instructions: 'x', acceptance: 'y' },
]
const FITS = {
  reported: [{ option: 'r', kind: 'reported', p: 0.8 }, { option: 'n1', kind: 'neighbour', p: 0.1 }, { option: 'n2', kind: 'neighbour', p: 0.1 }],
  neighbour: [{ option: 'r', kind: 'reported', p: 0.1 }, { option: 'n1', kind: 'neighbour', p: 0.8 }, { option: 'n2', kind: 'neighbour', p: 0.1 }],
  close: [{ option: 'r', kind: 'reported', p: 0.55 }, { option: 'n1', kind: 'neighbour', p: 0.35 }, { option: 'n2', kind: 'neighbour', p: 0.1 }], // 0.2 apart: close
}

async function run({
  fit = 'reported', rejectOnce = [], dieBuild = [], alwaysReject = [], findings = () => [], userChange = 'Search shows results again.',
  size = 'medium', tasks = TASKS, measured = false, docsImpact = 'none', gatesCommits = [], gatesPass = true, extra = {},
  serialReason = 'T4 and T5 form a cycle', replanTasks = null, buildCommits = null, verdictExtra = () => ({}), callerFlows = [],
} = {}) {
  const calls = []
  const seen = {}
  const waves = []
  let spent = 0
  const specFields = { root_cause: 'r', shared_seam: 'h', mechanism_explains_reported_data: true, user_change: userChange, out_of_scope: [], docs_impact: docsImpact, docs_justification: 'internal', caller_flows: callerFlows }
  const agent = async (prompt, o = {}) => {
    const label = o.label || ''
    calls.push({ label, model: o.model, prompt })
    spent += 1000
    if (label.startsWith('diagnose')) return { method: 'm', findings: 'f', evidence: measured ? ['probe: 0 of 3 rows rendered'] : [], candidates: [{ cause: 'stale cache', rank_p: 0.7, verdict: 'confirmed', evidence: 'e' }], ruled_out: [], open_questions: [], confidence: 'high', decision_required: null }
    if (label === 'spec') return Object.assign({ spec_path: 's.md' }, specFields)
    if (label === 'plan') return { plan_path: 'p.md', tasks, serial_reason: serialReason }
    if (label === 'replan') return replanTasks ? { plan_path: 'p.md', tasks: replanTasks, serial_reason: null } : { plan_path: 'p.md', tasks, serial_reason: 'each task needs the previous one\'s code' }
    if (label === 'spec plan' || label === 'load plan') return Object.assign({ spec_path: null, plan_path: 'p.md', tasks }, specFields)
    if (label === 'symptom check') return { options: FITS[fit], verdict: 'reported', reason: 'r' } // the model's own verdict is ignored
    if (label === 'verify gates') return { passed: gatesPass, checks: [], unfinished_work: '', code_defect: !gatesPass, summary: '', non_blocking_findings: [] }
    const id = label.split(' ')[1]
    if (label.startsWith('build')) return dieBuild.includes(id) ? null : { commits: (buildCommits && buildCommits(id)) || [H('sha-' + id)], files_changed: [], commands_run: [{ command: 'bun test', output_tail: 'BUILDER-CLAIM all green' }], deviations: ['dev-' + id], notes: 'BUILDER-NOTES trust me' }
    if (label.startsWith('repair')) return { commits: [H('fix-' + id + label.split('#')[1])], files_changed: [], commands_run: [], deviations: [] }
    if (label.startsWith('verify') && label !== 'verify docs') {
      seen[id] = (seen[id] || 0) + 1
      const pass = !alwaysReject.includes(id) && !(rejectOnce.includes(id) && seen[id] === 1)
      return Object.assign({ passed: pass, checks: [], unfinished_work: pass ? '' : 'fix ' + id, code_defect: !pass, summary: '', non_blocking_findings: findings(id, seen[id]), negative_controls: [{ row: 'y', result: 'red' }] }, verdictExtra(id, seen[id]))
    }
    if (label === 'completeness') return { missing: [], detail: '' }
    if (label === 'gates') return { head_before: 'pre-gates', all_green: true, gates: [{ command: 'unit', passed: true, skipped: false, output_tail: '' }], failures_fixed: gatesCommits.length ? ['lint in a.ts'] : [], remaining_failures: [], commits: gatesCommits }
    if (label === 'docs') return { docs_impact: 'updated', justification: 'user docs', files: ['docs/x.md'] }
    if (label === 'verify docs') return { passed: true, checks: [], unfinished_work: '', code_defect: false, summary: '', non_blocking_findings: [] }
    throw new Error('unexpected label ' + label)
  }
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)))
  const log = (m) => { if (m.startsWith('Wave:')) waves.push(m) }
  const budget = { total: null, spent: () => spent, remaining: () => Infinity }
  const args = Object.assign({ issue: { id: '1', title: 't' }, size, tiers: { build: { model: 'mid' }, repair: { model: 'top' } }, maxParallel: 4 }, extra)
  const res = await wf(args, agent, parallel, null, () => {}, log, budget)
  return { res, calls, waves }
}

// happy path: disjoint waves, dangling dep satisfied, cycle broken
{
  const { res, waves } = await run()
  assert.equal(res.status, 'verified')
  assert.deepEqual(res.tasks.map((t) => t.status), ['verified', 'verified', 'verified', 'verified', 'verified'])
  assert.match(waves[0], /^Wave: T1 /)
  assert.ok(!waves.some((w) => /T2, T3|T3, T2/.test(w)), 'T2 and T3 share b.ts and must not share a wave')
}
// repair path runs one tier up and re-verifies
{
  const { res, calls } = await run({ rejectOnce: ['T1'] })
  const t1 = res.tasks.find((t) => t.id === 'T1')
  assert.equal(t1.status, 'verified')
  assert.equal(t1.repairs, 1)
  assert.deepEqual(t1.commits, [H('sha-T1'), H('fix-T11')])
  assert.equal(calls.find((c) => c.label.startsWith('repair T1')).model, 'top')
  assert.equal(res.metrics.tasks_with_code_defect, 1)
}
// a task rejected 4 times fails; its dependants are blocked, never built
{
  const { res, calls } = await run({ alwaysReject: ['T1'] })
  assert.equal(res.tasks.find((t) => t.id === 'T1').status, 'failed')
  assert.equal(res.tasks.find((t) => t.id === 'T2').status, 'blocked')
  assert.equal(calls.filter((c) => c.label.startsWith('repair T1')).length, 3)
  assert.ok(!calls.some((c) => c.label === 'build T2'))
  assert.equal(res.status, 'partial')
}
// a dead builder is a failure, not a success
{
  const { res } = await run({ dieBuild: ['T4'] })
  assert.equal(res.tasks.find((t) => t.id === 'T4').reason, 'agent died (build)')
  assert.equal(res.status, 'partial')
}
// symptom check that picks a neighbour stops before build
{
  const { res, calls } = await run({ fit: 'neighbour' })
  assert.equal(res.status, 'plan_mismatch')
  assert.ok(!calls.some((c) => c.label.startsWith('build')))
}
// findings from every verifier are merged into one deduped list, tagged by severity, defects first [VF-31]
{
  const f = (id) => [
    { severity: 'bookkeeping', finding: 'Plan checkbox ticked but not committed.' },
    { severity: 'follow-up', finding: 'Rename the helper module' },
    ...(id === 'T2' ? [{ severity: 'doc-copy', finding: 'Settings page stuck on Loading when the list is empty' }] : []),
    ...(id === 'T3' ? [{ severity: 'defect', finding: 'settings page stuck on loading when the list is empty.' }, 'raw 500 on bad input'] : []),
    ...(id === 'T4' ? [{ severity: 'test-gap', finding: 'no test for the empty list' }] : []),
  ]
  const { res } = await run({ rejectOnce: ['T1'], findings: f })
  const F = res.findings
  assert.deepEqual(Object.keys(F), ['defect', 'test-gap', 'doc-copy', 'follow-up', 'bookkeeping'])
  assert.equal(F.bookkeeping.length, 1, 'the same note from 6 verdicts is one finding')
  assert.equal(F.bookkeeping[0].sources.length, 5)
  const stuck = F.defect.find((x) => /stuck on loading/i.test(x.finding))
  assert.ok(stuck, 'duplicate tagged doc-copy and defect keeps the more severe tag')
  assert.deepEqual(stuck.sources.sort(), ['T2', 'T3'])
  assert.equal(F['doc-copy'].length, 0)
  assert.ok(F.defect.some((x) => x.finding === 'raw 500 on bad input'), 'an untagged finding is triaged as a defect')
  assert.equal(F['test-gap'].length, 1)
  assert.ok(res.follow_ups.includes('Rename the helper module'))
}
// the return is compact: capped, defects survive, large outputs referenced by path, not inlined [OR-26]
{
  const big = 'x'.repeat(5000)
  const f = (id, n) => Array.from({ length: 30 }, (_, i) => ({ severity: ['defect', 'bookkeeping', 'follow-up'][i % 3], finding: `${id} round ${n} item ${i} ${big}` }))
  const { res } = await run({ findings: f, userChange: 'S'.repeat(300000) })
  const size = JSON.stringify(res).length
  assert.ok(size <= 20000, `return is ${size} chars`)
  assert.equal(res.return_chars, size)
  assert.ok(res.clipped)
  assert.ok(res.findings.defect.length > 0, 'defects are kept when the rest is dropped')
  assert.equal(res.findings.bookkeeping.length, 0)
  assert.ok(res.findings_omitted.bookkeeping > 0)
  assert.ok(res.paths.journal && res.paths.spec && res.paths.plan)
  assert.ok(!('diagnoses' in res) && !('build' in res.tasks[0]), 'stage outputs stay in the journal')
  assert.ok(Array.isArray(res.commits) && res.commits.includes(H('sha-T1')))
  // the happy path is small without any clipping
  const { res: small } = await run()
  assert.ok(!small.clipped && JSON.stringify(small).length < 5000)
}
// the verifier never sees the builder's report: only shas, task, acceptance and declared deviations [VF-1]
{
  const { calls } = await run()
  const v = calls.find((c) => c.label === 'verify T1 #1').prompt
  assert.ok(!/BUILDER-CLAIM|BUILDER-NOTES|commands_run/.test(v), 'builder report leaked into the verifier prompt')
  assert.ok(v.includes(H('sha-T1')) && v.includes('dev-T1'), 'shas and declared deviations are passed')
}
// a pass that carries a defect in the task's own files is a rejection; a defect elsewhere is not
{
  const f = (id, n) => (id === 'T1' && n === 1 ? [{ severity: 'defect', finding: 'a.ts:3 throws on an empty list', file: 'a.ts' }]
    : id === 'T2' ? [{ severity: 'defect', finding: 'data.ts:9 off by one' }] : [])
  const { res, calls } = await run({ findings: f })
  const t1 = res.tasks.find((t) => t.id === 'T1')
  assert.equal(t1.status, 'verified')
  assert.equal(t1.repairs, 1, 'the defect-on-pass went to repair')
  assert.match(calls.find((c) => c.label === 'repair T1 #1').prompt, /a\.ts:3 throws on an empty list/)
  assert.ok(!res.findings.defect.some((x) => /a\.ts:3/.test(x.finding)), 'a promoted defect is repaired, not left in the list')
  assert.equal(res.tasks.find((t) => t.id === 'T2').repairs, 0, 'data.ts is not b.ts')
  assert.ok(res.findings.defect.some((x) => /data\.ts:9/.test(x.finding)))
  assert.equal(res.metrics.promoted_defects, 1)
  assert.equal(res.metrics.verifier_rejections, 1)
}
// gates commits get a fresh verifier over head_before..HEAD; no commits, no verifier
{
  const none = await run()
  assert.ok(!none.calls.some((c) => c.label === 'verify gates'))
  assert.equal(none.res.gates_commits_verified, null)
  const ok = await run({ gatesCommits: ['g1'] })
  const gv = ok.calls.find((c) => c.label === 'verify gates')
  assert.ok(gv && /pre-gates\.\.HEAD/.test(gv.prompt) && gv.prompt.includes('g1'))
  assert.equal(ok.res.gates_commits_verified, true)
  assert.equal(ok.res.status, 'verified')
  assert.equal(ok.res.metrics.gates_commits, 1)
  const bad = await run({ gatesCommits: ['g1'], gatesPass: false })
  assert.equal(bad.res.gates_commits_verified, false)
  assert.equal(bad.res.status, 'partial')
  // the gates agent runs a fixed list and may fix only this branch's failures
  const g = (await run({ extra: { profile: { commands: { install: 'i', typecheck: 'tc', unit: 'ut', docs_checks: ['dc'] } } } })).calls.find((c) => c.label === 'gates').prompt
  assert.match(g, /EXACTLY these commands/)
  assert.ok(g.includes('typecheck: tc') && g.includes('unit: ut') && g.includes('docs: dc') && !g.includes('install: i\n  -'))
  assert.match(g, /ONLY a failure you can tie to a file this branch changed/)
}
// small: one combined spec+plan agent, one task, no completeness, no summary agent; 6 calls or fewer
{
  const one = [TASKS[0]]
  const { res, calls } = await run({ size: 'small', tasks: one })
  assert.ok(calls.length <= 6, `small made ${calls.length} agent calls: ${calls.map((c) => c.label).join(', ')}`)
  assert.ok(calls.some((c) => c.label === 'spec plan') && !calls.some((c) => c.label === 'spec' || c.label === 'plan'))
  assert.ok(!calls.some((c) => c.label === 'completeness' || c.label === 'summary' || c.label === 'docs'))
  assert.match(calls.find((c) => c.label === 'spec plan').prompt, /Write NO spec file/)
  assert.equal(res.status, 'verified')
  // a measured repro skips the symptom check (any size)
  const m = await run({ size: 'small', tasks: one, measured: true })
  assert.ok(!m.calls.some((c) => c.label === 'symptom check') && m.calls.length <= 5)
  assert.ok((await run({ measured: true })).calls.every((c) => c.label !== 'symptom check'))
}
// docs run only when the spec says they are affected (all sizes)
{
  const none = await run()
  assert.ok(!none.calls.some((c) => c.label === 'docs'))
  assert.equal(none.res.docs.decided_at, 'spec')
  const upd = await run({ docsImpact: 'docs/user/search.md' })
  assert.ok(upd.calls.some((c) => c.label === 'docs') && upd.calls.some((c) => c.label === 'verify docs'))
}
// the symptom-check verdict is computed from the probabilities, not taken from the model
{
  const { res, calls } = await run({ fit: 'close' })
  assert.equal(res.status, 'plan_mismatch')
  assert.equal(res.symptom_check.verdict, 'close')
  assert.ok(!calls.some((c) => c.label.startsWith('build')))
}
// stopAfter and resumeFrom
{
  const d = await run({ extra: { stopAfter: 'diagnose' } })
  assert.equal(d.res.status, 'stopped')
  assert.equal(d.res.stage, 'diagnose')
  assert.ok(d.calls.every((c) => c.label.startsWith('diagnose')))
  const p = await run({ extra: { stopAfter: 'plan' } })
  assert.equal(p.res.stage, 'plan')
  assert.ok(p.calls.some((c) => c.label === 'symptom check') && !p.calls.some((c) => c.label.startsWith('build')))
  assert.match(p.res.summary, /resumeFrom: 'build'/)
  const r = await run({ extra: { resumeFrom: 'build' } })
  assert.equal(r.calls[0].label, 'load plan')
  assert.ok(!r.calls.some((c) => /^(diagnose|spec|plan$|symptom)/.test(c.label)))
  assert.equal(r.res.status, 'verified')
}
// the summary is rendered from the data; per-stage metrics come from budget.spent() deltas
{
  const { res, calls } = await run({ rejectOnce: ['T2'] })
  assert.ok(!calls.some((c) => c.label === 'summary'), 'no summary agent')
  assert.match(res.summary, /^1 t: verified/)
  assert.match(res.summary, /What changes for the user: Search shows results again\./)
  assert.match(res.summary, /Ranking: stale cache p=0\.7 \(confirmed\)/)
  assert.match(res.summary, /Next: your yes to merge; then a separate yes to push\./)
  const st = res.metrics.stages
  assert.deepEqual(st.map((x) => x.stage), ['Diagnose', 'Spec', 'Plan', 'Build', 'Gates', 'Docs'])
  assert.equal(st.reduce((n, x) => n + x.agents, 0), calls.length)
  assert.equal(st.reduce((n, x) => n + x.spent, 0), calls.length * 1000)
  assert.equal(res.metrics.verifier_rejections, 1)
}
// the plan reports its waves; a fully serial medium plan gets ONE re-plan for parallelism [PL-15]
{
  const chain = ['T1', 'T2', 'T3', 'T4'].map((id, i) => ({ id, title: 's', files: [`f${i}.ts`], depends_on: i ? [`T${i}`] : [], instructions: 'x', acceptance: 'y' }))
  const par = chain.map((t, i) => Object.assign({}, t, { depends_on: i ? ['T1'] : [] }))
  const { res, calls, waves } = await run({ tasks: chain, serialReason: null, replanTasks: par })
  const rp = calls.find((c) => c.label === 'replan')
  assert.ok(rp && /4 tasks that the scheduler would run in 4 waves/.test(rp.prompt) && /serial_reason/.test(rp.prompt))
  assert.deepEqual(res.plan_waves, { tasks: 4, waves: 2, serial: false, replanned: true, serial_reason: null })
  assert.equal(waves.length, 2, 'the re-planned tasks are the ones built')
  const kept = await run({ tasks: chain, serialReason: null }) // the re-plan keeps serial, with a reason: once only
  assert.equal(kept.calls.filter((c) => c.label === 'replan').length, 1)
  assert.match(kept.res.plan_waves.serial_reason, /previous one's code/)
  assert.ok(!(await run({ tasks: chain })).calls.some((c) => c.label === 'replan'), 'a stated reason needs no re-plan')
  assert.ok(!(await run({ tasks: par, serialReason: null })).calls.some((c) => c.label === 'replan'), 'a plan with parallel waves needs no re-plan')
  assert.ok(!(await run({ tasks: chain, serialReason: null, size: 'large' })).calls.some((c) => c.label === 'replan'), 'medium only')
}
// a builder report whose commit ids are not SHAs is a builder failure: repair, no verifier [BD-22]
{
  const { res, calls } = await run({ buildCommits: (id) => (id === 'T1' ? ['HEAD of fix/1; get SHA with git rev-parse HEAD'] : null) })
  const t1 = res.tasks.find((t) => t.id === 'T1')
  assert.ok(!calls.some((c) => c.label === 'verify T1 #1'), 'no verifier runs on a report without SHAs')
  assert.match(calls.find((c) => c.label === 'repair T1 #1').prompt, /not SHAs: "HEAD of fix\/1/)
  assert.equal(t1.status, 'verified')
  assert.equal(t1.repairs, 1)
  assert.ok(res.commits.every((c) => IS_SHA.test(c)), `non-SHA in commits: ${res.commits}`)
  assert.equal(res.metrics.bad_commit_reports, 1)
  assert.equal(res.metrics.verifier_rejections, 0)
}
// verifier rubric: wrong persisted state or a security/eligibility hole on this branch is a defect [VF-31]
{
  const v = (await run()).calls.find((c) => c.label === 'verify T1 #1').prompt
  assert.match(v, /Wrong persisted state[^\n]*security or eligibility hole[^\n]*THIS branch's code is a defect, never a follow-up/)
}
// a pass needs a red negative control for EVERY acceptance row; infra errors are never RED [VF-3, IS-16]
{
  const ve = (id, n) => (id === 'T1' && n === 1 ? { negative_controls: [{ row: 'only verified members can invite', result: 'red' }, { row: 'a removed member cannot vouch', result: 'green' }] } : {})
  const { res, calls } = await run({ verdictExtra: ve })
  assert.equal(res.tasks.find((t) => t.id === 'T1').repairs, 1, 'a green row sends the task to repair')
  assert.match(calls.find((c) => c.label === 'repair T1 #1').prompt, /"a removed member cannot vouch" stays GREEN/)
  assert.match(calls.find((c) => c.label === 'verify T1 #1').prompt, /one per ACCEPTANCE ROW/)
  const none = await run({ verdictExtra: (id, n) => (id === 'T2' && n === 1 ? { negative_controls: [] } : {}) })
  assert.equal(none.res.tasks.find((t) => t.id === 'T2').repairs, 1, 'no recorded control is no pass')
  const infra = await run({ verdictExtra: (id) => (id === 'T3' ? { negative_controls: [{ row: 'y', result: 'infra_error', detail: 'codegen missing' }] } : {}) })
  assert.equal(infra.res.tasks.find((t) => t.id === 'T3').repairs, 0, 'an infra error is not a red or a green')
  assert.ok(infra.res.findings['test-gap'].some((f) => /infrastructure error \(codegen missing\)/.test(f.finding)))
}
// a shared component's changed default: an "unsure" caller row stops at spec for the human [SP-17]
{
  const { res, calls } = await run({ callerFlows: [
    { caller: 'photo date question', before: 'answer while the tray stays usable', after: 'blocks the tray until answered', intended: 'unsure' },
    { caller: 'filter sheet', before: 'modal', after: 'modal', intended: 'yes' },
  ] })
  assert.equal(res.status, 'decision_required')
  assert.equal(res.stage, 'spec')
  assert.match(res.decision_required, /photo date question/)
  assert.ok(!/filter sheet/.test(res.decision_required))
  assert.ok(!calls.some((c) => c.label === 'plan' || c.label.startsWith('build')))
  assert.match(calls.find((c) => c.label === 'spec').prompt, /walk EVERY caller's flow/)
}
// same test, same cause after 2 repairs, and a behaviour choice: stop with decision_required, no third repair [VF-5]
{
  const ve = (id) => (id === 'T1' ? { failing_test: 'e2e: tap outside the sheet', failure_cause: 'Undecided: should a tap outside discard unsaved edits?', behaviour_choice: true } : {})
  const { res, calls } = await run({ alwaysReject: ['T1'], verdictExtra: ve })
  const t1 = res.tasks.find((t) => t.id === 'T1')
  assert.equal(t1.status, 'decision_required')
  assert.equal(calls.filter((c) => c.label.startsWith('repair T1')).length, 2)
  assert.equal(res.status, 'decision_required')
  assert.match(res.decision_required, /tap outside discard unsaved edits/)
  assert.equal(res.tasks.find((t) => t.id === 'T2').status, 'blocked')
  const code = await run({ alwaysReject: ['T1'], verdictExtra: (id) => Object.assign(ve(id), { behaviour_choice: false }) })
  assert.equal(code.calls.filter((c) => c.label.startsWith('repair T1')).length, 3, 'a code fault keeps repairing to the cap')
  assert.equal(code.res.tasks.find((t) => t.id === 'T1').status, 'failed')
}
// post_install runs in the control worktree, is never a gate, and an infra error is never RED [IS-16]
{
  const { calls } = await run({ extra: { profile: { commands: { install: 'i', post_install: 'fw sync', unit: 'ut' } } } })
  const v = calls.find((c) => c.label === 'verify T1 #1').prompt
  assert.match(v, /install there \(i;[^\n]*\), then fw sync,/)
  assert.match(v, /INFRASTRUCTURE error, never RED/)
  const g = calls.find((c) => c.label === 'gates').prompt
  assert.ok(!/-\s+post_install:/.test(g), 'post_install is not a gate')
  assert.match(g, /run install and fw sync, then rerun/)
}
// a shared dev DB and fixed log paths reach every prompt [IS-17, IS-18]
{
  const p = (await run({ extra: { profile: { env: { shared_db: true, fixed_paths: ['/tmp/e2e.log'] } } } })).calls[0].prompt
  assert.match(p, /dev database is SHARED/)
  assert.match(p, /override them: \/tmp\/e2e\.log/)
  assert.ok(!/dev database is SHARED/.test((await run()).calls[0].prompt))
}
console.log('workflow template: all dry-run checks passed')
