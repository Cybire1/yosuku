'use client';

import Header from '@/components/Header';
import Footer from '@/components/Footer';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import CustomCursor from '@/components/CustomCursor';
import SectionHeader from '@/components/SectionHeader';
import ParlayBuilder from '@/components/ParlayBuilder';
import ParlaySlip from '@/components/ParlaySlip';

export default function ParlayPage() {
  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <CustomCursor />
      <GrainOverlay />

      <main className="container pt-[120px] pb-16">
        {/* Hero */}
        <div className="mb-12">
          <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-vermilion/80 block mb-4">
            One ticket · many rounds
          </span>
          <h1 className="page-title">
            Parlay<span className="accent">.</span>
          </h1>
          <p className="page-title-jp">連勝 — the close streak</p>
          <p className="page-subtitle mt-5">
            Stack two or three BTC rounds into a single ticket. The odds multiply, so a small
            stake chases a big payout — but every leg has to land. The instant one leg settles
            against you, the ticket is dead and your stake is the most you can lose.
          </p>
        </div>

        {/* Builder */}
        <section className="mb-8">
          <SectionHeader
            number="01"
            title="Build the streak"
            jp="連勝を組む"
            desc="Pick the markets, set the lines, watch the multiplier climb."
          />
          <div className="mt-6">
            <ParlayBuilder />
          </div>
        </section>

        {/* Live betting slip — your open tickets, resolving bell by bell */}
        <section className="mb-8">
          <SectionHeader
            number="02"
            title="Your tickets"
            jp="あなたの馬券"
            desc="Each leg ticks green as it settles — claim the instant the streak lands."
          />
          <div className="mt-6">
            <ParlaySlip />
          </div>
        </section>

        {/* How it pays — three numbered notes in the editorial section style */}
        <section className="mb-8">
          <SectionHeader
            number="03"
            title="How a parlay pays"
            jp="配当の仕組み"
          />
          <div className="mt-6 grid sm:grid-cols-3 gap-4">
            {[
              {
                n: '①',
                t: 'Odds multiply',
                d: 'Each leg has a win chance under 100%. Combine them and the chances multiply down — so the payout multiplies up. Two coin-flips already pay roughly 4×.',
              },
              {
                n: '②',
                t: 'All-or-nothing',
                d: 'The ticket only pays if every single leg settles in the money. One miss and the whole stake is lost — that is the price of the multiplied payout.',
              },
              {
                n: '③',
                t: 'Pre-funded payout',
                d: 'The full winning payout is set aside up front, so it can never come up short. Win the streak and claim it the instant the last leg settles.',
              },
            ].map((c) => (
              <div key={c.n} className="rounded-2xl border border-white/[0.08] bg-neutral-900/40 p-5">
                <div className="font-display font-[800] text-2xl text-vermilion mb-2 leading-none">{c.n}</div>
                <h3 className="font-display font-bold text-sm text-white mb-1.5">{c.t}</h3>
                <p className="text-[12px] text-gray-500 leading-relaxed">{c.d}</p>
              </div>
            ))}
          </div>
        </section>

        <Footer />
      </main>
    </div>
  );
}
