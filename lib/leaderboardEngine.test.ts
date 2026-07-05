import { describe, expect, it } from 'vitest';
import { computeLeaderboard, type LeaderboardMint, type LeaderboardRedeem } from './leaderboardEngine';

const START = 1_000;
const END = 10_000;

function mint(overrides: Partial<LeaderboardMint> = {}): LeaderboardMint {
  return {
    event_digest: 'mint-1', checkpoint_timestamp_ms: 100, manager_id: 'manager-a',
    trader: 'wallet-a', oracle_id: 'oracle-1', expiry: '5000', strike: '65000',
    is_up: true, quantity: '1000000', cost: '400000', ...overrides,
  };
}

function redeem(overrides: Partial<LeaderboardRedeem> = {}): LeaderboardRedeem {
  return {
    event_digest: 'redeem-1', checkpoint_timestamp_ms: 2_000, manager_id: 'manager-a',
    owner: 'wallet-a', oracle_id: 'oracle-1', expiry: '5000', strike: '65000',
    is_up: true, quantity: '1000000', payout: '1000000', is_settled: true, ...overrides,
  };
}

describe('computeLeaderboard', () => {
  it('ranks wallets by realized P&L and ignores open mint spend', () => {
    const result = computeLeaderboard([
      mint(),
      mint({ event_digest: 'open-mint', oracle_id: 'still-open', cost: '9000000' }),
      mint({ event_digest: 'mint-b', manager_id: 'manager-b', trader: 'wallet-b', cost: '200000' }),
    ], [
      redeem(),
      redeem({ event_digest: 'redeem-b', manager_id: 'manager-b', owner: 'wallet-b', payout: '300000' }),
    ], START, END);

    expect(result.rankings.map((row) => row.owner)).toEqual(['wallet-a', 'wallet-b']);
    expect(result.rankings[0]).toMatchObject({ pnl: 0.6, volume: 0.4, tradeCount: 1, winRate: 100 });
  });

  it('FIFO-matches partial closes without float drift', () => {
    const result = computeLeaderboard([
      mint({ event_digest: 'mint-1', quantity: '1000000', cost: '300000' }),
      mint({ event_digest: 'mint-2', quantity: '1000000', cost: '700000' }),
    ], [redeem({ quantity: '1500000', payout: '1200000' })], START, END);
    expect(result.rankings[0]).toMatchObject({ pnl: 0.55, volume: 0.65 });
  });

  it('groups split redemptions of one market call into one trade', () => {
    const result = computeLeaderboard([mint()], [
      redeem({ event_digest: 'redeem-1', quantity: '400000', payout: '400000', is_settled: false }),
      redeem({ event_digest: 'redeem-2', quantity: '600000', payout: '600000', checkpoint_timestamp_ms: 3_000 }),
    ], START, END);
    expect(result.rankings[0]).toMatchObject({ tradeCount: 1, pnl: 0.6, bestStreak: 1 });
  });

  it('deduplicates rows and excludes closes outside the window', () => {
    const sameRedeem = redeem();
    const result = computeLeaderboard(
      [mint(), mint()],
      [sameRedeem, sameRedeem, redeem({ event_digest: 'old', checkpoint_timestamp_ms: 500, oracle_id: 'old-oracle' })],
      START,
      END,
    );
    expect(result.rankings).toHaveLength(1);
    expect(result.rankings[0].tradeCount).toBe(1);
  });

  it('does not invent P&L without a matching mint', () => {
    const result = computeLeaderboard([], [redeem()], START, END);
    expect(result.rankings).toHaveLength(0);
    expect(result.unmatchedRedemptions).toBe(1);
  });
});
