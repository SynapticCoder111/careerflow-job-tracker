# Testing

Three suites, 254 assertions, one command. No test framework is installed; the
suites use Node's built-in `fetch`, `node --check` and plain assertions.

```bash
cd server
npm test
```

```
──────── test-static.js ────────   PASSED: 97   FAILED: 0
──────── test-suite.js ────────    PASSED: 91   FAILED: 0
──────── test-auth.js ────────     PASSED: 66   FAILED: 0
════════ SUMMARY ════════
PASS  test-static.js
PASS  test-suite.js
PASS  test-auth.js
All suites passed.
```

---

## 1. How the runner works

`test-runner.js` (invoked by `npm test`):

1. Runs `test-static.js` — no server, no database.
2. Starts `node server.js` with `PORT=3100` and waits up to 30 s for
   `/api/health`.
3. Runs `test-suite.js` and `test-auth.js` with `BASE_URL`.
4. Sends `SIGTERM`, waits for the graceful shutdown, and prints a summary.

Using a fresh instance is deliberate: rate-limit counters and sessions start
empty, so the rate-limit assertions do not inherit state from a server someone
left running.

| Variable | Default | Effect |
|---|---|---|
| `TEST_PORT` | `3100` | Port for the temporary instance |
| `BASE_URL` | — | Test an already-running server; no process is spawned |
| `TEST_VERBOSE` | — | Print the server's stdout/stderr |

If the database is unreachable, the runner fails once with the server's output
instead of letting 200 requests fail one by one.

## 2. Static suite — 97 checks

`test-static.js` covers what the live API cannot see.

| Section | Checks |
|---|---|
| Module syntax | Every `js/*.js` parses (`node --check`) |
| Inline script syntax | Every `<script type="module">` block parses (written to a temp `.mjs`) |
| Imports resolve | Every named import exists in the target module's exports |
| Asset references | Every `<script src>` and stylesheet `href` exists on disk |

Why the import check matters: a renamed or missing export produces an empty page
and one console error. The checker turns that into a failed test. It caught a
real gap in its own first version — `export class Dropdown` was not recognised —
which was fixed in the checker rather than by weakening the assertion.

## 3. Workspace suite — 91 assertions

`test-suite.js` registers a unique account, then exercises the product.

| Section | Representative assertions |
|---|---|
| 1. Authentication | Register `201`, cookie set, `/me` authenticated |
| 2. Application CRUD | Create/read/update, `id` stability, tags, salary, date-only fields, history seeded, forged history ignored, one entry per transition, no duplicate on re-save |
| 3. Validation & errors | Missing company → 400, bad enum → 400, bad ObjectId → 400, missing → 404, unknown route → 404 |
| 4. Search/filter/sort/page | Search by company, role, location, tag; each filter; combined filters; asc/desc sort; page size; last page; **limit capped at 100** |
| 5. Analytics | Totals, breakdowns, denominators, rates, `null` average with no data, `responded`, `inProgress`, `followUpsPastDue` present and the misleading `followUpsCompleted` absent |
| 6. Interviews | Create, list, filter by application, update, date-only transfer, parent link preserved, checklist toggle, missing app → 404, no appId → 400, bad type → 400 |
| 7. Cascade delete | Application deleted, rounds removed, no orphans |
| 8. Bulk delete | Without confirmation → 400 `CONFIRMATION_REQUIRED` and records untouched; with confirmation → correct counts and empty workspace |
| 9. Logout | `200`, then the session is invalid (`401`) |

The suite creates and deletes its own records. It does not touch the demo
account.

## 4. Auth suite — 66 assertions

`test-auth.js` is about boundaries rather than happy paths.

| Section | What it proves |
|---|---|
| 1. Public routes | `/`, `/login`, `/register` are `200`; the landing page has no fake testimonials or invented user counts |
| 2. Protected pages | All eight private routes redirect to `/login` when signed out |
| 3. Protected APIs | Applications, interviews and analytics return `401` for anonymous callers |
| 4. Registration | `201`, duplicate → `409`, weak password → `400`, **bodyless request → `400` not `500`** |
| 5. Isolation | Second user sees an empty workspace; read/update/delete of a foreign application → `404`; read/update/delete of a foreign round → `404`; attaching a round to a foreign application → `404`; bulk delete removes only the caller's records; analytics for the second user report zero and `null` rates |
| 6. Login/logout | Wrong password `401`, bodyless login `400`, correct password `200`, cookie grants access, logout invalidates the session |
| 7. Rate limiting | Five failures `401`, sixth `429` with `code: RATE_LIMITED`, a different account is unaffected, a success resets the budget |
| 8. Password hashing | `passwordHash` never appears in a response |

The isolation section is the one to read when reviewing authorisation: it proves
the server, not the UI, is enforcing ownership.

## 5. What is *not* automated

Honesty matters more than a green badge:

| Area | Status |
|---|---|
| Browser UI behaviour (dialogs, keyboard, calendar clicks, icon rendering) | Verified manually with a headless browser during development; not re-run by `npm test` |
| Visual regression / screenshots | Not automated |
| Lighthouse | Run manually; results recorded in `README.md` |
| Multi-instance rate limiting | Not testable in a single-process suite (documented limitation) |
| Email flows | Not implemented |
| Load/performance | Not measured beyond the complexity analysis in [09-algorithms.md](09-algorithms.md) |

The static suite partially compensates for the missing browser layer: broken
imports, missing exports and dead asset paths fail the build.

## 6. Manual verification performed

| Check | Result |
|---|---|
| All ten pages load with zero console errors | Confirmed |
| Landing → register → dashboard → create → edit → detail → delete → sign out → landing | Confirmed |
| Create with 105 records: dashboard/analytics/companies/pipeline/calendar each see 105 | Confirmed |
| Status history: create → Applied → Interview shows three entries, newest first | Confirmed |
| Calendar shows all six interview rounds and no duplicate same-day legacy entry | Confirmed |
| Event row click and Enter open the detail modal | Confirmed |
| Confirm dialog: focus lands on the action, Escape closes, focus returns | Confirmed |
| Typed confirmation: wrong value stays open with `aria-invalid`, error announced | Confirmed |
| Pipeline "View details" button opens the modal (previously did nothing) | Confirmed |
| Zero emoji in rendered text; every icon container holds an SVG | Confirmed |
| Widths 320, 360, 390, 768, 1024, 1440 px: no horizontal scroll | Confirmed |
| Lighthouse: 1.0 accessibility / best practices / SEO on eleven pages | Confirmed |

## 7. Test data and fixtures

- Every run uses a timestamped email (`suite.<ms>@example.com`,
  `sam.<ms>@example.com`), so runs never collide.
- The suite deletes what it creates; the last section asserts an empty
  workspace.
- `seed-demo.js` is separate and idempotent enough for repeated use:
  `demo@careerflow.app` / `careerflow2026`, ten applications and six rounds.

## 8. Adding a test

1. **Behaviour** → `test-suite.js` in the matching section.
2. **Boundary/authorisation** → `test-auth.js`, including the cross-user case.
3. **Structure** (new module, import or asset) → nothing to add; the static
   suite discovers it automatically.
4. Run `cd server && npm test`. A suite that only passes against a warm server
   is not done.
