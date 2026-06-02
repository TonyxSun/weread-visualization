import dns from "dns";
import dnsPromises from "dns/promises";
import https from "https";
import type http from "http";

dns.setDefaultResultOrder("ipv4first");

export async function requestHttpsIpv4(
  targetUrl: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const url = new URL(targetUrl);
  const { address } = await dnsPromises.lookup(url.hostname, { family: 4 });
  const payload = options.body ?? "";
  const method = options.method ?? (payload ? "POST" : "GET");
  const reqHeaders: Record<string, string> = {
    ...options.headers,
    Host: url.hostname
  };
  if (payload) {
    reqHeaders["Content-Length"] = String(Buffer.byteLength(payload));
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: address,
        servername: url.hostname,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method,
        headers: reqHeaders
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 500,
            headers: res.headers,
            body: Buffer.concat(chunks)
          });
        });
      }
    );

    const onAbort = () => {
      req.destroy(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
    };
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export async function postWeReadGateway(
  gatewayUrl: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ status: number; data: Record<string, unknown> }> {
  const payload = JSON.stringify(body);
  const response = await requestHttpsIpv4(gatewayUrl, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json"
    },
    body: payload,
    signal
  });

  try {
    return { status: response.status, data: JSON.parse(response.body.toString("utf8") || "{}") as Record<string, unknown> };
  } catch {
    throw new Error("Invalid JSON from WeRead gateway");
  }
}