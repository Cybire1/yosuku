'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';

/** Polling that pauses when the tab is hidden and resumes when visible */
function useVisibilityAwareInterval(callback: () => void, intervalMs: number) {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (id) return;
      id = setInterval(() => savedCallback.current(), intervalMs);
    };
    const stop = () => {
      if (id) { clearInterval(id); id = null; }
    };

    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        savedCallback.current(); // refresh immediately on return
        start();
      }
    };

    // initial fetch + start
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);
}
import {
  fetchOracles,
  fetchManagerForAddress,
  fetchManagers,
  fetchLatestPrices,
  fetchLatestSvi,
  fetchManagerPositions,
  fetchPriceHistory,
  fetchTrades,
  fetchStatus,
  fetchVaultSummary,
  fetchVaultPerformance,
  fetchOracleState,
  fetchManagerSummary,
  fetchManagerPnL,
  type OracleData,
  type ManagerData,
  type PriceData,
  type SviData,
  type PositionData,
  type StatusData,
  type VaultSummaryData,
  type VaultPerformanceData,
  type OracleStateData,
  type ManagerSummaryData,
  type ManagerPnLData,
} from './predictApi';
import { DUSDC_TYPE, PLP_TYPE, PREDICT_ID, FLOAT_SCALING, NEG_INF, POS_INF } from './constants';

/** Hook: connected wallet address */
export function useWalletAddress(): string | null {
  const account = useCurrentAccount();
  return account?.address ?? null;
}

/** Hook: all oracles with polling */
export function useOracles(pollInterval = 30_000) {
  const [oracles, setOracles] = useState<OracleData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const all = await fetchOracles();
      setOracles(all);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch oracles:', err);
      setError('Failed to load markets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useVisibilityAwareInterval(refresh, pollInterval);

  const active = oracles.filter(o => o.status === 'active');
  const settled = oracles.filter(o => o.status === 'settled');
  const pendingSettlement = oracles.filter(o => o.status === 'pending_settlement');

  return { oracles, active, settled, pendingSettlement, loading, error, refresh };
}

/** Hook: find PredictManager for connected wallet */
export function useManager() {
  const address = useWalletAddress();
  const [manager, setManager] = useState<ManagerData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!address) {
      setManager(null);
      setLoading(false);
      return;
    }
    try {
      const m = await fetchManagerForAddress(address);
      setManager(m);
    } catch (err) {
      console.error('Failed to fetch manager:', err);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { manager, loading, refresh };
}

/** Hook: DUSDC balance in wallet */
export function useDUSDCBalance(pollInterval = 30_000) {
  const address = useWalletAddress();
  const client = useSuiClient();
  const [balance, setBalance] = useState(0);
  const [coins, setCoins] = useState<{ coinObjectId: string; balance: bigint }[]>([]);

  const refresh = useCallback(async () => {
    if (!address) {
      setBalance(0);
      setCoins([]);
      return;
    }
    try {
      const [bal, coinList] = await Promise.all([
        client.getBalance({ owner: address, coinType: DUSDC_TYPE }),
        client.getCoins({ owner: address, coinType: DUSDC_TYPE }),
      ]);
      setBalance(Number(bal.totalBalance));
      setCoins(coinList.data.map(c => ({
        coinObjectId: c.coinObjectId,
        balance: BigInt(c.balance),
      })));
    } catch (err) {
      console.error('Failed to fetch DUSDC balance:', err);
    }
  }, [address, client]);

  useEffect(() => { refresh(); }, [refresh]);
  useVisibilityAwareInterval(refresh, pollInterval);

  return { balance, coins, refresh };
}

/** Hook: PLP (LP token) balance with coin object IDs */
export function usePLPBalance(pollInterval = 60_000) {
  const address = useWalletAddress();
  const client = useSuiClient();
  const [balance, setBalance] = useState(0);
  const [coins, setCoins] = useState<{ coinObjectId: string; balance: bigint }[]>([]);

  const refresh = useCallback(async () => {
    if (!address) {
      setBalance(0);
      setCoins([]);
      return;
    }
    try {
      const [bal, coinList] = await Promise.all([
        client.getBalance({ owner: address, coinType: PLP_TYPE }),
        client.getCoins({ owner: address, coinType: PLP_TYPE }),
      ]);
      setBalance(Number(bal.totalBalance));
      setCoins(coinList.data.map(c => ({
        coinObjectId: c.coinObjectId,
        balance: BigInt(c.balance),
      })));
    } catch (err) {
      console.error('Failed to fetch PLP balance:', err);
    }
  }, [address, client]);

  useEffect(() => { refresh(); }, [refresh]);
  useVisibilityAwareInterval(refresh, pollInterval);

  return { balance, coins, refresh };
}

/** Hook: prices for a specific oracle */
export function useOraclePrices(oracleId: string | null, pollInterval = 15_000) {
  const [prices, setPrices] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!oracleId) {
      setPrices(null);
      setLoading(false);
      return;
    }
    try {
      const p = await fetchLatestPrices(oracleId);
      setPrices(p);
    } catch (err) {
      console.error('Failed to fetch prices:', err);
    } finally {
      setLoading(false);
    }
  }, [oracleId]);

  useEffect(() => { refresh(); }, [refresh]);
  useVisibilityAwareInterval(refresh, pollInterval);

  return { prices, loading, refresh };
}

