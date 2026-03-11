import { config } from './config.js';
import { getBlockHeight, findHighestRound, isRoundResolved, isRoundExpired, getRoundDeadline, roundExists, getProgramUsdcxBalance } from './aleo.js';
import { getReliablePriceCents, getBtcPrice } from './price.js';
import { leoExecute, transferSeedToPool } from './executor.js';
import { getPoolTotals, resetPool, setRoundMeta } from './bet-tracker.js';

const { blocksPerRound, roundIntervalSecs, pollIntervalMs, seedAmount } = config;

// ── State ───────────────────────────────────────────────
let currentRoundId = -1;
let roundStatus: 'idle' | 'active' | 'resolving' | 'creating' = 'idle';
let tickInterval: NodeJS.Timeout | null = null;

export function getCurrentRoundId(): number {
  return currentRoundId;
}

export function getRoundStatus(): string {
  return roundStatus;
}

// ── Startup ─────────────────────────────────────────────

export async function startRoundManager(): Promise<void> {
  console.log(`\n[RoundManager] Starting (v8 — commitment scheme + dark pool)...`);
  console.log(`  Duration: ${roundIntervalSecs}s | Blocks: ${blocksPerRound}`);
  console.log(`  Poll interval: ${pollIntervalMs}ms\n`);

  // Run immediately, then on interval
  await tick();
  tickInterval = setInterval(tick, pollIntervalMs);
}

