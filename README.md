# CareerFlow — Your Career, Organized

A premium job-search workspace for students, graduates, and professionals. Organise every application, track interview stages, plan follow-ups, prepare for each round, and see exactly how far you've come — with real data, behind a real account.

**Stack:** Node.js · Express · Mongoose · MongoDB Atlas · Vanilla JS (ES modules) · CSS design system

---

## Quick Start

```bash
# Windows — just double-click
start.bat
```

`start.bat` checks for Node.js, installs server dependencies on first run, verifies your `.env`, starts the server in a minimized window, waits for the health check, and opens your browser at <http://localhost:3000>.

To stop it, run `stop.bat` or close the minimized server window.

### Manual start

```bash
cd server
npm install
npm start
# open http://localhost:3000
```

---

## Configuration

Create `server/.env` (already present in this repo, and git-ignored). A
commented template lives at `server/.env.example`.

```env
MONGODB_URI=your_mongodb_connection_string
PORT=3000
```

Optional settings, all documented in `server/.env.example`:

| Variable | Default | Purpose |
|---|---|---|
| `ALLOWED_ORIGIN` | unset | Comma-separated origins allowed to call the API cross-origin. Unset in production = cross-origin disabled (fail closed). |
| `NODE_ENV` | `development` | `production` enables fail-closed CORS and disables the dev origin list. |
| `TRUST_PROXY` | `false` | Set to `true` only behind a reverse proxy, so rate limiting sees the client IP. |
| `ALLOW_LEGACY_ADOPTION` | `false` | One-time migration for records created before accounts existed. Leave unset. |
| `MONGO_TIMEOUT_MS` | `10000` | How long startup waits for MongoDB before refusing to start. |

`MONGODB_URI` must be a valid MongoDB connection string. For MongoDB Atlas, copy it from **Cluster → Connect → Drivers**, and URL-encode any special characters in the password (`@` → `%40`, `:` → `%3A`, `/` → `%2F`).

`ALLOWED_ORIGIN` is optional. The frontend is served by the same process, so
normal requests are same-origin and need no CORS. Set it only when a separate
origin must reach the API; if it is unset in production, no cross-origin access
is granted rather than reflecting any caller.

> **Security note:** `.env` contains your database credentials and is excluded from version control by `.gitignore`. Never commit it, never place it in frontend code, and never share it publicly.

---

## Project Structure

```text
careerflow/
├── landing.html            # Public marketing page
├── login.html              # Sign in
├── register.html           # Create an account
├── 404.html
│
├── dashboard.html          # Workspace overview
├── applications.html       # Application management (CRUD, search, filter, sort, paginate)
├── pipeline.html           # Kanban pipeline
├── calendar.html           # Interviews, deadlines, follow-ups
├── companies.html          # Company workspace
├── interview-prep.html     # Interview preparation
├── analytics.html          # Job-search analytics
├── settings.html           # Preferences, import/export, account
│
├── start.bat / stop.bat    # One-click launch helpers
├── seed-demo.js            # Seeds the demo account, applications and rounds
├── test-runner.js          # `npm test`: starts a temporary server, runs all suites
├── test-static.js          # Module syntax, imports and asset references (97 checks)
├── test-suite.js           # Workspace API tests (91 assertions)
├── test-auth.js            # Auth, routing, rate-limit & isolation tests (66 assertions)
├── docs/                   # 00-audit … 14-interview-prep
│
├── css/
│   ├── design-system.css   # Tokens + components (colour, type, buttons, forms, dropdown, modal…)
│   ├── landing.css         # Marketing + auth page styles
│   └── pipeline.css        # Kanban, charts, timeline, stat cards
│
├── js/
│   ├── api.js              # Centralised fetch wrapper (ApiError, pagination helper)
│   ├── utils.js            # Dates, status colours, escaping, toast, SVG icon set
│   ├── dropdown.js         # Accessible listbox (keyboard, ARIA, portal, capped height)
│   ├── dialog.js           # Native <dialog> confirm / typed-confirm helpers
│   ├── app-shell.js        # Shared workspace shell (sidebar, drawer, account menu)
│   └── dashboard.js        # Overview page rendering
│
└── server/
    ├── server.js           # Express app, page routing, security headers, readiness gating
    ├── .env                # Secrets (git-ignored)
    ├── .env.example        # Documented template for every supported variable
    ├── package.json
    ├── models/
    │   ├── User.js         # Account (scrypt hash, never serialised)
    │   ├── Session.js      # Server-side sessions (hashed tokens, TTL index)
    │   ├── Application.js  # Mongoose schema (validated enums, virtual `id`)
    │   └── Interview.js    # Interview rounds linked to an application
    ├── middleware/
    │   ├── auth.js         # loadUser, requireAuth, session create/destroy
    │   └── rateLimit.js    # In-process fixed-window limiter (no dependency)
    ├── routes/
    │   ├── auth.js         # register / login / logout / me / delete account
    │   ├── applications.js # CRUD, search, filter, sort, pagination (user-scoped)
    │   ├── interviews.js   # Interview rounds (user-scoped)
    │   └── analytics.js    # Aggregate metrics with explicit denominators
    └── utils/
        ├── password.js     # scrypt hashing + strength rules
        └── dateOnly.js     # Calendar-date storage and YYYY-MM-DD serialisation
```

