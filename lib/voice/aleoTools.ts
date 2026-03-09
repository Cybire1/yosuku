// Voice tools for BTC Prediction round-based system (v7 — dark pool + private bets)
import { fetchRound, loadPositions, getBlockHeight } from '@/lib/roundHelpers';
import {
  BTC_PREDICTION_PROGRAM,
  fetchMapping,
  formatPred,
  PRED_MULTIPLIER,
  type RoundState,
} from '@/lib/predictionContract';

export interface VoiceToolResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

// ── Helpers ──────────────────────────────────────────

async function fetchAleoBalance(address: string): Promise<number> {
  try {
    const res = await fetch(
      `https://api.explorer.provable.com/v1/testnet/program/credits.aleo/mapping/account/${address}`
    );
    if (!res.ok) return 0;
    const data = await res.json();
    if (data && typeof data === 'string') {
      return parseInt(data.replace('u64', '')) / 1_000_000;
    }
    return 0;
  } catch {
    return 0;
  }
}

async function fetchUsdcxBalance(address: string): Promise<number> {
  try {
    const res = await fetch(
      `https://api.explorer.provable.com/v1/testnet/program/test_usdcx_stablecoin.aleo/mapping/balances/${address}`
    );
    if (!res.ok) return 0;
    const data = await res.json();
    if (data && typeof data === 'string') {
      return parseInt(data.replace('u128', '')) / PRED_MULTIPLIER;
    }
    return 0;
  } catch {
    return 0;
  }
}

/** Find the latest round ID using localStorage hint + forward scan */
async function findLatestRoundId(): Promise<number> {
  const lastKnown = parseInt(
    (typeof window !== 'undefined' ? localStorage.getItem('dart_last_round_id') : null) || '0',
    10
  );

  if (lastKnown <= 0) return 0;

  // Check forward
  for (let offset = 3; offset >= 0; offset--) {
    const id = lastKnown + offset;
    const exists = await fetchMapping(BTC_PREDICTION_PROGRAM, 'rt', `${id}u64`);
    if (exists && exists !== 'null') return id;
  }

  return lastKnown;
}

// ── Voice Tool Functions ─────────────────────────────

/** Get current active round info */
export async function getCurrentRound(): Promise<VoiceToolResult> {
  try {
    const highestId = await findLatestRoundId();
    if (highestId <= 0) {
      return { success: true, message: 'No rounds found on-chain yet.', data: null };
    }

    const round = await fetchRound(highestId);
    if (!round) {
      return { success: true, message: 'Could not fetch the latest round.', data: null };
    }

    const targetUsd = (round.targetPrice / 100).toFixed(2);
    const totalDart = formatPred(round.totalPool);

    if (round.resolved) {
      const outcome = round.outcome ? 'YES (above target)' : 'NO (below target)';
      const yesPoolDart = formatPred(round.yesPool);
      const noPoolDart = formatPred(round.noPool);
      return {
        success: true,
        message: `Round #${round.id} is resolved. Target was $${targetUsd}. Outcome: ${outcome}. Total pool: ${totalDart} USDCx (YES: ${yesPoolDart}, NO: ${noPoolDart}). Next round should start soon.`,
        data: round,
      };
    }

    const secsLeft = Math.max(0, Math.floor((round.endTime - Date.now()) / 1000));
    const mins = Math.floor(secsLeft / 60);
    const secs = secsLeft % 60;
    const timeStr = secsLeft > 0 ? `${mins}m ${secs}s left` : 'Resolving soon';

    return {
      success: true,
      message: `Round #${round.id} is active. BTC target: $${targetUsd}. ${timeStr}. Dark pool total: ${totalDart} USDCx (per-side breakdown hidden until resolution).`,
      data: round,
    };
  } catch (error: any) {
    return { success: false, message: 'Failed to fetch current round.', error: error.message };
  }
}

/** Get recent round history */
export async function getRoundHistory(): Promise<VoiceToolResult> {
  try {
    const highestId = await findLatestRoundId();
    if (highestId <= 0) {
      return { success: true, message: 'No rounds found.', data: [] };
    }

    const startId = Math.max(0, highestId - 4);
    const ids = Array.from({ length: highestId - startId + 1 }, (_, i) => startId + i);
    const rounds = await Promise.all(ids.map(id => fetchRound(id)));

    const resolved = rounds.filter((r): r is RoundState => !!r && r.resolved);
    if (resolved.length === 0) {
      return { success: true, message: 'No resolved rounds yet.', data: [] };
    }

    const list = resolved
      .sort((a, b) => b.id - a.id)
      .slice(0, 5)
      .map(r => {
        const outcome = r.outcome ? 'YES' : 'NO';
        const targetUsd = (r.targetPrice / 100).toFixed(2);
        return `#${r.id}: Target $${targetUsd} → ${outcome} won | Pool: ${formatPred(r.totalPool)} USDCx`;
      })
      .join('\n');

    return {
      success: true,
      message: `Recent rounds:\n${list}`,
      data: resolved,
    };
  } catch (error: any) {
    return { success: false, message: 'Failed to fetch round history.', error: error.message };
  }
}

