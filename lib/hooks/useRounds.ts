'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { BTC_PREDICTION_PROGRAM, fetchMapping, type RoundState } from '@/lib/predictionContract';
import { fetchRound, loadPositions } from '@/lib/roundHelpers';
import type { UserPosition } from '@/lib/predictionContract';

const LAST_ROUND_KEY = 'dart_last_round_id';

export function useRounds() {
  const [activeRound, setActiveRound] = useState<RoundState | null>(null);
  const [pastRounds, setPastRounds] = useState<RoundState[]>([]);
  const [positions, setPositions] = useState<UserPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const prevActiveId = useRef<number | null>(null);

  const reloadPositions = useCallback(() => {
    setPositions(loadPositions());
  }, []);

  const scanForRounds = useCallback(async () => {
    // Try progressive scan from last known ID
    const lastKnown = parseInt(localStorage.getItem(LAST_ROUND_KEY) || '0', 10);
    let highestId = lastKnown;

    if (lastKnown > 0) {
      // Scan forward from last known
      let id = lastKnown;
      while (true) {
        const exists = await fetchMapping(BTC_PREDICTION_PROGRAM, 'round_target_price', `${id + 1}u64`);
        if (exists && exists !== 'null') {
          id++;
        } else {
          break;
        }
      }
      highestId = id;
    } else {
      // First-ever load: binary search
      let lo = 0, hi = 500;
      while (lo < hi) {
        const mid = Math.floor((lo + hi + 1) / 2);
        const exists = await fetchMapping(BTC_PREDICTION_PROGRAM, 'round_target_price', `${mid}u64`);
        if (exists && exists !== 'null') lo = mid; else hi = mid - 1;
      }
      highestId = lo;
    }

    // Cache highest known
    if (highestId > 0) {
      localStorage.setItem(LAST_ROUND_KEY, String(highestId));
    }

    // Fetch last ~10 rounds
    const startId = Math.max(0, highestId - 9);
    const ids = Array.from({ length: highestId - startId + 1 }, (_, i) => startId + i);
    const results = await Promise.all(ids.map(id => fetchRound(id)));

    const resolved: RoundState[] = [];
    let latestActive: RoundState | null = null;

    for (const round of results) {
      if (!round) continue;
      if (round.resolved) {
        resolved.push(round);
      } else if (!latestActive || round.id > latestActive.id) {
        latestActive = round;
      }
    }

    prevActiveId.current = latestActive?.id ?? null;
    setActiveRound(latestActive);
    setPastRounds(resolved.reverse().slice(0, 20));
    setPositions(loadPositions());
    setLoading(false);
  }, []);

  // Initial scan
  useEffect(() => {
    scanForRounds();
  }, [scanForRounds]);

  // Poll active round — faster when expired, normal when live
  useEffect(() => {
    if (!activeRound) return;

    const poll = async () => {
      const updated = await fetchRound(activeRound.id);
      if (!updated) return;

      if (updated.resolved && !activeRound.resolved) {
        // Round just resolved — move to past, look for next
        setPastRounds(prev => [updated, ...prev].slice(0, 20));

        const nextId = activeRound.id + 1;
        const next = await fetchRound(nextId);
        if (next && !next.resolved) {
          localStorage.setItem(LAST_ROUND_KEY, String(next.id));
          setActiveRound(next);
          prevActiveId.current = next.id;
        } else {
          setActiveRound(null);
          prevActiveId.current = null;
        }

        setPositions(loadPositions());
        return;
      }

      // Normal pool update — keep endTime stable
      setActiveRound(prev => prev ? { ...updated, endTime: prev.endTime } : updated);
    };

    // Poll every 5s when timer expired (waiting for on-chain resolution), 10s otherwise
    const isExpired = Date.now() > activeRound.endTime;
    const interval = setInterval(poll, isExpired ? 5_000 : 10_000);
    return () => clearInterval(interval);
  }, [activeRound?.id, activeRound?.resolved, activeRound && Date.now() > activeRound.endTime]);

  // If no active round, aggressively check for new ones (every 5s)
  useEffect(() => {
    if (activeRound || loading) return;

    const check = async () => {
      const lastKnown = parseInt(localStorage.getItem(LAST_ROUND_KEY) || '0', 10);
      const next = await fetchRound(lastKnown + 1);
      if (next && !next.resolved) {
        localStorage.setItem(LAST_ROUND_KEY, String(next.id));
        setActiveRound(next);
        prevActiveId.current = next.id;
      }
    };

    // Check immediately, then every 5s
    check();
    const interval = setInterval(check, 5_000);
    return () => clearInterval(interval);
  }, [activeRound, loading]);

  return {
    activeRound,
    pastRounds,
    positions,
    loading,
    reloadPositions,
    refetch: scanForRounds,
    setActiveRound,
    setPastRounds,
  };
}
