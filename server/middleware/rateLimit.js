"use strict";

/**
 * Minimal fixed-window rate limiter — no external dependency.
 *
 * Deliberate limitations (documented rather than hidden):
 * - Counters live in this Node process, so they are per instance and are
 *   cleared by a restart. A multi-instance deployment needs a shared store.
 * - Keys are derived from `req.ip`. Behind a reverse proxy, set
 *   `TRUST_PROXY=true` so Express reports the client address, not the proxy.
 *
 * The limit is inclusive: with `max: 5`, requests 1–5 pass and request 6 is
 * rejected with `429` and a `Retry-After` header.
 */

// Prune expired entries when the map grows past this size. Keeps memory
// bounded under spraying without a timer that would hold the process open.
const SWEEP_THRESHOLD = 5000;

function ipKey(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * @param {object} options
 * @param {string} options.name      Identifier used to expose a reset handle.
 * @param {number} options.windowMs  Window length in milliseconds.
 * @param {number} options.max       Attempts allowed per window.
 * @param {(req: import("express").Request) => string} options.keyGenerator
 * @param {string} options.message   Message returned with a 429.
 * @param {string} [options.code]    Machine-readable error code.
 */
function createRateLimiter({ name, windowMs, max, keyGenerator, message, code = "RATE_LIMITED" }) {
  const hits = new Map();

  function sweep(now) {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }

  return function rateLimit(req, res, next) {
    const now = Date.now();
    if (hits.size >= SWEEP_THRESHOLD) sweep(now);

    const key = keyGenerator(req);
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));

    // Let the route clear this key after a success (e.g. a valid password),
    // so legitimate users are never locked out by their own successful logins.
    // Each limiter stores its handle under its own name so a reset only
    // affects that policy (the per-email budget, not the per-network one).
    req.rateLimits = req.rateLimits || {};
    req.rateLimits[name] = {
      key,
      reset() {
        hits.delete(key);
      },
    };

    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        success: false,
        message,
        code,
        retryAfter,
      });
    }

    next();
  };
}

/* -------------------------------------------------------------------------
   Auth policies
   ------------------------------------------------------------------------- */

// Failed sign-in attempts for one address+email pair. A successful sign-in
// resets the counter (see routes/auth.js).
const loginLimiter = createRateLimiter({
  name: "login",
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `${ipKey(req)}|${normalizeEmail(req.body && req.body.email)}`,
  message: "Too many failed sign-in attempts for this account. Try again in a few minutes.",
});

// Coarse network-level cap so an attacker cannot spray one password across
// many email addresses. Higher than the per-account cap on purpose.
const loginIpLimiter = createRateLimiter({
  name: "loginIp",
  windowMs: 15 * 60 * 1000,
  max: 100,
  keyGenerator: ipKey,
  message: "Too many sign-in attempts from this network. Try again later.",
});

// Account-creation cap. 60/hour per address is generous for a demo
// deployment while still preventing scripted mass registration.
const registerLimiter = createRateLimiter({
  name: "register",
  windowMs: 60 * 60 * 1000,
  max: 60,
  keyGenerator: ipKey,
  message: "Too many accounts created from this network. Try again later.",
});

module.exports = {
  createRateLimiter,
  loginLimiter,
  loginIpLimiter,
  registerLimiter,
};
