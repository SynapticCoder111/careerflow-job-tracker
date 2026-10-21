# CareerFlow — Repository Audit

**Date:** 2026-10-20
**Scope:** full repository (`D:\Job_application_trakcer`)
**Method:** source inspection, HTTP probes against the running server, targeted runtime checks, and the two existing test suites.
**Baseline:** `test-suite.js` 66/66 pass, `test-auth.js` 49/49 pass (115/115).

This report separates **confirmed** findings (reproduced by inspection or an executed probe) from **risks** (plausible but not yet reproduced). Nothing is marked broken merely because it was not tested.

---

## 1. What the project actually is

| Layer | Implementation |
|---|---|
| Frontend | Multi-page static HTML + native ES modules. No framework, no bundler. Shared design system in `css/design-system.css`, page CSS in `css/landing.css` / `css/pipeline.css`. |
| Backend | Express 5 (CommonJS), 4 route modules, 2 middleware/config files, manual validation, centralized error responses. |
| Database | MongoDB via Mongoose 9. Four models: `User`, `Session`, `Application`, `Interview`. |
| Auth | Opaque 256-bit session token in an `HttpOnly` cookie; only the SHA-256 hash is stored in `Session`. Passwords hashed with Node's native `scrypt`. |
| Tests | Two standalone Node scripts that call the live HTTP API. No unit-test framework, no browser automation, no CI. |
| Deploy | Single Node process serving both the API and the static frontend. |

**Honest status:** the core product is real, not a mockup. Applications and interview rounds persist to MongoDB, every query is scoped to `req.user._id`, auth is genuine, and analytics are computed from stored records. The shortcomings below are the difference between "works on my machine" and "safe to deploy and defend in an interview."

---

## 2. Confirmed issues (prioritized)

### Critical

#### C1 — Backend source, tests, and seed scripts are publicly downloadable
**Files:** `server/server.js:70-89`
**Evidence:**
```
GET /server/server.js            -> 200 (5,022 bytes)
GET /server/routes/auth.js       -> 200
GET /seed-demo.js                -> 200  (contains the demo account password)
GET /test-auth.js                -> 200
GET /test-suite.js               -> 200
GET /server/node_modules/express/package.json -> 200
GET /server/.env                 -> 404  (dotfile protection, not intent)
```
**Why it matters:** `express.static(ROOT)` publishes the entire project directory. Anyone can read route logic, schema validation rules, and the seeded demo credentials, and can fingerprint dependency versions. The `.env` file happens to be hidden only because `express.static` ignores dotfiles by default — that is luck, not a control. This is an information-disclosure issue that fails a deployment review.
**Fix:** serve only the two public asset directories (`/css`, `/js`) and never the repository root.
**Verification:** the five probes above must return 404; `/css/design-system.css` and `/js/api.js` must still return 200.

#### C2 — Private pages are reachable at their raw `.html` URLs, bypassing the login redirect
**Files:** `server/server.js:70-89` vs `131-150`
**Evidence:**
```
GET /dashboard        -> 302 /login?next=%2Fdashboard   (correct)
GET /dashboard.html   -> 200                            (guard bypassed)
GET /settings.html    -> 200
GET /404.html         -> 200
```
**Why it matters:** the middleware intended to block `.html` never runs, because `express.static` serves the file first and only calls `next()` when a file is missing. Record data is still protected by the API's `requireAuth`, so this is not a data breach, but "protected private pages" is not actually true, and the route design is inconsistent. It also hides a second bug: several in-app links point at `.html` paths, which only work because the guard is broken.
**Fix:** remove root static serving (see C1), so unknown paths fall through to the 404 handler. Update in-app links to clean URLs.
**Verification:** `/dashboard.html` → 404, `/dashboard` → 302 when signed out, and every in-app navigation still works when signed in.

### High

#### H1 — Every aggregate view silently truncates at 100 records
**Files:** `server/routes/applications.js:72` (`limit` clamped to max 100), `analytics.html:134`, `companies.html:173`, `pipeline.html:163`, `calendar.html:193`, `interview-prep.html:256`, `settings.html:342,369,555`
**Evidence:** clients request `limit: 500` / `limit: 1000`; the server clamps to 100 and the clients never request page 2.
**Why it matters:** for any user with more than 100 applications, pipeline columns, company groups, analytics totals, CSV/JSON exports, and interview-prep application lists are all computed from a truncated subset — with no warning. Numbers look authoritative but are wrong.
**Fix:** add a paginated fetch-all helper on the client, or move aggregation to the server (`/api/analytics/summary` already exists). Bulk export should stream from the server.
**Verification:** seed 150 applications; pipeline counts, company count, analytics total, and CSV row count must all equal 150.

**Status:** fixed in Phase 2 — see §8. Verified with 105 records.

#### H2 — Dashboard reads only the first 20 records
**Files:** `js/dashboard.js:80`
**Evidence:** `api.getApplications()` with no params → server default `limit=20`.
**Why it matters:** summary cards, the activity chart, pipeline summary, and "attention required" are all wrong past 20 records. The dashboard is the first screen a user sees.
**Fix:** paginate or use the summary endpoint for counts.
**Verification:** with 25 records, "Total Applications" must read 25.

**Status:** fixed in Phase 2 — dashboard reads 105 of 105.

#### H3 — "Delete all data" deletes only the fetched subset
**Files:** `settings.html:541-572`
**Evidence:** the handler loops over `getApplications({limit:1000})` (capped at 100) and deletes one record at a time. No server-side bulk endpoint exists.
**Why it matters:** the confirmation promises *all* data; the operation leaves records behind, reports success, and has no rollback. A partial delete presented as complete is worse than a failure.
**Fix:** add `DELETE /api/applications` (scoped, confirmed) that deletes all of the user's applications and interviews in two operations.
**Verification:** with 150 records, after "delete all" the record count must be 0.

