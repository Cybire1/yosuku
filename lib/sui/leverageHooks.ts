'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSuiClient, useCurrentAccount } from '@mysten/dapp-kit';
import { LENDING_POOL_ID, DUSDC_MULTIPLIER } from './constants';
import {
  computePoolStats,
  supplyPositionValue,
  SUPPLY_POSITION_TYPE,
  LOAN_TYPE,
  type PoolStats,
  type LoanData,
} from './leverageClient';

const RAY = 1_000_000_000_000; // 1e12 (mirrors lending_pool.move)
type Fields = Record<string, unknown>;
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

/** The connected wallet's open Loan objects (leveraged positions), with live debt. */
export function useMyLoans(stats: PoolStats | null, pollMs = 15_000) {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const [loans, setLoans] = useState<LoanData[]>([]);
  const refresh = useCallback(async () => {
    if (!address) { setLoans([]); return; }
    try {
      const res = await client.getOwnedObjects({
        owner: address,
        filter: { StructType: LOAN_TYPE },
        options: { showContent: true },
      });
      const ls = res.data
        .map((d): LoanData | null => {
          const f = fieldsOf(d.data?.content);
          if (!f || !d.data?.objectId) return null;
          const margin = Number(f.margin) / DUSDC_MULTIPLIER;
          const notional = Number(f.notional) / DUSDC_MULTIPLIER;
          const debt = stats ? (Number(f.principal_scaled) * stats.borrowIndex) / RAY / DUSDC_MULTIPLIER : 0;
          return {
            id: d.data.objectId,
            owner: String(f.owner),
            margin,
            borrowed: Number(f.borrowed) / DUSDC_MULTIPLIER,
            notional,
            debt,
            leverage: margin > 0 ? notional / margin : 0,
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
        .filter((l): l is LoanData => l !== null);
      setLoans(ls);
    } catch { /* ignore */ }
  }, [client, address, stats]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);
  return { loans, refresh, address };
}
