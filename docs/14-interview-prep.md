# Interview Preparation

Answers grounded in this codebase. Each answer names the file it lives in, so
claims can be checked live. Numbers are the measured ones.

---

## 1. The two-minute walkthrough

> CareerFlow is a full-stack job-application tracker. One Express process serves
> a JSON API and ten static pages, backed by MongoDB. The browser is plain ES
> modules — no framework, no build step.
>
> The interesting part is not the CRUD. It's that three things were lying. The
> analytics page recomputed metrics differently from the server, so two parts of
> the product could disagree. The calendar only read a legacy date field, so six
> interview rounds existed and none appeared. And the server served the project
> root, so `/server/.env` was downloadable and `/applications.html` bypassed the
> login redirect.
>
> I fixed those by making the server the single owner of definitions: analytics
> come from one endpoint with explicit denominators, interview rounds are merged
> into the calendar with deduplication, and HTML is only reachable through
> auth-gated page routes while `/css` and `/js` are the only static mounts.
>
> Auth is scrypt plus opaque session tokens stored as SHA-256 hashes, and every
> query is scoped by the session's user id. The test suite starts its own server,
> runs 271 assertions across three suites, and includes cross-user attempts that
> must return 404.

## 2. Architecture

**Q: Why no framework?**

Every page is a static document plus one module. Shared behaviour is in `js/`,
and the deployable artifact is the repository. A framework would add a build
step and a dependency tree for eight pages. The trade-off is that page scripts
are long and components are template-string functions — I would extract page
controllers into modules before reaching for a framework.

**Q: Why MongoDB?**

The data is naturally a document: an application with an embedded status trail
and checklist, and rounds as children. Mongoose gives validation and enums
without a migration framework. The cost is that cascades and cross-collection
merges are application code: deleting an application explicitly deletes its
rounds, and the calendar loads both collections and merges them.

**Q: Where does authorisation live?**

In the data access, not the UI. Every query includes `userId` from the session:
`Application.findOne({ _id, userId })`. Body-supplied `userId` is deleted before
validation. A foreign record returns 404, not 403, so the API does not confirm
existence. `test-auth.js` §5 proves read, update, delete and attach are rejected
for a second account.

## 3. Authentication and security

**Q: Walk me through password storage.**

`crypto.scryptSync` with N=2¹⁶, r=8, p=2, a 16-byte random salt and a 64-byte
key. Stored as `scrypt$N$r$p$salt$hash` — self-describing, so the parameters can
be raised and old hashes are upgraded after a successful sign-in (the stored
parameters are read back first). Verification uses `timingSafeEqual`. For an
unknown email I verify against a real dummy hash generated at startup with the
same parameters, and failed responses are floored at 400 ms so an account still
on the older, faster parameters cannot be identified by timing.

**Q: How is the demo account protected?**

There is no demo account unless someone runs `node seed-demo.js --yes` against a
development server. The script refuses without the flag, refuses in production
(locally and by checking `/api/health`), and refuses while legacy adoption is on.
It generates a random password and prints it once instead of shipping a default,
and the demo user is an ordinary account scoped by its own `userId`.

**Q: Why sessions instead of JWT?**

Revocation. Logout deletes the session row, so the token is dead immediately;
a JWT would need a denylist, which is the same database lookup. Only the SHA-256
hash of the token is stored, so a database dump cannot be replayed. The cookie is
`HttpOnly`, `SameSite=Lax`, `Secure` in production.

**Q: What about CSRF?**

State-changing routes are POST/PUT/PATCH/DELETE only — no GET mutates. The cookie
is `SameSite=Lax`, bodies are JSON, and a cross-origin JSON request needs a CORS
preflight the server does not grant. For the current same-origin deployment that
is sufficient; if it were embedded elsewhere I would add a double-submit token.
I would rather state that than claim a token I did not write.

**Q: How do you stop brute force?**

Three fixed-window policies in memory: 5 failed logins per `ip|email` per 15
minutes, 100 attempts per IP per 15 minutes, 60 registrations per hour per IP.
A rejection is 429 with `Retry-After` and `code: RATE_LIMITED`. A success clears
the account budget, so a mistyping user is not locked out after remembering the
password. Limitation: counters are per process and reset on restart; multi-instance
needs a shared store.