/** Get wallet balance (ALEO credits + USDCx tokens) */
export async function getWalletBalance(publicKey: string | undefined): Promise<VoiceToolResult> {
  try {
    if (!publicKey) {
      return {
        success: false,
        message: 'Wallet not connected. Please connect your Leo wallet first.',
        error: 'No wallet connected',
      };
    }

    const [aleoBalance, usdcxBalance] = await Promise.all([
      fetchAleoBalance(publicKey),
      fetchUsdcxBalance(publicKey),
    ]);

    const positions = loadPositions();
    const activeCount = positions.filter(p => !p.claimed).length;
    const totalStaked = positions.reduce(
      (sum, p) => sum + Math.max(p.yesDeposit, p.noDeposit),
      0
    );

    let message = `Your wallet:\n`;
    message += `ALEO USDCx: ${aleoBalance.toFixed(2)} ALEO\n`;
    message += `USDCx Balance: ${(usdcxBalance).toFixed(0)} USDCx\n`;
    if (totalStaked > 0) {
      message += `Staked in rounds: ${formatPred(totalStaked)} USDCx\n`;
    }
    if (activeCount > 0) {
      message += `Active positions: ${activeCount}`;
    }

    return {
      success: true,
      message,
      data: { aleoBalance, usdcxBalance, activeCount, totalStaked },
    };
  } catch (error: any) {
    return { success: false, message: 'Failed to fetch wallet balance.', error: error.message };
  }
}

/** Get user's active positions in current/recent rounds */
export async function getActivePositions(publicKey: string | undefined): Promise<VoiceToolResult> {
  try {
    if (!publicKey) {
      return {
        success: false,
        message: 'Wallet not connected. Please connect your Leo wallet first.',
        error: 'No wallet connected',
      };
    }

    const positions = loadPositions();
    if (positions.length === 0) {
      return { success: true, message: 'You have no positions. Place a bet on the markets page!', data: [] };
    }

    // Fetch round data for each position
    const roundIds = [...new Set(positions.map(p => p.roundId))];
    const rounds = await Promise.all(roundIds.map(id => fetchRound(id)));
    const roundMap = new Map<number, RoundState>();
    for (const r of rounds) {
      if (r) roundMap.set(r.id, r);
    }

    const lines = positions.map(pos => {
      const round = roundMap.get(pos.roundId);
      const side = pos.yesDeposit > 0 ? 'YES' : 'NO';
      const deposit = Math.max(pos.yesDeposit, pos.noDeposit);

      if (!round) return `Round #${pos.roundId}: ${formatPred(deposit)} USDCx on ${side} (data unavailable)`;

      const targetUsd = (round.targetPrice / 100).toFixed(2);

      if (round.resolved) {
        const winningSide = round.outcome ? 'YES' : 'NO';
        const won = side === winningSide;
        if (won) {
          const totalPool = round.yesPool + round.noPool;
          const winPool = round.outcome ? round.yesPool : round.noPool;
          const payout = winPool > 0 ? (deposit / winPool) * totalPool * 0.9 : 0;
          return `Round #${pos.roundId} ($${targetUsd}): ${formatPred(deposit)} USDCx on ${side} → WON ${formatPred(payout)} USDCx${pos.claimed ? ' (claimed)' : ' (claimable!)'}`;
        }
        return `Round #${pos.roundId} ($${targetUsd}): ${formatPred(deposit)} USDCx on ${side} → LOST`;
      }

      return `Round #${pos.roundId} ($${targetUsd}): ${formatPred(deposit)} USDCx on ${side} (active — dark pool)`;
    });

    const totalStaked = positions.reduce((s, p) => s + Math.max(p.yesDeposit, p.noDeposit), 0);

    return {
      success: true,
      message: `Your ${positions.length} positions:\n${lines.join('\n')}\n\nTotal staked: ${formatPred(totalStaked)} USDCx`,
      data: positions,
    };
  } catch (error: any) {
    return { success: false, message: 'Failed to fetch positions.', error: error.message };
  }
}

