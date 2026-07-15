/**
 * Publish-mode auth helpers: no visitor-supplied secrets.
 * Pure module (no import.meta / localStorage) so Node can test the real shipped path.
 */

export const DEFAULT_GATEWAY_URL = "https://i.weread.qq.com/api/agent/gateway";
export const DEFAULT_SKILL_VERSION = "1.0.5";

/**
 * Headers for WeRead server routes (snapshot / sync / status).
 * Intentionally omits Authorization — the Express process uses WEREAD_API_KEY from env.
 */
export function buildWereadServerAuthHeaders(options?: {
  gatewayUrl?: string;
  skillVersion?: string;
}): Record<string, string> {
  return {
    "X-WeRead-Gateway-Url": (options?.gatewayUrl || DEFAULT_GATEWAY_URL).trim() || DEFAULT_GATEWAY_URL,
    "X-WeRead-Skill-Version": (options?.skillVersion || DEFAULT_SKILL_VERSION).trim() || DEFAULT_SKILL_VERSION,
    "Content-Type": "application/json"
  };
}

/**
 * Body fields for /api/weread/proxy when the browser never holds a gateway token.
 * Server fills apiKey from WEREAD_API_KEY.
 */
export function buildWereadProxyBody(
  apiName: string,
  params: Record<string, unknown> = {},
  options?: { gatewayUrl?: string; skillVersion?: string }
): Record<string, unknown> {
  return {
    targetUrl: (options?.gatewayUrl || DEFAULT_GATEWAY_URL).trim() || DEFAULT_GATEWAY_URL,
    apiKey: "",
    api_name: apiName,
    skill_version: (options?.skillVersion || DEFAULT_SKILL_VERSION).trim() || DEFAULT_SKILL_VERSION,
    ...params
  };
}

/**
 * Analyze request body without client analysisConfig secrets.
 * Server resolveAnalysisConfig() uses ANALYSIS_*, XAI_*, or GEMINI env vars.
 */
export function buildAnalyzeRequestBody(
  books: unknown[],
  highlights: unknown[]
): { books: unknown[]; highlights: unknown[] } {
  return { books, highlights };
}
