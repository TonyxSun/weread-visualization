import { getDb } from "../db.js";
import { REFRESH_INTERVAL_MS } from "./constants.js";

export interface SnapshotMeta {
  stale: boolean;
  partial: boolean;
  pendingBooks: number;
  lastSyncAt: number | null;
  syncRunId: number | null;
  syncInProgress: boolean;
}

export function buildSnapshot(accountId: number): {
  notebooks: unknown[];
  stats: Record<string, unknown> | null;
  highlights: unknown[];
  meta: SnapshotMeta;
} {
  const db = getDb();
  const account = db.prepare(
    "SELECT last_sync_at FROM accounts WHERE id = ?"
  ).get(accountId) as { last_sync_at: number | null };

  const notebookRows = db.prepare(`
    SELECT book_json FROM notebooks
    WHERE account_id = ? AND deleted_at IS NULL
    ORDER BY sort DESC
  `).all(accountId) as Array<{ book_json: string }>;

  const notebooks = notebookRows.map((row) => {
    try {
      return JSON.parse(row.book_json);
    } catch {
      return null;
    }
  }).filter(Boolean);

  const highlightRows = db.prepare(`
    SELECT bookmark_id, book_id, chapter_uid, chapter_idx, mark_text, create_time,
           type, range, color_style, book_name, book_author, book_cover
    FROM highlights WHERE account_id = ?
    ORDER BY create_time DESC
  `).all(accountId) as Array<Record<string, unknown>>;

  const highlights = highlightRows.map((h) => ({
    bookmarkId: h.bookmark_id,
    bookId: h.book_id,
    chapterUid: h.chapter_uid,
    chapterIdx: h.chapter_idx,
    markText: h.mark_text,
    createTime: h.create_time,
    type: h.type,
    range: h.range,
    colorStyle: h.color_style,
    bookName: h.book_name,
    bookAuthor: h.book_author,
    bookCover: h.book_cover
  }));

  const statsRow = db.prepare(
    "SELECT payload_json FROM stats_cache WHERE account_id = ? AND mode = 'overall'"
  ).get(accountId) as { payload_json: string } | undefined;

  let stats: Record<string, unknown> | null = null;
  if (statsRow) {
    try {
      stats = JSON.parse(statsRow.payload_json) as Record<string, unknown>;
    } catch {
      stats = null;
    }
  }

  const pendingBooks = db.prepare(`
    SELECT COUNT(*) AS c FROM book_notes_sync
    WHERE account_id = ? AND sync_status != 'ok'
  `).get(accountId) as { c: number };

  const running = db.prepare(`
    SELECT id FROM sync_runs
    WHERE account_id = ? AND status = 'running'
    ORDER BY id DESC LIMIT 1
  `).get(accountId) as { id: number } | undefined;

  const lastSyncAt = account?.last_sync_at ?? null;
  const stale =
    (lastSyncAt != null && Date.now() - lastSyncAt > REFRESH_INTERVAL_MS)
    || Boolean(running)
    || pendingBooks.c > 0;

  return {
    notebooks,
    stats,
    highlights,
    meta: {
      stale,
      partial: pendingBooks.c > 0,
      pendingBooks: pendingBooks.c,
      lastSyncAt,
      syncRunId: running?.id ?? null,
      syncInProgress: Boolean(running)
    }
  };
}