#!/usr/bin/env python3
"""Real cost of one resolve-issue run, from its workflow transcripts [CO-9]. Stdlib only.

  python3 scripts/run-cost.py <workflow transcript dir> [--weight sonnet=0.6 ...]

The dir is the run's transcript directory (journal.jsonl, agent-<id>.jsonl, agent-<id>.meta.json).
Units are input-token equivalents at Anthropic price ratios: cache read 0.1, cache write 1.25,
fresh input 1, output 5, times a per-model weight (default: sonnet 0.6, haiku 0.2, others 1.0).
budget.spent() counts output tokens only (about 8% of cost), which is why this exists.
Prints one JSON object; the main loop logs it as metrics.cost in .claude/resolve-issue-runs.jsonl.
"""
import collections
import glob
import json
import os
import sys

RATE = {"cache_read_input_tokens": 0.1, "cache_creation_input_tokens": 1.25, "input_tokens": 1.0, "output_tokens": 5.0}
WEIGHT = {"sonnet": 0.6, "haiku": 0.2}


def lines(path):
    for line in open(path, errors="ignore"):
        try:
            yield json.loads(line)
        except ValueError:
            continue


def weight(model):
    m = str(model or "").lower()
    return next((w for k, w in WEIGHT.items() if k in m), 1.0)


def cost(d):
    started = {e["agentId"]: (e.get("phase") or "?", e.get("label") or "") for e in lines(os.path.join(d, "journal.jsonl")) if e.get("type") == "started" and e.get("agentId")}
    stages = collections.defaultdict(collections.Counter)
    for f in sorted(glob.glob(os.path.join(d, "agent-*.jsonl"))):
        aid = os.path.basename(f)[len("agent-"):-len(".jsonl")]
        phase, label = started.get(aid, ("?", ""))
        stage = "Repair" if label.startswith("repair") else phase
        meta = f[:-len(".jsonl")] + ".meta.json"
        w = weight(json.load(open(meta)).get("model") if os.path.exists(meta) else None)
        turns = {}
        for e in lines(f):
            m = e.get("message")
            if e.get("type") == "assistant" and isinstance(m, dict):
                turns[m.get("id")] = m.get("usage") or {}  # streamed chunks repeat one id: count it once
        s = stages[stage]
        s["agents"] += 1
        s["turns"] += len(turns)
        for u in turns.values():
            for k, r in RATE.items():
                s[k] += u.get(k, 0)
                s["units"] += w * r * u.get(k, 0)
    out = {k: {"agents": c["agents"], "turns": c["turns"], "cache_read": c["cache_read_input_tokens"], "cache_write": c["cache_creation_input_tokens"],
               "fresh": c["input_tokens"], "output": c["output_tokens"], "units": round(c["units"])} for k, c in stages.items()}
    return {"units": sum(v["units"] for v in out.values()), "agents": sum(v["agents"] for v in out.values()), "stages": dict(sorted(out.items(), key=lambda kv: -kv[1]["units"]))}


def main(argv):
    if not argv or not os.path.isdir(argv[0]):
        sys.exit("usage: run-cost.py <workflow transcript dir> [--weight model=w ...]")
    for i, a in enumerate(argv):
        if a == "--weight" and i + 1 < len(argv):
            k, v = argv[i + 1].split("=")
            WEIGHT[k] = float(v)
    print(json.dumps(cost(argv[0])))


if __name__ == "__main__":
    main(sys.argv[1:])
