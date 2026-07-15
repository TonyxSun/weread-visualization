/**
 * Live DOM check: open the app, sample card styles, assert quote nodes
 * are not CSS-clipped (scrollHeight <= clientHeight).
 *
 * Requires: playwright devDependency + chromium
 *   npx playwright install chromium
 * Usage:
 *   VERIFY_BASE_URL=http://127.0.0.1:3000 npm run verify:card-dom
 *   # or let the script spawn a server on VERIFY_PORT (default 3021)
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("playwright not installed; run: npm i -D playwright && npx playwright install chromium");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHome(base, attempts = 50) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(base + "/");
      if (r.ok) return true;
    } catch {
      /* retry */
    }
    await sleep(400);
  }
  return false;
}

async function withBase(fn) {
  if (process.env.VERIFY_BASE_URL) {
    await fn(process.env.VERIFY_BASE_URL.replace(/\/$/, ""));
    return;
  }
  const port = process.env.VERIFY_PORT || "3021";
  const base = `http://127.0.0.1:${port}`;
  const child = spawn("npx", ["tsx", "server.ts"], {
    cwd: root,
    env: { ...process.env, PORT: port },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    if (!(await waitHome(base))) throw new Error("server failed to start");
    await fn(base);
  } finally {
    child.kill("SIGTERM");
    await sleep(300);
  }
}

await withBase(async (base) => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });

  for (let t = 0; t < 90; t++) {
    if (await page.locator("#card-swiper").count()) break;
    await sleep(1000);
  }
  if (!(await page.locator("#card-swiper").count())) {
    await page.screenshot({ path: path.join(root, "artifacts", "card-dom-fail.png"), fullPage: true }).catch(() => {});
    throw new Error("#card-swiper not found — data may not have loaded");
  }

  const swiper = page.locator("#card-swiper");
  const results = [];

  for (let styleIdx = 0; styleIdx < 5; styleIdx++) {
    const styleBtns = swiper.locator("button").filter({ hasText: /^[1-5]$/ });
    if (styleIdx < (await styleBtns.count())) {
      await styleBtns.nth(styleIdx).click();
      await sleep(700);
    }
    for (let i = 0; i < 12; i++) {
      await sleep(180);
      if (await swiper.getByText("没有可完整显示").count()) {
        results.push({ styleIdx, i, reason: "empty-ok" });
        break;
      }
      const m = await page.evaluate(() => {
        const el = document.querySelector("[data-card-quote='true']");
        if (!el) return { reason: "no-quote", ok: false };
        const full = el.scrollHeight <= el.clientHeight + 2;
        return {
          ok: full,
          reason: full ? "full" : "clipped",
          textLen: (el.textContent || "").trim().length,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight
        };
      });
      results.push({ styleIdx, i, ...m });
      if (m.reason === "clipped") {
        console.error("CLIPPED", m);
      }
      const next = swiper.getByRole("button", { name: /下句/ });
      if (await next.count()) await next.click();
      else break;
    }
  }

  await browser.close();

  const clipped = results.filter((r) => r.reason === "clipped");
  const full = results.filter((r) => r.reason === "full");
  console.log(JSON.stringify({ full: full.length, clipped: clipped.length }, null, 2));
  if (clipped.length) {
    process.exitCode = 2;
    throw new Error(`${clipped.length} card quotes still CSS-clipped`);
  }
  if (full.length < 5) {
    process.exitCode = 2;
    throw new Error(`expected several full quotes, got ${full.length}`);
  }
  console.log("verify-card-dom PASS");
});
