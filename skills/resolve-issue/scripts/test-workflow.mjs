// Dry-run templates/workflow.js against mocked agents: exercises the wave scheduler, the repair loop,
// dead-agent handling, the symptom check, the merged findings list, the compact return cap, the small
// path, the verification holes (builder report, defect-on-pass, gates commits), stopAfter/resumeFrom,
// the rendered summary, per-stage metrics, and the second-dogfood rules: wave count and one re-plan,
// SHA-only commit ids, per-acceptance-row negative controls, caller-flow decisions, the behaviour-choice
// stop in repair, post_install; and the third-dogfood rules: the VIEW lens, the side-issue harvest, privacy
// decisions at spec and verify, stale findings, logs outside the worktree; and 1.3.0: docs repair round, out-of-scope notes,
// unrelated_unstable gates, branch security defects, concept dedupe, resume fields, narrowing decisions, side-issue labels.
// Run: node scripts/test-workflow.mjs
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const src = readFileSync(process.env.WF_PATH || new URL('../templates/workflow.js', import.meta.url), 'utf8').replace('export const meta', 'const meta') // WF_PATH: a mutated copy, for negative controls
const AsyncFn = Object.getPrototypeOf(async () => {}).constructor
const wf = new AsyncFn('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', src)
const H = (s) => Buffer.from(s).toString('hex') // a mock commit id that is a valid SHA
const IS_SHA = /^[0-9a-f]{7,40}$/