**Status:** fixed in Phase 2 — `DELETE /api/applications` exists and is tested.

#### H4 — No rate limiting on authentication
**Files:** `server/server.js`, `server/routes/auth.js`
**Why it matters:** `POST /api/auth/login` accepts unlimited attempts. Passwords are slow-hashed, which helps, but credential stuffing and account enumeration probing remain unthrottled.
**Fix:** dependency-free in-memory limiter (per IP + per email) on `/api/auth/login` and `/api/auth/register`.
**Verification:** the 6th rapid failed login returns `429` with `Retry-After`.

**Status:** fixed in Phase 3 — see §9. Verified: six rapid failures → `429`.

#### H5 — CORS reflects any origin when `ALLOWED_ORIGIN` is unset
**Files:** `server/server.js:39-44`
**Evidence:** `origin: ALLOWED_ORIGIN ? [...] : true` with `credentials: true`.
**Why it matters:** in production, if the variable is forgotten, any website can make credentialed cross-origin requests. It is safe today only because the frontend is same-origin.
**Fix:** fail closed in production — require `ALLOWED_ORIGIN` when `NODE_ENV=production`, default to same-origin otherwise.
**Verification:** with `NODE_ENV=production` and no `ALLOWED_ORIGIN`, a cross-origin `Origin` header must not receive `Access-Control-Allow-Origin`.

**Status:** fixed in Phase 3 — see §9. Verified against a production-mode instance.

#### H6 — Analytics are computed twice, with different rules
**Files:** `server/routes/analytics.js` (unused by the UI), `analytics.html:131-205`
**Evidence:** the UI never calls `api.getAnalyticsSummary()`; it recomputes every metric in the browser from the truncated list, while the server computes a different `applied` definition (`status !== "Bookmarked"` vs an explicit six-status array).
**Why it matters:** duplicated business logic drifts. The API endpoint is tested but dead; the UI shows numbers the API would disagree with.
**Fix:** make the UI consume `/api/analytics/summary`; keep one definition of each metric.
**Verification:** UI values must equal the endpoint values for the same account.

**Status:** fixed in Phase 4 — the page renders `/api/analytics/summary`; verified equal.

#### H7 — "Average time to offer" measures the wrong thing
**Files:** `analytics.html:173-178, 293`
**Evidence:** `new Date(a.createdAt) - new Date(a.applicationDate)` — the gap between when the user *logged* the record and the application date.
**Why it matters:** it is displayed as "Average time to offer" but has no relationship to offers. This is exactly the "do not fabricate analytics" failure the brief warns about.
**Fix:** remove the metric, or compute it from a real offer timestamp.
**Verification:** the label and formula must match, or the metric must be absent.

**Status:** fixed in Phase 4 — metric removed; replaced with real follow-up counts.

### Medium

| ID | Issue | File | Why it matters | Fix |
|---|---|---|---|---|
| M1 | Date-only fields shift by one day west of UTC. `"2026-09-15"` is stored as `2026-09-15T00:00:00Z` and rendered in local time, which is 14 Sep in New York. Verified with Node. | `applications.html:831-841`, `js/utils.js:39` | Users in the Americas see the wrong application date. | Treat date-only fields as calendar dates: send `T12:00:00` local or format with `timeZone: "UTC"`. |
| M2 | Calendar ignores the `Interview` collection. Rounds created in Interview Prep never appear; the calendar only reads `application.interviewDate`. It also caps upcoming and overdue at 10 each. | `calendar.html:190-250` | Interview scheduling and the agenda disagree. | Merge `api.getInterviews()` into the event set; paginate. |
| M3 | No status history or activity timeline. A status change overwrites the old value. | `Application` model | The brief requires an auditable transition log; "when did I move to Interview?" is unanswerable. | Add `statusHistory[]` (from, to, at) written on change. |
| M4 | Company grouping is case- and whitespace-sensitive, so "Google" and "google " become two companies. | `companies.html:185-199` | Inflates company counts and splits recruiter notes. | Normalize the grouping key; keep the first display spelling. |
| M5 | `loadUser` runs before static assets, so every CSS/JS request performs two database queries. | `server/server.js:59` | Needlessly loads the database on page load. | Mount static assets before `loadUser`, or skip auth work for asset paths. |
| M6 | Destructive actions use native `confirm()` / `prompt()` rather than the app's dialogs. | `settings.html:518-572`, `pipeline.html:394` | Inconsistent, unstyled, not keyboard/AT-friendly; the brief requires accessible confirmation dialogs. | Reuse the existing modal pattern with typed confirmation. |
| M7 | Emoji used as icons alongside a coherent SVG icon set. | `analytics.html`, `companies.html`, `calendar.html`, `interview-prep.html`, `pipeline.html`, `js/dashboard.js` | Visually inconsistent and platform-dependent; the brief explicitly forbids mixing emoji and icon systems. | Replace with `icon()` from `js/utils.js`. |
| M8 | Dead code: `const toast = document.getElementById('toast')` (element no longer exists) and an unused `buildShell()` that still emits a non-button brand. | `pipeline.html:151`, `calendar.html:180`, `js/app-shell.js:34-72` | Dead references mislead maintainers; `buildShell` would reintroduce the fixed sidebar-brand bug if ever called. | Delete or repair. |
| M9 | `npm test` is the default failing stub. | `server/package.json:7` | A reviewer runs `npm test` and sees a failure. | Wire the two suites. |
| M10 | Server accepts requests before MongoDB is connected. `app.listen` is not gated on `mongoose.connect`. | `server/server.js:17-25,164` | Requests buffer up to 10 s and then 500 during startup. Explicitly called out in the brief. | Start listening only after a successful connection; add graceful shutdown. |
| M11 | Legacy migration lets the **first** registrant adopt all ownerless applications. | `server/routes/auth.js:57-69` | On a shared/production database this could hand one user another person's pre-auth records. | Gate behind an explicit env flag, run once, then remove. |
| M12 | No `docs/`, no API reference, no `.env.example`. | repo root | Blocks the documentation and interview-preparation goals. | This audit is the first document; the rest follow. |

