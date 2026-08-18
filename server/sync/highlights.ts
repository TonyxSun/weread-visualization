import { all, batch, get, type SqlValue } from "../db.js";
import type { WeReadGateway } from "../wereadGateway.js";
import { BOOKMARKLIST_MAX_AGE_MS } from "./constants.js";

export async function syncBookHighlightsFullReplace(
  accountId: number,
  bookId: string,
  gateway: WeReadGateway
): Promise<void> {
  const res = await gateway.call("/book/bookmarklist", { bookId });
  const updated = (res.updated as Record<string, unknown>[]) || [];
  const book = (res.book as Record<string, unknown>) || {};
  const notebook = await get<{ book_json: string }>(
    "SELECT book_json FROM notebooks WHERE account_id = ? AND book_id = ?",
    [accountId, bookId]
  );
  let bookMeta = book;
  if (notebook?.book_json) {
    try {
      const parsed = JSON.parse(notebook.book_json) as { book?: Record<string, unknown> };
      bookMeta = parsed.book || book;
    } catch { /* use gateway book */ }
  }
  const bookName = String(bookMeta.title || "");
  const bookAuthor = String(bookMeta.author || "");
  const bookCover = String(bookMeta.cover || "");
  const now = Date.now();
  const statements: Array<{ sql: string; args: SqlValue[] }> = [
    {
      sql: "DELETE FROM highlights WHERE account_id = ? AND book_id = ?",
      args: [accountId, bookId]
    }
  ];

  for (const h of updated) {
    statements.push({
      sql: `INSERT INTO highlights (
        account_id, bookmark_id, book_id, chapter_uid, chapter_idx, mark_text,
        create_time, type, range, color_style, book_name, book_author, book_cover, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        accountId,
        String(h.bookmarkId || `${bookId}_${h.createTime}`),
        bookId,
        (h.chapterUid ?? null) as SqlValue,
        (h.chapterIdx ?? null) as SqlValue,
        String(h.markText || ""),
        Number(h.createTime || 0),
        Number(h.type ?? 1),
        h.range != null ? String(h.range) : null,
        (h.colorStyle ?? null) as SqlValue,
        bookName,
        bookAuthor,
        bookCover,
        now
      ]
    });
  }

  statements.push({
    sql: `INSERT INTO book_notes_sync (account_id, book_id, synckey, sync_status, last_fetched_at, highlight_count)
      VALUES (?, ?, ?, 'ok', ?, ?)
      ON CONFLICT(account_id, book_id) DO UPDATE SET
        synckey = excluded.synckey,
        sync_status = 'ok',
        last_fetched_at = excluded.last_fetched_at,
        highlight_count = excluded.highlight_count,
        last_error = NULL`,
    args: [accountId, bookId, Number(res.synckey || 0), now, updated.length]
  });

  await batch(statements);
}

export async function booksNeedingFetch(accountId: number, force: boolean): Promise<string[]> {
  if (force) {
    const rows = await all<{ book_id: string }>(
      "SELECT book_id FROM notebooks WHERE account_id = ? AND deleted_at IS NULL",
      [accountId]
    );
    return rows.map((r) => r.book_id);
  }

  const pending = await all<{ book_id: string }>(
    `SELECT n.book_id FROM notebooks n
    LEFT JOIN book_notes_sync s ON s.account_id = n.account_id AND s.book_id = n.book_id
    WHERE n.account_id = ? AND n.deleted_at IS NULL
      AND (
        s.sync_status IS NULL OR s.sync_status != 'ok'
        OR (n.note_count > 0 AND (s.last_fetched_at IS NULL OR s.last_fetched_at < ?))
        OR (n.note_count > 0 AND COALESCE(s.highlight_count, 0) < n.note_count)
      )`,
    [accountId, Date.now() - BOOKMARKLIST_MAX_AGE_MS]
  );

  return pending.map((r) => r.book_id);
}
