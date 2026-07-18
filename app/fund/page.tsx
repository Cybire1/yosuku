'use client';

// /fund — the Naira on-ramp, PREVIEWED. A Nigerian pays in their own currency and
// testnet DUSDC lands in their OWN wallet, so even funding is self-custodial. This is
// the mainnet go-to-market shown on testnet: Paystack TEST MODE (no real money), a
// licensed partner at mainnet, and Yosuku never holds the fiat.
//
// Live Paystack popup when NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY (a pk_test_… key) is set;
// otherwise a clearly-labelled simulated test payment so the flow always demos.
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useCurrentAccount, ConnectButton } from '@mysten/dapp-kit';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';

const NGN_PER_DUSDC = 1600; // indicative demo rate
const PRESETS_NGN = [2000, 5000, 10000];
const PRESETS_USD = [2, 5, 10];
const PAYSTACK_KEY = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '';

type Ccy = 'NGN' | 'USD';
type Phase = 'idle' | 'paying' | 'crediting' | 'done';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global { interface Window { PaystackPop?: any } }

const fmtNgn = (n: number) => `₦${Math.round(n).toLocaleString('en-US')}`;
const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FundPage() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;

  const [ccy, setCcy] = useState<Ccy>('NGN');
  const [amount, setAmount] = useState('5000');
  const [phase, setPhase] = useState<Phase>('idle');
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{ amount: number; explorer: string } | null>(null);
  const paystackReady = useRef(false);

  // load Paystack inline (only when a key is configured)
  useEffect(() => {
    if (!PAYSTACK_KEY || document.getElementById('paystack-inline')) { paystackReady.current = !!window.PaystackPop; return; }
    const s = document.createElement('script');
    s.id = 'paystack-inline';
    s.src = 'https://js.paystack.co/v1/inline.js';
    s.async = true;
    s.onload = () => { paystackReady.current = true; };
    document.body.appendChild(s);
  }, []);

  const presets = ccy === 'NGN' ? PRESETS_NGN : PRESETS_USD;
  const num = Math.max(0, Number(amount) || 0);
  const dusdc = ccy === 'USD' ? num : num / NGN_PER_DUSDC;
  const dusdcShown = Math.min(dusdc, 50);
  const capped = dusdc > 50;

  const setCcyKeepBalance = useCallback((next: Ccy) => {
    if (next === ccy) return;
    // convert the entered amount so the DUSDC value stays roughly steady
    const d = ccy === 'USD' ? num : num / NGN_PER_DUSDC;
    setAmount(next === 'USD' ? d.toFixed(2).replace(/\.00$/, '') : String(Math.round(d * NGN_PER_DUSDC)));
    setCcy(next);
  }, [ccy, num]);

  const credit = useCallback(async (reference?: string) => {
    if (!address) return;
    setPhase('crediting'); setErr('');
    try {
      const r = await fetch('/api/fund-preview', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, amountDusdc: dusdcShown, reference }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not credit the preview.');
      setResult({ amount: j.amount, explorer: j.explorer });
      setPhase('done');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPhase('idle');
    }
  }, [address, dusdcShown]);

  const pay = useCallback(() => {
    if (!address || dusdcShown <= 0) return;
    setErr('');
    // live Paystack test-mode popup when a key is present
    if (PAYSTACK_KEY && window.PaystackPop) {
      setPhase('paying');
      const handler = window.PaystackPop.setup({
        key: PAYSTACK_KEY,
        email: `${address.slice(2, 12)}@yosuku.xyz`,
        amount: Math.round((ccy === 'USD' ? num : num) * 100), // smallest unit (cents / kobo)
        currency: ccy,
        ref: `yosuku_${Date.now()}`,
        onClose: () => setPhase('idle'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        callback: (res: any) => { credit(res?.reference); },
      });
      handler.openIframe();
      return;
    }
    // simulated test payment (no key configured): brief pause, then credit
    setPhase('paying');
    setTimeout(() => credit(`sim_${Date.now()}`), 1100);
  }, [address, dusdcShown, ccy, num, credit]);

  const reset = () => { setPhase('idle'); setResult(null); setErr(''); };

  return (
    <div className="min-h-screen relative bg-bg">
      <Marquee />
      <Header />
      <GrainOverlay />

      <main className="relative max-w-xl mx-auto px-5 sm:px-8 pt-28 sm:pt-32 pb-28">
        <span aria-hidden className="pointer-events-none select-none absolute -right-6 top-24 font-jp font-black leading-[0.8] text-[clamp(9rem,26vw,15rem)] text-white/[0.035]" style={{ writingMode: 'vertical-rl' }}>入金</span>

        <div className="relative z-10">
          <div className="font-mono text-[11px] tracking-[0.28em] uppercase text-vermilion mb-4">予測 · Fund</div>
          <h1 className="font-display font-[800] tracking-[-0.03em] leading-[0.98] text-[clamp(2.3rem,7vw,3.4rem)]">
            Fund in <span className="text-vermilion">your own money.</span>
          </h1>
          <p className="mt-4 text-gray-400 leading-relaxed max-w-[42ch]">
            Pay with Naira. Test dollars land in <span className="text-white">your own wallet</span>, and only you can ever cash them out.
          </p>

          {/* ── the card ── */}
          {phase !== 'done' ? (
            <div className="mt-9 rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6 sm:p-7 shadow-[0_40px_90px_-60px_rgba(0,0,0,0.9)]">
              {/* currency toggle */}
              <div className="relative flex rounded-full border border-white/[0.08] bg-white/[0.02] p-1 mb-6 font-mono text-[13px]">
                <div
                  className="absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-full bg-vermilion transition-transform duration-300"
                  style={{ transform: ccy === 'USD' ? 'translateX(calc(100% + 4px))' : 'translateX(0)', ['--ease' as string]: 'cubic-bezier(0.16,1,0.3,1)' }}
                />
                {(['NGN', 'USD'] as Ccy[]).map((c) => (
                  <button key={c} onClick={() => setCcyKeepBalance(c)} data-cursor="hover"
                    className={`relative z-10 flex-1 py-2.5 rounded-full font-semibold tracking-wide transition-colors ${ccy === c ? 'text-white' : 'text-gray-400 hover:text-gray-200'}`}>
                    {c === 'NGN' ? '₦ Naira' : '$ USD'}
                  </button>
                ))}
              </div>

              {/* amount */}
              <div className="rounded-2xl border border-white/[0.08] bg-black/20 px-5 py-4 focus-within:border-vermilion/50 transition-colors">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500 mb-1.5">You pay</div>
                <div className="flex items-center gap-2">
                  <span className="font-display text-3xl font-bold text-gray-500">{ccy === 'NGN' ? '₦' : '$'}</span>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    inputMode="decimal"
                    className="flex-1 min-w-0 bg-transparent font-display text-4xl font-bold text-white outline-none tabular-nums"
                    aria-label={`Amount in ${ccy}`}
                  />
                </div>
                <div className="mt-3 flex gap-2">
                  {presets.map((p) => (
                    <button key={p} onClick={() => setAmount(String(p))} data-cursor="hover"
                      className="rounded-lg border border-white/12 px-3 py-1.5 font-mono text-[12px] text-gray-400 hover:border-vermilion/50 hover:text-white transition-colors">
                      {ccy === 'NGN' ? fmtNgn(p) : fmtUsd(p)}
                    </button>
                  ))}
                </div>
              </div>

              {/* conversion + flow */}
              <div className="mt-5 flex items-center justify-between font-mono text-sm">
                <span className="text-gray-500">you receive</span>
                <span className="text-white font-bold tabular-nums text-lg">{dusdcShown.toFixed(2)} <span className="text-gray-500 text-sm">DUSDC</span></span>
              </div>
              {ccy === 'NGN' && (
                <div className="mt-1 text-right font-mono text-[11px] text-gray-600">rate ≈ {fmtNgn(NGN_PER_DUSDC)} / DUSDC</div>
              )}
              {capped && <div className="mt-1 text-right font-mono text-[11px] text-vermilion/80">up to 50 at a time</div>}

              {/* the custody flow */}
              <div className="mt-6 flex items-center justify-between gap-2 text-center">
                {[
                  { l: ccy === 'NGN' ? 'Your Naira' : 'Your USD', tone: 'text-gray-300 border-white/12' },
                  { l: 'Paystack', tone: 'text-gray-300 border-white/12' },
                  { l: 'Your wallet', tone: 'text-profit border-profit/45', sub: 'self-custodial' },
                ].map((n, i) => (
                  <div key={i} className="contents">
                    <div className={`flex-1 rounded-xl border ${n.tone} py-3 px-1`}>
                      <div className="font-mono text-[11px] tracking-wide">{n.l}</div>
                      {n.sub && <div className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-profit/70 mt-0.5">{n.sub}</div>}
                    </div>
                    {i < 2 && <span className="text-gray-600 font-mono text-xs shrink-0">→</span>}
                  </div>
                ))}
              </div>

              {/* CTA / gate */}
              <div className="mt-7">
                {!address ? (
                  <div className="text-center">
                    <div className="text-[13px] text-gray-400 mb-3">Connect a wallet to fund it.</div>
                    <div className="flex justify-center [&_button]:!rounded-full"><ConnectButton /></div>
                  </div>
                ) : (
                  <button
                    onClick={pay}
                    disabled={phase !== 'idle' || dusdcShown <= 0}
                    data-cursor="hover"
                    className="w-full rounded-full bg-vermilion text-white font-display font-bold py-4 text-[15px] hover:bg-vermilion-d active:scale-[0.99] transition-all disabled:opacity-50 shadow-[0_18px_40px_-16px_var(--vermilion)]"
                  >
                    {phase === 'paying' ? 'Opening Paystack…' : phase === 'crediting' ? 'Delivering to your wallet…' : `Fund with Paystack · ${ccy === 'NGN' ? fmtNgn(num) : fmtUsd(num)}`}
                  </button>
                )}
                {err && <p className="mt-3 text-center text-[12px] text-rose-400">{err}</p>}
              </div>

              {/* honest, consumer-clean note (no dev jargon ever renders here) */}
              <div className="mt-6 pt-5 border-t border-white/[0.06] flex items-center justify-center gap-2 font-mono text-[10px] tracking-[0.1em] text-gray-500 text-center">
                Test mode · no real money moves
              </div>
            </div>
          ) : (
            /* ── success ── */
            <div className="mt-9 rounded-3xl border border-profit/25 bg-profit/[0.04] p-8 text-center shadow-[0_40px_90px_-60px_rgba(0,0,0,0.9)]">
              <div className="mx-auto w-16 h-16 rounded-full border-2 border-profit flex items-center justify-center mb-5">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M4 12.5l5 5 11-11" stroke="var(--profit)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <div className="font-display font-[800] text-2xl">You're funded.</div>
              <div className="mt-2 font-mono text-lg text-white tabular-nums">{result?.amount.toFixed(2)} DUSDC</div>
              <p className="mt-3 text-[13px] text-gray-400 max-w-[34ch] mx-auto leading-snug">
                Landed in your own wallet. Only you can ever cash it out.
              </p>
              <a href={result?.explorer} target="_blank" rel="noreferrer" className="inline-block mt-3 font-mono text-[11px] text-gray-500 hover:text-white transition-colors underline underline-offset-4">verify on-chain ↗</a>
              <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-center">
                <Link href="/markets" className="rounded-full bg-vermilion text-white font-display font-bold px-8 py-3.5 text-[14px] hover:bg-vermilion-d active:scale-[0.99] transition-all">Place a bet →</Link>
                <button onClick={reset} data-cursor="hover" className="rounded-full border border-white/15 px-8 py-3.5 font-mono text-[12px] uppercase tracking-wider text-gray-400 hover:text-white transition-colors">Fund again</button>
              </div>
            </div>
          )}

          <p className="mt-6 text-center font-mono text-[10.5px] leading-relaxed text-gray-600 max-w-[46ch] mx-auto">
            Your funds go straight to your wallet. Yosuku never holds your money.
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}
