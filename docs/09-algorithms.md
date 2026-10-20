# Algorithms and Data Rules

This document defines exactly how each derived number is calculated, how
pagination and history work, and why the edge cases behave the way they do.
Every definition here exists in code; nothing is aspirational.

---

## 1. Time and calendar dates

### 1.1 Two kinds of time

| Kind | Example | Storage | Transport |
|---|---|---|---|
| Calendar date | "interview on 22 October" | `Date` at `00:00:00Z` | `YYYY-MM-DD` |
| Instant | "changed at 09:30:14" | full `Date` | ISO 8601 |

### 1.2 Parsing

The naive approach is wrong:

```js
new Date("2026-09-15")        // UTC midnight
  .toLocaleDateString()       // "9/14/2026" in New York
```

`js/utils.js` therefore splits the string:

```js
export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
```

The result is local midnight, so rendering and "is it overdue?" agree with the
user's calendar.

On the server, `startOfTodayUTC()` is used for overdue analytics because the
stored dates are UTC midnight. Mixing local midnight there would misclassify
records by up to a day depending on the server's timezone.

### 1.3 Display

| Field | Formatter | Example |
|---|---|---|
| Calendar date | `formatDate` | `Sep 15, 2026` |
| Instant | `formatDateTime` | `Sep 15, 2026, 11:56 PM` |
| Input value | `formatDateInput` | `2026-09-15` |

---

## 2. Analytics

All values are computed per request from the caller's records. `rate()` returns
`null` when the denominator is zero.

```js
function rate(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 10000) / 100; // 2 dp
}
```

### 2.1 Counts

| Metric | Definition |
|---|---|
| `totalApplications` | Every record owned by the user |
| `applied` | Records whose status is **not** `Bookmarked` — the denominator for conversion rates |
| `inProgress` | Status in `{Applied, Assessment, Interview}` |
| `interviewsScheduled` | Status is exactly `Interview` (current stage, not rounds) |
| `interviewRounds` | Number of `Interview` documents owned by the user |
| `offersReceived` | Status is `Offer` |
| `responded` | `Assessment + Interview + Offer` — an employer reacted |
| `rejected` | Status is `Rejected` |
| `followUpsScheduled` | Records with a `followUpDate` |
| `followUpsPastDue` | `followUpDate < startOfTodayUTC()` |
| `followUpsDue` | `followUpDate < today + 7 days` (includes past due) |

### 2.2 Rates

| Metric | Numerator / denominator | Why this denominator |
|---|---|---|
| `interviewConversionRate` | `interviewsScheduled / applied` | A bookmarked-but-never-sent application cannot convert |
| `offerConversionRate` | `offersReceived / applied` | Same |
| `responseRate` | `responded / applied` | Assessment, interview and offer all count as a response; rejection alone does not |

Each rate ships with its denominator (`interviewConversionDenominator`, etc.),
and the UI prints "3 of 7 applied reached interview". When the denominator is
zero the API returns `null` and the UI shows `—` with "No applied
applications"; it never shows `0%` or `NaN`.

### 2.3 Average days to interview

```js
const toInterview = applications
  .filter(a => a.applicationDate && a.interviewDate)
  .map(a => (new Date(a.interviewDate) - new Date(a.applicationDate)) / 86400000)
  .filter(d => d >= 0);
```

- Only records with both dates participate.
- Negative values (interview before application, i.e. bad data) are excluded.
- Rounded to one decimal.
- `averageDaysToInterviewSampleSize` is returned with it.

**Removed, not repaired:** "average time to offer". No offer timestamp exists,
so any number would have been invented. The card was deleted rather than faked.

### 2.4 Breakdowns

`byStatus`, `bySource`, `byWorkMode`, `byEmploymentType`, `byPriority`. Only
non-empty values appear (a key is created when a record has that value), so a
chart can iterate the keys without filtering. Records with no value for a field
are absent from that breakdown — the denominators are the records that have the
attribute, not the total.

### 2.5 Complexity

One pass over `n` applications plus one `countDocuments`:

- time: `O(n)`
- space: `O(k)` for the breakdowns, `k` ≤ number of enum values
- database: two queries

At 10 000 applications this is still a single round trip per collection. The
honest limit is memory: `find().lean()` loads the user's records. If that grew
large, the next step would be MongoDB aggregation (`$group`) rather than loading
documents.

---

## 3. Status history

Data:

```js
statusHistory: [{ from: String | null, to: String, at: Date }]
```

Write rules (`server/routes/applications.js`):

1. **Create** — always exactly one entry:
   ```js
   payload.statusHistory = [{ from: null, to: payload.status || "Applied", at: new Date() }];
   ```
2. **Update** — append only on a real transition:
   ```js
   if (payload.status && payload.status !== existing.status) {
     update.$push = {
       statusHistory: {
         $each: [{ from: existing.status, to: payload.status, at: new Date() }],
         $slice: -100,
       },
     };
   }
   ```
3. **Clients cannot write it** — `delete payload.statusHistory` on both POST and
   PUT, before validation.
4. **Bounded** — `$slice: -100` keeps the newest 100 transitions in one atomic
   update, so the document cannot grow without limit.

Why read the existing document first instead of a single `findOneAndUpdate`?
Because the `from` value must be the *stored* status, not something from the
request. The extra read is one indexed lookup and makes the transition
trustworthy.

