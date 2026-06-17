'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp,
  TrendingDown,
  Plus,
  X,
  Loader2,
  Check,
  AlertCircle,
  ChevronDown,
  Wallet,
  Layers,
  Zap,
  Trophy,
} from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import { useOracles, useDUSDCBalance } from '@/lib/sui/hooks';
import type { OracleData } from '@/lib/sui/predictApi';
import { FLOAT_SCALING, DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import {
  generateDisplayStrikeGrid,
  defaultStrike,
  getTimeRemaining,
  formatCountdown,
} from '@/lib/roundHelpers';
import {
  quoteParlay,
  openParlayTx,
  type ParlayLegSpec,
  type ParlayQuote,
  PARLAY_MARGIN_BPS,
  PARLAY_CORRELATION_BPS,
  PARLAY_MAX_LEGS,
} from '@/lib/sui/parlayClient';
import { humanizeTxError } from '@/lib/errorMessages';
import { useToast } from './Toast';
import Countdown from './Countdown';
import Tooltip from './Tooltip';

// One leg the builder is assembling. `null` strike → not yet configured.
interface DraftLeg {
  key: string;
  oracleId: string;
  expiry: number;
  strike: number | null;
  isUp: boolean;
}

type Step = 'idle' | 'placing' | 'success' | 'error';
type SolveMode = 'fixStake' | 'fixPayout';

const fmtUsd = (n: number) =>
  '$' + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

let legSeq = 0;
const newKey = () => `leg-${++legSeq}-${Date.now()}`;

export default function ParlayBuilder() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { submit } = useSmartSubmit();
  const { active, loading: oraclesLoading } = useOracles();
  const { balance: walletBalance, coins, refresh: refreshBalance } = useDUSDCBalance();
  const { toast } = useToast();

  // Only BTC bells are eligible (binary-only v1). Sorted soonest-first by useOracles.
  const btcBells = useMemo(
    () => active.filter((o) => (o.underlying_asset || 'BTC').toUpperCase() === 'BTC'),
    [active],
  );

  const [legs, setLegs] = useState<DraftLeg[]>([]);
  const [solveMode, setSolveMode] = useState<SolveMode>('fixStake');
  const [stakeInput, setStakeInput] = useState('5');
  const [payoutInput, setPayoutInput] = useState('40');

  const [quote, setQuote] = useState<ParlayQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteRetry, setQuoteRetry] = useState(0);

  const [step, setStep] = useState<Step>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [errorDetail, setErrorDetail] = useState('');
  const [txDigest, setTxDigest] = useState('');

  // ── leg authoring ──
  const strikeGridFor = useCallback((oracleId: string) => {
    const o = btcBells.find((b) => b.oracle_id === oracleId);
    if (!o) return { grid: [] as number[], oracle: null as OracleData | null };
    const grid = generateDisplayStrikeGrid(o.min_strike, o.tick_size, 21);
    return { grid, oracle: o };
  }, [btcBells]);

  const defaultStrikeFor = useCallback((o: OracleData) => {
    // No live spot here; center the grid and pick the middle line so the leg is
    // immediately quotable. The user can refine per leg.
    const grid = generateDisplayStrikeGrid(o.min_strike, o.tick_size, 21);
    return grid.length ? grid[Math.floor(grid.length / 2)] : o.min_strike;
  }, []);

  const addLeg = useCallback((oracleId?: string) => {
    setLegs((prev) => {
      if (prev.length >= PARLAY_MAX_LEGS) return prev;
      // Default to the next un-used bell (a fresh expiry → a real streak), else the soonest.
      const used = new Set(prev.map((l) => l.oracleId));
      const pick =
        (oracleId ? btcBells.find((b) => b.oracle_id === oracleId) : null) ||
        btcBells.find((b) => !used.has(b.oracle_id)) ||
        btcBells[0];
      if (!pick) return prev;
      return [
        ...prev,
        { key: newKey(), oracleId: pick.oracle_id, expiry: pick.expiry, strike: defaultStrikeFor(pick), isUp: true },
      ];
    });
  }, [btcBells, defaultStrikeFor]);

  const removeLeg = useCallback((key: string) => {
    setLegs((prev) => prev.filter((l) => l.key !== key));
  }, []);

  const patchLeg = useCallback((key: string, patch: Partial<DraftLeg>) => {
    setLegs((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }, []);

  // One-tap "BTC bell streak": UP at the 3 soonest distinct bells.
  const loadStreakPreset = useCallback(() => {
    const picks = btcBells.slice(0, PARLAY_MAX_LEGS);
    if (picks.length < 2) {
      toast('Need at least two live BTC bells for a streak parlay.', 'error');
      return;
    }
    setLegs(picks.map((o) => ({
      key: newKey(), oracleId: o.oracle_id, expiry: o.expiry, strike: defaultStrikeFor(o), isUp: true,
    })));
    setSolveMode('fixStake');
    setStakeInput('5');
  }, [btcBells, defaultStrikeFor, toast]);

  // Keep each draft leg's expiry in sync with its oracle (oracle list refreshes).
  // Return the SAME `prev` reference when nothing actually changed — otherwise
  // .map() always allocates a new array, setLegs always re-renders, and (paired
  // with a churning btcBells) this effect re-fires forever ("Maximum update depth").
  useEffect(() => {
    setLegs((prev) => {
      let changed = false;
      const next = prev.map((l) => {
        const o = btcBells.find((b) => b.oracle_id === l.oracleId);
        if (o && o.expiry !== l.expiry) { changed = true; return { ...l, expiry: o.expiry }; }
        return l;
      });
      return changed ? next : prev;
    });
  }, [btcBells]);

  // ── validity ──
  const allConfigured = legs.length >= 2 && legs.every((l) => l.strike !== null);
  const blockingLeg = legs.find((l) => l.strike === null);

  const legSpecs: ParlayLegSpec[] = useMemo(
    () =>
      legs
        .filter((l) => l.strike !== null)
        .map((l) => ({
          oracleId: l.oracleId,
          expiry: BigInt(l.expiry),
          strike: BigInt(l.strike as number),
          isUp: l.isUp,
        })),
    [legs],
  );

  // Stable signature so the quote effect only fires on real changes.
  const legSig = useMemo(
    () => legSpecs.map((l) => `${l.oracleId}:${l.strike}:${l.isUp}`).join('|'),
    [legSpecs],
  );

  const stakeMicro = Math.floor(parseFloat(stakeInput || '0') * DUSDC_MULTIPLIER);
  const payoutMicro = Math.floor(parseFloat(payoutInput || '0') * DUSDC_MULTIPLIER);
  const modeAmountValid = solveMode === 'fixStake' ? stakeMicro > 0 : payoutMicro > 0;

  // ── debounced combined quote (fans out the exact on-chain quote per leg) ──
  useEffect(() => {
    if (!allConfigured || !modeAmountValid) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError(null);
    const t = setTimeout(async () => {
      try {
        const q = await quoteParlay(
          legSpecs,
          solveMode === 'fixStake'
            ? { kind: 'fixStake', stake: BigInt(stakeMicro) }
            : { kind: 'fixPayout', maxPayout: BigInt(payoutMicro) },
          { marginBps: PARLAY_MARGIN_BPS, correlationBps: PARLAY_CORRELATION_BPS },
        );
        if (!cancelled) { setQuote(q); setQuoteError(null); }
      } catch (e) {
        if (!cancelled) { setQuote(null); setQuoteError(String(e)); }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legSig, solveMode, stakeMicro, payoutMicro, allConfigured, modeAmountValid, quoteRetry]);

  const stakeDisplay = quote ? Number(quote.stake) / DUSDC_MULTIPLIER : 0;
  const payoutDisplay = quote ? Number(quote.maxPayout) / DUSDC_MULTIPLIER : 0;
  const needStake = quote ? Number(quote.stake) : stakeMicro;
  const hasEnough = walletBalance >= needStake;

  // ── place ──
  const handlePlace = useCallback(async () => {
    if (!address || !quote || coins.length === 0) return;
    setErrorMsg(''); setErrorDetail(''); setTxDigest('');
    setStep('placing');
    try {
      if (walletBalance < Number(quote.stake)) {
        throw new Error('Not enough DUSDC in your wallet for the stake.');
      }
      const { digest } = await submit(() => openParlayTx({
        coinIds: coins.map((c) => c.coinObjectId),
        stake: quote.stake,
        legs: legSpecs,
        probBps: quote.probBps,
        maxPayout: quote.maxPayout,
      }));
      setTxDigest(digest);
      setStep('success');
      refreshBalance();
      toast(
        `Parlay placed — ${legs.length} legs, ${stakeDisplay.toFixed(2)} → ${payoutDisplay.toFixed(0)} DUSDC if every bell rings your way.`,
        'success',
      );
      setTimeout(() => { setStep('idle'); setLegs([]); }, 3500);
    } catch (err: unknown) {
      console.error('Parlay error:', err);
      setStep('error');
      const friendly = humanizeTxError(err);
      setErrorMsg(friendly.title);
      setErrorDetail(friendly.detail);
      toast(friendly.title, 'error');
    }
  }, [address, quote, coins, walletBalance, legSpecs, legs.length, stakeDisplay, payoutDisplay, submit, refreshBalance, toast]);

  if (!address) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-neutral-900/60 p-8 text-center">
        <Wallet className="w-8 h-8 text-gray-600 mx-auto mb-3" />
        <p className="text-sm text-gray-400 mb-1">Connect your wallet to build a parlay</p>
        <p className="text-xs text-gray-600">Sui Wallet required</p>
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-[1fr_400px] gap-6 items-start">
      {/* ── Left: the leg builder (the ledger plate) ── */}
      <div className="rounded-2xl border border-white/[0.08] bg-neutral-900/60 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <Layers className="w-4 h-4 text-vermilion" />
            <span className="font-display font-bold text-sm tracking-wide text-white">Your legs</span>
            <span className="font-mono text-[10px] text-gray-600">{legs.length}/{PARLAY_MAX_LEGS}</span>
          </div>
          <button
            onClick={loadStreakPreset}
            disabled={btcBells.length < 2}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-vermilion/30 bg-vermilion/[0.06] text-vermilion text-[11px] font-bold uppercase tracking-wider hover:bg-vermilion/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Zap className="w-3 h-3" />
            BTC bell streak
          </button>
        </div>

        <div className="p-5 space-y-3">
          {oraclesLoading && legs.length === 0 ? (
            <div className="py-12 text-center text-gray-600 text-sm font-mono">Loading bells…</div>
          ) : legs.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-gray-400 mb-1">No legs yet</p>
              <p className="text-xs text-gray-600 mb-4 max-w-[34ch] mx-auto leading-relaxed">
                Stack 2–3 BTC bells. The parlay pays out only if every leg lands — small stake, multiplied payout.
              </p>
              <button
                onClick={() => addLeg()}
                disabled={btcBells.length === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-vermilion text-white text-sm font-bold hover:bg-vermilion-d transition-colors disabled:opacity-40"
              >
                <Plus className="w-4 h-4" /> Add your first leg
              </button>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {legs.map((leg, i) => (
                <LegRow
                  key={leg.key}
                  index={i}
                  leg={leg}
                  oracle={btcBells.find((b) => b.oracle_id === leg.oracleId) ?? null}
                  bells={btcBells}
                  legProb={quote?.legProbs[i] ?? null}
                  strikeGridFor={strikeGridFor}
                  defaultStrikeFor={defaultStrikeFor}
                  onPatch={patchLeg}
                  onRemove={removeLeg}
                />
              ))}
            </AnimatePresence>
          )}

          {legs.length > 0 && legs.length < PARLAY_MAX_LEGS && (
            <button
              onClick={() => addLeg()}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-white/10 text-gray-500 text-xs font-bold uppercase tracking-wider hover:border-white/20 hover:text-gray-300 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add another bell
            </button>
          )}

          {blockingLeg && (
            <p className="text-[11px] text-amber-400/90 flex items-center gap-1.5">
              <AlertCircle className="w-3 h-3" /> Pick a strike for every leg to price the parlay.
            </p>
          )}
        </div>
      </div>

      {/* ── Right: the combined ticket (sticky) ── */}
      <div className="lg:sticky lg:top-[120px]">
        <div className="rounded-2xl border border-white/[0.08] bg-neutral-900/60 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
            <span className="font-display font-bold text-sm tracking-wide text-white">Ticket</span>
            <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-gray-600">予測 · parlay</span>
          </div>

          <div className="p-5 space-y-4">
            {legs.length < 2 ? (
              <p className="text-xs text-gray-500 text-center py-6 leading-relaxed">
                Add at least two legs to see your multiplied odds.
              </p>
            ) : (
              <>
                {/* The headline: the big multiplier (lottery framing) */}
                <div className="text-center py-2">
                  <div className="font-mono text-[9px] tracking-[0.2em] uppercase text-gray-600 mb-1">
                    Pays
                  </div>
                  <div className="font-display font-[800] leading-none text-vermilion text-5xl tracking-tight">
                    {quoteLoading ? (
                      <Loader2 className="w-9 h-9 animate-spin mx-auto text-vermilion/60" />
                    ) : quote ? (
                      `${quote.multiplier.toFixed(quote.multiplier >= 10 ? 0 : 1)}×`
                    ) : '—'}
                  </div>
                  {quote && !quoteLoading && (
                    <div className="font-mono text-[10px] text-gray-500 mt-2">
                      all {legs.length} legs must land · {(quote.combinedProb * 100).toFixed(2)}% combined
                    </div>
                  )}
                </div>

                {/* correlation badge */}
                {quote?.correlated && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-400/[0.06] border border-amber-400/15">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    <span className="text-[11px] text-amber-400/90 leading-snug">
                      Legs share a BTC bell — odds adjusted for correlation.
                    </span>
                  </div>
                )}

                {/* stake ↔ payout solver */}
                <div className="rounded-xl bg-white/[0.02] border border-white/5 p-3 space-y-3">
                  <div className="flex rounded-lg overflow-hidden border border-white/10 text-[11px] font-bold">
                    <button
                      onClick={() => setSolveMode('fixStake')}
                      className={`flex-1 py-1.5 transition-colors ${solveMode === 'fixStake' ? 'bg-vermilion/15 text-vermilion' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                      Set stake
                    </button>
                    <button
                      onClick={() => setSolveMode('fixPayout')}
                      className={`flex-1 py-1.5 transition-colors ${solveMode === 'fixPayout' ? 'bg-vermilion/15 text-vermilion' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                      Set payout
                    </button>
                  </div>

                  {solveMode === 'fixStake' ? (
                    <AmountField
                      label="You pay"
                      value={stakeInput}
                      onChange={setStakeInput}
                      hint={`Wallet: ${(walletBalance / DUSDC_MULTIPLIER).toFixed(2)} DUSDC`}
                    />
                  ) : (
                    <AmountField
                      label="You win"
                      value={payoutInput}
                      onChange={setPayoutInput}
                      hint="If every leg lands"
                    />
                  )}

                  <div className="space-y-1.5 pt-1">
                    <Row label="You pay" emphasize>
                      {quoteLoading ? '…' : quote ? `${stakeDisplay.toFixed(2)} DUSDC` : '—'}
                    </Row>
                    <Row label="You win" accent>
                      {quoteLoading ? '…' : quote ? `${payoutDisplay.toFixed(2)} DUSDC` : '—'}
                    </Row>
                    <div className="flex justify-end -mt-0.5">
                      <span className="font-mono text-[10px] text-gray-600">
                        {quote && `${(payoutDisplay - stakeDisplay).toFixed(2)} DUSDC profit if you sweep`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* per-leg breakdown */}
                {quote && (
                  <div className="space-y-1">
                    {legs.map((leg, i) => {
                      const o = btcBells.find((b) => b.oracle_id === leg.oracleId);
                      return (
                        <div key={leg.key} className="flex items-center justify-between text-[11px]">
                          <span className="text-gray-500 truncate">
                            <span className={leg.isUp ? 'text-emerald-400/80' : 'text-rose-400/80'}>
                              {leg.isUp ? 'UP' : 'DOWN'}
                            </span>{' '}
                            {leg.strike ? fmtUsd(leg.strike / FLOAT_SCALING) : '—'}
                            {o && <span className="text-gray-700"> · {formatCountdown(getTimeRemaining(o.expiry))}</span>}
                          </span>
                          <span className="font-mono text-gray-400">{(quote.legProbs[i] * 100).toFixed(0)}%</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {quoteError && (
                  <button
                    onClick={() => setQuoteRetry((k) => k + 1)}
                    className="w-full text-center text-[11px] text-rose-400/90 underline underline-offset-2 hover:text-rose-300"
                  >
                    A leg can&apos;t be priced (bell inactive or settled) — retry
                  </button>
                )}

                {/* place */}
                <button
                  onClick={handlePlace}
                  disabled={
                    !quote || quoteLoading || !!quoteError || !hasEnough ||
                    step === 'placing' || step === 'success'
                  }
                  className={`w-full py-4 rounded-xl text-sm font-bold uppercase tracking-wider transition-all disabled:cursor-not-allowed ${
                    (!quote || !hasEnough) && step === 'idle'
                      ? 'bg-white/[0.06] text-gray-400 border border-white/10'
                      : 'bg-vermilion hover:bg-vermilion-d text-white shadow-[0_0_20px_rgba(224,77,38,0.25)] disabled:opacity-50'
                  }`}
                >
                  {step === 'placing' ? (
                    <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Placing parlay…</span>
                  ) : step === 'success' ? (
                    <span className="flex items-center justify-center gap-2"><Check className="w-4 h-4" /> Parlay placed!</span>
                  ) : quoteLoading ? (
                    'Pricing…'
                  ) : quoteError ? (
                    'Quote unavailable'
                  ) : !hasEnough ? (
                    'Insufficient DUSDC'
                  ) : quote ? (
                    `Place — ${stakeDisplay.toFixed(2)} DUSDC`
                  ) : 'Build your parlay'}
                </button>

                {/* no manager / no AccountSetup needed — parlay escrows directly */}
                <p className="text-[10px] text-gray-600 text-center leading-relaxed">
                  The reserve escrows the full payout up front. No account setup — your stake leaves your wallet, the rest is fronted by the reserve.
                </p>

                <AnimatePresence>
                  {step === 'error' && errorMsg && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20"
                    >
                      <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs text-rose-400 font-bold">{errorMsg}</p>
                        {errorDetail && errorDetail !== errorMsg && (
                          <details className="mt-1">
                            <summary className="text-[10px] text-rose-400/50 cursor-pointer select-none">technical details</summary>
                            <p className="text-[11px] text-rose-400/60 mt-1 break-all max-h-24 overflow-y-auto">{errorDetail}</p>
                          </details>
                        )}
                        <button onClick={() => { setStep('idle'); setErrorMsg(''); setErrorDetail(''); }} className="text-[10px] text-rose-400 underline mt-1">
                          Try again
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {step === 'success' && txDigest && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <a
                        href={`https://suiscan.xyz/testnet/tx/${txDigest}`}
                        target="_blank" rel="noopener noreferrer"
                        className="block text-center text-[11px] text-new-mint/60 hover:text-new-mint transition-colors"
                      >
                        View on Suiscan
                      </a>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
          </div>
        </div>

        {/* the "how it pays" footnote — keeps the parlay rule honest */}
        {legs.length >= 2 && (
          <div className="mt-3 flex items-start gap-2 px-1">
            <Trophy className="w-3.5 h-3.5 text-gray-600 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-gray-600 leading-relaxed">
              Every leg must settle in the money. The instant one bell rings against you, the ticket is dead — your stake is the most you can lose.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── sub-components ──

function Row({ label, children, emphasize, accent }: {
  label: string; children: React.ReactNode; emphasize?: boolean; accent?: boolean;
}) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-gray-500 text-xs">{label}</span>
      <span className={`font-mono font-bold ${emphasize ? 'text-white text-base' : accent ? 'text-vermilion text-base' : 'text-gray-300 text-sm'}`}>
        {children}
      </span>
    </div>
  );
}

function AmountField({ label, value, onChange, hint }: {
  label: string; value: string; onChange: (v: string) => void; hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">{label}</label>
        {hint && <span className="text-[10px] text-gray-600">{hint}</span>}
      </div>
      <div className="relative">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
          min="0"
          step="1"
          className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] focus:border-white/20 text-white font-mono text-lg outline-none transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-500">DUSDC</span>
      </div>
    </div>
  );
}

function LegRow({
  index, leg, oracle, bells, legProb, strikeGridFor, defaultStrikeFor, onPatch, onRemove,
}: {
  index: number;
  leg: DraftLeg;
  oracle: OracleData | null;
  bells: OracleData[];
  legProb: number | null;
  strikeGridFor: (id: string) => { grid: number[]; oracle: OracleData | null };
  defaultStrikeFor: (o: OracleData) => number;
  onPatch: (key: string, patch: Partial<DraftLeg>) => void;
  onRemove: (key: string) => void;
}) {
  const [showBells, setShowBells] = useState(false);
  const [showStrikes, setShowStrikes] = useState(false);
  const { grid } = strikeGridFor(leg.oracleId);
  const displayedStrikes = useMemo(() => {
    if (leg.strike === null || grid.includes(leg.strike)) return grid;
    return [...grid, leg.strike].sort((a, b) => a - b);
  }, [grid, leg.strike]);

  const chooseBell = (o: OracleData) => {
    onPatch(leg.key, { oracleId: o.oracle_id, expiry: o.expiry, strike: defaultStrikeFor(o) });
    setShowBells(false);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="rounded-xl border border-white/[0.06] bg-white/[0.015] overflow-hidden"
    >
      <div className="flex items-stretch">
        {/* numbered stamp — editorial 予測 style */}
        <div className="flex flex-col items-center justify-center w-10 border-r border-white/[0.06] bg-white/[0.02]">
          <span className="font-display font-[800] text-base text-vermilion leading-none">{index + 1}</span>
          <span className="font-mono text-[7px] text-gray-600 mt-0.5">脚</span>
        </div>

        <div className="flex-1 p-3 space-y-2.5 min-w-0">
          {/* row 1: bell picker + remove */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <button
                onClick={() => { setShowBells((s) => !s); setShowStrikes(false); }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.08] hover:border-white/20 transition-colors text-xs"
              >
                <span className="text-white font-mono truncate">
                  {oracle
                    ? <>BTC bell · <Countdown expiryMs={oracle.expiry} className="text-[11px]" /></>
                    : 'bell settled — pick another'}
                </span>
                <ChevronDown className={`w-3 h-3 text-gray-500 flex-shrink-0 transition-transform ${showBells ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence>
                {showBells && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    className="absolute z-20 mt-1 left-0 right-0 max-h-44 overflow-y-auto rounded-lg border border-white/[0.1] bg-neutral-900 shadow-xl scrollbar-hide"
                  >
                    {bells.length === 0 && (
                      <div className="px-3 py-2 text-[11px] text-gray-600">No live BTC bells</div>
                    )}
                    {bells.map((o) => (
                      <button
                        key={o.oracle_id}
                        onClick={() => chooseBell(o)}
                        className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                          o.oracle_id === leg.oracleId ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <span className="font-mono">BTC bell</span>
                        <span className="font-mono text-[10px] text-gray-500">
                          {formatCountdown(getTimeRemaining(o.expiry))}
                        </span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button
              onClick={() => onRemove(leg.key)}
              className="p-1.5 rounded-lg text-gray-600 hover:text-rose-400 hover:bg-rose-400/10 transition-colors flex-shrink-0"
              aria-label="Remove leg"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* row 2: UP/DOWN + strike */}
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg overflow-hidden border border-white/10">
              <button
                onClick={() => onPatch(leg.key, { isUp: true })}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                  leg.isUp ? 'bg-emerald-500/15 text-emerald-400' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <TrendingUp className="w-3 h-3" /> Up
              </button>
              <button
                onClick={() => onPatch(leg.key, { isUp: false })}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                  !leg.isUp ? 'bg-rose-500/15 text-rose-400' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <TrendingDown className="w-3 h-3" /> Down
              </button>
            </div>

            <div className="relative flex-1 min-w-0">
              <button
                onClick={() => { setShowStrikes((s) => !s); setShowBells(false); }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.08] hover:border-white/20 transition-colors text-xs"
              >
                <span className="text-white font-mono font-bold">
                  {leg.strike ? fmtUsd(leg.strike / FLOAT_SCALING) : 'Strike'}
                </span>
                <ChevronDown className={`w-3 h-3 text-gray-500 flex-shrink-0 transition-transform ${showStrikes ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence>
                {showStrikes && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    className="absolute z-20 mt-1 left-0 right-0 max-h-40 overflow-y-auto rounded-lg border border-white/[0.1] bg-neutral-900 shadow-xl scrollbar-hide"
                  >
                    {displayedStrikes.map((s) => (
                      <button
                        key={s}
                        onClick={() => { onPatch(leg.key, { strike: s }); setShowStrikes(false); }}
                        className={`w-full flex items-center px-3 py-1.5 text-xs transition-colors font-mono ${
                          s === leg.strike ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        {fmtUsd(s / FLOAT_SCALING)}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* live per-leg prob */}
            <span className="font-mono text-[11px] text-vermilion/80 w-9 text-right flex-shrink-0">
              {legProb !== null ? `${(legProb * 100).toFixed(0)}%` : '·'}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
