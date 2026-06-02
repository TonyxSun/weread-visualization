CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key_hash TEXT NOT NULL UNIQUE,
  gateway_url TEXT NOT NULL DEFAULT 'https://i.weread.qq.com/api/agent/gateway',
  skill_version TEXT NOT NULL DEFAULT '1.0.5',
  notebooks_synckey INTEGER,
  api_key_encrypted BLOB,
  catalog_refresh_count INTEGER NOT NULL DEFAULT 0,
  last_sync_at INTEGER,
  last_snapshot_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notebooks (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL,
  sort INTEGER NOT NULL,
  note_count INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  bookmark_count INTEGER NOT NULL DEFAULT 0,
  marked_status INTEGER,
  reading_progress REAL,
  book_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  deleted_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, book_id)
);
CREATE INDEX IF NOT EXISTS idx_notebooks_account_sort ON notebooks(account_id, sort DESC);

CREATE TABLE IF NOT EXISTS highlights (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  bookmark_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter_uid INTEGER,
  chapter_idx INTEGER,
  mark_text TEXT NOT NULL,
  create_time INTEGER NOT NULL,
  type INTEGER NOT NULL DEFAULT 1,
  range TEXT,
  color_style INTEGER,
  book_name TEXT,
  book_author TEXT,
  book_cover TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, bookmark_id)
);
CREATE INDEX IF NOT EXISTS idx_highlights_account_book ON highlights(account_id, book_id);

CREATE TABLE IF NOT EXISTS book_notes_sync (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL,
  synckey INTEGER NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  last_fetched_at INTEGER,
  last_error TEXT,
  highlight_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, book_id)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  books_total INTEGER NOT NULL DEFAULT 0,
  books_done INTEGER NOT NULL DEFAULT 0,
  current_book_id TEXT,
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_account_status ON sync_runs(account_id, status);

CREATE TABLE IF NOT EXISTS stats_cache (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'overall',
  payload_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, mode)
);