import { waitUntil } from "@vercel/functions";
import { all, get, isUniqueConstraintError, run } from "../db.js";
import type { AccountRow } from "../account.js";
import { WeReadGateway, type WeReadCredentials } from "../wereadGateway.js";
import { fetchFullCatalog, persistCatalog } from "./catalog.js";
import { booksNeedingFetch, syncBookHighlightsFullReplace } from "./highlights.js";
import { refreshStatsIfNeeded } from "./stats.js";
import { FULL_REFRESH_EVERY_N } from "./constants.js";
import { onAuthenticatedRequest } from "./credentials.js";

const activeJobs = new Set<number>();
const SYNC_ORPHAN_MS = 90_000;

export interface SyncStartResponse {
  syncRunId: number;
  status: string;
  mode: string;
  coalesced: boolean;
}

export interface SyncStatusResponse {
  syncRunId: number;
  status: string;
  phase: string;
  booksDone: number;
  booksTotal: number;
  currentBookTitle?: string;
  error?: string;
}

/**
 * Mark stale "running" rows as errored.
 * Local process restart: drop any running row not tracked in this process.
 * Vercel: drop rows whose heartbeat is older than SYNC_ORPHAN_MS.
 */
export async function abandonOrphanedSyncRuns(
  reason = "同步进程已中断，将重新开始"
): Promise<number> {
  const orphans = await getRunningSyncRuns();
  let abandoned = 0;
  const now = Date.now();
  for (const row of orphans) {
    if (activeJobs.has(row.id)) continue;
    const heartbeat = row.last_heartbeat_at || row.started_at;
    const stale = now - heartbeat > SYNC_ORPHAN_MS;
    const localRestart = !process.env.VERCEL;
    if (!stale && !localRestart) continue;
    await run(
      `UPDATE sync_runs
      SET status = 'error', error = ?, finished_at = ?
      WHERE id = ? AND status = 'running'`,
      [reason, now, row.id]
    );
    abandoned += 1;
  }
  if (abandoned > 0) {
    console.warn(`[weread-sync] Abandoned ${abandoned} orphaned running sync run(s)`);
  }
  return abandoned;
}

async function getRunningSyncRuns(): Promise<Array<{
  id: number;
  started_at: number;
  last_heartbeat_at: number | null;
}>> {
  return all<{ id: number; started_at: number; last_heartbeat_at: number | null }>(
    "SELECT id, started_at, last_heartbeat_at FROM sync_runs WHERE status = 'running'"
  );
}

export async function startSync(
  account: AccountRow,
  creds: WeReadCredentials,
  opts: { force?: boolean } = {}
): Promise<SyncStartResponse> {
  await onAuthenticatedRequest(account.id, creds);
  await abandonOrphanedSyncRuns();

  const running = await get<{
    id: number;
    mode: string;
    started_at: number;
    last_heartbeat_at: number | null;
  }>(
    `SELECT id, mode, started_at, last_heartbeat_at FROM sync_runs
    WHERE account_id = ? AND status = 'running'
    ORDER BY id DESC LIMIT 1`,
    [account.id]
  );

  const runningFresh = Boolean(
    running && (
      activeJobs.has(running.id)
      || Date.now() - (running.last_heartbeat_at || running.started_at) < SYNC_ORPHAN_MS
    )
  );
  if (running && runningFresh) {
    return {
      syncRunId: running.id,
      status: "running",
      mode: running.mode,
      coalesced: true
    };
  }

  if (running) {
    await run(
      `UPDATE sync_runs
      SET status = 'error', error = ?, finished_at = ?
      WHERE id = ? AND status = 'running'`,
      ["同步任务已失效（服务重启或异常退出）", Date.now(), running.id]
    );
  }

  const hasNotebooks = await get<{ one: number }>(
    "SELECT 1 AS one FROM notebooks WHERE account_id = ? AND deleted_at IS NULL LIMIT 1",
    [account.id]
  );

  const mode = opts.force ? "force" : (hasNotebooks ? "delta" : "cold");
  const now = Date.now();

  if (opts.force) {
    await run("UPDATE accounts SET catalog_refresh_count = 0 WHERE id = ?", [account.id]);
    await run(
      "UPDATE book_notes_sync SET sync_status = 'pending' WHERE account_id = ?",
      [account.id]
    );
  }

  let syncRunId: number;
  try {
    const insert = await run(
      `INSERT INTO sync_runs (account_id, mode, phase, status, books_total, books_done, started_at, last_heartbeat_at)
      VALUES (?, ?, 'catalog', 'running', 0, 0, ?, ?)`,
      [account.id, mode, now, now]
    );
    syncRunId = insert.lastInsertRowid;
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const winner = await get<{ id: number; mode: string }>(
      `SELECT id, mode FROM sync_runs
      WHERE account_id = ? AND status = 'running'
      ORDER BY id DESC LIMIT 1`,
      [account.id]
    );
    if (!winner) throw error;
    return {
      syncRunId: winner.id,
      status: "running",
      mode: winner.mode,
      coalesced: true
    };
  }
  const job = runSyncJob(account, creds, syncRunId, opts);
  if (process.env.VERCEL) {
    waitUntil(job);
  } else {
    void job;
  }

  return { syncRunId, status: "running", mode, coalesced: false };
}

