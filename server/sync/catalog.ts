import crypto from "crypto";
import { getDb } from "../db.js";
import type { WeReadGateway } from "../wereadGateway.js";

export interface CatalogBook {
  bookId: string;
  sort: number;
  noteCount: number;
  reviewCount: number;
  bookmarkCount: number;
  markedStatus?: number;
  readingProgress?: number;
  book: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export function notebookFingerprint(book: CatalogBook): string {
  const payload = [
    book.bookId,
    book.sort,
    book.noteCount,
    book.reviewCount,
    book.bookmarkCount
  ].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function dedupeByBookId(books: CatalogBook[]): CatalogBook[] {
  const map = new Map<string, CatalogBook>();
  for (const b of books) {
    if (b.bookId) map.set(b.bookId, b);
  }
  return Array.from(map.values());
}

export async function fetchFullCatalog(gateway: WeReadGateway): Promise<CatalogBook[]> {
  const all: CatalogBook[] = [];
  let lastSort: number | undefined;
  const pageSize = 100;

  do {
    const body: Record<string, unknown> = { count: pageSize };
    if (lastSort != null) body.lastSort = lastSort;
    const page = await gateway.call("/user/notebooks", body);
    const rawBooks = (page.books as Record<string, unknown>[]) || [];
    const books = rawBooks.map((row) => {
      const bookId = String(row.bookId || (row.book as Record<string, unknown>)?.bookId || "");
      return {
        bookId,
        sort: Number(row.sort || 0),
        noteCount: Number(row.noteCount || 0),
        reviewCount: Number(row.reviewCount || 0),
        bookmarkCount: Number(row.bookmarkCount || 0),
        markedStatus: row.markedStatus as number | undefined,
        readingProgress: row.readingProgress as number | undefined,
        book: (row.book as Record<string, unknown>) || {},
        raw: row
      };
    });
    all.push(...books);
    if (!page.hasMore) break;
    const pageBooks = dedupeByBookId(books);
    if (pageBooks.length === 0) break;
    lastSort = pageBooks[pageBooks.length - 1]?.sort;
  } while (lastSort != null);

  return dedupeByBookId(all);
}

export function persistCatalog(accountId: number, apiBooks: CatalogBook[]): string[] {
  const db = getDb();
  const now = Date.now();
  const existing = db.prepare(
    "SELECT book_id, fingerprint FROM notebooks WHERE account_id = ? AND deleted_at IS NULL"
  ).all(accountId) as Array<{ book_id: string; fingerprint: string }>;
  const existingMap = new Map(existing.map((r) => [r.book_id, r.fingerprint]));
  const apiIds = new Set(apiBooks.map((b) => b.bookId));
  const toFetch: string[] = [];

  const upsert = db.prepare(`
    INSERT INTO notebooks (
      account_id, book_id, sort, note_count, review_count, bookmark_count,
      marked_status, reading_progress, book_json, fingerprint, deleted_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT(account_id, book_id) DO UPDATE SET
      sort = excluded.sort,
      note_count = excluded.note_count,
      review_count = excluded.review_count,
      bookmark_count = excluded.bookmark_count,
      marked_status = excluded.marked_status,
      reading_progress = excluded.reading_progress,
      book_json = excluded.book_json,
      fingerprint = excluded.fingerprint,
      deleted_at = NULL,
      updated_at = excluded.updated_at
  `);

  for (const book of apiBooks) {
    const fp = notebookFingerprint(book);
    const prev = existingMap.get(book.bookId);
    upsert.run(
      accountId,
      book.bookId,
      book.sort,
      book.noteCount,
      book.reviewCount,
      book.bookmarkCount,
      book.markedStatus ?? null,
      book.readingProgress ?? null,
      JSON.stringify(book.raw),
      fp,
      now
    );
    if (!prev || prev !== fp) {
      toFetch.push(book.bookId);
      db.prepare(`
        INSERT INTO book_notes_sync (account_id, book_id, sync_status)
        VALUES (?, ?, 'pending')
        ON CONFLICT(account_id, book_id) DO UPDATE SET sync_status = 'pending'
      `).run(accountId, book.bookId);
    }
  }

  for (const row of existing) {
    if (!apiIds.has(row.book_id)) {
      db.prepare("UPDATE notebooks SET deleted_at = ?, updated_at = ? WHERE account_id = ? AND book_id = ?")
        .run(now, now, accountId, row.book_id);
      db.prepare("DELETE FROM highlights WHERE account_id = ? AND book_id = ?").run(accountId, row.book_id);
    }
  }

  return toFetch;
}