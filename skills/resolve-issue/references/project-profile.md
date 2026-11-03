# Project profile

The profile, `.claude/resolve-issue.yml` in the target repo, is how one portable skill fits any project. It names the real commands, ports, docs locations, labels, trailers and laws. Every stage reads it, and the orchestrator passes it into the run as args, because workflow scripts cannot read files [OR-6]. Commit it to the repo so every session and every collaborator gets the same behaviour.

The profile lists **overrides only**. Every key has a default (below), and a key written down is a key that can go stale [HG-4]. `templates/profile.example.yml` shows a typical short profile, with the full key reference commented out underneath.

## First run: discovery

When the profile is missing, discover it before the first issue. Do this inline. It takes a few minutes, and it saves every later run from guessing.

0. **Read the repo's agent docs first.** If `docs/agents/*.md` exists (an issue-tracker, triage-labels or domain doc), read the tracker, the label strings and the glossary and ADR layout from there. Store only a pointer (`agent_docs: docs/agents/`) and the values those files do not cover. Two copies of the same mapping drift.
1. **Identify the repo.** Run `git remote -v`, `git rev-parse --show-toplevel` and `git symbolic-ref refs/remotes/origin/HEAD`. If the repo is nested inside another repo, record that, and never inherit the parent's settings [PF-2].
2. **Find the commands.** Read the existing agent-context files (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`), `package.json` scripts, `Makefile`, `justfile`, `pyproject.toml`, `Cargo.toml`, the CI workflow files and `scripts/`. The CI files are the most trustworthy source, because they are what actually gates. Record install, typecheck, lint, unit, e2e, build and doc checks, per package for monorepos. Exclude checks that only run in a PR or CI context, such as a docs check that reads the PR's description or changed-file list. Record them as `ci_only`, never in the gate list [TG-34].
3. **Prove each command.** Run each one once (except e2e if it needs shared resources), and record its runtime and its current failing set. That failing set becomes `known_flaky` only after the human confirms it [TG-8]. A command that does not run is recorded as `broken: <first error line>`, never silently dropped.
4. **Find the ports.** Find the developer's default dev ports (framework configs, `.env*.example`, proxy configs). They go in `ports.reserved`. Pick a spare range for agents [IS-3].
5. **Find the env and secrets.** Find the gitignored files and directories a fresh worktree needs (`.env`, `secrets/`, local certs). They go in `env.link`, to be linked and never copied [IS-2]. Find the codegen or sync step a fresh install needs before tests load (framework sync, ORM generate) and record it as `commands.post_install` [IS-16].
5b. **Find the shared state.** If worktrees share one dev database and the tests apply database functions or migrations, set `env.shared_db: true` [IS-17]. Grep the test runner and its scripts for fixed log files, temp dirs and sockets, and list them in `env.fixed_paths` [IS-18].
6. **Find the docs.** Look for the changelog and its Unreleased heading, VERSION, user docs, developer docs, the ADR directory, the glossary, the docs index, doc-check scripts, and any design system or style guide (`docs.design`, read by the VIEW lens) [DC-9].
7. **Find the tracker.** Find the issue host, the label strings for each canonical role [OR-25], and how issues are closed (`Closes #N`, or a production-gated trailer) [GR-10]. The roles are the `triage` skill's five, `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human` and `wontfix`, plus `in-progress` and `keep-open`. Record only the ones whose label string differs from the role name.
8. **Find the commit conventions.** Read `git log -50 --format='%s%n%b'` for the subject format and trailers. Ask the human which trailers agents must add [GR-4].
9. **Find the laws.** Look for existing guard tests, lint rules and "never" statements in the agent-context files, and turn them into numbered laws [SP-14].
10. **Check the safety floor.** Check whether a hook blocks destructive git. If none does, recommend one to the human (the `git-guardrails-claude-code` skill sets one up), but do not install it without a yes [HG-5]. The laws stay in every prompt either way, for harnesses with no hooks.
10b. **Set up the lean worker** (below): check that `resolve-worker` resolves, offer to install it, and copy every memory rule a worker must obey (no identifiers in issues, never push, port and allowlist gotchas) into `laws` [CO-9]. Recommend agent-quiet test reporters in `commands.*`.
11. **Write only the values that differ from the defaults**, show the human a summary, and ask only about the gaps that change behaviour [PF-3]. Usually that means the trailers, the concurrency cap and `spec_dir`.

Keep the profile consistent with the repo's instruction files and the current permissions. A stale rule in either blocks approved actions [HG-4].

## Defaults

The main loop merges the profile over these before passing it to a run. Leave a key out of the profile when its default is right.

```yaml
repo:
  main_branch: <from git symbolic-ref refs/remotes/origin/HEAD>
  nested_in_parent: false
worktrees_dir: ../<repo name>-worktrees
branch_prefix: fix/
spec_dir: docs/issues            # → <spec_dir>/<date>-<slug>/spec.md and plan.md
small_spec_file: false           # small issues put the spec in the root-fix commit body
packs: []                        # domain packs always on; see references/packs/
docs:
  changelog: CHANGELOG.md
  unreleased_heading: "## Unreleased"
  version_file: VERSION
  design: []                     # design docs the VIEW lens judges screenshots against (with the ux pack)
issues:
  tracker: github
  close_trailer: "Closes #{n}"   # use "Ships: #{n}" when the main line is not production
  auto_file: true                # the main loop files the run's side-issue drafts after the audit [OR-27]
labels: {}                       # role → label string; a missing role uses its own name. side_issue: <label> tags every filed side issue (e.g. found-by-run) [OR-29]
git:
  subject: "<summary> (#{n})"
tiers:                           # references/cost.md
  diagnose: {model: <strongest>, effort: high}
  spec: {model: null, effort: high}
  plan: {model: null, effort: high}
  build: {model: <mid>, effort: medium}
  decide: {model: null, effort: high}   # judgment work: never stepped down
  verify: {model: null, effort: high}
  repair: {model: null, effort: high}   # one tier above build
  gates: {model: <mid>, effort: medium}
  docs: {model: <mid>, effort: medium}
  harvest: {model: <mid>, effort: medium}   # the VIEW agent uses the verify tier
  completeness: {effort: medium} # model from verify [CO-9]
  docs_verify: {effort: medium}  # model from verify
  view_capture: {}               # view.split only; defaults to the build tier
  # any tier may set agent_type: null to run that stage as the default workflow agent
agent_type: resolve-worker       # lean worker agent type; null = the default workflow agent [CO-9]
filter_test_output: false        # true: the opt-in hook scripts/hooks/filter-test-output.py is installed
spec_plan_merged_upto: 0         # N > 0: one spec+plan agent when every diagnosis expects N tasks or fewer
view:
  split: false                   # true: a capture agent (view_capture tier) + a judge (verify tier) that reads only the images
verify:
  delta_reverify: false          # trial; WEAKENS adversarial verification (see Token diet)
  diff_scope: false              # trial; the verifier reads only the task's diff and its callers
budget:
  max_concurrent_runs: 3
  max_parallel_builders: 4
  e2e_in_worktree: false
ranker:
  cmd: null                      # null = rank explicitly in the prompt; no ranker, no auto-decisions
decisions:                       # the run's decide step [SP-20]
  auto: true                     # false = every decision point stops for the human
  margin: 0.2                    # p_top - p_second needed for AUTO
  critical: []                   # more criteria on top of the defaults (crypto, deletion, money, legal, locked ADR, prod, weakening)
commands:
  post_install: null             # codegen/sync after install; fresh and control worktrees run it [IS-16]
env:
  shared_db: false               # true: worktrees share one dev DB; pre-flight warns on concurrent DB-function runs [IS-17]
  fixed_paths: []                # fixed log/temp paths in the test runner; runs override them [IS-18]
```

No other default exists for `commands`, `ports`, `env`, `laws` or `privacy.identifier_patterns`. Discovery finds them, and never guesses [PF-3].

## Token diet

Measured over 10 full runs (about 300 agents): about half the cost was the fixed start-up context each agent loads before it reads its task, cache reads and writes were 92% of the cost, and output only 8% [CO-9]. These defaults and switches follow from that.

**Lean worker agent.** `templates/agents/resolve-worker.md` is a custom subagent (frontmatter `name`, `description`, `tools`; no `model`, so each stage's tier decides). Its `tools` allowlist (Read, Edit, Write, Bash, Grep, Glob, StructuredOutput) drops MCP, Skill, Agent and web tools; VIEW drives the browser through Bash and Playwright, so it needs none of them. `omitClaudeMd` stays unset: CLAUDE.md carries repo rules. The workflow passes it as `agentType` on every `agent()` call.
- Install: copy it to `.claude/agents/` in the target repo (commit it) or to `~/.claude/agents/`. Project beats user. A session started before that `agents/` directory existed needs a restart.
- Fallback: when the type does not resolve, run with `agent_type: null` (the default workflow agent) and say so in the announce line. A tier's own `agent_type` overrides the profile for one stage.
- Expect about 15% of start-up to go: most of it is Claude Code's own floor. Fewer agents beat leaner ones (see `references/cost.md`).
- Auto memory still loads in custom subagents, and neither the frontmatter nor `agent()` can set a per-agent env, so `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` would turn memory off for the whole session. Put every rule a worker needs in `laws` instead, which reach every prompt.
- SubagentStart hooks receive the agent type: a style or context-injection hook should exit for `resolve-worker`. Run the session from the repo itself, with `worktrees_dir` outside any parent folder (a notes vault, say) whose CLAUDE.md workers do not need.

**Prompt cache.** Every prompt starts with the shared preamble, so agents of one run share a prefix. Workflow agents get a 5-minute cache by default, so reuse happens only between agents that start within 5 minutes of each other, mostly one wave. `subagentPromptCacheTtl: "1h"` in settings keeps it for an hour (the workflow docs name it for workflow agents; Claude Code 2.1.242 or later; 1-hour writes bill higher). It is a settings change, so the human decides; try it together with the lean worker and measure with `scripts/run-cost.py`. `ENABLE_PROMPT_CACHING_1H` has been reported not to reach subagents.

**Test output.** Fix it at the reporter, not by cutting: under `CLAUDECODE=1` (set in Claude Code shells) use vitest `--reporter=dot`, Playwright `--reporter=line`, and failures plus counts for `bun test`, in `commands.*`. Never cap test output by tail alone: a cut hides the summary line. Shortened output keeps its head and tail and names the full log.

**`filter_test_output`** (off). `scripts/hooks/filter-test-output.py` rewrites test-runner Bash commands to the failing lines plus head and tail, keeps the runner's exit code, and leaves the full log on disk. Install it in the copied agent file so it applies to workers only (a `hooks: PreToolUse` block, shown in the script's docstring; frontmatter hooks need a trusted folder). Check with `claude --debug` that it fires for workflow agents before relying on it.

| Switch | What it saves | Risk |
|---|---|---|
| `view.split` | the strong model stops spending most VIEW turns on servers and worktrees | low: the judge stays on the verify tier |
| `spec_plan_merged_upto: N` | one agent and one full re-read of the diagnoses and code | loses the separate spec checkpoint; the symptom check and decision points still run |
| `verify.delta_reverify` | re-verifies after a repair re-run only changed rows | **weakens adversarial verification**: a repair can break a passing row through a shared helper |
| `verify.diff_scope` | the verifier reads the task's diff and its callers, not the branch | misses cross-cutting code; auth, crypto, privacy, logging and flags stay exempt |

## Schema

Every key, annotated, is in the commented reference at the bottom of `templates/profile.example.yml`.
