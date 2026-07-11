'use client';

// The 6-24 bell pulse — one tiny shared read of the LIVE venue for chrome
// surfaces: the Marquee's "NEXT BELL", the landing hero dial, and the /feed
// results rail. The legacy 4-16 oracles these surfaces used to read expire
// ~6 days out (their countdown printed "9100:12"); the real venue rings every
// minute, so next-expiry must come from the 6-24 indexer.

import { useEffect, useState } from 'react';
import {
  PREDICT624,
  FLOAT_SCALING_624,
  inferCadence624,
  type Cadence624,
} from './predict624Client';

export interface Print624 {
  marketId: string;
  cadence: Cadence624;
  /** The bell — market expiry, ms epoch. */
  expiry: number;
  /** The oracle settlement print, USD. */
  priceUsd: number;
  settledAtMs: number;
}

interface RawRow {
  expiry_market_id?: string;
  expiry?: number | string;
}

/** One raw /markets read → deduped { id, expiry } rows (indexer order:
 *  newest-created first). 120 events ≈ 1.5–2 h of creations — plenty for both
 *  the soonest future bells and a screenful of recent prints. */
async function rawMarkets624(limit = 120): Promise<{ id: string; expiry: number }[]> {
  const res = await fetch(`${PREDICT624.indexer}/markets?limit=${limit}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`predict624 indexer /markets ${res.status}`);
  const rows = (await res.json()) as RawRow[];
  const seen = new Set<string>();
  const out: { id: string; expiry: number }[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = String(r.expiry_market_id ?? '');
    const expiry = Number(r.expiry);
    if (!id || !Number.isFinite(expiry) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, expiry });
  }
  return out;
}

// Settlements are immutable — cache each market's print for the session so a
// poll only costs one /markets read plus at most a couple of state misses.
const printCache = new Map<string, Print624>();

async function loadPrint(id: string, expiry: number): Promise<Print624 | null> {
  const cached = printCache.get(id);
  if (cached) return cached;
  try {
    const res = await fetch(`${PREDICT624.indexer}/markets/${id}/state`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      settlement?: { settlement_price?: string | number; settled_at_ms?: string | number } | null;
    };
    const s = j?.settlement;
    if (s?.settlement_price == null) return null; // not settled yet — retry next poll
    const print: Print624 = {
      marketId: id,
      cadence: inferCadence624(expiry),
      expiry,
      priceUsd: Number(s.settlement_price) / FLOAT_SCALING_624,
      settledAtMs: Number(s.settled_at_ms ?? expiry),
    };
    printCache.set(id, print);
    return print;
  } catch {
    return null;
  }
}

/** The newest REAL settlement prints, newest first. */
export async function fetchRecentPrints624(count = 6): Promise<Print624[]> {
  const now = Date.now();
  const past = (await rawMarkets624())
    .filter((m) => m.expiry <= now)
    .sort((a, b) => b.expiry - a.expiry)
    .slice(0, count + 2); // headroom — the very newest bell may not have settled yet
  const prints = await Promise.all(past.map((m) => loadPrint(m.id, m.expiry)));
  return prints.filter((p): p is Print624 => p != null).slice(0, count);
}

/** mm:ss under an hour, h:mm over it (the venue's soonest bell is normally minutes out). */
export function fmtBell624(msLeft: number): string {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  if (s < 3600) return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} h`;
}

/**
 * Shared chrome hook: the next 6-24 bell (ms epoch) + the freshest settlement
 * print. Polls the indexer every `pollMs`; a 1 s tick rolls to the following
 * bell the second one passes (no waiting for the next poll).
 */
export function useBell624(pollMs = 15_000): { nextBellMs: number | null; lastPrint: Print624 | null; liveCount: number | null } {
  const [bells, setBells] = useState<number[]>([]);
  const [lastPrint, setLastPrint] = useState<Print624 | null>(null);
  const [nextBellMs, setNextBellMs] = useState<number | null>(null);

  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const rows = await rawMarkets624();
        if (dead) return;
        const now = Date.now();
        setBells(rows.filter((m) => m.expiry > now).map((m) => m.expiry).sort((a, b) => a - b));
        const past = rows.filter((m) => m.expiry <= now).sort((a, b) => b.expiry - a.expiry).slice(0, 3);
        for (const m of past) {
          const p = await loadPrint(m.id, m.expiry);
          if (dead) return;
          if (p) { setLastPrint(p); break; }
        }
      } catch { /* keep last values */ }
    };
    load();
    const iv = setInterval(load, pollMs);
    return () => { dead = true; clearInterval(iv); };
  }, [pollMs]);

  useEffect(() => {
    const tick = () => setNextBellMs(bells.find((e) => e > Date.now()) ?? null);
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [bells]);

  // live = still-future bells from the same fetch (null until the first load lands)
  const liveCount = bells.length ? bells.filter((e) => e > Date.now()).length : (nextBellMs == null ? null : 0);
  return { nextBellMs, lastPrint, liveCount };
}