---

## Pages

| Route | Access | Purpose |
|-------|--------|---------|
| `/` | Public | Marketing page — hero, product preview, bento features, workflow, interactive demo, benefits, showcase, FAQ, CTA, footer |
| `/login` | Public | Sign in |
| `/register` | Public | Create an account |
| `/dashboard` | Private | Overview — metrics, activity chart, pipeline, upcoming, recent, attention |
| `/applications` | Private | Full CRUD, search, filters, sorting, pagination, detail modal |
| `/pipeline` | Private | Kanban board grouped by stage, status dropdown per card |
| `/calendar` | Private | Upcoming events, agenda by date, overdue follow-ups |
| `/companies` | Private | Applications grouped by company, with a detail modal |
| `/interview-prep` | Private | Rounds, topics, questions, checklists, outcomes |
| `/analytics` | Private | Real metrics, breakdowns, charts |
| `/settings` | Private | Preferences, CSV export/import, JSON backup, delete data or account |

Private pages redirect to `/login` when signed out. Private APIs return `401`.

---

## Features

### Application shell
- Left sidebar with a **CareerFlow brand toggle** — click the wordmark to slide the sidebar away and give the page the full width, click again to bring every navigation option back
- Compact top bar with a matching hamburger, search, and contextual actions
- Sidebar becomes an overlay drawer below 768px; the brand closes it
- Tables convert to cards; less-critical columns hide progressively

### Applications (core)
- Create, view, edit, and delete with a confirmation dialog
- Full field set: company, role, status, dates, URLs, location, work mode, employment type, salary, recruiter details, source, priority, notes, tags
- Debounced search across company, role, location, recruiter, and tags
- Filters: status, work mode, employment type, source, priority — combinable, individually removable, resettable
- Sorting: recent, oldest, company, role, interview date, follow-up date, priority
- Backend pagination with page/total display
- Responsive: table on desktop, cards on mobile
- Detail modal with safe external links, edit/delete actions

### Pipeline
- Kanban board grouped by the seven statuses
- Change status from an accessible dropdown on each card (no drag-and-drop dependency)
- Card shows company, role, application date, priority, next important date

### Calendar & follow-ups
- Upcoming events (next 30 days), agenda grouped by date, and an overdue list
- Covers interview rounds from Interview Prep, plus application interviews, assessment deadlines, application deadlines, and follow-ups
- A round and a legacy `interviewDate` on the same day are shown once, not twice
- No hidden caps: every event in the window is listed, and event rows are keyboard-operable

### Status history
- Every status change is recorded server-side with a timestamp (`statusHistory`)
- The detail modal shows the full trail newest-first, e.g. `Applied → Interview · Oct 20, 2026, 11:56 PM`
- History is created and updated by the server only — clients cannot submit or rewrite it
- Records created before this feature honestly say "No status changes recorded yet."

### Companies
- Applications grouped by company, derived from your records
- Application count, active count, status breakdown, latest activity, recruiter contacts
- Searchable, with a company detail modal

### Dropdowns
Every dropdown is a shared component (`js/dropdown.js`) rather than a native `<select>`:
- Anchored to its trigger, right-aligned for toolbar menus
- **Always opens downward**; when space is tight it caps its height and scrolls internally rather than flipping above the trigger
- A "portal" mode renders the menu on `<body>` so scrollable ancestors (e.g. a Kanban column) can never clip it
- Full keyboard support: arrows, Home/End, Enter, Escape, type-ahead
- ARIA listbox semantics with `aria-expanded` / `aria-activedescendant`

