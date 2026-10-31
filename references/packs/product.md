# Pack: Product judgment

**Switch on when** the issue is a feature request, a scope question ("should we build this?"), or a docs or video change for users. Turn it on with `packs: [product]` in the profile, or let a diagnosis that meets this trigger turn it on for one run.

These rules are one product's taste, generalised. They are a sound default, not a law: where the project's own design system, ADRs or glossary say otherwise, those win. They came from a solo builder proving a product with early users.

## Rules

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
- **Tutorial videos** are only for non-obvious or blocking features. Record them after ship, re-render them when the flow changes, and keep their IDs in one manifest [DC-15].

## Lessons: Product judgment (PJ)

Ids are the core catalogue's and never change (see `references/lessons.md`).

1. **Prove the core with real users before building out. Build the thinnest complete loop (every stage working, no stubs), add detail later, and flag work that delays real-user feedback.** — Investment should follow evidence. (The operator wanted a live proof of concept first.)
2. **While waiting for feedback, watch, respond and fill gaps with known low-risk polish. Park new ideas as issues, and hold big builds until real demand appears.** — Building for zero users is building ahead of demand. (One user's silence nearly triggered a major feature.)
3. **If even the builder forgets to use the product, treat the friction as structural (wrong moment, deferred value), not motivational. Deliver value from data that already exists before asking for a new habit.** — Reminders paper over structural friction. (Only users whose data was imported for them stayed.)
4. **Sequence hard prerequisites first.** — You cannot build the receiving end of a loop before its source exists. (Bug-flow tooling waited for production.)
5. **Do not build billing or entitlements before you need to charge. Lock the decision and build it later.** — It is premature work. (Billing was kept out of the launch slice.)
6. **Keep the engine universal and put domain-specific vocabulary in overlay files.** — Do not over-tune for the one active domain. (Matching vocabulary was specific to one specialty.)
7. **Close the loop on AI quality by capturing de-identified correction deltas (input, output, the user's correction) and reviewing recurring misses by category.** — Refine from real corrections, not guesses. (Prompt refinement is driven by corrections.)
8. **When a design bets on a risky dependency, document the fallback, name the telemetry thresholds that trigger it, and validate on the real target device first.** — Risky bets need exits. (An on-device speech model shipped with a documented fallback.)
9. **Give a solo operator a minimal health view from day one. Reuse existing alerting services, and add detail only once real use shows what hurts.** — One person cannot watch a terminal. (Detailed monitoring was deferred until real use showed the need.)

## Lessons: Docs (DC)

Ids are the core catalogue's and never change (see `references/lessons.md`).

15. **Make tutorial videos only for non-obvious or blocking features, record feature videos after the feature ships, re-render them when a release changes the flow, and keep media IDs in one manifest.** — Videos go stale fast. (Several walkthroughs went out of date after one release.)
