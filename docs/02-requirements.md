# Requirements

Requirements are written as behaviour that can be verified. Each one points at
the code or test that proves it. Anything not listed here is out of scope (see
§5).

---

## 1. Functional requirements

### 1.1 Accounts

| ID | Requirement | Verified by |
|---|---|---|
| F-01 | A visitor can register with a name, email and password; the password needs at least 8 characters, one letter and one digit | `test-auth.js` §4, `server/utils/password.js` |
| F-02 | Duplicate emails are rejected with `409` and a field-level message | `test-auth.js` §4 |
| F-03 | Sign-in sets an HttpOnly session cookie; sign-out destroys the session server-side | `test-auth.js` §6, `server/middleware/auth.js` |
| F-04 | A session survives a server restart (it is stored in MongoDB) | `docs/10-testing.md` |
| F-05 | A user can delete their account; applications, interview rounds and sessions are removed with it | `DELETE /api/auth/account` |
| F-06 | Private pages redirect to `/login?next=…` when signed out | `test-auth.js` §2 |
| F-07 | Private APIs return `401` with `code: "UNAUTHENTICATED"` when signed out | `test-auth.js` §3 |

### 1.2 Applications

| ID | Requirement | Verified by |
|---|---|---|
| F-10 | Create an application with company and role required | `test-suite.js` §3 |
| F-11 | Read one, list many, update, delete | `test-suite.js` §2 |
| F-12 | `companyName` and `jobRole` are required; enums are enforced for status, work mode, employment type, source and priority | `test-suite.js` §3 |
| F-13 | Search matches company, role, location, recruiter and tags, case-insensitively | `test-suite.js` §4 |
| F-14 | Filters combine (status + work mode + source + priority) | `test-suite.js` §4 |
| F-15 | Sorting is whitelisted; an unknown sort field falls back to newest first | `server/routes/applications.js` |
| F-16 | One page never exceeds 100 rows; aggregate views page through all rows | `test-suite.js` §4, `js/api.js` |
| F-17 | Deleting an application deletes its interview rounds | `test-suite.js` §7 |
| F-18 | Bulk delete removes all of a user's applications and rounds and requires `{ "confirm": "DELETE" }` | `test-suite.js` §8 |
| F-19 | Every status change is appended to a server-owned history with a timestamp | `test-suite.js` §2 |
| F-20 | Clients cannot write or rewrite `statusHistory` | `test-suite.js` §2 |

### 1.3 Interview rounds

| ID | Requirement | Verified by |
|---|---|---|
| F-30 | A round requires a valid application the caller owns | `test-suite.js` §6, `test-auth.js` §5 |
| F-31 | Rounds support type, round name, date, interviewer, location, topics, questions, notes, next steps and outcome | `server/models/Interview.js` |
| F-32 | Checklist items can be toggled individually and are persisted | `test-suite.js` §6 |
| F-33 | A round cannot be moved to another application | `PUT /api/interviews/:id` |
| F-34 | Rounds are private: cross-user read, update, delete and attach all return `404` | `test-auth.js` §5 |

### 1.4 Calendar

| ID | Requirement | Verified by |
|---|---|---|
| F-40 | Upcoming events cover the next 30 days; overdue covers everything earlier | `calendar.html` |
| F-41 | Events include interview rounds, legacy application interview dates, follow-ups and deadlines | `calendar.html` |
| F-42 | A round and a legacy interview date on the same day are shown once | `calendar.html` |
| F-43 | No event list is silently truncated | `calendar.html` |
| F-44 | Event rows are operable by mouse and keyboard | `calendar.html` |

### 1.5 Analytics

| ID | Requirement | Verified by |
|---|---|---|
| F-50 | Metrics are computed on the server; the page does not recompute headline numbers | `analytics.html`, `server/routes/analytics.js` |
| F-51 | Every rate states its denominator and returns `null` when the denominator is zero | `test-suite.js` §5 |
| F-52 | Averages report their sample size | `test-suite.js` §5 |
| F-53 | Breakdowns exist for status, source, work mode, employment type and priority | `test-suite.js` §5 |
| F-54 | Analytics are scoped to the signed-in user | `test-auth.js` §5 |

