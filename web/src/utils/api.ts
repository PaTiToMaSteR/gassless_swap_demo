import type { BundlerInstance, Deployments, Quote, QuoteRequest } from "./types";

async function mustJson(res: Response): Promise<any> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}

export async function fetchBundlers(monitorUrl: string): Promise<BundlerInstance[]> {
  const res = await fetch(`${monitorUrl}/api/public/bundlers`);
  return mustJson(res);
}

export async function fetchDeployments(monitorUrl: string): Promise<Deployments> {
  const res = await fetch(`${monitorUrl}/api/public/deployments`);
  return mustJson(res);
}

export async function fetchQuote(quoteServiceUrl: string, req: QuoteRequest): Promise<Quote> {
  const res = await fetch(`${quoteServiceUrl}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  return mustJson(res);
}

export async function postTelemetryEvent(
  monitorUrl: string,
  name: "paid_fallback_attempt" | "paid_fallback_success" | "paid_fallback_failure",
): Promise<void> {
  const res = await fetch(`${monitorUrl}/api/telemetry/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  await mustJson(res);
}