export async function getSyncStatus(
  accountId: number,
  syncRunId: number
): Promise<SyncStatusResponse | null> {
  await abandonOrphanedSyncRuns();
  const row = await get<{
    id: number;
    status: string;
    phase: string;
    books_done: number;
    books_total: number;
    current_book_id: string | null;
    error: string | null;
  }>(
    `SELECT id, status, phase, books_done, books_total, current_book_id, error
    FROM sync_runs WHERE id = ? AND account_id = ?`,
    [syncRunId, accountId]
  );

  if (!row) return null;

  let currentBookTitle: string | undefined;
  if (row.current_book_id) {
    const nb = await get<{ book_json: string }>(
      "SELECT book_json FROM notebooks WHERE account_id = ? AND book_id = ?",
      [accountId, row.current_book_id]
    );
    if (nb) {
      try {
        const parsed = JSON.parse(nb.book_json) as { book?: { title?: string } };
        currentBookTitle = parsed.book?.title;
      } catch { /* ignore */ }
    }
  }

  return {
    syncRunId: row.id,
    status: row.status,
    phase: row.phase,
    booksDone: row.books_done,
    booksTotal: row.books_total,
    currentBookTitle,
    error: row.error ?? undefined
  };
}

async function runSyncJob(
  account: AccountRow,
  creds: WeReadCredentials,
  syncRunId: number,
  opts: { force?: boolean }
): Promise<void> {
  if (activeJobs.has(syncRunId)) return;
  activeJobs.add(syncRunId);
  const gateway = new WeReadGateway(creds);
  const updatePhase = async (
    phase: string,
    booksTotal = 0,
    booksDone = 0,
    currentBookId?: string
  ) => {
    await run(
      `UPDATE sync_runs SET phase = ?, books_total = ?, books_done = ?, current_book_id = ?, last_heartbeat_at = ?
      WHERE id = ?`,
      [phase, booksTotal, booksDone, currentBookId ?? null, Date.now(), syncRunId]
    );
  };

  try {
    await updatePhase("catalog");
    const catalog = await fetchFullCatalog(gateway);
    const changed = await persistCatalog(account.id, catalog);

    await updatePhase("stats");
    await refreshStatsIfNeeded(account.id, gateway, Boolean(opts.force));

    let queue = [...new Set([...changed, ...await booksNeedingFetch(account.id, Boolean(opts.force))])];

    const accountRow = await get<{ catalog_refresh_count: number }>(
      "SELECT catalog_refresh_count FROM accounts WHERE id = ?",
      [account.id]
    );

    if (accountRow && !opts.force && accountRow.catalog_refresh_count > 0
      && accountRow.catalog_refresh_count % FULL_REFRESH_EVERY_N === 0) {
      const allBooks = await all<{ book_id: string }>(
        "SELECT book_id FROM notebooks WHERE account_id = ? AND deleted_at IS NULL AND note_count > 0",
        [account.id]
      );
      queue = [...new Set([...queue, ...allBooks.map((r) => r.book_id)])];
    }

    await updatePhase("highlights", queue.length, 0);
    let done = 0;
    for (const bookId of queue) {
      await updatePhase("highlights", queue.length, done, bookId);
      try {
        await syncBookHighlightsFullReplace(account.id, bookId, gateway);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        await run(
          "UPDATE book_notes_sync SET sync_status = 'error', last_error = ? WHERE account_id = ? AND book_id = ?",
          [message, account.id, bookId]
        );
      }
      done += 1;
    }

    const backfill = await booksNeedingFetch(account.id, false);
    if (backfill.length > 0) {
      await updatePhase("backfill", backfill.length, 0);
      let bfDone = 0;
      for (const bookId of backfill) {
        await updatePhase("backfill", backfill.length, bfDone, bookId);
        try {
          await syncBookHighlightsFullReplace(account.id, bookId, gateway);
        } catch { /* logged in book_notes_sync */ }
        bfDone += 1;
      }
    }

    const finishedAt = Date.now();
    await run(
      "UPDATE sync_runs SET status = 'done', phase = 'done', finished_at = ? WHERE id = ?",
      [finishedAt, syncRunId]
    );

    const syncRun = await get<{ mode: string }>("SELECT mode FROM sync_runs WHERE id = ?", [syncRunId]);
    if (syncRun?.mode === "delta") {
      await run(
        `UPDATE accounts SET catalog_refresh_count = catalog_refresh_count + 1,
          last_sync_at = ?, updated_at = ? WHERE id = ?`,
        [finishedAt, finishedAt, account.id]
      );
    } else {
      await run(
        "UPDATE accounts SET last_sync_at = ?, updated_at = ? WHERE id = ?",
        [finishedAt, finishedAt, account.id]
      );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await run(
      "UPDATE sync_runs SET status = 'error', error = ?, finished_at = ? WHERE id = ?",
      [message, Date.now(), syncRunId]
    );
  } finally {
    activeJobs.delete(syncRunId);
  }
}
