// REST client for DeepBook Predict server
// All read queries go through this — writes go through PTBs via dapp-kit
import { RawOracleSchema, RawPriceSchema, RawPositionSchema, TradeSchema, parseList, parseOne } from './schemas';

// Use local proxy to avoid CORS issues with the predict server.
// Next.js rewrites /api/predict/* → predict-server.testnet.mystenlabs.com/*
const PREDICT_BASE = typeof window !== 'undefined' ? '/api/predict' : 'https://predict-server.testnet.mystenlabs.com';

// ── Types ────────────────────────────────────────────────

export interface OracleData {
  predict_id: string;
  oracle_id: string;
  oracle_cap_id: string;
  underlying_asset: string;
  expiry: number;
  min_strike: number;
  tick_size: number;
  status: 'active' | 'settled' | 'inactive' | 'pending_settlement';
  activated_at: number;
  settlement_price: number | null;
  settled_at: number | null;
  created_checkpoint: number;
}

export interface ManagerData {
  manager_id: string;
  owner: string;
  package: string;
  checkpoint: number;
}

export interface PriceData {
  oracle_id: string;
  spot: number;
  forward: number;
  timestamp: number;
}

export interface SviParams {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
}

export interface SviData {
  oracle_id: string;
  params: SviParams;
  timestamp: number;
}

/** Raw SVI response shape from API (flat fields, separate sign booleans) */
interface RawSviResponse {
  oracle_id: string;
  a: number;
  b: number;
  rho: number;
  rho_negative?: boolean;
  m: number;
  m_negative?: boolean;
  sigma: number;
  onchain_timestamp: number;
  [key: string]: unknown;
}

/** Transform raw API SVI response into our SviData shape */
function transformSvi(raw: RawSviResponse): SviData {
  return {
    oracle_id: raw.oracle_id,
    params: {
      a: raw.a,
      b: raw.b,
      rho: raw.rho_negative ? -raw.rho : raw.rho,
      m: raw.m_negative ? -raw.m : raw.m,
      sigma: raw.sigma,
    },
    timestamp: raw.onchain_timestamp,
  };
}

export interface PositionData {
  oracle_id: string;
  expiry: number;
  lower_strike: string;
  higher_strike: string;
  quantity: string;
  entry_price?: number;
}

export interface MintedPosition {
  oracle_id: string;
  manager_id: string;
  strike: number;
  is_up: boolean;
  quantity: number;
  cost: number;
  ask_price: number;
  checkpoint_timestamp_ms: number;
}

export interface TradeData {
  type: 'mint' | 'redeem';
  oracle_id: string;
  manager_id: string;
  strike: number;
  is_up: boolean;
  quantity: number;
  cost?: number;
  ask_price?: number;
  payout?: number;
  bid_price?: number;
  checkpoint_timestamp_ms: number;
}

export interface PredictConfig {
  fee_bps: number;
  min_quantity: number;
  max_quantity: number;
}

