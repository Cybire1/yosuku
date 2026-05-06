'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchOracles, type OracleData } from '@/lib/sui/predictApi';

/**
 * Hook to poll oracle markets from the DeepBook Predict server.
 * Returns active/settled oracles sorted by expiry.
 */
export function useRounds() {
  const [allOracles, setAllOracles] = useState<OracleData[]>([]);
  const [loading, setLoading] = useState(true);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadOracles = useCallback(async () => {
    try {
      const oracles = await fetchOracles();
      setAllOracles(oracles);
    } catch (err) {
      console.error('Failed to load oracles:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOracles();
  }, [loadOracles]);

  useEffect(() => {
    if (loading) return;
    pollingRef.current = setInterval(loadOracles, 15_000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [loading, loadOracles]);

  const active = allOracles
    .filter(o => o.status === 'active')
    .sort((a, b) => a.expiry - b.expiry);

  const settled = allOracles
    .filter(o => o.status === 'settled')
    .sort((a, b) => (b.settled_at || b.expiry) - (a.settled_at || a.expiry))
    .slice(0, 50);

  return {
    allOracles,
    active,
    settled,
    loading,
    refetch: loadOracles,
  };
}
