'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSuiClient, useCurrentAccount } from '@mysten/dapp-kit';
import { RESERVE_ID, DUSDC_MULTIPLIER } from './constants';
import {
  computeReserveStats,
  supplyPositionValue,
  SUPPLY_POSITION_TYPE,
  POSITION_TYPE,
  type ReserveStats,
  type PositionData,
} from './leverageClient';

type Fields = Record<string, unknown>;
const fieldsOf = (content: unknown): Fields | null => {
  const c = content as { fields?: Fields } | null | undefined;
  return c?.fields ?? null;
};

/** Live underwriting-reserve stats (TVL, utilization, premium, exposure). */
export function useReserveStats(pollMs = 15_000) {
  const client = useSuiClient();
  const [stats, setStats] = useState<ReserveStats | null>(null);
  const refresh = useCallback(async () => {
    try {
      const o = await client.getObject({ id: RESERVE_ID, options: { showContent: true } });
      const f = fieldsOf(o.data?.content);
      if (f) setStats(computeReserveStats(f as never));
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
export function useMySupply(stats: ReserveStats | null, pollMs = 15_000) {
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

/** The connected wallet's open underwritten Positions (leveraged trades). */
export function useMyPositions(pollMs = 15_000) {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const [positions, setPositions] = useState<PositionData[]>([]);
  const refresh = useCallback(async () => {
    if (!address) { setPositions([]); return; }
    try {
      const res = await client.getOwnedObjects({
        owner: address,
        filter: { StructType: POSITION_TYPE },
        options: { showContent: true },
      });
      const ls = res.data
        .map((d): PositionData | null => {
          const f = fieldsOf(d.data?.content);
          if (!f || !d.data?.objectId) return null;
          const margin = Number(f.margin) / DUSDC_MULTIPLIER;
          const fronted = Number(f.fronted) / DUSDC_MULTIPLIER;
          return {
            id: d.data.objectId,
            owner: String(f.owner),
            margin,
            fronted,
            premium: Number(f.premium) / DUSDC_MULTIPLIER,
            notional: Number(f.notional) / DUSDC_MULTIPLIER,
            leverage: margin > 0 ? (margin + fronted) / margin : 0,
            managerId: String(f.manager_id),
            oracleId: String(f.oracle_id),
            expiry: BigInt(String(f.expiry)),
            isRange: Boolean(f.is_range),
            lowerStrike: BigInt(String(f.lower_strike)),
            higherStrike: BigInt(String(f.higher_strike)),
            isUp: Boolean(f.is_up),
            quantity: BigInt(String(f.quantity)),
          };
        })
        .filter((l): l is PositionData => l !== null);
      setPositions(ls);
    } catch { /* ignore */ }
  }, [client, address]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);
  return { positions, refresh, address };
}
