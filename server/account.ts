import crypto from "crypto";
import { getDb } from "./db.js";

export function hashApiKey(apiKey: string): string {
  return crypto.createHash("sha256").update(apiKey.trim()).digest("hex");
}

export interface AccountRow {
  id: number;
  account_key_hash: string;
  gateway_url: string;
  skill_version: string;
  catalog_refresh_count: number;
  last_sync_at: number | null;
  last_snapshot_at: number | null;
  api_key_encrypted: Buffer | null;
}

export function upsertAccount(params: {
  apiKey: string;
  gatewayUrl: string;
  skillVersion: string;
  apiKeyEncrypted?: Buffer | null;
}): AccountRow {
  const db = getDb();
  const now = Date.now();
  const hash = hashApiKey(params.apiKey);
  const existing = db.prepare(
    "SELECT * FROM accounts WHERE account_key_hash = ?"
  ).get(hash) as AccountRow | undefined;

  if (existing) {
    db.prepare(`
      UPDATE accounts SET
        gateway_url = ?,
        skill_version = ?,
        api_key_encrypted = COALESCE(?, api_key_encrypted),
        updated_at = ?
      WHERE id = ?
    `).run(
      params.gatewayUrl,
      params.skillVersion,
      params.apiKeyEncrypted ?? null,
      now,
      existing.id
    );
    return db.prepare("SELECT * FROM accounts WHERE id = ?").get(existing.id) as AccountRow;
  }

  const result = db.prepare(`
    INSERT INTO accounts (
      account_key_hash, gateway_url, skill_version, api_key_encrypted,
      catalog_refresh_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(
    hash,
    params.gatewayUrl,
    params.skillVersion,
    params.apiKeyEncrypted ?? null,
    now,
    now
  );

  return db.prepare("SELECT * FROM accounts WHERE id = ?").get(result.lastInsertRowid) as AccountRow;
}

export function getAccountByHash(hash: string): AccountRow | undefined {
  return getDb().prepare("SELECT * FROM accounts WHERE account_key_hash = ?").get(hash) as AccountRow | undefined;
}

export function getAccountById(id: number): AccountRow | undefined {
  return getDb().prepare("SELECT * FROM accounts WHERE id = ?").get(id) as AccountRow | undefined;
}