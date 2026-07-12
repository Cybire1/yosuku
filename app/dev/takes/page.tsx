'use client';

// DEV-ONLY design review for the feed TakeCard — real component, sample takes.
// Returns null in prod. /dev/takes
import TakeCard from '@/components/TakeCard';
import type { FeedTake } from '@/lib/sui/takeBoard';

const now = 1783813077477;
const SAMPLES: FeedTake[] = [
  {
    author: '0x6b3b9a1f2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f', blobId: 'b1',
    marketId: '0xmkt', orderId: '0x9a', side: 1, strikeUsd: 64316, tsMs: now - 90_000,
    digest: 'GiktTnWNXRDJ8GeeLNvx3jBFdfHdC8ANnFj3UVA74fYa', backed: true,
    caption: 'cpi cools, momentum rolling down into the bell — under is free money', cadence: '5m', stakeDusdc: 1.1, expiryMs: now + 210_000,
  },
  {
    author: '0xa1b2c3d4e5f60718293a4b5c6d7e8f9012345678', blobId: 'b2',
    marketId: '0xmkt', orderId: '0', side: 0, strikeUsd: 64180, tsMs: now - 720_000,
    digest: '8uCEo4ZaF7ZGFnGhYSYJo8E7TJem43epEtCxCeLoLd9Y', backed: false,
    caption: 'funding flipped positive, spot bid all session. up.', cadence: '1h',
  },
  {
    author: '0xf00dcafe1234567890abcdef1234567890abcdef', blobId: 'b3',
    marketId: '0xmkt', orderId: '0x44', side: 2, strikeUsd: 0, lowerUsd: 63900, higherUsd: 64500, tsMs: now - 3_600_000,
    digest: '4tGkP2wVznYr8sJcQmXaTb5eKfHhLdNpRuA9oCiE6gwD', backed: true,
    caption: 'chop city. it pins inside the band till the bell.', cadence: '1h', stakeDusdc: 2,
  },
  {
    author: '0x0099f97251af2d072fc492316ae30de3ab5639be', blobId: 'b4',
    marketId: '0xmkt', orderId: '0x7', side: 1, strikeUsd: 64000, tsMs: now - 30_000,
    digest: 'GiktTnWNXRDJ8GeeLNvx3jBFdfHdC8ANnFj3UVA74fYa', backed: true,
    caption: '', cadence: '1m', stakeDusdc: 5,
  },
];

export default function TakesPreviewPage() {
  if (process.env.NODE_ENV === 'production') return null;
  return (
    <main className="min-h-dvh bg-bg px-4 py-10">
      <div className="mx-auto flex max-w-[440px] flex-col gap-4">
        {SAMPLES.map((t, i) => <TakeCard key={i} take={t} />)}
      </div>
    </main>
  );
}
