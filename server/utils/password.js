const crypto = require("crypto");

/**
 * Password hashing built on Node's native scrypt.
 *
 * scrypt is a memory-hard KDF recommended by OWASP. Using the built-in
 * implementation avoids a native compilation dependency while still
 * providing salted, slow, timing-safe verification.
 *
 * Stored format:  scrypt$N$r$p$<saltBase64>$<hashBase64>
 */

const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const MAX_MEM = 96 * 1024 * 1024; // scrypt needs ~128 * N * r bytes
const SALT_LENGTH = 16;

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
  if (!password || !stored) return false;
  try {
    const parts = String(stored).split("$");
    if (parts.length !== 6) return false;
    const [scheme, n, r, p, saltB64, hashB64] = parts;
    if (scheme !== "scrypt") return false;

    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    if (!salt.length || !expected.length) return false;

    const derived = crypto.scryptSync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAX_MEM,
    });

    return crypto.timingSafeEqual(derived, expected);
  } catch (err) {
    return false;
  }
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

module.exports = { hashPassword, verifyPassword, validatePassword };
