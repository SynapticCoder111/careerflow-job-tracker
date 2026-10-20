const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();
const mongoose = require("mongoose");

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("FATAL: MONGODB_URI is not defined in .env");
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "..");
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// --- Middleware ---
const { loadUser } = require("./middleware/auth");
const authRouter = require("./routes/auth");
const applicationsRouter = require("./routes/applications");
const interviewsRouter = require("./routes/interviews");
const analyticsRouter = require("./routes/analytics");

const app = express();
app.disable("x-powered-by");

// Only trust X-Forwarded-For when an operator says a reverse proxy is in
// front of the app. Trusting it blindly would let a client spoof its address
// and bypass the rate limiter.
if (process.env.TRUST_PROXY === "true") {
  app.set("trust proxy", 1);
}

/* ---------------------------------------------------------------------------
   CORS

   Same-origin requests (the normal case) never need CORS. Cross-origin access
   is granted only from explicitly configured origins:

   - ALLOWED_ORIGIN="https://a.example,https://b.example" → those origins.
   - Production with no ALLOWED_ORIGIN → no CORS headers at all (fail closed).
     The frontend is served by this same process, so the app still works; a
     forgotten environment variable can no longer open the API to every site.
   - Development with no ALLOWED_ORIGIN → the local origins for this port.
   --------------------------------------------------------------------------- */
const CORS_ORIGINS = (process.env.ALLOWED_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (CORS_ORIGINS.length) {
  app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
} else if (IS_PRODUCTION) {
  console.warn(
    "ALLOWED_ORIGIN is not set: cross-origin API access is disabled. " +
      "Set ALLOWED_ORIGIN only if the frontend is served from another origin."
  );
} else {
  app.use(
    cors({
      origin: [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`],
      credentials: true,
    })
  );
}

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// Express 5 leaves `req.body` undefined when a request carries no body.
// Normalise it so every handler validates missing fields instead of throwing.
app.use(function (req, res, next) {
  if (!req.body || typeof req.body !== "object") req.body = {};
  next();
});

// Security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
});

/* ---------------------------------------------------------------------------
   Public static assets.

   Only the two browser asset directories are mounted. The project root is
   never served, so backend source (server/**), tests, seed scripts, the
   README and node_modules cannot be downloaded. HTML is served exclusively
   through the explicit page routes below, which is what makes the login
   redirect on private pages effective.
   --------------------------------------------------------------------------- */
const PUBLIC_ASSET_DIRS = {
  "/css": path.join(ROOT, "css"),
  "/js": path.join(ROOT, "js"),
};

for (const [urlPath, dir] of Object.entries(PUBLIC_ASSET_DIRS)) {
  app.use(
    urlPath,
    express.static(dir, {
      index: false,
      extensions: false,
      // Never serve dotfiles such as a stray .env inside an asset folder.
      dotfiles: "deny",
      setHeaders(res) {
        // Assets are versioned by content during development; avoid stale
        // copies without disabling caching entirely.
        res.setHeader("Cache-Control", "no-cache");
      },
    })
  );
}

// Resolve the current user from the session cookie (never rejects).
// Mounted after the static assets so stylesheet and script requests do not
// perform a session lookup on every file.
app.use(loadUser);

/* ---------------------------------------------------------------------------
   API
   --------------------------------------------------------------------------- */
app.get("/api/health", function (req, res) {
  res.json({
    status: "ok",
    message: "Backend is working correctly",
    authenticated: !!req.user,
  });
});

app.use("/api/auth", authRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/interviews", interviewsRouter);
app.use("/api/analytics", analyticsRouter);

// Unknown API routes
app.use("/api", function (req, res) {
  res.status(404).json({ success: false, message: "Route not found" });
});

/* ---------------------------------------------------------------------------
   Page routes
   --------------------------------------------------------------------------- */
function sendPage(res, name) {
  res.sendFile(path.join(ROOT, name));
}

// Public pages
app.get("/", function (req, res) {
  sendPage(res, "landing.html");
});
app.get("/login", function (req, res) {
  sendPage(res, "login.html");
});
app.get("/register", function (req, res) {
  sendPage(res, "register.html");
});

// Private pages — redirect to the login screen when signed out.
const PRIVATE_PAGES = [
  ["/dashboard", "dashboard.html"],
  ["/applications", "applications.html"],
  ["/pipeline", "pipeline.html"],
  ["/calendar", "calendar.html"],
  ["/companies", "companies.html"],
  ["/interview-prep", "interview-prep.html"],
  ["/analytics", "analytics.html"],
  ["/settings", "settings.html"],
];

PRIVATE_PAGES.forEach(([route, file]) => {
  app.get(route, function (req, res) {
    if (!req.user) {
      const next = encodeURIComponent(req.originalUrl || route);
      return res.redirect(302, `/login?next=${next}`);
    }
    sendPage(res, file);
  });
});

// 404 for anything else
app.use(function (req, res) {
  res.status(404).sendFile(path.join(ROOT, "404.html"));
});

// Centralized error handler — never leaks stack traces
app.use(function (err, req, res, next) {
  console.error("Unhandled error:", err.message);
  if (res.headersSent) return;
  res.status(500).json({ success: false, message: "Internal server error" });
});

/* ---------------------------------------------------------------------------
   Startup and shutdown

   The HTTP listener starts only after MongoDB is reachable. Accepting requests
   before the connection exists makes them buffer and then fail with 500s
   during startup, which is indistinguishable from an outage.
   --------------------------------------------------------------------------- */
let httpServer = null;
let shuttingDown = false;

async function start() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: Number(process.env.MONGO_TIMEOUT_MS) || 10000,
    });
    console.log("MongoDB connected successfully!");
  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
    console.error("The server did not start. Fix the database connection and try again.");
    process.exit(1);
  }

  httpServer = app.listen(PORT, function () {
    console.log(`CareerFlow running at http://localhost:${PORT}`);
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received — shutting down.`);

  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  try {
    await mongoose.disconnect();
  } catch (err) {
    // The connection may already be gone; nothing useful to do at this point.
  }
  process.exit(0);
}

["SIGINT", "SIGTERM"].forEach((signal) => {
  process.on(signal, function () {
    shutdown(signal);
  });
});

start();
