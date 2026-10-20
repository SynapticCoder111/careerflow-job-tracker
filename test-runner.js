#!/usr/bin/env node
/**
 * CareerFlow — test runner.
 *
 * `npm test` (from server/) runs this file. It starts a dedicated server
 * instance, waits for /api/health, runs both live-API suites against it, then
 * shuts it down. That keeps the suites deterministic: rate-limit windows and
 * sessions start empty on every run instead of inheriting state from a server
 * someone left running.
 *
 * Options:
 *   BASE_URL=http://host:port   Test an already-running server instead of
 *                               starting one (no process is spawned).
 *   TEST_PORT=3100              Port for the temporary server.
 *   TEST_VERBOSE=1              Print the temporary server's output.
 */

const { spawn } = require("node:child_process");
const path = require("node:path");

const ROOT = __dirname;
const SERVER_DIR = path.join(ROOT, "server");
const PORT = process.env.TEST_PORT || "3100";
const EXTERNAL_BASE = process.env.BASE_URL || "";
const BASE = EXTERNAL_BASE || `http://localhost:${PORT}`;
const VERBOSE = process.env.TEST_VERBOSE === "1";
const SUITES = ["test-suite.js", "test-auth.js"];
const STATIC_SUITE = "test-static.js";

let server = null;
let serverOutput = "";
let stopping = false;
let serverExited = false;

function log(message) {
  process.stdout.write(`${message}\n`);
}

async function health(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

function startServer() {
  server = spawn(process.execPath, ["server.js"], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT, NODE_ENV: process.env.NODE_ENV || "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const capture = (chunk) => {
    const text = chunk.toString();
    serverOutput += text;
    if (VERBOSE) process.stdout.write(text.replace(/^/gm, "[server] "));
  };
  server.stdout.on("data", capture);
  server.stderr.on("data", capture);

  server.on("exit", (code, signal) => {
    serverExited = true;
    if (stopping) return;
    if (code !== 0 && code !== null) {
      log(`\nThe temporary server exited early with code ${code}${signal ? ` (${signal})` : ""}.`);
      if (!VERBOSE && serverOutput.trim()) {
        log("--- server output ---");
        log(serverOutput.trim().slice(-4000));
        log("---------------------");
      }
    }
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (!server || serverExited) return resolve();
    stopping = true;
    const timer = setTimeout(() => {
      try { server.kill("SIGKILL"); } catch { /* already gone */ }
      resolve();
    }, 8000);
    server.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    try { server.kill("SIGTERM"); } catch { /* already gone */ }
  });
}

function runSuite(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, file)], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, BASE_URL: BASE },
    });
    child.on("exit", (code, signal) => {
      resolve(signal ? 1 : code ?? 1);
    });
  });
}

(async () => {
  const startedAt = Date.now();
  const results = [];

  // Static checks need neither a server nor a database, so they run first and
  // still report even if the live suites cannot start.
  log(`\n──────── ${STATIC_SUITE} ────────`);
  results.push({ suite: STATIC_SUITE, code: await runSuite(STATIC_SUITE) });

  if (EXTERNAL_BASE) {
    log(`\nUsing the running server at ${BASE}`);
  } else {
    log(`\nStarting a temporary server on ${BASE}`);
    startServer();
  }

  if (!(await health(30000))) {
    log(`\nFAILED: ${BASE}/api/health did not respond within 30s.`);
    if (!EXTERNAL_BASE) {
      log("The server did not start. Check that MongoDB is reachable (server/.env).");
      if (serverOutput.trim()) {
        log("--- server output ---");
        log(serverOutput.trim().slice(-4000));
        log("---------------------");
      }
    }
    await stopServer();
    log("\n════════ SUMMARY ════════");
    results.forEach((r) => log(`${r.code === 0 ? "PASS" : "FAIL"}  ${r.suite}`));
    process.exit(1);
  }

  for (const suite of SUITES) {
    log(`\n──────── ${suite} ────────`);
    const code = await runSuite(suite);
    results.push({ suite, code });
  }

  await stopServer();

  const failed = results.filter((r) => r.code !== 0);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  log("\n════════ SUMMARY ════════");
  results.forEach((r) => log(`${r.code === 0 ? "PASS" : "FAIL"}  ${r.suite}`));
  log(`Finished in ${seconds}s against ${BASE}`);

  if (failed.length) {
    log(`\n${failed.length} suite(s) failed.`);
    process.exit(1);
  }
  log("\nAll suites passed.");
  process.exit(0);
})().catch(async (err) => {
  console.error(err);
  await stopServer();
  process.exit(1);
});
