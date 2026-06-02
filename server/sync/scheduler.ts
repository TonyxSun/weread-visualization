import { getDb } from "../db.js";
import { getAccountById } from "../account.js";
import { resolveSchedulerCredentials } from "./credentials.js";
import { startSync } from "./orchestrator.js";
import { REFRESH_INTERVAL_MS } from "./constants.js";

let schedulerStarted = false;
let warnedNoCreds = false;

export function startRefreshScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  setInterval(() => {
    const db = getDb();
    const due = db.prepare(`
      SELECT id FROM accounts
      WHERE last_sync_at IS NULL OR last_sync_at < ?
    `).all(Date.now() - REFRESH_INTERVAL_MS) as Array<{ id: number }>;

    for (const row of due) {
      const account = getAccountById(row.id);
      if (!account) continue;
      const creds = resolveSchedulerCredentials(account);
      if (!creds) {
        if (!warnedNoCreds) {
          console.warn("[weread-scheduler] Skipping refresh: no credentials for one or more accounts");
          warnedNoCreds = true;
        }
        continue;
      }
      try {
        startSync(account, creds, { force: false });
      } catch (error) {
        console.warn("[weread-scheduler] Failed to start sync", error);
      }
    }
  }, 60_000);
}