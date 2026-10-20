# Frontend

Static HTML pages, ES modules and hand-written CSS. There is no framework, no
bundler and no runtime dependency. Each page owns its markup and its inline
module script; shared behaviour lives in `js/` and shared styling in `css/`.

---

## 1. Pages

| Page | Script | Data |
|---|---|---|
| `landing.html` | `js/utils.js` (icons) | Static |
| `login.html`, `register.html` | inline | `POST /api/auth/*` |
| `dashboard.html` | `js/dashboard.js` | Applications + summary |
| `applications.html` | inline | Applications (paged) |
| `pipeline.html` | inline | Applications (paged) |
| `calendar.html` | inline | Applications + interviews |
| `companies.html` | inline | Applications (paged) |
| `interview-prep.html` | inline | Applications + interviews |
| `analytics.html` | inline | `/api/analytics/summary` + applications for the series |
| `settings.html` | inline | Applications + backup/import |
| `404.html` | — | Static |

Private pages start with:

```html
<main id="main" class="app-main">
```

and call `mountShell({ active, title })`, which wires the sidebar, the account
menu and the page title. `landing.html` and the auth pages use a plain `<main>`.

## 2. Shared modules

### 2.1 `js/api.js`

One fetch wrapper for every request.

```js
api.getAllApplications()     // follows totalPages at limit=100
api.getApplication(id)       // …
api.createApplication(data)
api.updateApplication(id, data)
api.deleteApplication(id)
api.deleteAllApplicationData()   // sends { confirm: "DELETE" }
api.getInterviews()
api.createInterview(data)
api.updateInterview(id, data)
api.toggleChecklistItem(id, index)
api.getAnalyticsSummary()
api.getMe() / login / register / logout / deleteAccount
```

- Non-2xx responses throw `ApiError` with `status`, `message` and the field
  `errors` map, so callers can show per-field feedback.
- `getAllApplications()` requests page 1 at `limit=100`, then the remaining
  pages and concatenates. This exists because the server deliberately caps a
  page at 100 rows; before it, every aggregate view silently showed the first
  100 records.
- Successful payloads are unwrapped where the call site expects `data`.

### 2.2 `js/utils.js`

| Export | Purpose |
|---|---|
| `escapeHtml(value)` | Escape text before template interpolation |
| `initials(name)` | Avatar initials (up to two words) |
| `createAvatar(name, size)` | Avatar element with an accessible label |
| `formatDate(value)` | Calendar date → `Sep 15, 2026` |
| `formatDateTime(value)` | Instant → `Sep 15, 2026, 11:56 PM` |
| `formatDateInput(value)` | Calendar date → `YYYY-MM-DD` for `<input type="date">` |
| `parseDate(value)` | `YYYY-MM-DD` → **local** midnight; instants → `Date` |
| `isOverdue(value)` | Before today (local calendar day) |
| `isWithinDays(value, n)` | Today ≤ date ≤ today + n |
| `statusBadgeClass(status)` | Badge class for a status |
| `statusHistoryList(history)` | Timeline markup, newest first, honest empty state |
| `showToast(message, type)` | Stacked, polite live-region notification |
| `icon(name, className)` | Inline SVG from the shared set |

**Icons.** `icon()` returns a 24×24 stroked SVG with `aria-hidden="true"`.
Fifty-one names are available in the set, including navigation (`overview`,
`applications`, `pipeline`, `calendar`, `companies`, `prep`, `analytics`,
`settings`), actions (`plus`, `search`, `filter`, `sort`, `edit`, `trash`,
`download`, `upload`, `refresh`, `close`, `menu`), status (`check`,
`checkCircle`, `alert`, `inbox`, `shield`, `lock`), events (`briefcase`,
`phone`, `clock`, `calendar`, `mail`) and metadata (`user`, `globe`, `mapPin`,
`link`, `target`, `sparkles`, `trendingUp`, `file`, `layers`, `compass`), plus
three dedicated toast glyphs. Sizing comes from the container
(`.stat-card-icon svg`, `.activity-icon svg`, `.empty-state-icon svg`,
`.icon-inline svg`), so the same markup works at every scale.

**Dates.** `parseDate()` is the single place that turns an API value into a
`Date`. It splits `YYYY-MM-DD` and builds `new Date(y, m - 1, d)` — local
midnight — which is why a calendar date does not shift across timezones. It
never uses `new Date("2026-09-15")`, which is parsed as UTC.

### 2.3 `js/app-shell.js`

`mountShell({ active, title })`:

- marks the active navigation item;
- collapses the sidebar on desktop via the brand button, with the state applied
  to the shell and the header;
- turns the sidebar into a drawer under 768 px, with a backdrop and Escape;
- renders the user chip (initials, name, email) from `GET /api/auth/me`;
- opens the account menu (Settings, Sign out) through `Dropdown`;
- signs out by calling the API and redirecting to `/`.

The pages contain their own sidebar markup; `buildShell()` was removed because
it was unused and would have reintroduced a non-button brand control.

### 2.4 `js/dropdown.js`

A listbox component used everywhere a native `<select>` would be limiting:
status changes, filters, sorting, page size, account menu, forms.

- Trigger has `aria-haspopup="listbox"`, `aria-expanded`, and a labelled value.
- Keyboard: Arrow Up/Down, Home/End, Enter/Space, Escape, type-ahead.
- Clicking outside closes; focus returns to the trigger.
- `portal: true` renders the menu on `<body>` so a scrolling Kanban column
  cannot clip it.