### Interview preparation
- Multiple rounds per application, each with type, date, round, interviewer, location
- Topics to prepare, questions to ask, personal notes, next steps
- Persisted preparation checklist with live progress
- Outcome tracking (Pending / Passed / Failed / Rescheduled / Withdrawn)

### Analytics (real data only)
- Computed once, on the server: the page renders `/api/analytics/summary` instead of recalculating metrics in the browser
- Total, in-progress, interviews, offers, follow-ups scheduled and past due
- Interview, offer, and response conversion rates — **each with its denominator shown**
- Average time to interview, with the sample size it is based on
- Breakdowns by status, source, work mode, employment type, priority
- Applications over time, stage funnel, status donut, top-company table
- Empty states instead of misleading zeroes when data is insufficient
- There is deliberately **no "time to offer" metric**: no offer timestamp is stored, so any such number would be invented

### Settings
- Display name, default view, default sorting, date format (stored in the browser)
- Export all applications as CSV
- Download a full JSON backup
- Import a CSV with per-row validation — rejected rows are listed, never silently dropped
- Delete all application data (keeps the account)
- Delete the account and everything in it

---

## Authentication

Real authentication — not a mock.

- **Password hashing:** Node's built-in `scrypt` (OWASP-recommended, memory-hard) with a random 16-byte salt and timing-safe comparison. No plaintext is ever stored or logged.
- **Sessions:** a random 256-bit token is issued in an `HttpOnly`, `SameSite=Lax` cookie. Only the SHA-256 hash of the token is stored in MongoDB, with a TTL index for expiry. A database leak cannot be replayed as a valid session.
- **Per-user isolation:** every application and interview query is scoped by `req.user._id`, enforced server-side. Ownership is never trusted from the client, and it cannot be reassigned through the API.
- **Logout** destroys the session server-side and clears the cookie.
- **Rate limiting:** failed sign-ins are capped at 5 per 15 minutes per address+email, with a coarser 100 per 15 minutes per network, and registrations at 60 per hour per network. Blocked requests receive `429` with `Retry-After`. A correct password clears that account's failure budget. Counters are in-process, so they reset on restart and are per instance — a multi-instance deployment would need a shared store.
- **Legacy data:** records created before accounts existed are **not** adopted by default. The one-time migration runs only when an operator sets `ALLOW_LEGACY_ADOPTION=true`, because on a shared database it would hand one person another person's records.
- **Deleting an account** removes the user, their applications, their interview rounds, and their sessions.

Password reset, email verification, and third-party OAuth are **not implemented** and are not shown in the UI.

### Route protection and static assets

HTML is served only through the explicit page routes in `server/server.js`; the project root is never exposed. Only `/css` and `/js` are mounted as static directories, so backend source, tests, seed scripts, `node_modules`, and environment files cannot be downloaded. Private page routes return `302 /login?next=…` when signed out, and raw `.html` paths return `404`. In-app links use the clean routes (`/applications`, not `applications.html`).

---

## API Reference

Base URL: `http://localhost:3000`. All `/api/applications`, `/api/interviews`, and `/api/analytics` routes require a valid session.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Service health check |
| POST | `/api/auth/register` | Create an account (201) |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | End the session |
| GET | `/api/auth/me` | Current session (or `null`) |
| DELETE | `/api/auth/account` | Delete the account and its data |
| GET | `/api/applications` | List — `search`, `status`, `workMode`, `employmentType`, `jobSource`, `priority`, `sort`, `page`, `limit` |
| GET | `/api/applications/:id` | Fetch one application |
| POST | `/api/applications` | Create (201) |
| PUT | `/api/applications/:id` | Update (never changes identity or owner) |
| DELETE | `/api/applications` | Delete **all** of the user's applications and interview rounds. Requires body `{ "confirm": "DELETE" }`; otherwise `400 CONFIRMATION_REQUIRED`. Returns `deletedApplications` / `deletedInterviews`. |
| DELETE | `/api/applications/:id` | Delete (cascades to interview rounds) |
| GET | `/api/interviews` | List — `applicationId`, `outcome`, `interviewType`, `upcoming` |
| GET | `/api/interviews/:id` | Fetch one round |
| POST | `/api/interviews` | Create a round (requires a valid `applicationId`) |
| PUT | `/api/interviews/:id` | Update a round (`applicationId` is immutable) |
| PATCH | `/api/interviews/:id/checklist/:index` | Toggle one checklist item |
| DELETE | `/api/interviews/:id` | Delete a round |
| GET | `/api/analytics/summary` | Aggregate metrics with explicit denominators, per-dimension counts, `responded`, `inProgress`, `followUpsPastDue` |

