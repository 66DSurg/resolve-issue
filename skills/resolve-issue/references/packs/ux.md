# Pack: UX and product design

**Switch on when** the issue changes what users see or do: screens, controls, copy, flows, notifications, emails or charts. Turn it on with `packs: [ux]` in the profile, or let a diagnosis that meets this trigger turn it on for one run.

The VIEW lens (`references/verification.md` §6) judges its screenshots against this pack and the profile's `docs.design`.

These rules are one product's taste, generalised. They are a sound default, not a law: where the project's own design system, ADRs or glossary say otherwise, those win.

## Rules

### Blocking states

- **Never let a blocking state be a dead end** [UX-5]. Use a global overlay on every route with a quiet fallback (for example, a cancelled biometric falls through to the password field with no red error) and escape hatches. Decide explicitly which state wins when two apply.

### Controls and visual consistency

- **One shared component per control** (search, select, toggle, filter, sheet, button, chip) [UX-6]. New pages reuse it, missing primitives are added to the library, and primitives accept no arbitrary styling hooks (callers size the container). Back it with a guard [TG-24] and tell build agents about it.
- **One canonical asset for brand marks** across every surface, plus a hosted raster copy for email [UX-7]. **Inline the brand tokens in server-rendered pages**, which do not receive the app's CSS variables [UX-8].
- **Treat visual regressions as urgently as functional ones**, and check every page that shares the pattern [UX-9].
- **Touch targets are at least 44 px, input text is 16 px on phones**, and errors are communicated in words rather than only as red fields [UX-10].
- **Use colour for hierarchy, not provenance**: one accent for focus, grey for context, a single action colour once per screen, and shape for direction [UX-22].

### Layout, copy and flows

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

### Charts and insights

- **Never fold two independent dimensions** (for example trustworthiness and completeness) into one indicator [UX-19].
- **Never render empty or degenerate charts.** Gate each one on data presence, a minimum number of categories, and fit with the user's context [UX-20].
- **Pair every insight with a concrete next action**, chosen deterministically from a catalogue keyed to metric and trend. A model may phrase the action but never invent its numbers [UX-21].
- **Do not rank users by volume or build leaderboards.** Lead with each user's own trend, and show peers only as soft bands [UX-23].

## Lessons: Design and UX (UX)

Ids are the core catalogue's and never change (see `references/lessons.md`).

