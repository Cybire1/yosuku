'use client';

// DEV-ONLY design-review page for The Call (bet-placed) card — renders the REAL
// component with realistic sample calls so the design can be screenshotted and
// audited before it meets a user. Not linked from anywhere; returns null in prod.
//   /dev/betplaced?state=down|up|range|lev
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import BetPlacedCard from '@/components/BetPlacedCard';
import { renderOpenBetShareCard, type OpenBetCard } from '@/lib/openBetShareCard';

const DIGEST = '4tGkP2wVznYr8sJcQmXaTb5eKfHhLdNpRuA9oCiE6gwD';
// Fixed epoch so the preview is deterministic; the card counts down from it.
const PLACED = Date.UTC(2026, 6, 11, 14, 55, 6);

const STATES: Record<string, OpenBetCard> = {
  down: {
    kind: 'dir', dir: 'down', strikeUsd: 64_316,
    stakeDusdc: 1.1, winDusdc: 1.96, lev: 1,
    expiryMs: PLACED + 5 * 60_000, digest: DIGEST, placedAtMs: PLACED,
  },
  up: {
    kind: 'dir', dir: 'up', strikeUsd: 64_180,
    stakeDusdc: 5, winDusdc: 8.42, lev: 1,
    expiryMs: PLACED + 60 * 60_000, digest: DIGEST, placedAtMs: PLACED,
  },
  range: {
    kind: 'range', lowerUsd: 63_900, higherUsd: 64_500,
    stakeDusdc: 2, winDusdc: 5.7, lev: 1,
    expiryMs: PLACED + 60 * 60_000, digest: DIGEST, placedAtMs: PLACED,
  },
  lev: {
    kind: 'dir', dir: 'up', strikeUsd: 64_180,
    stakeDusdc: 3, winDusdc: 11.4, lev: 3,
    expiryMs: PLACED + 60_000, digest: DIGEST, placedAtMs: PLACED,
  },
};

function Preview() {
  const params = useSearchParams();
  const state = params.get('state') ?? 'down';
  const png = params.get('png') === '1';
  const call = STATES[state] ?? STATES.down;
  // Freeze "now" at 4m54s to the bell so the countdown matches the founder's shot.
  const [now, setNow] = useState(call.expiryMs - (4 * 60_000 + 54_000));
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNow((n) => n + 1000), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!png) return;
    let url: string | null = null;
    renderOpenBetShareCard(call).then((blob) => { url = URL.createObjectURL(blob); setPngUrl(url); });
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [png, state]); // eslint-disable-line react-hooks/exhaustive-deps
  if (png) {
    return (
      <main className="min-h-dvh bg-bg px-4 py-10">
        <div className="mx-auto max-w-[420px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {pngUrl ? <img src={pngUrl} alt="share card" className="w-full rounded-xl" /> : <p className="font-mono text-xs text-white/50">rendering…</p>}
        </div>
      </main>
    );
  }
  return (
    <main className="min-h-dvh bg-bg px-4 py-10">
      <div className="mx-auto max-w-[420px]">
        <BetPlacedCard
          call={call}
          nowMs={now}
          actions={
            <div className="mt-2.5 grid grid-cols-2 gap-2.5">
              <a href="/portfolio" className="rounded-full border border-white/15 px-4 py-3 text-center text-sm font-semibold text-white/70 transition-colors hover:border-white/30 hover:text-white">Portfolio</a>
              <button className="rounded-full border border-white/15 px-4 py-3 text-center text-sm font-semibold text-white/70 transition-colors hover:border-white/30 hover:text-white">Place another</button>
            </div>
          }
        />
      </div>
    </main>
  );
}

export default function BetPlacedPreviewPage() {
  if (process.env.NODE_ENV === 'production') return null;
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  );
}
