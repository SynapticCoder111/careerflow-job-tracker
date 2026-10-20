const crypto = require("crypto");
const User = require("../models/User");
const Session = require("../models/Session");

const COOKIE_NAME = "careerflow_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const IS_PRODUCTION = process.env.NODE_ENV === "production";

/* -------------------------------------------------------------------------
   Cookie helpers (no cookie-parser dependency needed for a single cookie)
   ------------------------------------------------------------------------- */
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  String(header)
    .split(";")
    .forEach((part) => {
      const idx = part.indexOf("=");
      if (idx === -1) return;
      const key = part.slice(0, idx).trim();
      const val = part.slice(idx + 1).trim();
      if (key) out[key] = decodeURIComponent(val);
    });
  return out;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(res, token) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (IS_PRODUCTION) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  const parts = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (IS_PRODUCTION) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

/* -------------------------------------------------------------------------
   Middleware
   ------------------------------------------------------------------------- */

/**
 * Populates req.user when a valid session cookie is present.
 * Never rejects — it simply leaves req.user null.
 */
async function loadUser(req, res, next) {
  req.user = null;
  try {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[COOKIE_NAME];
    if (!token) return next();

    const session = await Session.findOne({
      tokenHash: hashToken(token),
      expiresAt: { $gt: new Date() },
    }).lean();

    if (!session) return next();

    const user = await User.findById(session.userId).lean();
    if (!user) return next();

    req.user = user;
    req.sessionId = session._id;
    next();
  } catch (err) {
    console.error("loadUser error:", err.message);
    next();
  }
}

/** Rejects the request with 401 when there is no authenticated user. */
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "You must be signed in to do that.",
      code: "UNAUTHENTICATED",
    });
  }
  next();
}

/** Creates a session for a user and sets the cookie. */
async function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await Session.create({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    userAgent: (req.headers["user-agent"] || "").slice(0, 300),
    ip: (req.ip || "").slice(0, 60),
  });
  setSessionCookie(res, token);
}

/** Destroys the current session (and always clears the cookie). */
async function destroySession(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (token) {
    try {
      await Session.deleteOne({ tokenHash: hashToken(token) });
    } catch (err) {
      console.error("destroySession error:", err.message);
    }
  }
  clearSessionCookie(res);
}

module.exports = {
  COOKIE_NAME,
  loadUser,
  requireAuth,
  createSession,
  destroySession,
  parseCookies,
  hashToken,
};
