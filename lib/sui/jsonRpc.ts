// Resilient JSON-RPC — the ONE place the app talks raw JSON-RPC.
//
// Mysten sunset the public fullnode's JSON-RPC (`fullnode.testnet.sui.io` now 404s on every
// method, verified 2026-07-09). No single public node serves the full surface either: publicnode
// serves objects/coins/owned-objects but errors on `suix_queryEvents`; blockvision is currently
// the only node serving events but errors on `sui_getObject`. So we fan across nodes and take the
// first that returns a real result — falling through on HTTP error, empty body, parse failure, OR
// a JSON-RPC error (e.g. an unsupported method). This makes event/object reads survive any single
// node dying, which is exactly the failure that took the memory market + catalog offline.
//
// Long-term this should migrate to gRPC/GraphQL (see modernClients); until then this keeps the
// JSON-RPC-dependent reads (memory market, event history) alive and resilient.

const NODES: string[] = [
  process.env.NEXT_PUBLIC_SUI_RPC_URL, // operator override wins (set in Vercel to pin/rotate)
  'https://sui-testnet-rpc.publicnode.com', // objects / coins / owned-objects
  'https://sui-testnet-endpoint.blockvision.org', // events (suix_queryEvents)
  'https://rpc-testnet.suiscan.xyz', // extra object/owned fallback
].filter(Boolean) as string[];

/** Call a Sui JSON-RPC method, trying each node until one returns a real result. */
export async function suiJsonRpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
  let lastErr: unknown;
  for (const url of NODES) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) { lastErr = new Error(`${url} HTTP ${r.status}`); continue; }
      const text = await r.text();
      if (!text) { lastErr = new Error(`${url} empty body`); continue; }
      const j = JSON.parse(text) as { result?: T; error?: unknown };
      if (j.error) { lastErr = new Error(`${url}: ${JSON.stringify(j.error).slice(0, 100)}`); continue; }
      return j.result as T;
    } catch (e) {
      lastErr = e; // network / timeout / parse — try the next node
    }
  }
  throw lastErr ?? new Error('all JSON-RPC nodes failed');
}
