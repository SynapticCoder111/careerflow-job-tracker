# Database

MongoDB, accessed through Mongoose 9. Four collections: `users`, `sessions`,
`applications`, `interviews`. No collection is exposed directly — every read and
write goes through a route that scopes by the signed-in user.

---

## 1. Relationships

```text
User (1) ──< Session (many)      userId, cascade-deleted with the account
User (1) ──< Application (many)  userId, indexed
Application (1) ──< Interview (many)  applicationId + userId, cascade-deleted
Application.statusHistory        embedded, append-only, capped at 100
Interview.preparationChecklist   embedded, toggled in place
```

There are no database-level foreign keys. Cascades are performed by the routes
that delete a parent record:

| Action | Effects |
|---|---|
| `DELETE /api/applications/:id` | Deletes the application, then `Interview.deleteMany({ applicationId, userId })` |
| `DELETE /api/applications` | Deletes all applications and rounds for that user |
| `DELETE /api/auth/account` | Deletes sessions, applications, rounds, then the user |

## 2. `users`

| Field | Type | Rules |
|---|---|---|
| `_id` | ObjectId | Primary key |
| `name` | String | Required, trimmed, ≤ 80 |
| `email` | String | Required, unique, lowercased, trimmed, ≤ 200, indexed |
| `passwordHash` | String | Required, **`select: false`** — never loaded unless explicitly requested |
| `createdAt`, `updatedAt` | Date | Mongoose timestamps |

