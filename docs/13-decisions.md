# Decisions

Architecture decision records, in the order they shaped the system. Each records
the context, the decision, the consequences, and the alternatives that were
rejected. The audit that produced most of these is
[00-audit-report.md](00-audit-report.md).

---

## ADR-001 — No frontend framework, no build step

**Context.** A tracker with eight workspace pages and shared components.
**Decision.** Static HTML, ES modules and hand-written CSS. Shared behaviour in
`js/`, shared styling in `css/`.
**Consequences.** Every behaviour is visible in the file that owns it; the
deployable artifact is the repository; no dependency supply chain in the browser.
Page scripts are long, and components are functions returning template strings
rather than a component tree.
**Rejected.** React/Vue with a bundler: more machinery than the product needs,
and a build step between the reviewer and the code. A server-rendered template
engine: it would move rendering to the server without removing the client-side
interactivity.

---

## ADR-002 — MongoDB with Mongoose

**Context.** Records are nested (application → rounds, application → history) and
the schema evolved during the audit.
**Decision.** MongoDB, one document per application, rounds in their own
collection, history and checklist embedded.
**Consequences.** Documents map directly to the UI; adding fields needs no
migration. There are no joins, so the calendar loads applications and rounds and
merges them in memory. Cross-document cascades are the application's job.
**Rejected.** PostgreSQL: a better fit for strict relational integrity, but it
would add migrations and joins for a schema that is naturally a document. Keeping
rounds embedded: unbounded arrays make checklist updates rewrite the parent and
complicate per-round queries.

---

## ADR-003 — scrypt for passwords

**Context.** Password hashing must be slow, salted and dependency-free.
**Decision.** Node's built-in `crypto.scryptSync` with N=2¹⁶, r=8, p=2, a
16-byte salt and a 64-byte key, stored as a self-describing string. Unknown
emails are verified against a real dummy hash generated with the same
parameters, so timing does not reveal whether an account exists.
**Consequences.** No native build step; timing-safe verification; roughly 300 ms
of blocking work per attempt, bounded by the rate limiter. Parameters are in the
stored string, so they can be raised and old hashes are upgraded after a
successful sign-in.
**Rejected.** bcrypt (`node-gyp` on some hosts), argon2 (native module), plain
SHA-256 (fast and wrong), a short placeholder dummy hash (fast enough to leak
account existence through timing).

---

## ADR-004 — Opaque sessions instead of JWTs

**Context.** Private pages and APIs need authentication that can be revoked.
**Decision.** A 256-bit random token in an HttpOnly cookie; only its SHA-256 hash
is stored in `sessions`, with expiry and a TTL index.
**Consequences.** Logout and account deletion revoke access immediately. Every
request costs one indexed session lookup. Multi-instance deployments share state
through the database, so sessions work without sticky routing.
**Rejected.** JWT: revocation requires a denylist that reintroduces the database
lookup, and a stolen token stays valid until expiry. Storing the raw token: a
database leak would be replayable.

---

## ADR-005 — Calendar dates as `YYYY-MM-DD`

**Context.** A record created in New York displayed one day earlier because the
API sent UTC midnight and the browser rendered it locally.
**Decision.** Calendar dates are stored at UTC midnight, serialised as
`YYYY-MM-DD`, and parsed on the client into **local** midnight. Instants remain
ISO timestamps.
**Consequences.** "15 September" is 15 September everywhere. Any new date field
must be added to `DATE_ONLY_FIELDS` in `server/utils/dateOnly.js`. Sorting still
works because storage is a real `Date`.
**Rejected.** Storing local midnight (ambiguous across timezones), sending
timestamps and formatting in UTC (displays the wrong day for the user), storing
strings (loses range queries).

---

## ADR-006 — Status history is server-owned

**Context.** Only the current status was stored, so "when did this move to
Interview?" was unanswerable. A client-supplied history would be forgeable.
**Decision.** An embedded `statusHistory` array, written only by the server: one
entry on create, one per real transition, trimmed to the last 100. Clients cannot
submit it.
**Consequences.** The timeline is trustworthy. Two writes happen on update (read
the stored status, then update with `$push`), which is one indexed read. Legacy
records honestly show an empty trail.
**Rejected.** A separate `status_events` collection (more queries for a value
always read with the application), deriving history from `updatedAt` (only the
last change), accepting a client trail (forgeable).