### Response conventions

**Success**
```json
{ "success": true, "message": "Application created successfully", "data": { "id": "…", "companyName": "…" } }
```

**List**
```json
{ "success": true, "data": [ … ], "total": 8, "page": 1, "limit": 20, "totalPages": 1 }
```

**Pagination contract** — `limit` is clamped to **100**. Screens that aggregate
the whole workspace (dashboard, pipeline, companies, calendar, analytics,
interview prep, CSV/JSON export) call `getAllApplications()` in `js/api.js`,
which walks every page instead of asking for an oversized limit. A single
request never returns more than 100 rows by design.

**Calendar dates** — `applicationDate`, `followUpDate`, `interviewDate` and
`deadline` are transferred as `YYYY-MM-DD`, not timestamps. They are stored at
UTC midnight, and the client parses them as local calendar dates, so "15
September" stays 15 September in every timezone. `createdAt` and `updatedAt`
remain full instants.

**Status history** — every application carries
`statusHistory: [{ from, to, at }]`. `at` is a real instant. The server appends
an entry whenever `status` changes on `PUT` and seeds the first entry on
`POST`; any `statusHistory` value sent by a client is discarded.

**Error**
```json
{ "success": false, "message": "Validation failed", "errors": { "companyName": "Company name is required" } }
```

Status codes: `200` success · `201` created · `400` invalid input / bad ObjectId · `401` not signed in · `404` not found · `409` duplicate email · `500` server error (never leaks stack traces).

**Identifier compatibility** — responses always expose a stable `id` string mapped from MongoDB's `_id`. `_id` and `__v` are never returned.

---

## Testing

```bash
cd server && npm test   # starts a temporary server on :3100, runs both suites, shuts it down
```

The runner (`test-runner.js`) waits for `/api/health` before running anything, so a missing database fails with a clear message instead of a wall of connection errors. Rate-limit windows and sessions start empty on every run, which keeps the results deterministic.

```bash
node test-static.js    # syntax, import/export resolution, asset paths (97 checks, no server)
node test-suite.js    # workspace API (91 assertions) — against an already-running server
node test-auth.js     # auth, routing, rate limiting, isolation (66 assertions)
node seed-demo.js     # optional: a demo account with 10 applications + 6 interview rounds
```

Set `BASE_URL` to point the suites at another host, or `TEST_PORT` to change the runner's port.

`seed-demo.js` creates `demo@careerflow.app` / `careerflow2026` so every page can be explored with realistic data.

**Verified results**

- [x] Server starts and MongoDB connects
- [x] Applications and interview rounds persist across server restarts
- [x] Create / read / update / delete all work against MongoDB
- [x] Editing never creates a duplicate record
- [x] Deleting an application cascades to its interview rounds (no orphans)
- [x] Search, filters, and sorting work individually and combined
- [x] Pagination reports page and total, and pages through the 100-row cap for aggregate views
- [x] Status changes update the database and move the Kanban card
- [x] Every status change is recorded with a timestamp; clients cannot rewrite the trail
- [x] Interview rounds appear on the calendar, deduplicated against legacy interview dates
- [x] Invalid input rejected with field-level messages
- [x] Empty states render instead of misleading zeroes
- [x] One user can never read, update, or delete another user's records or interview rounds
- [x] Logout invalidates the session immediately
- [x] Duplicate email registration is rejected with a clear message
- [x] Passwords are never stored or returned in plaintext
- [x] Destructive actions use an accessible confirmation dialog with focus management
- [x] One SVG icon system — no emoji in the interface
- [x] External links use `rel="noopener noreferrer"`
- [x] No secrets committed or exposed to the frontend; backend source and docs are not routable

**Lighthouse** — all 11 pages score **1.0 / 1.0 / 1.0** (accessibility / best practices / SEO), with zero console errors and zero failed resource loads.

**Responsive** — audited at 320, 360, 390, 768, 1024, and 1440px: no horizontal page scroll, no clipped text, no tap target under 24px, and the workspace shell (sidebar → drawer, table → cards) adapts at every size.

**End-to-end journey** — landing → register → dashboard → create → edit → detail → delete → sign out → landing verified in the browser, including the `?next=` redirect on sign-in and the session being invalidated on sign-out.

---

## Accessibility & Responsive Design

