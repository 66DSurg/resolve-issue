# Project profile

The profile, `.claude/resolve-issue.yml` in the target repo, is how one portable skill fits any project. It names the real commands, ports, docs locations, labels, trailers and laws. Every stage reads it, and the orchestrator passes it into the run as args, because workflow scripts cannot read files [OR-6]. Commit it to the repo so every session and every collaborator gets the same behaviour.

A full annotated example is in `templates/profile.example.yml`.

## First run: discovery

When the profile is missing, discover it before the first issue. Do this inline. It takes a few minutes, and it saves every later run from guessing.

1. **Identify the repo.** Run `git remote -v`, `git rev-parse --show-toplevel` and `git symbolic-ref refs/remotes/origin/HEAD`. If the repo is nested inside another repo, record that, and never inherit the parent's settings [PF-2].
2. **Find the commands.** Read the existing agent-context files (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`), `package.json` scripts, `Makefile`, `justfile`, `pyproject.toml`, `Cargo.toml`, the CI workflow files and `scripts/`. The CI files are the most trustworthy source, because they are what actually gates. Record install, typecheck, lint, unit, e2e, build and doc checks, per package for monorepos.
3. **Prove each command.** Run each one once (except e2e if it needs shared resources), and record its runtime and its current failing set. That failing set becomes `known_flaky` only after the human confirms it [TG-8]. A command that does not run is recorded as `broken: <first error line>`, never silently dropped.
4. **Find the ports.** Find the developer's default dev ports (framework configs, `.env*.example`, proxy configs). They go in `ports.reserved`. Pick a spare range for agents [IS-3].
5. **Find the env and secrets.** Find the gitignored files and directories a fresh worktree needs (`.env`, `secrets/`, local certs). They go in `env.link`, to be linked and never copied [IS-2].
6. **Find the docs.** Look for the changelog and its Unreleased heading, VERSION, user docs, developer docs, the ADR directory, the glossary, the docs index, and doc-check scripts [DC-9].
7. **Find the tracker.** Find the issue host, the label strings for each canonical role [OR-25], and how issues are closed (`Closes #N`, or a production-gated trailer) [GR-10].
8. **Find the commit conventions.** Read `git log -50 --format='%s%n%b'` for the subject format and trailers. Ask the human which trailers agents must add [GR-4].
9. **Find the laws.** Look for existing guard tests, lint rules and "never" statements in the agent-context files, and turn them into numbered laws [SP-14].
10. **Check the safety floor.** Check whether a hook blocks destructive git. If none does, recommend one to the human, but do not install it without a yes [HG-5].
11. **Write the profile, show the human a summary, and ask only about the gaps** that change behaviour [PF-3]. Usually that means the trailers, the concurrency cap and `spec_dir`.

Keep the profile consistent with the repo's instruction files and the current permissions. A stale rule in either blocks approved actions [HG-4].

## Schema

```yaml
version: 1
project: <name>
repo:
  remote: <owner/repo>          # verified with git remote -v
  main_branch: main
  nested_in_parent: false
commands:                        # each proven to run; per-package keys allowed
  install: <cmd>
  codegen: <cmd or null>
  typecheck: <cmd>
  lint: <cmd>
  unit: <cmd>
  e2e: <cmd>
  e2e_isolated: <cmd or null>    # takes spare ports; see references/isolation.md
  build: <cmd>
  docs_checks: [<cmd>, ...]
known_flaky: [<spec id>, ...]    # the SET; a new failure outside it blocks
ports:
  reserved: [<dev ports agents must never use>]
  agent_range: [<from>, <to>]
env:
  link: [<gitignored paths to symlink into each worktree>]
  source: <env file the tests need, or null>
worktrees_dir: <path outside the main checkout>
branch_prefix: fix/
spec_dir: docs/issues            # 'none' → a scratch directory
docs:
  changelog: CHANGELOG.md
  unreleased_heading: "## Unreleased"
  version_file: VERSION
  user_docs: [<paths>]
  dev_docs: [<paths>]
  adr_dir: <path or null>
  glossary: <path or null>
  index: <path that must link new specs/ADRs>
issues:
  tracker: github
  close_trailer: "Closes #{n}"   # or "Ships: #{n}" when the main line ≠ production
labels:                          # canonical role → this repo's label string
  needs-triage: triage-pending
  ready: ready
  in-progress: in-progress
  blocked: blocked
  keep-open: keep-open
git:
  subject: "<summary> (#{n})"
  trailers: ["Co-Authored-By: <agent identity>"]
  never_stage: [<known stray untracked paths>]
tiers:                           # see references/cost.md
  diagnose: {model: <strongest>, effort: high}
  spec: {model: null, effort: high}
  plan: {model: null, effort: high}
  build: {model: <mid>, effort: medium}
  verify: {model: null, effort: high}
  repair: {model: null, effort: high}   # one tier above build
  gates: {model: <mid>, effort: medium}
  docs: {model: <mid>, effort: medium}
  _excluded: [<tiers that failed the obey probe>]
budget:
  max_concurrent_runs: 3
  max_parallel_builders: 4
  e2e_in_worktree: false         # true only if it needs no shared resources
ranker:
  cmd: <command reading JSON on stdin, or null for a fresh-subagent ranking>
laws:                            # project NON-NEGOTIABLES, numbered for verifiers
  - "Migrations that auto-run on production are additive only."
privacy:
  identifier_patterns: [<regexes for this domain's identifiers>]
human:
  tests_on: staging              # where the human dogfoods [CM-4]
  remote_access: <tunnel cmd or null> # [CM-5]
```
