'use client';

// DEV-ONLY design review for the ProofRecord band. /dev/proof — null in prod.
import ProofRecord from '@/components/ProofRecord';

export default function ProofPreviewPage() {
  if (process.env.NODE_ENV === 'production') return null;
  return (
    <main className="min-h-dvh bg-bg">
      <div className="h-24" />
      <ProofRecord liveMarkets={6} players={1981} />
      <div className="h-24" />
    </main>
  );
}
