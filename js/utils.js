/* ==========================================================================
   CareerFlow — Utility Functions
   ==========================================================================
   Shared helpers: dates, status colors, initials, safe DOM rendering,
   toasts, icons, and formatters.
   ========================================================================== */

// Application statuses — must match the backend enum
export const STATUSES = [
  "Bookmarked",
  "Applied",
  "Assessment",
  "Interview",
  "Offer",
  "Rejected",
  "Withdrawn",
];

export const WORK_MODES = ["On-site", "Hybrid", "Remote"];
export const EMPLOYMENT_TYPES = ["Full-time", "Internship", "Contract", "Part-time"];
export const JOB_SOURCES = [
  "LinkedIn",
  "Company Website",
  "Referral",
  "Campus Placement",
  "Job Portal",
  "Other",
];
export const PRIORITIES = ["Low", "Medium", "High"];

// Badge class per status (matches .badge-status-* in the design system)
export function statusBadgeClass(status) {
  return `badge-status-${String(status || "Applied").toLowerCase()}`;
}

/**
 * Render the server-written status trail, newest first.
 * Returns HTML, so every value is escaped here.
 */
export function statusHistoryList(history) {
  if (!Array.isArray(history) || !history.length) {
    return `<p class="text-xs text-muted">No status changes recorded yet.</p>`;
  }
  return `<ul class="space-y-2">${[...history]
    .reverse()
    .map(
      (entry) => `
        <li class="flex items-start gap-2">
          <span class="w-1.5 h-1.5 rounded-full bg-primary" style="margin-top:6px;flex-shrink:0;"></span>
          <span class="text-xs text-secondary">
            ${entry.from ? `<span class="text-muted">${escapeHtml(entry.from)} &rarr;</span> ` : ""}
            <span class="font-medium text-main">${escapeHtml(entry.to)}</span>
            <span class="text-muted">&middot; ${formatDateTime(entry.at)}</span>
          </span>
        </li>`
    )
    .join("")}</ul>`;
}

/* --------------------------------------------------------------------------
   Dates

   Calendar dates (applicationDate, followUpDate, interviewDate, deadline) are
   transferred as `YYYY-MM-DD` and parsed in local time, so the day the user
   typed is the day that is displayed in every timezone. Instants such as
   createdAt keep their timestamp and render in local time.
   -------------------------------------------------------------------------- */
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnly(value) {
  return typeof value === "string" && DATE_ONLY_RE.test(value);
}

