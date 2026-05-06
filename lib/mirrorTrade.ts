import { PRED_MULTIPLIER } from './predictionContract';
import {
  createMirrorPositionId,
  saveMirrorPosition,
  type MirrorMarketData,
  type MirrorSide,
} from './mirrorMarkets';

interface SubmitMirrorBetArgs {
  market: MirrorMarketData;
  side: MirrorSide;
  microAmount: number;
  balance: number;
  roomId?: string;
  onBalance?: (nextBalance: number) => void;
}

export function formatPred(microAmount: number) {
  return (microAmount / PRED_MULTIPLIER).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function getMirrorPayout(
  market: MirrorMarketData | null,
  side: MirrorSide,
  microAmount: number,
) {
  if (!market || microAmount <= 0) return 0;
  const multiplier = side === 'YES' ? market.yesMultiplierBps : market.noMultiplierBps;
  return Math.floor((microAmount * multiplier) / 10000);
}

export async function submitMirrorBet({
  market,
  side,
  microAmount,
  balance,
  roomId,
  onBalance,
}: SubmitMirrorBetArgs) {
  const payout = getMirrorPayout(market, side, microAmount);

  // Mirror trades are saved locally — on-chain Sui integration TBD
  const newBalance = Math.max(0, balance - microAmount);
  onBalance?.(newBalance);

  saveMirrorPosition({
    positionId: createMirrorPositionId(market.marketId),
    marketId: market.marketId,
    sourceMarketId: market.sourceMarketId,
    question: market.question,
    description: market.description,
    slug: market.slug,
    category: market.category,
    roomId,
    side,
    amount: microAmount,
    payout,
    timestamp: Date.now(),
    claimed: false,
    forfeited: false,
    refunded: false,
    outcomeLabels: market.outcomeLabels,
  });

  return {
    payout,
    balanceAfter: newBalance,
  };
}
