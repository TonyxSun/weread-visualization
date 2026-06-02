import { getDb } from "../db.js";
import type { WeReadGateway } from "../wereadGateway.js";
import { STATS_TTL_MS } from "./constants.js";

export function getCachedStats(accountId: number): Record<string, unknown> | null {
  const row = getDb().prepare(
    "SELECT payload_json, fetched_at FROM stats_cache WHERE account_id = ? AND mode = 'overall'"
  ).get(accountId) as { payload_json: string; fetched_at: number } | undefined;
  if (!row) return null;
  if (Date.now() - row.fetched_at > STATS_TTL_MS) return null;
  try {
    return JSON.parse(row.payload_json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function refreshStatsIfNeeded(
  accountId: number,
  gateway: WeReadGateway,
  force: boolean
): Promise<Record<string, unknown>> {
  const cached = !force ? getCachedStats(accountId) : null;
  if (cached) return cached;

  const data = await gateway.call("/readdata/detail", { mode: "overall" });
  const now = Date.now();
  getDb().prepare(`
    INSERT INTO stats_cache (account_id, mode, payload_json, fetched_at)
    VALUES (?, 'overall', ?, ?)
    ON CONFLICT(account_id, mode) DO UPDATE SET
      payload_json = excluded.payload_json,
      fetched_at = excluded.fetched_at
  `).run(accountId, JSON.stringify(data), now);
  return data;
}