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

// On-chain queries via SuiClient
import { DUSDC_TYPE, PLP_TYPE, DUSDC_MULTIPLIER, FLOAT_SCALING } from './constants';

// Use a loose type to avoid version mismatches between @mysten/sui and @mysten/dapp-kit
type AnySuiClient = {
  getBalance: (params: { owner: string; coinType: string }) => Promise<{ totalBalance: string }>;
  getCoins: (params: { owner: string; coinType: string }) => Promise<{ data: { coinObjectId: string; balance: string }[] }>;
};

export async function fetchDUSDCBalance(client: AnySuiClient, address: string): Promise<number> {
  const balance = await client.getBalance({ owner: address, coinType: DUSDC_TYPE });
  return Number(balance.totalBalance);
}

export async function fetchDUSDCCoins(
  client: AnySuiClient,
  address: string,
): Promise<{ coinObjectId: string; balance: bigint }[]> {
  const coins = await client.getCoins({ owner: address, coinType: DUSDC_TYPE });
  return coins.data.map(c => ({
    coinObjectId: c.coinObjectId,
    balance: BigInt(c.balance),
  }));
}

export async function fetchPLPBalance(client: AnySuiClient, address: string): Promise<number> {
  const balance = await client.getBalance({ owner: address, coinType: PLP_TYPE });
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