Why 100? It bounds the document while keeping years of history for a normal
search. Older entries are dropped; the current status is always accurate.

UI: `statusHistoryList()` renders newest first, with `from → to` and a
timestamp. Records created before the feature show "No status changes recorded
yet." — an honest empty state, not a fabricated first entry.

---

## 4. Pagination

Server:

```js
const pageNum = Math.max(parseInt(page, 10) || 1, 1);
const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
const skip = (pageNum - 1) * limitNum;
```

- `page` has no upper bound; a page beyond the end is empty with the correct
  `totalPages`.
- `limit` is clamped, never rejected, so a client cannot ask for 10 000 rows.
- `total` and the page are read in parallel.

Client:

```js
async getAllApplications(params = {}) {
  const PAGE_SIZE = 100;
  const rows = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await api.getApplications({ ...params, page, limit: PAGE_SIZE });
    const batch = res.data || [];
    rows.push(...batch);
    totalPages = res.totalPages || 1;
    if (!batch.length) break; // never loop forever on an empty page
    page += 1;
  } while (page <= totalPages);

  return { success: true, data: rows, total: rows.length, /* … */ };
}
```

Why a cap at all: it bounds one response and one database query. Why the client
pages: aggregate views (dashboard, companies, pipeline, calendar, analytics,
export, interview prep) must operate on the full set — before this, they
silently used only the first 100 records.

Complexity: `O(n)` rows transferred in `ceil(n / 100)` requests. For 10 000
records that is 100 requests, which is the point at which a dedicated export or
server-side aggregation endpoint becomes worthwhile.

---

## 5. Search and filtering

```js
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const regex = new RegExp(escapeRegex(String(search)), "i");
filter.$or = [
  { companyName: regex },
  { jobRole: regex },
  { location: regex },
  { recruiterName: regex },
  { tags: { $in: [regex] } },
];
```

- Case-insensitive substring match across five fields.
- Metacharacters are escaped, so a search for `(` is a search for a literal
  parenthesis rather than an invalid regex (which previously produced a 500).
- Enum filters are exact matches and combine.
- Without an index on these text fields, the query is a collection scan scoped
  by `userId`. At personal scale that is fine; a text index would be the next
  step for large datasets.

---

## 6. Calendar merge

The calendar has three data sources and one rule to avoid double counting.

```text
applications[] each with: applicationDate? (not shown), followUpDate?, interviewDate?, deadline?
interviews[] each with:    applicationId, interviewType, interviewDate, round
```

1. Build a set of `"<applicationId>|<YYYY-MM-DD>"` from interview rounds.
2. For each application with a legacy `interviewDate`, add a legacy event
   **only if** that application+date is not already covered by a round.
3. Add follow-ups and deadlines for every application.
4. Classify by today: `date < today` → overdue; `today ≤ date ≤ today+30` →
   upcoming; later dates appear in the agenda but not the summary cards.

Why dedupe instead of removing the legacy field: older records genuinely have an
interview date and no round. Suppressing the field entirely would hide real
data; suppressing only the duplicate keeps every fact visible exactly once.

Orphans: a round whose parent application is missing is skipped rather than
rendering a row that cannot open.

Complexity: `O(a + i)` with one set lookup per legacy date.

---

## 7. Rate limiting

Fixed window per key:

```text
key → { count, resetAt }

on request:
  now = Date.now()
  entry = map.get(key)
  if (!entry || entry.resetAt <= now) entry = { count: 0, resetAt: now + window }
  entry.count += 1
  map.set(key, entry)
  allowed = entry.count <= max
  if (!allowed) retryAfter = ceil((entry.resetAt - now) / 1000)
```

- `O(1)` time and memory per key.
- The window resets on a fixed boundary rather than sliding, so a client can
  make `2 × max` requests across a boundary. This is the standard trade-off for
  a dependency-free limiter; a sliding log or token bucket would need more state
  per key.
- Sweeping: when the map exceeds 5 000 keys, expired entries are removed. This
  keeps memory bounded without a timer that would keep the process alive.

Key composition for login: `login:<ip>|<email>`. The email is normalised
(trimmed, lowercased) so `Ada@Example.com` and `ada@example.com` share a budget.

---

## 8. CSV parsing and export

Export builds RFC 4180-style rows:

- Fields containing a comma, quote or newline are quoted.
- Inner quotes are doubled.
- Arrays (tags) are joined with `; `.
- Rows are separated by `\r\n`, and the file is served as
  `text/csv;charset=utf-8`.

Import is a small state machine that handles quoted fields, escaped quotes and
`\r\n`:

```text
for each character:
  inside quotes?
    '"' followed by '"' → literal quote
    '"'                 → close quote
    otherwise           → append
  outside quotes?
    '"' → open quote
    ',' → end field
    '\n' → end row
    otherwise → append
```

Each row is validated independently; invalid rows are collected with their line
number and reported. A row is never silently dropped.

---

## 9. Interview checklist toggle

`PATCH /api/interviews/:id/checklist/:index`:

1. Validate the id and the index (`parseInt`, `NaN` and negatives rejected).
2. Find the round scoped by `userId`.
3. If the item is absent → `404`.
4. If the body contains a boolean `done`, set it; otherwise invert the current
   value.
5. Save and return the updated round.

The default is a toggle, so a client that just wants "flip it" does not have to
read first. Sending `done` explicitly makes the operation idempotent when a
retry happens.