export function stopRoundManager(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

// ── Main Tick ───────────────────────────────────────────

async function tick(): Promise<void> {
  try {
    const height = await getBlockHeight();

    // First run: find the latest round via binary search (fast)
    if (currentRoundId < 0) {
      roundStatus = 'idle';
      console.log(`[Tick] Binary searching for latest round...`);
      const highest = await findHighestRound();

      if (highest < 0) {
        // No rounds at all — create round #0
        console.log(`[Tick] No rounds found. Creating round #0...`);
        await createNextRound(0, height);
        return;
      }

      // Check if this round is still active
      const resolved = await isRoundResolved(highest);
      if (!resolved) {
        const deadline = await getRoundDeadline(highest);
        if (height < deadline) {
          // Round is still live — monitor it
          currentRoundId = highest;
          roundStatus = 'active';
          console.log(`[Tick] Found active round #${highest} (deadline block ${deadline})`);
          return;
        }
        // Expired but unresolved — resolve just this one, then create fresh
        currentRoundId = highest;
        console.log(`[Tick] Found expired round #${highest}. Resolving it...`);
        await resolveAndCreateNext(height);
        return;
      }

      // Latest round already resolved — create a new one right after it
      console.log(`[Tick] Latest round #${highest} already resolved. Creating #${highest + 1}...`);
      await createNextRound(highest + 1, height);
      return;
    }

    // Check if current round is resolved
    const resolved = await isRoundResolved(currentRoundId);
    if (resolved) {
      console.log(`[Tick] Round #${currentRoundId} resolved. Creating next...`);
      await createNextRound(currentRoundId + 1, height);
      return;
    }

    // Round is active — check if expired (deadline passed but not yet resolved)
    const expired = await isRoundExpired(currentRoundId);
    if (expired) {
      await resolveAndCreateNext(height);
      return;
    }

    // Round still active
    roundStatus = 'active';
    const deadline = await getRoundDeadline(currentRoundId);
    const blocksLeft = deadline - height;
    const estSeconds = Math.round(blocksLeft * 3.5);
    const m = Math.floor(estSeconds / 60);
    const s = estSeconds % 60;
    const price = getBtcPrice();
    const pool = getPoolTotals(currentRoundId);
    console.log(
      `[Tick] Round #${currentRoundId} | ${blocksLeft} blocks left (~${m}m${s}s) | Height: ${height}/${deadline}` +
      `${price > 0 ? ` | BTC: $${price.toFixed(2)}` : ''}` +
      ` | Dark pool: YES=${pool.yes} NO=${pool.no}`
    );
  } catch (err: any) {
    console.error(`[Tick] Error: ${err.message}`);
  }
}

// ── Resolve current + Create Next ───────────────────────

async function resolveAndCreateNext(height: number): Promise<void> {
  roundStatus = 'resolving';
  console.log(`\n[Resolve] Round #${currentRoundId} deadline passed!`);

  // 1. Get BTC price
  const actualPrice = await getReliablePriceCents();
  console.log(`  BTC price: $${(actualPrice / 100).toFixed(2)}`);

  // 2. Get per-side totals from bet tracker (dark pool reveal)
  const pool = getPoolTotals(currentRoundId);
  // Add seed to each side
  const yesTotal = pool.yes + seedAmount;
  const noTotal = pool.no + seedAmount;
  console.log(`  Dark pool reveal: YES=${yesTotal} NO=${noTotal} (seed=${seedAmount} per side)`);

  // 3. Resolve the round: resolve(rid, actual_price, yes_total, no_total)
  console.log(`  Resolving round #${currentRoundId}...`);
  const resolveOk = leoExecute('resolve', [
    `${currentRoundId}u64`,
    `${actualPrice}u64`,
    `${yesTotal}u128`,
    `${noTotal}u128`,
  ]);

  if (!resolveOk) {
    console.error(`  Failed to resolve. Will retry next tick.`);
    roundStatus = 'active';
    return;
  }

  // Clean up bet tracker for this round
  resetPool(currentRoundId);

  // Brief wait for on-chain settlement
  await new Promise((r) => setTimeout(r, 5_000));

  // 4. Create next round immediately
  const newHeight = await getBlockHeight();
  await createNextRound(currentRoundId + 1, newHeight);
}

// ── Create Round ────────────────────────────────────────

async function createNextRound(roundId: number, height: number): Promise<void> {
  roundStatus = 'creating';

  const priceCents = await getReliablePriceCents();
  const deadline = height + blocksPerRound;

  console.log(
    `[Create] Round #${roundId} | Target: $${(priceCents / 100).toFixed(2)} | Deadline: block ${deadline} | Seed: ${seedAmount / 1_000_000} USDCx each side`
  );

  // Transfer seed tokens only if the program doesn't already have enough
  if (seedAmount > 0) {
    const totalNeeded = seedAmount * 2; // both YES and NO sides
    const currentBalance = await getProgramUsdcxBalance();
    console.log(`  [Pool] Program USDCx balance: ${currentBalance / 1_000_000} | Need: ${totalNeeded / 1_000_000}`);

    if (currentBalance < totalNeeded) {
      const deficit = totalNeeded - currentBalance;
      console.log(`  [Pool] Topping up ${deficit / 1_000_000} USDCx (recycling ${currentBalance / 1_000_000} from previous rounds)`);
      const seedOk = await transferSeedToPool(Math.ceil(deficit / 2));
      if (!seedOk) {
        console.error(`  Failed to transfer seed tokens. Will retry next tick.`);
        roundStatus = 'idle';
        return;
      }
      // Wait for seed transfer to settle
      await new Promise((r) => setTimeout(r, 5_000));
    } else {
      console.log(`  [Pool] Sufficient balance — recycling from previous rounds (no new transfer needed)`);
    }
  }

  // v7: create_round(rid, target, deadline, seed)
  const createOk = leoExecute('create_round', [
    `${roundId}u64`,
    `${priceCents}u64`,
    `${deadline}u32`,
    `${seedAmount}u128`,
  ]);

  if (createOk) {
    currentRoundId = roundId;
    roundStatus = 'active';
    setRoundMeta(roundId, roundIntervalSecs, height);
    console.log(`  Round #${roundId} is live! (${roundIntervalSecs}s / ${blocksPerRound} blocks)\n`);
  } else {
    console.error(`  Failed to create round #${roundId}. Will retry next tick.`);
    roundStatus = 'idle';
  }
}
