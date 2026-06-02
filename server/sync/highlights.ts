import { getDb } from "../db.js";
import type { WeReadGateway } from "../wereadGateway.js";
import { BOOKMARKLIST_MAX_AGE_MS } from "./constants.js";

export async function syncBookHighlightsFullReplace(
  accountId: number,
  bookId: string,
  gateway: WeReadGateway
): Promise<void> {
  const db = getDb();
  const res = await gateway.call("/book/bookmarklist", { bookId });
  const updated = (res.updated as Record<string, unknown>[]) || [];
  const book = (res.book as Record<string, unknown>) || {};
  const notebook = db.prepare(
    "SELECT book_json FROM notebooks WHERE account_id = ? AND book_id = ?"
  ).get(accountId, bookId) as { book_json: string } | undefined;
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

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM highlights WHERE account_id = ? AND book_id = ?").run(accountId, bookId);
    const insert = db.prepare(`
      INSERT INTO highlights (
        account_id, bookmark_id, book_id, chapter_uid, chapter_idx, mark_text,
        create_time, type, range, color_style, book_name, book_author, book_cover, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const h of updated) {
      insert.run(
        accountId,
        String(h.bookmarkId || `${bookId}_${h.createTime}`),
        bookId,
        h.chapterUid ?? null,
        h.chapterIdx ?? null,
        String(h.markText || ""),
        Number(h.createTime || 0),
        Number(h.type ?? 1),
        h.range != null ? String(h.range) : null,
        h.colorStyle ?? null,
        bookName,
        bookAuthor,
        bookCover,
        now
      );
    }
    const count = db.prepare(
      "SELECT COUNT(*) AS c FROM highlights WHERE account_id = ? AND book_id = ?"
    ).get(accountId, bookId) as { c: number };
    db.prepare(`
      INSERT INTO book_notes_sync (account_id, book_id, synckey, sync_status, last_fetched_at, highlight_count)
      VALUES (?, ?, ?, 'ok', ?, ?)
      ON CONFLICT(account_id, book_id) DO UPDATE SET
        synckey = excluded.synckey,
        sync_status = 'ok',
        last_fetched_at = excluded.last_fetched_at,
        highlight_count = excluded.highlight_count,
        last_error = NULL
    `).run(accountId, bookId, Number(res.synckey || 0), now, count.c);
  });
  tx();
}

export function booksNeedingFetch(accountId: number, force: boolean): string[] {
  const db = getDb();
  if (force) {
    return db.prepare(`
      SELECT book_id FROM notebooks WHERE account_id = ? AND deleted_at IS NULL
    `).all(accountId).map((r: { book_id: string }) => r.book_id);
  }

  const pending = db.prepare(`
    SELECT n.book_id FROM notebooks n
    LEFT JOIN book_notes_sync s ON s.account_id = n.account_id AND s.book_id = n.book_id
    WHERE n.account_id = ? AND n.deleted_at IS NULL
      AND (
        s.sync_status IS NULL OR s.sync_status != 'ok'
        OR (n.note_count > 0 AND (s.last_fetched_at IS NULL OR s.last_fetched_at < ?))
        OR (n.note_count > 0 AND COALESCE(s.highlight_count, 0) < n.note_count)
      )
  `).all(accountId, Date.now() - BOOKMARKLIST_MAX_AGE_MS) as Array<{ book_id: string }>;

  return pending.map((r) => r.book_id);
}