// Dry-run templates/workflow.js against mocked agents: exercises the wave scheduler,
// the repair loop, dead-agent handling and the symptom check. Run: node scripts/test-workflow.mjs
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

async function run({ fit = 'reported', rejectOnce = [], dieBuild = [], alwaysReject = [] } = {}) {
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
      return { passed: pass, checks: [], unfinished_work: pass ? '' : 'fix ' + id, code_defect: !pass, summary: '' }
    }
    if (label === 'completeness') return { missing: [], detail: '' }
    if (label === 'gates') return { all_green: true, gates: [], failures_fixed: [], remaining_failures: [] }
    if (label === 'docs') return { docs_impact: 'none', justification: 'internal', files: [] }
    if (label === 'summary') return 'summary text'
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
console.log('workflow template: all dry-run checks passed')
