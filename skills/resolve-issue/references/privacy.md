# Privacy and security

Privacy is a law in this skill, not a preference. It is injected into every agent prompt and checked by every verifier. The rules come from a sensitive-data app, but they apply to any project with users: customer PII, payment data, health or legal records, or private messages. Read this file whenever an issue touches user records, uploads, auth, AI calls, analytics or CI secrets.

## Contents

1. Identifiers stay out of everything
2. Agents and production
3. Secrets
4. Sending data to models and vendors
5. Web and API surface
6. CI and test artefacts

---

## 1. Identifiers stay out of everything

- **Never write sensitive identifiers** (names, record numbers, birth dates, customer PII) into issues, commits, PRs, docs or fixtures, even in a private repo [PS-1]. Refer to records by an opaque id prefix, a date and a type ("record `632d…`, 2026-09-12, import"). Keep screenshots local. The verifier greps for this.
- **Treat the issue tracker as an external processor.** Scan the text for identifiers before you create an issue or comment [PS-2]. Bots and integrations forward issue bodies to vendors.
- **Side-issue drafts are scrubbed before filing.** The run applies `privacy.identifier_patterns`, every body claims only what its evidence shows, and no screenshot of real user data is attached; VIEW shots use test data only [OR-27, PS-2].
- **Scrubbing the current files does not scrub git history.** Plan a history rewrite before a repo goes public, and add a guard so nothing new gets in [PS-3].
- **Guard retired tokens by hash.** A test hashes every word of every tracked text file and compares the result against stored hashes, so the deny-list does not itself re-leak the tokens. Fixture names are obviously synthetic [PS-4].

- **The spec's privacy table says whose data each row deletes or keeps** [SP-21], including other accounts that share an identifier (an email, a phone number, a record number) with the one being acted on. A cleanup keyed on a shared identifier reaches the other account too; the spec, not a build verifier, should find that.

## 2. Agents and production

- **Agents get no production access**: no querying production or staging databases, and no reading production logs. They reproduce locally and list any production-only fact as an open question for the human [PS-5].
- **Acceptance harnesses that must touch real sensitive data print only aggregate numbers**, with an assertion that throws if anything row- or identifier-shaped reaches the output. Analyse sensitive files through a scrubbed dump. Agents read the numbers and never the file [PS-6].
- **Before sending or drafting on someone's behalf, check which identity the connector is signed in as.** Write drafts only, and let the human send [PS-17].

## 3. Secrets

- **Use secrets without printing them.** Read them from a file straight into the command's environment. CI secrets are throwaway, generated per run with restrictive permissions, and only the one step that needs a real key gets it. Production keys never sit on the dev machine. The human applies them through the server's secret store [PS-16].
- **Declare least-privilege permissions per CI job** [PS-20].
- **A test stub or bypass guard fails closed.** Allow it only on an explicit opt-in value, never on a value that is also the default when the variable is unset [PS-26]. One guard allowed a stub on "development", which was also the unset default, so production could have accepted it.

## 4. Sending data to models and vendors

- **Classify data into storage classes up front.** Keep sensitive media only with providers that hold the required compliance agreement, and re-read that boundary before any storage decision [PS-7].
- **Never trade a core privacy guarantee for a fixable UX problem.** Solve the UX in the client or the flow [PS-8].
- **Before anything sensitive reaches a model, strip it with one mechanism**, verify independently with a different mechanism, and block the send if anything remains [PS-9].
- **Keep the most sensitive values (money, keys) out of AI calls entirely** and handle them with deterministic code [PS-10].
- **Check a vendor's data retention and compliance eligibility** before adopting its agent or hosted product. A stateless API call may qualify where an agent product does not [PS-11].
- **Check an ML model's licence and validate it on your real input domain** before adopting it [PS-13].
- **Keep development-time tools that call third-party services unreachable from shipped code**, enforced by a test that fails if app source imports them [PS-19].
- **Feedback attachments** get a required "no sensitive data" acknowledgement, a private bucket with expiring links, and the same redaction library the main flow uses [PS-18].

## 5. Web and API surface

- **Third-party analytics go on public surfaces only.** In a shared build, gate the snippet by build environment and grep the sensitive app's build output for zero references [PS-12].
- **Access gating covers per-deploy preview URLs (wildcards)**, and every access app has at least one allow policy [PS-14].
- **Hide admin routes from non-admins with 404, not 403**, on both frontend and backend [PS-15].
- **Mark API responses that carry private data `no-store, private`**, and pin the fix with a regression test that covers error responses too [PS-21].
- **When a page and its data share one URL, distinguished by headers**, set `Vary` and no-cache on the app pages [PS-22].
- **A change to what is on screen or in the DOM when the app is locked or logged out, or to how long data lives, is never the spec agent's decision** [SP-18]. The spec flags it per surface. The run's decide step may settle a row only when its recommendation and the ranker agree with margin and nothing gets less protected; a weakening always stops the run for the human [SP-20]. The verifier checks the diff for one the spec missed.
- **Fail closed on capability signals.** While a status is pending or errored, treat an optional feature as unavailable. Status endpoints return only a boolean, never key material or its length [PS-25].
- **In a triage rubric for a sensitive-data app, round anything touching data integrity or confidentiality UP to top priority**, and round pure polish down [PS-23].

## 6. CI and test artefacts

- **Upload test traces and screenshots only on failure**, only from synthetic accounts, before any step that touches real data, and with short retention [PS-24].
