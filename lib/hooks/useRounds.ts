'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { BTC_PREDICTION_PROGRAM, fetchMapping, type RoundState } from '@/lib/predictionContract';
import { fetchRound, loadPositions } from '@/lib/roundHelpers';
import type { UserPosition } from '@/lib/predictionContract';

const LAST_ROUND_KEY = 'dart_last_round_id';

/** Check if a round exists on-chain (single lightweight call) */
async function roundExists(id: number): Promise<boolean> {
  const v = await fetchMapping(BTC_PREDICTION_PROGRAM, 'rt', `${id}u64`);
  return !!v && v !== 'null';
}

/** Binary search for the highest round ID, starting from a hint for speed.
 *  Tolerates gaps (e.g. round 3 missing but round 4 exists). */
async function findHighestRound(hint: number): Promise<number> {
  // Exponential probe forward from hint to find upper bound
  let lo = Math.max(0, hint);
  let hi = lo + 1;

  // Verify hint exists; if not, start from 0
  if (lo > 0 && !(await roundExists(lo))) lo = 0;

  while (await roundExists(hi)) {
    lo = hi;
    hi = Math.min(hi * 2, hi + 200); // don't jump too far
    if (hi > 10000) break;
  }

  // Binary search between lo and hi
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (await roundExists(mid)) lo = mid; else hi = mid - 1;
  }

  // Handle gaps: check a few IDs beyond the found highest in parallel
  const base = lo;
  const gapChecks = await Promise.all(
    [1, 2, 3, 4, 5].map(offset =>
      roundExists(base + offset).then(exists => ({ id: base + offset, exists }))
    )
  );
  for (const { id, exists } of gapChecks) {
    if (exists && id > lo) lo = id;
  }

  return (await roundExists(lo)) ? lo : 0;
}

export function useRounds() {
  const [activeRound, setActiveRound] = useState<RoundState | null>(null);
  const [pastRounds, setPastRounds] = useState<RoundState[]>([]);
  const [positions, setPositions] = useState<UserPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const activeRoundRef = useRef<RoundState | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollInFlightRef = useRef(false);

  // Keep ref in sync
  useEffect(() => {
    activeRoundRef.current = activeRound;
  }, [activeRound]);

  const reloadPositions = useCallback(() => {
    setPositions(loadPositions());
  }, []);

  // Fast initial load — find and display active round ASAP
  const initialLoad = useCallback(async () => {
    const lastKnown = parseInt(localStorage.getItem(LAST_ROUND_KEY) || '0', 10);

    // Step 1: Find highest round ID (exponential probe + binary search)
    const highestId = await findHighestRound(lastKnown);

    if (highestId > 0) {
      localStorage.setItem(LAST_ROUND_KEY, String(highestId));
    }

    // Step 2: Fetch just the highest round + one before it (2 calls, not 10)
    const [latest, prev] = await Promise.all([
      fetchRound(highestId),
      highestId > 0 ? fetchRound(highestId - 1) : Promise.resolve(null),
    ]);

    // Determine active round
    let active: RoundState | null = null;
    const resolved: RoundState[] = [];

    if (latest) {
      if (!latest.resolved) active = latest;
      else resolved.push(latest);
    }
    if (prev) {
      if (!prev.resolved && !active) active = prev;
      else if (prev.resolved) resolved.push(prev);
    }

    setActiveRound(active);
    setPastRounds(resolved);
    setPositions(loadPositions());
    setLoading(false);

    // Step 3: Load more history in background (non-blocking)
    if (highestId > 1) {
      const startId = Math.max(0, highestId - 9);
      const ids: number[] = [];
      for (let i = startId; i < highestId - 1; i++) ids.push(i);

      Promise.all(ids.map(id => fetchRound(id))).then(results => {
        const moreResolved: RoundState[] = [];
        for (const r of results) {
          if (r?.resolved) moreResolved.push(r);
        }
        if (moreResolved.length > 0) {
          setPastRounds(prev => {
            const all = [...prev, ...moreResolved];
            // Deduplicate by id and sort descending
            const map = new Map(all.map(r => [r.id, r]));
            return Array.from(map.values()).sort((a, b) => b.id - a.id).slice(0, 20);
          });
        }
      });
    }
  }, []);

  // Initial load
  useEffect(() => {
    initialLoad();
  }, [initialLoad]);

  // Single unified polling loop — always runs at 5s
  useEffect(() => {
    if (loading) return;

    const poll = async () => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;

      try {
        const current = activeRoundRef.current;

        if (current) {
          const updated = await fetchRound(current.id);
          if (!updated) return;
          if (activeRoundRef.current?.id !== current.id) return;

          if (updated.resolved && !current.resolved) {
            // Round just resolved — move to past
            setPastRounds(prev => {
              const merged = [updated, ...prev];
              const byId = new Map(merged.map(round => [round.id, round]));
              return Array.from(byId.values()).sort((a, b) => b.id - a.id).slice(0, 20);
            });
            setPositions(loadPositions());

            // Find the latest round (resolver may have jumped ahead)
            const newHighest = await findHighestRound(current.id);
            if (activeRoundRef.current?.id !== current.id) return;
            if (newHighest > current.id) {
              localStorage.setItem(LAST_ROUND_KEY, String(newHighest));
              const latest = await fetchRound(newHighest);
              if (activeRoundRef.current?.id !== current.id) return;
              if (latest && !latest.resolved) {
                setActiveRound(latest);
                return;
              }
            }

            localStorage.setItem(LAST_ROUND_KEY, String(newHighest || current.id));
            setActiveRound(prev => (prev?.id === current.id ? null : prev));
            return;
          }

          // Normal pool update — keep endTime stable
          setActiveRound(prev => {
            if (!prev || prev.id !== current.id) return prev;
            return { ...updated, endTime: prev.endTime };
          });
        } else {
          // No active round — search for latest
          const lastKnown = parseInt(localStorage.getItem(LAST_ROUND_KEY) || '0', 10);
          const newHighest = await findHighestRound(lastKnown);
          if (newHighest > lastKnown) {
            localStorage.setItem(LAST_ROUND_KEY, String(newHighest));
            const latest = await fetchRound(newHighest);
            if (latest && !latest.resolved) {
              setActiveRound(latest);
              return;
            }
          }
        }
      } finally {
        pollInFlightRef.current = false;
      }
    };

    poll();
    pollingRef.current = setInterval(poll, 5_000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [loading]);

  return {
    activeRound,
    pastRounds,
    positions,
    loading,
    reloadPositions,
    refetch: initialLoad,
    setActiveRound,
    setPastRounds,
  };
}
