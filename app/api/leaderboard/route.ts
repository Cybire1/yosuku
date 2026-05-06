import { NextResponse } from 'next/server';

const PREDICT_BASE = 'https://predict-server.testnet.mystenlabs.com';
const DUSDC_DIVISOR = 1_000_000;
const FLOAT_SCALING = 1_000_000_000;
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

interface OracleData {
  oracle_id: string;
  status: string;
  underlying_asset: string;
  expiry: number;
  min_strike: number;
  tick_size: number;
  settlement_price: number | null;
  settled_at: number | null;
}

interface ManagerData {
  manager_id: string;
  owner: string;
}

interface TradeData {
  oracle_id: string;
  manager_id: string;
  side: 'mint' | 'redeem';
  lower_strike: string;
  higher_strike: string;
  quantity: string;
  price: number;
  timestamp: number;
}

interface TraderAccum {
  manager_id: string;
  owner: string;
  pnl: number;
  wins: number;
  losses: number;
  tradeCount: number;
  volume: number;
  currentStreak: number;
  bestStreak: number;
}

export async function GET() {
  // Return cache if fresh
  if (cache && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    // Fetch all oracles and managers server-side (no CORS issues)
    const [oracles, managersRaw] = await Promise.all([
      fetchJson<OracleData[]>('/oracles'),
      fetchJson<ManagerData[] | { managers: ManagerData[] }>('/managers'),
    ]);

    const managers: ManagerData[] = Array.isArray(managersRaw)
      ? managersRaw
      : ((managersRaw as { managers: ManagerData[] }).managers || []);

    // Build owner lookup
    const ownerByManager = new Map<string, string>();
    for (const m of managers) {
      ownerByManager.set(m.manager_id, m.owner);
    }

    // Fetch trades for recent oracles (limit to 30 most recent to keep response time reasonable)
    const recentOracles = [...oracles]
      .sort((a, b) => b.expiry - a.expiry)
      .slice(0, 30);

    const tradeResults = await Promise.allSettled(
      recentOracles.map(o => fetchJson<TradeData[]>(`/trades/${o.oracle_id}`))
    );

    // Flatten all trades
    const allTrades: TradeData[] = [];
    for (const r of tradeResults) {
      if (r.status === 'fulfilled') {
        allTrades.push(...r.value);
      }
    }

    // Build settled oracle set for P&L calc
    const settledOracles = new Map<string, OracleData>();
    for (const o of oracles) {
      if (o.status === 'settled') {
        settledOracles.set(o.oracle_id, o);
      }
    }

    // Aggregate per trader
    const traderMap = new Map<string, TraderAccum>();

    for (const trade of allTrades) {
      let trader = traderMap.get(trade.manager_id);
      if (!trader) {
        trader = {
          manager_id: trade.manager_id,
          owner: ownerByManager.get(trade.manager_id) || trade.manager_id,
          pnl: 0,
          wins: 0,
          losses: 0,
          tradeCount: 0,
          volume: 0,
          currentStreak: 0,
          bestStreak: 0,
        };
        traderMap.set(trade.manager_id, trader);
      }

      const qty = Math.abs(Number(trade.quantity)) / DUSDC_DIVISOR;
      trader.volume += qty;
      trader.tradeCount++;

      // Compute realized P&L for settled oracles
      const oracle = settledOracles.get(trade.oracle_id);
      if (oracle && oracle.settlement_price !== null) {
        // Simplified P&L: for mint trades, if price moved favorably, it's a win
        const midStrike = oracle.min_strike + oracle.tick_size * 25;
        const settleAbove = (oracle.settlement_price ?? 0) >= midStrike;

        // Determine trade direction from strikes
        const isUp = trade.lower_strike !== '0' && trade.higher_strike === '18446744073709551615';
        const isDown = trade.lower_strike === '0' && trade.higher_strike !== '18446744073709551615';

        let won = false;
        if (trade.side === 'mint') {
          won = (isUp && settleAbove) || (isDown && !settleAbove);
        } else {
          won = (isUp && !settleAbove) || (isDown && settleAbove);
        }

        const pricePaid = trade.price / FLOAT_SCALING;
        if (won) {
          trader.pnl += qty * (1 - pricePaid);
          trader.wins++;
          trader.currentStreak++;
          trader.bestStreak = Math.max(trader.bestStreak, trader.currentStreak);
        } else {
          trader.pnl -= qty * pricePaid;
          trader.losses++;
          trader.currentStreak = 0;
        }
      }
    }

    // Sort by P&L descending, take top 50
    const ranked = [...traderMap.values()]
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, 50);

    const rankings = ranked.map(t => ({
      manager_id: t.manager_id,
      owner: t.owner,
      pnl: Math.round(t.pnl * 100) / 100,
      winRate: t.tradeCount > 0 ? Math.round((t.wins / t.tradeCount) * 100) : 0,
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
      // Approximate comeback as traders with negative min but positive final
      if (t.pnl > 0 && t.losses > 3 && t.pnl > biggestComeback.value) {
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
