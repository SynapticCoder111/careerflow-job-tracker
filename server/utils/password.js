const crypto = require("crypto");

/**
 * Password hashing built on Node's native scrypt.
 *
 * scrypt is a memory-hard KDF recommended by OWASP. Using the built-in
 * implementation avoids a native compilation dependency while still
 * providing salted, slow, timing-safe verification.
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet configuration
 * N=2^16, r=8, p=2 (64 MiB, two iterations). They are stored with each hash,
 * so raising them later does not invalidate existing passwords: the old
 * parameters are read back and the hash is upgraded on the next sign-in.
 *
 * Stored format:  scrypt$N$r$p$<saltBase64>$<hashBase64>
 */

const PARAMS = { N: 65536, r: 8, p: 2 };
const KEY_LENGTH = 64;
const MAX_MEM = 128 * 1024 * 1024; // scrypt needs ~128 * N * r = 64 MiB here
const SALT_LENGTH = 16;

function parseStored(stored) {
  if (typeof stored !== "string") return null;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (N <= 1 || r <= 0 || p <= 0) return null;
  const salt = Buffer.from(parts[4], "base64");
  const hash = Buffer.from(parts[5], "base64");
  if (!salt.length || !hash.length) return null;
  return { N, r, p, salt, hash };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: MAX_MEM });
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

function verifyPassword(password, stored) {
  if (!password) return false;
  const parsed = parseStored(stored);
  if (!parsed) return false;
  try {
    const derived = crypto.scryptSync(password, parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: MAX_MEM,
    });
    return crypto.timingSafeEqual(derived, parsed.hash);
  } catch (err) {
    return false;
  }
}

/**
 * True when a stored hash was produced with weaker parameters or a different
 * key length than the current policy. Callers re-hash after a successful
 * verification, so users are upgraded transparently on their next sign-in.
 */
function needsRehash(stored) {
  const parsed = parseStored(stored);
  if (!parsed) return false;
  return (
    parsed.N !== PARAMS.N ||
    parsed.r !== PARAMS.r ||
    parsed.p !== PARAMS.p ||
    parsed.hash.length !== KEY_LENGTH
  );
}

/**
 * Validate a candidate password against the rules enforced at registration.
 * Returns an array of human-readable problems (empty = valid).
 */
function validatePassword(password) {
  const problems = [];
  if (typeof password !== "string" || !password) {
    return ["Password is required."];
  }
  if (password.length < 8) problems.push("Use at least 8 characters.");
  if (password.length > 200) problems.push("Password must be under 200 characters.");
  if (!/[a-zA-Z]/.test(password)) problems.push("Include at least one letter.");
  if (!/[0-9]/.test(password)) problems.push("Include at least one number.");
  return problems;
}

module.exports = {
  PARAMS,
  KEY_LENGTH,
  hashPassword,
  verifyPassword,
  needsRehash,
  validatePassword,
};
