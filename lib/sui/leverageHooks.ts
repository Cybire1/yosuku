'use client';

import { useState, useEffect, useCallback } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { readClient } from './modernClients';
import { RESERVE_ID, DUSDC_MULTIPLIER, TRADING_VAULT_PACKAGE } from './constants';
import { loadLocalLeverageOrders } from '../leverageLocal';
import { fetchOnChainQuote, fetchOnChainRangeQuote } from './onchainQuote';
import {
  computeLeverageHealth,
  computeReserveStats,
  supplyPositionValue,
  unknownLeverageHealth,
  SUPPLY_POSITION_TYPE,
  type ReserveStats,
  type LeverageHealth,
  type PositionData,
  type OrderData,
} from './leverageClient';

type Fields = Record<string, unknown>;
const fieldsOf = (content: unknown): Fields | null => {
  const c = content as { fields?: Fields } | null | undefined;
  return c?.fields ?? null;
};

// The live web-leverage desk (trading_vault → margin) emits these. OpenOrder filtered by
// `trader`; the filled MarginPosition (shared) by `owner`. Fields: margin/borrowed/notional.
const MARGIN_ORDER_REQUESTED = `${TRADING_VAULT_PACKAGE}::margin::OrderRequested`;
const MARGIN_POSITION_OPENED = `${TRADING_VAULT_PACKAGE}::margin::PositionOpened`;

