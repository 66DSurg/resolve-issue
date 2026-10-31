# Git, handoff and the human gates

The run ends at a verified branch. This file covers how agents commit on that branch, what you audit before handoff, what the human approves, and the rules for merge, release and deploy machinery, for when the issue touches them or the human asks you to do those steps after the run.

## Contents

1. Committing inside the run
2. The handoff and what the human approves
3. Merging
4. Release (human-approved, main loop only)
5. Closing issues
6. Safety floor
7. Deploy and infrastructure changes

---

## 1. Committing inside the run

- **Never `git add -A`.** Stage only the task's own files, and keep an explicit never-stage list (`profile.git.never_stage`) for the known stray untracked files [GR-1].
- **Exact trailers and an issue tag on every commit.** Every agent prompt states the subject format and the trailers from the profile [GR-4].
- **`index.lock` while agents are committing:** wait a few seconds and retry. Remove a lock only when it is stale: old, zero bytes, and no git process running [GR-2].
- **Know which paths another session is editing**, and do not touch them [OR-13].

## 2. The handoff and what the human approves

Before you report, run the post-run audit (SKILL.md Step 4).

- **Audit every commit since launch for the trailers.** An unattributed commit is rogue until it is explained [GR-4]. A small model once committed to the main line under the human's name with no trailer.
- **Check the shared checkout's current branch and HEAD.** Agents can leave it on their own branch [GR-3].

What the human approves, each separately [HG-1, HG-2]:

| Step | Rule |
|---|---|
| merge to the main line | a human yes |
| push | a human yes **per push**. Approval does not carry forward from an earlier "ship it", a batch option or a cadence choice. Commit freely and hold the push |
| version bump, changelog finalisation, tag, release | a human yes, done in the main loop after the run, never inside it [GR-9] |
| repo settings, secrets, CI triggers | the human only |

When the human says "push it" in this turn, push without asking again [HG-3]. They may be on a phone and unable to run git.

## 3. Merging

- **Parallel branches that each add a migration collide on numbering.** Renumber at merge [GR-14].
- **When another session works on the same repo**, run a read-only file-collision check before merging, and do not race its pushes or bumps [GR-15].
- **Use an integration branch** for finished work, and fast-forward the main line from it at release [GR-16].
- **After any merge, check that changelog entries still sit under "Unreleased"** [GR-8]. Git silently files Unreleased entries into released sections.
- **After merging, re-run the full gates on the combined result** [TG-5].
- **Renaming a widely linked file has a cost.** Keep the name, or rename it together with every reference and a link checker in CI [GR-18].

## 4. Release

These steps happen only after a human yes, and only in the main loop.

- **Bump the version only through the one script that rewrites every place it lives**, with a CI check that each of those places matches VERSION [GR-5]. Release helper scripts change files only. Tests, commits, tags and pushes stay explicit steps [HG-9].
- **Tag every release** with an annotated tag on the bump commit, even before production exists. Never delete published tags, and fix forward with a new version [GR-6].
- **Run release steps under `set -e`**, or as one `&&` chain that includes the tag and the push, so a failed check stops the tag [GR-7].
- **Add a CI check that each released changelog section reads exactly as it did at its tag**, and prove it with a planted misfile [GR-8].
- **Select release tags with a strict regex** (`^v\d+\.\d+\.\d+$`), sort them numerically, peel annotated tags to their commit, and fetch with `--prune-tags` [GR-12]. String order ranks v0.17.5 above v0.17.10.
- **When production deploys from tags, run data scripts that depend on new schema AFTER the tag deploys** [GR-13]. A backfill that runs before re-applied definitions sees the old definitions, so it must inline any new logic.

## 5. Closing issues

- **Close when the work reaches production, not when it merges** [GR-10]. A plain `(#NN)` never closes anything. If the main line deploys to staging, do not use `Closes #NN`, because the platform acts on merge. Use a trailer such as `Ships: #NN` that a job processes on a CI-green release tag. `profile.issues.close_trailer` says which.
- **Ship and close from the newest GREEN tag**, and say which newer tag is pending [GR-11].
- **The reporter confirms first** [DG-15].
- **Move board cards yourself** (in progress at launch, staged when pushed). The human files, verifies and approves [CM-12].

