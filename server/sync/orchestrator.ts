import { getDb } from "../db.js";
import type { AccountRow } from "../account.js";
import { WeReadGateway, type WeReadCredentials } from "../wereadGateway.js";
import { fetchFullCatalog, persistCatalog } from "./catalog.js";
import { booksNeedingFetch, syncBookHighlightsFullReplace } from "./highlights.js";
import { refreshStatsIfNeeded } from "./stats.js";
import { FULL_REFRESH_EVERY_N } from "./constants.js";
import { onAuthenticatedRequest } from "./credentials.js";

const activeJobs = new Set<number>();

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

export function startSync(
  account: AccountRow,
  creds: WeReadCredentials,
  opts: { force?: boolean } = {}
): SyncStartResponse {
  const db = getDb();
  onAuthenticatedRequest(account.id, creds);

  const running = db.prepare(`
    SELECT id, mode FROM sync_runs
    WHERE account_id = ? AND status = 'running'
    ORDER BY id DESC LIMIT 1
  `).get(account.id) as { id: number; mode: string } | undefined;

  if (running) {
    return {
      syncRunId: running.id,
      status: "running",
      mode: running.mode,
      coalesced: true
    };
  }

  const hasNotebooks = db.prepare(
    "SELECT 1 FROM notebooks WHERE account_id = ? AND deleted_at IS NULL LIMIT 1"
  ).get(account.id);

  const mode = opts.force ? "force" : (hasNotebooks ? "delta" : "cold");
  const now = Date.now();

  if (opts.force) {
    db.prepare("UPDATE accounts SET catalog_refresh_count = 0 WHERE id = ?").run(account.id);
    db.prepare(`
      UPDATE book_notes_sync SET sync_status = 'pending' WHERE account_id = ?
    `).run(account.id);
  }

  const insert = db.prepare(`
    INSERT INTO sync_runs (account_id, mode, phase, status, books_total, books_done, started_at)
    VALUES (?, ?, 'catalog', 'running', 0, 0, ?)
  `).run(account.id, mode, now);

  const syncRunId = Number(insert.lastInsertRowid);
  void runSyncJob(account, creds, syncRunId, opts);

  return { syncRunId, status: "running", mode, coalesced: false };
}

export function getSyncStatus(accountId: number, syncRunId: number): SyncStatusResponse | null {
  const row = getDb().prepare(`
    SELECT id, status, phase, books_done, books_total, current_book_id, error
    FROM sync_runs WHERE id = ? AND account_id = ?
  `).get(syncRunId, accountId) as {
    id: number;
    status: string;
    phase: string;
    books_done: number;
    books_total: number;
    current_book_id: string | null;
    error: string | null;
  } | undefined;

  if (!row) return null;

  let currentBookTitle: string | undefined;
  if (row.current_book_id) {
    const nb = getDb().prepare(
      "SELECT book_json FROM notebooks WHERE account_id = ? AND book_id = ?"
    ).get(accountId, row.current_book_id) as { book_json: string } | undefined;
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
  const db = getDb();
  const gateway = new WeReadGateway(creds);
  const updatePhase = (phase: string, booksTotal = 0, booksDone = 0, currentBookId?: string) => {
    db.prepare(`
      UPDATE sync_runs SET phase = ?, books_total = ?, books_done = ?, current_book_id = ?
      WHERE id = ?
    `).run(phase, booksTotal, booksDone, currentBookId ?? null, syncRunId);
  };

  try {
    updatePhase("catalog");
    const catalog = await fetchFullCatalog(gateway);
    const changed = persistCatalog(account.id, catalog);

    updatePhase("stats");
    await refreshStatsIfNeeded(account.id, gateway, Boolean(opts.force));

    let queue = [...new Set([...changed, ...booksNeedingFetch(account.id, Boolean(opts.force))])];

    const accountRow = db.prepare(
      "SELECT catalog_refresh_count FROM accounts WHERE id = ?"
    ).get(account.id) as { catalog_refresh_count: number };

    if (!opts.force && accountRow.catalog_refresh_count > 0
      && accountRow.catalog_refresh_count % FULL_REFRESH_EVERY_N === 0) {
      const all = db.prepare(`
        SELECT book_id FROM notebooks WHERE account_id = ? AND deleted_at IS NULL AND note_count > 0
      `).all(account.id) as Array<{ book_id: string }>;
      queue = [...new Set([...queue, ...all.map((r) => r.book_id)])];
    }

    updatePhase("highlights", queue.length, 0);
    let done = 0;
    for (const bookId of queue) {
      updatePhase("highlights", queue.length, done, bookId);
      try {
        await syncBookHighlightsFullReplace(account.id, bookId, gateway);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        db.prepare(`
          UPDATE book_notes_sync SET sync_status = 'error', last_error = ? WHERE account_id = ? AND book_id = ?
        `).run(message, account.id, bookId);
      }
      done += 1;
    }

    const backfill = booksNeedingFetch(account.id, false);
    if (backfill.length > 0) {
      updatePhase("backfill", backfill.length, 0);
      let bfDone = 0;
      for (const bookId of backfill) {
        updatePhase("backfill", backfill.length, bfDone, bookId);
        try {
          await syncBookHighlightsFullReplace(account.id, bookId, gateway);
        } catch { /* logged in book_notes_sync */ }
        bfDone += 1;
      }
    }

    const now = Date.now();
    db.prepare(`
      UPDATE sync_runs SET status = 'done', phase = 'done', finished_at = ? WHERE id = ?
    `).run(now, syncRunId);

    const run = db.prepare("SELECT mode FROM sync_runs WHERE id = ?").get(syncRunId) as { mode: string };
    if (run.mode === "delta") {
      db.prepare(`
        UPDATE accounts SET catalog_refresh_count = catalog_refresh_count + 1,
          last_sync_at = ?, updated_at = ? WHERE id = ?
      `).run(now, now, account.id);
    } else {
      db.prepare("UPDATE accounts SET last_sync_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, account.id);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(`
      UPDATE sync_runs SET status = 'error', error = ?, finished_at = ? WHERE id = ?
    `).run(message, Date.now(), syncRunId);
  } finally {
    activeJobs.delete(syncRunId);
  }
}