/** Validate a bet on the current active round (does NOT execute) */
export async function prepareBet(
  publicKey: string | undefined,
  side: 'YES' | 'NO',
  amount: number
): Promise<VoiceToolResult> {
  try {
    if (!publicKey) {
      return { success: false, message: 'Please connect your wallet first.', error: 'No wallet connected' };
    }
    if (amount <= 0) {
      return { success: false, message: 'Bet amount must be greater than 0 USDCx.', error: 'Invalid amount' };
    }

    const highestId = await findLatestRoundId();
    const round = highestId > 0 ? await fetchRound(highestId) : null;

    if (!round || round.resolved) {
      return { success: false, message: 'No active round right now. Wait for the next round to start.', error: 'No active round' };
    }

    const secsLeft = Math.max(0, Math.floor((round.endTime - Date.now()) / 1000));
    if (secsLeft <= 0) {
      return { success: false, message: 'This round is about to resolve. Wait for the next round.', error: 'Round ending' };
    }

    const microAmount = amount * PRED_MULTIPLIER;
    const targetUsd = (round.targetPrice / 100).toFixed(2);

    // In dark pool mode, we can't give exact payout estimates since per-side pools are hidden
    const message = `Ready to place bet on Round #${round.id}:

BTC Target: $${targetUsd}
Side: ${side} (BTC will be ${side === 'YES' ? 'above' : 'below'} target)
Amount: ${amount} USDCx
Time left: ${Math.floor(secsLeft / 60)}m ${secsLeft % 60}s
Dark Pool Total: ${formatPred(round.totalPool)} USDCx

Note: Your bet side is PRIVATE — encrypted in your BetSlot record. Per-side pool breakdown is hidden until resolution.

Use the betting panel on the Markets page to complete this bet.`;

    return {
      success: true,
      message,
      data: { roundId: round.id, side, amount },
    };
  } catch (error: any) {
    return { success: false, message: 'Failed to prepare bet.', error: error.message };
  }
}

/** Analyze portfolio performance across all rounds */
export async function analyzePortfolio(publicKey: string | undefined): Promise<VoiceToolResult> {
  try {
    if (!publicKey) {
      return { success: false, message: 'Please connect your wallet to analyze your portfolio.', error: 'No wallet connected' };
    }

    const positions = loadPositions();
    if (positions.length === 0) {
      return { success: true, message: 'No positions yet. Start by placing a bet on the markets page!', data: {} };
    }

    // Fetch round data for all positions
    const roundIds = [...new Set(positions.map(p => p.roundId))];
    const rounds = await Promise.all(roundIds.map(id => fetchRound(id)));
    const roundMap = new Map<number, RoundState>();
    for (const r of rounds) {
      if (r) roundMap.set(r.id, r);
    }

    let totalInvested = 0;
    let totalPnL = 0;
    let wins = 0;
    let losses = 0;
    let active = 0;
    let claimable = 0;

    for (const pos of positions) {
      const round = roundMap.get(pos.roundId);
      const deposit = Math.max(pos.yesDeposit, pos.noDeposit);
      totalInvested += deposit;

      if (!round || !round.resolved) {
        active++;
        continue;
      }

      const userSide = pos.yesDeposit > 0 ? 'YES' : 'NO';
      const winningSide = round.outcome ? 'YES' : 'NO';

      if (userSide === winningSide) {
        wins++;
        const totalPool = round.yesPool + round.noPool;
        const winPool = round.outcome ? round.yesPool : round.noPool;
        const payout = winPool > 0 ? (deposit / winPool) * totalPool * 0.9 : 0;
        totalPnL += payout - deposit;
        if (!pos.claimed) claimable += payout;
      } else {
        losses++;
        totalPnL -= deposit;
      }
    }

    const resolvedCount = wins + losses;
    const winRate = resolvedCount > 0 ? ((wins / resolvedCount) * 100).toFixed(0) : '0';
    const roi = totalInvested > 0 ? ((totalPnL / totalInvested) * 100).toFixed(1) : '0.0';

    const message = `Portfolio Analysis:

Total Positions: ${positions.length}
Active: ${active} | Resolved: ${resolvedCount} (${wins} wins, ${losses} losses)
Win Rate: ${winRate}%

Total Invested: ${formatPred(totalInvested)} USDCx
P&L: ${totalPnL >= 0 ? '+' : ''}${formatPred(totalPnL)} USDCx
ROI: ${roi}%${claimable > 0 ? `\nClaimable: ${formatPred(claimable)} USDCx` : ''}`;

    return {
      success: true,
      message,
      data: {
        totalPositions: positions.length,
        active,
        wins,
        losses,
        winRate: parseFloat(winRate),
        totalInvested,
        totalPnL,
        roi: parseFloat(roi),
        claimable,
      },
    };
  } catch (error: any) {
    return { success: false, message: 'Failed to analyze portfolio.', error: error.message };
  }
}
