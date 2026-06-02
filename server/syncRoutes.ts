import type { Express, Request, Response } from "express";
import { hashApiKey, upsertAccount, getAccountByHash } from "./account.js";
import { getDb } from "./db.js";
import { buildSnapshot } from "./sync/snapshot.js";
import { startSync, getSyncStatus } from "./sync/orchestrator.js";
import { onAuthenticatedRequest } from "./sync/credentials.js";

const DEFAULT_GATEWAY = "https://i.weread.qq.com/api/agent/gateway";
const DEFAULT_SKILL_VERSION = "1.0.5";

function parseCredentials(req: Request): {
  apiKey: string;
  gatewayUrl: string;
  skillVersion: string;
} | null {
  const auth = req.headers.authorization || "";
  const apiKey = auth.replace(/^Bearer\s+/i, "").trim()
    || String(req.body?.apiKey || "").trim();
  if (!apiKey || apiKey.length < 8) return null;

  const gatewayUrl = String(
    req.headers["x-weread-gateway-url"] || req.body?.gatewayUrl || DEFAULT_GATEWAY
  ).trim();
  const skillVersion = String(
    req.headers["x-weread-skill-version"] || req.body?.skillVersion || DEFAULT_SKILL_VERSION
  ).trim();

  return { apiKey, gatewayUrl, skillVersion };
}

function resolveAccount(req: Request, res: Response) {
  const creds = parseCredentials(req);
  if (!creds) {
    res.status(400).json({ errcode: -1, errmsg: "API Key (Bearer Token) is required" });
    return null;
  }
  const account = upsertAccount({
    apiKey: creds.apiKey,
    gatewayUrl: creds.gatewayUrl,
    skillVersion: creds.skillVersion
  });
  onAuthenticatedRequest(account.id, creds);
  return { account, creds };
}

export function registerWeReadSyncRoutes(app: Express): void {
  app.post("/api/weread/snapshot", (req, res) => {
    try {
      const resolved = resolveAccount(req, res);
      if (!resolved) return;
      const { account } = resolved;
      const now = Date.now();
      getDb().prepare("UPDATE accounts SET last_snapshot_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, account.id);
      const snapshot = buildSnapshot(account.id);
      res.json(snapshot);
    } catch (error: unknown) {
      console.error("[snapshot]", error);
      res.status(500).json({ errcode: 500, errmsg: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/weread/sync", (req, res) => {
    try {
      const resolved = resolveAccount(req, res);
      if (!resolved) return;
      const { account, creds } = resolved;
      const force = Boolean(req.body?.force);
      const result = startSync(account, creds, { force });
      res.status(202).json(result);
    } catch (error: unknown) {
      console.error("[sync]", error);
      res.status(500).json({ errcode: 500, errmsg: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/weread/sync/status", (req, res) => {
    try {
      const creds = parseCredentials(req);
      if (!creds) {
        return res.status(400).json({ errcode: -1, errmsg: "API Key required" });
      }
      const account = getAccountByHash(hashApiKey(creds.apiKey));
      if (!account) {
        return res.status(404).json({ errcode: 404, errmsg: "Account not found" });
      }
      const syncRunId = Number(req.query.syncRunId || 0);
      if (!syncRunId) {
        return res.status(400).json({ errcode: -1, errmsg: "syncRunId required" });
      }
      const status = getSyncStatus(account.id, syncRunId);
      if (!status) {
        return res.status(404).json({ errcode: 404, errmsg: "Sync run not found" });
      }
      res.json(status);
    } catch (error: unknown) {
      console.error("[sync/status]", error);
      res.status(500).json({ errcode: 500, errmsg: error instanceof Error ? error.message : String(error) });
    }
  });
}