### Low

| ID | Issue | File |
|---|---|---|
| L1 | `menuToggle` uses `aria-expanded` for a desktop collapse, where it describes a region rather than a popup. | `js/app-shell.js:98` |
| L2 | `createAvatar()` always announces "Company: …", even when reused for people. | `js/utils.js:165-174` |
| L3 | `PUT /api/applications/:id` accepts an empty body and returns 200; harmless but undocumented. | `server/routes/applications.js:173` |
| L4 | No compound index for the common `{ userId, status }` / `{ userId, createdAt }` list query. | `server/models/Application.js` |
| L5 | `escapeHtml()` allocates a DOM node per call in long list renders. | `js/utils.js:124-129` |

---

## 3. Risks not yet reproduced

These are plausible but have **not** been demonstrated, so they are not counted as bugs:

- **CSRF.** `SameSite=Lax` blocks cross-site cookie-bearing POSTs in modern browsers, and JSON endpoints require a preflight. A token-based CSRF defence is still absent; confirm behaviour before claiming protection.
- **Session fixation.** A new random token is issued on every login; no evidence of fixation, but it is untested.
- **No account lockout or login alerting.** Rate limiting (H4) is the cheaper first control.
- **`escapeHtml` coverage.** Dynamic strings reviewed so far are escaped; a full sweep of every template literal has not been done.
- **MongoDB credential scope.** `.env` uses a single connection string; least-privilege database roles cannot be verified from the repository.

---

## 4. What is genuinely done well (preserve it)

- Password hashing uses OWASP-recommended scrypt with a per-password salt and `timingSafeEqual`; the hash is `select: false` and stripped from JSON.
- Login runs a dummy verification when the email is unknown, equalizing response time.
- Sessions store only a SHA-256 hash of the token; the cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production; a TTL index expires sessions.
- Every application and interview query is scoped by `req.user._id`; ownership cannot be reassigned through `PUT`; cross-user access is covered by tests.
- ObjectIds are validated before queries; Mongoose validation errors are mapped to field-level messages; stack traces never reach clients.
- Pagination, debounce, URL validation, and duplicate-submit guards exist on the applications page.
- The dropdown component has real keyboard and ARIA semantics, including portal mode for the Kanban board.
- Accessibility and responsive work already holds up: 11 pages at 1.0/1.0/1.0 in Lighthouse, no horizontal overflow at 360–1440 px.

---

## 5. Phased plan

| Phase | Theme | Contents | Status |
|---|---|---|---|
| 1 | **Security & routing** | C1, C2 — asset allowlist, clean-URL links | **complete — verified** |
| 2 | **Data correctness** | H1, H2, H3 — pagination contract, server-side bulk delete, dashboard totals | **complete — verified** |
| 3 | **Auth hardening** | H4, H5, M10, M11 — rate limit, CORS fail-closed, readiness gating, migration flag | **complete — verified** |
| 4 | **Analytics integrity** | H6, H7, M1 — single source of truth, remove/repair time-to-offer, timezone-safe dates | **complete — verified** |
| 5 | **Feature completeness** | M2, M3 — calendar from interviews, status history/timeline | **complete — verified** |
| 6 | **UI consistency** | M6, M7, M8 — accessible dialogs, icon sweep, dead-code removal | **complete — verified** |
| 7 | **Testing** | M9 + coverage — `npm test` runner, static checks, isolation tests | **complete — verified** |
| 8 | **Docs & interview prep** | `docs/01`–`14`, API reference, question bank, deployment guide | **complete** |

**Sequencing rule:** phases 1–3 are blockers for any deployment claim. Phase 4 must precede any screenshot or README claim about analytics.

---

## 6. Verification log — audit baseline (before any fix)

```
GET /api/health                     -> 200 {"status":"ok"}
GET /server/server.js               -> 200
GET /seed-demo.js                   -> 200
GET /test-auth.js                   -> 200
GET /server/.env                    -> 404
GET /dashboard                      -> 302 /login?next=%2Fdashboard
GET /dashboard.html                 -> 200
node test-suite.js                  -> PASSED: 66 FAILED: 0
node test-auth.js                   -> PASSED: 49 FAILED: 0
new Date('2026-09-15') in America/New_York -> 2026-09-14
```

---

## 7. Phase 1 completion record — C1 + C2

**Change.** `server/server.js` no longer serves the repository root. It mounts
`/css` and `/js` as two explicit static directories (`dotfiles: "deny"`) and
mounts the session loader after them. HTML is reachable only through the
explicit page routes. In-app links were changed from `applications.html` to
`/applications` in `pipeline.html`, `calendar.html`, and `js/dashboard.js`.

**Before → after (same probes):**

