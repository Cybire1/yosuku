import { NextResponse } from 'next/server';

const PREDICT_BASE = 'https://predict-server.testnet.mystenlabs.com';
const DUSDC_DIVISOR = 1_000_000;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CachedResult {
  data: unknown;
  ts: number;
}

let cache: CachedResult | null = null;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${PREDICT_BASE}${path}`, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

interface ManagerData {
  manager_id: string;
  owner: string;
}

interface MintedPosition {
  oracle_id: string;
  manager_id: string;
  strike: number;
  is_up: boolean;
  quantity: number;
  cost: number;
  ask_price: number;
  checkpoint_timestamp_ms: number;
}

interface RedeemedPosition {
  oracle_id: string;
  manager_id: string;
  strike: number;
  is_up: boolean;
  quantity: number;
  payout: number;
  bid_price: number;
  is_settled: boolean;
  checkpoint_timestamp_ms: number;
}

interface TraderAccum {
  manager_id: string;
  owner: string;
  totalCost: number;
  totalPayout: number;
  mintCount: number;
  redeemCount: number;
  volume: number;
  wins: number;
  currentStreak: number;
  bestStreak: number;
}

export async function GET() {
  // Return cache if fresh
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    // Fetch managers, minted positions, and redeemed positions in parallel
    const [managersRaw, minted, redeemed] = await Promise.all([
      fetchJson<ManagerData[] | { managers: ManagerData[] }>('/managers'),
      fetchJson<MintedPosition[]>('/positions/minted'),
      fetchJson<RedeemedPosition[]>('/positions/redeemed'),
    ]);

    const managers: ManagerData[] = Array.isArray(managersRaw)
      ? managersRaw
      : ((managersRaw as { managers: ManagerData[] }).managers || []);

    // Build owner lookup
    const ownerByManager = new Map<string, string>();
    for (const m of managers) {
      ownerByManager.set(m.manager_id, m.owner);
    }

    // Aggregate per trader using exact cost/payout data
    const traderMap = new Map<string, TraderAccum>();

    function getTrader(managerId: string): TraderAccum {
      let trader = traderMap.get(managerId);
      if (!trader) {
        trader = {
          manager_id: managerId,
          owner: ownerByManager.get(managerId) || managerId,
          totalCost: 0,
          totalPayout: 0,
          mintCount: 0,
          redeemCount: 0,
          volume: 0,
          wins: 0,
          currentStreak: 0,
          bestStreak: 0,
        };
        traderMap.set(managerId, trader);
      }
      return trader;
    }

    // Process minted positions (costs)
    for (const pos of minted) {
      const trader = getTrader(pos.manager_id);
      const cost = pos.cost / DUSDC_DIVISOR;
      trader.totalCost += cost;
      trader.volume += cost;
      trader.mintCount++;
    }

    // Process redeemed positions (payouts) — sorted by timestamp for streak tracking
    const sortedRedeemed = [...redeemed].sort((a, b) => a.checkpoint_timestamp_ms - b.checkpoint_timestamp_ms);
    for (const pos of sortedRedeemed) {
      const trader = getTrader(pos.manager_id);
      const payout = pos.payout / DUSDC_DIVISOR;
      trader.totalPayout += payout;
      trader.redeemCount++;

      // A binary position that paid out > 0 WON its round (losers pay 0). Defining a
      // win this way keeps win-rate consistent with P&L: if net P&L is positive then
      // totalPayout > 0, so at least one redeem paid out → win-rate can never read 0%
      // while P&L is positive (the old bid-price cost basis produced that impossibility).
      if (payout > 0) {
        trader.wins++;
        trader.currentStreak++;
        trader.bestStreak = Math.max(trader.bestStreak, trader.currentStreak);
      } else {
        trader.currentStreak = 0;
      }
    }

    // Compute realized P&L = total payouts - total costs
    const ranked = [...traderMap.values()]
      .map(t => ({
        ...t,
        pnl: t.totalPayout - t.totalCost,
        tradeCount: t.mintCount + t.redeemCount,
      }))
      // Deterministic order so desktop, mobile, and every cache instance agree on #1:
      // P&L desc, then stable address tiebreakers for equal-P&L traders.
      .sort((a, b) =>
        (b.pnl - a.pnl) ||
        (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0) ||
        (a.manager_id < b.manager_id ? -1 : 1))
      .slice(0, 50);

    const rankings = ranked.map(t => ({
      manager_id: t.manager_id,
      owner: t.owner,
      pnl: Math.round(t.pnl * 100) / 100,
      winRate: t.redeemCount > 0 ? Math.round((t.wins / t.redeemCount) * 100) : 0,
      tradeCount: t.tradeCount,
      bestStreak: t.bestStreak,
      volume: Math.round(t.volume * 100) / 100,
    }));

    // Compute records
    let biggestPnl = { value: 0, trader: '', date: '' };
    let longestStreak = { value: 0, trader: '', date: '' };
    let biggestComeback = { value: 0, trader: '', date: '' };

    for (const t of ranked) {
      if (t.pnl > biggestPnl.value) {
        biggestPnl = { value: t.pnl, trader: t.owner, date: 'this season' };
      }
      if (t.bestStreak > longestStreak.value) {
        longestStreak = { value: t.bestStreak, trader: t.owner, date: 'this season' };
      }
      if (t.pnl > 0 && t.redeemCount > 3 && (t.totalCost > t.totalPayout * 0.5) && t.pnl > biggestComeback.value) {
        biggestComeback = { value: t.pnl, trader: t.owner, date: 'this season' };
      }
    }

    const records = [
      {
        label: 'Biggest net P&L',
        badge: 'Record',
        value: `+${biggestPnl.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
        unit: 'DUSDC',
        desc: `Top earner this season across all settled rounds.`,
        trader: biggestPnl.trader,
        date: biggestPnl.date,
      },
      {
        label: 'Longest streak',
        badge: `${longestStreak.value} wins`,
        value: String(longestStreak.value),
        unit: 'in a row',
        desc: `${longestStreak.value} consecutive winning rounds.`,
        trader: longestStreak.trader,
        date: longestStreak.date,
      },
      {
        label: 'Biggest comeback',
        badge: 'Recovery',
        value: `+${biggestComeback.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
        unit: 'DUSDC',
        desc: `Recovered from multiple losses to finish positive.`,
        trader: biggestComeback.trader,
        date: biggestComeback.date,
      },
    ];

    const totalVolume = [...traderMap.values()].reduce((s, t) => s + t.volume, 0);

    const result = {
      rankings,
      meta: {
        totalWallets: managers.length,
        totalVolume: Math.round(totalVolume * 100) / 100,
      },
      records,
    };

    cache = { data: result, ts: Date.now() };
    return NextResponse.json(result);
  } catch (err) {
    console.error('Leaderboard API error:', err);
    return NextResponse.json(
      { error: 'Failed to compute leaderboard', rankings: [], meta: { totalWallets: 0, totalVolume: 0 }, records: [] },
      { status: 500 }
    );
  }
}
