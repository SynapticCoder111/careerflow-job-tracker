/* ==========================================================================
   CareerFlow — Dashboard (Overview page)
   ==========================================================================
   Fetches real application data from the API and renders:
   - Summary cards (calculated from stored records)
   - Application activity chart (applications per week)
   - Pipeline summary (counts per status)
   - Upcoming activity (interviews, deadlines, follow-ups)
   - Recent applications
   - Attention required (overdue follow-ups, upcoming deadlines)
   ========================================================================== */

import { api } from "./api.js";
import {
  formatDate,
  formatDateInput,
  isOverdue,
  isWithinDays,
  initials,
  escapeHtml,
  createAvatar,
  showToast,
  parseDate,
  STATUSES,
  statusBadgeClass,
  icon,
} from "./utils.js";
import { mountShell } from "./app-shell.js";

// ---- DOM refs ----
const summaryCardsEl = document.getElementById("summary-cards");
const activityChartEl = document.getElementById("activity-chart");
const pipelineSummaryEl = document.getElementById("pipeline-summary");
const upcomingActivityEl = document.getElementById("upcoming-activity");
const recentApplicationsEl = document.getElementById("recent-applications");
const attentionRequiredEl = document.getElementById("attention-required");

// Add form
const addModal = document.getElementById("add-modal");
const openAddFormBtn = document.getElementById("open-add-form");
const closeAddModalBtn = document.getElementById("close-add-modal");
const cancelAddBtn = document.getElementById("cancel-add");
const addForm = document.getElementById("add-form");

// ---- State ----
let applications = [];

// ---- Initialize ----
document.addEventListener("DOMContentLoaded", () => {
  mountShell({ active: "dashboard", title: "Overview" });
  setCurrentDate();
  loadDashboard();
  setupAddForm();

  // Personalise the greeting once the signed-in user is known.
  document.addEventListener("careerflow:user", (e) => {
    const title = document.getElementById("welcome-title");
    if (title && e.detail?.name) {
      const first = e.detail.name.split(/\s+/)[0];
      title.textContent = `Welcome back, ${first}`;
    }
  });
});