| Probe | Before | After |
|---|---|---|
| `/server/server.js` | 200 | **404** |
| `/server/routes/auth.js` | 200 | **404** |
| `/seed-demo.js` (contains demo password) | 200 | **404** |
| `/test-suite.js`, `/test-auth.js` | 200 | **404** |
| `/server/package.json` | 200 | **404** |
| `/server/node_modules/express/package.json` | 200 | **404** |
| `/README.md`, `/start.bat` | 200 | **404** |
| `/dashboard.html`, `/settings.html`, `/applications.html` | 200 | **404** |
| `/css/design-system.css`, `/js/api.js` | 200 | **200** |
| `/`, `/login`, `/register` | 200 | **200** |
| `/dashboard` (signed out) | 302 | **302** |
| `/api/health` | 200 | **200** |

**Regression checks.** `test-suite.js` 66/66, `test-auth.js` 49/49. All eight
workspace pages and the three public pages were loaded in a real browser:
zero failed resource requests, zero console errors, styles intact, sidebar and
brand toggle present on every workspace page.

**Side benefit.** Mounting assets before `loadUser` also removes two database
queries per static file request (audit item M5).

---

## 8. Phase 2 completion record — H1 + H2 + H3

**Root cause.** `GET /api/applications` clamps `limit` to 100 (`applications.js`).
Every aggregate screen asked for `limit: 500`/`1000` (or sent no limit at all,
receiving the default 20) and rendered only the first page. Nothing was
truncated on the server — the clients simply never asked for page 2. "Delete all
data" then looped over that same capped list, so records beyond the cap survived
a delete that claimed to be total.

**Change — one paginated contract, one scoped write.**

| File | Change |
|---|---|
| `js/api.js` | New `api.getAllApplications(params)`: walks `page=1..n` at 100 rows per request and returns the combined list. New `api.deleteAllApplicationData()`: single scoped `DELETE /api/applications` with `{ "confirm": "DELETE" }`. |
| `server/routes/applications.js` | New `DELETE /api/applications`: requires the confirmation token (`400 CONFIRMATION_REQUIRED` otherwise), then `deleteMany({ userId })` for applications and interview rounds in one parallel operation. Returns `deletedApplications` / `deletedInterviews`. |
| `js/dashboard.js` | `getApplications()` → `getAllApplications()` (was silently capped at 20). |
| `analytics.html`, `companies.html`, `interview-prep.html` | `limit: 1000` → `getAllApplications()`. |
| `pipeline.html` | `limit: 500` → `getAllApplications({ sort: "createdAt:asc" })`. |
| `calendar.html` | `limit: 500` → `getAllApplications()`. |
| `settings.html` | CSV export, JSON backup → `getAllApplications()`. Delete-all → one server call instead of a loop over a truncated list. |

**Measured effect (105 applications, one throwaway account).**

| Probe | Before Phase 2 | After |
|---|---|---|
| `GET /api/applications?limit=1000` rows returned | 100 (clamped) | 100 (clamped, by design) |
| Dashboard "Total Applications" | 20 | **105** |
| Analytics "Total Applications" | 100 | **105** |
| Companies "Total Companies" / "Total Applications" | ≤100 | **105 / 105** |
| `api.getAllApplications()` in the browser | — | **105 rows**, 105 distinct companies |
| Settings record count | 105 | **105** |
| Bulk delete (`DELETE /api/applications`) | no endpoint | **deleted 105, remaining 0** |
| Old delete-all loop | would delete 100, leave 5 | replaced |

**Contract decisions.**

- The 100-row cap stays. It is a good server-side guard; the fix belongs in the
  client, which now pages. Raising the cap would only move the cliff.
- Bulk delete is scoped by `req.user._id`, never by a client-supplied user ID.
- Bulk delete requires `{ "confirm": "DELETE" }` in the body, so an accidental
  or half-formed request cannot wipe a workspace.
- `deleteAllApplicationData()` is the only client path that deletes more than
  one record; exports and aggregates never mutate.

**Tests added.** `test-suite.js` grew to **76 assertions** (+10):

- `limit is capped at 100` (documents the contract the client must page around)
- `page size honoured below the cap`
- bulk delete without confirmation → `400` / `CONFIRMATION_REQUIRED`
- records untouched after a refused delete
- bulk delete → `200`, correct application and interview counts
- no applications and no interviews remain

`test-auth.js` grew to **51 assertions** (+2): a second user's bulk delete
reports zero and leaves the first user's record intact.

**Regression checks.**

```
node test-suite.js  -> PASSED: 76 FAILED: 0
node test-auth.js   -> PASSED: 51 FAILED: 0
```

Browser (logged in as a 105-record account): dashboard, applications, pipeline,
calendar, companies, interview-prep, analytics, settings all load with **zero
console errors**; dashboard 105, analytics 105, companies 105; pipeline and
calendar render without overflow. The temporary account was deleted afterwards.

**Deferred, deliberately.** The analytics *definitions* are still duplicated and
one metric is mislabeled (H6, H7) — that is Phase 4. Date-only fields still
shift a day west of UTC (M1), also Phase 4.

---

## 9. Phase 3 completion record — H4 + H5 + M10 + M11

**Change.** Four separate safety gaps, all in the startup and auth path.

| Piece | Before | After |
|---|---|---|
| Login rate limit | unlimited attempts | 5 failed / 15 min per **address+email**; 100 / 15 min per **network**. Correct password clears the account budget. |
| Registration limit | unlimited | 60 / hour per network |
| Rate-limit response | — | `429` + `Retry-After` + `code: "RATE_LIMITED"` + `X-RateLimit-*` headers |
| CORS with no `ALLOWED_ORIGIN` | reflected **any** origin with credentials | production: **no CORS headers at all** (fail closed); development: explicit local origins only |
| Startup | `app.listen` immediately, connect in parallel | listen **only after** `mongoose.connect` resolves; exit 1 otherwise |
| Shutdown | none | `SIGINT`/`SIGTERM` close the HTTP listener, then the DB connection |
| Legacy adoption | first registrant adopts all ownerless rows | runs only when `ALLOW_LEGACY_ADOPTION=true`; logs what it adopted |
| Requests with no body | `500` (handler read `req.body.x` on `undefined`) | `req.body` normalised to `{}`; handlers return `400` with field errors |

