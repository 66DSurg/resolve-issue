# Design principles: UX, data integrity, product judgment

These are the general lessons that apply when an issue changes what users see, what data the system keeps, or what gets built at all. Spec agents read this file when the issue touches UI or user data. Verifiers use it as a rubric.

## Contents

1. Errors and failure states
2. Controls and visual consistency
3. Layout, copy and flows
4. Data and charts shown to users
5. Data integrity
6. Product judgment

---

## 1. Errors and failure states

- **Errors in normal use are instability.** Remove their root causes. Never hide, swallow or restyle them [UX-1]. List every error surface and classify each one as a reachable bug, recoverable but mishandled, or genuinely exceptional. Fix the first two kinds and keep the third. Verification rejects paper-overs.
- **Never let an error message lie.** Show "couldn't reach the server" only for a real network failure [UX-2].
- **Change WHEN an alarm is raised separately from WHETHER an unsafe action is blocked.** Transient errors still fail closed, but they must not trip sticky global states, and sticky flags need a self-heal path [UX-3].
- **Never leave the UI blank.** After any action, a section renders exactly one visible outcome: results, an explicit "none", or a readable error. Contain failures to the failing section, and test each state [UX-4].
- **Never let a blocking state be a dead end** [UX-5]. Use a global overlay on every route with a quiet fallback (for example, a cancelled biometric falls through to the password field with no red error) and escape hatches. Decide explicitly which state wins when two apply.

## 2. Controls and visual consistency

- **One shared component per control** (search, select, toggle, filter, sheet, button, chip) [UX-6]. New pages reuse it, missing primitives are added to the library, and primitives accept no arbitrary styling hooks (callers size the container). Back it with a guard [TG-24] and tell build agents about it.
- **One canonical asset for brand marks** across every surface, plus a hosted raster copy for email [UX-7]. **Inline the brand tokens in server-rendered pages**, which do not receive the app's CSS variables [UX-8].
- **Treat visual regressions as urgently as functional ones**, and check every page that shares the pattern [UX-9].
- **Touch targets are at least 44 px, input text is 16 px on phones**, and errors are communicated in words rather than only as red fields [UX-10].
- **Use colour for hierarchy, not provenance**: one accent for focus, grey for context, a single action colour once per screen, and shape for direction [UX-22].

## 3. Layout, copy and flows

- **Key facts of a view page sit above the fold at phone width.** Edit-only controls appear only in edit mode, settings go in a menu, and explanations go in docs [UX-11].
- **In dense lists, hide chips whose value is the default**, so a chip means "this row is unusual" [UX-12].
- **Never show schema names or raw IDs.** Map them through a label dictionary, with domain-native abbreviations as the exception [UX-13]. **Show records by what users remember**, such as a name, not a system ID [UX-25].
- **One canonical term per user-facing concept**, preferably one users know from familiar apps. Never mix synonyms, and keep developer words like "LLM" out of copy [UX-14]. **After an architecture change, clean up the old user-facing words and flows** [UX-28].
- **Text the user wrote is sacred.** Store it verbatim. Extraction reads it but never edits or consumes it, and any enrichment is visible [UX-15]. **An input that adds content (dictation, paste, "add more") appends and never replaces** [UX-33].
- **Show long human names in a short form where space is tight**, and do not assume one naming culture [UX-34].
- **Deliver the app's own events as in-app notices**, not browser or OS notifications, unless the user opted in [UX-35].
- **Ask clarifying questions inline, where the user already is**, and multiply the friction by real daily volume before accepting a flow [UX-16]. **Auto-resolve obvious matches and ask only about genuine conflicts** [UX-31].
- **Keep signup minimal** and never collect a fact another flow already owns, enforced by a check [UX-17].
- **Ask users only for values they can read off the source**, in a partial pre-filled form. Never block on derived values, and always offer "import as-is" [UX-18].
- **Make everyday authentication as low-friction as a banking app**, and do not re-propose designs the owner has rejected [UX-26]. **If two technically different operations look identical to users, consider merging them**, and research the simplest proven pattern first [UX-27].
- **Let users see that automated output is accurate** before any downstream magic runs [UX-29].
- **Say plainly when an action is a no-op**, relabel the button to match, and drop ambiguous metrics such as "today" [UX-30].
- **End every user email with a support contact and a docs link** [UX-32].
- **Radical simplicity.** Pare down rather than add complexity to feel important. Design for lasting value, not onboarding bait, and prefer one meaningful gate over many small ones [UX-24]. The test is: "Can a tired user at 9 PM still do this?"

## 4. Data and charts shown to users

- **Never fold two independent dimensions** (for example trustworthiness and completeness) into one indicator [UX-19].
- **Never render empty or degenerate charts.** Gate each one on data presence, a minimum number of categories, and fit with the user's context [UX-20].
- **Pair every insight with a concrete next action**, chosen deterministically from a catalogue keyed to metric and trend. A model may phrase the action but never invent its numbers [UX-21].
- **Do not rank users by volume or build leaderboards.** Lead with each user's own trend, and show peers only as soft bands [UX-23].
- **Missing is never zero** [DI-7]. Compute every rate only over the records that have the value. Fill from a labelled estimate ladder or exclude the record. Hide the metric if nothing qualifies, always show coverage ("N of M"), and keep estimates out of precise comparisons.
- **Detect partial periods (e.g. 9 of 12 months) and label them on every display** [DI-15].
- **Never sum across currencies.** Compare currency-free ratios [DI-20].
- **Label every benchmark with its provenance** (sourced, estimated, observed) and upgrade it as better data arrives [DI-21].

## 5. Data integrity

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
- **Prefer a crowdsourced canonical list with a pending-review state** over seeding from a low-quality public dataset [DI-22].

Caches and writes:
- **Caches are evictable.** Reconcile down to the authoritative set only on a full sync (never on a partial page, offline, or by dropping pending writes), and a delete at the source also deletes from the cache [DI-11].
- **One write path.** Write to the authoritative server first, then update the cache on success [DI-12].

Schema and deletion:
- **Soft deletes leave orphans that block hard deletes.** A real reset walks the live FK graph children-first in one routine [DI-23].
- **Before deciding whether to re-apply something, check for divergence between a fresh CI environment and long-lived production.** "Skip if unchanged" can be right in CI and wrong in production [DI-24].
- **Migrations that auto-run on production are additive only** (create, add column, create-or-replace). Verifiers grep for drop, truncate and delete [DI-25].

## 6. Product judgment

Use these when the issue is a feature request, or when it is tempting to widen scope.

- **Prove the core with real users before building out.** Build the thinnest complete loop (every stage working, no stubs), add detail later, and flag work that delays real-user feedback [PJ-1].
- **While waiting for feedback, watch, respond and polish the known small things.** Park new ideas as issues, and hold big builds until real demand appears [PJ-2].
- **If even the builder forgets to use the product, the friction is structural** (wrong moment, deferred value), not motivational. Deliver value from data that already exists before asking for a new habit [PJ-3].
- **Sequence hard prerequisites first** [PJ-4].
- **Do not build billing or entitlements before you need to charge** [PJ-5].
- **Keep the engine universal and put domain vocabulary in overlay files** [PJ-6].
- **Close the loop on AI quality** by capturing de-identified correction deltas (input, output, the user's correction) and reviewing recurring misses by category [PJ-7].
- **When a design bets on a risky dependency**, document the fallback, name the telemetry thresholds that trigger it, and validate on the real target device first [PJ-8].
- **Give a solo operator a minimal health view from day one.** Reuse existing alerting, and add detail only once real use shows what hurts [PJ-9].