/** Hook: positions for a manager */
export function usePositions(managerId: string | null, pollInterval = 30_000) {
  const [positions, setPositions] = useState<PositionData[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!managerId) {
      setPositions([]);
      setLoading(false);
      return;
    }
    try {
      const p = await fetchManagerPositions(managerId);
      setPositions(p);
    } catch (err) {
      console.error('Failed to fetch positions:', err);
    } finally {
      setLoading(false);
    }
  }, [managerId]);

  useEffect(() => { refresh(); }, [refresh]);
  useVisibilityAwareInterval(refresh, pollInterval);

  return { positions, loading, refresh };
}

/** Hook: manager's on-chain balance */
export function useManagerBalance(managerId: string | null) {
  const client = useSuiClient();
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!managerId) {
      setBalance(0);
      setLoading(false);
      return;
    }
    try {
      const obj = await client.getObject({
        id: managerId,
        options: { showContent: true },
      });
      if (obj.data?.content && obj.data.content.dataType === 'moveObject') {
        const fields = obj.data.content.fields as Record<string, unknown>;
        const bm = fields.balance_manager as Record<string, unknown> | undefined;
        const bf = bm?.fields as Record<string, unknown> | undefined;
        const qb = bf?.quote_balance as string | undefined;
        setBalance(qb ? Number(qb) : 0);
      }
    } catch (err) {
      console.error('Failed to fetch manager balance:', err);
    } finally {
      setLoading(false);
    }
  }, [managerId, client]);

  useEffect(() => { refresh(); }, [refresh]);
  useVisibilityAwareInterval(refresh, 30_000);

  return { balance, loading, refresh };
}

/** Hook: SVI pricing data for an oracle */
export function useSviPricing(oracleId: string | null, pollInterval = 30_000) {
  const [sviData, setSviData] = useState<SviData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!oracleId) {
      setSviData(null);
      setLoading(false);
      return;
    }
    try {
      const data = await fetchLatestSvi(oracleId);
      setSviData(data);
    } catch (err) {
      console.error('Failed to fetch SVI data:', err);
    } finally {
      setLoading(false);
    }
  }, [oracleId]);

  useEffect(() => { refresh(); }, [refresh]);
  useVisibilityAwareInterval(refresh, pollInterval);

  return { sviData, loading, refresh };
}

/** Vault stats from the PREDICT_ID shared object */
export interface VaultStats {
  balance: number;
  totalMtm: number;
  vaultValue: number;
  maxPayout: number;
  totalPlpSupply: number;
  availableForWithdraw: number;
  baseFee: number;
  minFee: number;
  utilizationMultiplier: number;
}

