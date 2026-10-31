# Pack: Imports and reported numbers

**Switch on when** the issue imports, reconciles or reports on external data: spreadsheets, money, benchmarks or shared reference lists. Turn it on with `packs: [data-import]` in the profile, or let a diagnosis that meets this trigger turn it on for one run.

The universal data-integrity invariants stay in `references/design-principles.md`. These add to them for import and reporting work.

## Rules

- **Never sum across currencies.** Compare currency-free ratios [DI-20].
- **Label every benchmark with its provenance** (sourced, estimated, observed) and upgrade it as better data arrives [DI-21].
- **Prefer a crowdsourced canonical list with a pending-review state** over seeding from a low-quality public dataset [DI-22].

## Lessons: Data integrity (DI)

Ids are the core catalogue's and never change (see `references/lessons.md`).

20. **Never sum across currencies. Compare currency-free ratios instead.** — Currency follows the payer. (Cross-site comparisons use an effective percentage.)
21. **Label every benchmark number with its provenance (sourced, estimated, observed) and upgrade it as better data arrives.** — Unlabelled estimates pass as facts. (No real national numbers existed, so estimates shipped labelled.)
22. **Prefer a crowdsourced canonical list with a pending-review state over seeding from a low-quality public dataset.** — Junk seeds are permanent. (A public dataset was a third junk.)
