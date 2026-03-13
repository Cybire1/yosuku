import { ALEO_API_URL, ALEO_NETWORK, BACKEND_URL, fetchMapping, parseU128 } from './predictionContract';

export const MIRROR_PROGRAM = process.env.NEXT_PUBLIC_MIRROR_PROGRAM || 'dart_mirror_v13.aleo';
export const MIRROR_POSITIONS_KEY = 'v13_mirror_positions';

export type MirrorSide = 'YES' | 'NO';

export interface MirrorMarketData {
  source: 'polymarket';
  sourceMarketId: string;
  marketId: string;
  slug: string;
  question: string;
  description?: string;
  category: string;
  endDate?: string;
  outcomeLabels: [string, string];
  outcomePrices: [number, number];
  publicYesPrice: number;
  publicNoPrice: number;
  yesMultiplierBps: number;
  noMultiplierBps: number;
  volume: number;
  volume24hr: number;
  volume1wk: number;
  yesPriceChange24h: number;
  yesPriceChange1w: number;
  liquidity: number;
  commentCount: number;
  hasLivePrice: boolean;
  onChainCreated?: boolean;
  onChainResolved?: boolean;
  onChainCloseBlock?: number | null;
  vaultAddress?: string | null;
}

export interface MirrorStoredPosition {
  positionId: string;
  marketId: string;
  sourceMarketId: string;
  question: string;
  description?: string;
  slug: string;
  category: string;
  roomId?: string;
  side: MirrorSide;
  amount: number;
  payout: number;
  timestamp: number;
  claimed: boolean;
  forfeited: boolean;
  refunded?: boolean;
  outcomeLabels: [string, string];
  transactionId?: string;
}

interface WalletMethods {
  requestRecords?: (program: string, includePlaintext?: boolean) => Promise<unknown[]>;
}

export function createMirrorPositionId(marketId: string): string {
  return `${marketId}_${Date.now()}`;
}

export function loadMirrorPositions(): MirrorStoredPosition[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(MIRROR_POSITIONS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map((position) => ({
      refunded: false,
      ...position,
    })) as MirrorStoredPosition[];
  } catch {
    return [];
  }
}

export function saveMirrorPosition(position: MirrorStoredPosition) {
  const positions = loadMirrorPositions();
  positions.unshift(position);
  localStorage.setItem(MIRROR_POSITIONS_KEY, JSON.stringify(positions));
}

export function updateMirrorPosition(positionId: string, patch: Partial<MirrorStoredPosition>) {
  const next = loadMirrorPositions().map((position) =>
    position.positionId === positionId ? { ...position, ...patch } : position
  );
  localStorage.setItem(MIRROR_POSITIONS_KEY, JSON.stringify(next));
}

export function markMirrorClaimed(positionId: string) {
  updateMirrorPosition(positionId, { claimed: true, forfeited: false, refunded: false });
}

export function markMirrorForfeited(positionId: string) {
  updateMirrorPosition(positionId, { forfeited: true, claimed: false, refunded: false });
}

export function markMirrorRefunded(positionId: string) {
  updateMirrorPosition(positionId, { refunded: true, claimed: false, forfeited: false });
}

export function getOpenMirrorPosition(marketId: string): MirrorStoredPosition | null {
  return loadMirrorPositions().find(
    (position) => position.marketId === marketId && !position.claimed && !position.forfeited && !position.refunded
  ) || null;
}

export async function fetchMirrorCatalog(): Promise<MirrorMarketData[]> {
  const res = await fetch(`${BACKEND_URL}/api/mirrors`);
  if (!res.ok) throw new Error(`Mirror API ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.markets) ? (data.markets as MirrorMarketData[]) : [];
}

export async function fetchMirrorMarket(marketId: string): Promise<MirrorMarketData | null> {
  const markets = await fetchMirrorCatalog();
  return markets.find((market) => market.marketId === marketId) || null;
}

export async function fetchMirrorOutcome(marketId: string): Promise<number> {
  const raw = await fetchMapping(MIRROR_PROGRAM, 'mo', `${marketId}u64`);
  if (!raw) return 0;
  return parseInt(raw.replace('u8', '').trim(), 10) || 0;
}

export async function fetchMirrorVaultAddress(): Promise<string | null> {
  const raw = await fetchMapping(MIRROR_PROGRAM, 'aa', '1u8');
  return raw ? raw.replace(/"/g, '').trim() : null;
}

export async function fetchMirrorPayoutCapacity(address: string): Promise<number> {
  const raw = await fetch(`${ALEO_API_URL}/${ALEO_NETWORK}/program/test_usdcx_stablecoin.aleo/mapping/balances/${address}`);
  if (!raw.ok) return 0;
  const text = (await raw.text()).replace(/"/g, '').trim();
  if (!text || text === 'null') return 0;
  return parseU128(text);
}

function extractPlaintext(record: unknown): string | null {
  if (typeof record === 'string') return record;
  if (record && typeof record === 'object') {
    const candidate = record as Record<string, unknown>;
    if (typeof candidate.plaintext === 'string') return candidate.plaintext;
    if (typeof candidate.data === 'string') return candidate.data;
    if (candidate.data && typeof candidate.data === 'object') {
      try {
        return JSON.stringify(candidate.data);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function parseMirrorReceiptPlaintext(plaintext: string): {
  marketId: string;
  side: MirrorSide;
  amount: number;
  payout: number;
} | null {
  const midMatch = plaintext.match(/mid:\s*(\d+)u64/);
  const sideMatch = plaintext.match(/side:\s*(true|false)/);
  const amountMatch = plaintext.match(/amt:\s*(\d+)u128/);
  const payoutMatch = plaintext.match(/payout:\s*(\d+)u128/);

  if (!midMatch || !sideMatch || !amountMatch || !payoutMatch) {
    return null;
  }

  return {
    marketId: midMatch[1],
    side: sideMatch[1] === 'true' ? 'YES' : 'NO',
    amount: parseInt(amountMatch[1], 10),
    payout: parseInt(payoutMatch[1], 10),
  };
}

export async function resolveMirrorReceipt(
  wallet: WalletMethods,
  marketId: string,
): Promise<string | null> {
  if (!wallet.requestRecords) return null;

  try {
    const records = await wallet.requestRecords(MIRROR_PROGRAM, true);
    for (const record of records) {
      const plaintext = extractPlaintext(record);
      if (!plaintext) continue;
      const parsed = parseMirrorReceiptPlaintext(plaintext);
      if (parsed?.marketId === marketId) {
        return plaintext;
      }
    }
  } catch (error) {
    console.warn('[MirrorMarkets] requestRecords failed:', error);
  }

  return null;
}
