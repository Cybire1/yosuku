'use client';

// yosuku.xyz/trade-from-x — "X-trade". Connect once, then tweet your bets at @yosukuapp.
// The page's whole argument is the un-drainable custody rail: the agent's only power over
// your money is one function that opens a position YOU own and settles back to you — there is
// no withdraw door to route an injection into. Flow: connect → fund + authorize (1 sig) →
// link X (code) → tweet bets. Logic unchanged; the UI/UX is the award layer.
import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { ConnectButton, useCurrentAccount } from '@mysten/dapp-kit';
import { ArrowRight, Copy, Check } from 'lucide-react';
import { useSmartSubmit } from '@/lib/sui/useSmartSubmit';
import { fetchDUSDCCoins } from '@/lib/sui/queries';
import { buildEnableTweetTrading624 } from '@/lib/sui/vault624Client';

const CONNECT_URL = process.env.NEXT_PUBLIC_CONNECT_URL || 'https://yosuku-connect.yosuku.workers.dev';
const DUSDC_MUL = 1_000_000;
const TWEET_MAX_LEVERAGE_1E9 = 3_000_000_000n; // authorize the agent up to 3x/trade (it always clamps to the tweet)
const PRESETS = ['5', '10', '25'];
const EXAMPLES = ['@yosukuapp BTC up 3x', '@yosukuapp long btc $5', '@yosukuapp short bitcoin 2x'];

const V = '#E04D26', M = '#34D399';

