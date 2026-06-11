// A tiny module-level cache of oracle state, shared across client-side
// navigations. `router.push` doesn't reload the page, so this memory survives
// the jump from the markets list into a detail page. The list seeds it from
// data it already fetched, so the detail page paints instantly instead of
// blocking its whole render on a ~1s /oracles/:id/state round-trip.
import type { OracleData, OracleStateData } from './predictApi';

const cache = new Map<string, OracleStateData>();

/** Store the authoritative full state (oracle + price + SVI) returned by /state. */
export function cacheOracleState(data: OracleStateData | null) {
  const id = data?.oracle?.oracle_id;
  if (id) cache.set(id, data!);
}

/**
 * Seed a thin entry (oracle + last-known spot/forward) for an instant first
 * paint. Never downgrades a richer full-state entry that's already cached.
 */
export function seedOracle(oracle: OracleData, spot?: number | null, forward?: number | null) {
  const id = oracle?.oracle_id;
  if (!id) return;
  const existing = cache.get(id);
  if (existing?.latest_svi) return; // already have the real thing — don't clobber
  const havePrice = spot != null || forward != null;
  cache.set(id, {
    oracle,
    latest_price: havePrice
      ? { oracle_id: id, spot: spot ?? 0, forward: forward ?? 0, timestamp: 0 }
      : existing?.latest_price ?? null,
    latest_svi: existing?.latest_svi ?? null,
  });
}

export function getCachedOracleState(id: string | null): OracleStateData | null {
  return id ? cache.get(id) ?? null : null;
}
