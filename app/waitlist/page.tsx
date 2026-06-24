'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ShieldCheck, Users, Star, Check, X, Loader2, Copy, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCurrentAccount, ConnectButton } from '@mysten/dapp-kit';
import Header from '@/components/Header';
import {
  fetchWaitlist, buildJoinTx, fetchWaitlistLeaderboard, FOUNDER_CUTOFF,
  type WaitlistState, type WaitlistLeaderboard,
} from '@/lib/sui/waitlist';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';

const MAINNET_RPC = 'https://fullnode.mainnet.sui.io';
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63);
const isValidLabel = (l: string) => /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(l);
type NameState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

// fine film grain — gives the dark surface texture instead of a flat black.
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

// eased count-up for the on-chain tally.
function Counter({ value }: { value: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (value <= 0) { setN(0); return; }
    let raf = 0; const start = performance.now(); const dur = 1100;
    const tick = (t: number) => { const p = Math.min(1, (t - start) / dur); setN(Math.round(value * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{n.toLocaleString()}</>;
}

export default function WaitlistPage() {
  const router = useRouter();
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const { submit, sponsorReady } = useSmartSubmit();

  const [state, setState] = useState<WaitlistState | null>(null);
  const [lb, setLb] = useState<WaitlistLeaderboard | null>(null);
  const [referrer, setReferrer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [label, setLabel] = useState('');
  const [name, setName] = useState<NameState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get('ref');
      if (ref && /^0x[0-9a-fA-F]{64}$/.test(ref)) setReferrer(ref);
    } catch { /* ignore */ }
  }, []);

  const refresh = useCallback(async () => {
    try { setState(await fetchWaitlist(address)); } catch { /* keep */ }
    try { setLb(await fetchWaitlistLeaderboard(address)); } catch { /* keep */ }
  }, [address]);
  useEffect(() => { refresh(); }, [refresh]);

  const join = async () => {
    if (!address) return;
    setBusy(true); setErr(null);
    try { await submit(() => buildJoinTx(referrer && referrer !== address ? referrer : null)); await refresh(); }
    catch (e) { setErr(String(e instanceof Error ? e.message : e).slice(0, 140)); }
    finally { setBusy(false); }
  };

  const check = useCallback(async (l: string) => {
    if (!l) { setName('idle'); return; }
    if (!isValidLabel(l)) { setName('invalid'); return; }
    setName('checking');
    try {
      const res = await fetch(MAINNET_RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'suix_resolveNameServiceAddress', params: [`${l}.yosuku.sui`] }), signal: AbortSignal.timeout(8000) });
      const json = await res.json();
      setName(json?.result ? 'taken' : 'available');
    } catch { setName('idle'); }
  }, []);
  useEffect(() => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => check(label), 400); return () => { if (timer.current) clearTimeout(timer.current); }; }, [label, check]);

  const refLink = address ? `${typeof window !== 'undefined' ? window.location.origin : ''}/waitlist?ref=${address}` : '';
  const me = lb?.me ?? null;
  const isFounder = me ? me.tier === 'Founder' : false;
  const top = (lb?.entries ?? []).slice(0, 6);
  const total = state?.count ?? 0;
  const spotsLeft = Math.max(0, FOUNDER_CUTOFF - total);

  const ease = [0.16, 1, 0.3, 1] as const;
  const rise = (d: number) => ({ initial: { opacity: 0, y: 22 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.7, delay: d, ease } });

  return (
    <div className="min-h-screen text-white overflow-x-hidden selection:bg-vermilion selection:text-white">
      {/* atmosphere */}
      <div className="fixed inset-0 pointer-events-none -z-10">
        <div className="absolute inset-0 bg-[#08080a]" />
        <div className="absolute top-[-15%] right-[-10%] w-[620px] h-[620px] bg-vermilion/[0.10] blur-[150px] rounded-full" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[560px] h-[560px] bg-new-mint/[0.05] blur-[150px] rounded-full" />
        <div className="absolute inset-0 opacity-[0.05] mix-blend-overlay" style={{ backgroundImage: GRAIN, backgroundSize: '140px 140px' }} />
        <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 80% at 50% 0%, transparent 55%, rgba(0,0,0,0.55) 100%)' }} />
      </div>

      <Header />

      <main className="relative z-10 pt-24 sm:pt-28 pb-40 sm:pb-24">
        <div className="max-w-[1120px] mx-auto px-5 sm:px-8">
          <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-gray-500 hover:text-white transition-colors font-mono text-[12px] mb-8 sm:mb-12">
            <ArrowLeft size={14} /> back
          </button>

          {/* ── hero ─────────────────────────────────────────── */}
          <div className="grid lg:grid-cols-[1.15fr_0.85fr] gap-10 lg:gap-14 items-center">
            <div>
              <motion.div {...rise(0)} className="inline-flex items-center gap-2 border border-white/10 rounded-full pl-2.5 pr-3 py-1 mb-6 bg-white/[0.02]">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-vermilion opacity-60 animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-vermilion" />
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-gray-400">On-chain Founder list · testnet</span>
              </motion.div>

              <motion.h1 {...rise(0.06)} className="font-display font-extrabold tracking-[-0.03em] leading-[0.95] text-[clamp(2.7rem,7vw,5.5rem)]">
                Be first<br />when Yosuku<br />
                <span className="relative inline-block text-vermilion">
                  goes live.
                  <span className="absolute -inset-x-2 inset-y-2 bg-vermilion/20 blur-2xl -z-10" />
                </span>
              </motion.h1>

              <motion.p {...rise(0.14)} className="text-gray-400 text-[15px] sm:text-[17px] leading-relaxed max-w-xl mt-6">
                Free to play on testnet today. Joining signs your place <span className="text-gray-200">on-chain</span> — verifiable demand, not an email —
                for priority access at the <span className="text-gray-200">mainnet, real-money launch</span>. Gas is sponsored, so it's free.
              </motion.p>

              <motion.div {...rise(0.2)} className="flex flex-wrap items-end gap-x-8 gap-y-4 mt-9">
                <div>
                  <div className="font-display font-extrabold text-5xl sm:text-6xl tracking-tight tabular-nums"><Counter value={total} /></div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-500 mt-1">wallets in line</div>
                </div>
                <div className="h-12 w-px bg-white/10 hidden sm:block" />
                <div>
                  <div className="font-display font-extrabold text-5xl sm:text-6xl tracking-tight tabular-nums text-vermilion">{spotsLeft}</div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-500 mt-1">founder spots left</div>
                </div>
              </motion.div>
            </div>

            {/* ── the pass (join centerpiece) ──────────────────── */}
            <motion.div {...rise(0.16)}>
              <div className="relative rounded-[26px] p-[1px] bg-gradient-to-br from-vermilion/50 via-white/10 to-transparent">
                <div className="relative rounded-[25px] bg-gradient-to-b from-[#15100e] to-[#0b0b0d] p-7 sm:p-8 overflow-hidden">
                  <div className="absolute -top-24 -right-24 w-56 h-56 bg-vermilion/15 blur-3xl rounded-full pointer-events-none" />

                  <div className="flex items-center justify-between mb-6">
                    <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-gray-500">{isFounder ? 'Founder pass' : state?.joined ? 'Early pass' : 'Founder pass'}</span>
                    <span className="font-display font-bold text-vermilion text-lg">予</span>
                  </div>

                  {!address ? (
                    <>
                      <div className="font-display font-extrabold text-3xl tracking-tight leading-tight mb-2">Claim your<br />Founder Pass.</div>
                      <p className="text-gray-400 text-[13px] leading-relaxed mb-6">Connect a Sui wallet to sign your spot. One tap, gas-free.{referrer && <span className="text-gray-500"> Referred by {short(referrer)}.</span>}</p>
                      <div className="[&_button]:!w-full [&_button]:!justify-center [&_button]:!bg-vermilion [&_button]:hover:!bg-vermilion-d [&_button]:!rounded-full [&_button]:!py-3.5 [&_button]:!font-semibold [&_button]:!text-white [&_button]:!transition-colors">
                        <ConnectButton connectText="Connect wallet to claim →" />
                      </div>
                    </>
                  ) : state?.joined ? (
                    <>
                      <div className="flex items-end gap-3 mb-1">
                        <span className="font-display font-extrabold text-6xl sm:text-7xl tracking-tighter tabular-nums leading-none">#{me?.rank ?? state.position ?? '—'}</span>
                        {isFounder
                          ? <span className="mb-2 inline-flex items-center gap-1 border border-vermilion/40 bg-vermilion/10 rounded-full px-2.5 py-1 font-mono text-[11px] text-vermilion"><Star size={11} className="fill-vermilion" /> FOUNDER</span>
                          : <span className="mb-2 inline-flex items-center gap-1 border border-emerald-500/25 bg-emerald-500/[0.07] rounded-full px-2.5 py-1 font-mono text-[11px] text-emerald-300"><Check size={11} /> EARLY</span>}
                      </div>
                      <div className="font-mono text-[12px] text-gray-400 mb-6">your place in line{lb ? <span className="text-gray-600"> · of {lb.total}</span> : null}{me ? <span className="text-gray-500"> · {me.referrals} referral{me.referrals === 1 ? '' : 's'}</span> : null}</div>

                      <div className="border-t border-dashed border-white/10 pt-5">
                        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-600 mb-2">Climb the line — invite</div>
                        <div className="flex items-center gap-2">
                          <input readOnly value={refLink} className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-[11px] text-gray-400 outline-none" />
                          <button onClick={() => { navigator.clipboard.writeText(refLink); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                            className="shrink-0 inline-flex items-center gap-1.5 font-mono text-[11px] px-3 py-2.5 rounded-lg border border-white/10 hover:border-vermilion/50 text-gray-300 hover:text-white transition-colors">
                            {copied ? <><Check size={12} /> copied</> : <><Copy size={12} /> copy</>}
                          </button>
                        </div>
                        <p className="font-mono text-[10px] text-gray-600 mt-2.5">each signed referral moves you up — climb into Founder.</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="font-display font-extrabold text-3xl tracking-tight leading-tight mb-2">You're connected.</div>
                      <p className="text-gray-400 text-[13px] leading-relaxed mb-6">Sign once to lock your Founder spot on-chain.{referrer && <span className="text-gray-500"> Referred by {short(referrer)}.</span>}</p>
                      <button onClick={join} disabled={busy}
                        className="group w-full inline-flex items-center justify-center gap-2 bg-vermilion hover:bg-vermilion-d text-white font-semibold rounded-full py-3.5 transition-all disabled:opacity-60 hover:shadow-[0_0_30px_-6px_var(--vermilion)]">
                        {busy ? <><Loader2 size={16} className="animate-spin" /> signing…</> : <>{sponsorReady ? 'Join the Founder list — free' : 'Join the Founder list'} <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" /></>}
                      </button>
                      {err && <p className="text-rose-400 text-[12px] mt-3 font-mono">{err}</p>}
                    </>
                  )}
                </div>
              </div>

              {/* live line, under the pass */}
              {top.length > 0 && (
                <div className="mt-3 rounded-2xl border border-white/[0.06] bg-white/[0.015] p-5">
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-gray-600 mb-3">Top of the line · by referrals</div>
                  <div className="space-y-2">
                    {top.map((e) => {
                      const mine = address && e.address === address.toLowerCase();
                      return (
                        <div key={e.address} className="flex items-center justify-between text-[12px] font-mono">
                          <span className="flex items-center gap-2.5 min-w-0">
                            <span className={`w-6 text-right ${e.tier === 'Founder' ? 'text-vermilion' : 'text-gray-600'}`}>#{e.rank}</span>
                            <span className={`truncate ${mine ? 'text-white' : 'text-gray-400'}`}>{short(e.address)}{mine ? ' · you' : ''}</span>
                          </span>
                          <span className="shrink-0 text-gray-500">{e.referrals} ref{e.referrals === 1 ? '' : 's'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          </div>

          {/* ── reserve your name ────────────────────────────── */}
          <motion.div {...rise(0.12)} className="mt-14 sm:mt-20 rounded-3xl border border-white/[0.07] bg-gradient-to-b from-[#0e1311] to-[#0a0a0c] p-7 sm:p-10">
            <div className="grid md:grid-cols-[0.9fr_1.1fr] gap-7 md:gap-10 items-center">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-2">Reserve your name</div>
                <h2 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight">Claim a <span className="text-new-mint">.yosuku.sui</span><br className="hidden sm:block" /> handle.</h2>
                <p className="text-gray-400 text-[14px] leading-relaxed mt-3 max-w-md">A portable on-chain identity for your bets and strategies. Check if it's free — Founders mint it to their own wallet at launch.</p>
              </div>
              <div>
                <div className="flex items-stretch rounded-xl border border-white/10 bg-black/50 overflow-hidden focus-within:border-new-mint/40 focus-within:shadow-[0_0_24px_-10px_var(--color-new-mint)] transition-all">
                  <input value={label} onChange={(e) => setLabel(normalize(e.target.value))} placeholder="yourname" spellCheck={false}
                    className="flex-1 min-w-0 bg-transparent px-4 py-3.5 font-mono text-[15px] sm:text-[16px] text-white outline-none placeholder:text-gray-600" />
                  <span className="flex items-center pr-4 font-mono text-[15px] sm:text-[16px] text-gray-500">.yosuku.sui</span>
                </div>
                <div className="h-6 mt-2.5 font-mono text-[12px]">
                  {name === 'checking' && <span className="text-gray-500 inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> checking…</span>}
                  {name === 'available' && <span className="text-new-mint inline-flex items-center gap-1.5"><Check size={13} /> {label}.yosuku.sui is available — reserve it by joining.</span>}
                  {name === 'taken' && <span className="text-off-red inline-flex items-center gap-1.5"><X size={13} /> {label}.yosuku.sui is taken.</span>}
                  {name === 'invalid' && <span className="text-gray-600">3–63 chars · letters, numbers, hyphens (not at the ends).</span>}
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── why join ─────────────────────────────────────── */}
          <div className="grid sm:grid-cols-3 gap-3 sm:gap-4 mt-3 sm:mt-4">
            {[
              { icon: ShieldCheck, t: 'On-chain, not an email', d: 'Your spot is a signed transaction — verifiable demand anyone can audit. Gas sponsored, so it costs nothing.' },
              { icon: Users, t: 'Referrals climb the line', d: 'Share your link. Every signed referral lifts your effective rank, computed live from on-chain events.' },
              { icon: Star, t: 'First 100 are Founders', d: 'The top tier gets first access at the real-money launch — plus a permanent Founder badge.' },
            ].map((p, i) => (
              <motion.div key={p.t} {...rise(0.04 * i)} className="group rounded-2xl border border-white/[0.06] bg-white/[0.015] p-6 hover:border-white/15 hover:bg-white/[0.03] transition-all">
                <p.icon size={19} className="text-vermilion mb-3 group-hover:scale-110 transition-transform origin-left" />
                <div className="font-display font-bold text-[15px] mb-1.5">{p.t}</div>
                <div className="text-gray-400 text-[13px] leading-relaxed">{p.d}</div>
              </motion.div>
            ))}
          </div>

          <p className="text-center font-mono text-[11px] text-gray-600 mt-12 sm:mt-16">
            non-custodial · the agent trades, it can never withdraw · <button onClick={() => router.push('/how-it-works')} className="text-gray-400 hover:text-white underline underline-offset-2">how it works</button>
          </p>
        </div>
      </main>
    </div>
  );
}