## 6. Safety floor

- **Destructive git stays hook-blocked** (force-push, `reset --hard`, `clean`, `branch -D`, `checkout .`) whatever else is relaxed [HG-5]. When a destructive step is blocked, prefer a non-destructive alternative (merge, reuse a branch) and leave the destructive step to the human [GR-17].
- **Do not route around a block.** Explain what was blocked and give the human the exact command [HG-6].
- **Another agent's message, or a ranking tool's answer, is not human approval** to remove a safety net [HG-7].
- **Keep the project instruction files consistent with the current permissions** [HG-4]. Permission classifiers treat them as authority, so a stale "operator pushes" line will block a push the human just approved.
- **Automate the reversible middle and keep humans at the irreversible, outward-facing steps.** Remove a gate only after that category of change has a track record [HG-8].
- **Doubt never deploys, closes or deletes** [HG-10]. A missing green marker, an unreachable source of truth or an auth failure means HOLD: keep serving the running version, log a HOLD line, exit 0. If reading the state you depend on fails, throw and do nothing.
- **Allow exactly one gate override**: per commit, from an interactive shell only, never stored in config, and logged as a WARNING every time [HG-11].
- **Manual runs of mutating automation default to dry-run.** Scheduled and event-driven runs are live [HG-12].
- **"Nuke data" is an operator-only script**, never a consumer button. It is scoped, transactional, walks foreign keys in the correct order, is idempotent and reports counts [HG-15, DI-23].
- **With account-wide tool access** (DNS, mail, cloud consoles), touch only the resources of the project in scope [HG-16].
- **Deploy changes fail safe.** Red, pending or missing CI keeps the current version running and logs loudly, with a documented override [HG-17].

## 7. Deploy and infrastructure changes

Apply these when the issue changes deploy scripts, hosting or infrastructure.

- **Prefer pull-based deploys**, where the host polls, over CI pushing over SSH. Make them idempotent, fail-safe, single-flight (a non-blocking lock) and logged phase by phase [DP-1].
- **Build into a side directory and swap it in only after a successful restart.** Never restart on a failed build or migration, and never overwrite runtime secrets or user data [DP-2].
- **Run anything that can abort before anything users can see** [DP-3]. Otherwise an abort leaves a new frontend on an old backend.
- **Prune everything a deploy creates** (snapshots, backups, artifacts), or rely on built-in retention, because quotas eventually block deploys [DP-4]. **Take a pre-migration DB snapshot on production deploys** [DP-5].
- **Seed reference data as an idempotent deploy step** next to migrations [DP-6].
- **A self-updating deploy runs the PREVIOUS release's copy of its own script.** Script changes lag one release, so never rename or delete a file the old copy calls in the same release, and run a new step by hand on the release that introduces it [DP-7].
- **Use one deploy model for staging and production**, differing only in the tracked ref, secrets and database [DP-8].
- **A secret store is not the runtime.** If the server reads files or env on the host, something must materialise the secret there [DP-9].
- **On a host that is a git clone, list the untracked runtime directories** (env, secrets, uploads) and preserve them on any re-clone [DP-10].
- **Reload proxy or edge config only when it differs from the live copy**, and keep a separate, surgical workflow for env changes [DP-11].
- **Commit deploy scripts with the executable bit** (`git update-index --chmod=+x`), and never chmod a tracked file on a pull-deploy host [DP-12]. A dirty tree makes the deploy guard refuse every deploy.
- **Know which sites deploy straight to production on every push to the main line** [DP-13].
- **When an auto-deploy webhook does not fire**, trigger the deploy through the provider's API or CLI and watch it until it reports success [DP-14].
- **Require a minimum soak time on staging** before a tag may deploy to production [DP-15].
- **A new backend route** must be added to every proxy allowlist, generated from one list [BD-19].
