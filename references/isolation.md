# Isolation and environment

A shared checkout gets mangled, a stray server hijacks the next run, and a missing env file looks exactly like a code bug. Every run therefore gets its own worktree, branch, ports and URLs, links the real secrets, and leaves nothing behind [IS-1, IS-2, IS-3].

## Contents

1. Worktree setup
2. Ports and servers
3. Isolated e2e runner
4. Shared resources
5. Cleanup report
6. Environment parity

---

## 1. Worktree setup

```bash
# from the main checkout
git fetch origin
git worktree add -b "<branch_prefix><issue>-<slug>" "<worktrees_dir>/<issue>-<slug>" "origin/<main_branch>"
cd "<worktree>"
<install cmd>                 # e.g. bun install / npm ci / uv sync
<codegen/sync cmd, if any>    # e.g. framework sync, prisma generate
# link, never copy, never fake:
for p in <profile.env.link>; do ln -s "<main_checkout>/$p" "$p"; done
```

- **Build in a dedicated worktree on its own branch, outside the main checkout** [IS-1]. Every shell command starts with `cd "<worktree>"`, every agent uses its absolute path, and other active worktrees are named as off-limits in the preamble [OR-13]. One 78-minute run broke when a concurrent terminal moved the main checkout's HEAD underneath it.
- **Prepare the worktree fully** [IS-2]. Install dependencies, run any codegen or sync step, link the real gitignored secrets, and source the main checkout's env file. Never create dummy secrets. A dummy secrets folder once failed 22 specs, and the exit-127 "command not found" errors came from a skipped install.
- **Never copy secrets.** Link them, and read them from the file straight into the command's environment [PS-16].
- **Throwaway worktrees (negative controls, bisects) install their own dependencies** with a real frozen-lockfile install. Never symlink dependency directories from another checkout. Link only the env and secrets [IS-16]. Symlinked dependencies resolve modules from the other checkout and break module mocks, so the control fails for the wrong reason.

## 2. Ports and servers

- **The developer's default dev ports are theirs.** Agents use assigned spare ports with strict-port flags [IS-3].
- **Check what owns a port before e2e** with `lsof -nP -iTCP:<port> -sTCP:LISTEN`. Kill only stray processes whose cwd is a finished worktree, never the human's server [IS-3]. A verifier once rejected a task four times because a stray server was running code 111 commits behind.
- **Point every URL the tests generate at THIS run's port** [IS-5]. That includes the sign-in helper, the magic-link and redirect base, the app origin, and the WebAuthn origin and RP id. One forgotten default sends the tests through someone else's server.
- **Kill every server you started** before finishing [IS-3].

## 3. Isolated e2e runner

Use this pattern when the project has no isolated runner (write `profile.commands.e2e_isolated` once it does) [IS-4]:

1. Write a TEMPORARY config that rewrites the proxy target and the test base URL to the spare ports, and drops the runner's own webServer block.
2. **Mirror the env that the webServer block used to inject** [IS-6]: test admin accounts, the insecure-cookie flag for http, local object storage.
3. Start the backend and frontend on the spare ports. Wait for both health checks with a timeout.
4. Run the suite. Save the full log (see `references/tests-and-gates.md`).
5. ALWAYS (in a `trap`) restore the patched files, delete the temporary config, and kill the pids and listeners.
6. **If the servers do not come up, abort loudly with the log tail and still clean up** [IS-7].

```bash
cleanup() { kill $BE_PID $FE_PID 2>/dev/null; git checkout -- <patched files>; rm -f "$TMP_CFG"; }
trap cleanup EXIT
```

## 4. Shared resources

- **Stop background workers that share the test database**, or give the tests their own DB and queue [IS-9]. A dev worker holding a real key once grabbed e2e jobs, billed the API and failed the tests.
- **When a missing optional service config fails many specs at once, check the environment first** [IS-10]. It is usually a false alarm about the code.
- **Worktrees sharing one local DB can show false migrate failures.** Judge migrations on a clean database applied in order [IS-11].
- **Do not run a test suite while another agent rebuilds the same frontend** [IS-12].
- **Keep large media and content production out of the product repo**, so clones, CI, worktrees and agents stay fast [IS-13].

## 5. Cleanup report

End every isolated run with this report [IS-8]:

```
listeners on <spare ports>: 0
default dev ports: untouched (owner pids unchanged)
git status --porcelain (tracked): clean
temp configs removed: yes
```

Cleanup you have not proved keeps leaking. Leaked servers kept recurring until this report existed.

## 6. Environment parity

- **Pin the CI runtime version to exactly what the hosts run**, and bump the two together [IS-14].
- **Make sure the test environment has the real capabilities the feature needs**: codecs, fonts, hardware APIs [IS-15]. Bundled test browsers may lack them. One bundled Linux browser had no H.264 encoder.
