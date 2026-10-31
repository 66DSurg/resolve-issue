# Pack: Tool quirks

**Switch on when** the run drives a browser, or completes an OAuth or connector flow for the human. Turn it on with `packs: [tool-quirks]` in the profile, or let a diagnosis that meets this trigger turn it on for one run.

Quirks of specific tools, true at the time they were recorded. Re-check them before relying on one.

## Rules

- **Browser automation**: some rich-text editors ignore typed input, so insert text programmatically. Tick checkboxes by coordinates and confirm with a zoomed screenshot. Know each site's per-file upload limits [TQ-1].
- **OAuth authorisation windows are short.** Finish the callback exchange as soon as the user pastes the URL [TQ-2].

## Lessons: Tool quirks (TQ)

Ids are the core catalogue's and never change (see `references/lessons.md`).

1. **Browser automation: some rich-text editors ignore typed input, so insert text programmatically. Tick checkboxes by coordinates and confirm with a zoomed screenshot. Know each site's per-file upload limits.** — These fail silently. (Typing into an email body and ticking element-referenced checkboxes both failed.)
2. **Remember that OAuth authorisation windows are short: finish the callback exchange as soon as the user pastes the URL.** — The code expires. (Re-authorising a connector from a phone needed an immediate exchange.)
