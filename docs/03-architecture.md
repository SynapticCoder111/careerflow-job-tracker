# Architecture

CareerFlow is a two-tier application: one Express process serves JSON under
`/api` and static pages/assets for everything else, backed by a single MongoDB
database. There is no build step and no client-side framework.

```text
browser
  │  HTML (explicit page routes, auth-gated)
  │  /css/*, /js/*  (static allowlist)
  │  fetch JSON + session cookie
  ▼
Express 5 (server/server.js)
  ├── CORS + security headers + JSON body parsing
  ├── loadUser        (session cookie → req.user, never rejects)
  ├── /api/auth       register · login · logout · me · delete account
  ├── /api/applications  CRUD + bulk delete + audit history
  ├── /api/interviews    CRUD + checklist patch
  ├── /api/analytics     server-owned aggregates
  ├── page routes     landing · login · register · 8 private pages
  └── 404 page
        │
        ▼
     MongoDB
       users · sessions · applications · interviews
```

---

## 1. Request lifecycle

### 1.1 A page request

1. `app.use("/css", …)` and `app.use("/js", …)` handle asset requests before any
   auth work, so a stylesheet request never costs two database queries.
2. `loadUser` reads the `careerflow_session` cookie, hashes it, looks up the
   session (with expiry check), and attaches `req.user` when valid. It never
   throws and never blocks a request.
3. A private page route checks `req.user`. Signed out → `302 /login?next=…`.
   Signed in → `res.sendFile` for that one page.
4. Anything else falls through to the HTML 404.
5. The error handler converts unexpected failures into a JSON 500 without a
   stack trace.

### 1.2 An API request

1. `express.json({ limit: "1mb" })` parses the body.
2. A normalisation middleware turns a missing body into `{}`, so validation
   reports "companyName is required" rather than a `TypeError` (this was a real
   bug: bodyless `POST /api/auth/login` returned 500).
3. The router's `requireAuth` guard rejects anonymous callers with
   `401 { code: "UNAUTHENTICATED" }`.
4. The handler validates input, queries MongoDB **with `userId` in the filter**,
   and returns `{ success, data }`.
5. Mongoose validation errors become `400` with a field map; a missing record
   becomes `404`; duplicates become `409`.

### 1.3 Auth flow

```text
POST /api/auth/register
  validate name/email/password
  password → scrypt(salt) → "scrypt$N$r$p$salt$hash"
  User.create
  createSession → crypto.randomBytes(32) → sha256 → sessions.insert
  Set-Cookie: careerflow_session=<token>; HttpOnly; SameSite=Lax; Path=/[; Secure]

POST /api/auth/login
  account limiter (ip|email) → ip limiter
  User.findOne({ email }).select("+passwordHash")
  timing-safe scrypt compare
  on success: reset the account budget, create a new session

Every request afterwards
  cookie → parse → sha256 → Session.findOne({ tokenHash, expiresAt: { $gt: now } })
  → User.findById(session.userId) → req.user
```

Only the SHA-256 hash of the session token is stored, so a database dump cannot
be replayed as a live session.

---

## 2. Module map

### 2.1 Server

| File | Responsibility |
|---|---|
| `server/server.js` | App assembly, CORS, headers, static allowlist, page routes, startup/shutdown |
| `server/middleware/auth.js` | Cookie parsing, session creation/destruction, `loadUser`, `requireAuth` |
| `server/middleware/rateLimit.js` | Fixed-window limiter and the three auth policies |
| `server/routes/auth.js` | Register, login, logout, me, account deletion |
| `server/routes/applications.js` | CRUD, filtering/sorting/pagination, history, bulk delete |
| `server/routes/interviews.js` | CRUD, ownership checks against the parent application, checklist patch |
| `server/routes/analytics.js` | All aggregate definitions |
| `server/models/*.js` | Schemas, enums, indexes, JSON transforms |
| `server/utils/password.js` | scrypt hash/verify/validate |
| `server/utils/dateOnly.js` | Calendar-date storage and `YYYY-MM-DD` serialisation |

### 2.2 Browser

| File | Responsibility |
|---|---|
| `js/api.js` | One fetch wrapper, `ApiError`, all endpoint methods, pagination helper |
| `js/utils.js` | Formatting, date parsing, escaping, badges, toast, SVG `icon()` set, status history list |
| `js/app-shell.js` | Sidebar collapse/drawer, account menu, current-user chip, navigation |
| `js/dropdown.js` | Accessible listbox component (keyboard, ARIA, portal mode) |
| `js/dialog.js` | Native `<dialog>` confirmation and typed-confirmation helpers |
| `js/dashboard.js` | Dashboard rendering |
| `*.html` | One page each; inline module script holds page-specific logic |

### 2.3 Styles

| File | Responsibility |
|---|---|
| `css/design-system.css` | Tokens, reset, layout, components, modals, dialogs, tables, responsive rules |
| `css/landing.css` | Marketing page only |
| `css/pipeline.css` | Kanban board only |

---

## 3. Data flow for a rendered view

Every private page follows the same shape:

```text
DOMContentLoaded
  mountShell({ active, title })     ← navigation + user chip
  loadData()
     api.getAllApplications()       ← pages through the 100-row server cap
     optional api.getInterviews()
     render(data)                   ← template strings + escapeHtml for user text
```

Two rules keep the views consistent:

1. **The server owns definitions.** A page may format or group a value, but it
   does not invent a metric. Analytics headline numbers come from
   `/api/analytics/summary`.
2. **All user text is escaped.** `escapeHtml()` is applied to every value
   interpolated into a template. Attribute values are escaped too.

## 4. Persistence model

```text
User 1 ─── * Session        (deleted with the user)
User 1 ─── * Application    (userId index)
Application 1 ─── * Interview (applicationId index, plus userId for scoping)
```

`Application.statusHistory` is embedded, bounded to the last 100 transitions and
written only by the server. `Interview.preparationChecklist` is embedded and
updated in place by the checklist route.

See [04-database.md](04-database.md) for fields and indexes.

## 5. Cross-cutting decisions

| Concern | Decision | Consequence |
|---|---|---|
| Rendering | Server sends HTML; the browser renders from JSON with template strings | No hydration, no build step; escaping is a discipline enforced by review and tests |
| Auth | Opaque session token in an HttpOnly cookie, hash stored server-side | Revocable per session; no JWT signing keys to manage |
| Dates | Calendar dates stored at UTC midnight, transported as `YYYY-MM-DD` | A date never shifts by a timezone |
| Limits | Fixed-window, in-memory | Zero dependencies; per-instance and reset on restart (documented) |
| Static files | Only `/css` and `/js` are mounted | Backend source and `.env` are unreachable over HTTP |
| Metrics | Computed per request from the user's records | Always consistent with stored data; cost grows with record count (acceptable at this scale) |

## 6. Deployment topology

The simplest correct deployment is a single process behind TLS:

```text
client ──HTTPS──> reverse proxy / platform router
                        │
                        ▼
                 node server.js  (PORT)
                        │
                        ▼
                    MongoDB Atlas / self-hosted
```

If the browser bundle is served from a different origin, set `ALLOWED_ORIGIN`.
If a reverse proxy sets `X-Forwarded-For`, set `TRUST_PROXY=true` so the rate
limiter keys on the client address instead of the proxy.

See [11-deployment.md](11-deployment.md).