/** Parse a value into a Date, treating `YYYY-MM-DD` as local midnight. */
export function parseDate(value) {
  if (!value) return null;
  if (isDateOnly(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const d = new Date(year, month - 1, day);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value) {
  const d = parseDate(value);
  if (!d) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateShort(value) {
  const d = parseDate(value);
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatDateTime(value) {
  const d = parseDate(value);
  if (!d) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDateInput(value) {
  const d = parseDate(value);
  if (!d) return "";
  if (isDateOnly(value)) return value;
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().split("T")[0];
}

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isOverdue(value) {
  const d = parseDate(value);
  if (!d) return false;
  return d < startOfToday();
}

export function isWithinDays(value, days) {
  const d = parseDate(value);
  if (!d) return false;
  const today = startOfToday();
  const limit = new Date(today);
  limit.setDate(today.getDate() + days);
  return d >= today && d <= limit;
}

export function relativeDay(value) {
  const d = parseDate(value);
  if (!d) return "—";
  d.setHours(0, 0, 0, 0);
  const today = startOfToday();
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1) return `In ${diff} days`;
  return `${-diff} days ago`;
}

/* --------------------------------------------------------------------------
   Text & formatting
   -------------------------------------------------------------------------- */
export function initials(name, maxChars = 2) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, maxChars).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function escapeHtml(text) {
  if (text == null) return "";
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

export function formatCurrency(value, currency = "USD") {
  if (value == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return String(value);
  }
}

export function isValidUrl(value) {
  if (!value || !value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function debounce(fn, wait = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/* --------------------------------------------------------------------------
   DOM
   -------------------------------------------------------------------------- */
export function createAvatar(name, size = 36) {
  const div = document.createElement("div");
  div.className = "avatar-circle";
  div.textContent = initials(name);
  div.style.width = `${size}px`;
  div.style.height = `${size}px`;
  div.style.fontSize = size <= 32 ? "0.65rem" : "0.75rem";
  div.setAttribute("aria-label", `Company: ${name}`);
  return div;
}

/* --------------------------------------------------------------------------
   Toast notifications
   -------------------------------------------------------------------------- */
let toastStack = null;

function ensureToastStack() {
  if (toastStack && document.body.contains(toastStack)) return toastStack;
  toastStack = document.createElement("div");
  toastStack.className = "toast-stack";
  toastStack.setAttribute("role", "status");
  toastStack.setAttribute("aria-live", "polite");
  document.body.appendChild(toastStack);
  return toastStack;
}

const TOAST_ICONS = {
  success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`,
  error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>`,
};

export function showToast(message, type = "success", duration = 4000) {
  const stack = ensureToastStack();
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `${TOAST_ICONS[type] || TOAST_ICONS.info}<span></span>`;
  toast.querySelector("span").textContent = message;
  stack.appendChild(toast);

  const remove = () => {
    toast.classList.add("is-leaving");
    setTimeout(() => toast.remove(), 200);
  };
  const timer = setTimeout(remove, duration);
  toast.addEventListener("click", () => {
    clearTimeout(timer);
    remove();
  });
  return toast;
}

/* --------------------------------------------------------------------------
   Icon set — one coherent 24×24 stroke system
   -------------------------------------------------------------------------- */
const ICON_PATHS = {
  overview: `<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18"/>`,
  applications: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>`,
  pipeline: `<rect x="3" y="3" width="7" height="18" rx="1.5"/><rect x="14" y="3" width="7" height="11" rx="1.5"/>`,
  calendar: `<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>`,
  companies: `<path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 21v-5h6v5"/>`,
  prep: `<path d="M12 21s7-3.5 7-9V5l-7-3-7 3v7c0 5.5 7 9 7 9z"/><path d="M9 11l2 2 4-4"/>`,
  analytics: `<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>`,
  settings: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  search: `<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>`,
  filter: `<path d="M3 5h18M7 12h10M10 19h4"/>`,
  sort: `<path d="M7 4v16M7 20l-3-3M7 4l3 3M17 20V4M17 4l3 3M17 20l-3-3"/>`,
  edit: `<path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`,
  trash: `<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>`,
  external: `<path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>`,
  logout: `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>`,
  chevronDown: `<path d="M6 9l6 6 6-6"/>`,
  chevronRight: `<path d="M9 18l6-6-6-6"/>`,
  arrowRight: `<path d="M5 12h14M13 6l6 6-6 6"/>`,
  arrowUp: `<path d="M12 19V5M5 12l7-7 7 7"/>`,
  arrowDown: `<path d="M12 5v14M19 12l-7 7-7-7"/>`,
  menu: `<path d="M3 12h18M3 6h18M3 18h18"/>`,
  close: `<path d="M18 6L6 18M6 6l12 12"/>`,
  check: `<path d="M20 6L9 17l-5-5"/>`,
  target: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>`,
  zap: `<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>`,
  bell: `<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>`,
  layers: `<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>`,
  file: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
  mail: `<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 7l10 6 10-6"/>`,
  link: `<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>`,
  user: `<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>`,
  lock: `<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>`,
  eye: `<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>`,
  eyeOff: `<path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3 3.6M6.6 6.6A17 17 0 0 0 2 12s3.6 6 10 6a9.7 9.7 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M2 2l20 20"/>`,
  shield: `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`,
  download: `<path d="M12 3v12M7 11l5 5 5-5"/><path d="M4 21h16"/>`,
  upload: `<path d="M12 21V9M7 13l5-5 5 5"/><path d="M4 3h16"/>`,
  sparkles: `<path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z"/>`,
  trendingUp: `<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>`,
  briefcase: `<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
  phone: `<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.1a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2z"/>`,
  clipboard: `<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>`,
  compass: `<circle cx="12" cy="12" r="9"/><path d="M16 8l-2 6-6 2 2-6 6-2z"/>`,
  globe: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/>`,
  mapPin: `<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>`,
  inbox: `<path d="M4 4h16l2 10v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4L4 4z"/><path d="M2 14h5l1.5 2.5h7L17 14h5"/>`,
  alert: `<path d="M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>`,
  checkCircle: `<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>`,
  refresh: `<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>`,
};

/**
 * Return an inline SVG string for the given icon name.
 * @param {string} name  key from ICON_PATHS
 * @param {string} [className]
 */
export function icon(name, className = "") {
  const path = ICON_PATHS[name] || ICON_PATHS.file;
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export const ICON_NAMES = Object.keys(ICON_PATHS);
