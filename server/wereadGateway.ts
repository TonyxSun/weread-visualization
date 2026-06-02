import { postWeReadGateway } from "./gatewayHttp.js";

export const WEREAD_MAX_CONCURRENT = 2;
export const WEREAD_MIN_REQUEST_GAP_MS = 400;
export const WEREAD_PROXY_RETRIES = 6;
export const WEREAD_RATE_LIMIT_BASE_MS = 2500;
export const WEREAD_GATEWAY_TIMEOUT_MS = 180000;

export interface WeReadCredentials {
  apiKey: string;
  gatewayUrl: string;
  skillVersion: string;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitMessage(message: string): boolean {
  return /频率超限|请求频率|rate limit|too many requests/i.test(message);
}

let inflight = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (inflight < WEREAD_MAX_CONCURRENT) {
    inflight += 1;
    return;
  }
  await new Promise<void>((resolve) => { waiters.push(resolve); });
  inflight += 1;
}

function releaseSlot(): void {
  inflight = Math.max(0, inflight - 1);
  const next = waiters.shift();
  if (next) next();
}

export class WeReadGateway {
  constructor(private creds: WeReadCredentials) {}

  async call(apiName: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    await acquireSlot();
    let lastError: Error | null = null;
    try {
      for (let attempt = 0; attempt <= WEREAD_PROXY_RETRIES; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), WEREAD_GATEWAY_TIMEOUT_MS);
        try {
          const response = await postWeReadGateway(
            this.creds.gatewayUrl,
            { Authorization: `Bearer ${this.creds.apiKey}` },
            {
              api_name: apiName,
              skill_version: this.creds.skillVersion,
              ...params
            },
            controller.signal
          );
          clearTimeout(timeout);

          const data = response.data;
          if (response.status >= 400) {
            throw new Error(String(data.errmsg || `Gateway HTTP ${response.status}`));
          }
          if (data.errcode && Number(data.errcode) !== 0) {
            throw new Error(String(data.errmsg || `WeRead Error [${data.errcode}]`));
          }
          return data;
        } catch (error: unknown) {
          clearTimeout(timeout);
          const err = error as { name?: string; message?: string };
          const message = err?.name === "AbortError"
            ? `微信读书网关请求超过 ${Math.round(WEREAD_GATEWAY_TIMEOUT_MS / 1000)} 秒未返回`
            : err?.message || String(error);
          lastError = new Error(message);
          if (attempt < WEREAD_PROXY_RETRIES) {
            const delay = isRateLimitMessage(message)
              ? WEREAD_RATE_LIMIT_BASE_MS * (attempt + 1)
              : (attempt + 1) * 800;
            await wait(delay);
          }
        }
      }
    } finally {
      releaseSlot();
      await wait(WEREAD_MIN_REQUEST_GAP_MS);
    }
    throw lastError || new Error("微信读书网关请求失败");
  }
}