// ── API Functions ────────────────────────────────────────

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${PREDICT_BASE}${path}`);
  if (!res.ok) throw new Error(`Predict API ${path}: ${res.status} ${res.statusText}`);
  return res.json();
}

/** Run async functions in batches to avoid exhausting browser connections */
export async function settledInBatches<T>(
  fns: (() => Promise<T>)[],
  batchSize = 5,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  for (let i = 0; i < fns.length; i += batchSize) {
    const batch = fns.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(fn => fn()));
    results.push(...batchResults);
  }
  return results;
}

/** List all oracles — uses cached server route on client to avoid proxying 1MB+ */
export async function fetchOracles(): Promise<OracleData[]> {
  if (typeof window !== 'undefined') {
    // Client: use server-side cached route (returns only active + recent settled)
    const res = await fetch('/api/oracles');
    if (!res.ok) throw new Error(`Oracles API: ${res.status}`);
    return parseList(RawOracleSchema, await res.json(), 'oracles') as OracleData[];
  }
  // Server: fetch directly
  return parseList(RawOracleSchema, await fetchJson<unknown>('/oracles'), 'oracles') as OracleData[];
}

/** List active oracles only */
export async function fetchActiveOracles(): Promise<OracleData[]> {
  const all = await fetchOracles();
  return all.filter(o => o.status === 'active');
}

/** Raw price from API uses onchain_timestamp */
interface RawPriceResponse {
  oracle_id: string;
  spot: number;
  forward: number;
  onchain_timestamp: number;
  [key: string]: unknown;
}

function transformPrice(raw: RawPriceResponse): PriceData {
  return {
    oracle_id: raw.oracle_id,
    spot: raw.spot,
    forward: raw.forward,
    timestamp: raw.onchain_timestamp,
  };
}

/** Get latest prices for an oracle */
export async function fetchLatestPrices(oracleId: string): Promise<PriceData | null> {
  try {
    const raw = parseOne(RawPriceSchema, await fetchJson<unknown>(`/oracles/${oracleId}/prices/latest`), 'price');
    return raw ? transformPrice(raw as RawPriceResponse) : null;
  } catch {
    return null;
  }
}

/** Get price history for an oracle */
export async function fetchPriceHistory(oracleId: string, limit = 100): Promise<PriceData[]> {
  try {
    const raw = parseList(RawPriceSchema, await fetchJson<unknown>(`/oracles/${oracleId}/prices?limit=${limit}`), 'prices');
    return raw.map((p) => transformPrice(p as RawPriceResponse));
  } catch {
    return [];
  }
}

/** Get latest SVI parameters for an oracle */
export async function fetchLatestSvi(oracleId: string): Promise<SviData | null> {
  try {
    const raw = await fetchJson<RawSviResponse>(`/oracles/${oracleId}/svi/latest`);
    return transformSvi(raw);
  } catch {
    return null;
  }
}

/** Get protocol config */
export async function fetchConfig(): Promise<PredictConfig | null> {
  try {
    return await fetchJson<PredictConfig>('/config');
  } catch {
    return null;
  }
}

/** Get all managers (or filter by owner) */
export async function fetchManagers(owner?: string): Promise<ManagerData[]> {
  const path = owner ? `/managers?owner=${owner}` : '/managers';
  try {
    const data = await fetchJson<{ managers: ManagerData[] } | ManagerData[]>(path);
    return Array.isArray(data) ? data : (data.managers || []);
  } catch {
    return [];
  }
}

/** Get a manager for a specific address */
export async function fetchManagerForAddress(address: string): Promise<ManagerData | null> {
  const managers = await fetchManagers(address);
  return managers.find(m => m.owner === address) || null;
}

/** Raw position from API with strike/is_up format */
interface RawPosition {
  oracle_id: string;
  expiry: number;
  strike: number;
  is_up: boolean;
  quantity: number;
  cost?: number;
  ask_price?: number;
  payout?: number;
  bid_price?: number;
  [key: string]: unknown;
}

const NEG_INF_STR = '0';
const POS_INF_STR = '18446744073709551615';

/** Transform API position (strike/is_up) to PortfolioTable format (lower_strike/higher_strike) */
function transformPosition(raw: RawPosition): PositionData {
  return {
    oracle_id: raw.oracle_id,
    expiry: raw.expiry,
    lower_strike: raw.is_up ? String(raw.strike) : NEG_INF_STR,
    higher_strike: raw.is_up ? POS_INF_STR : String(raw.strike),
    quantity: String(raw.quantity),
    entry_price: raw.cost != null && raw.quantity > 0 ? raw.cost / raw.quantity : undefined,
  };
}

/** Get positions for a manager */
export async function fetchManagerPositions(managerId: string): Promise<PositionData[]> {
  try {
    const data = await fetchJson<{ minted?: unknown[]; redeemed?: unknown[] }>(`/managers/${managerId}/positions`);
    const minted = parseList(RawPositionSchema, data.minted ?? [], 'positions.minted').map((p) => transformPosition(p as RawPosition));
    const redeemed = parseList(RawPositionSchema, data.redeemed ?? [], 'positions.redeemed').map((p) => transformPosition(p as RawPosition));
    return [...minted, ...redeemed];
  } catch {
    return [];
  }
}

/** Get all minted positions for an oracle */
export async function fetchMintedPositions(oracleId: string): Promise<MintedPosition[]> {
  try {
    return await fetchJson<MintedPosition[]>(`/positions/minted?oracle_id=${oracleId}`);
  } catch {
    return [];
  }
}

/** Get trade history for an oracle */
export async function fetchTrades(oracleId: string): Promise<TradeData[]> {
  try {
    return parseList(TradeSchema, await fetchJson<unknown>(`/trades/${oracleId}`), 'trades') as TradeData[];
  } catch {
    return [];
  }
}

// ── New Types ────────────────────────────────────────────

export interface StatusPipeline {
  pipeline: string;
  checkpoint_hi_inclusive: number;
  timestamp_ms_hi_inclusive: number;
  checkpoint_lag: number;
  time_lag_ms: number;
  time_lag_seconds: number;
  is_backfill: boolean;
}

export interface StatusData {
  status: string;
  latest_onchain_checkpoint: number;
  current_time_ms: number;
  max_lag_pipeline: string;
  max_checkpoint_lag: number;
  max_time_lag_seconds: number;
  pipelines: StatusPipeline[];
}

export interface VaultSummaryData {
  predict_id: string;
  vault_balance: number;
  vault_value: number;
  total_mtm: number;
  total_max_payout: number;
  available_liquidity: number;
  available_withdrawal: number;
  plp_total_supply: number;
  plp_share_price: number;
  utilization: number;
  max_payout_utilization: number;
  net_deposits: number;
  total_supplied: number;
  total_withdrawn: number;
}

export interface VaultPerformancePoint {
  timestamp_ms: number;
  share_price: number;
  vault_value: number;
  total_shares: number;
}

export interface VaultPerformanceData {
  predict_id: string;
  range: string;
  points: VaultPerformancePoint[];
}

export interface OracleStateData {
  oracle: OracleData;
  latest_price: PriceData | null;
  latest_svi: SviData | null;
}

export interface ManagerSummaryData {
  manager_id: string;
  owner: string;
  trading_balance: number;
  open_exposure: number;
  redeemable_value: number;
  realized_pnl: number;
  unrealized_pnl: number;
  account_value: number;
  open_positions: number;
  awaiting_settlement_positions: number;
}

export interface ManagerPnLPoint {
  timestamp_ms: number;
  realized_pnl: number;
  cumulative_realized_pnl: number;
}

export interface ManagerPnLData {
  manager_id: string;
  range: string;
  points: ManagerPnLPoint[];
  current_unrealized_pnl: number;
  current_total_pnl: number;
}

export interface ManagerPositionSummary {
  oracle_id: string;
  underlying_asset: string;
  manager_id: string;
  strike: number;
  is_up: boolean;
  expiry: number;
  minted_quantity: number;
  redeemed_quantity: number;
  open_quantity: number;
  total_cost: number;
  total_payout: number;
  realized_pnl: number;
  unrealized_pnl: number;
  open_cost_basis: number;
  average_entry_price: number;
  average_exit_price: number | null;
  mark_price: number;
  mark_value: number;
  status: string;
  first_minted_at: number;
  last_activity_at: number;
}

export interface LpSupplyEvent {
  supplier: string;
  amount: number;
  shares_minted: number;
  checkpoint_timestamp_ms: number;
}

export interface LpWithdrawalEvent {
  withdrawer: string;
  amount: number;
  shares_burned: number;
  checkpoint_timestamp_ms: number;
}

export interface AllMintedPosition {
  oracle_id: string;
  manager_id: string;
  trader: string;
  strike: number;
  is_up: boolean;
  quantity: number;
  cost: number;
  ask_price: number;
  expiry: number;
  checkpoint_timestamp_ms: number;
}

export interface AllRedeemedPosition {
  oracle_id: string;
  manager_id: string;
  owner: string;
  strike: number;
  is_up: boolean;
  quantity: number;
  payout: number;
  bid_price: number;
  is_settled: boolean;
  expiry: number;
  checkpoint_timestamp_ms: number;
}

export interface SviHistoryEntry {
  params: SviParams;
  timestamp: number;
}

// ── New Fetch Functions ──────────────────────────────────

/** Get API health status */
export async function fetchStatus(): Promise<StatusData | null> {
  try {
    return await fetchJson<StatusData>('/status');
  } catch {
    return null;
  }
}

/** Get vault summary for a predict instance */
export async function fetchVaultSummary(predictId: string): Promise<VaultSummaryData | null> {
  try {
    return await fetchJson<VaultSummaryData>(`/predicts/${predictId}/vault/summary`);
  } catch {
    return null;
  }
}

/** Get vault performance (share price history) */
export async function fetchVaultPerformance(predictId: string, range = 'ALL'): Promise<VaultPerformanceData | null> {
  try {
    return await fetchJson<VaultPerformanceData>(`/predicts/${predictId}/vault/performance?range=${range}`);
  } catch {
    return null;
  }
}

/** Get combined oracle state (oracle + latest_price + latest_svi) */
export async function fetchOracleState(oracleId: string): Promise<OracleStateData | null> {
  try {
    const raw = await fetchJson<{ oracle: OracleData; latest_price: RawPriceResponse | null; latest_svi: RawSviResponse | null }>(`/oracles/${oracleId}/state`);
    return {
      oracle: raw.oracle,
      latest_price: raw.latest_price ? transformPrice(raw.latest_price) : null,
      latest_svi: raw.latest_svi ? transformSvi(raw.latest_svi) : null,
    };
  } catch {
    return null;
  }
}

/** Get manager summary (balance, P&L, positions count) */
export async function fetchManagerSummary(managerId: string): Promise<ManagerSummaryData | null> {
  try {
    return await fetchJson<ManagerSummaryData>(`/managers/${managerId}/summary`);
  } catch {
    return null;
  }
}

/** Get manager P&L time series */
export async function fetchManagerPnL(managerId: string, range = 'ALL'): Promise<ManagerPnLData | null> {
  try {
    return await fetchJson<ManagerPnLData>(`/managers/${managerId}/pnl?range=${range}`);
  } catch {
    return null;
  }
}

/** Get enriched position details for a manager */
export async function fetchManagerPositionsSummary(managerId: string): Promise<ManagerPositionSummary[]> {
  try {
    return await fetchJson<ManagerPositionSummary[]>(`/managers/${managerId}/positions/summary`);
  } catch {
    return [];
  }
}

/** Get LP supply (deposit) events */
export async function fetchLpSupplies(): Promise<LpSupplyEvent[]> {
  try {
    return await fetchJson<LpSupplyEvent[]>('/lp/supplies');
  } catch {
    return [];
  }
}

/** Get LP withdrawal events */
export async function fetchLpWithdrawals(): Promise<LpWithdrawalEvent[]> {
  try {
    return await fetchJson<LpWithdrawalEvent[]>('/lp/withdrawals');
  } catch {
    return [];
  }
}

/** Get all minted positions with cost/ask_price */
export async function fetchAllMintedPositions(): Promise<AllMintedPosition[]> {
  try {
    return await fetchJson<AllMintedPosition[]>('/positions/minted');
  } catch {
    return [];
  }
}

/** Get all redeemed positions with payout/bid_price */
export async function fetchAllRedeemedPositions(): Promise<AllRedeemedPosition[]> {
  try {
    return await fetchJson<AllRedeemedPosition[]>('/positions/redeemed');
  } catch {
    return [];
  }
}

/** Get SVI parameter history for an oracle */
export async function fetchSviHistory(oracleId: string): Promise<SviHistoryEntry[]> {
  try {
    const raw = await fetchJson<RawSviResponse[]>(`/oracles/${oracleId}/svi`);
    return raw.map(r => ({
      params: {
        a: r.a,
        b: r.b,
        rho: r.rho_negative ? -r.rho : r.rho,
        m: r.m_negative ? -r.m : r.m,
        sigma: r.sigma,
      },
      timestamp: r.onchain_timestamp,
    }));
  } catch {
    return [];
  }
}
