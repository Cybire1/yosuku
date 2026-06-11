'use client';

import Header from '@/components/Header';
import Marquee from '@/components/Marquee';
import GrainOverlay from '@/components/GrainOverlay';
import CustomCursor from '@/components/CustomCursor';
import NewsFeed from '@/components/NewsFeed';

export default function BitcoinNewsPage() {
  return (
    <div className="min-h-screen relative">
      <Marquee />
      <Header />
      <CustomCursor />
      <GrainOverlay />
      <main className="container pt-[140px] pb-24">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2 mb-3">
            <span
              className="w-1.5 h-1.5 rounded-full bg-vermilion animate-pulse"
              style={{ boxShadow: '0 0 12px var(--vermilion)' }}
            />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-gray-500">
              Updated live
            </span>
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-extrabold tracking-tight mb-2">
            Bitcoin <span className="vermilion">News</span>
          </h1>
          <div className="page-title-jp mb-2">市場を動かす見出し。</div>
          <p className="text-sm text-gray-400 max-w-xl">
            Sentiment-tagged and refreshed live. Read the room before you ring the bell.
          </p>
          <NewsFeed />
        </div>
      </main>
    </div>
  );
}
