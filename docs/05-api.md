# API Reference

Base URL: `http://localhost:3000` (or the deployed origin). All request and
response bodies are JSON. Session auth is an HttpOnly cookie named
`careerflow_session`; API clients must keep it.

```text
Every response error has the same shape:
{ "success": false, "message": "…", "errors": { "field": "…" }, "code": "…" }
```

`code` is present only where a client needs to branch on it
(`UNAUTHENTICATED`, `CONFIRMATION_REQUIRED`, `RATE_LIMITED`).

---

## 1. Health

### `GET /api/health`

No auth. Always `200`.

```json
{ "status": "ok", "message": "Backend is working correctly", "authenticated": true }
```

---

## 2. Authentication — `/api/auth`

### `POST /api/auth/register`

Rate limit: 60 requests / hour / IP.

```json
{ "name": "Ada Lovelace", "email": "ada@example.com", "password": "correct-horse-1" }
```

| Status | Meaning |
|---|---|
| `201` | Account created and signed in |
| `400` | `errors` map with `name` / `email` / `password` |
| `409` | Email already registered |
| `429` | Register rate limit; `Retry-After` header |

Password rules: at least 8 characters, one letter, one digit.
On success the response sets the session cookie and returns
`{ data: { id, name, email } }`.

### `POST /api/auth/login`

Rate limits: 5 failures / 15 min per `ip|email`, plus 100 requests / 15 min per
IP. A success clears the account budget.

```json
{ "email": "ada@example.com", "password": "correct-horse-1" }
```

| Status | Meaning |
|---|---|
| `200` | Signed in; cookie set |
| `400` | Missing email or password |
| `401` | Wrong credentials (same message for unknown email) |
| `429` | Too many failures; `Retry-After` and `{ code: "RATE_LIMITED" }` |

### `POST /api/auth/logout`

Destroys the session server-side, clears the cookie, always `200` when the
request is well formed.

### `GET /api/auth/me`

```json
{ "success": true, "authenticated": true, "data": { "id": "…", "name": "…", "email": "…" } }
```

Signed out: `200` with `authenticated: false` and `data: null` (not `401`, so a
page can ask without treating it as an error).

### `DELETE /api/auth/account`

Requires auth. Deletes sessions, applications, interview rounds and the user.
`200 { deletedApplications, deletedInterviews }`.

---

## 3. Applications — `/api/applications`

All routes require auth and are scoped to `req.user`. Another user's id always
produces `404`, never `403`, so the API does not reveal that a record exists.

### `GET /api/applications`

| Query | Type | Default | Notes |
|---|---|---|---|
| `search` | string | — | Case-insensitive regex over company, role, location, recruiter, tags. Regex metacharacters are escaped |
| `status` | enum | — | Exact match |
| `workMode` | enum | — | Exact match |
| `employmentType` | enum | — | Exact match |
| `jobSource` | enum | — | Exact match |
| `priority` | enum | — | Exact match |
| `sort` | `field:dir` | `createdAt:desc` | Fields: `createdAt`, `applicationDate`, `companyName`, `jobRole`, `interviewDate`, `followUpDate`, `deadline`, `priority`, `status`, `updatedAt`; `dir` is `asc` or anything else → `desc` |
| `page` | integer | `1` | Minimum 1 |
| `limit` | integer | `20` | Clamped to **1–100** |

```json
{
  "success": true,
  "data": [ { "id": "…", "companyName": "…", "jobRole": "…", "status": "Applied" } ],
  "total": 105,
  "page": 1,
  "limit": 20,
  "totalPages": 6
}
```

A page never returns more than 100 rows. Pages that need every record use
`api.getAllApplications()` in `js/api.js`, which requests successive pages and
concatenates them.

### `GET /api/applications/:id`

`200` with the record, `400` for a malformed id, `404` when absent or owned by
someone else.

### `POST /api/applications`

Required: `companyName`, `jobRole`. Everything else is optional. `userId` is
taken from the session and cannot be supplied.

The server discards `id`, `_id`, `__v` and **`statusHistory`**, then writes the
first history entry itself:

```json
{ "from": null, "to": "Applied", "at": "2026-10-20T21:56:00.123Z" }
```

```json
{ "success": true, "message": "Application created successfully", "data": { "id": "…" } }
```

`201`. Validation failure → `400` with `errors`.

### `PUT /api/applications/:id`

Partial update. The server removes `userId`, `createdAt`, `updatedAt`,
`statusHistory` and the identity fields. A status change appends exactly one
entry:

```json
{ "from": "Applied", "to": "Interview", "at": "2026-10-21T09:30:00.000Z" }
```

Saving the same status again appends nothing. The array is trimmed to the last
100 entries.

### `DELETE /api/applications/:id`

Deletes the record and its interview rounds.

```json
{ "success": true, "message": "Application deleted successfully", "deletedInterviews": 2 }
```

### `DELETE /api/applications`

Deletes **all** applications and rounds for the caller. Requires an explicit
body:

```json
{ "confirm": "DELETE" }
```

Without it: `400 { code: "CONFIRMATION_REQUIRED" }`.

