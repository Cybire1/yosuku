'use client';

/* eslint-disable @next/next/no-img-element */
// yosuku.xyz/demo — the walkthrough, in place of a video. Real product, real on-chain
// proof. Every claim links to a tx anyone can verify. Brand: near-black + vermilion, Sora.
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, Zap, ShieldCheck, TrendingUp, Users, MessageSquare, Smartphone, ExternalLink } from 'lucide-react';

const SCAN = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;

const rise = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } },
};

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-[11px] tracking-[0.34em] text-vermilion/80 uppercase">{children}</div>;
}
function Serif({ children }: { children: React.ReactNode }) {
  return <span className="font-jp italic text-vermilion">{children}</span>;
}
function Reveal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div variants={rise} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }} className={className}>
      {children}
    </motion.div>
  );
}
function Frame({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`relative rounded-2xl overflow-hidden border border-white/10 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)] ${className}`}>
      <img src={src} alt={alt} className="w-full block" />
    </div>
  );
}
function ScanLink({ d, label }: { d: string; label: string }) {
  return (
    <a href={SCAN(d)} target="_blank" rel="noreferrer" className="group inline-flex items-center gap-2 font-mono text-[12px] text-gray-400 hover:text-vermilion transition-colors">
      <ExternalLink className="w-3.5 h-3.5" /> {label} <span className="text-gray-600 group-hover:text-vermilion/70">{d.slice(0, 8)}…</span>
    </a>
  );
}