// Set the current date in the header
function setCurrentDate() {
  const el = document.getElementById("header-date");
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Load all data and render the dashboard
async function loadDashboard() {
  try {
    const response = await api.getAllApplications();
    applications = response.data || [];
    renderDashboard(applications);
  } catch (err) {
    console.error("Failed to load dashboard:", err);
    showEmptyState("Unable to load applications. Please check your connection and try again.");
    showToast("Failed to load dashboard data.", "error");
  }
}

// ---- Rendering ----
function renderDashboard(apps) {
  renderSummaryCards(apps);
  renderActivityChart(apps);
  renderPipelineSummary(apps);
  renderUpcomingActivity(apps);
  renderRecentApplications(apps);
  renderAttentionRequired(apps);
}

// --- Summary cards ---
function renderSummaryCards(apps) {
  const total = apps.length;
  const inProgress = apps.filter(
    (a) => a.status === "Applied" || a.status === "Assessment" || a.status === "Interview"
  ).length;
  const interviews = apps.filter((a) => a.status === "Interview").length;
  const offers = apps.filter((a) => a.status === "Offer").length;
  const followupsDue = apps.filter(
    (a) => a.followUpDate && (isOverdue(a.followUpDate) || isWithinDays(a.followUpDate, 7))
  ).length;

  const cards = [
    {
      label: "Total Applications",
      value: total,
      sub: "All recorded applications",
      icon: icon("file"),
      colorClass: "text-primary",
      bgClass: "bg-primary-light",
    },
    {
      label: "In Progress",
      value: inProgress,
      sub: "Applied, Assessment, Interview",
      icon: icon("clock"),
      colorClass: "text-secondary",
      bgClass: "bg-secondary-light",
    },
    {
      label: "Interviews Scheduled",
      value: interviews,
      sub: "Status: Interview",
      icon: icon("calendar"),
      colorClass: "text-info",
      bgClass: "bg-info-light",
    },
    {
      label: "Offers Received",
      value: offers,
      sub: "Status: Offer",
      icon: icon("sparkles"),
      colorClass: "text-success",
      bgClass: "bg-success-light",
    },
    {
      label: "Follow-ups Due",
      value: followupsDue,
      sub: "Due within 7 days or overdue",
      icon: icon("bell"),
      colorClass: "text-warning",
      bgClass: "bg-warning-light",
    },
  ];

  summaryCardsEl.innerHTML = cards.map((c) => `
    <div class="stat-card">
      <div class="stat-card-header">
        <div class="stat-card-content">
          <p class="stat-card-label">${escapeHtml(c.label)}</p>
          <p class="stat-card-value ${c.colorClass}">${c.value}</p>
          <p class="stat-card-sub">${escapeHtml(c.sub)}</p>
        </div>
        <div class="stat-card-icon ${c.bgClass}">${c.icon}</div>
      </div>
    </div>
  `).join("");
}

// --- Activity chart (applications per week, last 8 weeks) ---
function renderActivityChart(apps) {
  if (!apps.length) {
    activityChartEl.innerHTML = emptyChartState("No applications yet. Add your first application to see activity.");
    return;
  }

  // Group by ISO week (YYYY-Www)
  const weeklyCounts = {};
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Last 8 weeks including current
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay() - i * 7); // start of week (Sunday)
    const weekKey = weekKeyOf(d);
    weeks.push({ date: d, key: weekKey, count: 0 });
    weeklyCounts[weekKey] = 0;
  }

  apps.forEach((a) => {
    if (!a.applicationDate) return;
    const d = parseDate(a.applicationDate);
    if (!d) return;
    const key = weekKeyOf(d);
    if (weeklyCounts[key] !== undefined) weeklyCounts[key]++;
  });

  weeks.forEach((w) => { w.count = weeklyCounts[w.key] || 0; });

  const maxCount = Math.max(...weeks.map((w) => w.count), 1);

  // If all zeros, show empty state
  if (maxCount === 0) {
    activityChartEl.innerHTML = emptyChartState("No application dates recorded yet. Add an application date to see activity.");
    return;
  }

  // Vertical bar chart (SVG) — matches the analytics styling
  const width = 560;
  const height = 240;
  const padL = 34;
  const padR = 12;
  const padT = 18;
  const padB = 40;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const slot = chartW / weeks.length;
  const barW = Math.min(slot * 0.52, 44);

  let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Applications submitted per week over the last 8 weeks" style="width:100%;height:auto;font-family:var(--font-sans)">
    <defs>
      <linearGradient id="dashGrad" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" style="stop-color:var(--color-primary);stop-opacity:1"/>
        <stop offset="100%" style="stop-color:var(--color-accent);stop-opacity:1"/>
      </linearGradient>
    </defs>`;

  // Gridlines + y-axis labels
  for (let i = 0; i <= 4; i++) {
    const y = padT + (chartH / 4) * i;
    const val = Math.round(maxCount - (maxCount / 4) * i);
    svg += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="var(--color-border)" stroke-width="1" stroke-dasharray="3 3"/>
            <text x="${padL - 8}" y="${y + 4}" font-size="10" fill="var(--color-text-muted)" text-anchor="end">${val}</text>`;
  }

  weeks.forEach((w, i) => {
    const barH = (w.count / maxCount) * chartH;
    const x = padL + slot * i + (slot - barW) / 2;
    const y = padT + chartH - barH;
    svg += `
      <g>
        <rect x="${x}" y="${y}" width="${barW}" height="${Math.max(barH, 0)}" rx="4" fill="url(#dashGrad)">
          <title>Week of ${escapeHtml(weekLabel(w.date))}: ${w.count} application(s)</title>
        </rect>
        ${w.count > 0 ? `<text x="${x + barW / 2}" y="${y - 6}" font-size="11" font-weight="600" fill="var(--color-text-main)" text-anchor="middle">${w.count}</text>` : ''}
        <text x="${x + barW / 2}" y="${height - 18}" font-size="9" fill="var(--color-text-secondary)" text-anchor="middle">${escapeHtml(weekLabel(w.date))}</text>
      </g>`;
  });

  svg += `</svg>`;

  activityChartEl.innerHTML = `
    <p class="text-xs text-muted mb-3">Applications submitted per week (last 8 weeks)</p>
    ${svg}
  `;
}