```json
{ "success": true, "deletedApplications": 10, "deletedInterviews": 6 }
```

---

## 4. Interviews — `/api/interviews`

All routes require auth. A round must belong to an application the caller owns.

### `GET /api/interviews`

Optional query: `applicationId` (validated as an owned application if present).
Returns every round for the caller, sorted by `interviewDate` ascending.

```json
{ "success": true, "data": [ { "id": "…", "applicationId": "…", "interviewType": "Technical Interview", "round": "Round 2", "interviewDate": "2026-10-22", "outcome": "Pending" } ] }
```

### `GET /api/interviews/:id`

`200`, `400` (bad id), `404` (absent or not owned).

### `POST /api/interviews`

Required: `applicationId`, `interviewType`, `interviewDate`.

| Status | Meaning |
|---|---|
| `201` | Created |
| `400` | Missing/invalid fields |
| `404` | The linked application does not exist or is not owned by the caller |

The server sets `userId` from the session; `applicationId` is validated against
`Application.findOne({ _id, userId })`.

```json
{
  "applicationId": "6ad6fe1cedf19906861a58eb",
  "interviewType": "Coding Round",
  "round": "Round 1 — Coding",
  "interviewDate": "2026-10-24",
  "topicsToPrepare": ["Graphs", "Dynamic programming"],
  "preparationChecklist": [{ "text": "Review system design notes", "done": false }]
}
```

### `PUT /api/interviews/:id`

Partial update. `applicationId` and `userId` are ignored, so a round cannot be
moved to another application.

### `PATCH /api/interviews/:id/checklist/:index`

Toggles one checklist item. `index` must be a non-negative integer within the
array.

```json
{ "success": true, "message": "Checklist updated successfully", "data": { "…": "…" } }
```

`400` for an invalid index, `404` for a missing round or item.

### `DELETE /api/interviews/:id`

Deletes one round. `200`, `400`, `404`.

---

## 5. Analytics — `/api/analytics/summary`

No query parameters. Every value is computed from the caller's stored records;
the UI formats but does not recompute them.

```json
{
  "success": true,
  "data": {
    "totalApplications": 10,
    "applied": 7,
    "inProgress": 5,
    "interviewsScheduled": 3,
    "interviewRounds": 6,
    "offersReceived": 1,
    "responded": 4,
    "rejected": 1,
    "followUpsDue": 2,

    "interviewConversionRate": 42.86,
    "interviewConversionDenominator": 7,
    "offerConversionRate": 14.29,
    "offerConversionDenominator": 7,
    "responseRate": 57.14,
    "responseDenominator": 7,

    "averageDaysToInterview": 18.5,
    "averageDaysToInterviewSampleSize": 4,

    "followUpsScheduled": 6,
    "followUpsPastDue": 1,

    "byStatus": { "Applied": 3, "Interview": 3 },
    "bySource": { "LinkedIn": 5 },
    "byWorkMode": { "Remote": 4 },
    "byEmploymentType": { "Full-time": 9 },
    "byPriority": { "High": 4 }
  }
}
```

Definitions and edge cases are in [09-algorithms.md](09-algorithms.md). A `null`
rate means the denominator was zero; the UI renders `—`, not `0%`.

---

## 6. Status codes

| Code | Used for |
|---|---|
| `200` | Successful read/update/delete |
| `201` | Successful create |
| `302` | Private page redirect to `/login?next=…` |
| `400` | Validation, malformed ObjectId, missing confirmation |
| `401` | No valid session |
| `404` | Missing record, foreign record, unknown API route or page |
| `409` | Duplicate email |
| `429` | Rate limited (`Retry-After` present) |
| `500` | Unexpected failure; message is generic, stack traces are never sent |

## 7. Conventions

- Identifiers: responses expose `id`; `_id` and `__v` are stripped.
- Dates: calendar dates (`applicationDate`, `followUpDate`, `interviewDate`,
  `deadline`) are `YYYY-MM-DD`; `createdAt`, `updatedAt`, `statusHistory[].at`
  are ISO instants.
- Boolean success on every response; list responses add `total`, `page`,
  `limit`, `totalPages`.
- `Content-Type: application/json` on every API response, including errors.
- A bodyless request is treated as `{}` and validated — it never produces a 500.

## 8. Examples with curl

```bash
# Register and keep the cookie
curl -i -c cookies.txt -H "Content-Type: application/json" \
  -d '{"name":"Ada","email":"ada@example.com","password":"correct-horse-1"}' \
  http://localhost:3000/api/auth/register

# Create an application
curl -b cookies.txt -H "Content-Type: application/json" \
  -d '{"companyName":"Nova Analytics","jobRole":"Frontend Engineer","status":"Applied"}' \
  http://localhost:3000/api/applications

# List page 2, 50 per page
curl -b cookies.txt \
  "http://localhost:3000/api/applications?page=2&limit=50&sort=applicationDate:desc"

# Summary
curl -b cookies.txt http://localhost:3000/api/analytics/summary

# Bulk delete (deliberately verbose)
curl -b cookies.txt -X DELETE -H "Content-Type: application/json" \
  -d '{"confirm":"DELETE"}' http://localhost:3000/api/applications
```