5. **Never let a blocking state be a dead end. Show a global overlay on every route with a quiet fallback (a cancelled biometric falls through to the password field with no red error) and escape hatches, and decide explicitly which state wins when two apply.** — Stranded users leave. (Returning after idle locked the app with no unlock prompt.)
6. **Have one shared component per control (search, select, toggle, filter, sheet, button, chip). New pages reuse it, missing primitives are added to the library, primitives accept no arbitrary styling hooks (callers size the container), and a guard enforces it. Tell build agents about it.** — Every page that styles its own control looks different. (4 search boxes had 4 looks and 33 selects had 6, and the search box drifted for "the second or third time".)
7. **Keep one canonical asset for brand marks across every surface, plus a hosted raster copy for email.** — Re-implementations diverge. (The logo had diverged across six surfaces.)
8. **Inline the brand tokens in server-rendered pages.** — They do not receive the app's CSS variables. (A server-rendered confirm page kept an old accent colour.)
9. **Treat visual regressions (squashed circles, unreadable disabled buttons) as urgently as functional ones, and check every page that shares the pattern.** — Users experience them as breakage. (A link-density fix reached one docs page while its siblings kept the problem.)
10. **Use 44 px minimum touch targets and 16 px input text on phones, and communicate errors in words rather than red fields.** — Inputs under 16 px trigger iOS zoom. (Dense 36 px controls fell below the target.)
11. **Put the key facts of a view page above the fold at phone width. Edit-only controls appear only in edit mode, settings go in a menu, and explanations go in docs. Check what sits above the fold on every new view page.** — Padding and options push the facts out of sight. ("Looks better but not functional.")
12. **In dense lists, hide chips whose value is the default, so a chip means "this row is unusual". Keep detail fields that users must confirm.** — Default chips carry no signal. (A default role chip appeared on about 95% of rows.)
13. **Never show schema names or raw IDs in the UI. Map them through a label dictionary, with domain-native abbreviations as the exception.** — Users are not developers. (An edit-history view would have shown `*_id` columns.)
14. **Pick one canonical term per user-facing concept, preferably one users already know from familiar apps. Never mix synonyms, and keep developer words like "LLM" out of copy.** — Synonyms confuse. (Two names for the unlock secret confused users, and a messaging-app term stuck.)
15. **Treat text the user wrote as sacred: store it verbatim. Extraction reads it but never edits or consumes it, and any enrichment is visible.** — Vanishing text reads as data loss. (A user watched sentences disappear after extraction.)
16. **Ask clarifying questions inline, where the user already is, never in a separate queue that forces navigation and resubmission, and multiply the friction by real daily volume before accepting a flow.** — Separate review queues multiply friction. (One record needed six or seven submit-navigate-answer cycles, about 90 submissions a day.)
17. **Keep signup minimal and never collect a fact another flow already owns, enforced by a check.** — One source per fact. (Landing-page fields duplicated onboarding and never reconciled.)
18. **Ask users only for values they can read off the source, in a partial pre-filled form. Never block on derived values, and always offer "import as-is".** — Users cannot supply aggregates. (One uncomputable metric triggered a full "we couldn't read this" form.)
19. **Never fold two independent dimensions, such as trustworthiness and completeness, into one indicator.** — Combined indicators mean nothing. (A verification dot was kept separate from a "needs detail" nudge.)
20. **Never render empty or degenerate charts. Gate each one on data presence, a minimum number of categories, and fit with the user's context.** — A "by site" chart for a one-site user is noise. (This became the show/hide rule.)
21. **Pair every insight with a concrete next action, chosen deterministically from a catalogue keyed to metric and trend. A model may phrase the action but never invent its numbers.** — A decline with no next step makes users avoid the app. (This shaped the insights design.)
22. **Use colour for hierarchy, not provenance: one accent for focus, grey for context, a single action colour once per screen, and shape for direction.** — Overloaded colour confuses. (Using the action colour for declines caused confusion.)
23. **Do not rank users by volume or build leaderboards. Lead with each user's own trend over time, and show peers only as soft bands.** — Rankings drive the wrong incentive. (Volume ranking would push users to chase volume.)
24. **Practise radical simplicity: pare down rather than add complexity to feel important, and design for lasting value, not onboarding bait. Prefer one meaningful gate over many small ones.** — "Can a tired user at 9 PM still do this?" (This was the founding principle of the insights system.)
25. **Show records by the identifier users actually remember, such as a name, not system IDs.** — A list of IDs is useless to users. (The case list moved from IDs to names.)
26. **Make everyday authentication as low-friction as a banking app, and don't re-propose designs the owner has rejected.** — Friction kills daily use. (Typing a passphrase on every unlock was rejected.)
27. **If two technically different operations look identical to users, consider merging them, and research the simplest proven pattern first.** — Users cannot tell them apart, and each causes its own regressions. (Two biometric operations caused repeated regression cycles.)
28. **After an architecture change, clean up the old user-facing words and flows.** — Users keep following the old mental model. (Old "back up / restore" labels led into a flow that no longer worked.)
29. **Let users see that automated output is accurate before any downstream magic runs.** — Visible errors stop users at the door. (Poor transcription stopped a keen user from ever starting.)
30. **Tell users plainly when an action is a no-op, relabel the button to match, and drop ambiguous metrics such as "today".** — Confusing feedback erodes trust. (A re-upload offered "Import 0 cases", and "today" jumped to 105 on import day.)
31. **Have an agent auto-resolve obvious matches and ask the user only about genuine conflicts.** — Asking about everything is noise. (Notes vs selection: auto-pick on a semantic match, ask on left vs right.)
32. **End every user email with a support contact and a docs link.** — Locked-out users cannot reach in-app feedback. (This became the email footer rule.)
33. **An input that adds content (dictation, paste, an "add more" button) appends to what is already there and never replaces it.** — Replacing existing text makes the user do the work twice and reads as data loss. (A user pressed the mic to add a sentence and watched the text she had already entered vanish.)
34. **Show long human names in a short form wherever space is tight, and do not assume one naming culture.** — Name lengths and conventions differ by region. (The operator, working in a region where full names run long, asked for a short name in the header.)
35. **Deliver the app's own events as in-app notices, not browser or OS notifications, unless the user opted in.** — A browser pop-up for an in-app event feels like a bug or spam. (A notice came up as a browser notification and the operator asked why it was not in the app.)
