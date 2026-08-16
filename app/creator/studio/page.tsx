import type { Metadata } from 'next';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import GrainOverlay from '@/components/GrainOverlay';
import CustomCursor from '@/components/CustomCursor';
import CreatorCardStudio from '@/components/CreatorCardStudio';

export const metadata: Metadata = {
  title: 'Creator Studio | Yosuku',
  description: 'Build and share a live Yosuku prediction card from your creator account.',
};

export default function CreatorStudioPage() {
  return (
    <div className="min-h-[100dvh]">
      <Header />
      <CustomCursor />
      <GrainOverlay />

      <main className="creator-studio min-h-[100dvh] pb-20 pt-[96px] sm:pb-28 sm:pt-[122px]">
        <div className="mx-auto w-full max-w-[1320px] px-4 sm:px-8">
          <header className="max-w-3xl pb-8 pt-5 sm:pb-10 sm:pt-8">
            <div className="cs-eyebrow">Creator Studio</div>
            <h1 className="mt-4 max-w-[760px] text-balance font-display text-[clamp(2.35rem,6vw,5.3rem)] font-[700] leading-[0.98] tracking-[-0.072em] text-[var(--cs-text)]">
              Make the call. Let the market answer.
            </h1>
            <p className="mt-5 max-w-[58ch] text-pretty text-[14px] leading-relaxed text-[var(--cs-muted)] sm:text-[16px]">
              Choose a Bitcoin line, share the card on X, and earn when your audience trades it.
            </p>
          </header>

          <CreatorCardStudio />

          <div className="mt-5 flex flex-col gap-2 px-1 font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--cs-faint)] sm:flex-row sm:items-center sm:justify-between">
            <span>Card replies settle through DeepBook Predict</span>
            <a href="/portfolio#creator-mode" className="transition-colors hover:text-[var(--cs-text)]">View creator earnings</a>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
