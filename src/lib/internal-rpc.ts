/**
 * Internal RPC helper — calls server.js /_internal/rpc to proxy WebSocket RPC calls to OpenClaw gateway.
 */
export async function internalRpc(channelId: string, method: string, params: Record<string, unknown> = {}) {
  const socketPort = (parseInt(process.env.PORT ?? "3000") + 1).toString();
  const res = await fetch(`http://localhost:${socketPort}/_internal/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channelId, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || `RPC ${method} failed`);
  return data.result;
}

export function getUserId(req: { headers: { get: (name: string) => string | null } }): string | null {
  return req.headers.get("x-user-id");
}
