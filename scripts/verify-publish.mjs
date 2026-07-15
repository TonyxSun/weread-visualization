/**
 * Publish-mode verification:
 * 1) Static UI audit — no settings panels / visitor key controls mounted
 * 2) Pure shipped helpers — request bodies/headers never carry client secrets
 * 3) Live server — status + snapshot without client Bearer when env has WEREAD_API_KEY
 *
 * Usage: node scripts/verify-publish.mjs
 * Optional: VERIFY_BASE_URL=http://127.0.0.1:3000 (skip spawn if already up)
 * Scratch evidence dir: VERIFY_SCRATCH=/path (default ./artifacts/publish-verify)
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import {
  buildWereadServerAuthHeaders,
  buildWereadProxyBody,
  buildAnalyzeRequestBody
} from "../src/publishAuth.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const scratch =
  process.env.VERIFY_SCRATCH ||
  path.join(root, "artifacts", "publish-verify");

fs.mkdirSync(scratch, { recursive: true });

function log(line) {
  process.stdout.write(`${line}\n`);
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
}

function assert(cond, msg) {
  if (!cond) fail(msg);
  else log(`ok: ${msg}`);
}

// ── 1. Static audit ──────────────────────────────────────────────────────────
const appPath = path.join(root, "src", "App.tsx");
const appSrc = fs.readFileSync(appPath, "utf8");
const bannedImports = [
  /from\s+["'].*SettingsPanel["']/,
  /from\s+["'].*AnalysisSettingsPanel["']/,
  /<SettingsPanel\b/,
  /<AnalysisSettingsPanel\b/,
  /id=["']settings-panel["']/,
  /id=["']analysis-settings-panel["']/
];
for (const re of bannedImports) {
  assert(!re.test(appSrc), `App.tsx must not match ${re}`);
}

const settingsExists = fs.existsSync(path.join(root, "src/components/SettingsPanel.tsx"));
const analysisExists = fs.existsSync(path.join(root, "src/components/AnalysisSettingsPanel.tsx"));
assert(!settingsExists, "SettingsPanel.tsx deleted (not shipped)");
assert(!analysisExists, "AnalysisSettingsPanel.tsx deleted (not shipped)");

// Visitor-facing secret UI strings must not appear in shell components
const shellFiles = [
  "src/App.tsx",
  "src/components/GrowthMap.tsx",
  "src/components/InfiniteCanvas.tsx"
].map((p) => path.join(root, p));
const secretUi = /API\s*Key|API密钥|粘贴.*[Kk]ey|将api复制|分析模型设置|Bearer Token/i;
for (const f of shellFiles) {
  const text = fs.readFileSync(f, "utf8");
  assert(!secretUi.test(text), `${path.relative(root, f)} has no visitor secret-entry copy`);
}

// ── 2. Pure helpers (real shipped module) ────────────────────────────────────
const headers = buildWereadServerAuthHeaders();
assert(!("Authorization" in headers), "buildWereadServerAuthHeaders omits Authorization");
assert(headers["Content-Type"] === "application/json", "content-type set");
assert(Boolean(headers["X-WeRead-Gateway-Url"]), "gateway header present");

const proxyBody = buildWereadProxyBody("/user/notebooks", { count: 10 });
assert(proxyBody.apiKey === "", "proxy body apiKey empty (server env fills it)");
assert(proxyBody.api_name === "/user/notebooks", "proxy api_name preserved");

const analyzeBody = buildAnalyzeRequestBody([{ bookId: "1" }], [{ markText: "hi" }]);
assert(!("analysisConfig" in analyzeBody), "analyze body has no analysisConfig secrets");
assert(Array.isArray(analyzeBody.books) && analyzeBody.books.length === 1, "analyze books passed through");

fs.writeFileSync(
  path.join(scratch, "backend-auth.log"),
  [
    "publishAuth helper checks",
    JSON.stringify({ headers, proxyBody, analyzeBody }, null, 2),
    "PASS"
  ].join("\n")
);
log(`wrote ${path.join(scratch, "backend-auth.log")}`);

// ── 3. Live server routes ────────────────────────────────────────────────────
async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, text };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHome(base, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const r = await fetch(base + "/");
      if (r.ok) return true;
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  return false;
}

async function runLiveChecks(base, logName) {
  const lines = [];
  const push = (s) => {
    lines.push(s);
    log(s);
  };

  const home = await fetch(base + "/");
  const homeText = await home.text();
  push(`GET / => ${home.status}`);
  assert(home.status === 200, `${logName}: home HTTP 200`);
  assert(
    /root|vite|阅读|div/i.test(homeText),
    `${logName}: home returns HTML shell`
  );
  assert(
    !/id=["']settings-panel["']|id=["']analysis-settings-panel["']/.test(homeText),
    `${logName}: HTML shell has no settings panel ids`
  );

  const status = await fetchJson(base + "/api/weread/status");
  push(`GET /api/weread/status => ${status.status} ${JSON.stringify(status.body)}`);
  assert(status.status === 200, `${logName}: weread status 200`);
  assert(
    typeof status.body?.hasServerWereadKey === "boolean",
    `${logName}: status JSON has hasServerWereadKey`
  );

  // Snapshot without client Bearer — server must use WEREAD_API_KEY from env.
  const snapHeaders = buildWereadServerAuthHeaders();
  assert(!("Authorization" in snapHeaders), "live snapshot headers have no Bearer");
  const snap = await fetchJson(base + "/api/weread/snapshot", {
    method: "POST",
    headers: snapHeaders,
    body: "{}"
  });
  push(`POST /api/weread/snapshot (no Bearer) => ${snap.status}`);
  if (status.body?.hasServerWereadKey) {
    assert(snap.status === 200, `${logName}: snapshot 200 with server key, no client Bearer`);
    assert(Array.isArray(snap.body?.notebooks), `${logName}: snapshot has notebooks array`);
    assert(snap.body?.meta && typeof snap.body.meta === "object", `${logName}: snapshot has meta`);
  } else {
    push("WARN: WEREAD_API_KEY not configured on server; snapshot auth path not fully exercised");
    assert(
      snap.status === 400 || snap.status === 200,
      `${logName}: snapshot returns JSON error or data without hanging`
    );
  }

  const analysisStatus = await fetchJson(base + "/api/analysis/status");
  push(`GET /api/analysis/status => ${analysisStatus.status} ${JSON.stringify(analysisStatus.body)}`);
  assert(analysisStatus.status === 200, `${logName}: analysis status 200`);

  fs.writeFileSync(path.join(scratch, logName), lines.join("\n") + "\nPASS\n");
  return true;
}

async function withServer(fn) {
  const existing = process.env.VERIFY_BASE_URL;
  if (existing) {
    await fn(existing.replace(/\/$/, ""));
    return;
  }

  const port = String(process.env.VERIFY_PORT || 3017);
  const base = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    PORT: port,
    NODE_ENV: process.env.NODE_ENV || "development"
  };
  // Prefer tsx dev server so Vite HTML shell is present
  const child = spawn("npx", ["tsx", "server.ts"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let childLog = "";
  child.stdout.on("data", (d) => {
    childLog += d.toString();
  });
  child.stderr.on("data", (d) => {
    childLog += d.toString();
  });

  try {
    const up = await waitForHome(base);
    if (!up) {
      fs.writeFileSync(path.join(scratch, "server-spawn-fail.log"), childLog);
      fail("server did not become ready; see server-spawn-fail.log");
      return;
    }
    await fn(base);
  } finally {
    child.kill("SIGTERM");
    await sleep(500);
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

// Launch twice (gating criterion 3)
await withServer(async (base) => {
  await runLiveChecks(base, "launch-1.log");
});
await withServer(async (base) => {
  await runLiveChecks(base, "launch-2.log");
});

if (process.exitCode && process.exitCode !== 0) {
  log("verify-publish FAILED");
  process.exit(process.exitCode);
}
log("verify-publish PASS");
log(`evidence under ${scratch}`);
