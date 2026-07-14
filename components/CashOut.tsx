'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, LogOut } from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useManager, useManagerBalance, useTradingVaultBalance } from '@/lib/sui/hooks';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import { redeemPositionToTradingBalanceTx } from '@/lib/sui/predictClient';
import { fetchOnChainQuote } from '@/lib/sui/onchainQuote';
import { loadPositions, removePosition, type LocalPosition } from '@/lib/roundHelpers';
import { recordPnl } from '@/lib/dailyStop';
import { humanizeTxError } from '@/lib/errorMessages';
import { FLOAT_SCALING, DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import { useToast } from './Toast';

/**
 * Mid-round exit: shows the user's open positions in THIS market with their
 * live exit value (on-chain bid via get_trade_amounts) and a one-tap
 * "cash out" that redeems at the current bid before settlement.
 */
interface CashOutProps {
  oracleId: string;
  expiry: number;
  isActive: boolean;
  embedded?: boolean;
}

interface QuotedPosition extends LocalPosition {
  exitValue: number | null; // DUSDC, live
}

export default function CashOut({ oracleId, expiry, isActive, embedded = false }: CashOutProps) {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { submit } = useSmartSubmit();
  const { manager } = useManager();
  const { refresh: refreshManagerBalance } = useManagerBalance(manager?.manager_id ?? null);
  const { refresh: refreshTradingVaultBalance } = useTradingVaultBalance();
  const { toast } = useToast();

  const [positions, setPositions] = useState<QuotedPosition[]>([]);
  const [busy, setBusy] = useState<number | null>(null); // position timestamp in flight
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const mine = loadPositions().filter(
      p => p.oracleId === oracleId && !p.claimed && p.expiry > Date.now(),
    );
    const quoted = await Promise.all(mine.map(async (p) => {
      try {
        const q = await fetchOnChainQuote({
          oracleId,
          expiry: p.expiry,
          strike: p.strike,
          isUp: p.direction === 'UP',
          quantity: p.quantity,
        });
        return { ...p, exitValue: q.redeemPayout };
      } catch {
        return { ...p, exitValue: null };
      }
    }));
    setPositions(quoted);
  }, [oracleId]);

  useEffect(() => {
    if (!isActive || !address) { setPositions([]); return; }
    refresh();
    const iv = setInterval(refresh, 10_000);
    return () => clearInterval(iv);
  }, [isActive, address, refresh]);

  const cashOut = async (p: QuotedPosition) => {
    if (!manager) return;
    setBusy(p.timestamp);
    setError('');
    try {
      await submit(() => redeemPositionToTradingBalanceTx(
        manager.manager_id,
        oracleId,
        BigInt(p.expiry),
        BigInt(p.strike),
        p.direction,
        BigInt(p.quantity),
        address!,
      ));
      removePosition(p.oracleId, p.timestamp);
      if (p.exitValue !== null) recordPnl(p.exitValue - p.cost / DUSDC_MULTIPLIER);
      refreshManagerBalance();
      refreshTradingVaultBalance();
      toast(
        `Cashed out ${p.exitValue !== null ? p.exitValue.toFixed(2) : ''} DUSDC to your trading account.`,
        'success',
      );
      refresh();
    } catch (err: unknown) {
      console.error('Cash out error:', err);
      setError(humanizeTxError(err).title);
    } finally {
      setBusy(null);
    }
  };

  if (!isActive || !address) return null;
  if (positions.length === 0) {
    return embedded ? (
      <div className="text-center py-10 text-[12px] text-gray-500 font-mono leading-relaxed">
        No open positions in this market.<br />
        Bets you place show here to cash out before close.
      </div>
    ) : null;
  }

  return (
    <div className={embedded ? 'space-y-3' : 'rounded-2xl border border-white/[0.08] bg-neutral-900/60 p-4 space-y-3'}>
      <h3 className="font-mono text-[9px] tracking-[0.16em] uppercase text-gray-600">
        Your position
      </h3>
      {positions.map((p) => {
        const strikeDollars = p.strike / FLOAT_SCALING;
        const qty = p.quantity / DUSDC_MULTIPLIER;
        const cost = p.cost / DUSDC_MULTIPLIER;
        const pnl = p.exitValue !== null ? p.exitValue - cost : null;
        return (
          <div key={p.timestamp} className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className={`font-bold ${p.direction === 'UP' ? 'text-profit' : 'text-loss'}`}>
                {p.direction} {qty.toFixed(2)} @ ${strikeDollars.toLocaleString()}
              </span>
              <span className="font-mono text-white">
                {p.exitValue !== null ? `worth ${p.exitValue.toFixed(2)} now` : 'quoting…'}
              </span>
            </div>
            {pnl !== null && (
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-500">vs {cost.toFixed(2)} paid</span>
                <span className={`font-mono ${pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} DUSDC
                </span>
              </div>
            )}
            <button
              onClick={() => cashOut(p)}
              disabled={busy !== null || p.exitValue === null || !manager}
              className="w-full py-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] border border-white/10 hover:border-white/20 text-white text-xs font-bold uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {busy === p.timestamp ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Cashing out...
                </>
              ) : (
                <>
                  <LogOut className="w-3.5 h-3.5" />
                  Cash out{p.exitValue !== null ? ` — ${p.exitValue.toFixed(2)} DUSDC` : ''}
                </>
              )}
            </button>
          </div>
        );
      })}
      {error && <p className="text-[11px] text-loss break-words">{error}</p>}
      <p className="text-[10px] text-gray-600">
        Exit at the live bid — no need to wait for close.
      </p>
    </div>
  );
}
