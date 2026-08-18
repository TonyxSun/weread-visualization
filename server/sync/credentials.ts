import crypto from "crypto";
import { hashApiKey, type AccountRow } from "../account.js";
import { run } from "../db.js";
import { REFRESH_INTERVAL_MS } from "./constants.js";
import type { WeReadCredentials } from "../wereadGateway.js";

const credentialCache = new Map<number, WeReadCredentials & { expiresAt: number }>();

export function encryptApiKey(apiKey: string, secret: string): Buffer {
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

export function decryptApiKey(blob: Uint8Array | Buffer, secret: string): string {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export async function onAuthenticatedRequest(
  accountId: number,
  creds: WeReadCredentials
): Promise<void> {
  credentialCache.set(accountId, {
    ...creds,
    expiresAt: Date.now() + REFRESH_INTERVAL_MS + 300_000
  });
  const secret = process.env.SERVER_SECRET;
  if (!secret || secret.length < 16) return;
  await run(
    "UPDATE accounts SET api_key_encrypted = ?, updated_at = ? WHERE id = ?",
    [encryptApiKey(creds.apiKey, secret), Date.now(), accountId]
  );
}

export function resolveSchedulerCredentials(account: AccountRow): WeReadCredentials | null {
  const envKey = process.env.WEREAD_API_KEY?.trim();
  if (envKey && hashApiKey(envKey) === account.account_key_hash) {
    return {
      apiKey: envKey,
      gatewayUrl: account.gateway_url,
      skillVersion: account.skill_version
    };
  }

  const secret = process.env.SERVER_SECRET;
  if (account.api_key_encrypted && secret && secret.length >= 16) {
    try {
      return {
        apiKey: decryptApiKey(account.api_key_encrypted, secret),
        gatewayUrl: account.gateway_url,
        skillVersion: account.skill_version
      };
    } catch {
      return null;
    }
  }

  const cached = credentialCache.get(account.id);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      apiKey: cached.apiKey,
      gatewayUrl: cached.gatewayUrl,
      skillVersion: cached.skillVersion
    };
  }

  return null;
}
