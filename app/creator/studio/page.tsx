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
          <header className="pb-5 pt-2 sm:pb-6 sm:pt-3">
            <div className="cs-eyebrow">Creator Studio</div>
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
