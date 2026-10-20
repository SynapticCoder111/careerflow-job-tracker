# Backend

Express 5, CommonJS, MongoDB through Mongoose 9. One process serves the API and
the pages. No build step.

```
server/
  server.js              app assembly, routes, startup/shutdown
  middleware/
    auth.js              cookies, sessions, loadUser, requireAuth
    rateLimit.js         fixed-window limiter + auth policies
  models/
    User.js  Session.js  Application.js  Interview.js
  routes/
    auth.js  applications.js  interviews.js  analytics.js
  utils/
    password.js          scrypt hash/verify/validate
    dateOnly.js          calendar-date storage and serialisation
```

---

## 1. Application assembly (`server/server.js`)

Middleware order is deliberate:

| Order | Middleware | Why here |
|---|---|---|
| 1 | `app.disable("x-powered-by")` | Do not advertise the framework |
| 2 | Optional `trust proxy` | Only when `TRUST_PROXY=true`; otherwise a client could spoof `X-Forwarded-For` and bypass rate limits |
| 3 | CORS | Explicit allowlist; fails closed in production |
| 4 | `express.json({ limit: "1mb" })` | Bounded body parsing |
| 5 | Body normalisation | Express 5 leaves `req.body` undefined without a body; handlers must see `{}` |
| 6 | Security headers | `nosniff`, `SAMEORIGIN`, referrer policy, permissions policy |
| 7 | Static `/css`, `/js` | Before auth so asset requests cost no database queries |
| 8 | `loadUser` | Resolves the session once for everything that follows |
| 9 | `/api/*` routers | Each router applies `requireAuth` itself |
| 10 | `/api` 404 | JSON, not HTML |
| 11 | Page routes | Explicit allowlist of ten pages |
| 12 | HTML 404 | Everything else |
| 13 | Error handler | Generic JSON 500, stack traces logged only server-side |

### 1.1 Static allowlist

Only two directories are mounted:

```js
const PUBLIC_ASSET_DIRS = {
  "/css": path.join(ROOT, "css"),
  "/js": path.join(ROOT, "js"),
};
```

`ROOT` itself is never served. As a result `/server/server.js`,
`/server/.env`, `/seed-demo.js`, `/test-suite.js`, `/README.md` and
`/node_modules/...` all return 404. `dotfiles: "deny"` and `index: false` close
the remaining edge cases, and assets are sent with `Cache-Control: no-cache` so
a changed module is never stale during review.

### 1.2 Page routes

```js
const PRIVATE_PAGES = [
  ["/dashboard", "dashboard.html"],
  ["/applications", "applications.html"],
  ["/pipeline", "pipeline.html"],
  ["/calendar", "calendar.html"],
  ["/companies", "companies.html"],
  ["/interview-prep", "interview-prep.html"],
  ["/analytics", "analytics.html"],
  ["/settings", "settings.html"],
];
```

Each checks `req.user` and redirects to `/login?next=<encoded path>` when
signed out. HTML is *only* reachable through these routes, which is what makes
the redirect effective; serving the directory statically would let anyone fetch
`/applications.html` directly.

### 1.3 CORS

| Environment | `ALLOWED_ORIGIN` | Behaviour |
|---|---|---|
| Any | comma-separated list | Those origins, `credentials: true` |
| Production | unset | **No CORS headers** (fail closed). Same-origin use still works |
| Development | unset | `http://localhost:PORT` and `http://127.0.0.1:PORT` |

### 1.4 Startup and shutdown

```js
async function start() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS });
  httpServer = app.listen(PORT);
}
```

- `MONGODB_URI` missing → exit 1 before anything listens.
- Connection failure → exit 1 with a clear message. Requests never reach a
  half-initialised process.
- `SIGINT`/`SIGTERM` → stop accepting connections (`httpServer.close`), then
  `mongoose.disconnect()`, then exit 0. A second signal is a no-op.

This is what lets `test-runner.js` start and stop an instance deterministically.

---

## 2. Authentication (`middleware/auth.js`)

| Concern | Implementation |
|---|---|
| Cookie name | `careerflow_session` |
| Token | `crypto.randomBytes(32)` → 256 bits, base64url |
| Stored value | SHA-256 hash only |
| Lifetime | 30 days, `expiresAt` also indexed as a TTL |
| Flags | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production |
| Logout | Session row deleted, cookie cleared |

`loadUser` never rejects: a missing, malformed or expired cookie simply leaves
`req.user` undefined. `requireAuth` is the only place that turns that into a
`401`.

Session lookup:

```js
Session.findOne({ tokenHash, expiresAt: { $gt: new Date() } })
  .then(session => session && User.findById(session.userId))
```

The expiry check is explicit because MongoDB's TTL monitor runs about once a
minute; relying on it alone would accept a session for up to a minute past
expiry.

## 3. Authorisation

There is one rule: **`userId` always comes from the session and is always part
of the query filter.**