export default function DemoPage() {
  return (
    <main className="min-h-screen bg-[#08080b] text-white selection:bg-vermilion selection:text-white">
      {/* top bar */}
      <div className="sticky top-0 z-50 backdrop-blur bg-[#08080b]/70 border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="font-display font-extrabold tracking-[0.18em] text-sm">YOSUKU <span className="text-gray-500 font-mono font-normal tracking-normal">/ demo</span></div>
          <div className="flex items-center gap-4 font-mono text-[12px]">
            <Link href="/pitch" className="text-gray-400 hover:text-white transition-colors">pitch</Link>
            <Link href="/markets" className="inline-flex items-center gap-1.5 text-vermilion hover:gap-2.5 transition-all">open the app <ArrowRight className="w-3.5 h-3.5" /></Link>
          </div>
        </div>
      </div>

      {/* hero */}
      <section className="relative max-w-6xl mx-auto px-6 pt-24 pb-20">
        <div className="pointer-events-none absolute -right-24 top-0 font-jp font-bold text-vermilion/[0.06] text-[28rem] leading-none select-none hidden lg:block">予</div>
        <div className="relative">
          <Eyebrow>予測 · live demo</Eyebrow>
          <motion.h1 variants={rise} initial="hidden" animate="show" className="mt-6 font-display font-[800] tracking-tight text-[clamp(2.6rem,7vw,5.5rem)] leading-[0.92] max-w-[16ch]">
            See Yosuku <Serif>work.</Serif>
          </motion.h1>
          <motion.p variants={rise} initial="hidden" animate="show" className="mt-6 text-lg text-gray-400 max-w-[52ch] leading-relaxed">
            The consumer front door to on-chain prediction markets. One tap, non-custodial, on web and native mobile. Every feature below is live on Sui testnet, and every claim links to a transaction you can verify yourself.
          </motion.p>
          <motion.div variants={rise} initial="hidden" animate="show" className="mt-9 flex flex-wrap gap-3">
            <Link href="/markets" className="inline-flex items-center gap-2 bg-vermilion hover:bg-vermilion-d transition-colors rounded-full px-5 py-3 font-display font-bold text-sm">Open the app <ArrowRight className="w-4 h-4" /></Link>
            <Link href="/pitch" className="inline-flex items-center gap-2 border border-white/15 hover:border-white/30 transition-colors rounded-full px-5 py-3 font-display font-bold text-sm">See the pitch</Link>
          </motion.div>
          <motion.div variants={rise} initial="hidden" animate="show" className="mt-10 border-t border-white/10 pt-5 font-mono text-[11px] tracking-wide text-gray-500 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span>18 wallets</span><span className="text-vermilion/50">·</span><span>51 gas-free trades</span><span className="text-vermilion/50">·</span><span>~1,800 SDK installs</span><span className="text-vermilion/50">·</span><span>live on Sui testnet</span>
          </motion.div>
        </div>
      </section>

      {/* 1 — trade from a tweet */}
      <section className="max-w-6xl mx-auto px-6 py-20 grid lg:grid-cols-2 gap-12 items-center">
        <Reveal>
          <div className="flex items-center gap-2 text-vermilion"><Zap className="w-5 h-5" /><span className="font-mono text-[12px] tracking-widest uppercase">01 · trade from a tweet</span></div>
          <h2 className="mt-4 font-display font-[800] text-[clamp(1.8rem,4vw,3rem)] leading-[1.05]">Tweet a trade. <Serif>Un-drainably.</Serif></h2>
          <p className="mt-4 text-gray-400 leading-relaxed max-w-[46ch]">
            Grok lost $170k to a single tweet. Yosuku lets you trade by tweeting too, but ours can&apos;t be drained: the agent can only ever move your own vault funds into a position you own. Even a perfect prompt injection gets nothing.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <ScanLink d="2cRyhNAVQRw7TGaDzgHWzkrDYVPfJrCMkKPFoxVSKnWt" label="agent_trade (your funds, your order)" />
            <ScanLink d="2PnQbQqR3bVyUWbT8PsUpb11QAzk27iRxaRz9e9igUb9" label="filled into a position you own" />
            <a href="https://x.com/yosukuapp" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 font-mono text-[12px] text-gray-400 hover:text-vermilion transition-colors"><ExternalLink className="w-3.5 h-3.5" /> the live @yosukuapp replies</a>
          </div>
        </Reveal>
        <Reveal>
          <Frame src="/demo/trade-card.png" alt="Yosuku trade-from-X confirmation card" />
        </Reveal>
      </section>

      {/* 2 — one tap */}
      <section className="max-w-6xl mx-auto px-6 py-20 grid lg:grid-cols-2 gap-12 items-center">
        <Reveal className="lg:order-2">
          <div className="flex items-center gap-2 text-vermilion"><Smartphone className="w-5 h-5" /><span className="font-mono text-[12px] tracking-widest uppercase">02 · the ritual</span></div>
          <h2 className="mt-4 font-display font-[800] text-[clamp(1.8rem,4vw,3rem)] leading-[1.05]">One tap. <Serif>That&apos;s the whole thing.</Serif></h2>
          <p className="mt-4 text-gray-400 leading-relaxed max-w-[46ch]">
            Pick a side, see exactly what you&apos;d win, tap. Gas-free, non-custodial, and the chart is the market: green when you&apos;re winning, red when you&apos;re not. Settled by a price oracle, not a committee.
          </p>
          <Link href="/markets" className="mt-6 inline-flex items-center gap-2 font-mono text-[13px] text-vermilion hover:gap-3 transition-all">try a live market <ArrowRight className="w-4 h-4" /></Link>
        </Reveal>
        <Reveal className="lg:order-1"><Frame src="/demo/chart.png" alt="Yosuku one-tap market" /></Reveal>
      </section>

      {/* 3 — feed */}
      <section className="max-w-6xl mx-auto px-6 py-20 grid lg:grid-cols-2 gap-12 items-center">
        <Reveal>
          <div className="flex items-center gap-2 text-vermilion"><MessageSquare className="w-5 h-5" /><span className="font-mono text-[12px] tracking-widest uppercase">03 · social by default</span></div>
          <h2 className="mt-4 font-display font-[800] text-[clamp(1.8rem,4vw,3rem)] leading-[1.05]">A feed of live markets, <Serif>like short-form video.</Serif></h2>
          <p className="mt-4 text-gray-400 leading-relaxed max-w-[46ch]">
            Scroll live markets like a video feed. Any take becomes a tradeable market with one tap. Opinions turn into positions.
          </p>
        </Reveal>
        <Reveal><Frame src="/demo/feed.png" alt="Yosuku feed" className="max-w-[300px] mx-auto" /></Reveal>
      </section>

      {/* 4 — the depth */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <Reveal>
          <div className="flex items-center gap-2 text-vermilion"><TrendingUp className="w-5 h-5" /><span className="font-mono text-[12px] tracking-widest uppercase">04 · real depth, still non-custodial</span></div>
          <h2 className="mt-4 font-display font-[800] text-[clamp(1.8rem,4vw,3rem)] leading-[1.05]">A real venue under the <Serif>simple front door.</Serif></h2>
        </Reveal>
        <div className="mt-10 grid md:grid-cols-3 gap-4">
          {[
            [TrendingUp, 'Leverage', 'Boost up to 3x, backed by an on-chain underwriting reserve. Opens on your own tx.', null],
            [ShieldCheck, 'Private trades', 'Your wallet never touches the trade. A one-time session route keeps it off-chain-linked.', null],
            [Users, 'Copy-trade strategies', 'Follow a creator-agent. It fans one signal into your own vault, and still can’t divert a cent.', 'BHWqBZxgEiWyveWd7FQ4aNRcFqrv1kaFyyCRpdxa3j5j'],
          ].map(([Icon, h, d, tx]) => {
            const I = Icon as typeof TrendingUp;
            return (
              <Reveal key={h as string}>
                <div className="h-full rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-transparent p-6">
                  <I className="w-6 h-6 text-vermilion" />
                  <div className="mt-4 font-display font-bold text-lg">{h as string}</div>
                  <div className="mt-2 text-[13.5px] text-gray-400 leading-relaxed">{d as string}</div>
                  {tx ? <div className="mt-4"><ScanLink d={tx as string} label="proven on-chain" /></div> : null}
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* 5 — proof */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <Reveal>
          <div className="flex items-center gap-2 text-vermilion"><ShieldCheck className="w-5 h-5" /><span className="font-mono text-[12px] tracking-widest uppercase">05 · don&apos;t trust it. verify it.</span></div>
          <h2 className="mt-4 font-display font-[800] text-[clamp(1.8rem,4vw,3rem)] leading-[1.05]">Every claim is a <Serif>transaction.</Serif></h2>
          <p className="mt-4 text-gray-400 max-w-[52ch] leading-relaxed">No screenshots to trust. Open any of these on Suiscan and see for yourself.</p>
        </Reveal>
        <div className="mt-8 grid sm:grid-cols-2 gap-x-10 gap-y-3.5">
          {[
            ['2cRyhNAVQRw7TGaDzgHWzkrDYVPfJrCMkKPFoxVSKnWt', 'Trade-from-X: agent trades your funds'],
            ['2PnQbQqR3bVyUWbT8PsUpb11QAzk27iRxaRz9e9igUb9', 'Trade-from-X: position minted to you'],
            ['BHWqBZxgEiWyveWd7FQ4aNRcFqrv1kaFyyCRpdxa3j5j', 'Copy-trade: creator signal fanned out'],
            ['6947EN7mFcyvczpb3DFGSJKbaKPkU1E3ToB32gZofKXe', 'Copy-trade: subscriber-owned position'],
            ['9zN7JacN5AdzKLRHRh5vDDocx5CTns6HqFSrfWEavAbj', 'Attested agent trade, one PTB'],
          ].map(([d, label]) => (
            <Reveal key={d}><div className="py-1"><ScanLink d={d} label={label} /></div></Reveal>
          ))}
        </div>
      </section>

      {/* footer cta */}
      <section className="max-w-6xl mx-auto px-6 py-24 text-center">
        <Reveal>
          <div className="font-jp text-vermilion text-6xl mb-6">予</div>
          <h2 className="font-display font-[800] text-[clamp(2rem,5vw,3.5rem)] leading-[1.02]">The front door is <Serif>open.</Serif></h2>
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <Link href="/markets" className="inline-flex items-center gap-2 bg-vermilion hover:bg-vermilion-d transition-colors rounded-full px-6 py-3.5 font-display font-bold">Open the app <ArrowRight className="w-4 h-4" /></Link>
            <Link href="/pitch" className="inline-flex items-center gap-2 border border-white/15 hover:border-white/30 transition-colors rounded-full px-6 py-3.5 font-display font-bold">See the pitch</Link>
          </div>
          <div className="mt-10 font-mono text-[11px] tracking-wide text-gray-600">Yosuku · prediction markets on Sui, made usable by people, developers, and agents.</div>
        </Reveal>
      </section>
    </main>
  );
}
