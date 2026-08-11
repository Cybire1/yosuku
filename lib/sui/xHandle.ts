// Who actually runs this agent.
//
// Strategies have been showing a codename derived from the creator's address (Kenji Beck, Rosa
// Holt). That was the right call when an address was all we had, but it is a stranger's name on
// somebody's real trading record. Meanwhile a live on-chain HandleRegistry already binds X
// accounts to wallets, and /api/claim/x/me already resolves wallet -> handle in production. Five
// of the eleven live strategies were created by a wallet with a binding.
//
// So this replaces an invented person with a real one, wherever a real one exists. Where no
// binding exists we keep the codename rather than inventing a handle: an unclaimed agent should
// look unclaimed.

const CACHE = new Map<string, string | null>();
const INFLIGHT = new Map<string, Promise<string | null>>();

/**
 * Resolve a wallet to its bound X handle, or null.
 *
 * Deduped and cached for the page's lifetime. A card list re-renders constantly and every render
 * would otherwise re-ask for the same wallet; the answer only changes when someone completes a
 * claim, which is not a thing that happens mid-scroll.
 */
export function resolveXHandle(wallet: string): Promise<string | null> {
  const key = wallet.toLowerCase();
  if (CACHE.has(key)) return Promise.resolve(CACHE.get(key)!);
  const running = INFLIGHT.get(key);
  if (running) return running;

  const p = (async () => {
    try {
      const r = await fetch(`/api/claim/x/me?wallet=${encodeURIComponent(wallet)}`, { cache: 'no-store' });
      if (!r.ok) return null;
      const j = (await r.json()) as { handle?: string | null };
      // Treat empty string as unbound. A blank handle rendered as "@" is worse than a codename.
      const h = typeof j.handle === 'string' && j.handle.trim() ? j.handle.trim() : null;
      CACHE.set(key, h);
      return h;
    } catch {
      // A failed lookup is NOT proof of "unclaimed", so do not cache it. Next render tries again.
      return null;
    } finally {
      INFLIGHT.delete(key);
    }
  })();

  INFLIGHT.set(key, p);
  return p;
}

/** Resolve many wallets at once, deduped. Returns only the ones that are actually bound. */
export async function resolveXHandles(wallets: string[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(wallets.map((w) => w.toLowerCase()).filter(Boolean)));
  const pairs = await Promise.all(uniq.map(async (w) => [w, await resolveXHandle(w)] as const));
  const out = new Map<string, string>();
  for (const [w, h] of pairs) if (h) out.set(w, h);
  return out;
}

export const xProfileUrl = (handle: string) => `https://x.com/${handle.replace(/^@/, '')}`;
