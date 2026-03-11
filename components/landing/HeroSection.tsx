'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import MagneticButton from './MagneticButton';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';

function formatPrice(value: number) {
  if (!value) return '--';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function MetaPill({
  label,
  accent = false,
}: {
  label: string;
  accent?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.28em] ${
        accent
          ? 'border-[#9ceccf]/20 bg-[#34d399]/12 text-[#b8f4df]'
          : 'border-white/10 bg-black/30 text-white/58'
      }`}
    >
      {accent ? (
        <span className="h-1.5 w-1.5 rounded-full bg-[#9ceccf] shadow-[0_0_12px_rgba(156,236,207,0.8)]" />
      ) : null}
      {label}
    </span>
  );
}

export default function HeroSection() {
  const router = useRouter();
  const { price, connected } = useBtcPrice();

  return (
    <section className="relative min-h-[100svh] overflow-hidden bg-[var(--background)] text-white">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className="relative isolate min-h-[100svh] overflow-hidden bg-black"
      >
        <div className="absolute inset-x-0 top-0 z-[1] h-40 bg-gradient-to-b from-black/55 via-black/20 to-transparent" />

        <div className="absolute inset-0">
          <Image
            src="/hero.png"
            alt="DART hero chamber"
            fill
            priority
            sizes="100vw"
            className="object-cover object-[84%_center] sm:object-[80%_center] lg:object-[80%_center]"
          />
        </div>

        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, rgba(7,7,7,0.84) 0%, rgba(7,7,7,0.62) 27%, rgba(7,7,7,0.18) 58%, rgba(7,7,7,0.4) 100%)',
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/70 to-black/18 sm:hidden" />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 16% 14%, rgba(255,255,255,0.16), transparent 22%), radial-gradient(circle at 72% 66%, rgba(52,211,153,0.18), transparent 24%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 z-[2] hidden overflow-hidden md:block">
          <div
            className="hero-smoke"
            style={{ left: '58%', width: '36vw', height: '16vw', animationDelay: '-4s', animationDuration: '29s' }}
          />
          <div
            className="hero-smoke alt"
            style={{ left: '68%', width: '28vw', height: '13vw', animationDelay: '-11s', animationDuration: '24s' }}
          />
          <div
            className="hero-smoke alt"
            style={{ left: '49%', width: '24vw', height: '11vw', animationDelay: '-17s', animationDuration: '32s' }}
          />
          <div
            className="hero-smoke"
            style={{ left: '74%', width: '22vw', height: '10vw', animationDelay: '-8s', animationDuration: '26s' }}
          />
        </div>
        <div
          className="absolute bottom-0 right-0 h-72 w-72"
          style={{
            background:
              'radial-gradient(circle at bottom right, rgba(8,8,8,1) 0%, rgba(8,8,8,0.98) 18%, rgba(8,8,8,0) 72%)',
          }}
        />

        <div className="relative z-10 mx-auto grid min-h-[100svh] max-w-[1600px] grid-rows-[auto_1fr] px-5 pt-24 sm:px-6 sm:pt-32 lg:px-10 lg:pt-36">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-3"
          >
            <div className="flex flex-wrap gap-2">
              <MetaPill label="Private 5m Markets" accent />
              <div className="hidden sm:block">
                <MetaPill label="Aleo Testnet" />
              </div>
            </div>

            <div className="hidden items-center gap-3 rounded-full border border-white/10 bg-black/30 px-4 py-2 backdrop-blur-md sm:inline-flex">
              <span
                className={`h-2 w-2 rounded-full ${
                  connected ? 'bg-[#9ceccf]' : 'bg-white/35'
                }`}
              />
              <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/52">
                BTC / USD
              </span>
              <span className="font-mono text-sm font-semibold text-white">${formatPrice(price)}</span>
            </div>
          </motion.div>

          <div className="grid min-h-[calc(100svh-7rem)] items-end py-8 sm:min-h-0 sm:items-start sm:py-16 lg:grid-cols-[minmax(0,38rem)_1fr] lg:py-20">
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.16 }}
              className="max-w-[18.5rem] pb-8 sm:max-w-[30rem] sm:pb-0 lg:max-w-[36rem]"
            >
              <p className="hidden font-mono text-[10px] uppercase tracking-[0.34em] text-white/40 sm:block sm:text-[11px]">
                No visible order flow. No copied conviction.
              </p>
              <h1 className="mt-4 text-[3.55rem] font-black leading-[0.9] tracking-[-0.09em] text-white sm:mt-5 sm:text-[6.15rem] lg:text-[7.65rem] xl:text-[8.15rem]">
                DART
              </h1>
              <p className="mt-4 max-w-[18rem] text-[1.02rem] font-medium leading-[1.2] text-white/84 sm:mt-5 sm:max-w-[25rem] sm:text-[2rem] lg:max-w-[23rem] lg:text-[2.15rem]">
                Private 5-minute markets for live conviction.
              </p>
              <p className="mt-4 max-w-[18rem] text-[13px] leading-6 text-white/60 sm:max-w-[28rem] sm:text-base sm:leading-7">
                Built on Aleo. Bet direction stays hidden while the round is open, then settles on-chain after the reveal.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:mt-10 sm:flex-row sm:items-center">
                <MagneticButton className="w-full sm:w-auto">
                  <button
                    onClick={() => router.push('/markets')}
                    className="group flex w-full items-center justify-between gap-4 rounded-full border border-[#9ceccf]/20 bg-[#f1f4ee] px-5 py-4 text-sm font-black uppercase tracking-[0.18em] text-black transition-all hover:translate-y-[-1px] hover:shadow-[0_0_28px_rgba(241,244,238,0.22)] sm:min-w-[220px] sm:px-6"
                  >
                    Enter Markets
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </button>
                </MagneticButton>

                <MagneticButton className="w-full sm:w-auto">
                  <button
                    onClick={() => router.push('/how-it-works')}
                    className="group flex w-full items-center justify-between gap-4 rounded-full border border-white/12 bg-black/28 px-5 py-4 text-sm font-bold uppercase tracking-[0.18em] text-white backdrop-blur-md transition-colors hover:bg-white/[0.08] sm:min-w-[220px] sm:px-6"
                  >
                    Read the Flow
                    <ArrowRight className="h-4 w-4 text-white/45 transition-all group-hover:translate-x-1 group-hover:text-white" />
                  </button>
                </MagneticButton>
              </div>
            </motion.div>
          </div>

        </div>
      </motion.div>
    </section>
  );
}
