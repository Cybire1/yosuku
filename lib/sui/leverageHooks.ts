'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSuiClient, useCurrentAccount } from '@mysten/dapp-kit';
import { LENDING_POOL_ID } from './constants';
import {
  computePoolStats,
  supplyPositionValue,
  SUPPLY_POSITION_TYPE,
  type PoolStats,
} from './leverageClient';

type Fields = Record<string, string>;
const fieldsOf = (content: unknown): Fields | null => {
  const c = content as { fields?: Fields } | null | undefined;
  return c?.fields ?? null;
};

/** Live lending-pool stats (TVL, utilization, APRs). */
export function usePoolStats(pollMs = 15_000) {
  const client = useSuiClient();
  const [stats, setStats] = useState<PoolStats | null>(null);
  const refresh = useCallback(async () => {
    try {
      const o = await client.getObject({ id: LENDING_POOL_ID, options: { showContent: true } });
      const f = fieldsOf(o.data?.content);
      if (f) setStats(computePoolStats(f as never));
    } catch { /* ignore */ }
  }, [client]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);
  return { stats, refresh };
}

export interface MySupply {
  id: string;
  shares: number;
  value: number; // DUSDC
}

/** The connected wallet's SupplyPosition objects, valued against `stats`. */
export function useMySupply(stats: PoolStats | null, pollMs = 15_000) {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const [positions, setPositions] = useState<MySupply[]>([]);
  const refresh = useCallback(async () => {
    if (!address) { setPositions([]); return; }
    try {
      const res = await client.getOwnedObjects({
        owner: address,
        filter: { StructType: SUPPLY_POSITION_TYPE },
        options: { showContent: true },
      });
      const ps = res.data
        .map((d) => {
          const f = fieldsOf(d.data?.content);
          const shares = Number(f?.shares ?? 0);
          return { id: d.data?.objectId ?? '', shares, value: stats ? supplyPositionValue(shares, stats) : 0 };
        })
        .filter((p) => p.id);
      setPositions(ps);
    } catch { /* ignore */ }
  }, [client, address, stats]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);
  return { positions, refresh, address };
}
