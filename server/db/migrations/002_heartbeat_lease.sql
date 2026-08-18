CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL
);

ALTER TABLE sync_runs ADD COLUMN last_heartbeat_at INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_runs_one_running
ON sync_runs(account_id) WHERE status = 'running';
