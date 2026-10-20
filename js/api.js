/* ==========================================================================
   CareerFlow — API Helper
   ==========================================================================
   Centralized fetch wrapper. All pages use this instead of raw fetch.
   ========================================================================== */

const API_BASE = (() => {
  // Allow override via a global set before this module loads
  if (typeof window !== "undefined" && window.__API_BASE__) {
    return window.__API_BASE__;
  }
  return "";
})();

class ApiError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors || null;
  }
}

// Parse JSON response safely; throw ApiError on non-ok responses
async function parseResponse(res) {
  let body;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      body = await res.json();
    } catch (e) {
      body = null;
    }
  } else {
    body = await res.text();
  }

  if (!res.ok) {
    throw new ApiError(
      res.status,
      (body && body.message) || `Request failed (${res.status})`,
      body && body.errors ? body.errors : null
    );
  }
  return body;
}

// Prevent accidental duplicate submissions while a request is in flight
let inFlight = new Set();

export const api = {
  // GET /api/applications with optional query params
  async getApplications(params = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        qs.append(k, v);
      }
    }
    const url = `/api/applications${qs.toString() ? "?" + qs.toString() : ""}`;
    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
    return parseResponse(res);
  },

  // GET /api/applications/:id
  async getApplication(id) {
    if (!id) throw new ApiError(400, "Application ID is required");
    const res = await fetch(`/api/applications/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    return parseResponse(res);
  },

  // POST /api/applications
  async createApplication(data) {
    const key = "create";
    if (inFlight.has(key)) throw new ApiError(409, "Request already in progress");
    inFlight.add(key);
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(data),
      });
      return parseResponse(res);
    } finally {
      inFlight.delete(key);
    }
  },

  // PUT /api/applications/:id
  async updateApplication(id, data) {
    const key = `update:${id}`;
    if (inFlight.has(key)) throw new ApiError(409, "Request already in progress");
    inFlight.add(key);
    try {
      const res = await fetch(`/api/applications/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(data),
      });
      return parseResponse(res);
    } finally {
      inFlight.delete(key);
    }
  },

  // DELETE /api/applications/:id
  async deleteApplication(id) {
    if (!id) throw new ApiError(400, "Application ID is required");
    const res = await fetch(`/api/applications/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
    return parseResponse(res);
  },

  // DELETE /api/applications — remove every record owned by the signed-in user
  async deleteAllApplicationData() {
    const res = await fetch("/api/applications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    return parseResponse(res);
  },

  /**
   * Fetch every application across pages.
   *
   * The API deliberately caps one page at 100 rows. Aggregate views
   * (dashboard, analytics, pipeline, companies, calendar, exports) must walk
   * the pages instead of requesting a huge limit that the server would clamp,
   * which silently produced partial results.
   */
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
      // Defensive: never loop forever if the server returns an empty page.
      if (!batch.length) break;
      page += 1;
    } while (page <= totalPages);

    return {
      success: true,
      data: rows,
      total: rows.length,
      page: 1,
      limit: rows.length,
      totalPages: 1,
    };
  },

  // GET /api/health
  async health() {
    const res = await fetch("/api/health", { method: "GET", headers: { Accept: "application/json" } });
    return parseResponse(res);
  },

  // ---- Interviews ----

  // GET /api/interviews (optionally filtered by applicationId)
  async getInterviews(params = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        qs.append(k, v);
      }
    }
    const url = `/api/interviews${qs.toString() ? "?" + qs.toString() : ""}`;
    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
    return parseResponse(res);
  },

  // GET /api/interviews/:id
  async getInterview(id) {
    if (!id) throw new ApiError(400, "Interview ID is required");
    const res = await fetch(`/api/interviews/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    return parseResponse(res);
  },

  // POST /api/interviews
  async createInterview(data) {
    const key = "create-interview";
    if (inFlight.has(key)) throw new ApiError(409, "Request already in progress");
    inFlight.add(key);
    try {
      const res = await fetch("/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(data),
      });
      return parseResponse(res);
    } finally {
      inFlight.delete(key);
    }
  },

  // PUT /api/interviews/:id
  async updateInterview(id, data) {
    const key = `update-interview:${id}`;
    if (inFlight.has(key)) throw new ApiError(409, "Request already in progress");
    inFlight.add(key);
    try {
      const res = await fetch(`/api/interviews/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(data),
      });
      return parseResponse(res);
    } finally {
      inFlight.delete(key);
    }
  },

  // PATCH /api/interviews/:id/checklist/:index
  async toggleChecklistItem(id, index, done) {
    const res = await fetch(`/api/interviews/${encodeURIComponent(id)}/checklist/${index}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ done }),
    });
    return parseResponse(res);
  },

  // DELETE /api/interviews/:id
  async deleteInterview(id) {
    if (!id) throw new ApiError(400, "Interview ID is required");
    const res = await fetch(`/api/interviews/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
    return parseResponse(res);
  },

  // GET /api/analytics/summary
  async getAnalyticsSummary() {
    const res = await fetch("/api/analytics/summary", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    return parseResponse(res);
  },

  // ---- Authentication ----

  // POST /api/auth/register
  async register({ name, email, password }) {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    return parseResponse(res);
  },

  // POST /api/auth/login
  async login({ email, password }) {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password }),
    });
    return parseResponse(res);
  },

  // POST /api/auth/logout
  async logout() {
    const res = await fetch("/api/auth/logout", {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    return parseResponse(res);
  },

  // GET /api/auth/me
  async getCurrentUser() {
    const res = await fetch("/api/auth/me", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    return parseResponse(res);
  },

  // DELETE /api/auth/account
  async deleteAccount() {
    const res = await fetch("/api/auth/account", {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
    return parseResponse(res);
  },
};

export { ApiError };