---

## ADR-007 — Server caps pages at 100; clients page through

**Context.** Aggregate views silently showed only the first 100 records because
the server capped a page and clients never asked for more.
**Decision.** Keep the cap (it bounds one response and one query). Add
`getAllApplications()` which follows `totalPages` and concatenates.
**Consequences.** Dashboard, companies, pipeline, calendar, analytics, export and
interview prep see the full dataset. Large accounts make several requests; the
next step would be server-side aggregation endpoints.
**Rejected.** Removing the cap (one unbounded response), returning everything in
one "export" query for every page (the same unbounded response with a different
name).

---

## ADR-008 — Static allowlist instead of serving the project root

**Context.** The server exposed `/server`, `/seed-demo.js`, `/test-*.js`,
`/README.md` and the raw `.html` files, which bypassed the login redirect.
**Decision.** Mount only `/css` and `/js`. Serve HTML exclusively through
explicit page routes; everything else 404s.
**Consequences.** Backend source and environment files are unreachable; the
private-page redirect is effective. Adding a page means adding a route.
**Rejected.** A blocklist of sensitive paths (fails open for the next file),
serving the root with per-file middleware (easy to misconfigure).

---

## ADR-009 — In-memory fixed-window rate limiting

**Context.** Login and registration had no brute-force protection; the brief asked
for it without unnecessary dependencies.
**Decision.** A `Map` of `key → { count, resetAt }`, three policies, `429` with
`Retry-After`, and a sweeper at 5 000 keys.
**Consequences.** Zero dependencies and `O(1)` per request. Counters are per
process and reset on restart; multi-instance deployments need a shared store.
**Rejected.** `express-rate-limit` (fine, but a dependency for 60 lines), a
Mongo-backed counter (a database write per request), no limit at all.

---

## ADR-010 — Native `<dialog>` for confirmations

**Context.** `confirm()` and `prompt()` block the thread, cannot be styled, and
are announced inconsistently.
**Decision.** A small wrapper over `<dialog>` with `showModal()`, labelled title
and body, Escape/backdrop cancel, focus restore, and inline validation for typed
confirmation.
**Consequences.** The browser provides the focus trap and inert background. The
component must handle the case where the trigger was inside a modal the caller
closed (focus moves to `<main>`). A `close` listener prevents a hung promise.
**Rejected.** A custom overlay (must reimplement focus trapping and inertness),
keeping `confirm()` (fails the accessibility requirement).

---

## ADR-011 — One SVG icon system

**Context.** Emoji were mixed with an existing SVG set across six files; several
pages also had a local `const icon` that would shadow the helper.
**Decision.** Every icon comes from `icon(name)` in `js/utils.js`; sizes come from
the container; inline metadata uses `.icon-inline`.
**Consequences.** Consistent rendering across platforms, currentColor inherited,
no emoji font dependency. New icons must be added to the set.
**Rejected.** An icon font (extra request, ligature maintenance), per-page inline
SVG (duplication and drift).

---

## ADR-012 — Analytics definitions live on the server

**Context.** The page recomputed every headline number with slightly different
rules from `/api/analytics/summary`, so two parts of the product could disagree.
**Decision.** The server computes counts, rates, denominators, averages and
breakdowns. The client formats and charts them. The list is still fetched for the
monthly series and date range, which are presentation concerns.
**Consequences.** One definition per metric. Adding a metric means touching the
server first. The misleading "average time to offer" was removed rather than
computed from data that does not exist.
**Rejected.** Client-only analytics (two sources of truth), server-rendered
charts (loses interactivity for no gain).

---

## ADR-013 — Calendar merges rounds and legacy dates with dedupe

