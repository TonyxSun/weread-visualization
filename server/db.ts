import fs from "fs";
import path from "path";
import type { Client, InValue } from "@libsql/client";

const LOCAL_DB_PATH = path.join(process.cwd(), "data", "weread.db");
const MIGRATIONS_DIR = path.join(process.cwd(), "server", "db", "migrations");
const MIGRATIONS: Array<{ version: number; file: string }> = [
  { version: 1, file: "001_init.sql" },
  { version: 2, file: "002_heartbeat_lease.sql" }
];

let client: Client | null = null;
let migrated: Promise<void> | null = null;

export type SqlValue = InValue;

function databaseUrl(): string {
  const remote = process.env.TURSO_DATABASE_URL?.trim();
  if (remote) return remote;
  if (process.env.VERCEL) {
    throw new Error(
      "TURSO_DATABASE_URL is required on Vercel. Local SQLite files are not persisted across invocations."
    );
  }
  fs.mkdirSync(path.dirname(LOCAL_DB_PATH), { recursive: true, mode: 0o700 });
  return `file:${LOCAL_DB_PATH}`;
}

async function createDbClient(): Promise<Client> {
  const url = databaseUrl();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim() || undefined;
  // Remote Turso must use the HTTP/web client. The Node client pulls native
  // libsql binaries that a macOS prebuilt function does not include.
  if (url.startsWith("file:")) {
    const { createClient } = await import("@libsql/client/node");
    return createClient({ url, authToken });
  }
  const { createClient } = await import("@libsql/client/web");
  return createClient({ url, authToken });
}

export async function getClient(): Promise<Client> {
  if (!client) {
    client = await createDbClient();
  }
  return client;
}

export async function ensureDb(): Promise<Client> {
  const db = await getClient();
  if (!migrated) {
    migrated = runMigrations(db);
  }
  await migrated;
  return db;
}

async function currentSchemaVersion(db: Client): Promise<number> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL
    )
  `);
  const applied = await db.execute("SELECT MAX(version) AS v FROM schema_migrations");
  let version = Number(applied.rows[0]?.v ?? 0);
  if (version > 0) return version;
  try {
    const pragma = await db.execute("PRAGMA user_version");
    const userVersion = Number(pragma.rows[0]?.user_version ?? pragma.rows[0]?.[0] ?? 0);
    if (userVersion >= 1) {
      await db.execute("INSERT OR IGNORE INTO schema_migrations (version) VALUES (1)");
      version = 1;
    }
  } catch {
    // remote libSQL may ignore or reject user_version
  }
  return version;
}

async function runMigrations(db: Client): Promise<void> {
  const remote = Boolean(process.env.TURSO_DATABASE_URL?.trim());
  if (!remote) {
    await db.execute("PRAGMA journal_mode = WAL");
    await db.execute("PRAGMA foreign_keys = ON");
  }

  let version = await currentSchemaVersion(db);
  for (const migration of MIGRATIONS) {
    if (version >= migration.version) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, migration.file), "utf-8");
    const statements = sql
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
    for (const statement of statements) {
      try {
        await db.execute(statement);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const ignorable = /duplicate column|already exists/i.test(message);
        if (!ignorable) throw error;
      }
    }
    await db.execute({
      sql: "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)",
      args: [migration.version]
    });
    version = migration.version;
  }

  if (!remote) {
    try {
      fs.chmodSync(LOCAL_DB_PATH, 0o600);
    } catch {
      // best-effort on platforms that support it
    }
  }
}

export async function get<T>(sql: string, args: SqlValue[] = []): Promise<T | undefined> {
  const db = await ensureDb();
  const rs = await db.execute({ sql, args });
  return rs.rows[0] as T | undefined;
}

export async function all<T>(sql: string, args: SqlValue[] = []): Promise<T[]> {
  const db = await ensureDb();
  const rs = await db.execute({ sql, args });
  return rs.rows as unknown as T[];
}

export async function run(
  sql: string,
  args: SqlValue[] = []
): Promise<{ lastInsertRowid: number; changes: number }> {
  const db = await ensureDb();
  const rs = await db.execute({ sql, args });
  return {
    lastInsertRowid: Number(rs.lastInsertRowid ?? 0),
    changes: rs.rowsAffected
  };
}

export async function batch(statements: Array<{ sql: string; args?: SqlValue[] }>): Promise<void> {
  if (statements.length === 0) return;
  const db = await ensureDb();
  await db.batch(
    statements.map((s) => ({ sql: s.sql, args: s.args ?? [] })),
    "write"
  );
}

export function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unique constraint/i.test(message);
}
