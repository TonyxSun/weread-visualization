import { getAccountById } from "../account.js";
import { all } from "../db.js";
import { resolveSchedulerCredentials } from "./credentials.js";
import { startSync } from "./orchestrator.js";
import { REFRESH_INTERVAL_MS } from "./constants.js";

let schedulerStarted = false;
let warnedNoCreds = false;

export async function runDueRefreshes(): Promise<{ started: number; skipped: number }> {
  const due = await all<{ id: number }>(
    `SELECT id FROM accounts
    WHERE last_sync_at IS NULL OR last_sync_at < ?`,
    [Date.now() - REFRESH_INTERVAL_MS]
  );

  let started = 0;
  let skipped = 0;
  for (const row of due) {
    const account = await getAccountById(row.id);
    if (!account) continue;
    const creds = resolveSchedulerCredentials(account);
    if (!creds) {
      skipped += 1;
      if (!warnedNoCreds) {
        console.warn("[weread-scheduler] Skipping refresh: no credentials for one or more accounts");
        warnedNoCreds = true;
      }
      continue;
    }
    try {
      await startSync(account, creds, { force: false });
      started += 1;
    } catch (error) {
      console.warn("[weread-scheduler] Failed to start sync", error);
    }
  }

  return { started, skipped };
}

export function startRefreshScheduler(): void {
  if (schedulerStarted) return;
  if (process.env.VERCEL) return;
  schedulerStarted = true;

  setInterval(() => {
    void runDueRefreshes();
  }, 60_000);
}
