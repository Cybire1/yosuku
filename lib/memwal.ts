// Sensei persistent memory via MemWal (Walrus Memory). SERVER-ONLY — the delegate
// key must never reach the browser, so only import this from route handlers.
//
// Everything here is best-effort and NEVER throws: if MemWal isn't configured, the
// user is anonymous, or the relayer is unavailable (e.g. the "uploads paused for a
// security upgrade" 503), Sensei simply runs without memory this turn. Memory
// enriches the read when it's there; it never blocks or breaks the assistant.
import { MemWal } from '@mysten-incubation/memwal';

type Client = ReturnType<typeof MemWal.create> | null;
let _client: Client = null;
let _tried = false;

function client(): Client {
  if (_tried) return _client;
  _tried = true;
  const key = process.env.MEMWAL_PRIVATE_KEY;
  const accountId = process.env.MEMWAL_ACCOUNT_ID;
  if (!key || !accountId) return (_client = null);
  try {
    _client = MemWal.create({
      key,
      accountId,
      serverUrl: process.env.MEMWAL_SERVER_URL ?? 'https://relayer-staging.memory.walrus.xyz',
      namespace: process.env.MEMWAL_NAMESPACE ?? 'sensei',
    });
  } catch {
    _client = null;
  }
  return _client;
}

// One memory space per user, isolated by namespace. Anonymous users get no
// persistent memory (no stable id to scope to).
const nsFor = (userId?: string | null) => {
  const id = (userId ?? '').trim().toLowerCase();
  return id ? `sensei:${id}` : null;
};

/** Recall the most relevant memories for this user. Returns [] on anything unusual. */
export async function recallMemories(userId: string | undefined | null, query: string, limit = 4): Promise<string[]> {
  const c = client();
  const ns = nsFor(userId);
  if (!c || !ns || !query?.trim()) return [];
  try {
    const r = await c.recall({ query: query.trim(), limit, namespace: ns, maxDistance: 0.7 });
    return (r?.results ?? []).map((m) => m.text).filter((t): t is string => !!t);
  } catch {
    return [];
  }
}

/** Persist a durable fact about this user. Fire-and-forget; swallows the relayer
 *  write-pause (503) and any transient error. */
export async function rememberFact(userId: string | undefined | null, text: string): Promise<void> {
  const c = client();
  const ns = nsFor(userId);
  if (!c || !ns || !text?.trim()) return;
  try {
    await c.remember(text.trim(), ns);
  } catch {
    /* paused / unavailable — Sensei just doesn't persist this one */
  }
}
