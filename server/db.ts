import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const DB_PATH = path.join(process.cwd(), "data", "weread.db");
const MIGRATION_PATH = path.join(process.cwd(), "server", "db", "migrations", "001_init.sql");

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!dbInstance) {
    dbInstance = openDatabase();
  }
  return dbInstance;
}

export function openDatabase(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true, mode: 0o700 });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  try {
    fs.chmodSync(DB_PATH, 0o600);
  } catch {
    // best-effort on platforms that support it
  }
  return db;
}

function runMigrations(db: Database.Database): void {
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version >= 1) return;
  const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");
  db.exec(sql);
  db.pragma("user_version = 1");
}