- Semantic landmarks (`main`, `nav`, `header`, `aside`), one `h1` per page, sequential heading order
- Labelled inputs, visible focus rings, `aria-label`s on icon-only buttons
- Dropdowns are fully keyboard-operable (arrows, Home/End, Enter, Escape, type-ahead) with ARIA listbox semantics
- Destructive actions use a native `<dialog>` (`js/dialog.js`): labelled title and body, focus contained and restored, Escape/backdrop to cancel, inline validation for typed confirmation
- One SVG icon system (`icon()` in `js/utils.js`) — no emoji anywhere in the interface
- Status is conveyed by text and badge, never colour alone
- `prefers-reduced-motion` respected throughout
- Sidebar collapses on desktop and becomes a drawer on mobile
- Tables convert to cards under 900px; less-critical columns hide progressively

---

## Deployment

The frontend and backend are served by the same Express process, so a single host works:

1. Set `MONGODB_URI`, `PORT` and `NODE_ENV=production` as environment variables. Add `ALLOWED_ORIGIN` only if the frontend is served from a different origin.
2. Run `npm install --omit=dev` in `server/`
3. Start with `npm start`. The process connects to MongoDB **before** it listens; if the database is unreachable it exits with a non-zero code instead of accepting requests it cannot serve.
4. Point your domain/proxy at the app and serve over HTTPS

Behind a reverse proxy, set `TRUST_PROXY=true` so `req.ip` reflects the client and rate limiting works. `SIGINT`/`SIGTERM` close the HTTP listener and the database connection before exit.

---

## Troubleshooting

**"MongoDB connection failed: bad auth"**
The password in `MONGODB_URI` is wrong. Re-copy the connection string from Atlas and URL-encode special characters.

**"Invalid connection string"**
The URI is malformed. It must be `mongodb+srv://user:pass@host/db?options` or `mongodb://user:pass@host1,host2/db?options` — exactly one `@`, and no extra `@` inside the credentials.

**"EADDRINUSE" / port already in use**
Another server is on port 3000. Run `stop.bat`, or change `PORT` in `server/.env`.

**Redirected to /login unexpectedly**
Your session expired (30 days) or the cookie was cleared. Sign in again.

**Page loads but shows no data**
Check the browser console for a failed request, then hit `http://localhost:3000/api/health`. If that fails, the server isn't running.

**Blank page / unstyled**
Open the app through `http://localhost:3000`, not by double-clicking the HTML file — `file://` breaks ES module imports and relative API calls.

---

## Documentation

| Document | Contents |
|---|---|
| [`docs/00-audit-report.md`](docs/00-audit-report.md) | Repository audit: confirmed issues by severity, evidence, risks, phased plan, and the completion record for each phase |
| [`docs/01-overview.md`](docs/01-overview.md) | What the product is, the stack, and a tour of the interface |
| [`docs/02-requirements.md`](docs/02-requirements.md) | Functional and non-functional requirements with the test or file that proves each one |
| [`docs/03-architecture.md`](docs/03-architecture.md) | Components, request lifecycle, module map, data flow, deployment topology |
| [`docs/04-database.md`](docs/04-database.md) | Collections, fields, indexes, relationships, date storage, example documents |
| [`docs/05-api.md`](docs/05-api.md) | Every endpoint, parameters, responses, error codes, and curl examples |
| [`docs/06-frontend.md`](docs/06-frontend.md) | Pages, shared modules, rendering rules, components, design tokens, accessibility |
| [`docs/07-backend.md`](docs/07-backend.md) | Middleware order, validation, authorisation, rate limiting, startup/shutdown |
| [`docs/08-security.md`](docs/08-security.md) | Threat model, auth, sessions, hashing, CORS, headers, known gaps |
| [`docs/09-algorithms.md`](docs/09-algorithms.md) | Metric definitions, date handling, history, pagination, calendar merge, rate limiting |
| [`docs/10-testing.md`](docs/10-testing.md) | How to run the suites, what each covers, what is verified manually |
| [`docs/11-deployment.md`](docs/11-deployment.md) | Environment variables, process management, reverse proxy, post-deploy checklist |
| [`docs/12-limitations.md`](docs/12-limitations.md) | Honest limitations with the fix each one would require |
| [`docs/13-decisions.md`](docs/13-decisions.md) | Architecture decision records with rejected alternatives |
| [`docs/14-interview-prep.md`](docs/14-interview-prep.md) | Question bank with answers tied to this codebase |
