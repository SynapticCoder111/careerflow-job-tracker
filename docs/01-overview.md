# CareerFlow — Project Overview

CareerFlow is a full-stack job-application tracker. One account holds every
application a person has sent, the interview rounds attached to each one, and
the dates that matter next: follow-ups, interviews and deadlines. The workspace
turns that data into a pipeline, a calendar, company summaries and analytics.

It is deliberately a small product: no third-party services, no build step, no
framework. A reviewer can read the whole system in an afternoon.

---

## 1. The problem

Job searching produces a spreadsheet problem that a spreadsheet handles badly:

- applications move through stages (bookmarked → applied → assessment →
  interview → offer/rejected/withdrawn) and the current stage is not the whole
  story;
- each stage has dates attached, and a missed follow-up is invisible until it
  is late;
- multiple interview rounds belong to one application, each with its own
  preparation material;
- "how am I doing?" requires denominators — 3 offers means nothing without
  knowing whether 5 or 50 applications were sent.

CareerFlow stores the records once and derives every view from them. Nothing is
duplicated into a second store, and no statistic is typed in by hand.

## 2. Who it is for

| User | Need |
|---|---|
| An active job seeker | Track 10–200 applications without maintaining a spreadsheet |
| Someone interviewing | Keep rounds, interviewers and preparation checklists in one place |
| A reviewer / interviewer | See a complete, honest full-stack implementation with real auth, real persistence and real tests |

## 3. What it does

| Area | Capability |
|---|---|
| Applications | Create, read, update, delete; search across company, role, location, recruiter and tags; filter by status, work mode, employment type, source and priority; sort; paginate |
| Pipeline | Kanban board grouped by status; change status from an accessible dropdown on each card |
| Calendar | Every dated event merged into one agenda: interview rounds, legacy interview dates, follow-ups and deadlines; overdue list; no hidden caps |
| Interview prep | Multiple rounds per application with type, date, interviewer, location, topics, questions, notes, next steps and a persisted checklist |
| Companies | Applications grouped by company, derived from records, with status breakdown and recruiter contacts |
| Analytics | Server-computed totals, conversion rates with explicit denominators, averages with sample sizes, and five breakdowns |
| Status history | Every status transition recorded server-side with a timestamp and shown as a timeline |
| Data portability | CSV export, JSON backup, validated CSV import, delete-all, delete-account |
| Accounts | Register, sign in, sign out, session persistence, account deletion |

## 4. Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js (CommonJS on the server, ES modules in the browser) | No transpiler, no bundler |
| Server | Express 5 | Small surface, familiar to reviewers |
| Database | MongoDB via Mongoose 9 | Documents map cleanly to applications and embedded history |
| Frontend | Static HTML + ES modules + hand-written CSS | No framework; every behaviour is visible in the file that owns it |
| Auth | Node `crypto` scrypt + random session tokens in MongoDB | No dependency for password hashing |
| Tests | Node's built-in `fetch` + `node --check` | No test framework to install |

Versions are pinned in `server/package.json`. The browser code has no
dependencies at all.

## 5. A tour of the interface

| Route | Purpose |
|---|---|
| `/` | Marketing page: product explanation, workflow, FAQ, demo credentials |
| `/login`, `/register` | Authentication |
| `/dashboard` | Counts, activity chart, pipeline summary, upcoming work, recent applications |
| `/applications` | Table/card list with search, filters, sorting, pagination, detail modal, add/edit forms |
| `/pipeline` | Kanban board by status |
| `/calendar` | Upcoming, agenda by date, overdue |
| `/companies` | Company cards with application counts and contacts |
| `/interview-prep` | Interview rounds with preparation checklists |
| `/analytics` | Server-computed metrics and charts |
| `/settings` | Preferences, export/import, destructive actions |

## 6. What is deliberately not here

- No fake testimonials, user counts or "trusted by" logos.
- No drag-and-drop: status changes go through a keyboard-accessible dropdown.
- No "average time to offer": no offer timestamp is stored, so the number
  cannot be computed honestly.
- No email sending, password reset, OAuth or multi-factor authentication.
- No third-party analytics.

See [12-limitations.md](12-limitations.md) for the complete list.

## 7. Where to read next

| Question | Document |
|---|---|
| What was found and fixed? | [00-audit-report.md](00-audit-report.md) |
| What must the system do? | [02-requirements.md](02-requirements.md) |
| How is it structured? | [03-architecture.md](03-architecture.md) |
| What does the data look like? | [04-database.md](04-database.md) |
| What does the API accept? | [05-api.md](05-api.md) |
| How is the UI built? | [06-frontend.md](06-frontend.md) |
| How is the server built? | [07-backend.md](07-backend.md) |
| How is it secured? | [08-security.md](08-security.md) |
| How are the numbers computed? | [09-algorithms.md](09-algorithms.md) |
| How is it tested? | [10-testing.md](10-testing.md) |
| How is it deployed? | [11-deployment.md](11-deployment.md) |
| What are the trade-offs? | [13-decisions.md](13-decisions.md) |
| How to talk about it in an interview | [14-interview-prep.md](14-interview-prep.md) |
