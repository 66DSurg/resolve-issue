// Dry-run templates/workflow.js against mocked agents: exercises the wave scheduler,
// the repair loop, dead-agent handling, the symptom check, the merged findings list and the compact return cap. Run: node scripts/test-workflow.mjs
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const src = readFileSync(new URL('../templates/workflow.js', import.meta.url), 'utf8').replace('export const meta', 'const meta')
const AsyncFn = Object.getPrototypeOf(async () => {}).constructor
const wf = new AsyncFn('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', src)

const TASKS = [
  { id: 'T1', title: 'root fix', files: ['a.ts'], depends_on: [], instructions: 'x', acceptance: 'y' },
  { id: 'T2', title: 'guard', files: ['b.ts'], depends_on: ['T1'], instructions: 'x', acceptance: 'y' },
  { id: 'T3', title: 'diag', files: ['b.ts'], depends_on: ['T1', 'T9'], instructions: 'x', acceptance: 'y' }, // shares b.ts; T9 dangling
  { id: 'T4', title: 'cycle', files: ['c.ts'], depends_on: ['T5'], instructions: 'x', acceptance: 'y' },
  { id: 'T5', title: 'cycle', files: ['d.ts'], depends_on: ['T4'], instructions: 'x', acceptance: 'y' },
]

async function run({ fit = 'reported', rejectOnce = [], dieBuild = [], alwaysReject = [], findings = () => [], summary = 'summary text' } = {}) {
  const calls = []
  const seen = {}
  const waves = []
  const agent = async (prompt, o = {}) => {
    const label = o.label || ''
    calls.push({ label, model: o.model })
    if (label.startsWith('diagnose')) return { method: 'm', findings: 'f', evidence: [], candidates: [], ruled_out: [], open_questions: [], confidence: 'high', decision_required: null }
    if (label === 'spec') return { spec_path: 's.md', root_cause: 'r', shared_seam: 'h', mechanism_explains_reported_data: true, out_of_scope: [], docs_impact: 'none' }
    if (label === 'plan') return { plan_path: 'p.md', tasks: TASKS }
    if (label === 'symptom check') return { options: [], verdict: fit, reason: 'r' }
    const id = label.split(' ')[1]
    if (label.startsWith('build')) return dieBuild.includes(id) ? null : { commits: ['sha-' + id], files_changed: [], commands_run: [], deviations: [] }
    if (label.startsWith('repair')) return { commits: ['fix-' + id], files_changed: [], commands_run: [], deviations: [] }
    if (label.startsWith('verify') && label !== 'verify docs') {
      seen[id] = (seen[id] || 0) + 1
      const pass = !alwaysReject.includes(id) && !(rejectOnce.includes(id) && seen[id] === 1)
      return { passed: pass, checks: [], unfinished_work: pass ? '' : 'fix ' + id, code_defect: !pass, summary: '', non_blocking_findings: findings(id, seen[id]) }
    }
    if (label === 'completeness') return { missing: [], detail: '' }
    if (label === 'gates') return { all_green: true, gates: [], failures_fixed: [], remaining_failures: [] }
    if (label === 'docs') return { docs_impact: 'none', justification: 'internal', files: [] }
    if (label === 'summary') return summary
    throw new Error('unexpected label ' + label)
  }
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)))
  const log = (m) => { if (m.startsWith('Wave:')) waves.push(m) }
  const budget = { total: null, spent: () => 0, remaining: () => Infinity }
  const args = { issue: { id: '1', title: 't' }, size: 'medium', tiers: { build: { model: 'mid' }, repair: { model: 'top' } }, maxParallel: 4 }
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
  assert.deepEqual(t1.commits, ['sha-T1', 'fix-T1'])
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
  const { res } = await run({ findings: f, summary: 'S'.repeat(300000) })
  const size = JSON.stringify(res).length
  assert.ok(size <= 20000, `return is ${size} chars`)
  assert.equal(res.return_chars, size)
  assert.ok(res.clipped)
  assert.ok(res.findings.defect.length > 0, 'defects are kept when the rest is dropped')
  assert.equal(res.findings.bookkeeping.length, 0)
  assert.ok(res.findings_omitted.bookkeeping > 0)
  assert.ok(res.paths.journal && res.paths.spec && res.paths.plan)
  assert.ok(!('diagnoses' in res) && !('build' in res.tasks[0]), 'stage outputs stay in the journal')
  assert.ok(Array.isArray(res.commits) && res.commits.includes('sha-T1'))
  // the happy path is small without any clipping
  const { res: small } = await run()
  assert.ok(!small.clipped && JSON.stringify(small).length < 5000)
}
console.log('workflow template: all dry-run checks passed')
