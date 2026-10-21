# Security

The threat model for a single-user-per-account job tracker: someone who wants
another person's application history, someone who wants to take over an account,
and automated abuse of the auth endpoints. This document states what is
implemented, where, and what remains out of scope.

---

## 1. Authentication

| Control | Implementation |
|---|---|
| Password storage | scrypt (N=65536, r=8, p=2 — 64 MiB, two iterations), 16-byte random salt, 64-byte key, stored as `scrypt$N$r$p$salt$hash` |
| Verification | `crypto.timingSafeEqual` on the derived keys |
| Unknown-email timing | One real dummy hash is generated at startup with the current parameters and verified when the account does not exist, so both paths perform the same scrypt work |
| Failure timing floor | Failed sign-ins return no sooner than 400 ms, so accounts still on a faster legacy hash cannot be distinguished by response time |
| Hash upgrades | Parameters are read from each stored hash; a successful sign-in re-hashes with current parameters when they differ |
| Password policy | ≥ 8 characters, at least one letter and one digit |
| Password exposure | `passwordHash` is `select: false` and stripped by the JSON transform; no log line prints it |
| Session token | 32 random bytes (256 bits), base64url |
| Session storage | Only the SHA-256 hash is stored; a database leak cannot be replayed |
| Cookie | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when `NODE_ENV=production` |
| Session lifetime | 30 days, explicit expiry check on every request, plus a TTL index |
| Logout | The session row is deleted, not just the cookie cleared |
| Account deletion | Sessions, applications, rounds and the user are removed |

Why scrypt rather than bcrypt/argon2: it is built into Node, is memory-hard, and
avoids a native build dependency. The parameters follow the OWASP Password
Storage Cheat Sheet configuration N=2¹⁶, r=8, p=2. Because each hash stores its
own parameters, raising them does not invalidate existing passwords: the old
parameters are read back and the hash is rewritten on the next successful
sign-in. Arithmetic cost is roughly 300 ms per verification on a development
machine; `scryptSync` therefore blocks the event loop for that long, a trade-off
that the rate limiter bounds and that a high-traffic deployment should revisit
by moving to the asynchronous `crypto.scrypt` with a bounded worker pool.

## 2. Authorisation

Every private query includes the owner:

```js
Application.findOne({ _id: req.params.id, userId: req.user._id })
```

- `userId` is never read from a request body. On create it is overwritten with
  `req.user._id`; on update it is deleted before the write.
- A foreign record returns **404**, not 403, so the API does not confirm that a
  record exists.
- Interview rounds are checked twice: the round itself is scoped by `userId`,
  and a new round's parent must satisfy `{ _id, userId }`.
- Analytics aggregates only the caller's applications and rounds.
- Bulk delete is scoped and requires `{ "confirm": "DELETE" }`.
- `test-auth.js` §5 creates two accounts and asserts read, update, delete and
  attach are all rejected for the second account.

## 3. Transport and headers