Password format: `scrypt$N$r$p$<saltBase64>$<hashBase64>` with N=65536, r=8,
p=2, 16-byte salt, 64-byte derived key. Parameters are stored with each hash,
so weaker hashes remain verifiable and are upgraded on the next sign-in. See
[08-security.md](08-security.md#1-authentication).

The JSON transform removes `passwordHash`, `_id` and `__v`, and exposes `id`.

## 3. `sessions`

| Field | Type | Rules |
|---|---|---|
| `tokenHash` | String | Required, unique, indexed — SHA-256 of the cookie token |
| `userId` | ObjectId | Required, indexed |
| `expiresAt` | Date | Required, TTL index (`expires: 0`) |
| `userAgent` | String | ≤ 300, for future session management |
| `ip` | String | ≤ 60 |
| `createdAt`, `updatedAt` | Date | Timestamps |

The TTL index lets MongoDB remove expired sessions automatically. The auth
middleware also checks `expiresAt` on read, so expiry is correct even before the
TTL monitor runs.

## 4. `applications`

| Field | Type | Rules |
|---|---|---|
| `userId` | ObjectId | Owner; indexed; present in every query filter |
| `companyName` | String | Required, trimmed, ≤ 200 |
| `jobRole` | String | Required, trimmed, ≤ 200 |
| `status` | String | Enum below, default `Applied` |
| `applicationDate` | Date | Calendar date (UTC midnight) |
| `jobLink` | String | ≤ 500 |
| `jobDescription` | String | ≤ 10 000 |
| `companyWebsite` | String | ≤ 500 |
| `location` | String | ≤ 200 |
| `workMode` | String | `On-site` · `Hybrid` · `Remote` |
| `employmentType` | String | `Full-time` · `Internship` · `Contract` · `Part-time` |
| `salaryMin`, `salaryMax` | Number | ≥ 0 |
| `currency` | String | ≤ 10, default `USD` |
| `recruiterName` | String | ≤ 200 |
| `recruiterEmail` | String | Lowercased, ≤ 200 |
| `recruiterLinkedIn` | String | ≤ 500 |
| `jobSource` | String | `LinkedIn` · `Company Website` · `Referral` · `Campus Placement` · `Job Portal` · `Other` |
| `priority` | String | `Low` · `Medium` · `High`; default `Medium` |
| `followUpDate` | Date | Calendar date |
| `interviewDate` | Date | Calendar date (legacy; rounds are first-class) |
| `deadline` | Date | Calendar date |
| `notes` | String | ≤ 10 000 |
| `tags` | [String] | Each ≤ 50 |
| `statusHistory` | [subdocument] | Server-owned, append-only, capped |
| `createdAt`, `updatedAt` | Date | Timestamps |

### 4.1 Status values

`Bookmarked`, `Applied`, `Assessment`, `Interview`, `Offer`, `Rejected`,
`Withdrawn`. These exact strings are used by forms, filters, badges, the Kanban
board and analytics, so there is one vocabulary.

### 4.2 `statusHistory`

```js
{
  from: String | null,   // null on the first entry
  to:   String,          // required
  at:   Date             // real instant, default Date.now
}
```

Rules (enforced in `server/routes/applications.js`):

- On create, one entry is written: `{ from: null, to: initialStatus }`.
- On update, an entry is appended **only** when the submitted status differs
  from the stored status.
- The array is trimmed to its last 100 entries with `$slice: -100`.
- `statusHistory` is removed from every request body before validation, so a
  client cannot forge or rewrite history.

### 4.3 Example document

```json
{
  "id": "6ad6fe1cedf19906861a58eb",
  "companyName": "Nova Analytics",
  "jobRole": "Frontend Engineer",
  "status": "Interview",
  "applicationDate": "2026-09-02",
  "followUpDate": "2026-09-18",
  "interviewDate": "2026-10-22",
  "deadline": null,
  "workMode": "Remote",
  "employmentType": "Full-time",
  "priority": "High",
  "jobSource": "LinkedIn",
  "tags": ["react", "design-systems"],
  "statusHistory": [
    { "from": null, "to": "Applied", "at": "2026-09-02T08:14:03.112Z" },
    { "from": "Applied", "to": "Interview", "at": "2026-09-19T16:02:44.905Z" }
  ],
  "createdAt": "2026-09-02T08:14:03.112Z",
  "updatedAt": "2026-09-19T16:02:44.905Z"
}
```

Note the date fields: `YYYY-MM-DD` for calendar dates, ISO instants for
`statusHistory[].at` and timestamps. See §6.

## 5. `interviews`

| Field | Type | Rules |
|---|---|---|
| `userId` | ObjectId | Owner; indexed; set from the session, never from the body |
| `applicationId` | ObjectId | Required, indexed; must belong to the caller |
| `round` | String | ≤ 100, default `Round 1` |
| `interviewType` | String | Required; see enum below |
| `interviewDate` | Date | Required; calendar date |
| `interviewerName`, `interviewerEmail` | String | ≤ 200 |
| `location` | String | ≤ 200 |
| `topicsToPrepare` | [String] | Each ≤ 200 |
| `questionsToAsk` | [String] | Each ≤ 500 |
| `personalNotes` | String | ≤ 10 000 |
| `preparationChecklist` | [{ text, done }] | `text` required ≤ 500; `done` boolean |
| `outcome` | String | `Pending` · `Passed` · `Failed` · `Rescheduled` · `Withdrawn` |
| `nextSteps` | String | ≤ 5000 |
| `createdAt`, `updatedAt` | Date | Timestamps |

Interview types: `Recruiter Screen`, `Technical Interview`, `Coding Round`,
`System Design`, `Behavioral Interview`, `HR Round`, `Final Interview`.

`applicationId` cannot be changed by `PUT`: the route ignores it, so a round
cannot be moved between applications (which would otherwise be a way to attach
data to someone else's record).

## 6. Date storage

Two kinds of time exist and they are treated differently:

| Kind | Fields | Storage | Transport |
|---|---|---|---|
| Calendar date | `applicationDate`, `followUpDate`, `interviewDate`, `deadline` | `Date` at 00:00:00Z | `YYYY-MM-DD` |
| Instant | `createdAt`, `updatedAt`, `statusHistory[].at`, session expiry | full `Date` | ISO 8601 |

`server/utils/dateOnly.js` performs the conversion on the way out and parses
`YYYY-MM-DD` on the way in. The client has a matching `parseDate()` that builds a
**local** date from the parts, so "15 September" renders as 15 September in every
timezone. Before this, a record created in New York displayed one day earlier.

## 7. Indexes

| Collection | Index | Purpose |
|---|---|---|
| `users` | `email` unique | Login lookup, duplicate prevention |
| `sessions` | `tokenHash` unique | Session lookup |
| `sessions` | `userId` | Account deletion, future session listing |
| `sessions` | `expiresAt` TTL | Automatic cleanup |
| `applications` | `userId` | Every scoped query |
| `interviews` | `userId`, `applicationId` | Scoped queries, cascade delete, calendar grouping |

At this scale the `userId` index carries most queries. Filtering by status or
source happens in the route after the owner filter, which keeps the index count
small and the behaviour predictable.

## 8. Data integrity rules

| Rule | Where enforced |
|---|---|
| A record always has an owner | `userId` is taken from `req.user`, never from the body |
| Status values are from one enum | Mongoose enum + route validation |
| A round references a real, owned application | `POST /api/interviews` checks `Application.findOne({ _id, userId })` |
| A round's parent cannot change | `PUT /api/interviews/:id` ignores `applicationId` |
| History is server-owned | Stripped from request bodies |
| Deletes cascade | Explicit `deleteMany` in the owning route |
| Responses never expose `_id` or `__v` | JSON transforms and `normalizeDoc()` |

## 9. Migrations

There is no migration framework. Two schema additions were handled in place:

1. **`statusHistory`** — records created before it simply have no array. The UI
   renders "No status changes recorded yet." instead of inventing a timeline.
2. **Date-only serialisation** — stored values were already UTC midnight, so the
   change affected only the response format.

The legacy `application.interviewDate` field is kept for older records; the
calendar merges it with first-class rounds and suppresses the duplicate when a
round already covers the same application and day.

## 10. Backup and restore

`settings.html` downloads a JSON backup of the user's own applications and
rounds. A full database backup is an operational concern (Atlas snapshots or
`mongodump`); the application does not implement one. See
[11-deployment.md](11-deployment.md).