const SEC = { heading: 'T: task', start_line: 10, end_line: 40 }
const PLAN_SHA = H('plan-commit')
const TASKS = [
  { id: 'T1', title: 'root fix', files: ['a.ts'], depends_on: [], section: SEC, acceptance: 'y' },
  { id: 'T2', title: 'guard', files: ['b.ts'], depends_on: ['T1'], section: SEC, acceptance: 'y' },
  { id: 'T3', title: 'diag', files: ['b.ts'], depends_on: ['T1', 'T9'], section: SEC, acceptance: 'y' }, // shares b.ts; T9 dangling
  { id: 'T4', title: 'cycle', files: ['c.ts'], depends_on: ['T5'], section: SEC, acceptance: 'y' },
  { id: 'T5', title: 'cycle', files: ['d.ts'], depends_on: ['T4'], section: SEC, acceptance: 'y' },
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
  specExtra = {}, view = () => ({ screenshots: [], findings: [], processes_left: 0 }), harvest = () => ({ side_issues: [], dropped: [] }),
  gatesGreen = true, diagExtra = {}, decide = null, specSeq = null, docsPass = () => true, gatesExtra = {}, planSha = PLAN_SHA, typeMissing = false, logs = [], thrown = [],
} = {}) {
  const calls = []
  const seen = {}
  const waves = []
  let spent = 0
  const specFields = { root_cause: 'r', shared_seam: 'h', mechanism_explains_reported_data: true, user_change: userChange, out_of_scope: [], docs_impact: docsImpact, docs_justification: 'internal', caller_flows: callerFlows, user_visible: false, privacy_security_change: false, ...specExtra }
  const agent = async (prompt, o = {}) => {
    if (typeMissing && o.agentType) thrown.push(o.label)
    if (typeMissing && o.agentType) throw new Error(typeMissing === true ? `agent type '${o.agentType}' not found` : typeMissing)
    const label = o.label || ''
    calls.push({ label, model: o.model, effort: o.effort, agentType: o.agentType, prompt })
    spent += 1000
    if (label.startsWith('diagnose')) return { method: 'm', findings: 'f', evidence: measured ? ['probe: 0 of 3 rows rendered'] : [], candidates: [{ cause: 'stale cache', rank_p: 0.7, verdict: 'confirmed', evidence: 'e' }], ruled_out: [], open_questions: [], confidence: 'high', decision_required: null, ...diagExtra }
    if (label.startsWith('decide')) { if (!decide) throw new Error('unexpected decide call ' + label); return decide(label, prompt) }
    if (label === 'spec' || /^spec #\d+$/.test(label)) return Object.assign({ spec_path: 's.md' }, specFields, specSeq ? specSeq(Number((label.split('#')[1]) || 1), prompt) : {})
    if (label === 'plan') return { plan_path: 'p.md', plan_sha: planSha, tasks, serial_reason: serialReason }
    if (label === 'replan') return replanTasks ? { plan_path: 'p.md', plan_sha: planSha, tasks: replanTasks, serial_reason: null } : { plan_path: 'p.md', plan_sha: planSha, tasks, serial_reason: 'each task needs the previous one\'s code' }
    if (label === 'spec plan' || /^spec plan #\d+$/.test(label) || label === 'load plan') return Object.assign({ spec_path: null, plan_path: 'p.md', plan_sha: planSha, tasks }, specFields)
    if (label.startsWith('view capture #')) return { screenshots: [{ target: 'settings / empty', viewport: '390x844', before: '/s/b.png', after: '/s/a.png' }], processes_left: 0 }
    if (label === 'symptom check') return { options: FITS[fit], verdict: 'reported', reason: 'r' } // the model's own verdict is ignored
    if (label.startsWith('view #')) return view(Number(label.split('#')[1]))
    if (label === 'harvest') return harvest(prompt)
    if (label === 'verify gates') return { passed: gatesPass, checks: [], unfinished_work: '', code_defect: !gatesPass, summary: '', non_blocking_findings: [] }
    const id = label.split(' ')[1]
    if (label.startsWith('build')) return dieBuild.includes(id) ? null : { commits: (buildCommits && buildCommits(id)) || [H('sha-' + id)], files_changed: [], commands_run: [{ command: 'bun test', output_tail: 'BUILDER-CLAIM all green' }], deviations: ['dev-' + id], notes: 'BUILDER-NOTES trust me' }
    if (label === 'repair docs') return { docs_impact: 'updated', justification: 'fixed overclaim', files: ['docs/x.md'], commits: [H('docfix')] }
    if (label.startsWith('repair')) return { commits: [H('fix-' + id + label.split('#')[1])], files_changed: [], commands_run: [], deviations: [] }
    if (label.startsWith('verify') && !label.startsWith('verify docs')) {
      seen[id] = (seen[id] || 0) + 1
      const pass = !alwaysReject.includes(id) && !(rejectOnce.includes(id) && seen[id] === 1)
      return Object.assign({ passed: pass, checks: [], unfinished_work: pass ? '' : 'fix ' + id, code_defect: !pass, summary: '', non_blocking_findings: findings(id, seen[id]), negative_controls: [{ row: 'y', result: 'red' }] }, verdictExtra(id, seen[id]))
    }
    if (label === 'completeness') return { missing: [], detail: '' }
    if (label === 'gates') return { head_before: 'pre-gates', all_green: gatesGreen, gates: [{ command: 'unit', passed: true, skipped: false, output_tail: '' }], failures_fixed: gatesCommits.length ? ['lint in a.ts'] : [], remaining_failures: [], commits: gatesCommits, ...gatesExtra }
    if (label === 'docs') return { docs_impact: 'updated', justification: 'user docs', files: ['docs/x.md'] }
    if (label.startsWith('verify docs')) { const ok = docsPass(label === 'verify docs' ? 1 : 2); return { passed: ok, checks: ok ? [] : [{ check: 'claims true', ok: false, detail: '3 overclaims' }], unfinished_work: ok ? '' : 'docs/x.md overclaims offline support', code_defect: false, summary: '', non_blocking_findings: [] } }
    throw new Error('unexpected label ' + label)
  }
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)))
  const log = (m) => { logs.push(m); if (m.startsWith('Wave:')) waves.push(m) }
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
  const chain = ['T1', 'T2', 'T3', 'T4'].map((id, i) => ({ id, title: 's', files: [`f${i}.ts`], depends_on: i ? [`T${i}`] : [], section: SEC, acceptance: 'y' }))
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
// logs and screenshots live OUTSIDE the worktree; servers die by process group, checked with ps [IS-19, IS-20]
{
  const p = (await run({ extra: { worktree: '/wt/1-x', scratchDir: '/scratch' } })).calls[0].prompt
  assert.match(p, /logs under \/scratch\/1\/logs\/<port>\//)
  assert.ok(!p.includes('/wt/1-x/.logs'), 'no log dir inside the worktree')
  assert.match(p, /kill -- -<PGID>[^\n]*ps -eo pid,pgid,ppid,command/)
}
// user_visible turns on ONE view agent between build and gates; false skips it [VF-23]
{
  const off = await run()
  assert.ok(!off.calls.some((c) => c.label.startsWith('view')))
  assert.equal(off.res.view, null)
  const on = await run({ specExtra: { user_visible: true, view_targets: ['settings / empty'] }, extra: { scratchDir: '/scratch' } })
  const labels = on.calls.map((c) => c.label)
  assert.equal(labels.filter((l) => l.startsWith('view')).length, 1)
  assert.ok(labels.indexOf('view #1') > labels.lastIndexOf('completeness') && labels.indexOf('view #1') < labels.indexOf('gates'))
  const vp = on.calls.find((c) => c.label === 'view #1').prompt
  assert.match(vp, /BUILD NOTHING/)
  assert.match(vp, /390x844 and at 1440x900/)
  assert.match(vp, /settings \/ empty/)
  assert.match(vp, /\/scratch\/1\/screenshots\/round-1\//)
  assert.equal(on.res.status, 'verified')
  assert.equal(on.res.metrics.stages.find((x) => x.stage === 'View').agents, 1)
}
// a visual defect THIS branch caused goes to one repair; still there after it, a human decides. Pre-existing is a side issue
{
  const branch = { cause: 'branch', severity: 'defect', kind: 'ux', finding: 'save button overlaps the footer at 390x844', screenshots: ['/s/after.png'], file: 'a.ts' }
  const old = { cause: 'pre-existing', severity: 'doc-copy', kind: 'ux', finding: 'header label truncated', screenshots: ['/s/before.png'] }
  const fixed = await run({ specExtra: { user_visible: true }, view: (n) => ({ screenshots: [], findings: n === 1 ? [branch, old] : [old], processes_left: 0 }) })
  const rp = fixed.calls.find((c) => c.label === 'repair view #1')
  assert.ok(rp && /save button overlaps the footer/.test(rp.prompt) && /Files you may touch: a\.ts\./.test(rp.prompt), 'repair is scoped to the task that owns a.ts')
  assert.ok(fixed.calls.some((c) => c.label === 'view #2'))
  assert.equal(fixed.res.status, 'verified')
  assert.ok(fixed.res.commits.includes(H('fix-view1')))
  assert.ok(fixed.res.findings['doc-copy'].some((f) => /header label truncated/.test(f.finding) && f.evidence.includes('/s/before.png')))
  const stuck = await run({ specExtra: { user_visible: true }, view: () => ({ screenshots: [], findings: [branch], processes_left: 0 }) })
  assert.equal(stuck.calls.filter((c) => c.label.startsWith('repair view')).length, 1, 'max one view repair')
  assert.equal(stuck.res.status, 'decision_required')
  assert.match(stuck.res.decision_required, /save button overlaps the footer/)
  const hv = stuck.calls.find((c) => c.label === 'harvest')
  assert.ok(!hv || !/save button overlaps/.test(hv.prompt), 'a branch defect is never harvested as a side issue')
}
// a privacy or security behaviour change stops at spec for the human, never ranked away; a human decision lets it through [SP-18]
{
  const row = { surface: 'record page while locked', before: 'page torn down', after: 'names stay under a translucent overlay', decision_ref: null }
  const stop = await run({ specExtra: { privacy_security_change: true, privacy_security_rows: [row] } })
  assert.equal(stop.res.status, 'decision_required')
  assert.equal(stop.res.stage, 'spec')
  assert.match(stop.res.decision_required, /names stay under a translucent overlay/)
  assert.ok(!stop.calls.some((c) => c.label === 'plan'))
  assert.match(stop.calls.find((c) => c.label === 'spec').prompt, /Never settle a row yourself/)
  const bare = await run({ specExtra: { privacy_security_change: true } })
  assert.equal(bare.res.status, 'decision_required', 'a privacy change with no rows still stops')
  const fake = await run({ specExtra: { privacy_security_change: true, privacy_security_rows: [Object.assign({}, row, { decision_ref: 3 })] }, extra: { decisions: ['unmount on lock'] } })
  assert.equal(fake.res.status, 'decision_required', 'a decision_ref with no human decision behind it does not count')
  const ok = await run({ specExtra: { privacy_security_change: true, privacy_security_rows: [Object.assign({}, row, { decision_ref: 0 })] }, extra: { decisions: ['unmount the page on lock'] } })
  assert.equal(ok.res.status, 'verified')
  assert.match(ok.calls.find((c) => c.label === 'verify T1 #1').prompt, /unmount the page on lock/)
  // the verifier finds one the spec missed: the task stops, no repair
  const v = await run({ verdictExtra: (id) => (id === 'T1' ? { privacy_security_change: 'Decrypted names now stay in the DOM while locked.' } : {}) })
  const t1 = v.res.tasks.find((t) => t.id === 'T1')
  assert.equal(t1.status, 'decision_required')
  assert.ok(!v.calls.some((c) => c.label.startsWith('repair T1')))
  assert.equal(v.res.status, 'decision_required')
}
// stale findings: true only until a later stage ran; dropped once that stage passed, kept when it did not [VF-32]
{
  const f = (id) => (id === 'T1' ? [{ severity: 'test-gap', finding: 'T1 uncommitted, acceptance pending', until_stage: 'gates' }, { severity: 'test-gap', finding: 'no test for the empty list' }] : [])
  const green = await run({ findings: f })
  assert.ok(!green.res.findings['test-gap'].some((x) => /acceptance pending/.test(x.finding)))
  assert.ok(green.res.findings['test-gap'].some((x) => /empty list/.test(x.finding)))
  assert.equal(green.res.metrics.superseded_findings, 1)
  assert.ok(!/acceptance pending/.test(green.calls.find((c) => c.label === 'harvest').prompt))
  const red = await run({ findings: f, gatesGreen: false })
  assert.ok(red.res.findings['test-gap'].some((x) => /acceptance pending/.test(x.finding)), 'gates did not pass, so it is not stale')
}
// harvest: one agent after docs, fed by every stage; nothing to harvest, no agent [OR-27]
{
  const none = await run()
  assert.ok(!none.calls.some((c) => c.label === 'harvest'))
  assert.deepEqual(none.res.side_issues, [])
  const f = (id) => (id === 'T2' ? [{ severity: 'follow-up', finding: 'export page has no empty state', file: 'export.ts' }] : [])
  const { res, calls } = await run({ findings: f, docsImpact: 'docs/x.md', diagExtra: { side_findings: [{ severity: 'defect', finding: 'import silently drops rows with a blank date', file: 'import.ts' }] },
    extra: { openIssues: [{ number: 41, title: 'Import silently drops rows with a blank date', labels: ['bug'] }] } })
  const labels = calls.map((c) => c.label)
  assert.equal(labels[labels.length - 1], 'harvest')
  const hp = calls.find((c) => c.label === 'harvest').prompt
  assert.ok(/export page has no empty state/.test(hp) && /blank date/.test(hp) && /#41 Import silently drops/.test(hp))
  assert.deepEqual(res.side_issues, [])
}
// harvest dedupes against openIssues in code: a missed title match and an invented number are both corrected
{
  const drafts = [
    { title: 'Import silently drops rows with a blank date', body: 'b', kind: 'bug', severity: 'wrong-state', evidence: ['import.ts:40'], duplicate_of: null, bundle: false },
    { title: 'Export page has no empty state', body: 'b', kind: 'ux', severity: 'minor', evidence: ['export.ts:9'], duplicate_of: 999, bundle: false },
    { title: 'Unproven claim', body: 'b', kind: 'bug', severity: 'minor', evidence: [], duplicate_of: null, bundle: true },
  ]
  const { res } = await run({ findings: () => [{ severity: 'follow-up', finding: 'x' }], harvest: () => ({ side_issues: drafts, dropped: [] }),
    extra: { openIssues: [{ number: 41, title: 'Import silently drops rows with a blank date', labels: ['bug'] }] } })
  assert.equal(res.side_issues.find((d) => /blank date/.test(d.title)).duplicate_of, 41)
  assert.equal(res.side_issues.find((d) => /empty state/.test(d.title)).duplicate_of, null, 'not an open issue')
  assert.ok(!res.side_issues.some((d) => d.title === 'Unproven claim'), 'no evidence, no draft')
  assert.ok(res.side_issues.every((d) => d.body.startsWith('Found while resolving #1.')))
}
// severity decides: serious problems get their own issue, minor ones ONE bundle per run; identifiers scrubbed
{
  const d = (title, severity, bundle) => ({ title, body: `${title}: see MRN-12345`, kind: 'bug', severity, evidence: ['z.ts:1'], duplicate_of: null, bundle })
  const drafts = [d('Session token kept after logout', 'security', true), d('Edits lost on tap outside', 'data-loss', true), d('Button 2px off', 'minor', false), d('Typo in footer', 'minor', true)]
  const { res } = await run({ findings: () => [{ severity: 'follow-up', finding: 'x' }], harvest: () => ({ side_issues: drafts, dropped: [] }),
    extra: { profile: { privacy: { identifier_patterns: ['MRN-\\d+'] }, labels: { 'needs-triage': 'triage-pending' } } } })
  const sep = res.side_issues.filter((x) => !x.bundle).map((x) => x.title)
  assert.deepEqual(sep.sort(), ['Edits lost on tap outside', 'Session token kept after logout'])
  assert.ok(res.bundle_issue && /\(2\)$/.test(res.bundle_issue.title))
  assert.ok(/Button 2px off/.test(res.bundle_issue.body) && /Typo in footer/.test(res.bundle_issue.body))
  assert.ok(res.side_issues.every((x) => !/MRN-12345/.test(x.body) && /\[redacted\]/.test(x.body)))
  assert.equal(res.side_issue_label, 'triage-pending')
  assert.match(res.summary, /Side issues to file: 2 separate, 1 bundle of 2, 0 comments/)
}

// a diagnosis data-loss menu stops before the spec; once the human answers, the menu reaches the spec instead of stopping again forever [SP-11, SP-19]
{
  const menu = 'A) delete the stale upload; B) keep it; C) leave as is'
  const stop = await run({ diagExtra: { decision_required: menu } })
  assert.equal(stop.res.status, 'decision_required')
  assert.equal(stop.res.stage, 'diagnose')
  assert.ok(!stop.calls.some((c) => c.label === 'spec'), 'no spec before the human answers')
  const go = await run({ diagExtra: { decision_required: menu }, extra: { decisions: ['A: delete the stale upload'] } })
  assert.notEqual(go.res.status, 'decision_required', 'an answered menu must not stop the run again')
  const spec = go.calls.find((c) => c.label === 'spec')
  assert.ok(spec, 'the spec runs once the human answered')
  assert.match(spec.prompt, /\[0\] A: delete the stale upload/)
  assert.match(spec.prompt, /settle it ONLY from the decisions below/)
  const again = await run({ diagExtra: { decision_required: menu }, extra: { decisions: ['A'] }, specExtra: { decision_required: menu } })
  assert.equal(again.res.status, 'decision_required', 'the spec can still re-raise an unsettled menu')
}

// ---------- auto-decide [SP-20] ----------
const RANKER = { ranker: { cmd: 'jev' } }
const OPT_A = 'A: delete the stale upload'
const MENU = 'A) delete the stale upload; B) keep it'
const verdict = (o = {}) => Object.assign({ question: 'q', options: [OPT_A, 'B: keep it'], recommendation: OPT_A, recommendation_reason: 'nothing references it',
  ranking: { top: OPT_A, p_top: 0.75, p_second: 0.25, raw: 'A 0.75 | B 0.25' }, critical: false, critical_reason: null, weakens_protection: false }, o)
const counting = (o) => { const f = (label) => { f.calls.push(label); return verdict(typeof o === 'function' ? o(label) : o) }; f.calls = []; return f }
const bullets = (summary) => { const l = summary.split('\n'); const i = l.indexOf('Insights:'); return i < 0 ? [] : l.slice(i + 1).filter((x, j, a) => a.slice(0, j + 1).every((y) => y.startsWith('- '))) }

// rec = ranker top, margin 0.5, not critical: the run continues, the spec sees the AUTO decision, the summary lists it
{
  const decide = counting({})
  const { res, calls } = await run({ diagExtra: { decision_required: MENU }, extra: { profile: RANKER }, decide })
  assert.equal(res.status, 'verified', 'an auto-decided menu does not stop the run')
  assert.equal(res.auto_decisions.length, 1)
  assert.deepEqual(decide.calls, ['decide diagnose'])
  assert.match(calls.find((c) => c.label === 'spec').prompt, /\[0\] AUTO \(rec\+ranker agree, p=0\.75\): A: delete the stale upload/)
  assert.match(res.summary, /Auto-decided \(review\): \[diagnose\] A: delete the stale upload p=0\.75/)
}
// the recommendation and the ranker disagree: stop, with options, recommendation, ranking and why
{
  const { res, calls } = await run({ diagExtra: { decision_required: MENU }, extra: { profile: RANKER }, decide: counting({ ranking: { top: 'B: keep it', p_top: 0.7, p_second: 0.3, raw: 'B 0.7' } }) })
  assert.equal(res.status, 'decision_required')
  assert.match(res.decision_required, /Options: 1\) A: delete the stale upload; 2\) B: keep it/)
  assert.match(res.decision_required, /Recommended: A: delete the stale upload/)
  assert.match(res.decision_required, /Ranker: top "B: keep it" p=0\.7/)
  assert.match(res.decision.not_auto, /disagree/)
  assert.equal(res.auto_decisions.length, 0)
  assert.ok(!calls.some((c) => c.label === 'spec'))
}
// a thin margin (0.1) stops
{
  const { res } = await run({ diagExtra: { decision_required: MENU }, extra: { profile: RANKER }, decide: counting({ ranking: { top: OPT_A, p_top: 0.55, p_second: 0.45, raw: '' } }) })
  assert.equal(res.status, 'decision_required')
  assert.match(res.decision.not_auto, /thin margin/)
}
// critical stops even when rec and ranker agree; the criteria list is profile-extensible
{
  const decide = counting({ critical: true, critical_reason: 'money, billing or pricing' })
  const { res, calls } = await run({ diagExtra: { decision_required: MENU }, extra: { profile: Object.assign({ decisions: { critical: ['touches the audit log'] } }, RANKER) }, decide })
  assert.equal(res.status, 'decision_required')
  assert.match(res.decision.not_auto, /^critical: money/)
  const dp = calls.find((c) => c.label === 'decide diagnose').prompt
  assert.ok(/encryption keys or vault crypto/.test(dp) && /security weakening/.test(dp) && /touches the audit log/.test(dp))
}
// privacy rows: auto only without a weakening; a weakening is critical in code, whatever the agent says
{
  const row = { surface: 'record page while locked', before: 'page torn down', after: 'page unmounted sooner', decision_ref: null }
  const settle = (n) => (n > 1 ? { privacy_security_rows: [Object.assign({}, row, { decision_ref: 0 })] } : {})
  const weak = await run({ specExtra: { privacy_security_change: true, privacy_security_rows: [row] }, specSeq: settle, extra: { profile: RANKER }, decide: counting({ weakens_protection: true }) })
  assert.equal(weak.res.status, 'decision_required')
  assert.equal(weak.res.stage, 'spec')
  assert.match(weak.res.decision.not_auto, /weakens protection/)
  assert.ok(!weak.calls.some((c) => c.label === 'plan'))
  const ok = await run({ specExtra: { privacy_security_change: true, privacy_security_rows: [row] }, specSeq: settle, extra: { profile: RANKER }, decide: counting({}) })
  assert.equal(ok.res.status, 'verified', 'a non-weakening privacy row with rec+ranker agreement is auto-decided')
  assert.ok(ok.calls.some((c) => c.label === 'spec #2'), 'the spec re-runs once with the decision')
  assert.match(ok.calls.find((c) => c.label === 'spec #2').prompt, /\[0\] AUTO/)
}
// the cap: at most 3 auto-decisions per run; the 4th stops without a decide agent
{
  const four = ['T1', 'T2', 'T3', 'T4'].map((id) => ({ id, title: id, files: [`${id}.ts`], depends_on: [], section: SEC, acceptance: 'y' }))
  const decide = counting({})
  const { res } = await run({ tasks: four, serialReason: null, extra: { profile: RANKER }, decide, verdictExtra: (id, n) => (n === 1 ? { privacy_security_change: `${id} keeps names in the DOM` } : {}) })
  assert.equal(res.auto_decisions.length, 3)
  assert.equal(decide.calls.length, 3)
  const stopped = res.tasks.filter((t) => t.status === 'decision_required')
  assert.equal(stopped.length, 1)
  assert.match(res.decision_required, /cap of 3 auto-decisions/)
  assert.equal(res.status, 'decision_required')
}
// profile.decisions.auto=false restores always-ask: no decide agent, today's stop verbatim
{
  const decide = counting({})
  const { res } = await run({ diagExtra: { decision_required: MENU }, extra: { profile: Object.assign({ decisions: { auto: false } }, RANKER) }, decide })
  assert.equal(res.status, 'decision_required')
  assert.equal(res.decision_required, MENU)
  assert.equal(decide.calls.length, 0)
}
// a task's behaviour-choice stop, auto-decided, continues repair with the chosen behaviour
{
  const ve = (id, n) => (id === 'T1' && n < 4 ? { passed: false, failing_test: 'tap outside', failure_cause: 'undecided discard', behaviour_choice: true } : {})
  const { res, calls } = await run({ verdictExtra: ve, extra: { profile: RANKER }, decide: counting({}) })
  assert.equal(res.tasks.find((t) => t.id === 'T1').status, 'verified')
  assert.match(calls.find((c) => c.label === 'repair T1 #3').prompt, /Decided \(AUTO, run decisions\): A: delete the stale upload/)
}
// Insights: at most 4 bullets, each computed from data
{
  const { res } = await run({ diagExtra: { decision_required: MENU }, extra: { profile: RANKER }, decide: counting({}), specExtra: { cause_class: 'state' } })
  const b = bullets(res.summary)
  assert.ok(b.length >= 3 && b.length <= 4, `insights: ${b.join(' | ')}`)
  assert.equal(b[0], '- Cause class: state, at h')
  assert.match(b[1], /^- Effort: most output in \w+ \(\d+ output tokens\); repairs 0; verifier rejections 0$/)
  assert.equal(b[2], '- Auto-decisions: 1 (top p 0.75)')
  // everything present: still 4 bullets, the watch line kept
  const f = (id) => (id === 'T1' ? [{ severity: 'test-gap', finding: 'acceptance pending', until_stage: 'gates' }, { severity: 'follow-up', finding: 'x' }] : [])
  const all = await run({ diagExtra: { decision_required: MENU }, extra: { profile: RANKER }, decide: counting({}), findings: f,
    harvest: () => ({ side_issues: [{ title: 'Export page has no empty state', body: 'b', kind: 'ux', severity: 'minor', evidence: ['e.ts:1'], duplicate_of: null, bundle: true }], dropped: [] }) })
  const ab = bullets(all.res.summary)
  assert.equal(ab.length, 4)
  assert.match(ab[3], /^- Watch: 1 superseded finding/)
}
// a visual defect left after one repair, auto-decided: one more repair with the choice, then one last look
{
  const branch = { cause: 'branch', severity: 'defect', kind: 'ux', finding: 'save button overlaps the footer', screenshots: ['/s/a.png'], file: 'a.ts' }
  const { res, calls } = await run({ specExtra: { user_visible: true }, extra: { profile: RANKER }, decide: counting({}), view: (n) => ({ screenshots: [], findings: n < 3 ? [branch] : [], processes_left: 0 }) })
  assert.match(calls.find((c) => c.label === 'repair view #2').prompt, /Decided \(AUTO, run decisions\): A: delete the stale upload/)
  assert.ok(calls.some((c) => c.label === 'view #3'))
  assert.equal(res.status, 'verified')
}

// ---------- 1.3.0 rules ----------
// docs rejected: one repair round; still rejected, the run is partial with 'docs not verified', never verified [VF-33]
{
  const fixed = await run({ docsImpact: 'docs/x.md', docsPass: (n) => n === 2 })
  const labels = fixed.calls.map((c) => c.label)
  assert.ok(labels.includes('repair docs') && labels.includes('verify docs #2'), labels.join(', '))
  assert.match(fixed.calls.find((c) => c.label === 'repair docs').prompt, /overclaims offline support/)
  assert.equal(fixed.res.status, 'verified')
  assert.ok(fixed.res.commits.includes(H('docfix')))
  const still = await run({ docsImpact: 'docs/x.md', docsPass: () => false })
  assert.equal(still.calls.filter((c) => c.label === 'repair docs').length, 1, 'one docs repair round only')
  assert.equal(still.res.status, 'partial')
  assert.equal(still.res.reason, 'docs not verified')
  assert.equal(still.res.docs.verified, false)
  assert.match(still.res.summary, /Open: [^\n]*docs not verified/)
}
// a pass whose unfinished_work names only files outside the task is a side finding (harvest), not a failure [VF-34]
{
  const sib = 'other/export-page.ts: the export page has the same stale-count bug'
  const ve = (id, n) => (id === 'T1' && n === 1 ? { passed: true, unfinished_work: sib, negative_controls: [] } : id === 'T2' ? { passed: true, unfinished_work: sib } : {})
  const { res, calls } = await run({ verdictExtra: ve })
  assert.ok(!/export-page/.test(calls.find((c) => c.label === 'repair T1 #1').prompt), 'out-of-scope work never reaches the task\'s repair')
  assert.equal(res.tasks.find((t) => t.id === 'T2').status, 'verified')
  assert.equal(res.status, 'verified')
  const f = res.findings['follow-up'].find((x) => /export page has the same/.test(x.finding))
  assert.ok(f && f.evidence.includes('other/export-page.ts'), 'routed to the findings list as a follow-up')
  assert.match(calls.find((c) => c.label === 'harvest').prompt, /export page has the same stale-count bug/)
  assert.match(calls.find((c) => c.label === 'verify T1 #1').prompt, /outside the task's list[^\n]*does not fail the task/)
}
// a gates failure outside the diff that flips on rerun is unrelated_unstable: filed, not partial [TG-35]
{
  const flaky = { failure: 'e2e: search.spec.ts timed out', spec_file: 'tests/e2e/search.spec.ts', code_paths: ['src/search.ts'], flipped_on_rerun: true }
  const g = (f) => ({ gatesGreen: false, gatesExtra: { remaining_failures: [f.failure], failures: [f], diff_files: ['a.ts', 'b.ts'] } })
  const { res, calls } = await run(g(flaky))
  assert.equal(res.status, 'verified', 'an unrelated unstable failure does not make the run partial')
  assert.deepEqual(res.gates.unrelated_unstable, [{ failure: flaky.failure, spec_file: flaky.spec_file }])
  assert.deepEqual(res.gates.remaining_failures, [])
  assert.match(calls.find((c) => c.label === 'harvest').prompt, /unrelated_unstable: e2e: search\.spec\.ts timed out/)
  assert.match(res.summary, /unrelated_unstable \(filed, not blocking\): tests\/e2e\/search\.spec\.ts/)
  assert.match(calls.find((c) => c.label === 'gates').prompt, /flipped_on_rerun/)
  assert.equal((await run(g(Object.assign({}, flaky, { code_paths: ['a.ts:12'] })))).res.status, 'partial', 'touches the diff: blocks')
  assert.equal((await run(g(Object.assign({}, flaky, { flipped_on_rerun: false })))).res.status, 'partial', 'stays red on rerun: blocks')
}
// harvest: a security or privacy finding in this branch's files goes back as a branch defect, never a side issue [OR-27]
{
  const drafts = [
    { title: 'Suffix rule accepts buyable country-code domains', body: 'b', kind: 'bug', severity: 'security', evidence: ['a.ts:40'], duplicate_of: null, bundle: false },
    { title: 'Old token kept in another module', body: 'b', kind: 'bug', severity: 'security', evidence: ['legacy/auth.ts:9'], duplicate_of: null, bundle: false },
  ]
  const { res, calls } = await run({ findings: () => [{ severity: 'follow-up', finding: 'x' }], harvest: () => ({ side_issues: drafts, dropped: [] }) })
  assert.ok(!res.side_issues.some((d) => /buyable/.test(d.title)), 'never filed')
  assert.ok(res.side_issues.some((d) => /another module/.test(d.title)), 'outside the diff it is a side issue')
  assert.deepEqual(res.branch_defects.map((d) => d.finding), ['Suffix rule accepts buyable country-code domains'])
  assert.equal(res.status, 'partial')
  assert.match(res.summary, /Open: [^\n]*branch defect \(security\): Suffix rule/)
  assert.match(calls.find((c) => c.label === 'harvest').prompt, /SECURITY or PRIVACY finding that touches any file in this branch's diff/)
}
// harvest dedupes by concept; a resumed build extracts the spec's fields and never ships placeholders [OR-27, OR-30]
{
  const hp = (await run({ findings: () => [{ severity: 'follow-up', finding: 'x' }] })).calls.find((c) => c.label === 'harvest').prompt
  assert.match(hp, /Dedupe by CONCEPT[^\n]*root cause[^\n]*title and labels/)
  const r = await run({ extra: { resumeFrom: 'build' }, specExtra: { root_cause: 'See the spec.', user_change: 'see the committed spec for details' } })
  assert.match(r.calls.find((c) => c.label === 'load plan').prompt, /root_cause, user_change and cause_class/)
  assert.ok(!/see the (committed )?spec/i.test(r.res.summary), r.res.summary)
  assert.equal(r.res.root_cause, null)
  assert.equal(r.res.user_change, null)
}
// narrowing inside an existing human decision is auto-decidable; widening or a new data lifetime stops [SP-18, SP-20]
{
  const row = { surface: 'stale candidate cleanup', before: 'deletes every candidate older than 24h', after: 'skips candidates another live account shares', decision_ref: null }
  const settle = (n) => (n > 1 ? { privacy_security_rows: [Object.assign({}, row, { decision_ref: 1 })] } : {})
  const base = { specExtra: { privacy_security_change: true, privacy_security_rows: [row] }, specSeq: settle, extra: { profile: RANKER, decisions: ['delete stale candidates older than 24h'] } }
  const narrow = { critical: true, critical_reason: 'irreversible deletion of user data', narrows_decision: 0, widens_exposure: false, new_data_lifetime: false }
  const ok = await run(Object.assign({ decide: counting(narrow) }, base))
  assert.equal(ok.res.status, 'verified', 'a narrowing inside human decision [0] does not stop')
  assert.equal(ok.res.auto_decisions[0].narrows_decision, 0)
  assert.match(ok.calls.find((c) => c.label === 'spec #2').prompt, /\[1\] AUTO \(narrows decision \[0\]/)
  assert.match(ok.calls.find((c) => c.label.startsWith('decide')).prompt, /only NARROWS exposure/)
  for (const bad of [{ widens_exposure: true }, { new_data_lifetime: true }, { narrows_decision: 5 }]) {
    const r = await run(Object.assign({ decide: counting(Object.assign({}, narrow, bad)) }, base))
    assert.equal(r.res.status, 'decision_required', JSON.stringify(bad))
  }
  const onAuto = await run(Object.assign({ decide: counting(narrow) }, base, { extra: { profile: RANKER, decisions: ['AUTO (rec+ranker agree, p=0.8): delete'] } }))
  assert.equal(onAuto.res.status, 'decision_required', 'narrowing an AUTO decision is not narrowing a human one')
}
// side issues carry profile.labels.side_issue; the summary always ends "New issues filed: …" [OR-29]
{
  const d = { title: 'Export page has no empty state', body: 'b', kind: 'ux', severity: 'minor', evidence: ['e.ts:1'], duplicate_of: null, bundle: true }
  const { res } = await run({ findings: () => [{ severity: 'follow-up', finding: 'x' }], harvest: () => ({ side_issues: [d], dropped: [] }),
    extra: { profile: { labels: { 'needs-triage': 'triage-pending', side_issue: 'found-by-run' } } } })
  assert.deepEqual(res.side_issues[0].labels, ['triage-pending', 'found-by-run'])
  assert.deepEqual(res.bundle_issue.labels, ['triage-pending', 'found-by-run'])
  assert.match(res.summary.split('\n').pop(), /^New issues filed: pending audit \(1 draft\(s\), 1 bundle, labelled triage-pending, found-by-run\)$/)
  assert.equal((await run()).res.summary.split('\n').pop(), 'New issues filed: none')
}

// ---------- 1.4.0 token diet [CO-9] ----------
// every agent runs as the lean worker type; profile agent_type null keeps the default; a tier may opt out
{
  const { calls } = await run({ docsImpact: 'docs/x.md', findings: () => [{ severity: 'follow-up', finding: 'x' }] })
  assert.ok(calls.every((c) => c.agentType === 'resolve-worker'), calls.filter((c) => c.agentType !== 'resolve-worker').map((c) => c.label).join(', '))
  assert.ok((await run({ extra: { profile: { agent_type: null } } })).calls.every((c) => c.agentType === undefined))
  const t = await run({ extra: { tiers: { verify: { agent_type: null } } } })
  assert.equal(t.calls.find((c) => c.label === 'verify T1 #1').agentType, undefined)
  assert.equal(t.calls.find((c) => c.label === 'build T1').agentType, 'resolve-worker')
}
// tool output is capped at the source, head and tail kept, never cut silently; the hook line only when the switch is on
{
  const { calls } = await run()
  const pre = calls[0].prompt
  assert.match(pre, /git show --stat <sha>` first, then `git diff <sha>\^! -- <file>`/)
  assert.match(pre, /rg -n '<pattern>' <path>`, then `sed -n '<a>,<b>p' <path>`/)
  assert.match(pre, /keep its head AND tail and print "… truncated, full log at <path>"/)
  assert.match(pre, /bring back only the failing set or the summary/)
  assert.match(calls.find((c) => c.label === 'gates').prompt, /bring back only the failing set and the summary line\. Never print a whole log/)
  assert.ok(!/A hook rewrites test commands/.test(pre))
  assert.match((await run({ extra: { profile: { filter_test_output: true } } })).calls[0].prompt, /A hook rewrites test commands/)
}
// every prompt starts with the shared preamble and ends with its task tail, so siblings share a prefix
{
  const { calls } = await run({ specExtra: { user_visible: true }, docsImpact: 'docs/x.md', findings: () => [{ severity: 'follow-up', finding: 'x' }] })
  for (const c of calls) assert.ok(c.prompt.trimStart().startsWith('=== SHARED CONTEXT'), `${c.label} does not start with the preamble`)
  const v1 = calls.find((c) => c.label === 'verify T1 #1').prompt
  const v2 = calls.find((c) => c.label === 'verify T2 #1').prompt
  const cut = v1.indexOf('Your task:')
  assert.ok(cut > 3000 && v1.slice(0, cut) === v2.slice(0, cut), 'verifiers of different tasks share everything before the task tail')
}
// plan as pointers: tasks are read at the plan's commit by line range, never pasted; a bad pointer stops the run
{
  const { res, calls } = await run({ rejectOnce: ['T1'] })
  const ref = `git show ${PLAN_SHA}:p.md | sed -n '10,40p'`
  for (const l of ['build T1', 'verify T1 #1', 'repair T1 #1', 'verify T1 #2']) assert.ok(calls.find((c) => c.label === l).prompt.includes(ref), l)
  assert.match(calls.find((c) => c.label === 'verify T1 #1').prompt, /AS COMMITTED, never from the working tree/)
  assert.match(calls.find((c) => c.label === 'plan').prompt, /POINTERS, not copies/)
  assert.equal(res.status, 'verified')
  const bad = await run({ planSha: 'HEAD' })
  assert.equal(bad.res.status, 'failed')
  assert.match(bad.res.reason, /plan_sha is not a commit SHA/)
  assert.ok(!bad.calls.some((c) => c.label.startsWith('build')))
  const nosec = await run({ tasks: [Object.assign({}, TASKS[0], { section: null })] })
  assert.match(nosec.res.reason, /T1 has no section line range/)
}
// diagnoses reach the spec compact: the fields it needs, not pretty-printed, no side findings
{
  const { calls } = await run({ diagExtra: { side_findings: [{ severity: 'defect', finding: 'SIDE-FINDING-XYZ', file: 'q.ts' }], method: 'METHOD-XYZ' } })
  const sp = calls.find((c) => c.label === 'spec').prompt
  assert.ok(sp.includes('"candidates":[{"cause":"stale cache"'), 'compact JSON')
  assert.ok(!/SIDE-FINDING-XYZ|METHOD-XYZ/.test(sp))
}
// verifiers run the task's named tests plus typecheck and lint; suites and e2e stay in gates
{
  const v = (await run()).calls.find((c) => c.label === 'verify T1 #1').prompt
  assert.match(v, /Run ONLY the task's named tests[^\n]*Never the full suites or e2e unless a named test is e2e: the gates stage owns those/)
}
// builders get the shortest-correct-diff rule; verifiers do not
{
  const { calls } = await run()
  assert.match(calls.find((c) => c.label === 'build T1').prompt, /shortest correct diff/)
  assert.ok(!/shortest correct diff/.test(calls.find((c) => c.label === 'verify T1 #1').prompt))
}
// VIEW reuses round-1 BEFORE shots later; view.split = a capture agent on the build tier + a judge that starts nothing
{
  const branch = { cause: 'branch', severity: 'defect', kind: 'ux', finding: 'save button overlaps the footer', screenshots: ['/s/a.png'], file: 'a.ts' }
  const view = (n) => ({ screenshots: [], findings: n === 1 ? [branch] : [], processes_left: 0 })
  const one = await run({ specExtra: { user_visible: true }, view })
  const p1 = one.calls.find((c) => c.label === 'view #1').prompt
  const p2 = one.calls.find((c) => c.label === 'view #2').prompt
  assert.match(p1, /throwaway detached worktree at/)
  assert.ok(!/throwaway detached worktree at/.test(p2) && /REUSE the round-1 before shots/.test(p2))
  assert.ok(!one.calls.some((c) => c.label.startsWith('view capture')))
  const sp = await run({ specExtra: { user_visible: true }, view, extra: { profile: { view: { split: true } } } })
  const labels = sp.calls.map((c) => c.label)
  assert.ok(labels.indexOf('view capture #1') >= 0 && labels.indexOf('view capture #1') < labels.indexOf('view #1'))
  assert.equal(sp.calls.find((c) => c.label === 'view capture #1').model, 'mid', 'capture runs on the build tier')
  const judge = sp.calls.find((c) => c.label === 'view #1').prompt
  assert.ok(/start nothing/.test(judge) && /\/s\/a\.png/.test(judge) && !/throwaway detached worktree/.test(judge))
  assert.equal(sp.res.status, 'verified')
  assert.equal(sp.res.view.screenshots, 1, 'the judge result carries the capture agent\'s shots')
}
// medium effort for completeness, harvest and docs-verify; verify keeps its own tier
{
  const tiers = { verify: { model: 'top', effort: 'high' }, build: { model: 'mid' } }
  const { calls } = await run({ docsImpact: 'docs/x.md', findings: () => [{ severity: 'follow-up', finding: 'x' }], extra: { tiers } })
  for (const l of ['completeness', 'verify docs', 'harvest']) assert.equal(calls.find((c) => c.label === l).effort, 'medium', l)
  assert.equal(calls.find((c) => c.label === 'completeness').model, 'top')
  assert.equal(calls.find((c) => c.label === 'verify T1 #1').effort, 'high')
}
// spent is labelled output-only
{
  assert.equal((await run()).res.metrics.spent_unit, 'output_tokens')
}
// switch verify.delta_reverify (off by default): a re-verify after a repair gets the prior verdict
{
  const ve = (id, n) => (id === 'T1' && n === 1 ? { checks: [{ check: 'named tests pass', ok: false, detail: 'x' }] } : {})
  const off = await run({ rejectOnce: ['T1'], verdictExtra: ve })
  assert.ok(!/DELTA RE-VERIFY/.test(off.calls.find((c) => c.label === 'verify T1 #2').prompt))
  const on = await run({ rejectOnce: ['T1'], verdictExtra: ve, extra: { profile: { verify: { delta_reverify: true } } } })
  const p = on.calls.find((c) => c.label === 'verify T1 #2').prompt
  assert.ok(p.includes(`git diff --name-only ${H('sha-T1')}..HEAD`) && /named tests pass/.test(p))
  assert.ok(!/DELTA RE-VERIFY/.test(on.calls.find((c) => c.label === 'verify T1 #1').prompt), 'round 1 is always a full verify')
}
// switch verify.diff_scope (off by default): the task's diff and its callers, cross-cutting code exempt
{
  assert.ok(!/DIFF SCOPE/.test((await run()).calls.find((c) => c.label === 'verify T1 #1').prompt))
  const p = (await run({ extra: { profile: { verify: { diff_scope: true } } } })).calls.find((c) => c.label === 'verify T1 #1').prompt
  assert.match(p, /DIFF SCOPE[^\n]*rg -l '<export>'[^\n]*Cross-cutting code \(auth/)
}
// switch spec_plan_merged_upto (off by default): one spec+plan agent when every diagnosis expects that few tasks
{
  const two = TASKS.slice(0, 2)
  const off = await run({ tasks: two, diagExtra: { expected_tasks: 2 } })
  assert.ok(off.calls.some((c) => c.label === 'spec') && off.calls.some((c) => c.label === 'plan'))
  const on = await run({ tasks: two, diagExtra: { expected_tasks: 2 }, extra: { profile: { spec_plan_merged_upto: 3 } } })
  assert.ok(on.calls.some((c) => c.label === 'spec plan') && !on.calls.some((c) => c.label === 'plan' || c.label === 'spec'))
  assert.match(on.calls.find((c) => c.label === 'spec plan').prompt, /Use 1 to 3 tasks/)
  assert.match(on.calls.find((c) => c.label === 'spec plan').prompt, /Write the spec to/, 'a medium merge still writes a spec file')
  for (const e of [5, null]) assert.ok((await run({ tasks: two, diagExtra: { expected_tasks: e }, extra: { profile: { spec_plan_merged_upto: 3 } } })).calls.some((c) => c.label === 'plan'), String(e))
}
// a resume with the stopped run's plan spends no agent on loading it
{
  const r = await run({ extra: { resumeFrom: 'build', resumePlan: { root_cause: 'r', user_change: 'u', user_visible: false, docs_impact: 'none', plan_path: 'p.md', plan_sha: PLAN_SHA, tasks: TASKS } } })
  assert.ok(!r.calls.some((c) => c.label === 'load plan'))
  assert.equal(r.calls[0].label, 'build T1')
  assert.equal(r.res.status, 'verified')
}

// scripts: the opt-in test-output hook keeps the exit code and the full log; run-cost.py weights cache and output
{
  const { execFileSync, spawnSync } = await import('node:child_process')
  const { mkdtempSync, writeFileSync, readFileSync: rd, readdirSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(`${tmpdir()}/ri-`)
  const hook = new URL('./hooks/filter-test-output.py', import.meta.url).pathname
  const run1 = (command) => execFileSync('python3', [hook], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), env: { ...process.env, RESOLVE_LOG_DIR: dir } }).toString()
  assert.equal(run1('git status'), '', 'not a test runner: untouched')
  assert.equal(run1('bun test > /tmp/x.log 2>&1'), '', 'already redirected: untouched')
  const out = JSON.parse(run1('vitest run'))
  const cmd = out.hookSpecificOutput.updatedInput.command
  const fake = cmd.replace('vitest run', `for i in $(seq 1 300); do echo line$i; done; echo 'FAIL a.test.ts'; echo '2 failed, 298 passed'; false`)
  const r = spawnSync('bash', ['-c', fake])
  const shown = r.stdout.toString()
  assert.equal(r.status, 1, 'the runner\'s exit code survives')
  assert.ok(/FAIL a\.test\.ts/.test(shown) && /2 failed, 298 passed/.test(shown) && /… truncated, full log at .* exit=1/.test(shown))
  assert.ok(!/line150\n/.test(shown), 'the middle is cut')
  const log = readdirSync(dir).find((f) => f.endsWith('.log'))
  assert.ok(/line150\n/.test(rd(`${dir}/${log}`, 'utf8')), 'the full log stays on disk')
  // run-cost
  const wf = mkdtempSync(`${tmpdir()}/ri-wf-`)
  writeFileSync(`${wf}/journal.jsonl`, [{ type: 'started', agentId: 'a1', phase: 'Verify', label: 'verify T1 #1' }, { type: 'started', agentId: 'a2', phase: 'Verify', label: 'repair T1 #1' }].map((x) => JSON.stringify(x)).join('\n'))
  const u = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 20 }
  writeFileSync(`${wf}/agent-a1.jsonl`, [1, 1, 2].map((id) => JSON.stringify({ type: 'assistant', message: { id: `m${id}`, usage: u } })).join('\n'))
  writeFileSync(`${wf}/agent-a1.meta.json`, JSON.stringify({ model: 'opus' }))
  writeFileSync(`${wf}/agent-a2.jsonl`, JSON.stringify({ type: 'assistant', message: { id: 'm9', usage: u } }))
  writeFileSync(`${wf}/agent-a2.meta.json`, JSON.stringify({ model: 'sonnet' }))
  const c = JSON.parse(execFileSync('python3', [new URL('./run-cost.py', import.meta.url).pathname, wf]).toString())
  const one = 0.1 * 1000 + 1.25 * 100 + 10 + 5 * 20 // 335 units per turn at weight 1
  assert.deepEqual([c.stages.Verify.turns, c.stages.Verify.units, c.stages.Repair.units], [2, 2 * one, Math.round(0.6 * one)], JSON.stringify(c))
}
// an agent type that does not resolve never breaks a run: one retry without it, one log line, then the default agent
{
  const logs = []
  const thrown = []
  const { res, calls } = await run({ typeMissing: true, logs, thrown })
  assert.ok(thrown.length <= 2, `failed attempts after the first fallback: ${thrown.join(', ')}`) // the two parallel diagnosers may both try once
  assert.equal(res.status, 'verified')
  assert.equal(res.metrics.agent_type_fallback, true)
  assert.equal(logs.filter((m) => /resolve-worker agent not loaded \(restart Claude Code after installing\); using the default agent/.test(m)).length, 1)
  assert.equal(calls.length, (await run()).calls.length, 'later calls skip the agent type and pay no failed attempt')
  assert.equal((await run()).res.metrics.agent_type_fallback, false)
  const ol = []
  const other = await run({ typeMissing: 'rate limited', logs: ol })
  assert.equal(other.res.status, 'failed', 'any other error is not retried without the type')
  assert.equal(other.res.reason, 'all diagnosers died')
  assert.ok(!ol.some((m) => /not loaded/.test(m)) && !other.res.metrics.agent_type_fallback)
}
console.log('PASS: workflow dry-run checks')
