'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { readClient } from './modernClients';
import { DUSDC_MULTIPLIER } from './constants';
import {
  PARLAY_OPENED_EVENT,
  decodeParlayStatus,
  decodeLegStatus,
  type MyParlay,
  type ParlayLegState,
} from './parlayClient';

type Fields = Record<string, unknown>;
const fieldsOf = (content: unknown): Fields | null => {
  const c = content as { fields?: Fields } | null | undefined;
  return c?.fields ?? null;
};

// Collect parlay ids from ParlayOpened events emitted for `owner`, then fetch the
// objects that still exist (live + resolved-but-uncleaned tickets; claimed ones
// are deleted on-chain and drop out). Mirrors leverageHooks.liveByEvent, keyed on
// the event's `owner` field instead of `trader`.
async function myParlayObjects(owner: string): Promise<Array<Fields & { _id: string }>> {
  const ev = await readClient.queryEvents({
    query: { MoveEventType: PARLAY_OPENED_EVENT },
    limit: 200,
    order: 'descending',
  });
  const ids = [...new Set(
    ev.data
      .map((e) => e.parsedJson as Record<string, unknown> | undefined)
      .filter((j) => j && String(j.owner) === owner)
      .map((j) => String(j!.parlay)),
  )];
  if (ids.length === 0) return [];
  const objs = await readClient.multiGetObjects({ ids, options: { showContent: true } });
  return objs
    .map((o) => {
      const f = fieldsOf(o.data?.content);
      return f ? { ...f, _id: o.data!.objectId } : null;
    })
    .filter(Boolean) as Array<Fields & { _id: string }>;
}

function decodeLeg(raw: unknown): ParlayLegState {
  const lf = (fieldsOf(raw) ?? (raw as Fields)) as Fields;
  return {
    oracleId: String(lf.oracle_id),
    expiry: BigInt(String(lf.expiry ?? 0)),
    strike: BigInt(String(lf.strike ?? 0)),
    isUp: Boolean(lf.is_up),
    status: decodeLegStatus(String(lf.status ?? 0)),
  };
}

function decodeParlay(f: Fields & { _id: string }): MyParlay {
  const legsRaw = Array.isArray(f.legs) ? (f.legs as unknown[]) : [];
  return {
    id: f._id,
    owner: String(f.owner),
    status: decodeParlayStatus(String(f.status ?? 0)),
    stake: Number(f.stake ?? 0) / DUSDC_MULTIPLIER,
    maxPayout: Number(f.max_payout ?? 0) / DUSDC_MULTIPLIER,
    combinedProbBps: Number(f.combined_prob_bps ?? 0),
    wonCount: Number(f.won_count ?? 0),
    lastExpiry: Number(f.last_expiry ?? 0),
    legs: legsRaw.map(decodeLeg),
  };
}

/**
 * The connected wallet's parlay tickets — the live "betting slip" feed. Polls
 * ParlayOpened events for this owner and reads each ticket's on-chain state so
 * legs flip won/lost and the whole slip resolves in near-real-time. Sorted newest
 * first; live tickets above settled ones.
 */
export function useMyParlays(pollMs = 8_000) {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const [parlays, setParlays] = useState<MyParlay[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) { setParlays([]); return; }
    try {
      const rows = await myParlayObjects(address);
      const ps = rows.map(decodeParlay);
      // live first, then by most-recent expiry
      ps.sort((a, b) => {
        const rank = (s: string) => (s === 'live' ? 0 : 1);
        return rank(a.status) - rank(b.status) || b.lastExpiry - a.lastExpiry;
      });
      setParlays(ps);
    } catch { /* ignore transient read errors */ }
  }, [address]);

  useEffect(() => {
    let alive = true;
    (async () => { setLoading(true); await refresh(); if (alive) setLoading(false); })();
    const t = setInterval(refresh, pollMs);
    return () => { alive = false; clearInterval(t); };
  }, [refresh, pollMs]);

  return { parlays, refresh, loading, address };
}
