'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { BTC_PREDICTION_PROGRAM, fetchMapping, type RoundState } from '@/lib/predictionContract';
import { fetchRound, loadPositions } from '@/lib/roundHelpers';
import type { UserPosition } from '@/lib/predictionContract';

const LAST_ROUND_KEY = 'dart_last_round_id';

/** Check if a round exists on-chain (single lightweight call) */
async function roundExists(id: number): Promise<boolean> {
  const v = await fetchMapping(BTC_PREDICTION_PROGRAM, 'round_target_price', `${id}u64`);
  return !!v && v !== 'null';
}

/** Find the highest round ID starting from a hint. Checks 3 ahead, then returns highest found. */
async function findHighestFrom(hint: number): Promise<number> {
  // Check hint itself first
  if (hint > 0 && !(await roundExists(hint))) {
    // Hint is stale — go backwards to find a valid one
    for (let i = hint - 1; i >= Math.max(0, hint - 5); i--) {
      if (await roundExists(i)) { hint = i; break; }
    }
  }

  // Scan forward from hint (batch check 3 at once)
  const checks = await Promise.all([
    roundExists(hint + 1),
    roundExists(hint + 2),
    roundExists(hint + 3),
  ]);

  let highest = hint;
  for (let i = 0; i < checks.length; i++) {
    if (checks[i]) highest = hint + 1 + i;
    else break;
  }
  return highest;
}

/** Binary search for the latest round — only used on very first visit */
async function binarySearchHighest(): Promise<number> {
  let lo = 0, hi = 500;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (await roundExists(mid)) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export function useRounds() {
  const [activeRound, setActiveRound] = useState<RoundState | null>(null);
  const [pastRounds, setPastRounds] = useState<RoundState[]>([]);
  const [positions, setPositions] = useState<UserPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const activeRoundRef = useRef<RoundState | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    // Step 1: Find highest round ID (fast if we have a cached hint)
    let highestId: number;
    if (lastKnown > 0) {
      highestId = await findHighestFrom(lastKnown);
    } else {
      highestId = await binarySearchHighest();
    }

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
      const current = activeRoundRef.current;

      if (current) {
        const updated = await fetchRound(current.id);
        if (!updated) return;

        if (updated.resolved && !current.resolved) {
          // Round just resolved — move to past
          setPastRounds(prev => [updated, ...prev].slice(0, 20));
          setPositions(loadPositions());

          // Scan forward for next active round (parallel check)
          const nexts = await Promise.all([
            fetchRound(current.id + 1),
            fetchRound(current.id + 2),
          ]);

          for (const next of nexts) {
            if (next && !next.resolved) {
              localStorage.setItem(LAST_ROUND_KEY, String(next.id));
              setActiveRound(next);
              return;
            }
          }

          localStorage.setItem(LAST_ROUND_KEY, String(current.id));
          setActiveRound(null);
          return;
        }

        // Normal pool update — keep endTime stable
        setActiveRound(prev => prev ? { ...updated, endTime: prev.endTime } : updated);
      } else {
        // No active round — check for new ones (parallel)
        const lastKnown = parseInt(localStorage.getItem(LAST_ROUND_KEY) || '0', 10);
        const nexts = await Promise.all([
          fetchRound(lastKnown + 1),
          fetchRound(lastKnown + 2),
        ]);

        for (const next of nexts) {
          if (next && !next.resolved) {
            localStorage.setItem(LAST_ROUND_KEY, String(next.id));
            setActiveRound(next);
            return;
          }
        }
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
