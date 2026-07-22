'use client';

// /fund — the on-ramp, PREVIEWED. The user states how much DUSDC they want; the card is
// charged the derived cost (in Naira today, since Paystack collects NGN) and testnet DUSDC
// lands in their OWN wallet, so even funding is self-custodial. This is the mainnet
// go-to-market shown on testnet: Paystack TEST MODE (no real money), Yosuku never holds fiat.
//
// Live Paystack popup when NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY (a pk_test_… key) is set;
// otherwise a clearly-labelled simulated test payment so the flow always demos.
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useCurrentAccount, ConnectButton } from '@mysten/dapp-kit';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';

const NGN_PER_DUSDC = 1600; // indicative demo rate (the card is charged this much Naira per DUSDC)
const PRESETS_DUSDC = [5, 10, 25];
const PAYSTACK_KEY = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '';

type Phase = 'idle' | 'paying' | 'crediting' | 'done';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global { interface Window { PaystackPop?: any } }

const fmtNgn = (n: number) => `₦${Math.round(n).toLocaleString('en-US')}`;

export default function FundPage() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;

  const [amount, setAmount] = useState('10'); // DUSDC the user wants
  const [phase, setPhase] = useState<Phase>('idle');
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{ amount: number; explorer: string } | null>(null);
  const paystackReady = useRef(false);

  // load the secure-checkout script (kept ready so the card screen opens instantly)
  useEffect(() => {
    if (document.getElementById('paystack-inline')) { paystackReady.current = !!window.PaystackPop; return; }
    const s = document.createElement('script');
    s.id = 'paystack-inline';
    s.src = 'https://js.paystack.co/v1/inline.js';
    s.async = true;
    s.onload = () => { paystackReady.current = true; };
    document.body.appendChild(s);
  }, []);

  const presets = PRESETS_DUSDC;
  const want = Math.max(0, Number(amount) || 0);       // DUSDC requested
  const dusdcShown = Math.min(want, 50);               // capped per request
  const capped = want > 50;
  const ngnCost = Math.round(dusdcShown * NGN_PER_DUSDC); // derived Naira cost the card is charged

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
    // The card is charged the derived Naira cost; the user gets the DUSDC they asked for.
    if (PAYSTACK_KEY && window.PaystackPop) {
      setPhase('paying');
      const ngn = ngnCost;
      const handler = window.PaystackPop.setup({
        key: PAYSTACK_KEY,
        email: `${address.slice(2, 12)}@yosuku.xyz`,
        amount: Math.round(ngn * 100), // kobo
        currency: 'NGN',
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
  }, [address, dusdcShown, ngnCost, credit]);

  const reset = () => { setPhase('idle'); setResult(null); setErr(''); };

  return (
    <div className="min-h-screen relative bg-bg">
      <Marquee />
      <Header />
      <GrainOverlay />

      <main className="relative max-w-xl mx-auto px-5 sm:px-8 pt-28 sm:pt-32 pb-28">
        <span aria-hidden className="pointer-events-none select-none absolute -right-6 top-24 font-jp font-black leading-[0.8] text-[clamp(9rem,26vw,15rem)] text-white/[0.035]" style={{ writingMode: 'vertical-rl' }}>入金</span>

        <div className="relative z-10">
          <div className="font-mono text-[11px] tracking-[0.28em] uppercase text-vermilion mb-4">予測 · Add money</div>
          <h1 className="font-display font-[800] tracking-[-0.03em] leading-[0.98] text-[clamp(2.3rem,7vw,3.4rem)]">
            Fund your <span className="text-vermilion">wallet.</span>
          </h1>
          <p className="mt-4 text-gray-400 leading-relaxed max-w-[42ch]">
            Choose how much DUSDC you want. Pay by card, it lands in <span className="text-white">your wallet</span> in seconds, and only you can ever cash it out.
          </p>

          {/* ── the card ── */}
          {phase !== 'done' ? (
            <div className="mt-9 rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6 sm:p-7 shadow-[0_40px_90px_-60px_rgba(0,0,0,0.9)]">
              {/* how much DUSDC you want */}
              <div className="fund-amt rounded-2xl border border-white/[0.08] bg-black/20 px-5 py-4 focus-within:border-vermilion/50 transition-colors">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500 mb-1.5">You get</div>
                <div className="flex items-center gap-3">
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    inputMode="decimal"
                    className="flex-1 min-w-0 bg-transparent font-display text-4xl font-bold text-white outline-none tabular-nums"
                    aria-label="Amount of DUSDC"
                  />
                  <span className="font-mono text-sm font-semibold text-gray-300 shrink-0">DUSDC</span>
                </div>
                <div className="mt-3 flex gap-2">
                  {presets.map((p) => (
                    <button key={p} onClick={() => setAmount(String(p))} data-cursor="hover"
                      className="fund-preset rounded-lg border border-white/12 px-3 py-1.5 font-mono text-[12px] text-gray-400 hover:border-vermilion/50 hover:text-white transition-colors">
                      {p} DUSDC
                    </button>
                  ))}
                </div>
              </div>

              {/* what it costs — charged to the card in Naira */}
              <div className="mt-5 flex items-baseline justify-between">
                <span className="font-mono text-sm text-gray-500">You pay</span>
                <span className="font-display font-bold tabular-nums text-2xl text-white">≈ {fmtNgn(ngnCost)}</span>
              </div>
              {capped && <div className="mt-1 text-right font-mono text-[11px] text-vermilion/80">up to 50 DUSDC at a time</div>}

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
                    {phase === 'paying' ? 'Opening secure checkout…' : phase === 'crediting' ? 'Adding to your wallet…' : 'Fund'}
                  </button>
                )}
                {err && <p className="mt-3 text-center text-[12px] text-rose-400">{err}</p>}
              </div>
            </div>
          ) : (
            /* ── success ── */
            <div className="mt-9 rounded-3xl border border-profit/25 bg-profit/[0.04] p-8 text-center shadow-[0_40px_90px_-60px_rgba(0,0,0,0.9)]">
              <div className="mx-auto w-16 h-16 rounded-full border-2 border-profit flex items-center justify-center mb-5">
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M4 12.5l5 5 11-11" stroke="var(--profit)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <div className="font-display font-[800] text-2xl">You're funded.</div>
              <div className="mt-2 font-display font-bold text-2xl text-white tabular-nums">{result?.amount.toFixed(2)} DUSDC</div>
              <p className="mt-3 text-[13px] text-gray-400 max-w-[34ch] mx-auto leading-snug">
                Landed in your wallet. Only you can ever cash it out.
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
