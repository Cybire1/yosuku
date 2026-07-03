'use client';

// Ticket drawer for the 6-24 venue — the slide-over bet flow behind /markets.
// Same idiom as the /strategies copy drawer (slide-over, Esc, scroll lock);
// same MACHINERY as /markets-live (shared lib/sui/ticket624): account setup,
// inline deposit, REAL dry-run quote refreshed every 12s, fresh-quote-at-click
// ×1.10 cost guard, friendly abort toasts. The tapped side arrives preselected —
// the user's tap IS the choice. The amount is always theirs: empty + additive chips.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConnectButton } from '@mysten/dapp-kit';
import { X } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { DUSDC_MULTIPLIER } from '@/lib/sui/constants';
import { type Market624 } from '@/lib/sui/predict624Client';
import {
  BAND_USD,
  EST_PROB_HIGH,
  MIN_MINT_MS,
  friendlyMintAbort,
  placeMint624,
  strike624,
  useAccount624,
  useMintQuote624,
  type Dir624,
} from '@/lib/sui/ticket624';

const fmt2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtUsd0 = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const SUISCAN_TX = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;

const CADENCE_WORD: Record<Market624['cadence'], string> = { '1m': '1-minute', '5m': '5-minute', '1h': '1-hour' };

function fmtCountdown(msLeft: number): string {
  if (msLeft <= 0) return 'settling';
  const m = Math.floor(msLeft / 60_000);
  const s = Math.floor((msLeft % 60_000) / 1000);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

interface Placed {
  digest: string;
  dir: Dir624;
  strikeUsd: number;
  qty: number;
  lev: number;
  costDusdc: number;
  expiry: number;
}

export default function Ticket624Drawer({
  market,
  side,
  spot,
  onClose,
}: {
  market: Market624 | null;
  /** Preselected by the tap on the card — null when the card body was tapped. */
  side: Dir624 | null;
  spot: number | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const acct = useAccount624();
  const { address, wrapperId, wrapperChecked, acctBalance } = acct;

  const [dir, setDir] = useState<Dir624 | null>(side);
  const [payoutStr, setPayoutStr] = useState('');
  const [lev, setLev] = useState(1);
  const [fundStr, setFundStr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);

  // clock for the countdown
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!market) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [market]);

  // fresh ticket every open / re-tap — the tapped side IS the choice
  useEffect(() => {
    if (!market) return;
    setDir(side);
    setPayoutStr('');
    setFundStr('');
    setLev(1);
    setPlaced(null);
  }, [market?.id, side]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc + body scroll lock (the site's drawer idiom)
  useEffect(() => {
    if (!market) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [market, onClose]);

  const qty = useMemo(() => {
    const n = parseFloat(payoutStr.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [payoutStr]);
  const addPayout = (n: number) => setPayoutStr((s) => String(Math.max(0, (parseFloat(s || '0') || 0) + n)));
  const addFund = (n: number) => setFundStr((s) => String(Math.max(0, (parseFloat(s || '0') || 0) + n)));

  const msLeft = market && now > 0 ? market.expiry - now : null;
  const closing = msLeft != null && msLeft < MIN_MINT_MS;
  // even the high estimate misses min_net_premium (1 DUSDC) — hard stop
  const belowMinHard = qty > 0 && (EST_PROB_HIGH * qty) / lev < 1;
  const strikeUsd = spot != null && dir ? strike624(spot, dir) : null;

  const { quote, quoteErr, quoting } = useMintQuote624({
    address,
    wrapperId,
    marketId: market?.id ?? null,
    dir,
    qty,
    lev,
    spot,
    enabled: !closing && !belowMinHard && !placed,
  });
  const quotedCost = quote ? quote.costMicro / DUSDC_MULTIPLIER : null;
  const quotedWin = quote ? quote.winMicro / DUSDC_MULTIPLIER : null;
  const needsDeposit = quotedCost != null && quotedCost > acctBalance;

  const blocker: string | null = closing
    ? 'Market closing — pick the next one'
    : !address
      ? 'Connect a wallet'
      : !wrapperChecked
        ? 'Reading the chain…'
        : !wrapperId
          ? 'Set up your account below'
          : !dir
            ? 'Call UP or DOWN'
            : qty <= 0
              ? 'Enter a payout amount'
              : belowMinHard
                ? 'Below the 1 DUSDC protocol minimum'
                : spot == null
                  ? 'Waiting for the oracle price…'
                  : needsDeposit
                    ? `Deposit ${fmt2(quotedCost! - acctBalance)} DUSDC below first`
                    : quoteErr
                      ? 'Quote failed — see below'
                      : quotedCost == null
                        ? 'Quoting the live price…'
                        : null;

  const createAccount = useCallback(async () => {
    if (busy) return;
    setBusy('create');
    try {
      const wid = await acct.createAccount();
      toast(wid ? 'Trading account created' : 'Account created — still indexing, one moment', 'success');
    } catch (e) {
      toast(`Could not create the account: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`, 'error');
    } finally {
      setBusy(null);
    }
  }, [acct, busy, toast]);

  const deposit = useCallback(async () => {
    if (busy) return;
    const amt = parseFloat(fundStr.replace(',', '.'));
    if (!Number.isFinite(amt) || amt <= 0) {
      toast('Enter an amount above 0', 'error');
      return;
    }
    if (Math.floor(amt * DUSDC_MULTIPLIER) > acct.walletMicro) {
      toast(`Wallet DUSDC too low — you hold ${fmt2(acct.walletMicro / DUSDC_MULTIPLIER)}`, 'error');
      return;
    }
    setBusy('fund');
    try {
      await acct.deposit(BigInt(Math.floor(amt * DUSDC_MULTIPLIER)));
      toast(`Deposited ${fmt2(amt)} DUSDC`, 'success');
      setFundStr('');
    } catch (e) {
      toast(`Deposit failed: ${String(e instanceof Error ? e.message : e).slice(0, 140)}`, 'error');
    } finally {
      setBusy(null);
    }
  }, [acct, busy, fundStr, toast]);

  const place = useCallback(async () => {
    if (blocker || !address || !wrapperId || !market || !dir || spot == null || busy || !quote) return;
    setBusy('mint');
    try {
      const r = await placeMint624({
        submitTx: acct.submitTx,
        address,
        wrapperId,
        marketId: market.id,
        dir,
        qty,
        lev,
        spot,
        acctBalance,
      });
      setPlaced({ digest: r.digest, dir, strikeUsd: r.strikeUsd, qty, lev, costDusdc: r.costDusdc, expiry: market.expiry });
      toast(`Bet placed — ${dir.toUpperCase()} ${dir === 'up' ? 'over' : 'under'} ${fmtUsd0(r.strikeUsd)}`, 'success');
      acct.refreshAcctBalance();
    } catch (e) {
      toast(`Bet failed: ${friendlyMintAbort(String(e instanceof Error ? e.message : e))}`, 'error');
    } finally {
      setBusy(null);
    }
  }, [blocker, address, wrapperId, market, dir, spot, busy, quote, acct, qty, lev, acctBalance, toast]);

  if (!market) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative h-full w-full max-w-[440px] overflow-y-auto border-l border-white/10 bg-[#0b0b0e] p-6 shadow-2xl animate-[slideIn_.22s_ease]"
        role="dialog"
        aria-modal="true"
        aria-label="Bet ticket"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-full p-2 text-gray-600 hover:bg-white/[0.05] hover:text-white transition-colors"
          data-cursor="hover"
        >
          <X className="h-4 w-4" />
        </button>

        {/* head */}
        <div className="flex items-center gap-3 mb-5 pr-8">
          <span className="w-9 h-9 rounded-full border border-white/20 flex items-center justify-center font-mono text-sm text-white shrink-0">₿</span>
          <div className="min-w-0">
            <h2 className="font-display font-[800] text-xl text-white leading-tight">BTC · {CADENCE_WORD[market.cadence]}</h2>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-gray-500 mt-0.5">
              {closing ? (
                <span className="text-vermilion">settling — at the oracle</span>
              ) : (
                <>
                  settles in <span className="text-white tabular-nums">{msLeft != null ? fmtCountdown(msLeft) : '—'}</span>
                  {spot != null && <span className="ml-2">· BTC ${Math.round(spot).toLocaleString()}</span>}
                </>
              )}
            </div>
          </div>
        </div>

        {placed ? (
          /* ── success state ── */
          <div>
            <div className={`border p-5 mb-5 ${placed.dir === 'up' ? 'border-profit/40 bg-profit/[0.05]' : 'border-loss/40 bg-loss/[0.05]'}`}>
              <div className={`font-mono text-[10px] font-bold uppercase tracking-[0.2em] mb-2 ${placed.dir === 'up' ? 'text-profit' : 'text-loss'}`}>
                ✓ Bet placed
              </div>
              <div className="font-display font-[800] text-2xl text-white leading-tight">
                {placed.dir === 'up' ? '▲ UP' : '▼ DOWN'} — BTC {placed.dir === 'up' ? 'over' : 'under'} {fmtUsd0(placed.strikeUsd)}
              </div>
              <div className="mt-3 space-y-1.5 font-mono text-[11px] text-white/70">
                <div className="flex justify-between"><span className="text-white/40 uppercase tracking-[0.14em] text-[9.5px]">You paid</span><span className="tabular-nums">{fmt2(placed.costDusdc)} DUSDC</span></div>
                <div className="flex justify-between"><span className="text-white/40 uppercase tracking-[0.14em] text-[9.5px]">Payout if it lands</span><span className="tabular-nums text-white">{fmt2(placed.qty)} DUSDC{placed.lev > 1 ? ' − financed floor' : ''}</span></div>
                <div className="flex justify-between"><span className="text-white/40 uppercase tracking-[0.14em] text-[9.5px]">Settles</span><span className="tabular-nums">{now > 0 ? fmtCountdown(placed.expiry - now) : '—'}</span></div>
              </div>
              <a href={SUISCAN_TX(placed.digest)} target="_blank" rel="noreferrer" className="mt-3 inline-block font-mono text-[10px] text-white/40 hover:text-white transition-colors" data-cursor="hover">
                verify on Suiscan ↗
              </a>
            </div>
            <a
              href="/portfolio"
              className="block w-full text-center rounded-full bg-vermilion hover:bg-vermilion-d text-white text-sm font-semibold px-6 py-3 transition-colors"
              data-cursor="hover"
            >
              View in Portfolio →
            </a>
            <button
              onClick={() => { setPlaced(null); setPayoutStr(''); }}
              className="mt-2.5 w-full rounded-full border border-white/15 text-white/70 hover:text-white hover:border-white/30 text-sm font-semibold px-6 py-3 transition-colors"
              data-cursor="hover"
            >
              Place another
            </button>
            <p className="font-mono text-[9.5px] leading-relaxed text-white/30 mt-4">
              Oracle-settled at expiry. Your payout lands in YOUR trading account — claim it from Portfolio once the market settles.
            </p>
          </div>
        ) : (
          /* ── the ticket ── */
          <div>
            {/* direction — tapped side arrives preselected */}
            <div className="grid grid-cols-2 gap-2.5 mb-5">
              {(['up', 'down'] as const).map((d) => {
                const on = dir === d;
                const line = spot == null
                  ? 'waiting for the oracle…'
                  : d === 'up'
                    ? `wins if BTC settles over ${fmtUsd0(spot - BAND_USD)}`
                    : `wins if BTC settles under ${fmtUsd0(spot + BAND_USD)}`;
                const palette = d === 'up'
                  ? on
                    ? 'border-profit bg-profit/[0.14] text-profit'
                    : 'border-white/[0.1] text-white/45 hover:border-profit/50 hover:text-profit'
                  : on
                    ? 'border-loss bg-loss/[0.14] text-loss'
                    : 'border-white/[0.1] text-white/45 hover:border-loss/50 hover:text-loss';
                return (
                  <button
                    key={d}
                    onClick={() => setDir(on ? null : d)}
                    className={`text-left border rounded-lg p-4 transition-all duration-150 ${palette}`}
                    aria-pressed={on}
                    data-cursor="hover"
                  >
                    <div className="font-display font-[800] text-2xl leading-none tracking-tight">
                      {d === 'up' ? '▲ UP' : '▼ DOWN'}
                    </div>
                    <div className={`font-mono text-[9.5px] leading-snug mt-2 ${on ? 'opacity-90' : 'opacity-60'}`}>{line}</div>
                  </button>
                );
              })}
            </div>

            {/* payout size — user-owned, chips ADD, never pre-decided */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">Payout if you win</span>
                <span className="font-mono text-[10px] text-gray-600">account: {fmt2(acctBalance)} DUSDC</span>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-black/30 px-4 py-2.5 transition-colors focus-within:border-vermilion/50">
                <div className="flex items-center justify-between">
                  <input
                    inputMode="decimal"
                    placeholder="0"
                    value={payoutStr}
                    onChange={(e) => setPayoutStr(e.target.value.replace(/[^0-9.]/g, ''))}
                    className="w-full bg-transparent font-display text-2xl font-bold text-white outline-none placeholder:text-gray-600"
                    aria-label="Payout amount in DUSDC"
                  />
                  <span className="font-mono text-xs font-semibold text-gray-300 shrink-0">DUSDC</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="font-mono text-[10px] text-gray-500">Your stake is the entry cost below.</span>
                  <div className="flex gap-1.5">
                    {[1, 5].map((n) => (
                      <button key={n} onClick={() => addPayout(n)} className="rounded-md border border-white/15 px-2 py-0.5 font-mono text-[10px] text-gray-300 hover:border-vermilion/50 hover:text-white transition-colors" data-cursor="hover">
                        +{n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {belowMinHard && (
                <p className="font-mono text-[10px] text-vermilion mt-2">
                  Protocol minimum: entry premium must be ≥ 1 DUSDC — raise the payout{lev > 1 ? ' or lower the leverage' : ''} (≈ 2 DUSDC payout at 1×).
                </p>
              )}
            </div>

            {/* leverage — native knockout */}
            <div className="mb-5">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-1.5">
                Leverage <span className="text-gray-600 normal-case tracking-normal">— native knockout</span>
              </div>
              <div className="flex gap-1.5 max-w-[14rem]">
                {[1, 2, 3].map((v) => (
                  <button
                    key={v}
                    onClick={() => setLev(v)}
                    className={`flex-1 py-1.5 rounded font-mono text-[12px] border transition-colors ${lev === v ? 'border-vermilion text-vermilion bg-vermilion/[0.06]' : 'border-white/[0.08] text-white/50 hover:border-white/20'}`}
                    data-cursor="hover"
                  >
                    {v}×
                  </button>
                ))}
              </div>
              {lev > 1 && (
                <p className="font-mono text-[10px] text-white/40 leading-relaxed mt-2">
                  Leverage finances part of your entry; a win pays quantity minus the financed floor; it can knock out before expiry.
                </p>
              )}
            </div>

            {/* the REAL quote */}
            <div className="border-y border-white/[0.08] divide-y divide-white/[0.06] mb-3">
              <QuoteRow k="You pay now" v={quotedCost != null ? `${fmt2(quotedCost)} DUSDC (max ${fmt2(quotedCost * 1.1)})` : quoting ? 'quoting…' : '—'} />
              <QuoteRow k="If you win" v={quotedWin != null ? `${fmt2(quotedWin)} DUSDC` : quoting ? 'quoting…' : '—'} strong />
              <QuoteRow k="If you lose" v={quotedCost != null ? `${fmt2(quotedCost)} gone` : '—'} />
              {quote && <QuoteRow k="Entry probability" v={`${(quote.entryProb * 100).toFixed(1)}%`} />}
            </div>
            <p className="font-mono text-[9.5px] leading-relaxed text-white/35 mb-4">
              {quote
                ? 'Live venue quote, refreshed every 12s. You never pay more than the max — if the price moves past it while you sign, the bet safely rejects instead.'
                : quoteErr
                  ? `Quote failed: ${quoteErr}`
                  : dir && qty > 0
                    ? (address ? 'Quoting the live price…' : 'Connect to see your live price.')
                    : 'Pick a side and size the payout for a live quote.'}
            </p>

            {/* account gates, inline */}
            {!address && (
              <div className="border border-white/[0.08] bg-white/[0.02] p-4 mb-4">
                <p className="text-[12.5px] text-gray-400 leading-snug mb-3">
                  Your bets settle into an on-chain trading account only your wallet can withdraw from. Connect to set it up.
                </p>
                <ConnectButton />
              </div>
            )}
            {address && wrapperChecked && !wrapperId && (
              <div className="border border-white/[0.08] bg-white/[0.02] p-4 mb-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-vermilion mb-1.5">One-time setup</div>
                <p className="text-[12.5px] text-gray-400 leading-snug mb-3">
                  Creates your trading account on DeepBook Predict — deposits, payouts and withdrawals all move through it; only you can withdraw.
                </p>
                <button
                  onClick={createAccount}
                  disabled={busy === 'create'}
                  className="rounded-full bg-vermilion hover:bg-vermilion-d text-white text-[13px] font-semibold px-5 py-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  data-cursor="hover"
                >
                  {busy === 'create' ? 'Creating…' : 'Create account →'}
                </button>
              </div>
            )}
            {address && wrapperId && needsDeposit && (
              <div className="border border-vermilion/25 bg-vermilion/[0.04] p-4 mb-4">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-vermilion mb-1.5">Top up to place this</div>
                <p className="font-mono text-[10px] text-gray-500 mb-2.5">
                  Account holds {fmt2(acctBalance)} DUSDC · this bet costs {fmt2(quotedCost!)} · wallet holds {fmt2(acct.walletMicro / DUSDC_MULTIPLIER)}
                </p>
                <div className="rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2 focus-within:border-vermilion/50">
                  <div className="flex items-center justify-between">
                    <input
                      inputMode="decimal"
                      placeholder="0.00"
                      value={fundStr}
                      onChange={(e) => setFundStr(e.target.value.replace(/[^0-9.]/g, ''))}
                      className="w-full bg-transparent font-display text-xl font-bold text-white outline-none placeholder:text-gray-600"
                      aria-label="Deposit amount in DUSDC"
                    />
                    <div className="flex gap-1.5 shrink-0">
                      {[1, 5, 10].map((n) => (
                        <button key={n} onClick={() => addFund(n)} className="rounded-md border border-white/15 px-2 py-0.5 font-mono text-[10px] text-gray-300 hover:border-vermilion/50 hover:text-white transition-colors" data-cursor="hover">
                          +{n}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <button
                  onClick={deposit}
                  disabled={busy === 'fund'}
                  className="mt-2.5 rounded-full bg-vermilion hover:bg-vermilion-d text-white text-[13px] font-semibold px-5 py-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  data-cursor="hover"
                >
                  {busy === 'fund' ? 'Submitting…' : 'Deposit to account'}
                </button>
              </div>
            )}

            {/* place */}
            <button
              onClick={place}
              disabled={!!blocker || busy === 'mint'}
              className={`w-full py-3 text-sm font-semibold transition-all rounded ${
                !blocker && busy !== 'mint'
                  ? dir === 'down'
                    ? 'bg-loss text-white hover:opacity-90 shadow-[0_6px_28px_-8px_var(--loss)]'
                    : 'bg-profit text-black hover:opacity-90 shadow-[0_6px_28px_-8px_var(--profit)]'
                  : 'cursor-not-allowed bg-white/[0.06] text-gray-500'
              }`}
              data-cursor="hover"
            >
              {busy === 'mint'
                ? 'Placing…'
                : blocker ?? `Place ${dir === 'up' ? 'UP' : 'DOWN'} — ${strikeUsd != null ? `${dir === 'up' ? 'over' : 'under'} ${fmtUsd0(strikeUsd)}` : ''} →`}
            </button>

            <p className="font-mono text-[9.5px] leading-relaxed text-white/30 mt-3">
              Testnet DUSDC. Oracle-settled — no committee, no vote. You can lose your full stake
              {lev > 1 ? '; leveraged positions can knock out before expiry' : ''}. Wallet-signed;
              payouts land in YOUR trading account only.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function QuoteRow({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between px-0.5 py-2.5">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-white/40">{k}</span>
      <span className={`font-mono tabular-nums ${strong ? 'text-white text-[15px] font-semibold' : 'text-white/80 text-[13px]'}`}>{v}</span>
    </div>
  );
}
