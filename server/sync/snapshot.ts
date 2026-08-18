import { all, get } from "../db.js";
import { REFRESH_INTERVAL_MS } from "./constants.js";

export interface SnapshotMeta {
  stale: boolean;
  partial: boolean;
  pendingBooks: number;
  lastSyncAt: number | null;
  syncRunId: number | null;
  syncInProgress: boolean;
}

export async function buildSnapshot(accountId: number): Promise<{
  notebooks: unknown[];
  stats: Record<string, unknown> | null;
  highlights: unknown[];
  meta: SnapshotMeta;
}> {
  const [account, notebookRows, highlightRows, statsRow, pendingBooks, running] = await Promise.all([
    get<{ last_sync_at: number | null }>(
      "SELECT last_sync_at FROM accounts WHERE id = ?",
      [accountId]
    ),
    all<{ book_json: string }>(
      `SELECT book_json FROM notebooks
      WHERE account_id = ? AND deleted_at IS NULL
      ORDER BY sort DESC`,
      [accountId]
    ),
    all<Record<string, unknown>>(
      `SELECT bookmark_id, book_id, chapter_uid, chapter_idx, mark_text, create_time,
             type, range, color_style, book_name, book_author, book_cover
      FROM highlights WHERE account_id = ?
      ORDER BY create_time DESC`,
      [accountId]
    ),
    get<{ payload_json: string }>(
      "SELECT payload_json FROM stats_cache WHERE account_id = ? AND mode = 'overall'",
      [accountId]
    ),
    get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM book_notes_sync
      WHERE account_id = ? AND sync_status != 'ok'`,
      [accountId]
    ),
    get<{ id: number }>(
      `SELECT id FROM sync_runs
      WHERE account_id = ? AND status = 'running'
      ORDER BY id DESC LIMIT 1`,
      [accountId]
    )
  ]);

  const notebooks = notebookRows.map((row) => {
    try {
      return JSON.parse(row.book_json);
    } catch {
      return null;
    }
  }).filter(Boolean);

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

  let stats: Record<string, unknown> | null = null;
  if (statsRow) {
    try {
      stats = JSON.parse(statsRow.payload_json) as Record<string, unknown>;
    } catch {
      stats = null;
    }
  }

  const lastSyncAt = account?.last_sync_at ?? null;
  const pendingCount = Number(pendingBooks?.c ?? 0);
  const stale =
    (lastSyncAt != null && Date.now() - lastSyncAt > REFRESH_INTERVAL_MS)
    || Boolean(running)
    || pendingCount > 0;

  return {
    notebooks,
    stats,
    highlights,
    meta: {
      stale,
      partial: pendingCount > 0,
      pendingBooks: pendingCount,
      lastSyncAt,
      syncRunId: running?.id ?? null,
      syncInProgress: Boolean(running)
    }
  };
}