- The menu is measured after opening: it always opens downward, then caps its
  height and scrolls internally when space is tight.

### 2.5 `js/dialog.js`

`confirmDialog()` and `promptDialog()` wrap a native `<dialog>`:

```js
const ok = await confirmDialog({
  title: "Delete application?",
  message: "Interview rounds linked to it are removed too.",
  confirmLabel: "Delete application",
  tone: "danger",
});

const typed = await promptDialog({
  title: "Confirm data deletion",
  message: "Type DELETE to permanently remove all of your data.",
  label: "Type DELETE to confirm",
  requiredValue: "DELETE",
  errorMessage: "That does not match. Type DELETE exactly.",
  confirmLabel: "Delete everything",
});
```

- `showModal()` makes the page inert and contains focus; the browser handles the
  focus trap.
- Title and message are set with `textContent`; user data never becomes markup.
- Escape and a backdrop click cancel; Enter submits the input dialog.
- A wrong typed value keeps the dialog open, sets `aria-invalid="true"` and shows
  an inline `role="alert"` error.
- Focus returns to the trigger, or to `<main>` when the trigger was inside a
  modal the caller already closed.
- A `close` listener settles the promise even if the browser closes the dialog
  by another path, so an `await` can never hang.

## 3. Rendering pattern

```js
async function loadApps() {
  showLoading();
  try {
    const res = await api.getAllApplications();
    apps = res.data || [];
    render();
  } catch (err) {
    console.error("Failed to load applications:", err);
    showError("Unable to load applications. Please check your connection.");
    showToast("Failed to load applications.", "error");
  }
}
```

Rules applied consistently:

1. **Loading, empty, error, and populated** are four distinct states. Empty
   states explain what will appear and how to create it.
2. **Escape user text** with `escapeHtml()` in text *and* attribute positions.
3. **Delegate events** on a container rather than attaching a listener per row.
   Interactive rows use `data-*` attributes plus click and keydown handlers.
4. **Re-render, do not patch.** Lists are rebuilt from the current array; there
   is no virtual DOM and no stale node state.
5. **The server owns numbers.** Analytics reads `summary`; the client only maps
   values to markup.

## 4. Components

| Component | Markup / class | Notes |
|---|---|---|
| Button | `.btn` + `.btn-primary` / `.btn-outline` / `.btn-ghost` / `.btn-danger` | 40 px tall, 44 px touch target on mobile; hover, focus-visible, disabled, `.is-loading` |
| Icon button | `.btn-icon` | Always has `aria-label` |
| Input | `.input` | Visible label, `.form-error`, `.error` state |
| Badge | `.badge` + status class | Text plus colour never colour alone |
| Stat card | `.stat-card`, `.stat-card-icon` | 19 px icon in a tinted square |
| Empty state | `.empty-state`, `.empty-state-icon`, `-title`, `-desc` | SVG icon, explanation |
| Activity row | `.activity-item`, `.activity-icon`, `.activity-content` | Used by dashboard, calendar |
| Modal | `.modal-overlay` + `.modal` | `role="dialog"`, `aria-modal`, labelled title, focus return |
| Confirm dialog | `.dialog` (native `<dialog>`) | See §2.5 |
| Toast | `.toast-stack`, `role="status"`, `aria-live="polite"` | One path: `showToast()` |
| Dropdown | `js/dropdown.js` | ARIA listbox, keyboard, portal option |

## 5. Design system

`css/design-system.css` is organised as tokens → reset → layout → components →
utilities → responsive.

**Tokens.** Colour (deep navy surfaces, indigo primary, semantic success /
warning / error / info with light variants), spacing scale, radii, shadows,
typography scale, weights, line heights, letter spacing, durations, easings, and
z-index layers. No component uses a raw hex value outside the token block, with
two exceptions that are documented in place (a darker danger hover and the
sidebar's translucent white text).

**Typography.** One sans stack; sizes from `--text-xs` to `--text-3xl`; headings
use tighter tracking and a heavier weight; numerals in stat cards use tabular
figures so counts do not jitter.

**Responsive.** Breakpoints at 600, 768, 900 and 1024 px:

- under 768 px the sidebar becomes a drawer, the header gains a menu button, and
  grids collapse to one column;
- under 900 px tables become stacked cards; less important columns hide first;
- toolbars wrap; long values truncate with a title attribute rather than
  overflowing;
- modals become bottom sheets under 600 px.

Verified at 320, 360, 390, 768, 1024 and 1440 px with no horizontal page scroll.

## 6. Accessibility

- One `<h1>` per page, sequential headings, landmarks (`header`, `nav`, `main`,
  `aside`, `footer`).
- Every input has a `<label for>`; errors are linked text, not colour alone.
- Focus is visible everywhere (`:focus-visible` ring using the primary colour).
- Icon-only controls have `aria-label`; decorative SVGs are `aria-hidden`.
- Dropdowns implement listbox semantics; dialogs implement modal semantics.
- Toasts use a polite live region, so they are announced without stealing focus.
- Status badges always include the status word.
- `prefers-reduced-motion` removes transitions and scroll animation.
- Clickable rows are operable with Enter and Space and expose `role="button"`
  only when they do not contain other interactive controls.

## 7. Browser support

Modern evergreen browsers: ES modules, `fetch`, `URLSearchParams`, `<dialog>`,
`Element.closest`, `Intl`. No polyfills are included; the app degrades to an
explicit error message rather than silently breaking.