**Q: You exposed `/server/.env`?**

It was reachable because the project root was served statically. The fix mounts
only `/css` and `/js`; HTML is served through explicit page routes so the login
redirect is effective. `/server/**`, `/seed-demo.js`, `/test-*.js`, `/README.md`
and raw `.html` all return 404 now — verified by the auth suite and by hand.

## 4. Data modelling

**Q: Why is `statusHistory` embedded and not a collection?**

It is always read with the application and bounded to 100 entries. A separate
collection adds a query to every detail view. The write path reads the stored
status first, then appends with `$push` + `$slice: -100`, so the `from` value is
the real previous status and the document cannot grow unbounded. Clients cannot
submit history — it is deleted from the body on POST and PUT.

**Q: Why keep the legacy `interviewDate` if rounds exist?**

Older records genuinely have an interview date and no round. Deleting the field
would hide real data. The calendar suppresses the legacy event only when a round
already covers the same application and day, so every fact appears exactly once.
A round whose parent is gone is skipped rather than rendering a dead row.

**Q: How are dates handled?**

Two kinds. Calendar dates are stored at UTC midnight but transported as
`YYYY-MM-DD` and parsed on the client into local midnight — otherwise a record
created in New York showed the previous day. Instants (`createdAt`,
`statusHistory[].at`) stay ISO. The server has one utility,
`server/utils/dateOnly.js`; the client has one parser, `parseDate()`.

**Q: How do you paginate and still show accurate totals?**

The server clamps `limit` to 1–100 and returns `total`/`totalPages`.
`getAllApplications()` follows the pages and concatenates. This exists because
aggregate views silently used only the first 100 rows; with 105 records the
dashboard would have said 100. At much larger scale the next step is
server-side aggregation, not more client requests.

## 5. Analytics

**Q: Define "response rate".**

`(Assessment + Interview + Offer) / applied`, where `applied` is every record not
in `Bookmarked`. Each rate ships with its denominator, and a zero denominator
returns `null` — the UI shows `—`, never `0%`. The definition lives only in
`server/routes/analytics.js`; the client formats.

**Q: Why did you delete "average time to offer"?**

No offer timestamp exists, so the number could not be computed honestly. I
removed it rather than deriving something plausible. "Average days to interview"
survives because both dates exist, and it reports its sample size; records with
missing dates or a negative interval are excluded.

**Q: What was wrong with in-progress?**

It was computed two different ways in two places. The server now defines it as
status in `{Applied, Assessment, Interview}`, and the page renders that value.

## 6. Frontend

**Q: How do you prevent XSS when rendering with template strings?**

`escapeHtml()` on every interpolated value, including attribute positions.
Dialog titles and messages use `textContent` rather than `innerHTML`. The
remaining `innerHTML` assignments contain only trusted markup and escaped data.
There is no CSP yet; that is a documented gap, because the inline module scripts
would need nonces.

**Q: Why a custom dropdown instead of `<select>`?**

The app needs rich option markup, a portal so Kanban columns cannot clip the
menu, and precise keyboard behaviour. The component implements listbox ARIA,
arrows, Home/End, Enter/Space, Escape, type-ahead, outside-click close, and focus
return. It always opens downward and caps its height rather than flipping, so its
position is predictable.

**Q: Tell me about an accessibility bug you found.**

Calendar event rows used `onclick="viewApp(id)"`, but the page runs as a module,
so `viewApp` was not global: every click threw `ReferenceError` and nothing
opened. I moved to delegated click and keydown handlers on the containers and
gave the rows `role="button"` and `tabindex="0"`. On the Kanban card, the "View
details" button was dead for the opposite reason — the card handler returned
early for every button. I also removed `role="button"` from the card itself,
because it contained real buttons and a dropdown; nesting interactive controls
inside a button role is invalid semantics.

**Q: How do confirmations work?**

`js/dialog.js` wraps a native `<dialog>`: `showModal()` gives inert background
and focus containment, Escape and backdrop cancel, and the typed-confirmation
variant validates inline without closing. Focus returns to the trigger, or to
`<main>` when the trigger was inside a detail modal the caller already closed.
A `close` listener settles the promise so an `await` cannot hang.

