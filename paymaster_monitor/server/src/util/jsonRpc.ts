export async function jsonRpcCall<T>(rpcUrl: string, method: string, params: any[] = []): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} failed: HTTP ${res.status}`);
  const body = (await res.json()) as any;
  if (body.error) throw new Error(body.error.message ?? "RPC error");
  return body.result as T;
}