/** Live underwriting-reserve stats (TVL, utilization, premium, exposure). */
export function useReserveStats(pollMs = 15_000) {
  const [stats, setStats] = useState<ReserveStats | null>(null);
  const refresh = useCallback(async () => {
    try {
      const o = await readClient.getObject({ id: RESERVE_ID, options: { showContent: true } });
      const f = fieldsOf(o.data?.content);
      if (f) setStats(computeReserveStats(f as never));
    } catch { /* ignore */ }
  }, []);
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
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const [positions, setPositions] = useState<MySupply[]>([]);
  const refresh = useCallback(async () => {
    if (!address) { setPositions([]); return; }
    try {
      const res = await readClient.getOwnedObjects({
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
  }, [address, stats]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);
  return { positions, refresh, address };
}

// collect ids from an event type's field where the event's `trader` is the wallet,
// then fetch the objects that still exist (live orders / positions).
async function liveByEvent(eventType: string, idField: string, owner: string, ownerField = 'trader'): Promise<Fields[]> {
  const ev = await readClient.queryEvents({ query: { MoveEventType: eventType }, limit: 1000, order: 'descending' });
  const ids = [...new Set(ev.data
    .map((e) => e.parsedJson as Record<string, unknown> | undefined)
    .filter((j) => j && String(j[ownerField]).toLowerCase() === owner.toLowerCase())
    .map((j) => String(j![idField])))];
  if (ids.length === 0) return [];
  const objs = await readClient.multiGetObjects({ ids, options: { showContent: true } });
  return objs.map((o) => { const f = fieldsOf(o.data?.content); return f ? { ...f, _id: o.data!.objectId } : null; }).filter(Boolean) as Fields[];
}

// Fill detection via EVENT HISTORY (not live objects): a position that was filled and has
// since settled/liquidated leaves no live object, but the PositionOpened event persists — so
// an order is "filled" (not stuck) if a matching fill event ever fired for this owner.
async function filledEventsByOwner(owner: string): Promise<{ margin: number; leverage: number; ts: number }[]> {
  const ev = await readClient.queryEvents({ query: { MoveEventType: MARGIN_POSITION_OPENED }, limit: 1000, order: 'descending' });
  return ev.data
    .filter((e) => { const j = e.parsedJson as Record<string, unknown> | undefined; return !!j && String(j.owner).toLowerCase() === owner.toLowerCase(); })
    .map((e) => {
      const j = e.parsedJson as Record<string, unknown>;
      const margin = Number(j.margin) / DUSDC_MULTIPLIER;
      const borrowed = Number(j.borrowed) / DUSDC_MULTIPLIER;
      return { margin, leverage: margin > 0 ? (margin + borrowed) / margin : 0, ts: Number((e as { timestampMs?: string | number | null }).timestampMs ?? 0) };
    });
}

/** The connected wallet's open underwritten Positions (shared objects, via events). */
export function useMyPositions(pollMs = 12_000) {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const [positions, setPositions] = useState<PositionData[]>([]);
  const refresh = useCallback(async () => {
    if (!address) { setPositions([]); return; }
    try {
      const rows = await liveByEvent(MARGIN_POSITION_OPENED, 'position', address, 'owner');
      const ls = rows.map((f): PositionData => {
        const margin = Number(f.margin) / DUSDC_MULTIPLIER;
        const fronted = Number(f.borrowed) / DUSDC_MULTIPLIER;
        return {
          id: String(f._id),
          owner: String(f.owner),
          margin,
          fronted,
          premium: 0,
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
  }, [address]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);
  return { positions, refresh, address };
}

/** The connected wallet's pending (unfilled) OpenOrders — awaiting the keeper. */
export function useMyOrders(pollMs = 6_000) {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const [orders, setOrders] = useState<OrderData[]>([]);
  const refresh = useCallback(async () => {
    if (!address) { setOrders([]); return; }
    try {
      const [rows, filledEvents] = await Promise.all([
        liveByEvent(MARGIN_ORDER_REQUESTED, 'order', address, 'trader'),
        filledEventsByOwner(address),
      ]);
      const chainOrders = rows.map((f): OrderData => ({
        id: String(f._id),
        trader: String(f.trader),
        margin: Number(f.margin) / DUSDC_MULTIPLIER,
        leverage: Number(f.leverage_bps) / 10_000,
        oracleId: String(f.oracle_id),
        isRange: Boolean(f.is_range),
        isUp: Boolean(f.is_up),
        lowerStrike: BigInt(String(f.lower_strike ?? 0)),
        higherStrike: BigInt(String(f.higher_strike ?? 0)),
        expiry: BigInt(String(f.expiry ?? 0)),
        createdAt: Number(f.created_ms ?? 0),
        source: 'chain',
      }));
      const localOrders = loadLocalLeverageOrders(address).map((o): OrderData => ({
        id: o.id,
        trader: o.trader,
        margin: o.margin,
        leverage: o.leverage,
        oracleId: o.oracleId,
        isRange: o.isRange,
        isUp: o.isUp,
        lowerStrike: BigInt(o.lowerStrike),
        higherStrike: BigInt(o.higherStrike),
        expiry: BigInt(o.expiry),
        createdAt: o.createdAt,
        txDigest: o.txDigest,
        source: 'local',
      }));
      const chainMatchesLocal = (local: OrderData) => chainOrders.some((order) =>
        order.oracleId === local.oracleId &&
        order.isRange === local.isRange &&
        order.isUp === local.isUp &&
        Math.abs(order.margin - local.margin) < 0.000001 &&
        Math.abs(order.leverage - local.leverage) < 0.000001 &&
        (!order.createdAt || !local.createdAt || Math.abs(order.createdAt - local.createdAt) < 180_000)
      );
      // filled if a PositionOpened event for this owner matches margin+leverage near the open time
      // (the event lacks oracle/strike, so match on amount+leverage+recency — robust for the common case)
      const filledMatchesLocal = (local: OrderData) => filledEvents.some((p) =>
        Math.abs(p.margin - local.margin) < 0.000001 &&
        Math.abs(p.leverage - local.leverage) < 0.000001 &&
        (!local.createdAt || !p.ts || Math.abs(p.ts - local.createdAt) < 600_000)
      );
      setOrders([
        ...chainOrders,
        ...localOrders.filter((order) => !chainMatchesLocal(order) && !filledMatchesLocal(order)),
      ]);
    } catch {
      setOrders(loadLocalLeverageOrders(address).map((o): OrderData => ({
        id: o.id,
        trader: o.trader,
        margin: o.margin,
        leverage: o.leverage,
        oracleId: o.oracleId,
        isRange: o.isRange,
        isUp: o.isUp,
        lowerStrike: BigInt(o.lowerStrike),
        higherStrike: BigInt(o.higherStrike),
        expiry: BigInt(o.expiry),
        createdAt: o.createdAt,
        txDigest: o.txDigest,
        source: 'local',
      })));
    }
  }, [address]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);
  return { orders, refresh, address };
}

/** Live health for filled leverage positions, priced by the protocol redeem quote. */
export function useLeverageHealth(positions: PositionData[], pollMs = 12_000) {
  const [healthByPosition, setHealthByPosition] = useState<Record<string, LeverageHealth>>({});

  const refresh = useCallback(async () => {
    if (positions.length === 0) {
      setHealthByPosition({});
      return;
    }

    const entries = await Promise.all(positions.map(async (position) => {
      try {
        const quote = position.isRange
          ? await fetchOnChainRangeQuote({
            oracleId: position.oracleId,
            expiry: position.expiry,
            lower: position.lowerStrike,
            higher: position.higherStrike,
            quantity: position.quantity,
          })
          : await fetchOnChainQuote({
            oracleId: position.oracleId,
            expiry: position.expiry,
            strike: position.lowerStrike,
            isUp: position.isUp,
            quantity: position.quantity,
          });
        return [position.id, computeLeverageHealth(position, quote.redeemPayout)] as const;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return [position.id, unknownLeverageHealth(position, message)] as const;
      }
    }));

    setHealthByPosition(Object.fromEntries(entries));
  }, [positions]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  return { healthByPosition, refresh };
}
