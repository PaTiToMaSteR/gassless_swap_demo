import type { BundlerInstance, LogEvent, MetricsSummary, PaymasterStatus, UserOpSummary, UsersResponse } from "./types";

async function mustJson(res: Response): Promise<any> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}

function authHeaders(token: string): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

export async function fetchSummary(monitorUrl: string, token: string): Promise<MetricsSummary> {
  const res = await fetch(`${monitorUrl}/api/admin/metrics/summary`, { headers: authHeaders(token) });
  return mustJson(res);
}

export async function fetchBundlers(monitorUrl: string, token: string): Promise<BundlerInstance[]> {
  const res = await fetch(`${monitorUrl}/api/admin/bundlers`, { headers: authHeaders(token) });
  return mustJson(res);
}

export async function fetchPaymasterStatus(monitorUrl: string, token: string): Promise<PaymasterStatus> {
  const res = await fetch(`${monitorUrl}/api/admin/paymaster/status`, { headers: authHeaders(token) });
  return mustJson(res);
}

export async function spawnBundler(
  monitorUrl: string,
  token: string,
  body: { base: "bundler1" | "bundler2"; name?: string; policy?: any },
): Promise<any> {
  const res = await fetch(`${monitorUrl}/api/admin/bundlers/spawn`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(body),
  });
  return mustJson(res);
}

export async function stopBundler(monitorUrl: string, token: string, id: string): Promise<any> {
  const res = await fetch(`${monitorUrl}/api/admin/bundlers/${id}/stop`, {
    method: "POST",
    headers: authHeaders(token),
  });
  return mustJson(res);
}

export async function unregisterBundler(monitorUrl: string, token: string, id: string): Promise<any> {
  const res = await fetch(`${monitorUrl}/api/admin/bundlers/${id}/unregister`, {
    method: "POST",
    headers: authHeaders(token),
  });
  return mustJson(res);
}

export async function registerBundler(
  monitorUrl: string,
  token: string,
  body: { name: string; rpcUrl: string; policy?: any },
): Promise<any> {
  const res = await fetch(`${monitorUrl}/api/admin/bundlers/register`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(body),
  });
  return mustJson(res);
}

export async function queryLogs(monitorUrl: string, params: Record<string, string>): Promise<LogEvent[]> {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${monitorUrl}/api/logs?${qs.toString()}`);
  const body = await mustJson(res);
  return (body.logs ?? []) as LogEvent[];
}

export async function fetchUserOps(
  monitorUrl: string,
  token: string,
  params: Record<string, string>,
): Promise<UserOpSummary[]> {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${monitorUrl}/api/admin/userops?${qs.toString()}`, { headers: authHeaders(token) });
  const body = await mustJson(res);
  return (body.userops ?? []) as UserOpSummary[];
}

export async function fetchUsers(monitorUrl: string, token: string): Promise<UsersResponse> {
  const res = await fetch(`${monitorUrl}/api/admin/users`, { headers: authHeaders(token) });
  return mustJson(res);
}

export async function fetchTimeseries(
  monitorUrl: string,
  token: string,
  params: Record<string, string>,
): Promise<Array<{ t: number; ops: number; feesWei: string; gasWei: string }>> {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${monitorUrl}/api/admin/metrics/timeseries?${qs.toString()}`, { headers: authHeaders(token) });
  const body = await mustJson(res);
  return (body.series ?? []) as Array<{ t: number; ops: number; feesWei: string; gasWei: string }>;
}