function weekKeyOf(d) {
  // Thursday-based ISO week
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function weekLabel(d) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function emptyChartState(msg) {
  return `<div class="empty-state" style="padding: var(--space-6) var(--space-4);">
    <div class="empty-state-icon" style="width:40px;height:40px;">${icon("analytics")}</div>
    <div class="empty-state-title" style="font-size: var(--font-size-base);">${escapeHtml(msg)}</div>
  </div>`;
}

// --- Pipeline summary ---
function renderPipelineSummary(apps) {
  const order = ["Bookmarked", "Applied", "Assessment", "Interview", "Offer", "Rejected", "Withdrawn"];
  const counts = {};
  order.forEach((s) => { counts[s] = 0; });
  apps.forEach((a) => { if (counts[a.status] !== undefined) counts[a.status]++; });

  const total = apps.length || 1;

  pipelineSummaryEl.innerHTML = order.map((status) => {
    const count = counts[status] || 0;
    const pct = total ? Math.round((count / total) * 100) : 0;
    return `
      <div class="mb-3">
        <div class="flex justify-between items-center mb-1">
          <span class="badge ${statusBadgeClass(status)} text-xs">${escapeHtml(status)}</span>
          <span class="text-xs font-semibold text-main">${count}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-bar-fill" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join("");
}

// --- Upcoming activity ---
function renderUpcomingActivity(apps) {
  const events = [];

  apps.forEach((a) => {
    if (a.interviewDate) {
      events.push({
        date: a.interviewDate,
        title: `Interview: ${escapeHtml(a.jobRole)}`,
        company: a.companyName,
        type: "interview",
        status: a.status,
        appId: a.id,
      });
    }
    if (a.followUpDate) {
      events.push({
        date: a.followUpDate,
        title: `Follow-up: ${escapeHtml(a.companyName)}`,
        company: a.jobRole,
        type: "followup",
        status: a.status,
        appId: a.id,
      });
    }
    if (a.deadline) {
      events.push({
        date: a.deadline,
        title: `Deadline: ${escapeHtml(a.jobRole)}`,
        company: a.companyName,
        type: "deadline",
        status: a.status,
        appId: a.id,
      });
    }
  });

  // Sort chronologically, nearest first
  events.sort((x, y) => parseDate(x.date) - parseDate(y.date));
  const upcoming = events.filter((e) => !isOverdue(e.date)).slice(0, 6);

  if (!upcoming.length) {
    upcomingActivityEl.innerHTML = `
      <div class="empty-state" style="padding: var(--space-4);">
        <div class="empty-state-icon" style="width:32px;height:32px;">${icon("calendar")}</div>
        <div class="empty-state-title" style="font-size: var(--font-size-sm);">No upcoming activity</div>
        <div class="empty-state-desc" style="font-size: var(--font-size-xs);">Interviews, follow-ups, and deadlines will appear here.</div>
      </div>
    `;
    return;
  }

  upcomingActivityEl.innerHTML = upcoming.map((e) => `
    <div class="activity-item">
      <div class="activity-icon ${eventTypeColor(e.type)}" style="color: white;">${eventTypeIcon(e.type)}</div>
      <div class="activity-content">
        <div class="activity-title">${e.title}</div>
        <div class="activity-meta">
          <span>${escapeHtml(e.company)}</span>
          <span>${formatDate(e.date)}</span>
          <span class="badge ${statusBadgeClass(e.status)}">${escapeHtml(e.status)}</span>
        </div>
      </div>
    </div>
  `).join("");
}

function eventTypeColor(type) {
  return type === "interview" ? "bg-primary" : type === "followup" ? "bg-warning" : "bg-secondary";
}

function eventTypeIcon(type) {
  if (type === "interview") return icon("briefcase");
  if (type === "followup") return icon("phone");
  return icon("clock");
}

// --- Recent applications ---
function renderRecentApplications(apps) {
  const recent = [...apps]
    .sort((a, b) => parseDate(b.createdAt || b.applicationDate || 0) - parseDate(a.createdAt || a.applicationDate || 0))
    .slice(0, 5);

  if (!recent.length) {
    recentApplicationsEl.innerHTML = `
      <div class="empty-state" style="padding: var(--space-4);">
        <div class="empty-state-icon" style="width:32px;height:32px;">${icon("file")}</div>
        <div class="empty-state-title" style="font-size: var(--font-size-sm);">No applications yet</div>
        <div class="empty-state-desc" style="font-size: var(--font-size-xs);">Add your first application to get started.</div>
      </div>
    `;
    return;
  }

  recentApplicationsEl.innerHTML = recent.map((a) => `
    <div class="activity-item" onclick="location.href='/applications'">
      <div class="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center text-primary font-semibold text-xs" style="flex-shrink:0;">
        ${initials(a.companyName)}
      </div>
      <div class="activity-content">
        <div class="activity-title">${escapeHtml(a.companyName)}</div>
        <div class="activity-meta">
          <span>${escapeHtml(a.jobRole)}</span>
          <span class="badge ${statusBadgeClass(a.status)}">${escapeHtml(a.status)}</span>
          <span>${formatDate(a.applicationDate)}</span>
        </div>
      </div>
    </div>
  `).join("");
}

// --- Attention required ---
function renderAttentionRequired(apps) {
  const items = [];

  apps.forEach((a) => {
    // Overdue follow-up
    if (a.followUpDate && isOverdue(a.followUpDate)) {
      items.push({
        type: "overdue",
        title: `Overdue follow-up: ${escapeHtml(a.companyName)}`,
        detail: `Role: ${escapeHtml(a.jobRole)} • Was due ${formatDate(a.followUpDate)}`,
        appId: a.id,
        urgency: "high",
      });
    }
    // Upcoming deadline (within 7 days)
    if (a.deadline && isWithinDays(a.deadline, 7) && !isOverdue(a.deadline)) {
      items.push({
        type: "deadline",
        title: `Upcoming deadline: ${escapeHtml(a.jobRole)}`,
        detail: `${escapeHtml(a.companyName)} • ${formatDate(a.deadline)}`,
        appId: a.id,
        urgency: "medium",
      });
    }
    // Application needs update (no follow-up and older than 14 days, not rejected/offer/withdrawn)
    if (
      !a.followUpDate &&
      !a.interviewDate &&
      !["Rejected", "Offer", "Withdrawn"].includes(a.status) &&
      a.applicationDate &&
      new Date(parseDate(a.applicationDate)) < new Date(Date.now() - 14 * 86400000)
    ) {
      items.push({
        type: "update",
        title: `Needs update: ${escapeHtml(a.companyName)}`,
        detail: `${escapeHtml(a.jobRole)} • ${escapeHtml(a.status)} since ${formatDate(a.applicationDate)}`,
        appId: a.id,
        urgency: "low",
      });
    }
  });

  // Sort: overdue first, then deadline, then update
  const order = { high: 0, medium: 1, low: 2 };
  items.sort((x, y) => order[x.urgency] - order[y.urgency]);
  const top = items.slice(0, 5);

  if (!top.length) {
    attentionRequiredEl.innerHTML = `
      <div class="empty-state" style="padding: var(--space-4);">
        <div class="empty-state-icon" style="width:32px;height:32px;">${icon("checkCircle")}</div>
        <div class="empty-state-title" style="font-size: var(--font-size-sm);">Nothing needs attention</div>
        <div class="empty-state-desc" style="font-size: var(--font-size-xs);">All your applications are up to date.</div>
      </div>
    `;
    return;
  }

  attentionRequiredEl.innerHTML = top.map((item) => `
    <div class="activity-item border-l-2 ${urgencyColor(item.urgency)}" onclick="location.href='/applications'">
      <div class="activity-content flex-1 min-w-0">
        <div class="activity-title">${item.title}</div>
        <div class="activity-meta">
          <span>${item.detail}</span>
          <span class="badge badge-error text-xs">${item.type}</span>
        </div>
      </div>
    </div>
  `).join("");
}

function urgencyColor(u) {
  return u === "high" ? "border-error bg-error-light" : u === "medium" ? "border-warning bg-warning-light" : "border-secondary bg-secondary-light";
}

// --- Show empty state when load fails ---
function showEmptyState(msg) {
  summaryCardsEl.innerHTML = "";
  activityChartEl.innerHTML = emptyChartState(msg);
  pipelineSummaryEl.innerHTML = "";
  upcomingActivityEl.innerHTML = "";
  recentApplicationsEl.innerHTML = "";
  attentionRequiredEl.innerHTML = "";
}

// ---- Add application form ----
function setupAddForm() {
  if (!addForm || !openAddFormBtn) return;

  openAddFormBtn.addEventListener("click", () => {
    addForm.reset();
    addModal.classList.add("open");
  });

  const closeModal = () => {
    addModal.classList.remove("open");
  };

  closeAddModalBtn.addEventListener("click", closeModal);
  cancelAddBtn.addEventListener("click", closeModal);

  // Click outside to close
  addModal.addEventListener("click", (e) => {
    if (e.target === addModal) closeModal();
  });

  // Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const company = document.getElementById("add-company").value.trim();
    const role = document.getElementById("add-role").value.trim();
    const status = document.getElementById("add-status").value;
    const date = document.getElementById("add-date").value;
    const link = document.getElementById("add-link").value.trim();
    const notes = document.getElementById("add-notes").value.trim();

    // Client-side validation
    let valid = true;
    const fields = {
      "add-company": "Company name is required",
      "add-role": "Job role is required",
    };
    for (const [id, msg] of Object.entries(fields)) {
      const el = document.getElementById(id);
      const err = document.getElementById(`${id}-error`);
      if (!el.value.trim()) {
        el.classList.add("error");
        err.textContent = msg;
        valid = false;
      } else {
        el.classList.remove("error");
        err.textContent = "";
      }
    }

    if (link && !isValidUrl(link)) {
      const el = document.getElementById("add-link");
      const err = document.getElementById("add-link-error");
      el.classList.add("error");
      err.textContent = "Please enter a valid URL (http/https).";
      valid = false;
    } else {
      const el = document.getElementById("add-link");
      const err = document.getElementById("add-link-error");
      el.classList.remove("error");
      err.textContent = "";
    }

    if (!valid) return;

    const submitBtn = document.getElementById("submit-add");
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving&hellip;";

    try {
      const payload = {
        companyName: company,
        jobRole: role,
        status,
        applicationDate: date || null,
        jobLink: link || null,
        notes: notes || null,
      };

      await api.createApplication(payload);
      addModal.classList.remove("open");
      addForm.reset();
      showToast("Application created successfully.");
      loadDashboard();
    } catch (err) {
      console.error("Create failed:", err);
      if (err.errors) {
        for (const [field, msg] of Object.entries(err.errors)) {
          const el = document.getElementById(`add-${field}`);
          const errEl = document.getElementById(`add-${field}-error`);
          if (el && errEl) {
            el.classList.add("error");
            errEl.textContent = msg;
          }
        }
      } else {
        showToast(err.message || "Failed to create application.", "error");
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Save Application";
    }
  });
}

// ---- Sidebar ----
// (Handled by the shared app-shell module.)

// URL validation helper (copied from utils to avoid circular import)
function isValidUrl(value) {
  if (!value || !value.trim()) return true; // optional field
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (e) {
    return false;
  }
}