**Files.** New `server/middleware/rateLimit.js`; new `server/.env.example`;
`server/server.js` (CORS, trust proxy, startup/shutdown); `server/routes/auth.js`
(limiters, reset-on-success, migration flag); `seed-demo.js` now clears via the
scoped bulk endpoint instead of a capped loop.

**Design notes.**

- The limiter is dependency-free and deliberately simple: fixed window, in
  memory, swept when the map exceeds 5,000 keys. It is honest about being
  per-process — a multi-instance deployment needs a shared store, and the README
  says so.
- Limits are checked *before* hashing, so a blocked request costs no CPU.
- The failure budget is keyed by `ip|email`, not by email alone, so an attacker
  cannot lock a victim out from another network, and not by IP alone, so one
  person's failures do not block a shared office.
- `TRUST_PROXY` is opt-in. Trusting `X-Forwarded-For` by default would let any
  client spoof its address and bypass the limiter.
- CORS is not the authorization boundary (sessions are); fail-closed CORS
  removes an accidental *browser* exposure, and the API still rejects anonymous
  callers with `401` regardless of origin.

**Measured probes.**

```
# Production mode, no ALLOWED_ORIGIN, Origin: https://evil.example
GET /api/health        -> 200, no Access-Control-Allow-Origin header
OPTIONS /api/applications -> 401, no CORS headers

# Production mode, ALLOWED_ORIGIN=https://app.example.com
Origin: https://app.example.com -> ACAO: https://app.example.com, credentials: true
Origin: https://evil.example    -> no ACAO header
preflight from allowed origin   -> 204 with ACAO + allowed methods

# Readiness gating (MONGODB_URI=mongodb://127.0.0.1:1/none, MONGO_TIMEOUT_MS=1500)
process exit code 1, "The server did not start", nothing listening on the port

# Rate limiting (test-auth.js)
attempts 1–5 -> 401, attempt 6 -> 429 with Retry-After
another account from the same IP -> 401 (not blocked)
correct password after 4 failures -> 200, then a failure -> 401 (budget cleared)

# Malformed requests (found while hardening the auth path)
POST /api/auth/login    with no body -> 500 before, 400 after
POST /api/auth/register with no body -> 500 before, 400 after
```

**Tests.** `test-auth.js` grew from 51 to **61** assertions: the six-attempt
sequence, `Retry-After`, the machine-readable code, key scoping,
reset-on-success, and malformed requests with no body. `test-suite.js` stays at
**76**.

```
node test-suite.js  -> PASSED: 76 FAILED: 0
node test-auth.js   -> PASSED: 61 FAILED: 0
```

**Deferred.** Limits are in memory (documented above). There is no account
lockout, CAPTCHA or email verification; those need infrastructure this project
does not have, and pretending otherwise would be dishonest.

---

## 10. Phase 4 completion record — H6 + H7 + M1

**H6 — one definition per metric.** `analytics.html` used to recompute every
headline number in the browser while `/api/analytics/summary` independently
computed the same numbers with slightly different rules. The page now renders
the endpoint and keeps only *presentation* logic locally.

| Data | Before | After |
|---|---|---|
| Total, applied, in-progress, interviews, offers, rejected | recomputed client-side | `summary` |
| Interview / offer / response rates + denominators | recomputed client-side | `summary` |
| Status / source / work mode / employment / priority counts | recomputed client-side | `summary` |
| Average time to interview + sample size | recomputed client-side | `summary` |
| Follow-ups scheduled | recomputed client-side | `summary` |
| Monthly series, date range, top companies | client | client (no server counterpart; listed as presentation-only) |

The list is still fetched, but only for the monthly series and the date range.
`countBy()` and the duplicated rate math were deleted.

**H7 — a metric that measured something else.** "Average time to offer" was
`createdAt - applicationDate`: the gap between when a record was *logged* and
the application date. It had nothing to do with offers. It is gone, and the
"Timing & Effort" card now shows follow-ups past due — a number derived from
stored follow-up dates. The server field `followUpsCompleted` (which counted
past-due as "completed") is renamed `followUpsPastDue`.

Two related corrections fell out of this:

- "Active applications" was `applied - rejected - offer`, which miscounts
  `Withdrawn` records. It now uses the server's `inProgress`.
- `responded` is returned by the API instead of being reverse-engineered from a
  rounded percentage.

**M1 — calendar dates, not instants.** Date-only values were serialised as
`2026-09-15T00:00:00.000Z` and rendered with `toLocaleDateString`, which shows
**14 September** in New York.

| Layer | Change |
|---|---|
| API contract | `applicationDate`, `followUpDate`, `interviewDate`, `deadline` are returned as `YYYY-MM-DD` (`server/utils/dateOnly.js`, applied in both normalisers) |
| Parsing | `parseDate()` in `js/utils.js` builds local midnight for `YYYY-MM-DD`; instants keep their timestamp |
| Formatting | `formatDate`, `formatDateShort`, `formatDateTime`, `formatDateInput`, `isOverdue`, `isWithinDays`, `relativeDay` all go through `parseDate` |
| Call sites | dashboard, applications, pipeline, calendar, companies, analytics, interview prep no longer call `new Date()` on calendar fields |
| Server analytics | "today" boundaries use UTC midnight, matching storage |
| Interview filter | `?upcoming=true` now includes today instead of starting at the current time |

**Measured.**

