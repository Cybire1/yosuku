'use client';

import { useEffect, useState, useCallback } from 'react';
import { fetchTraction, type TractionStats, type Interaction } from '@/lib/sui/traction';
import WaitlistCard from '@/components/WaitlistCard';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import CustomCursor from '@/components/CustomCursor';

const SCAN_TX = (d: string) => `https://suiscan.xyz/testnet/tx/${d}`;
const SCAN_ACC = (a: string) => `https://suiscan.xyz/testnet/account/${a}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: n < 100 ? 2 : 0 });

function ago(ts: number): string {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const KIND_LABEL: Record<Interaction['kind'], string> = {
  'tweet-trade': 'tweet-trade',
  leverage: 'leveraged open',
  liquidation: 'liquidation',
  deposit: 'vault deposit',
};
const KIND_DOT: Record<Interaction['kind'], string> = {
  'tweet-trade': '#34d399',
  leverage: 'var(--vermilion)',
  liquidation: '#f59e0b',
  deposit: '#60a5fa',
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-white/[0.07] rounded-2xl bg-[#0d0d10] p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-2">{label}</div>
      <div className="font-display text-3xl font-extrabold tracking-tight tabular-nums">{value}</div>
      {sub && <div className="font-mono text-[11px] text-gray-600 mt-1">{sub}</div>}
    </div>
  );
}

export default function StatsPage() {
  const [t, setT] = useState<TractionStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setT(await fetchTraction()); } catch { /* keep last */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <CustomCursor />
      <GrainOverlay />
      <main className="container pt-[120px] pb-12">
        <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" style={{ boxShadow: '0 0 12px #34d399' }} />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-500">Live · testnet · verifiable on-chain</span>
      </div>
      <h1 className="font-display text-4xl font-extrabold tracking-tight mb-1">Proof</h1>
      <p className="text-gray-400 text-sm leading-relaxed mb-8 max-w-2xl">
        Every number below is a real event emitted by Yosuku&apos;s own smart contracts, read straight from
        the chain — nothing self-reported. Distinct wallets are the actual traders inside each event (the
        attested agent signs, so the trader is in the payload). Click any row to verify it on Suiscan.
      </p>

      <div className="mb-10">
        <WaitlistCard />
      </div>

      {loading && !t ? (
        <div className="font-mono text-sm text-gray-500 py-20 text-center">reading the chain…</div>
      ) : t ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-10">
            <Stat label="On-chain interactions" value={fmt(t.interactions)} />
            <Stat label="Distinct wallets" value={fmt(t.distinctWallets)} />
            <Stat label="Tweet-trades" value={fmt(t.tweetTrades)} sub="un-drainable" />
            <Stat label="Volume" value={`${fmt(t.volumeDusdc)}`} sub="DUSDC notional" />
            <Stat label="Liquidations" value={fmt(t.liquidations)} sub="agent-executed" />
          </div>

          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display text-lg font-bold">Recent activity</h2>
            <span className="font-mono text-[10px] text-gray-600">updated {ago(t.updatedAt)}</span>
          </div>
          <div className="border border-white/[0.07] rounded-2xl bg-[#0d0d10] divide-y divide-white/[0.05] overflow-hidden">
            {t.recent.length === 0 && (
              <div className="font-mono text-xs text-gray-500 px-5 py-8 text-center">no activity indexed yet</div>
            )}
            {t.recent.map((r, i) => {
              const inner = (
                <div className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition-colors">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: KIND_DOT[r.kind], boxShadow: `0 0 8px ${KIND_DOT[r.kind]}` }} />
                  <span className="font-mono text-[12px] text-gray-300 w-32 shrink-0">{KIND_LABEL[r.kind]}</span>
                  <a
                    href={SCAN_ACC(r.user)} target="_blank" rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="font-mono text-[12px] text-gray-500 hover:text-white transition-colors"
                  >{short(r.user)}</a>
                  <span className="flex-1" />
                  {r.amount > 0 && <span className="font-mono text-[12px] text-gray-300 tabular-nums">{fmt(r.amount)} DUSDC</span>}
                  <span className="font-mono text-[11px] text-gray-600 w-16 text-right shrink-0">{ago(r.ts)}</span>
                  <span className="font-mono text-[11px] text-vermilion w-4 text-right shrink-0">{r.digest ? '↗' : ''}</span>
                </div>
              );
              // Row opens the tx; the address inside is its own link. Use a
              // clickable div (not <a>) so we never nest <a> in <a> (hydration error).
              const txHref = r.digest ? SCAN_TX(r.digest) : null;
              return txHref ? (
                <div
                  key={i}
                  role="link"
                  tabIndex={0}
                  onClick={() => window.open(txHref, '_blank', 'noopener,noreferrer')}
                  onKeyDown={(e) => { if (e.key === 'Enter') window.open(txHref, '_blank', 'noopener,noreferrer'); }}
                  className="block cursor-pointer"
                >{inner}</div>
              ) : (
                <div key={i}>{inner}</div>
              );
            })}
          </div>

          <p className="font-mono text-[11px] text-gray-600 mt-5 leading-relaxed">
            Reads <span className="text-gray-400">social_vault</span>, <span className="text-gray-400">margin</span> and{' '}
            <span className="text-gray-400">underwrite</span> events via Sui GraphQL. Testnet today; the same surface
            carries to mainnet at launch.
          </p>
        </>
      ) : (
        <div className="font-mono text-sm text-rose-400 py-20 text-center">couldn&apos;t reach the chain — retrying…</div>
      )}
        </div>
        <Footer />
      </main>
    </div>
  );
}
