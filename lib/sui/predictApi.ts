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
