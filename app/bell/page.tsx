'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import Header from '@/components/Header';
import GrainOverlay from '@/components/GrainOverlay';
import TheBell from '@/components/TheBell';
import { useOracles, useOraclePrices, useManager, useDUSDCBalance, useManagerBalance } from '@/lib/sui/hooks';
import { createManagerTx, depositAndMintTx } from '@/lib/sui/predictClient';
import { fetchOnChainQuote, type OnChainQuote } from '@/lib/sui/onchainQuote';
import { fetchManagerForAddress } from '@/lib/sui/predictApi';
import { nearestStrike } from '@/lib/roundHelpers';
import { FLOAT_SCALING, DUSDC_MULTIPLIER } from '@/lib/sui/constants';

type Side = 'UP' | 'DOWN';
type Step = 'idle' | 'creating-manager' | 'minting' | 'success' | 'error';
const SIZES = [5, 10, 25];

export default function BellPage() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const client = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { active, loading: oraclesLoading } = useOracles();
  const { manager, refresh: refreshManager } = useManager();
  const { coins, balance: walletBalance, refresh: refreshBalance } = useDUSDCBalance();

  // The next bell = soonest-expiring active market.
  const oracle = useMemo(() => {
    const now = Date.now();
    return [...active]
      .filter((o) => o.expiry > now)
      .sort((a, b) => a.expiry - b.expiry)[0] ?? active[0] ?? null;
  }, [active]);

  const { prices } = useOraclePrices(oracle?.oracle_id ?? null);
  const { refresh: refreshManagerBalance } = useManagerBalance(manager?.manager_id ?? null);

  const [size, setSize] = useState(10);
  const [step, setStep] = useState<Step>('idle');
  const [ringingSide, setRingingSide] = useState<Side | null>(null);
  const [txDigest, setTxDigest] = useState('');
  const [error, setError] = useState('');
  const [quotes, setQuotes] = useState<{ up: OnChainQuote | null; down: OnChainQuote | null }>({ up: null, down: null });

  const forward = prices?.forward ?? prices?.spot ?? null; // 1e9-scaled
  const strike = useMemo(() => {
    if (!oracle || !forward) return null;
    return nearestStrike(forward, oracle.min_strike, oracle.tick_size); // 1e9-scaled
  }, [oracle, forward]);
  const strikeUsd = strike ? strike / FLOAT_SCALING : 0;
  const forwardUsd = forward ? forward / FLOAT_SCALING : 0;
  const sizeMicro = size * DUSDC_MULTIPLIER;

  // Live exact cost for both sides.
  useEffect(() => {
    if (!oracle || !strike) return;
    let cancelled = false;
    (async () => {
      try {
        const [up, down] = await Promise.all([
          fetchOnChainQuote({ oracleId: oracle.oracle_id, expiry: oracle.expiry, strike, isUp: true, quantity: sizeMicro }),
          fetchOnChainQuote({ oracleId: oracle.oracle_id, expiry: oracle.expiry, strike, isUp: false, quantity: sizeMicro }),
        ]);
        if (!cancelled) setQuotes({ up, down });
      } catch {
        if (!cancelled) setQuotes({ up: null, down: null });
      }
    })();
    return () => { cancelled = true; };
  }, [oracle, strike, sizeMicro]);

  const ring = async (side: Side) => {
    if (!address || !oracle || !strike) return;
    setRingingSide(side);
    setError('');
    setTxDigest('');
    try {
      let managerId = manager?.manager_id;
      if (!managerId) {
        setStep('creating-manager');
        const res = await signAndExecute({ transaction: createManagerTx() });
        await client.waitForTransaction({ digest: res.digest });
        await refreshManager();
        const m = await fetchManagerForAddress(address);
        if (!m) throw new Error('Failed to create your manager');
        managerId = m.manager_id;
      }
      if (coins.length === 0 || walletBalance < sizeMicro) throw new Error('Not enough DUSDC in your wallet');

      setStep('minting');
      const tx = depositAndMintTx(
        managerId,
        coins.map((c) => c.coinObjectId),
        BigInt(sizeMicro),
        oracle.oracle_id,
        BigInt(oracle.expiry),
        BigInt(strike),
        side,
        BigInt(sizeMicro),
      );
      const res = await signAndExecute({ transaction: tx });
      await client.waitForTransaction({ digest: res.digest });
      setTxDigest(res.digest);
      setStep('success');
      refreshBalance();
      refreshManagerBalance();
      setTimeout(() => setStep('idle'), 6000);
    } catch (e: unknown) {
      setStep('error');
      setError(e instanceof Error ? e.message : 'Transaction failed');
    } finally {
      setRingingSide(null);
    }
  };

  const busy = step === 'creating-manager' || step === 'minting';
  const cents = (q: OnChainQuote | null) => (q ? `${q.mintCost.toFixed(2)} DUSDC` : '—');

  return (
    <>
      <Header />
      <GrainOverlay />
      <main className="page-hero min-h-screen">
        <div className="mx-auto max-w-2xl px-6 pt-28 pb-24 text-center">
          <div className="inline-flex items-center gap-2 mb-6">
            <span className="h-px w-7 bg-[var(--gray-700)]" />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--gray-500)]">The Bell · 予測</span>
            <span className="h-px w-7 bg-[var(--gray-700)]" />
          </div>

          <h1 className="page-title font-display text-5xl md:text-6xl font-extrabold tracking-tight mb-3">
            Ring the <span className="accent">Bell</span>
          </h1>

          {oraclesLoading || !oracle ? (
            <p className="text-[var(--gray-500)] mt-10">Finding the next bell…</p>
          ) : (
            <>
              <p className="text-[var(--gray-400)] mb-10">
                {oracle.underlying_asset || 'BTC'} settles when the bell rings. Take a side — one tap, your wallet signs.
              </p>

              {/* Bell + market */}
              <div className="flex flex-col items-center gap-4 mb-10">
                <div className="w-28 h-28">
                  <TheBell targetTime={oracle.expiry} roundDuration={900} />
                </div>
                <div className="font-mono text-sm text-[var(--gray-400)]">
                  forward <span className="text-white">${forwardUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  <span className="mx-2 text-[var(--gray-700)]">·</span>
                  strike <span className="text-white">${strikeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
              </div>

              {/* Size */}
              <div className="flex items-center justify-center gap-2 mb-6">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--gray-600)] mr-1">stake</span>
                {SIZES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSize(s)}
                    className={`px-4 py-1.5 rounded-full border font-mono text-sm transition-all ${
                      size === s
                        ? 'border-[var(--vermilion)] bg-[var(--vermilion)]/10 text-white'
                        : 'border-white/10 text-[var(--gray-500)] hover:text-white'
                    }`}
                  >
                    {s} DUSDC
                  </button>
                ))}
              </div>

              {/* The two convictions */}
              <div className="grid grid-cols-2 gap-4">
                {(['UP', 'DOWN'] as Side[]).map((side) => {
                  const isUp = side === 'UP';
                  const q = isUp ? quotes.up : quotes.down;
                  const ringingThis = ringingSide === side;
                  return (
                    <button
                      key={side}
                      onClick={() => ring(side)}
                      disabled={!address || busy}
                      className={`group relative overflow-hidden rounded-2xl border p-6 text-left transition-all disabled:opacity-50 ${
                        isUp
                          ? 'border-emerald-500/30 bg-emerald-500/[0.06] hover:bg-emerald-500/[0.12] hover:border-emerald-400/60'
                          : 'border-rose-500/30 bg-rose-500/[0.06] hover:bg-rose-500/[0.12] hover:border-rose-400/60'
                      }`}
                      data-cursor="up"
                    >
                      <div className={`font-display text-2xl font-bold ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isUp ? '↑ UP' : '↓ DOWN'}
                      </div>
                      <div className="mt-1 text-xs text-[var(--gray-500)]">
                        {isUp ? `above $${strikeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `below $${strikeUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                      </div>
                      <div className="mt-4 flex items-end justify-between">
                        <div>
                          <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--gray-600)]">cost · on-chain</div>
                          <div className="font-mono text-lg text-white">{cents(q)}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-[9px] uppercase tracking-wider text-[var(--gray-600)]">max payout</div>
                          <div className="font-mono text-sm text-[var(--gray-300)]">{size.toFixed(2)} DUSDC</div>
                        </div>
                      </div>
                      {ringingThis && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 font-mono text-xs text-white">
                          {step === 'creating-manager' ? 'creating account…' : 'ringing…'}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Status */}
              <div className="mt-6 min-h-[2.5rem]">
                {!address && (
                  <p className="text-sm text-[var(--gray-500)]">Connect your wallet to ring the bell.</p>
                )}
                {step === 'success' && txDigest && (
                  <a
                    href={`https://suiscan.xyz/testnet/tx/${txDigest}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block rounded-xl border border-emerald-600/40 bg-emerald-950/30 px-4 py-2 text-sm text-emerald-300"
                  >
                    🔔 Rung — view on Suiscan ↗
                  </a>
                )}
                {step === 'error' && error && (
                  <p className="text-sm text-rose-400">{error.slice(0, 140)}</p>
                )}
              </div>

              <div className="mt-10 font-mono text-[10px] text-[var(--gray-700)]">
                no settle() — the oracle settles you · powered by{' '}
                <a href="https://www.npmjs.com/package/@yosuku/predict" target="_blank" rel="noreferrer" className="text-[var(--gray-500)] hover:text-[var(--vermilion)]">@yosuku/predict</a>
                <span className="mx-2">·</span>
                <Link href="/markets" className="text-[var(--gray-500)] hover:text-white">all markets →</Link>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
