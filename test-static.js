/**
 * CareerFlow — static checks.
 *
 * The live suites exercise the API, but they cannot see the browser bundle.
 * This file catches the failures that otherwise only appear in the console:
 *
 *   1. Syntax errors in every js/*.js module and every inline module script.
 *   2. Named imports that do not exist in the target module.
 *   3. <script src> / stylesheet href values that point at missing files.
 *
 * It needs no server and no database, so it runs first in test-runner.js.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = __dirname;
const JS_DIR = path.join(ROOT, "js");
let pass = 0;
let fail = 0;

function check(name, condition, extra) {
  if (condition) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name + (extra !== undefined ? " -> " + JSON.stringify(extra) : ""));
  }
}

const list = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : list(full);
    return entry.name.endsWith(".js") ? [full] : [];
});

const moduleFiles = list(JS_DIR);
const htmlFiles = fs
  .readdirSync(ROOT)
  .filter((name) => name.endsWith(".html"))
  .map((name) => path.join(ROOT, name));

/** Collect exported names from a module's source. */
function exportsOf(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/export\s+class\s+([A-Za-z0-9_$]+)/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    match[1]
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean)
      .forEach((name) => names.add(name));
  }
  return names;
}

const exportCache = new Map();
function exportsFor(file) {
  if (!exportCache.has(file)) {
    exportCache.set(file, fs.existsSync(file) ? exportsOf(fs.readFileSync(file, "utf8")) : new Set());
  }
  return exportCache.get(file);
}

function checkImports(label, source, fromDir) {
  const pattern = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const spec = match[2];
    if (!spec.startsWith(".")) continue;
    const target = path.resolve(fromDir, spec);
    if (!fs.existsSync(target)) {
      check(`${label}: import target ${spec} exists`, false);
      continue;
    }
    const available = exportsFor(target);
    const missing = match[1]
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean)
      .filter((name) => !available.has(name));
    check(`${label}: imports from ${path.basename(target)} resolve`, missing.length === 0, missing);
  }
}

function checkAssets(label, source, fromDir) {
  const pattern = /(?:src|href)="([^"]+)"/g;
  for (const match of source.matchAll(pattern)) {
    const ref = match[1];
    if (!/\.(js|css)$/.test(ref) || /^https?:/.test(ref)) continue;
    const target = path.resolve(fromDir, ref.replace(/^\//, ""));
    check(`${label}: ${ref} exists`, fs.existsSync(target));
  }
}

console.log("\n=== 1. MODULE SYNTAX ===");
for (const file of moduleFiles) {
  const label = path.relative(ROOT, file);
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    check(`${label} parses`, true);
  } catch (err) {
    check(`${label} parses`, false, String(err.stderr || err.message).split("\n")[0]);
  }
}

console.log("\n=== 2. INLINE SCRIPT SYNTAX ===");
const inlineScripts = [];
for (const file of htmlFiles) {
  const source = fs.readFileSync(file, "utf8");
  const label = path.basename(file);
  const blocks = [...source.matchAll(/<script\s+type="module"\s*>([\s\S]*?)<\/script>/g)];
  blocks.forEach((block, index) => {
    const name = `${label}#inline${index + 1}`;
    inlineScripts.push({ name, code: block[1], dir: ROOT });
    const temp = path.join(require("node:os").tmpdir(), `careerflow-inline-${process.pid}-${inlineScripts.length}.mjs`);
    fs.writeFileSync(temp, block[1]);
    try {
      execFileSync(process.execPath, ["--check", temp], { stdio: "pipe" });
      check(`${name} parses`, true);
    } catch (err) {
      check(`${name} parses`, false, String(err.stderr || err.message).split("\n")[0]);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  });
}

console.log("\n=== 3. IMPORTS RESOLVE ===");
for (const file of moduleFiles) {
  checkImports(path.relative(ROOT, file), fs.readFileSync(file, "utf8"), path.dirname(file));
}
for (const script of inlineScripts) {
  checkImports(script.name, script.code, script.dir);
}

console.log("\n=== 4. ASSET REFERENCES ===");
for (const file of htmlFiles) {
  checkAssets(path.basename(file), fs.readFileSync(file, "utf8"), ROOT);
}

console.log("\n========================================");
console.log(`  PASSED: ${pass}   FAILED: ${fail}`);
console.log("========================================");
process.exit(fail ? 1 : 0);
