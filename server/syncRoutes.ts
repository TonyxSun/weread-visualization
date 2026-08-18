import type { Express, Request, Response } from "express";
import { hashApiKey, upsertAccount, getAccountByHash } from "./account.js";
import { run } from "./db.js";
import { buildSnapshot } from "./sync/snapshot.js";
import { startSync, getSyncStatus } from "./sync/orchestrator.js";
import { onAuthenticatedRequest } from "./sync/credentials.js";
import { runDueRefreshes } from "./sync/scheduler.js";

const DEFAULT_GATEWAY = "https://i.weread.qq.com/api/agent/gateway";
const DEFAULT_SKILL_VERSION = "1.0.5";

function parseCredentials(req: Request): {
  apiKey: string;
  gatewayUrl: string;
  skillVersion: string;
} | null {
  const auth = req.headers.authorization || "";
  let apiKey = auth.replace(/^Bearer\s+/i, "").trim()
    || String(req.body?.apiKey || "").trim();
  if (!apiKey || apiKey.length < 8) {
    const envKey = (process.env.WEREAD_API_KEY || "").trim();
    if (envKey && envKey.length >= 8) {
      apiKey = envKey;
    } else {
      return null;
    }
  }

  const gatewayUrl = String(
    req.headers["x-weread-gateway-url"] || req.body?.gatewayUrl || DEFAULT_GATEWAY
  ).trim();
  const skillVersion = String(
    req.headers["x-weread-skill-version"] || req.body?.skillVersion || DEFAULT_SKILL_VERSION
  ).trim();

  return { apiKey, gatewayUrl, skillVersion };
}

async function resolveAccount(req: Request, res: Response) {
  const creds = parseCredentials(req);
  if (!creds) {
    res.status(400).json({ errcode: -1, errmsg: "API Key (Bearer Token) is required" });
    return null;
  }
  const account = await upsertAccount({
    apiKey: creds.apiKey,
    gatewayUrl: creds.gatewayUrl,
    skillVersion: creds.skillVersion
  });
  await onAuthenticatedRequest(account.id, creds);
  return { account, creds };
}

function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.authorization || "";
  if (secret) {
    return auth === `Bearer ${secret}`;
  }
  const userAgent = String(req.headers["user-agent"] || "");
  return Boolean(process.env.VERCEL) && userAgent.startsWith("vercel-cron/");
}

export function registerWeReadSyncRoutes(app: Express): void {
  app.post("/api/weread/snapshot", async (req, res) => {
    try {
      const resolved = await resolveAccount(req, res);
      if (!resolved) return;
      const { account } = resolved;
      const now = Date.now();
      await run(
        "UPDATE accounts SET last_snapshot_at = ?, updated_at = ? WHERE id = ?",
        [now, now, account.id]
      );
      const snapshot = await buildSnapshot(account.id);
      res.json(snapshot);
    } catch (error: unknown) {
      console.error("[snapshot]", error);
      res.status(500).json({ errcode: 500, errmsg: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/weread/sync", async (req, res) => {
    try {
      const resolved = await resolveAccount(req, res);
      if (!resolved) return;
      const { account, creds } = resolved;
      const force = Boolean(req.body?.force);
      const result = await startSync(account, creds, { force });
      res.status(202).json(result);
    } catch (error: unknown) {
      console.error("[sync]", error);
      res.status(500).json({ errcode: 500, errmsg: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/weread/sync/status", async (req, res) => {
    try {
      const creds = parseCredentials(req);
      if (!creds) {
        return res.status(400).json({ errcode: -1, errmsg: "API Key required" });
      }
      const account = await getAccountByHash(hashApiKey(creds.apiKey));
      if (!account) {
        return res.status(404).json({ errcode: 404, errmsg: "Account not found" });
      }
      const syncRunId = Number(req.query.syncRunId || 0);
      if (!syncRunId) {
        return res.status(400).json({ errcode: -1, errmsg: "syncRunId required" });
      }
      const status = await getSyncStatus(account.id, syncRunId);
      if (!status) {
        return res.status(404).json({ errcode: 404, errmsg: "Sync run not found" });
      }
      res.json(status);
    } catch (error: unknown) {
      console.error("[sync/status]", error);
      res.status(500).json({ errcode: 500, errmsg: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/weread/cron", async (req, res) => {
    try {
      if (!cronAuthorized(req)) {
        return res.status(401).json({ errcode: 401, errmsg: "Unauthorized" });
      }
      const result = await runDueRefreshes();
      res.json({ ok: true, ...result });
    } catch (error: unknown) {
      console.error("[cron]", error);
      res.status(500).json({ errcode: 500, errmsg: error instanceof Error ? error.message : String(error) });
    }
  });
}
