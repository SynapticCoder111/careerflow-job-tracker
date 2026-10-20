"use strict";

/**
 * Calendar dates vs. instants.
 *
 * Application dates, follow-up dates, deadlines and interview dates are
 * calendar dates: "15 September" is the same day everywhere. They are stored as
 * `Date` values at UTC midnight, but serialising them as full ISO timestamps
 * makes clients render them in local time — which shows 14 September in the
 * Americas. The API therefore returns these fields as `YYYY-MM-DD`.
 *
 * Timestamps that represent a real instant (createdAt, updatedAt, session
 * expiry) are unaffected.
 */

const DATE_ONLY_FIELDS = ["applicationDate", "followUpDate", "interviewDate", "deadline"];

function pad(value) {
  return String(value).padStart(2, "0");
}

/** Format a Date or ISO string as `YYYY-MM-DD` using its UTC parts. */
function toDateOnly(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Return a copy of a plain document with date-only fields as `YYYY-MM-DD`. */
function serializeDateOnly(doc) {
  if (!doc) return doc;
  const ret = { ...doc };
  for (const field of DATE_ONLY_FIELDS) {
    if (ret[field]) ret[field] = toDateOnly(ret[field]);
  }
  return ret;
}

/** Midnight UTC for "today", matching how date-only values are stored. */
function startOfTodayUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

module.exports = { DATE_ONLY_FIELDS, toDateOnly, serializeDateOnly, startOfTodayUTC };
