// Re-export everything from predictApi for backwards compatibility
// New code should import from predictApi directly

export {
  fetchOracles,
  fetchActiveOracles,
  fetchManagers,
  fetchManagerForAddress,
  fetchLatestPrices,
  fetchPriceHistory,
  fetchLatestSvi,
  fetchConfig,
  fetchManagerPositions,
  fetchMintedPositions,
  fetchTrades,
  type OracleData,
  type ManagerData,
  type PriceData,
  type SviData,
  type SviParams,
  type PositionData,
  type MintedPosition,
  type TradeData,
  type PredictConfig,
} from './predictApi';

// On-chain queries — now off JSON-RPC, served by GraphQL via the shared shim.
import { DUSDC_TYPE, PLP_TYPE, DUSDC_MULTIPLIER, FLOAT_SCALING } from './constants';
import { readClient } from './modernClients';

// Kept loose so legacy callers can still pass their dapp-kit client (ignored — reads
// go through GraphQL). New code can call these with no client argument.
type AnySuiClient = unknown;

export async function fetchDUSDCBalance(_client: AnySuiClient, address: string): Promise<number> {
  const balance = await readClient.getBalance({ owner: address, coinType: DUSDC_TYPE });
  return Number(balance.totalBalance);
}

export async function fetchDUSDCCoins(
  _client: AnySuiClient,
  address: string,
): Promise<{ coinObjectId: string; balance: bigint }[]> {
  const coins = await readClient.getCoins({ owner: address, coinType: DUSDC_TYPE });
  return coins.data.map(c => ({
    coinObjectId: c.coinObjectId,
    balance: BigInt(c.balance),
  }));
}

export async function fetchPLPBalance(_client: AnySuiClient, address: string): Promise<number> {
  const balance = await readClient.getBalance({ owner: address, coinType: PLP_TYPE });
  return Number(balance.totalBalance);
}

// ── Formatting Helpers ───────────────────────────────────

export function formatDUSDC(microAmount: number): string {
  return (microAmount / DUSDC_MULTIPLIER).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function parseDUSDCToMicro(displayAmount: string): number {
  const num = parseFloat(displayAmount);
  if (isNaN(num) || num <= 0) return 0;
  return Math.floor(num * DUSDC_MULTIPLIER);
}

export function formatStrikePrice(scaledPrice: number): string {
  const dollars = scaledPrice / FLOAT_SCALING;
  return '$' + dollars.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function formatExpiry(expiryMs: number): string {
  return new Date(expiryMs).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function generateStrikeGrid(
  minStrike: number,
  tickSize: number,
  numTicks: number = 50,
  centerPrice?: number,
): number[] {
  const strikes: number[] = [];
  if (centerPrice && tickSize > 0) {
    const centerTick = Math.round((centerPrice - minStrike) / tickSize);
    const halfTicks = Math.floor(numTicks / 2);
    const startTick = Math.max(0, centerTick - halfTicks);
    for (let i = 0; i < numTicks; i++) {
      strikes.push(minStrike + (startTick + i) * tickSize);
    }
  } else {
    for (let i = 0; i < numTicks; i++) {
      strikes.push(minStrike + tickSize * i);
    }
  }
  return strikes;
}