### 1.6 Data portability

| ID | Requirement | Verified by |
|---|---|---|
| F-60 | Export all applications as CSV | `settings.html` |
| F-61 | Download a JSON backup | `settings.html` |
| F-62 | Import a CSV with per-row validation; rejected rows are reported, never silently dropped | `settings.html` |
| F-63 | Delete-all keeps the account; delete-account removes it | `settings.html` |

---

## 2. Non-functional requirements

| ID | Requirement | How it is met |
|---|---|---|
| N-01 | No secret reaches the browser | Only `/css` and `/js` are served; `server/**` and `.env` are not routable (`server/server.js`) |
| N-02 | Every private record is authorised on the server | Every query filters by `userId`; `test-auth.js` §5 |
| N-03 | Passwords are never stored or logged in plaintext | scrypt with a per-user salt; `passwordHash` is `select: false` and stripped from JSON |
| N-04 | The API fails closed | Production without `ALLOWED_ORIGIN` sends no CORS headers; unknown API routes return JSON 404 |
| N-05 | The server does not accept requests before MongoDB is ready | `start()` connects first, listens second |
| N-06 | Shutdown is graceful | SIGINT/SIGTERM close the listener, then disconnect Mongoose |
| N-07 | Destructive actions require explicit confirmation | Native `<dialog>` with a typed `DELETE` value where the action is irreversible |
| N-08 | Keyboard and screen-reader access | Semantic landmarks, labelled inputs, focus rings, ARIA listbox dropdowns, focus-managed dialogs |
| N-09 | Status is never conveyed by colour alone | Every badge carries text |
| N-10 | Reduced motion is respected | `prefers-reduced-motion` rules in `css/design-system.css` |
| N-11 | No horizontal overflow at 320–1440px | Responsive audit recorded in `README.md` |
| N-12 | One icon system | `icon()` from `js/utils.js`; no emoji in the interface |
| N-13 | The tests can be run by a reviewer | `cd server && npm test` |
| N-14 | The interface never invents data | Empty states and explicit denominators instead of placeholders |

---

## 3. Data contract requirements

| ID | Requirement |
|---|---|
| D-01 | Calendar dates (`applicationDate`, `followUpDate`, `interviewDate`, `deadline`) transfer as `YYYY-MM-DD` and are parsed as local calendar dates |
| D-02 | Instants (`createdAt`, `updatedAt`, `statusHistory[].at`) transfer as ISO timestamps |
| D-03 | Responses expose `id`, never `_id` or `__v` |
| D-04 | List responses include `total`, `page`, `limit`, `totalPages` |
| D-05 | Errors include `success: false`, a human `message`, and field `errors` where relevant |

---

## 4. Acceptance criteria for the core journey

A reviewer can, in one session:

1. Open `/`, read the product explanation, and sign in with the demo account.
2. See the demo workspace: 10 applications, 6 interview rounds.
3. Create an application; it appears in the list, pipeline, companies and
   dashboard counts.
4. Change its status; the pipeline card moves and the detail modal shows the
   transition with a timestamp.
5. Add an interview round; it appears in Interview Prep **and** in the calendar.
6. Open Analytics; every percentage shows its denominator.
7. Export CSV; the file contains the same records.
8. Delete the application; its rounds disappear too.
9. Sign out; private routes redirect to the login page.

---

## 5. Out of scope

- Email delivery (verification, password reset, reminders)
- OAuth / SSO / MFA
- File attachments or résumé storage
- Real-time collaboration or sharing
- Native mobile apps
- Billing
- Multi-instance rate limiting (documented limitation, not an oversight)

---

## 6. Assumptions

- One person owns their records; there are no teams or shared workspaces.
- The browser is modern (ES modules, `dialog`, `fetch`, `URLSearchParams`).
- MongoDB is reachable and durable; the app does not implement its own
  persistence layer.
- The deployment terminates TLS at the app or a proxy in front of it.