```
TZ=America/New_York
  old: new Date('2026-09-15T00:00:00.000Z').toLocaleDateString() -> Sep 14, 2026
  new: parseDate('2026-09-15').toLocaleDateString()              -> Sep 15, 2026

API
  GET /api/applications/:id -> applicationDate: "2026-09-15" (no time component)
  GET /api/interviews/:id   -> interviewDate:   "2026-11-05"

UI (demo account, 10 applications)
  cards: total 10 · interview 20% (2 of 10) · offer 10% (1 of 10) · response 70% (7 of 10)
  summary endpoint: identical values
  "time to offer": absent
  calendar: follow-ups/deadlines render as Oct 20, Oct 21, Oct 22, Oct 24, Oct 25 — exactly the stored dates
```

**Tests.** `test-suite.js` grew from 76 to **84** assertions: three date-only
serialisation checks, one interview date check, and four analytics-shape checks
(`responded`, `inProgress`, every breakdown, honest past-due naming).
`test-auth.js` stays at **61**.

```
node test-suite.js  -> PASSED: 84 FAILED: 0
node test-auth.js   -> PASSED: 61 FAILED: 0
```

All eight workspace pages were reloaded in the browser after the change: zero
console errors, zero failed requests.

---

## 11. Phase 5 completion record — M2 + M3

**M2 — the calendar ignored the Interview collection.** Interview rounds are
stored in their own collection (`Interview`), but the calendar only read the
legacy `application.interviewDate` field. Six rounds existed in the demo
account; the calendar showed **zero** of them. Both summary lists were also
silently truncated with `.slice(0, 10)`, so a busy account was told it had ten
upcoming events when it had more.

| Change | Detail |
|---|---|
| Data source | `loadCalendar()` now fetches `getAllApplications()` **and** `getInterviews()` in parallel |
| Round events | Each round becomes an event labelled `<type>: <role>` (e.g. `Technical Interview: Frontend Engineer`) |
| Duplicates | The legacy `interviewDate` event is suppressed only when a round already sits on that same day for that application |
| Orphans | A round whose application is gone is skipped instead of rendering a dead row |
| Caps | Both `.slice(0, 10)` calls removed; the agenda view is the complete list and the summary cards show every event in their window |
| Round label | Round names like `Round 2 — Technical` already repeat the type, so they are not concatenated into the title |

**Broken event links, found while verifying M2.** Every calendar event row used
an inline `onclick="viewApp(id)"`, but the page runs as a module, so `viewApp`
was not a global. Clicking any event threw
`Uncaught ReferenceError: viewApp is not defined` and opened nothing. The rows
now carry `data-app-id` and the three lists delegate clicks (the same pattern
`applications.html` already used). Because the rows became interactive
containers, they also gained `role="button"`, `tabindex="0"`, and Enter/Space
activation.

**M3 — status changes were untracked.** The database only stored the *current*
status, so "when did this move to Interview?" was unanswerable.

| Layer | Change |
|---|---|
| Schema | `statusHistory: [{ from, to, at }]` (`_id: false`); `at` is a real instant |
| Create | The server writes one entry (`from: null`) with the initial status |
| Update | One entry is appended **only** when the submitted status differs from the stored status, trimmed to the last 100 entries |
| Trust | `statusHistory` is stripped from every request body; history is server-owned on both POST and PUT |
| API | History ships with the record; `at` serialises as an ISO instant |
| UI | Shared `statusHistoryList()` in `js/utils.js`, rendered newest-first in the detail modals of `applications.html` and `calendar.html` |
| Legacy rows | Records created before this change have no trail and honestly show "No status changes recorded yet." |

**Measured.** Demo account after the change:

```
calendar events
  before: 5 (applications only; 0 interview rounds, capped at 10)
  after:  12 (6 interview rounds + 3 follow-ups + 3 deadlines)

status trail (temporary record: Bookmarked -> Applied -> Interview)
  PUT /api/applications/:id  -> history length 3
  Bookmarked            Oct 20, 11:56 PM
  Bookmarked -> Applied Oct 20, 11:56 PM
  Applied -> Interview  Oct 20, 11:56 PM

forged history on create/update: ignored (length stays 1 / 3)
calendar row click: modal opens, 0 console errors; Enter on a focused row also opens it
```

**Tests.** `test-suite.js` grew from 84 to **91** assertions (seven history
checks: initial entry, client-supplied history ignored on create, instant
timestamp, append on change, correct `from`/`to`, no append on re-save, no
rewrite via PUT). `test-auth.js` stays at **61**.

```
node test-suite.js  -> PASSED: 91 FAILED: 0
node test-auth.js   -> PASSED: 61 FAILED: 0
```

The temporary verification record was deleted afterwards; the demo account is
back to its 10 applications.

---

## 12. Phase 6 completion record — M6 + M7 + M8

**M6 — accessible confirmations.** Destructive actions called `window.confirm()`
and `window.prompt()`, which block the page, cannot be styled or translated by
the design system, and are announced inconsistently by screen readers. They are
replaced by `js/dialog.js`, a native `<dialog>` wrapper:

| Requirement | How it is met |
|---|---|
| Modal semantics | `dialog.showModal()` makes the page inert and contains focus |
| Labelling | `aria-labelledby` (title) + `aria-describedby` (message), text set with `textContent` |
| Keyboard | Escape cancels, Enter submits the input dialog, focus starts on the input or confirm button |
| Focus return | Focus returns to the trigger; if the trigger was inside a modal the caller closed, focus moves to `<main>` instead of a hidden button |
| Backdrop | Clicking outside the panel cancels |
| Destructive tone | `tone: "danger"` renders a danger button; the typed-confirmation dialog validates inline |
| No hangs | A `close` listener settles the promise even if the browser closes the dialog by another path |