| Operation | Filter |
|---|---|
| List | `{ userId: req.user._id }` |
| Read one | `{ _id, userId }` |
| Update | `{ _id, userId }` |
| Delete | `{ _id, userId }` |
| Bulk delete | `{ userId }` |
| Interview create | Parent must satisfy `{ _id: applicationId, userId }` |
| Interview read/update/delete | `{ _id, userId }` |
| Analytics | `{ userId }` |

Foreign records return **404**, not 403: the API does not confirm that a record
exists. Body-supplied `userId` is deleted before validation on every route.
`test-auth.js` §5 exercises each of these paths with a second account.

## 4. Validation

Validation happens in the route before writing, and again in Mongoose through
schema constraints.

| Input | Rule |
|---|---|
| Name | Required, trimmed, ≤ 80 |
| Email | Required, regex `^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`, lowercased, unique |
| Password | ≥ 8 characters, at least one letter and one digit |
| ObjectId | `mongoose.Types.ObjectId.isValid` → `400` |
| Enums | Mongoose enum plus route-level validation for status |
| Strings | Schema `maxlength` per field |
| Numbers | `salaryMin`/`salaryMax` ≥ 0 |
| Body size | 1 MB |

Mongoose `ValidationError` is converted to:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": { "companyName": "Company name is required" }
}
```

`validationDetails()` builds that map from `err.errors`.

## 5. Applications route

- **Search** escapes regex metacharacters before building `new RegExp(term, "i")`
  — without this, `(` or `*` from a search box becomes a 500.
- **Filters** are exact matches on enum fields and combine with `$and`
  semantics (each assigned to the filter object).
- **Sort** is a whitelist; an unknown field falls back to `createdAt: -1`.
- **Pagination** clamps `page ≥ 1` and `limit` to 1–100; `total` comes from
  `countDocuments` in parallel with the page query.
- **History** is written server-side (see [09-algorithms.md](09-algorithms.md#3-status-history)).
- **Bulk delete** requires `{ "confirm": "DELETE" }` and deletes applications
  and rounds in parallel, scoped to the user.

## 6. Interviews route

- `POST` validates the parent application's ownership before creating the round.
- `PUT` removes `applicationId`, `userId` and identity fields, so a round cannot
  be re-parented.
- `PATCH /:id/checklist/:index` toggles a single item; the index must be an
  integer within the array.
- `DELETE` is scoped; a foreign round is a 404.
- `GET` sorts by `interviewDate` ascending, which is the order the preparation
  workspace and the calendar expect.

## 7. Analytics route

All aggregates are computed from `Application.find({ userId }).lean()` and one
`Interview.countDocuments({ userId })`. Definitions live in this file only; the
client renders what it receives. See
[09-algorithms.md](09-algorithms.md#2-analytics).

## 8. Rate limiting (`middleware/rateLimit.js`)

Fixed-window counters in a `Map`, no dependency.

| Policy | Key | Limit | Window |
|---|---|---|---|
| Login failures | `ip|email` | 5 | 15 min |
| Login attempts | IP | 100 | 15 min |
| Registration | IP | 60 | 1 hour |

- A rejected request gets `429`, `Retry-After: <seconds>`, and
  `{ code: "RATE_LIMITED" }`.
- Only *failed* logins consume the account budget; a success calls `reset()`.
- The map is swept when it exceeds 5 000 entries, so a spray cannot grow memory
  without bound.
- Keys use `req.ip`; behind a proxy, `TRUST_PROXY=true` is required for correct
  addresses.

**Limitation, stated rather than hidden:** counters are per process and lost on
restart. A multi-instance deployment needs a shared store (Redis or a Mongo
collection). See [12-limitations.md](12-limitations.md).

## 9. Error handling

Every route wraps its body in `try/catch` and returns the same envelope. The
central handler catches anything that escapes:

```js
app.use(function (err, req, res, next) {
  console.error("Unhandled error:", err.message);
  if (res.headersSent) return;
  res.status(500).json({ success: false, message: "Internal server error" });
});
```

Rules:

- Never send `err.stack`, `err.message` from Mongoose, or a database path.
- Log the real error server-side with the route name.
- A validation problem is a `400`, not a `500`.
- A bodyless request is `{}`, so it becomes a field error.

## 10. Configuration

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MONGODB_URI` | Yes | — | Database connection string |
| `PORT` | No | 3000 | HTTP port |
| `NODE_ENV` | No | development | Enables `Secure` cookies and fail-closed CORS |
| `ALLOWED_ORIGIN` | No | — | Comma-separated CORS origins |
| `TRUST_PROXY` | No | false | Trust one reverse-proxy hop |
| `ALLOW_LEGACY_ADOPTION` | No | false | One-time migration of ownerless records |
| `MONGO_TIMEOUT_MS` | No | 10000 | Server selection timeout |

`server/.env.example` documents these. `.env` is ignored by Git and never
served.

## 11. Adding an endpoint

1. Add the method to `js/api.js`.
2. Add the route to the matching router, keeping `requireAuth` and the
   `userId` filter.
3. Validate input and return `{ success, data }` or a field `errors` map.
4. Add assertions to `test-suite.js` (behaviour) or `test-auth.js` (isolation)
   — including a cross-user case for anything new that is private.
5. Run `cd server && npm test`.
