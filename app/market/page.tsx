'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import { getListings, type Listing } from '@/lib/sui/marketplace';

const KANJI_POOL = '林青霧桜雷雪川石山松森光鳥夜梅藤熊寒銀金空海風波';
function glyph(addr: string): string {
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = ((h << 5) - h + addr.charCodeAt(i)) | 0;
  return KANJI_POOL[Math.abs(h) % KANJI_POOL.length];
}
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function MarketPage() {
  const [listings, setListings] = useState<Listing[] | null>(null);

  useEffect(() => {
    getListings().then(setListings).catch(() => setListings([]));
  }, []);

  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <GrainOverlay />

      <main className="container pt-[140px] pb-24">
        {/* hero */}
        <div className="max-w-3xl mb-14">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-vermilion" style={{ boxShadow: '0 0 12px var(--vermilion)' }} />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-gray-500">
              Strategy market · 戦略
            </span>
          </div>
          <h1 className="font-display text-4xl md:text-6xl font-extrabold tracking-tight leading-[1.05] mb-4">
            Trading knowledge,<br />as an <span className="vermilion">on-chain asset</span>.
          </h1>
          <p className="text-gray-400 text-base leading-relaxed max-w-2xl">
            A strategist&apos;s playbook, encrypted with Seal and stored on Walrus. Verify its
            track record on-chain before you buy. Pay once — the chain decides who can read it.
            No middleman holds the strategy. The paywall <span className="text-white">is</span> a Move predicate.
          </p>
        </div>

        {/* grid */}
        {listings === null ? (
          <div className="font-mono text-sm text-gray-500">Loading strategies…</div>
        ) : listings.length === 0 ? (
          <div className="border border-white/[0.06] rounded-2xl p-12 text-center">
            <div className="font-display text-2xl font-bold mb-2">No strategies listed yet</div>
            <p className="text-gray-500 text-sm">The first playbooks are being distilled from live agents.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {listings.map((l) => (
              <Link
                key={l.id}
                href={`/market/${l.id}`}
                className="group border border-white/[0.06] rounded-2xl p-6 bg-black/40 hover:border-white/[0.14] hover:-translate-y-0.5 transition-all duration-300 flex flex-col"
              >
                <div className="flex items-start justify-between mb-5">
                  <div className="w-12 h-12 rounded-xl border border-white/10 flex items-center justify-center text-2xl font-serif text-gray-300 group-hover:text-white transition-colors">
                    {glyph(l.strategist)}
                  </div>
                  {l.manifest?.provenance?.length ? (
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-emerald-400 border border-emerald-400/30 bg-emerald-400/[0.06] rounded-full px-2.5 py-1">
                      ✓ verified
                    </span>
                  ) : null}
                </div>

                <h2 className="font-display text-xl font-bold tracking-tight mb-1">{l.title}</h2>
                <p className="font-mono text-[11px] text-gray-500 mb-5">by {short(l.strategist)}</p>

                <div className="mt-auto grid grid-cols-3 gap-2 pt-4 border-t border-white/[0.06]">
                  <Stat label="Price" value={`${l.priceDusdc} DUSDC`} />
                  <Stat label="Lessons" value={l.manifest?.lessonCount?.toString() ?? '—'} />
                  <Stat label="Sales" value={l.totalSales.toString()} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-gray-600 mb-1">{label}</div>
      <div className="font-mono text-sm text-white">{value}</div>
    </div>
  );
}
