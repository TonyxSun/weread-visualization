import crypto from "crypto";
import { get, run, type SqlValue } from "./db.js";

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
  api_key_encrypted: Uint8Array | Buffer | null;
}

export async function upsertAccount(params: {
  apiKey: string;
  gatewayUrl: string;
  skillVersion: string;
  apiKeyEncrypted?: Uint8Array | Buffer | null;
}): Promise<AccountRow> {
  const now = Date.now();
  const hash = hashApiKey(params.apiKey);
  await run(
    `INSERT INTO accounts (
      account_key_hash, gateway_url, skill_version, api_key_encrypted,
      catalog_refresh_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(account_key_hash) DO UPDATE SET
      gateway_url = excluded.gateway_url,
      skill_version = excluded.skill_version,
      api_key_encrypted = COALESCE(excluded.api_key_encrypted, accounts.api_key_encrypted),
      updated_at = excluded.updated_at`,
    [
      hash,
      params.gatewayUrl,
      params.skillVersion,
      (params.apiKeyEncrypted ?? null) as SqlValue,
      now,
      now
    ]
  );
  const row = await get<AccountRow>(
    "SELECT * FROM accounts WHERE account_key_hash = ?",
    [hash]
  );
  if (!row) {
    throw new Error("Failed to upsert WeRead account");
  }
  return row;
}

export async function getAccountByHash(hash: string): Promise<AccountRow | undefined> {
  return get<AccountRow>("SELECT * FROM accounts WHERE account_key_hash = ?", [hash]);
}

export async function getAccountById(id: number): Promise<AccountRow | undefined> {
  return get<AccountRow>("SELECT * FROM accounts WHERE id = ?", [id]);
}
