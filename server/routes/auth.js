const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Session = require("../models/Session");
const Application = require("../models/Application");
const Interview = require("../models/Interview");
const { hashPassword, verifyPassword, validatePassword } = require("../utils/password");
const { requireAuth, createSession, destroySession } = require("../middleware/auth");
const { loginLimiter, loginIpLimiter, registerLimiter } = require("../middleware/rateLimit");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Legacy adoption is a one-time operational migration, not normal behaviour.
// It is off unless an operator explicitly opts in.
const ALLOW_LEGACY_ADOPTION = process.env.ALLOW_LEGACY_ADOPTION === "true";

/* -------------------------------------------------------------------------
   POST /api/auth/register — create an account
   ------------------------------------------------------------------------- */
router.post("/register", registerLimiter, async function (req, res) {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";

  const errors = {};

  if (!name) errors.name = "Name is required.";
  else if (name.length > 80) errors.name = "Name must be under 80 characters.";

  if (!email) errors.email = "Email is required.";
  else if (!EMAIL_RE.test(email)) errors.email = "Enter a valid email address.";

  const pwProblems = validatePassword(password);
  if (pwProblems.length) errors.password = pwProblems[0];

  if (Object.keys(errors).length) {
    return res.status(400).json({
      success: false,
      message: "Please check the highlighted fields.",
      errors,
    });
  }

  try {
    const existing = await User.findOne({ email }).lean();
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "An account with that email already exists.",
        errors: { email: "This email is already registered." },
      });
    }

    const user = await User.create({
      name,
      email,
      passwordHash: hashPassword(password),
    });

    // One-time migration for records created before accounts existed. These
    // rows have no owner; the first account to register could adopt them so no
    // data was lost. On a shared database that would hand one person another
    // person's data, so it now runs only when an operator sets
    // ALLOW_LEGACY_ADOPTION=true, and should be removed after it has run once.
    if (ALLOW_LEGACY_ADOPTION) {
      const legacy = await Application.countDocuments({ userId: { $exists: false } });
      if (legacy > 0) {
        await Application.updateMany(
          { userId: { $exists: false } },
          { $set: { userId: user._id } }
        );
        await Interview.updateMany(
          { userId: { $exists: false } },
          { $set: { userId: user._id } }
        );
        console.warn(
          `ALLOW_LEGACY_ADOPTION: assigned ${legacy} ownerless application(s) to ${user.email}.`
        );
      }
    }

    await createSession(req, res, user._id);

    res.status(201).json({
      success: true,
      message: "Account created successfully.",
      data: { id: user._id.toString(), name: user.name, email: user.email },
    });
  } catch (err) {
    // Duplicate key race (two registrations with the same email at once)
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with that email already exists.",
        errors: { email: "This email is already registered." },
      });
    }
    console.error("POST /api/auth/register error:", err.message);
    res.status(500).json({ success: false, message: "Could not create the account. Please try again." });
  }
});

/* -------------------------------------------------------------------------
   POST /api/auth/login
   ------------------------------------------------------------------------- */
router.post("/login", loginLimiter, loginIpLimiter, async function (req, res) {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required.",
      errors: { email: !email ? "Email is required." : undefined, password: !password ? "Password is required." : undefined },
    });
  }

  try {
    const user = await User.findOne({ email }).select("+passwordHash");

    // Always run a verification so the response time does not reveal
    // whether the email exists.
    const hash = user ? user.passwordHash : "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA";
    const ok = verifyPassword(password, hash);

    if (!user || !ok) {
      return res.status(401).json({
        success: false,
        message: "Incorrect email or password.",
        errors: { password: "Incorrect email or password." },
      });
    }

    // A correct password clears this account's failed-attempt budget. The
    // network-level counter is intentionally left alone.
    if (req.rateLimits && req.rateLimits.login) req.rateLimits.login.reset();

    await createSession(req, res, user._id);

    res.json({
      success: true,
      message: "Signed in successfully.",
      data: { id: user._id.toString(), name: user.name, email: user.email },
    });
  } catch (err) {
    console.error("POST /api/auth/login error:", err.message);
    res.status(500).json({ success: false, message: "Could not sign you in. Please try again." });
  }
});

/* -------------------------------------------------------------------------
   POST /api/auth/logout
   ------------------------------------------------------------------------- */
router.post("/logout", async function (req, res) {
  try {
    await destroySession(req, res);
    res.json({ success: true, message: "Signed out successfully." });
  } catch (err) {
    console.error("POST /api/auth/logout error:", err.message);
    res.status(500).json({ success: false, message: "Could not sign out." });
  }
});

/* -------------------------------------------------------------------------
   GET /api/auth/me — current session
   ------------------------------------------------------------------------- */
router.get("/me", async function (req, res) {
  if (!req.user) {
    return res.status(200).json({ success: true, data: null, authenticated: false });
  }
  res.json({
    success: true,
    authenticated: true,
    data: { id: req.user._id.toString(), name: req.user.name, email: req.user.email },
  });
});

/* -------------------------------------------------------------------------
   DELETE /api/auth/account — delete the account and its data
   ------------------------------------------------------------------------- */
router.delete("/account", requireAuth, async function (req, res) {
  try {
    const userId = req.user._id;
    await Promise.all([
      Application.deleteMany({ userId }),
      Interview.deleteMany({ userId }),
      Session.deleteMany({ userId }),
    ]);
    await User.deleteOne({ _id: userId });
    await destroySession(req, res);
    res.json({ success: true, message: "Your account and data were deleted." });
  } catch (err) {
    console.error("DELETE /api/auth/account error:", err.message);
    res.status(500).json({ success: false, message: "Could not delete the account." });
  }
});

module.exports = router;