/** Hook: read vault stats from on-chain Predict object */
export function useVaultStats(pollInterval = 60_000) {
  const client = useSuiClient();
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const obj = await client.getObject({
        id: PREDICT_ID,
        options: { showContent: true },
      });
      if (obj.data?.content && obj.data.content.dataType === 'moveObject') {
        const fields = obj.data.content.fields as Record<string, unknown>;
        const vault = fields.vault as Record<string, unknown> | undefined;
        const vf = vault?.fields as Record<string, unknown> | undefined;
        const pricingConfig = fields.pricing_config as Record<string, unknown> | undefined;
        const pcf = pricingConfig?.fields as Record<string, unknown> | undefined;

        const balance = Number(vf?.balance ?? 0);
        const totalMtm = Number(vf?.total_mtm ?? 0);
        const maxPayout = Number(vf?.max_payout ?? 0);
        const totalPlpSupply = Number(vf?.total_plp_supply ?? 0);

        const baseFee = Number(pcf?.base_fee ?? 20_000_000);
        const minFee = Number(pcf?.min_fee ?? 5_000_000);
        const utilizationMultiplier = Number(pcf?.utilization_multiplier ?? 2_000_000_000);

        setStats({
          balance,
          totalMtm,
          vaultValue: balance - totalMtm,
          maxPayout,
          totalPlpSupply,
          availableForWithdraw: Math.max(0, balance - maxPayout),
          baseFee,
          minFee,
          utilizationMultiplier,
        });
      }
    } catch (err) {
      console.error('Failed to fetch vault stats:', err);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { refresh(); }, [refresh]);
  useVisibilityAwareInterval(refresh, pollInterval);

  return { stats, loading, refresh };
}

// ── Helper: determine position direction from strikes ────

export function getPositionDirection(
  lowerStrike: string,
  higherStrike: string,
): 'UP' | 'DOWN' | 'RANGE' {
  if (lowerStrike === NEG_INF || lowerStrike === '0') return 'DOWN';
  if (higherStrike === POS_INF || higherStrike === '18446744073709551615') return 'UP';
  return 'RANGE';
}

/** Get the strike price from a position's bounds */
export function getPositionStrike(
  lowerStrike: string,
  higherStrike: string,
): number {
  const direction = getPositionDirection(lowerStrike, higherStrike);
  if (direction === 'UP') return Number(lowerStrike);
  if (direction === 'DOWN') return Number(higherStrike);
  // RANGE: return lower bound
  return Number(lowerStrike);
}

// ── Protocol-wide aggregate stats ─────────────────────

export interface ProtocolStats {
  volumeSettled: number;
  marketsResolved: number;
  activeWallets: number;
}

/** Hook: aggregate protocol stats from real API data */
export function useProtocolStats(pollInterval = 120_000) {
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [oracles, managers] = await Promise.all([
        fetchOracles(),
        fetchManagers(),
      ]);

      const settled = oracles.filter(o => o.status === 'settled');
      const marketsResolved = settled.length;
      const activeWallets = managers.length;

      // Sum volume from trades on recent oracles (up to 5 most recent to reduce requests)
      const recentOracles = [...oracles]
        .sort((a, b) => (b.settled_at ?? b.expiry) - (a.settled_at ?? a.expiry))
        .slice(0, 5);

      let volumeSettled = 0;
      const tradeResults = await Promise.allSettled(
        recentOracles.map(o => fetchTrades(o.oracle_id))
      );
      for (const r of tradeResults) {
        if (r.status === 'fulfilled') {
          for (const t of r.value) {
            volumeSettled += Math.abs(Number(t.quantity));
          }
        }
      }
      // Convert from raw units (DUSDC has 6 decimals)
      volumeSettled = volumeSettled / 1_000_000;

      setStats({ volumeSettled, marketsResolved, activeWallets });
    } catch (err) {
      console.error('Failed to fetch protocol stats:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useVisibilityAwareInterval(refresh, pollInterval);

  return { stats, loading, refresh };
}

// ── Price history with polling ────────────────────────

/** Hook: price history for an oracle with polling */
export function usePriceHistory(oracleId: string | null, limit = 100, pollInterval = 60_000) {
  const [history, setHistory] = useState<PriceData[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!oracleId) {
      setHistory([]);
      setLoading(false);
      return;
    }
    try {
      const data = await fetchPriceHistory(oracleId, limit);
      setHistory(data);
    } catch (err) {
      console.error('Failed to fetch price history:', err);
    } finally {
      setLoading(false);
    }
  }, [oracleId, limit]);

  useEffect(() => { refresh(); }, [refresh]);
  useVisibilityAwareInterval(refresh, pollInterval);

  return { history, loading, refresh };
}

// ── New API hooks ─────────────────────────────────────