export default function XTradePage() {
  const account = useCurrentAccount();
  const { submit } = useSmartSubmit();
  const addr = account?.address ?? null;

  const [amount, setAmount] = useState('5');
  const [depositing, setDepositing] = useState(false);
  const [deposited, setDeposited] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [ex, setEx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setEx((i) => (i + 1) % EXAMPLES.length), 2600);
    return () => clearInterval(t);
  }, []);

  const deposit = useCallback(async () => {
    if (!addr) return;
    setErr(''); setDepositing(true);
    try {
      const micro = BigInt(Math.round(parseFloat(amount || '0') * DUSDC_MUL));
      if (micro <= BigInt(0)) throw new Error('Enter an amount');
      const coins = await fetchDUSDCCoins(null as never, addr);
      if (!coins.length) throw new Error('No DUSDC in your wallet. Grab some from the faucet first.');
      // ONE signature: deposit DUSDC into your vault ledger AND authorize the bounded relay agent
      // (per-trade caps). The agent can open tweeted positions from your funds but has NO path to
      // withdraw them — only you can. maxMargin = what you fund this round.
      await submit(() =>
        buildEnableTweetTrading624({
          coinIds: coins.slice(0, 15).map((c) => c.coinObjectId),
          amountMicro: micro,
          maxMarginMicro: micro,
          maxLeverage1e9: TWEET_MAX_LEVERAGE_1E9,
        }),
      );
      setDeposited(true);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setDepositing(false); }
  }, [addr, amount, submit]);

  const getCode = useCallback(async () => {
    if (!addr) return;
    setErr(''); setBusy(true);
    try {
      const r = await fetch(`${CONNECT_URL}/code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: addr }) });
      const j = await r.json();
      if (!r.ok || !j.code) throw new Error(j.error || 'Could not get a code. Try again.');
      setCode(j.code);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, [addr]);

  const tweetText = code ? `@yosukuapp connect ${code}` : '';
  const tweetHref = code ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}` : '#';
  const copy = () => { navigator.clipboard?.writeText(tweetText); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const step = !addr ? 1 : !deposited ? 2 : !code ? 3 : 4;

  return (
    <main data-theme="dark" style={{ backgroundColor: '#08080b' }} className="xt min-h-screen bg-[#08080b] text-[#f3f1ee] selection:bg-vermilion selection:text-white overflow-x-clip">
      <div className="xt-grain" />

      {/* header: editorial strip, but it ROUTES — the app's primary nav lives here too */}
      <div className="sticky top-0 z-50 backdrop-blur bg-[#08080b]/70 border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between gap-4">
          <Link href="/markets" className="font-display font-extrabold tracking-[0.16em] text-sm hover:text-vermilion transition-colors">
            YOSUKU <span className="text-gray-500 font-mono font-normal tracking-normal">/ X-trade</span>
          </Link>
          <nav className="hidden md:flex items-center gap-5 font-mono text-[11px] uppercase tracking-[0.12em] text-gray-500">
            <Link href="/markets" className="hover:text-white transition-colors">Markets</Link>
            <Link href="/feed" className="hover:text-white transition-colors">Reels</Link>
            <Link href="/earn" className="hover:text-white transition-colors">Earn</Link>
            <Link href="/strategies" className="hover:text-white transition-colors">Strategies</Link>
            <Link href="/leaderboard" className="hover:text-white transition-colors">Leaderboard</Link>
            <Link href="/portfolio" className="hover:text-white transition-colors">Portfolio</Link>
          </nav>
          <Link href="/markets" className="font-mono text-[12px] text-vermilion inline-flex items-center gap-1.5 hover:gap-2.5 transition-all shrink-0">open the app <ArrowRight className="w-3.5 h-3.5" /></Link>
        </div>
      </div>

      {/* ── HERO — the un-drainable custody rail is the centerpiece ── */}
      <section className="relative max-w-6xl mx-auto px-5 sm:px-8 pt-16 sm:pt-24 pb-14">
        <div className="xt-kanji hidden sm:block text-[clamp(9rem,20vw,17rem)]" style={{ top: '-4%', right: '-2%' }} aria-hidden>予測</div>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] gap-10 lg:gap-8 items-center">
          <div className="relative z-10">
            <div className="xt-boot font-mono text-[11px] tracking-[0.34em] text-vermilion/80 uppercase" style={{ animationDelay: '0ms' }}>予測 · X-trade</div>
            <h1 className="mt-5 font-display font-[800] tracking-[-0.03em] leading-[0.96] text-[clamp(2.7rem,7vw,5rem)] [text-wrap:balance]">
              <span className="xt-boot block" style={{ animationDelay: '90ms' }}>Trade by tweeting.</span>
              <span className="xt-payoff relative inline-block mt-3 font-jp italic text-vermilion text-[1.04em]">
                Un&#8288;-&#8288;drainably.
                <span className="xt-ul absolute left-0 -bottom-1 h-px w-full bg-vermilion" />
              </span>
            </h1>
            <p className="xt-boot mt-6 text-gray-400 leading-relaxed max-w-[40ch]" style={{ animationDelay: '440ms' }}>
              Tweet your bets at <span className="text-white">@yosukuapp</span>. A bounded agent trades <span className="text-white">your own</span> funds, and can&apos;t take them.
            </p>
            <div className="xt-boot mt-6 flex items-center gap-3 font-mono text-[11px] text-gray-500" style={{ animationDelay: '560ms' }}>
              <span className="inline-flex items-center gap-1.5"><Dot c={M} /> your keys, your funds</span>
              <span className="text-gray-700">·</span>
              <span>Sui testnet · DeepBook Predict</span>
            </div>
          </div>

          <div className="xt-boot relative z-10" style={{ animationDelay: '680ms' }}>
            <CustodyRail />
          </div>
        </div>
      </section>

      {/* ── THE FLOW — focus-follows-step spine ── */}
      <section className="relative max-w-2xl mx-auto px-5 sm:px-8 pb-24">
        <div className="font-mono text-[11px] tracking-[0.3em] text-gray-500 uppercase mb-7">— set it up · three steps</div>
        <ol className="relative">
          {/* 1 — connect */}
          <Step n="1" title="Connect your wallet" state={step > 1 ? 'done' : 'active'} spine={{ from: 1, cur: step }}>
            {addr ? (
              <IdentityChip addr={addr} />
            ) : (
              <div className="[&_button]:!bg-vermilion [&_button]:hover:!brightness-110 [&_button]:!rounded-full [&_button]:!font-display [&_button]:!font-bold [&_button]:!text-[#08080b] [&_button]:transition"><ConnectButton connectText="Connect wallet" /></div>
            )}
          </Step>

          {/* 2 — fund + authorize = the capability receipt (climax) */}
          <Step n="2" title="Fund + authorize the agent" state={deposited ? 'done' : step === 2 ? 'active' : 'idle'} spine={{ from: 2, cur: step }}>
            {deposited ? (
              <div className="font-mono text-[12px] text-new-mint inline-flex items-center gap-2"><Tick /> vault funded · agent authorized · you can top up anytime</div>
            ) : (
              <CapabilityReceipt
                amount={amount} setAmount={setAmount} disabled={!addr}
                depositing={depositing} onDeposit={deposit}
              />
            )}
          </Step>

          {/* 3 — link X */}
          <Step n="3" title="Link your X account" state={code ? 'done' : step === 3 ? 'active' : 'idle'} spine={{ from: 3, cur: step }} isLast>
            {!code ? (
              <>
                <p className="text-[13px] text-gray-400 mb-4">Tweet a one-time code to prove your handle.</p>
                <button onClick={getCode} disabled={!addr || !deposited || busy} className="xt-cta bg-vermilion text-[#08080b] disabled:opacity-40 rounded-full px-6 py-2.5 font-display font-bold text-sm inline-flex items-center gap-2">
                  {busy ? 'Generating…' : 'Get my connect code'}
                </button>
              </>
            ) : (
              <CodeTicket code={code} tweetHref={tweetHref} copied={copied} onCopy={copy} />
            )}
          </Step>
        </ol>

        {err && <div className="mt-5 rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-4 py-3 text-[13px] text-rose-300 font-mono">{err} <span className="text-rose-400/70">· nothing left your wallet.</span></div>}

        {/* ── payoff composer ── */}
        <div className={`mt-10 rounded-2xl border p-6 transition-all duration-500 ${code ? 'border-new-mint/25 bg-new-mint/[0.03]' : 'border-white/[0.07] bg-white/[0.02] opacity-55'}`}>
          <div className="font-mono text-[11px] tracking-[0.24em] text-gray-500 uppercase mb-3">then — you&apos;re live</div>
          <div className="font-display font-bold text-lg mb-3">Just tweet your bets.</div>
          <div className="rounded-xl border border-white/12 bg-black/40 px-4 py-3 font-mono text-[15px] flex items-center gap-2 min-w-0">
            <span className="text-gray-600 shrink-0">›</span>
            <span key={ex} className="xt-boot text-white truncate" style={{ animationDuration: '.5s' }}>{EXAMPLES[ex]}</span>
          </div>
          <p className="mt-3 font-mono text-[11px] text-gray-500">opens from your vault · settles back to you.</p>
        </div>

        {/* ── persistent trust footer ── */}
        <div className="mt-8 border-t border-white/[0.07] pt-6 flex flex-col gap-2.5">
          <div className="flex items-center gap-2 font-mono text-[11px] text-gray-500"><Dot c={V} /> no withdraw function exists — verify:</div>
          <ProofLink href="https://suiscan.xyz/testnet/tx/Cn69DaM49d5bATJLGyhokudS39F4s6j1rSPDLMhUy1Hb">position owned by the vault, not the agent</ProofLink>
          <ProofLink href="https://suiscan.xyz/testnet/tx/BmuJroQS4wgG9yvVBCDsq7xmdYVD6WyLsFPsBN8Em8rr">exit returned 0.953 to the user · agent ±0</ProofLink>
          <p className="mt-1 font-mono text-[10.5px] text-gray-600">testnet · you can lose a bet · the agent just can&apos;t take your funds.</p>
        </div>
      </section>
    </main>
  );
}

/* ── the hero proof: tweet → bounded agent → a position that's yours; the withdraw door doesn't exist ── */
function CustodyRail() {
  return (
    <figure className="m-0">
      <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.03] to-transparent p-3 sm:p-4">
        <svg viewBox="0 0 440 300" className="w-full h-auto" role="img" aria-label="The agent can only open a position you own; there is no withdraw path.">
          <defs>
            <radialGradient id="xtGlow" cx="50%" cy="42%" r="55%">
              <stop offset="0%" stopColor={V} stopOpacity="0.10" /><stop offset="100%" stopColor={V} stopOpacity="0" />
            </radialGradient>
            <marker id="xtArrM" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill={M} /></marker>
          </defs>
          <rect x="150" y="70" width="200" height="110" fill="url(#xtGlow)" />

          {/* wires */}
          <path d="M150,48 C205,62 214,88 232,106" fill="none" stroke={V} strokeWidth="1.6" opacity="0.9" className="xt-flow" />
          <path d="M272,116 L346,116" fill="none" stroke={V} strokeWidth="1.6" opacity="0.9" className="xt-flow" />
          <path d="M398,146 C398,214 320,262 292,262" fill="none" stroke={M} strokeWidth="1.8" className="xt-flowm" markerEnd="url(#xtArrM)" />

          {/* withdraw stub — sealed */}
          <path d="M252,142 L252,190" fill="none" stroke={V} strokeWidth="1.4" strokeDasharray="3 4" opacity="0.55" />

          {/* nodes */}
          {/* tweet chip */}
          <g>
            <rect x="6" y="32" width="150" height="32" rx="8" fill="#0e0e12" stroke="rgba(255,255,255,0.14)" />
            <text x="16" y="52" fontFamily="var(--font-mono)" fontSize="11" fill="#cfcbc4">@yosukuapp BTC up 3x</text>
          </g>
          {/* agent hexagon */}
          <g>
            <path className="xt-node-draw" d="M252,90 L280,106 L280,138 L252,154 L224,138 L224,106 Z" fill="#120d0c" stroke={V} strokeWidth="1.4" />
            <text x="252" y="126" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="9.5" fill={V}>agent</text>
          </g>
          <text x="252" y="172" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="8.5" fill="#7c7770">bounded key · agent_mint_for</text>
          {/* your position */}
          <g>
            <rect x="346" y="92" width="88" height="50" rx="10" fill="#0b1210" stroke={M} strokeOpacity="0.5" />
            <text x="390" y="112" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="#dfe">BTC · yours</text>
            <text x="390" y="130" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="12" fontWeight="700" fill={M}>5.00</text>
          </g>
          <text x="390" y="160" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="8" fill={M} opacity="0.8">unchanged</text>
          {/* you */}
          <g>
            <rect x="212" y="248" width="80" height="28" rx="9" fill="#0e0e12" stroke="rgba(255,255,255,0.16)" />
            <text x="252" y="266" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="11" fill="#cfcbc4">you</text>
          </g>
          {/* sealed withdraw door */}
          <g className="xt-seal">
            <rect x="150" y="189" width="204" height="32" rx="8" fill="#140c0b" stroke={V} strokeOpacity="0.5" />
            {/* lock-with-slash, docked left inside the box */}
            <g transform="translate(167,205)">
              <rect x="-5" y="-3" width="10" height="7.5" rx="1.5" fill="none" stroke={V} strokeWidth="1.2" />
              <path d="M-2.5,-3 v-2 a2.5,2.5 0 0 1 5,0 v2" fill="none" stroke={V} strokeWidth="1.2" />
              <line x1="-7.5" y1="6" x2="7.5" y2="-6.5" stroke={V} strokeWidth="1.3" />
            </g>
            <text x="183" y="208.5" fontFamily="var(--font-mono)" fontSize="8.5" fill="#9a8d87">withdraw() · transfer() · sweep()</text>
            <line x1="183" y1="205" x2="347" y2="205" stroke={V} strokeWidth="1" strokeOpacity="0.55" />
          </g>
          <text x="252" y="235" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="8.5" fill="#8a847d">no such function in the contract</text>

          {/* attack packet — travels the tweet wire, tries the withdraw stub, dies at the seal */}
          <g className="xt-attack-only">
            <circle r="3.4" fill={V}>
              <animateMotion dur="6s" repeatCount="indefinite" keyPoints="0;0.62;0.62" keyTimes="0;0.42;1" calcMode="linear"
                path="M150,48 C205,62 214,88 232,106 L252,124 L252,190" />
              <animate attributeName="opacity" dur="6s" repeatCount="indefinite" keyTimes="0;0.05;0.4;0.46;1" values="0;1;1;0;0" />
            </circle>
          </g>
        </svg>
      </div>
      <figcaption className="mt-3 font-mono text-[11px] text-gray-400">
        you tweet → the agent opens → <span className="text-gray-200">the position is yours.</span>
      </figcaption>
    </figure>
  );
}

/* ── Capability Receipt — the one-signature step, turned into the un-drainable proof ── */
function CapabilityReceipt({ amount, setAmount, disabled, depositing, onDeposit }: { amount: string; setAmount: (v: string) => void; disabled: boolean; depositing: boolean; onDeposit: () => void }) {
  const amt = parseFloat(amount || '0') || 0;
  return (
    <div>
      <p className="font-display text-[15px] leading-snug text-gray-200 mb-4">
        Fund <span className="text-white">{amt || '—'} DUSDC</span>. Grant <span className="text-vermilion">one</span> power: open a position you own.
      </p>

      {/* amount + presets */}
      <div className="flex flex-wrap items-center gap-2.5 mb-4">
        <div className="flex items-center gap-2 border border-white/12 rounded-xl px-3.5 py-2.5 focus-within:border-white/30 transition-colors">
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" disabled={disabled} className="bg-transparent w-14 outline-none font-mono text-lg" aria-label="Amount in DUSDC" />
          <span className="text-gray-500 font-mono text-sm">DUSDC</span>
        </div>
        {PRESETS.map((p) => (
          <button key={p} onClick={() => setAmount(p)} disabled={disabled} className="rounded-lg border border-white/10 hover:border-white/25 px-3 py-2 font-mono text-[12px] text-gray-400 hover:text-white transition-colors disabled:opacity-40">+{p}</button>
        ))}
      </div>

      {/* CAN / CANNOT ledger */}
      <div className="grid sm:grid-cols-2 gap-2.5 mb-4">
        <div className="rounded-xl border border-new-mint/20 bg-new-mint/[0.03] p-3.5">
          <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-new-mint/80 mb-2 inline-flex items-center gap-1.5"><Dot c={M} /> can</div>
          <div className="text-[12.5px] text-gray-300 leading-relaxed">open a position you own — ≤ <span className="text-white">{amt || '—'}</span>/trade, ≤ 3×.</div>
        </div>
        <div className="rounded-xl border border-vermilion/20 bg-vermilion/[0.03] p-3.5">
          <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-vermilion/80 mb-2 inline-flex items-center gap-1.5"><Dot c={V} /> cannot</div>
          <div className="text-[12.5px] text-gray-400 leading-relaxed"><span className="line-through decoration-vermilion/50">withdraw · transfer · drain</span> — no such function.</div>
        </div>
      </div>

      {/* one line, then sign */}
      <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 mb-3.5 font-mono text-[11.5px] text-gray-400">
        fund <span className="text-gray-200">{amt || '—'} DUSDC</span> · open-position only · revocable
      </div>
      <button onClick={onDeposit} disabled={disabled || depositing || amt <= 0} className="xt-cta w-full sm:w-auto bg-vermilion text-[#08080b] disabled:opacity-40 rounded-full px-7 py-3 font-display font-bold text-sm inline-flex items-center justify-center gap-2">
        {depositing ? 'Confirm in your wallet…' : 'Fund + Authorize · 1 signature'}
      </button>
    </div>
  );
}

/* ── the connect-code ticket with the tactile copy moment ── */
function CodeTicket({ code, tweetHref, copied, onCopy }: { code: string; tweetHref: string; copied: boolean; onCopy: () => void }) {
  return (
    <div>
      <p className="text-[13px] text-gray-400 mb-3">Tweet this to prove your handle:</p>
      <div className={`flex items-center gap-2 rounded-xl border px-4 py-3.5 transition-colors ${copied ? 'border-new-mint/40 bg-new-mint/[0.05] xt-bloom' : 'border-vermilion/40 bg-vermilion/[0.06]'}`}>
        <code className="font-mono text-[15px] flex-1 break-all relative">
          <span className={copied ? 'text-new-mint' : 'text-vermilion'}>@yosukuapp connect {code}</span>
          <span className={`xt-copyline ${copied ? 'on' : ''} absolute left-0 -bottom-1 h-px w-full bg-new-mint`} />
        </code>
        <button onClick={onCopy} aria-label="Copy tweet" className="xt-cta shrink-0 text-gray-400 hover:text-white transition-colors">
          {copied ? <Check className="w-4 h-4 text-new-mint" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
      <div className={`mt-3.5 flex flex-wrap gap-2.5 ${copied ? 'xt-bloom rounded-full' : ''}`}>
        <a href={tweetHref} target="_blank" rel="noreferrer" className="xt-cta bg-vermilion text-[#08080b] rounded-full px-6 py-2.5 font-display font-bold text-sm inline-flex items-center gap-2">Post it on X <ArrowRight className="w-4 h-4" /></a>
      </div>
      <p className="mt-4 font-mono text-[11px] text-gray-500">replies <span className="text-new-mint">connected</span> · valid ~30 min.</p>
    </div>
  );
}

function IdentityChip({ addr }: { addr: string }) {
  const g = addr.slice(2, 8);
  return (
    <div className="inline-flex items-center gap-2.5 rounded-full border border-new-mint/25 bg-new-mint/[0.04] pl-1.5 pr-3.5 py-1.5">
      <span className="w-6 h-6 rounded-full shrink-0" style={{ background: `conic-gradient(from 0deg, #${g}, ${V}, ${M}, #${g})` }} />
      <span className="font-mono text-[12.5px] text-gray-200">{addr.slice(0, 6)}…{addr.slice(-4)}</span>
      <span className="font-mono text-[10px] text-new-mint inline-flex items-center gap-1"><Dot c={M} /> connected</span>
    </div>
  );
}

/* ── a step on the focus-follows-step spine ── */
function Step({ n, title, state, spine, isLast, children }: { n: string; title: string; state: 'idle' | 'active' | 'done'; spine: { from: number; cur: number }; isLast?: boolean; children: React.ReactNode }) {
  const done = state === 'done', active = state === 'active';
  const filled = spine.cur > spine.from; // spine segment below this node is filled once we've moved past it
  return (
    <li className={`relative flex gap-4 sm:gap-5 ${isLast ? '' : 'pb-3'} ${state === 'idle' ? 'opacity-40' : ''} transition-opacity duration-500`}>
      <div className="flex flex-col items-center">
        <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-mono text-[13px] border transition-colors ${done ? 'bg-new-mint/15 border-new-mint/45 text-new-mint' : active ? 'bg-vermilion/15 border-vermilion/55 text-vermilion xt-node-active' : 'bg-white/[0.03] border-white/12 text-gray-500'}`}>
          {done ? <Tick /> : n}
        </div>
        {!isLast && (
          <div className="relative w-px flex-1 my-1.5 bg-vermilion/12 overflow-hidden">
            <div className="xt-spine-fill absolute inset-0 bg-vermilion" style={{ transform: `scaleY(${filled ? 1 : 0})` }} />
          </div>
        )}
      </div>
      <div className={`flex-1 min-w-0 rounded-2xl border p-5 mb-3 transition-all duration-500 ${done ? 'border-new-mint/22 bg-new-mint/[0.025]' : active ? 'border-vermilion/25 bg-vermilion/[0.03]' : 'border-white/[0.07] bg-white/[0.02]'}`}>
        <div className="font-display font-bold mb-2.5">{title}</div>
        {children}
      </div>
    </li>
  );
}

function Dot({ c }: { c: string }) { return <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: c }} />; }
function Tick() { return (<svg className="xt-check w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>); }
function ProofLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="group font-mono text-[11.5px] text-gray-500 hover:text-vermilion transition-colors inline-flex items-center gap-2">
      <span className="text-gray-700 group-hover:text-vermilion transition-colors">↗</span> {children}
    </a>
  );
}
