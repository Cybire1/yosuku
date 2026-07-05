import { NextResponse } from 'next/server';
import {
  computeLeaderboard,
  type LeaderboardMint,
  type LeaderboardRedeem,
} from '@/lib/leaderboardEngine';

const PREDICT_BASE = 'https://predict-server.testnet.mystenlabs.com';
const WINDOW_MS = 24 * 60 * 60 * 1000;
const FEED_LIMIT = 500;
const CACHE_TTL = 2 * 60 * 1000;

interface CachedResult {
  data: LeaderboardResponse;
  ts: number;
}

interface ManagerHistory {
  minted?: LeaderboardMint[];
  redeemed?: LeaderboardRedeem[];
}

interface LeaderboardResponse {
  rankings: ReturnType<typeof computeLeaderboard>['rankings'];
  meta: {
    period: '24h';
    windowStartMs: number;
    windowEndMs: number;
    rankedTraders: number;
    totalWallets: number;
    closedCalls: number;
    totalVolume: number;
    complete: boolean;
    unmatchedRedemptions: number;
  };
  records: never[];
}

let cache: CachedResult | null = null;

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${PREDICT_BASE}${path}`, { next: { revalidate: 120 } });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchHistories(managerIds: string[]): Promise<{
  minted: LeaderboardMint[];
  redeemed: LeaderboardRedeem[];
  failed: number;
}> {
  const minted: LeaderboardMint[] = [];
  const redeemed: LeaderboardRedeem[] = [];
  let failed = 0;

  // Keep pressure on the public indexer bounded when several managers traded.
  for (let index = 0; index < managerIds.length; index += 6) {
    const batch = managerIds.slice(index, index + 6);
    const histories = await Promise.all(batch.map(async (managerId) => {
      try {
        return await fetchJson<ManagerHistory>(`/managers/${managerId}/positions`);
      } catch (error) {
        console.error(`Leaderboard history failed for ${managerId}:`, error);
        failed++;
        return null;
      }
    }));

    for (const history of histories) {
      if (!history) continue;
      minted.push(...(history.minted ?? []));
      redeemed.push(...(history.redeemed ?? []));
    }
  }

  return { minted, redeemed, failed };
}

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return NextResponse.json(cache.data);

  try {
    const windowEndMs = Date.now();
    const windowStartMs = windowEndMs - WINDOW_MS;
    const recentRedeemed = await fetchJson<LeaderboardRedeem[]>(`/positions/redeemed?limit=${FEED_LIMIT}`);
    const ordered = [...recentRedeemed].sort((a, b) => b.checkpoint_timestamp_ms - a.checkpoint_timestamp_ms);
    const oldestTimestamp = ordered.at(-1)?.checkpoint_timestamp_ms ?? windowEndMs;
    const feedCoversWindow = recentRedeemed.length < FEED_LIMIT || oldestTimestamp <= windowStartMs;
    const activeManagerIds = [...new Set(
      ordered
        .filter((event) => event.checkpoint_timestamp_ms >= windowStartMs && event.checkpoint_timestamp_ms < windowEndMs)
        .map((event) => event.manager_id),
    )];

    const histories = await fetchHistories(activeManagerIds);
    const scored = computeLeaderboard(histories.minted, histories.redeemed, windowStartMs, windowEndMs);
    const rankings = scored.rankings.slice(0, 50);
    const totalVolume = rankings.reduce((sum, trader) => sum + trader.volume, 0);
    const complete = feedCoversWindow && histories.failed === 0 && scored.unmatchedRedemptions === 0;

    const result: LeaderboardResponse = {
      rankings,
      meta: {
        period: '24h',
        windowStartMs,
        windowEndMs,
        rankedTraders: scored.rankings.length,
        // Kept for older mobile/web consumers; this is ranked traders, not every registered wallet.
        totalWallets: scored.rankings.length,
        closedCalls: scored.closedCalls,
        totalVolume: Math.round(totalVolume * 100) / 100,
        complete,
        unmatchedRedemptions: scored.unmatchedRedemptions,
      },
      records: [],
    };

    cache = { data: result, ts: Date.now() };
    return NextResponse.json(result);
  } catch (error) {
    console.error('Leaderboard API error:', error);
    return NextResponse.json({
      error: 'Failed to compute leaderboard',
      rankings: [],
      meta: {
        period: '24h',
        windowStartMs: Date.now() - WINDOW_MS,
        windowEndMs: Date.now(),
        rankedTraders: 0,
        totalWallets: 0,
        closedCalls: 0,
        totalVolume: 0,
        complete: false,
        unmatchedRedemptions: 0,
      },
      records: [],
    }, { status: 500 });
  }
}