Native calls replaced: 2 × `confirm` + 2 × `prompt` in `settings.html`, and the
delete confirmations in `calendar.html`, `pipeline.html`, `interview-prep.html`.
The typed confirmation now refuses to close on a wrong value and shows
`aria-invalid="true"` with an inline error instead of silently cancelling.

**M7 — one icon system.** 31 emoji occurrences across `analytics.html`,
`companies.html`, `calendar.html`, `interview-prep.html`, `pipeline.html` and
`js/dashboard.js` are gone. Every icon now comes from `icon()` in `js/utils.js`;
the set gained `globe`, `mapPin`, `inbox`, `alert` and `checkCircle`, and a small
`.icon-inline` utility aligns 14 px icons with metadata text. Several pages had a
local `const icon = ...` that would have shadowed the imported helper — those
were renamed.

**M8 — dead code removed.**

| Removed | Why |
|---|---|
| `buildShell()`, `NAV_ITEMS`, `LOGO` in `js/app-shell.js` | Never called; pages own their shell markup. It would have reintroduced the fixed brand button if used |
| `const toast = document.getElementById('toast')` in `pipeline.html` and `calendar.html` | The element was deleted in an earlier phase; the reference was always `null` |
| `attachDropzoneListeners()` | Empty function called on every render |
| `.kanban-card.dragging`, `.kanban-drag-over`, `cursor: grab` | No drag-and-drop exists; the cursor promised an interaction that was not implemented |

**Broken control found while verifying M6.** The kanban card's "View details"
button did nothing: the card's click handler returned early for *every* `button`
(`if (e.target.closest('.dropdown, button')) return`), and nothing listened for
the view action. The button now opens the detail modal, its accessible name
includes the company (`View details for Aurora Health`), and the card no longer
carries `role="button"` around nested interactive controls — keyboard users use
the real button, mouse users can still click the card body.

**Measured.**

```
settings  -> confirm dialog: title, message, Continue/Cancel, focus on Continue
             Escape closes; focus returns to "Delete Everything"
             prompt: focus in input, wrong value keeps it open,
                     aria-invalid=true, inline error, Escape cancels
calendar  -> delete dialog opens after the detail modal closes; cancel removes it
pipeline  -> View details button opens the modal (previously did nothing)
interview -> delete dialog: "Delete interview round?" + round name
rendered pages: 0 emoji, 0 text-only icon containers
  analytics 4 stat icons (19x19 SVG) · dashboard 5 stat + 4 activity
  calendar 24 activity icons · companies 12 inline + 4 stat
  interview prep 18 inline + 4 stat · pipeline 8 inline
console: 0 errors on all eight workspace pages
```

**Tests.** No server behaviour changed; both suites are unchanged.

```
node test-suite.js  -> PASSED: 91 FAILED: 0
node test-auth.js   -> PASSED: 61 FAILED: 0
```

---

## 13. Phase 7 completion record — M9 + coverage

**M9 — `npm test` was a failing stub.** `server/package.json` contained
`echo "Error: no test specified" && exit 1`, so the first command a reviewer
runs failed. `npm test` now runs `test-runner.js`, which:

1. runs the static checks (no server needed);
2. starts a dedicated server on **port 3100** with `PORT` overridden;
3. waits up to 30 s for `/api/health` before running anything, so a missing
   database produces one clear message instead of connection errors;
4. runs both live suites against that instance;
5. sends `SIGTERM` and waits for the graceful shutdown it already implements.

Using a temporary instance is what makes the run deterministic: the in-memory
rate-limit windows and sessions start empty, so the sixth-failed-login test does
not inherit state from a server someone left running. `BASE_URL` targets an
existing server instead, and `TEST_PORT` changes the port.

**New static suite (`test-static.js`, 97 checks).** The live suites cannot see
the browser bundle, so a missing export or a renamed file only showed up as a
console error. The static suite parses every `js/*.js` module and every inline
`<script type="module">` block, then verifies that:

- each file is syntactically valid;
- every named import exists in the target module (this is the class of bug that
  produced the emoji/`icon` shadowing risk in Phase 6);
- every `<script src>` and stylesheet `href` points at a real file.

It caught one real gap immediately: `Dropdown` is exported as a class, which the
first version of the export parser did not recognise — fixed in the checker, not
by weakening the assertion.

**Coverage added.** `test-auth.js` grew from 61 to **66** assertions covering
interview-round privacy, which the brief requires for *every* private record:

```
owner can schedule an interview round
second user cannot read another user interview            -> 404
second user cannot update another user interview          -> 404
second user cannot delete another user interview          -> 404
second user cannot attach a round to another user's app   -> 404
```

**Verified totals.**

```
node test-static.js -> PASSED: 97  FAILED: 0
node test-suite.js  -> PASSED: 91  FAILED: 0
node test-auth.js   -> PASSED: 66  FAILED: 0
npm test (server/)  -> 3 suites pass, 23.9s
```

**Honest limits.** There is no browser automation suite. UI behaviour
(calendar event clicks, dialog focus/Escape/validation, icon rendering) was
verified manually with the headless browser during Phases 5–6 and is not
re-run by `npm test`. The static suite checks structure, not runtime behaviour.

---

## 14. Phase 8 completion record — documentation

Fourteen documents plus the README now describe what the code actually does.
Every number, flag and file path was checked against the source while writing;
three claims were corrected rather than left plausible:

