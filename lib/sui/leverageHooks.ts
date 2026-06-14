'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSuiClient, useCurrentAccount } from '@mysten/dapp-kit';
import { RESERVE_ID, DUSDC_MULTIPLIER } from './constants';
import {
  computeReserveStats,
  supplyPositionValue,
  SUPPLY_POSITION_TYPE,
  ORDER_REQUESTED_EVENT,
  ORDER_FILLED_EVENT,
  type ReserveStats,
  type PositionData,
  type OrderData,
} from './leverageClient';

type Fields = Record<string, unknown>;
const fieldsOf = (content: unknown): Fields | null => {
  const c = content as { fields?: Fields } | null | undefined;
  return c?.fields ?? null;
};
type Sui = ReturnType<typeof useSuiClient>;

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

/** The connected wallet's SupplyPosition objects (owned), valued against `stats`. */
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

// collect ids from an event type's field where the event's `trader` is the wallet,
// then fetch the objects that still exist (live orders / positions).
async function liveByEvent(client: Sui, eventType: string, idField: string, trader: string): Promise<Fields[]> {
  const ev = await client.queryEvents({ query: { MoveEventType: eventType }, limit: 200, order: 'descending' });
  const ids = [...new Set(ev.data
    .map((e) => e.parsedJson as Record<string, unknown> | undefined)
    .filter((j) => j && String(j.trader) === trader)
    .map((j) => String(j![idField])))];
  if (ids.length === 0) return [];
  const objs = await client.multiGetObjects({ ids, options: { showContent: true } });
  return objs.map((o) => { const f = fieldsOf(o.data?.content); return f ? { ...f, _id: o.data!.objectId } : null; }).filter(Boolean) as Fields[];
}

/** The connected wallet's open underwritten Positions (shared objects, via events). */
export function useMyPositions(pollMs = 12_000) {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const [positions, setPositions] = useState<PositionData[]>([]);
  const refresh = useCallback(async () => {
    if (!address) { setPositions([]); return; }
    try {
      const rows = await liveByEvent(client, ORDER_FILLED_EVENT, 'position', address);
      const ls = rows.map((f): PositionData => {
        const margin = Number(f.margin) / DUSDC_MULTIPLIER;
        const fronted = Number(f.fronted) / DUSDC_MULTIPLIER;
        return {
          id: String(f._id),
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
      });
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

/** The connected wallet's pending (unfilled) OpenOrders — awaiting the keeper. */
export function useMyOrders(pollMs = 6_000) {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const [orders, setOrders] = useState<OrderData[]>([]);
  const refresh = useCallback(async () => {
    if (!address) { setOrders([]); return; }
    try {
      const rows = await liveByEvent(client, ORDER_REQUESTED_EVENT, 'order', address);
      setOrders(rows.map((f): OrderData => ({
        id: String(f._id),
        trader: String(f.trader),
        margin: Number(f.margin) / DUSDC_MULTIPLIER,
        leverage: Number(f.leverage_bps) / 10_000,
        oracleId: String(f.oracle_id),
        isRange: Boolean(f.is_range),
      })));
    } catch { /* ignore */ }
  }, [client, address]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);
  return { orders, refresh, address };
}
