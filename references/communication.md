# Communication

The human may be reading on a phone, between other work, with no time for transcripts. Be short, open with a recommendation, use plain language, and be honest about failures, with the output to back it up.

## Asking

- **Ask only the questions that change the build**, one at a time, each with your recommended answer [PF-3]. Otherwise, start.
- **Rank and act** [CM-6]. When a ranking has a clear winner, state the pick and the runner-up in one line and start. Ask only when the ranking is close or the evidence contradicts it. When asked "what next?", open with a ranked position, not a question. In one case a ranking gave 0.97 and a four-option question still followed: "Why are you not using the ranking table to decide?"
- **Ask what came back from users or outreach** before proposing more features [CM-11, PJ-2].
- **Read dictated messages for intent.** Transcription mangles brand and product names, so work out the intended word from context [CM-8].
- **Do not assume jurisdiction or locale** from where the user lives, and do not advise outside your expertise [CM-10].

## Claims

- **Never claim "fixed", "deployed" or "0 failed" from indirect evidence** [CM-3]. Quote the command and its output instead.
- **Check push and remote state with git** (`git fetch`, then `git log origin/<main>..HEAD`) before saying anything about it, and never quote a running tally. If nothing is pending, say nothing about it [CM-1].
- **Derive elapsed-time and progress claims from git history** (`git log --reverse --format='%ad %s'`), not from the plan calendar [CM-2].
- **Report failures honestly, with the output.** Give the failing spec, its first error line and the log path. "Skipped" is reported as skipped [TG-10].

## Where the human tests

- **Know where the human actually tests** [CM-4]. If they dogfood on staging, "test it" means deploy to staging after their push approval, not a local run.
- **When the user is remote**, offer a way to reach local services (a tunnel or private mesh) before telling them to run something locally, and set the env the tunnel needs, such as public base URLs [CM-5].
- **When a manual step is needed in an external console**, remind the human which account to sign in with [CM-9].

## The end-of-run summary

Use this shape. Keep it short enough to read on a phone [CM-7].

```
<issue id> <title>: <verified | partially verified | failed>
Root cause: <one sentence>. Confirmed by: <probe/test, measured value>.
Ranking: <top option p=…, runner-up p=…>; <overruled by evidence: … | not overruled>.
What changes for the user: <one or two plain sentences>.
Gates: typecheck ✓ lint ✓ unit 412/412 ✓ e2e skipped (shared DB; run at merge) build ✓ docs ✓
Commits (git log <base>..HEAD):
  abc1234 <subject>
  def5678 <subject>
Check by hand: <the reporter's exact flow, device, data>.
Open: <follow-up issues filed: #…> | <pending real-device check>
Next: your yes to merge; then a separate yes to push.
```

## Board and tracker

- **Moving board cards is the agent's job**: "in progress" at launch, "staged" when pushed. The human files issues, verifies and approves pushes [CM-12].

## Tool quirks worth knowing

- **Browser automation**: some rich-text editors ignore typed input, so insert text programmatically. Tick checkboxes by coordinates and confirm with a zoomed screenshot. Know each site's per-file upload limits [TQ-1].
- **OAuth authorisation windows are short.** Finish the callback exchange as soon as the user pastes the URL [TQ-2].