| Header | Value | Purpose |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Prevent MIME confusion |
| `X-Frame-Options` | `SAMEORIGIN` | Clickjacking |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Do not leak paths to third parties |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` | Explicitly disable powerful features |
| `X-Powered-By` | removed (`app.disable`) | Do not advertise Express |

TLS termination is a deployment responsibility (platform or reverse proxy).
`Secure` cookies are enabled automatically in production, so a production
deployment served over plain HTTP would fail to keep a session — which is the
correct failure.

**Not implemented:** a Content-Security-Policy header. The app uses inline
`<script type="module">` blocks, so a strict CSP would require nonces or hashes
on every page. This is listed in [12-limitations.md](12-limitations.md) rather
than papered over.

## 4. CSRF

State-changing endpoints are `POST`, `PUT`, `PATCH` and `DELETE` only; no `GET`
mutates data. The session cookie is `SameSite=Lax`, which prevents it from being
sent on cross-site form posts and fetches. The API accepts JSON bodies, and a
cross-origin `fetch` with `Content-Type: application/json` requires a CORS
preflight that the server does not grant to unknown origins.

If the app is ever embedded or served cross-origin, the next step is an explicit
double-submit CSRF token. That is not needed for the current same-origin
deployment, and it is documented as such rather than claimed as implemented.

## 5. CORS

- `ALLOWED_ORIGIN` accepts a comma-separated allowlist.
- Production with no allowlist sends **no** CORS headers. The frontend is served
  by the same process, so the app keeps working; a forgotten environment
  variable cannot open the API to every site.
- Development without the variable allows only `localhost` and `127.0.0.1` on
  the configured port.
- `credentials: true` is paired with an explicit origin list, never `*`.

## 6. Rate limiting

| Policy | Key | Limit | Window |
|---|---|---|---|
| Failed logins | `ip|email` | 5 | 15 min |
| Login attempts | IP | 100 | 15 min |
| Registration | IP | 60 | 1 hour |

A blocked request receives `429`, `Retry-After`, and `code: RATE_LIMITED`. A
successful login clears the per-account budget, so a legitimate user who
mistyped a few times is not locked out after remembering the password. The IP
budget is intentionally not reset, to bound credential stuffing from one host.

Identity is taken from `req.ip`. Blindly trusting `X-Forwarded-For` would let an
attacker choose their own key and bypass the limit, so it is used only when
`TRUST_PROXY=true` is set by the operator.

**Limitation:** counters live in the process. Restarting clears them, and
multiple instances do not share them. A production multi-instance deployment
needs a shared store. This is a deliberate scope decision, not an omission.

## 7. Input handling

| Risk | Control |
|---|---|
| XSS | Every interpolated value goes through `escapeHtml()`, including attribute positions; dialog text is set with `textContent` |
| NoSQL operator injection | Query parameters are strings and are assigned to specific fields; bodies are cast against the Mongoose schema, and identity/owner fields are deleted before writing |
| ReDoS via search | User input is escaped with `escapeRegex()` before becoming a `RegExp` |
| Oversized bodies | `express.json({ limit: "1mb" })`, plus `maxlength` on every string field |
| Invalid ObjectIds | Checked with `mongoose.Types.ObjectId.isValid` → `400` |
| Mass assignment | `userId`, `_id`, `id`, `__v`, `createdAt`, `updatedAt`, `statusHistory` removed from bodies |
| Path traversal | Only `/css` and `/js` are mounted, with `dotfiles: "deny"`, `index: false`, `extensions: false` |
| Source disclosure | The project root is never served; `/server/**`, tests, scripts, README and `node_modules` return 404 |
| Stack traces | The central error handler returns a generic message; details stay in the server log |

The `escapeHtml()` audit covered the login redirect text, table cells, modal
content, toasts, CSV import errors and the calendar event labels. The one place
that deliberately does not escape is when building `innerHTML` from a template
that contains only trusted markup and already-escaped values.

## 8. Secrets

- `server/.env` holds `MONGODB_URI`; it is git-ignored and cannot be fetched
  over HTTP.
- `server/.env.example` documents every variable with placeholder values.
- No API key, token or database URL appears in any file under `js/` or `css/`.
- The browser never receives a password hash, session token (only the cookie
  the browser stores itself) or database identifier.

## 9. Error responses

- Authentication failures use one message ("Incorrect email or password") for
  both unknown email and wrong password.
- Duplicate registration is a `409` with a field error; this is a deliberate
  usability trade-off that reveals an email is registered. The alternative
  (silent success plus email verification) needs email delivery, which is out of
  scope.
- Unexpected errors log the real cause server-side and return
  `{ success: false, message: "Internal server error" }`.

## 10. What a reviewer should test

1. Sign in as user A, copy an application id. Sign in as user B and request it →
   `404`.
2. With user B, `POST /api/interviews` using user A's `applicationId` → `404`.
3. Request `/server/.env` and `/seed-demo.js` → `404`.
4. Request `/applications.html` directly → `404`; `/applications` signed out →
   `302 /login?next=%2Fapplications`.
5. Fail the login five times → the sixth is `429` with `Retry-After`.
6. `DELETE /api/applications` without a body → `400 CONFIRMATION_REQUIRED`.
7. Inspect the `Set-Cookie` header in production → `HttpOnly`, `SameSite=Lax`,
   `Secure`.
8. Run `node seed-demo.js` without `--yes` → exit 1 and no request is made.
9. Run `NODE_ENV=production node seed-demo.js --yes` → exit 1.
10. Inspect `/api/health` → `environment` and `demoSeedingAllowed` describe the
    policy, and `demoSeedingAllowed` is `false` in production.

## 11. Known gaps

| Gap | Consequence | Mitigation / next step |
|---|---|---|
| No CSP header | Weaker defence-in-depth against injected script | Add nonces to the inline module scripts, then a strict policy |
| No CSRF token | Relies on SameSite + JSON + CORS | Add double-submit tokens if the app is ever embedded cross-origin |
| No email verification | Anyone can register with an address they do not own | Requires email delivery |
| No password reset | A forgotten password means a lost account | Requires email delivery and a token flow |
| No MFA | Password compromise is account compromise | TOTP or WebAuthn |
| In-memory rate limits | Per instance, reset on restart | Shared store (Redis/Mongo) |
| No audit log for reads | Cannot reconstruct who viewed what | Out of scope for a personal tracker |
| Legacy adoption flag | If enabled on a shared database, the first registration could adopt ownerless rows | Off by default; remove after a one-time migration |

## 12. Demo data

There is no demo account unless someone creates one deliberately. The server
never seeds on startup, and a fresh database contains no users.

`seed-demo.js` is a standalone operator script with four independent guards:

| Guard | Behaviour |
|---|---|
| Opt-in | Exits 1 unless `--yes` is passed |
| Production (local) | Exits 1 when `NODE_ENV=production` |
| Production (server) | Reads `/api/health`; exits 1 when the target reports `environment: "production"` |
| Legacy adoption | Exits 1 when `ALLOW_LEGACY_ADOPTION=true`, locally or on the server, because the new account could otherwise claim ownerless records |

The password is not built into the repository. If `DEMO_PASSWORD` is unset, the
script generates ~28 characters (72+ bits) and prints it once; it is never
written to `.env`, a log file, or the database in plaintext. Re-seeding an
existing demo account requires providing its password explicitly.

The demo user is an ordinary `users` document. Seeding signs in as that user and
uses the normal, `userId`-scoped API, so it can only delete and create its own
records. It has no elevated role, no access to other accounts, and no way to
enumerate them. Demo data should still be treated as disposable: do not use a
personal password, and do not seed a production database.
