# Pack: Runtime model cost

**Switch on when** the product itself calls paid models or services at runtime (extraction, classification, generation), or the issue is about what the product costs to run. Turn it on with `packs: [cost]` in the profile, or let a diagnosis that meets this trigger turn it on for one run.

The core `references/cost.md` covers what a resolve-issue run costs. This pack covers what the product's own model calls cost.

## Rules

- **Spend an expensive model once, where judgment is needed, then freeze its result** into a cached declarative recipe and replay it deterministically [CO-5, DI-17].
- **Run extractors cheapest-first** (cached recipe → known-pattern reader → model), and stop at the first whose output reconciles. Judge confidence by whether the data checks itself (totals, ratios), never by the model's self-report [CO-6].
- **The top-tier model on the request path is a cost trap.** Use the cheaper validated model there and keep the expensive one for rare offline jobs [CO-7].
- **Know the monthly burn and the break-even point**, and stop paid channels whose return does not justify them [CO-8].

## Lessons: Cost (CO)

Ids are the core catalogue's and never change (see `references/lessons.md`).

5. **Spend an expensive model once, where judgment is needed, then freeze its result into a cached declarative recipe and replay it deterministically.** — The expensive path then shrinks over time. (Spreadsheet import maps a new layout once, and later sheets of that shape are free.)
6. **Run extractors cheapest-first (cached recipe → known-pattern reader → model) and stop at the first one whose output reconciles. Judge confidence by whether the data checks itself (totals, ratios), never by the model's self-report.** — Self-reported confidence is unreliable. (Per-source hand-parsers did not scale, and the cascade did.)
7. **Treat the top-tier model on the request path as a cost trap. Use the cheaper validated model there and reserve the expensive one for rare offline jobs.** — The top tier costs about 5x as much. (Extraction runs on the sweet-spot model.)
8. **Know the monthly burn and the break-even point, and stop paid channels whose return does not justify them.** — Costs creep. (A paid outreach tool cost more than the rest of the stack and was stopped.)
