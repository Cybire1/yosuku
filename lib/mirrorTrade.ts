import { PRED_MULTIPLIER, setOptimisticBalance } from './predictionContract';
import { executeWithRetry } from './walletExecution';
import {
  MIRROR_PROGRAM,
  createMirrorPositionId,
  saveMirrorPosition,
  type MirrorMarketData,
  type MirrorSide,
} from './mirrorMarkets';

interface ExecuteTransactionResult {
  transactionId?: string;
}

interface SubmitMirrorBetArgs {
  executeTransaction: (params: {
    program: string;
    function: string;
    inputs: string[];
    fee: number;
    privateFee: boolean;
  }) => Promise<ExecuteTransactionResult | undefined>;
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
  executeTransaction,
  market,
  side,
  microAmount,
  balance,
  roomId,
  onBalance,
}: SubmitMirrorBetArgs) {
  const payout = getMirrorPayout(market, side, microAmount);

  const result = await executeWithRetry(() =>
    executeTransaction({
      program: MIRROR_PROGRAM,
      function: 'bet',
      inputs: [
        market.vaultAddress!,
        `${market.marketId}u64`,
        `${microAmount}u128`,
        `${market.yesMultiplierBps}u64`,
        `${market.noMultiplierBps}u64`,
        side === 'YES' ? 'true' : 'false',
      ],
      fee: 2_000_000,
      privateFee: false,
    })
  );

  const newBalance = Math.max(0, balance - microAmount);
  setOptimisticBalance(newBalance);
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
    ...(result?.transactionId ? { transactionId: result.transactionId } : {}),
  });

  return {
    payout,
    balanceAfter: newBalance,
    transactionId: result?.transactionId,
  };
}