## 7. Testing

**Q: How do you run the tests?**

`cd server && npm test`. The runner executes 97 static checks, starts a dedicated
server on port 3100, waits for `/api/health`, runs 91 workspace assertions and 83
auth/isolation assertions, then sends SIGTERM and checks the graceful shutdown.

**Q: Why a separate instance?**

Determinism. Rate-limit windows and sessions start empty, so the
"sixth failed login is 429" test does not inherit state from a server someone
left running.

**Q: What is not tested?**

Browser behaviour. I verified dialogs, keyboard activation, calendar merging and
icon rendering manually with a headless browser, but `npm test` does not re-run
them. The static suite catches syntax errors, missing exports and dead asset
paths — the class of failure that otherwise shows up as an empty page. I would
add Playwright next.

**Q: Show me a test that would fail if authorisation regressed.**

`test-auth.js` §5: user A creates an application and a round; user B requests,
updates and deletes both, and tries to attach a round to A's application. All
five must be 404. It also checks B's analytics report zero and `null` rates.

## 8. Debugging stories (STAR)

**A page showing the wrong number.**
Situation: the dashboard showed 100 applications while the database had 105.
Task: find why aggregate views disagreed with the data.
Action: the server caps a page at 100; clients only requested page 1. I added
`getAllApplications()` to follow `totalPages`, then switched dashboard, analytics,
companies, pipeline, calendar, interview prep and export to it. I also added a
bulk-delete endpoint, because the old delete-all looped over the capped list and
left records behind.
Result: with 105 records, every view reports 105; bulk delete removes 105 in one
scoped call.

**A date that was one day early.**
Situation: a record created in New York displayed the previous day.
Task: fix without breaking sorting or storage.
Action: separate calendar dates from instants. Store UTC midnight, transport
`YYYY-MM-DD`, parse into local midnight on the client. Centralised in
`dateOnly.js` and `parseDate()`.
Result: 15 September stays 15 September in every timezone; the server's overdue
calculation uses the UTC boundary to match storage.

**Six interviews, zero on the calendar.**
Situation: Interview Prep listed six rounds; the calendar showed none.
Task: make the calendar tell the truth without duplicating legacy dates.
Action: load rounds in parallel with applications, create an event per round,
suppress a legacy interview date only when a round covers the same app and day,
and remove two silent `.slice(0, 10)` caps.
Result: twelve events instead of five, no duplicates, and the event rows became
keyboard-operable after the `onclick` bug surfaced during verification.

## 9. Trade-offs to acknowledge

| Decision | Cost | Why acceptable |
|---|---|---|
| No framework | Long page scripts | No build step; the code is directly reviewable |
| In-memory rate limits | Per process | Zero dependencies; documented for multi-instance |
| Client-side paging for aggregates | Several requests at scale | Correctness now; server aggregation is the next step |
| Embedded history capped at 100 | Very old transitions are dropped | Bounded document; current status always accurate |
| No CSP | Weaker defence-in-depth | Would need nonces for inline modules |
| No CSRF token | Relies on SameSite + JSON + CORS | Correct for same-origin; token if embedded |
| Manual UI verification | No browser suite | Static checks cover structure; Playwright is the next investment |

## 10. Questions to ask the interviewer

- How do you decide when a page's client-side logic should move behind an API?
- What is your policy on analytics definitions: one owner, or per-consumer?
- How do you handle schema evolution without a migration framework?
- Where does accessibility review sit in your delivery process?
- What does "done" mean for a feature here — tests, docs, monitoring?

## 11. If asked to extend it tomorrow

In order of value:

1. **Playwright journeys** for the three flows verified by hand (create/edit/
   delete, dialogs, calendar).
2. **Server-side aggregation** for analytics and a streaming CSV export.
3. **Email verification and password reset**, which unlock safer registration and
   remove the `409` enumeration trade-off.
4. **A shared rate-limit store** if the app runs more than one instance.
5. **CSP with nonces**, then an audit of the inline scripts.
6. **Soft delete plus an archive** if users want undo.
