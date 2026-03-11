'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { motion } from 'framer-motion';
import { Check, ExternalLink, Lock, Trophy, X } from 'lucide-react';
import { executeWithRetry } from '@/lib/walletExecution';
import {
  MIRROR_PROGRAM,
  fetchMirrorOutcome,
  loadMirrorPositions,
  markMirrorClaimed,
  markMirrorForfeited,
  markMirrorRefunded,
  resolveMirrorReceipt,
  type MirrorStoredPosition,
} from '@/lib/mirrorMarkets';

function formatPred(microAmount: number) {
  return (microAmount / 1_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

interface MirrorPortfolioPanelProps {
  refreshTrigger?: number;
}

export default function MirrorPortfolioPanel({ refreshTrigger = 0 }: MirrorPortfolioPanelProps) {
  const { executeTransaction, requestRecords } = useWallet();
  const [positions, setPositions] = useState<MirrorStoredPosition[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      const nextPositions = loadMirrorPositions();
      const uniqueMarketIds = [...new Set(nextPositions.map((position) => position.marketId))];

      const outcomePairs = await Promise.all(
        uniqueMarketIds.map(async (marketId) => [marketId, await fetchMirrorOutcome(marketId)] as const)
      );

      if (cancelled) return;

      setPositions(nextPositions);
      setOutcomes(Object.fromEntries(outcomePairs));
      setLoading(false);
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [refreshTrigger]);

  const sortedPositions = useMemo(
    () => [...positions].sort((a, b) => b.timestamp - a.timestamp),
    [positions]
  );

  async function settlePosition(position: MirrorStoredPosition, action: 'claim' | 'forfeit' | 'refund') {
    if (!executeTransaction || !requestRecords) {
      setErrorById((prev) => ({
        ...prev,
        [position.positionId]: 'Wallet record access is required to settle mirrored positions',
      }));
      return;
    }

    setSettlingId(position.positionId);
    setErrorById((prev) => ({ ...prev, [position.positionId]: '' }));

    try {
      const receipt = await resolveMirrorReceipt({ requestRecords }, position.marketId);
      if (!receipt) {
        throw new Error('Mirror receipt not found in wallet records');
      }

      await executeWithRetry(() =>
        executeTransaction({
          program: MIRROR_PROGRAM,
          function: action,
          inputs: [receipt],
          fee: action === 'forfeit' ? 500_000 : 2_000_000,
          privateFee: false,
        })
      );

      if (action === 'claim') {
        markMirrorClaimed(position.positionId);
      } else if (action === 'refund') {
        markMirrorRefunded(position.positionId);
      } else {
        markMirrorForfeited(position.positionId);
      }

      setPositions(loadMirrorPositions());
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to ${action} mirror position`;
      setErrorById((prev) => ({ ...prev, [position.positionId]: message }));
    } finally {
      setSettlingId(null);
    }
  }

  if (loading) {
    return (
      <div className="bg-neutral-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-5">
        <p className="text-sm text-gray-500">Loading mirrored positions...</p>
      </div>
    );
  }

  if (sortedPositions.length === 0) {
    return null;
  }

  return (
    <div className="bg-neutral-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-black text-gray-500 uppercase tracking-[0.2em]">
            Mirrored Market Positions
          </h3>
          <p className="mt-1 text-sm text-gray-400">
            v13 positions mirrored from public markets on Aleo, with hidden-side betting, shielded payouts, and private-room settlement flows.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {sortedPositions.map((position, index) => {
          const outcome = outcomes[position.marketId] || 0;
          const canceled = outcome === 3;
          const resolved = outcome === 1 || outcome === 2 || canceled;
          const winningSide = outcome === 1 ? 'YES' : outcome === 2 ? 'NO' : null;
          const isWinner = resolved && winningSide === position.side;
          const canClaim = resolved && isWinner && !position.claimed;
          const canForfeit = !canceled && resolved && !isWinner && !position.forfeited;
          const canRefund = canceled && !position.refunded;

          return (
            <motion.div
              key={position.positionId}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
              className="rounded-2xl border border-white/6 bg-white/[0.03] p-4"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-off-blue/15 bg-off-blue/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-off-blue">
                      Mirror #{position.marketId}
                    </span>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.24em] ${
                      canceled
                        ? 'border-off-blue/15 bg-off-blue/10 text-off-blue'
                        : resolved
                        ? isWinner
                          ? 'border-new-mint/15 bg-new-mint/10 text-new-mint'
                          : 'border-off-red/15 bg-off-red/10 text-off-red'
                        : 'border-white/8 bg-white/[0.03] text-gray-400'
                    }`}>
                      {canceled ? 'Cancelled' : resolved ? `${winningSide} won` : 'Pending'}
                    </span>
                  </div>

                  <p className="truncate text-base font-bold text-white">
                    {position.question}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-400">
                    <span className="inline-flex items-center gap-1">
                      <Lock className="h-3 w-3 text-sky-400" />
                      {position.side} hidden until settlement
                    </span>
                    <span>{formatPred(position.amount)} USDCx staked</span>
                    <span>{formatPred(position.payout)} USDCx locked payout</span>
                    <Link
                      href={`/markets/${position.marketId}`}
                      className="inline-flex items-center gap-1 text-off-blue hover:text-white transition-colors"
                    >
                      Open detail
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                </div>

                <div className="flex flex-col items-start gap-2 lg:items-end">
                  {position.claimed && (
                    <div className="inline-flex items-center gap-1 text-xs font-bold text-new-mint">
                      <Trophy className="h-3.5 w-3.5" />
                      Claimed to private USDCx
                    </div>
                  )}

                  {position.forfeited && (
                    <div className="inline-flex items-center gap-1 text-xs font-bold text-gray-400">
                      <X className="h-3.5 w-3.5" />
                      Forfeited
                    </div>
                  )}

                  {position.refunded && (
                    <div className="inline-flex items-center gap-1 text-xs font-bold text-off-blue">
                      <Check className="h-3.5 w-3.5" />
                      Refunded privately
                    </div>
                  )}

                  {canClaim && (
                    <div className="flex flex-col items-start gap-2 lg:items-end">
                      <button
                        onClick={() => settlePosition(position, 'claim')}
                        disabled={settlingId === position.positionId}
                        className="rounded-xl border border-new-mint/20 bg-new-mint/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-new-mint transition-colors hover:bg-new-mint/15 disabled:opacity-50"
                      >
                        {settlingId === position.positionId ? 'Claiming...' : 'Claim Privately'}
                      </button>
                      <p className="max-w-[240px] text-[11px] leading-relaxed text-gray-500">
                        Winning claims mint a private USDCx record in your wallet instead of increasing your public balance.
                      </p>
                    </div>
                  )}

                  {canForfeit && (
                    <button
                      onClick={() => settlePosition(position, 'forfeit')}
                      disabled={settlingId === position.positionId}
                      className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-gray-300 transition-colors hover:text-white disabled:opacity-50"
                    >
                      {settlingId === position.positionId ? 'Forfeiting...' : 'Forfeit'}
                    </button>
                  )}

                  {canRefund && (
                    <div className="flex flex-col items-start gap-2 lg:items-end">
                      <button
                        onClick={() => settlePosition(position, 'refund')}
                        disabled={settlingId === position.positionId}
                        className="rounded-xl border border-off-blue/20 bg-off-blue/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-off-blue transition-colors hover:bg-off-blue/15 disabled:opacity-50"
                      >
                        {settlingId === position.positionId ? 'Refunding...' : 'Refund Privately'}
                      </button>
                      <p className="max-w-[240px] text-[11px] leading-relaxed text-gray-500">
                        Cancelled markets return your stake as a private USDCx record.
                      </p>
                    </div>
                  )}

                  {errorById[position.positionId] && (
                    <p className="text-xs text-off-red">{errorById[position.positionId]}</p>
                  )}

                  {resolved && !canClaim && !canForfeit && !canRefund && !position.claimed && !position.forfeited && !position.refunded && (
                    <div className="inline-flex items-center gap-1 text-xs text-gray-400">
                      <Check className="h-3.5 w-3.5" />
                      Settled
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
