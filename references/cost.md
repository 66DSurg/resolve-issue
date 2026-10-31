# Cost: tiers, budget, concurrency

Save money on mechanical work, never on judgment. The worst failures behind this skill came from bad judgment (wrong diagnoses), not from spending too much [CO-1].

## Model and effort per stage

Keep the tier table in the profile (`tiers:`). It is the single source of truth, and the orchestrator passes a copy into each run [OR-6].

| Stage | Tier | Effort | Why |
|---|---|---|---|
| diagnose | strongest | high | the stage where runs actually failed. Only about 2 agents, so cheap in absolute terms [DG-6] |
| spec | strongest (inherit) | high | design judgment |
| plan | strongest (inherit) | high | writes the code every task applies, so errors multiply [PL-2] |
| build | mid | medium | applies code the plan already wrote |
| verify | strongest | high | the safety net. Never cheapen it [VF-6] |
| repair | one tier above build | high | the task already failed once on the cheaper tier [VF-5] |
| gates | mid | medium or higher | it commits, so never low [TG-32] |
| docs | mid | medium | prose within fixed rules, and a verifier checks the claims |

`model: null` (or `inherit`) means "use the session's model".

## Rules

- **Measure a repair-rate baseline before cheapening a stage** [CO-2]. Log the tasks, repairs and code-defect rejections for each run (the run returns them as structured data [OR-18]), and revert the cheaper tier if repairs rise materially. The reference baseline was about 23% of build tasks needing repair (5 of 22), at 1.3M to 2.5M subagent tokens per run.
- **Probe a tier with a trivial instruction before giving it any stage that can write or commit** [CO-3]. Send "Reply with exactly: ok" and exclude tiers that fail. The smallest tier once invented a task, wrote 342 lines, committed them to the main line under the human's name without the trailer, then amended its own commit. Record exclusions in the profile (`tiers._excluded`).
- **Stub paid external model calls in e2e and CI by default and assert zero billed calls** [CO-4]. Keep a tiny real-API smoke test (about 2 calls) on release tags only. Gate live-model suites behind a skip flag locally as well as in CI. Feature-detect stub support so older branches still run. The stub guard fails closed [PS-26].
- **Spend an expensive model once, where judgment is needed, then freeze its result** into a cached declarative recipe and replay it deterministically [CO-5, DI-17].
- **Run extractors cheapest-first** (cached recipe → known-pattern reader → model), and stop at the first whose output reconciles. Judge confidence by whether the data checks itself (totals, ratios), never by the model's self-report [CO-6].
- **The top-tier model on the request path is a cost trap.** Use the cheaper validated model there and keep the expensive one for rare offline jobs [CO-7].
- **Know the monthly burn and the break-even point**, and stop paid channels whose return does not justify them [CO-8].

## Budget and concurrency

- **Scale effort to the issue's size and announce it** before starting: the size, the agent count, and the token budget if one was set [SZ-1]. A single issue once consumed 1 to 4 million subagent tokens.
- **Respect the human's caps.** Count the running runs before launching. At a cap, queue the rest as issues and say which slot each is waiting for. After hitting a usage limit, drop to one run at a time until it resets [SZ-2].
- **Batch small, independent issues** into one run, with a per-item build → verify → repair loop and one shared gates and docs pass [SZ-3].
- In the Workflow template, `args.maxParallel` caps a build wave, and `budget` (when the human sets one) stops new work before the ceiling.