**Context.** Six interview rounds existed in the demo account and the calendar
showed none; it only read `application.interviewDate`. Both summary lists were
also capped at ten.
**Decision.** Load applications and rounds in parallel, create an event per
round, and add a legacy interview event only when no round already covers the
same application and day. Remove the caps.
**Consequences.** The calendar agrees with Interview Prep without hiding real
legacy dates. The merge is `O(a + i)` with a set lookup.
**Rejected.** Dropping `interviewDate` (hides data for older records), showing
both (duplicates the same event), a server-side calendar endpoint (more surface
for a view that is a pure projection).

---

## ADR-014 — CORS fails closed in production

**Context.** A permissive CORS default would let any site call the API with the
user's cookie if `ALLOWED_ORIGIN` were forgotten.
**Decision.** No allowlist in production means no CORS headers at all. Same-origin
use is unaffected. Development defaults to the local origins.
**Consequences.** A misconfigured cross-origin frontend fails loudly instead of
silently opening the API. The warning is logged at startup.
**Rejected.** `origin: true` (reflects any origin), `*` (incompatible with
credentials), crashing without the variable (breaks the normal same-origin case).

---

## ADR-015 — No drag-and-drop Kanban

**Context.** The pipeline had a `cursor: grab`, dropzone ids and an empty
`attachDropzoneListeners()`, but no drag events. Status changes already had a
dropdown.
**Decision.** Remove the dead drag affordances and keep the accessible dropdown
as the single way to change status.
**Consequences.** No misleading cursor, no dead code, and a keyboard path that
already works. Mouse users lose nothing they actually had.
**Rejected.** Implementing drag and drop (must also build keyboard parity; the
dropdown already is that parity), leaving the affordance (promises an interaction
that does not happen).

---

## ADR-016 — Destructive bulk delete requires a typed confirmation and a token

**Context.** Deleting all data previously looped over a capped client list, so it
silently left records behind.
**Decision.** One server endpoint scoped by `userId`, requiring
`{ "confirm": "DELETE" }`, preceded by a typed `DELETE` dialog in the UI.
**Consequences.** The operation is complete, atomic per collection, and hard to
trigger by accident. Two confirmations is deliberate for an irreversible action.
**Rejected.** A single `confirm()` (too easy to click through), `DELETE` without a
body token (a stray request would wipe an account).

---

## ADR-017 — Listen only after MongoDB connects

**Context.** Starting the listener first made early requests buffer and then fail
with 500s that looked like an outage.
**Decision.** `await mongoose.connect(...)`, then `app.listen(...)`. Exit 1 on
failure.
**Consequences.** A process that accepts traffic can serve it. Platform health
checks correctly report the app as down while the database is unreachable.
**Rejected.** Lazy connection (requests race the connection), retry loops with a
listening socket (health checks lie).

---

## ADR-018 — Delete the unused `buildShell()`

**Context.** `js/app-shell.js` exported a full shell builder that no page called.
It also emitted a `<div>` brand control, which the accessibility pass had already
replaced with a button in the real markup.
**Decision.** Remove `buildShell`, `NAV_ITEMS` and `LOGO`; keep `mountShell`.
**Consequences.** Less code, no risk of a page adopting the older, less accessible
markup by accident.
**Rejected.** Keeping it "for future use" (dead code that contradicts current
patterns).

---

## ADR-019 — Demo seeding is a guarded script, not a startup feature

**Context.** The demo seeder contained a fixed default password that was also
published in the README. Running the server never seeded anything, but the
credential was reusable and the script had no production guard.
**Decision.** Keep seeding as a standalone development tool, and require four
conditions: `--yes`, a non-production local environment, a server that does not
report `environment: "production"`, and legacy adoption being off. Generate a
random password unless the operator supplies `DEMO_PASSWORD`.
**Consequences.** No repository-wide demo credential exists. A fresh clone has no
demo account until someone explicitly seeds one. Re-seeding an existing account
requires its password. The script's own failures are covered by tests.
**Rejected.** Seeding on startup (production risk), a fixed documented password
(reusable credential), deleting and recreating the demo account automatically
(destructive and surprising), making demo data a special role (more privilege,
not less).