| Claim drafted | Reality | Fix |
|---|---|---|
| CSV export prepends a UTF-8 BOM | No BOM is written | Documented the actual quoting and `text/csv;charset=utf-8` |
| Checklist index uses `Number.isInteger` | Uses `parseInt` plus a `NaN`/negative check | Corrected |
| `getAllApplications` fetches pages in parallel | Fetches sequentially with an empty-page guard | Snippet replaced with the real loop |

**Documents.**

| File | Contents |
|---|---|
| `01-overview.md` | Product, stack, interface tour, what it deliberately does not do |
| `02-requirements.md` | Functional, non-functional and data requirements with acceptance criteria |
| `03-architecture.md` | Components, request lifecycle, module map, data flow, topology |
| `04-database.md` | Collections, fields, indexes, ownership, example document, migrations |
| `05-api.md` | Every endpoint, parameters, error codes, pagination, date contract, curl |
| `06-frontend.md` | Pages, shared modules, components, tokens, responsive and a11y rules |
| `07-backend.md` | Middleware order, validation, authorisation, rate limits, startup |
| `08-security.md` | Threat model, controls, CSRF/CORS reasoning, known gaps |
| `09-algorithms.md` | Metric definitions, date parsing, history, pagination, calendar merge |
| `10-testing.md` | Runner, what each suite covers, what is verified manually |
| `11-deployment.md` | Env vars, systemd/nginx/Docker, checklist, rollback (not deployed) |
| `12-limitations.md` | Each limitation with the fix it would require |
| `13-decisions.md` | 18 ADRs with rejected alternatives |
| `14-interview-prep.md` | Question bank answered from this codebase, STAR stories |

**Verification.**

```
All relative links resolve (README.md + 15 files)
GET /docs/01-overview.md  -> 404
GET /README.md            -> 404
GET /server/.env          -> 404
GET /applications.html    -> 404
npm test                  -> 97 / 91 / 66 pass, 23.8s
8 workspace pages         -> 0 console errors
```

**Version control.** The working directory was not a repository when the audit
began, so no per-phase history exists. After the work was complete the owner
authorised initialising one, and the finished state is recorded as a single
initial commit (`ffc3469`, 61 files) on `main`. `.env`, `node_modules` and log
files are excluded by `.gitignore`. Nothing was pushed or deployed.

---

## 15. Pre-publication authentication review

A second review focused on passwords, sessions, and demo data, performed before
the first push.

### 15.1 Confirmed weaknesses and fixes

| Finding | Evidence | Fix |
|---|---|---|
| scrypt cost below current OWASP guidance | `N=16384, r=8, p=1` in `server/utils/password.js` | Raised to `N=65536, r=8, p=2` (64 MiB, two iterations) |
| Unknown-email timing defence was ineffective | The dummy hash decoded to a 3-byte key, so the scrypt work was negligible compared with a real 64-byte verification | A real dummy hash is generated at startup with the current parameters and verified for every unknown email |
| Legacy hashes verified faster than the dummy hash | Measurement: ~100 ms for an un-migrated account vs ~390 ms for an unknown email, leaking which accounts predate the upgrade | A 400 ms floor on failed responses; successful sign-ins are unaffected |
| No upgrade path for old hashes | Parameters were parsed for verification but never rewritten | `needsRehash()` plus a re-hash after a successful sign-in; verified by a unit assertion using an N=16384 hash |
| Demo password was hardcoded and published | `seed-demo.js` defaulted to a fixed password; README and testing docs repeated it | Removed from code and all docs; the script generates a strong password and prints it once |
| Demo seeding had no production guard | The script would seed any reachable server | Refuses without `--yes`; refuses `NODE_ENV=production`; checks `/api/health` for a production environment; refuses while legacy adoption is enabled |
| Password could be passed on the command line | `node seed-demo.js [email] [password]` exposed it in shell history and process listings | Password now comes only from a generated value or the `DEMO_PASSWORD` environment variable |

### 15.2 What was re-verified

| Check | Result |
|---|---|
| `passwordHash` never appears in an API response | Passes (`/me`, register, login) |
| Plaintext never stored or logged | No log statement prints a password; only the one-time seed output does |
| No password in browser storage | Only display preferences are written to `localStorage` |
| Cookie flags | `HttpOnly`, `SameSite=Lax`, `Path=/`; `Secure` under `NODE_ENV=production` |
| Session expiry and logout | Explicit expiry check plus TTL index; logout deletes the row and the suite proves the cookie stops working |
| Generic sign-in errors | Same `401` message for unknown email and wrong password |
| Rate limiting | Account and IP budgets; `429` with `Retry-After`; success resets the account budget |
| Ownership enforcement | Cross-user read/update/delete/attach all return `404`; analytics for the second account report zero |
| Demo isolation | The demo account is an ordinary user; seeding uses the normal `userId`-scoped API |
| History scan | No secret patterns; `.env` never committed; only `.env.example` appears in history |
| `.env.example` | Placeholders only, matching the variables the code reads |

### 15.3 Test totals after the review

```
node test-static.js -> PASSED: 97  FAILED: 0
node test-suite.js  -> PASSED: 91  FAILED: 0
node test-auth.js   -> PASSED: 83  FAILED: 0
npm test            -> 271 assertions, 25.0s
```

The auth suite now covers hash parameters, correct/wrong/tampered/malformed
verification, legacy hash upgrade, cookie flags, health policy fields, and both
demo-seeding refusals.

### 15.4 Remaining, stated rather than hidden

- `scryptSync` blocks the event loop for ~300 ms per verification. The rate
  limiter bounds this; a high-traffic deployment should move to async scrypt.
- No CSRF token (SameSite + JSON + CORS) and no CSP yet.
- The production refusal is tested locally; the server-reported production check
  is implemented and covered by reading `/api/health`, but no real production
  deployment was used to exercise it.
