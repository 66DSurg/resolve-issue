# Design principles: failure states and data integrity

These are the universal rules for any issue that changes what users see or what data the system keeps. Spec agents read this file when the issue touches UI or user data, and verifiers use it as a rubric. Product taste (controls, layout, copy, charts, product judgment) lives in the domain packs, `references/packs/`, which load only when switched on.

## Contents

1. Errors and failure states
2. Numbers shown to users
3. Data integrity
4. Domain packs

---

## 1. Errors and failure states

- **Errors in normal use are instability.** Remove their root causes. Never hide, swallow or restyle them [UX-1]. List every error surface and classify each one as a reachable bug, recoverable but mishandled, or genuinely exceptional. Fix the first two kinds and keep the third. Verification rejects paper-overs.
- **Never let an error message lie.** Show "couldn't reach the server" only for a real network failure [UX-2].
- **Change WHEN an alarm is raised separately from WHETHER an unsafe action is blocked.** Transient errors still fail closed, but they must not trip sticky global states, and sticky flags need a self-heal path [UX-3].
- **Never leave the UI blank.** After any action, a section renders exactly one visible outcome: results, an explicit "none", or a readable error. Contain failures to the failing section, and test each state [UX-4].

## 2. Numbers shown to users

- **Missing is never zero** [DI-7]. Compute every rate only over the records that have the value. Fill from a labelled estimate ladder or exclude the record. Hide the metric if nothing qualifies, always show coverage ("N of M"), and keep estimates out of precise comparisons.
- **Detect partial periods (e.g. 9 of 12 months) and label them on every display** [DI-15].

## 3. Data integrity

Keys and masters:
- **Normalise human-typed identifiers at both write and read** (lowercase, trim, strip leading zeros) and index the normalised form [DI-1].
- **Never regenerate a root key or identifier that existing data depends on** [DI-2]. Create it once, keep a canonical master, re-wrap rather than regenerate on a credential change, and make resets keep the primary records.
- **Never let a client push its own state over an existing master.** Probe for the master before creating anything, on every entry path, shortcut flows included [DI-3].
- **On unlock or sync, detect a local/master mismatch and force a resync.** Never silently show blanks [DI-4].
- **Recover diverged clients from the one that still holds a full plaintext cache**: export a safety copy, promote it to master, re-encrypt, and restore the others from the master [DI-5].
- **Self-heal silently on load** when the client already holds the data to fix an inconsistency. The error state then only ever means true data loss [DI-6].

Imports, dedup and reconciliation:
- **For messy real-world data, prefer completeness over strict dedup.** Use soft, review-gated detection plus import-time prevention, not hard unique constraints, and document why [DI-8].
- **Make imports idempotent on a stable key** [DI-9]. On a match, fill only the missing fields and never overwrite a populated field with a different value. Surface a conflict as a red flag for review.
- **Decide the authoritative source for each field separately** [DI-10]. Never blend sources, never auto-overwrite contested fields, and never auto-delete local records the other source lacks. Flag them instead.
- **Map imported columns by header name, never by position.** Detect where the header row really is and normalise the header text [DI-13].
- **Fingerprints are lookup hints, never trust gates.** The reconciliation maths decides [DI-14].
- **Check that default statuses match the users' real flow.** Records created from an authoritative source are born verified [DI-16].
- **Store learned artifacts as declarative recipes** applied by a small interpreter, never as generated executable code [DI-17].
- **Reconcile in both directions**, since the two directions mean opposite things. Scope reconciliation to the window the source covers, and word results as "possible", with a "review" action, never as an accusation [DI-18].
- **Dedupe reference entities too**, because duplicates poison anything keyed on them [DI-19].

Caches and writes:
- **Caches are evictable.** Reconcile down to the authoritative set only on a full sync (never on a partial page, offline, or by dropping pending writes), and a delete at the source also deletes from the cache [DI-11].
- **One write path.** Write to the authoritative server first, then update the cache on success [DI-12].

Schema and deletion:
- **Soft deletes leave orphans that block hard deletes.** A real reset walks the live FK graph children-first in one routine [DI-23].
- **Before deciding whether to re-apply something, check for divergence between a fresh CI environment and long-lived production.** "Skip if unchanged" can be right in CI and wrong in production [DI-24].
- **Migrations that auto-run on production are additive only** (create, add column, create-or-replace). Verifiers grep for drop, truncate and delete [DI-25].

## 4. Domain packs

Each pack in `references/packs/` holds one domain's rules and lessons. The first paragraph of each says when it applies. A pack is on when the profile lists it in `packs:`, or when a diagnosis meets its trigger for that run.

| Pack | Covers |
|---|---|
| `ux` | blocking states, controls, layout, copy, flows, charts |
| `product` | feature-scope judgment, tutorial videos |
| `data-import` | currencies, benchmark provenance, shared reference lists |
| `cost` | the product's own runtime model and service costs |
| `tool-quirks` | browser automation and OAuth quirks |
