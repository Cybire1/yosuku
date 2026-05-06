// @ts-nocheck
// Voice tools for Sui DeepBook Predict
import { loadPositions } from '@/lib/roundHelpers';
import {
  formatPred,
  PRED_MULTIPLIER,
  type RoundState,
} from '@/lib/predictionContract';
import { formatStrike } from '@/lib/roundHelpers';
import { PREDICT_SERVER } from '@/lib/sui/constants';

export interface VoiceToolResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

/** Get current active oracle markets */
export async function getCurrentRound(): Promise<VoiceToolResult> {
  try {
    const res = await fetch(`${PREDICT_SERVER}/oracles`);
    if (!res.ok) return { success: false, message: 'Failed to fetch oracles.', error: `HTTP ${res.status}` };
    const oracles = await res.json();

    const active = oracles.filter((o: any) => o.status === 'active');
    if (active.length === 0) {
      return { success: true, message: 'No active markets right now.', data: null };
    }

    const nearest = active.sort((a: any, b: any) => a.expiry - b.expiry)[0];
    const expiryDate = new Date(nearest.expiry * 1000).toLocaleString();

    return {
      success: true,
      message: `Active market: ${nearest.underlying_asset} — Strike: ${formatStrike(nearest.min_strike)}, Expires: ${expiryDate}. ${active.length} total active markets.`,
      data: nearest,
    };
  } catch (error: any) {
    return { success: false, message: 'Failed to fetch current market.', error: error.message };
  }
}

/** Get recent market history */
export async function getRoundHistory(): Promise<VoiceToolResult> {
  try {
    const res = await fetch(`${PREDICT_SERVER}/oracles`);
    if (!res.ok) return { success: false, message: 'Failed to fetch markets.', error: `HTTP ${res.status}` };
    const oracles = await res.json();

    const settled = oracles.filter((o: any) => o.status === 'settled').slice(0, 5);
    if (settled.length === 0) {
      return { success: true, message: 'No settled markets yet.', data: [] };
    }

    const list = settled.map((o: any) => {
      const settlement = o.settlement_price ? formatStrike(o.settlement_price) : 'N/A';
      return `${o.underlying_asset} — Strike: ${formatStrike(o.min_strike)} → Settled at ${settlement}`;
    }).join('\n');

    return {
      success: true,
      message: `Recent settled markets:\n${list}`,
      data: settled,
    };
  } catch (error: any) {
    return { success: false, message: 'Failed to fetch market history.', error: error.message };
  }
}

/** Get wallet info */
export async function getWalletBalance(publicKey: string | undefined): Promise<VoiceToolResult> {
  try {
    if (!publicKey) {
      return {
        success: false,
        message: 'Wallet not connected. Please connect your Sui wallet first.',
        error: 'No wallet connected',
      };
    }

    const positions = loadPositions();
    const activeCount = positions.filter(p => !p.claimed).length;
    const totalStaked = positions.reduce(
      (sum, p) => sum + p.quantity,
      0
    );

    let message = `Your wallet: ${publicKey.slice(0, 8)}...${publicKey.slice(-4)}\n`;
    if (totalStaked > 0) {
      message += `Staked in positions: ${formatPred(totalStaked)} DUSDC\n`;
    }
    if (activeCount > 0) {
      message += `Active positions: ${activeCount}`;
    }

    return {
      success: true,
      message,
      data: { activeCount, totalStaked },
    };
  } catch (error: any) {
    return { success: false, message: 'Failed to fetch wallet info.', error: error.message };
  }
}

/** Get user's positions */
export async function getActivePositions(publicKey: string | undefined): Promise<VoiceToolResult> {
  try {
    if (!publicKey) {
      return {
        success: false,
        message: 'Wallet not connected. Please connect your Sui wallet first.',
        error: 'No wallet connected',
      };
    }

    const positions = loadPositions();
    if (positions.length === 0) {
      return { success: true, message: 'You have no positions. Place a trade on the markets page!', data: [] };
    }

    const lines = positions.map(pos => {
      const deposit = pos.quantity;
      return `Position: ${formatPred(deposit)} DUSDC on ${pos.direction}${pos.claimed ? ' (redeemed)' : ''}`;
    });

    const totalStaked = positions.reduce((s, p) => s + p.quantity, 0);

    return {
      success: true,
      message: `Your ${positions.length} positions:\n${lines.join('\n')}\n\nTotal staked: ${formatPred(totalStaked)} DUSDC`,
      data: positions,
    };
  } catch (error: any) {
    return { success: false, message: 'Failed to fetch positions.', error: error.message };
  }
}

/** Validate a bet (does NOT execute) */
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
      return { success: false, message: 'Amount must be greater than 0 DUSDC.', error: 'Invalid amount' };
    }

    const direction = side === 'YES' ? 'UP' : 'DOWN';

    const message = `Ready to place trade:

Direction: ${direction}
Amount: ${amount} DUSDC

Use the trading panel on the Markets page to complete this trade.`;

    return {
      success: true,
      message,
      data: { side, direction, amount },
    };
  } catch (error: any) {
    return { success: false, message: 'Failed to prepare trade.', error: error.message };
  }
}

/** Analyze portfolio performance */
export async function analyzePortfolio(publicKey: string | undefined): Promise<VoiceToolResult> {
  try {
    if (!publicKey) {
      return { success: false, message: 'Please connect your wallet to analyze your portfolio.', error: 'No wallet connected' };
    }

    const positions = loadPositions();
    if (positions.length === 0) {
      return { success: true, message: 'No positions yet. Start by placing a trade on the markets page!', data: {} };
    }

    let totalInvested = 0;
    let active = 0;

    for (const pos of positions) {
      totalInvested += pos.quantity;
      if (!pos.claimed) active++;
    }

    const message = `Portfolio Analysis:

Total Positions: ${positions.length}
Active: ${active}
Total Invested: ${formatPred(totalInvested)} DUSDC`;

    return {
      success: true,
      message,
      data: {
        totalPositions: positions.length,
        active,
        totalInvested,
      },
    };
  } catch (error: any) {
    return { success: false, message: 'Failed to analyze portfolio.', error: error.message };
  }
}