/** Hook: API health status */
export function useApiStatus(pollInterval = 60_000) {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchStatus();
      setStatus(data);
    } catch (err) {
      console.error('Failed to fetch API status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useVisibilityAwareInterval(refresh, pollInterval);

  return { status, loading, refresh };
}

/** Hook: vault summary from API */
export function useVaultSummary(predictId: string | null, pollInterval = 60_000) {
  const [summary, setSummary] = useState<VaultSummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!predictId) {
      setSummary(null);
      setLoading(false);
      return;
    }
    try {
      const data = await fetchVaultSummary(predictId);
      setSummary(data);
    } catch (err) {
      console.error('Failed to fetch vault summary:', err);
    } finally {
      setLoading(false);
    }
  }, [predictId]);

  useEffect(() => { refresh(); }, [refresh]);
  useVisibilityAwareInterval(refresh, pollInterval);

  return { summary, loading, refresh };
}

/** Hook: vault performance (share price history) */
export function useVaultPerformance(predictId: string | null, pollInterval = 120_000) {
  const [performance, setPerformance] = useState<VaultPerformanceData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!predictId) {
      setPerformance(null);
      setLoading(false);
      return;
    }
    try {
      const data = await fetchVaultPerformance(predictId);
      setPerformance(data);
    } catch (err) {
      console.error('Failed to fetch vault performance:', err);
    } finally {
      setLoading(false);
    }
  }, [predictId]);

  useEffect(() => { refresh(); }, [refresh]);
  useVisibilityAwareInterval(refresh, pollInterval);

  return { performance, loading, refresh };
}

/** Hook: combined oracle state (oracle + price + SVI) */
export function useOracleState(oracleId: string | null, pollInterval = 15_000) {
  const [state, setState] = useState<OracleStateData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!oracleId) {
      setState(null);
      setLoading(false);
      return;
    }
    try {
      const data = await fetchOracleState(oracleId);
      setState(data);
    } catch (err) {
      console.error('Failed to fetch oracle state:', err);
    } finally {
      setLoading(false);
    }
  }, [oracleId]);

  useEffect(() => { refresh(); }, [refresh]);
  useVisibilityAwareInterval(refresh, pollInterval);

  return { state, loading, refresh };
}

/** Hook: manager summary (balance, P&L, positions) */
export function useManagerSummary(managerId: string | null, pollInterval = 30_000) {
  const [summary, setSummary] = useState<ManagerSummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!managerId) {
      setSummary(null);
      setLoading(false);
      return;
    }
    try {
      const data = await fetchManagerSummary(managerId);
      setSummary(data);
    } catch (err) {
      console.error('Failed to fetch manager summary:', err);
    } finally {
      setLoading(false);
    }
  }, [managerId]);

  useEffect(() => { refresh(); }, [refresh]);
  useVisibilityAwareInterval(refresh, pollInterval);

  return { summary, loading, refresh };
}

/** Hook: manager P&L time series */
export function useManagerPnL(managerId: string | null, pollInterval = 60_000) {
  const [pnlData, setPnlData] = useState<ManagerPnLData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!managerId) {
      setPnlData(null);
      setLoading(false);
      return;
    }
    try {
      const data = await fetchManagerPnL(managerId);
      setPnlData(data);
    } catch (err) {
      console.error('Failed to fetch manager P&L:', err);
    } finally {
      setLoading(false);
    }
  }, [managerId]);

  useEffect(() => { refresh(); }, [refresh]);
  useVisibilityAwareInterval(refresh, pollInterval);

  return { pnlData, loading, refresh };
}

// ── Leaderboard from API route ────────────────────────

export interface LeaderboardTrader {
  manager_id: string;
  owner: string;
  pnl: number;
  winRate: number;
  tradeCount: number;
  bestStreak: number;
  volume: number;
}

export interface LeaderboardRecord {
  label: string;
  badge: string;
  value: string;
  unit: string;
  desc: string;
  trader: string;
  date: string;
}

export interface LeaderboardData {
  rankings: LeaderboardTrader[];
  meta: { totalWallets: number; totalVolume: number };
  records: LeaderboardRecord[];
}

/** Hook: fetches leaderboard from server-side API route */
export function useLeaderboard(pollInterval = 120_000) {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/leaderboard');
      if (!res.ok) throw new Error(`Leaderboard API: ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error('Failed to fetch leaderboard:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useVisibilityAwareInterval(refresh, pollInterval);

  return { data, loading, refresh };
}
