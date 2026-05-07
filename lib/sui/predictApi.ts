// REST client for DeepBook Predict server
// All read queries go through this — writes go through PTBs via dapp-kit

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
  lower_strike: string;
  higher_strike: string;
  quantity: string;
  timestamp: number;
}

export interface TradeData {
  oracle_id: string;
  manager_id: string;
  side: 'mint' | 'redeem';
  lower_strike: string;
  higher_strike: string;
  quantity: string;
  price: number;
  timestamp: number;
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

/** List all oracles */
export async function fetchOracles(): Promise<OracleData[]> {
  return fetchJson<OracleData[]>('/oracles');
}

/** List active oracles only */
export async function fetchActiveOracles(): Promise<OracleData[]> {
  const all = await fetchOracles();
  return all.filter(o => o.status === 'active');
}

/** Get latest prices for an oracle */
export async function fetchLatestPrices(oracleId: string): Promise<PriceData | null> {
  try {
    return await fetchJson<PriceData>(`/oracles/${oracleId}/prices/latest`);
  } catch {
    return null;
  }
}

/** Get price history for an oracle */
export async function fetchPriceHistory(oracleId: string, limit = 100): Promise<PriceData[]> {
  try {
    return await fetchJson<PriceData[]>(`/oracles/${oracleId}/prices?limit=${limit}`);
  } catch {
    return [];
  }
}

/** Get latest SVI parameters for an oracle */
export async function fetchLatestSvi(oracleId: string): Promise<SviData | null> {
  try {
    return await fetchJson<SviData>(`/oracles/${oracleId}/svi/latest`);
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

/** Get positions for a manager */
export async function fetchManagerPositions(managerId: string): Promise<PositionData[]> {
  try {
    return await fetchJson<PositionData[]>(`/managers/${managerId}/positions`);
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
    return await fetchJson<TradeData[]>(`/trades/${oracleId}`);
  } catch {
    return [];
  }
}

// ── New Types ────────────────────────────────────────────

export interface StatusData {
  healthy: boolean;
  pipeline_lag_ms: number;
  last_checkpoint: number;
  uptime_seconds: number;
}

export interface VaultSummaryData {
  predict_id: string;
  tvl: number;
  plp_share_price: number;
  utilization: number;
  total_supplied: number;
  total_withdrawn: number;
  net_deposits: number;
  balance: number;
  total_mtm: number;
  max_payout: number;
  total_plp_supply: number;
}

export interface VaultPerformancePoint {
  timestamp: number;
  share_price: number;
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
  realized_pnl: number;
  unrealized_pnl: number;
  account_value: number;
  open_positions: number;
}

export interface ManagerPnLPoint {
  timestamp: number;
  cumulative_pnl: number;
}

export interface ManagerPnLData {
  manager_id: string;
  range: string;
  points: ManagerPnLPoint[];
  current_unrealized_pnl: number;
}

export interface ManagerPositionSummary {
  oracle_id: string;
  lower_strike: string;
  higher_strike: string;
  quantity: string;
  entry_price: number;
  current_price: number;
  unrealized_pnl: number;
  direction: 'UP' | 'DOWN' | 'RANGE';
}

export interface LpSupplyEvent {
  supplier: string;
  amount: number;
  plp_minted: number;
  timestamp: number;
}

export interface LpWithdrawalEvent {
  withdrawer: string;
  plp_burned: number;
  amount_returned: number;
  timestamp: number;
}

export interface AllMintedPosition {
  oracle_id: string;
  manager_id: string;
  lower_strike: string;
  higher_strike: string;
  quantity: string;
  cost: number;
  ask_price: number;
  timestamp: number;
}

export interface AllRedeemedPosition {
  oracle_id: string;
  manager_id: string;
  lower_strike: string;
  higher_strike: string;
  quantity: string;
  payout: number;
  bid_price: number;
  timestamp: number;
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
    return await fetchJson<OracleStateData>(`/oracles/${oracleId}/state`);
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
    return await fetchJson<SviHistoryEntry[]>(`/oracles/${oracleId}/svi`);
  } catch {
    return [];
  }
}
