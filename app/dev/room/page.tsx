'use client';

// DEV-ONLY preview of the CommentRoom gate states. /dev/room?state=locked|joinable|joined|connect
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import CommentRoom, { type RoomGate, type RoomComment } from '@/components/CommentRoom';

const now = Date.now();
const SAMPLE: RoomComment[] = [
  { id: '1', author: '0x6b3b9a1f2c4d5e6f7a8b9c0d1e2f3a4b', text: 'cpi cools, momentum rolling down. under is free money here.', tsMs: now - 600_000, verified: true },
  { id: '2', author: '0xa1b2c3d4e5f60718293a4b5c6d7e8f90', text: 'nah spot keeps getting bid every dip. i faded you, calling over.', tsMs: now - 320_000, verified: true },
  { id: '3', author: '0x6b3b9a1f2c4d5e6f7a8b9c0d1e2f3a4b', text: 'we settle in 4 min, we’ll see who had the read 🔔', tsMs: now - 90_000, verified: true, mine: true },
];

function Preview() {
  const state = (useSearchParams().get('state') ?? 'joined') as RoomGate;
  const comments = state === 'joined' ? SAMPLE : [];
  return (
    <main className="min-h-dvh bg-bg">
      <CommentRoom
        callLabel="▼ BTC under $64,316 · 5m bell"
        gate={state}
        comments={comments}
        onClose={() => {}}
        onJoin={() => {}}
        onPost={() => {}}
        onBet={() => {}}
        connectSlot={<button className="rounded-full bg-vermilion px-6 py-3 text-sm font-semibold text-white">Connect Wallet</button>}
      />
    </main>
  );
}

export default function RoomPreviewPage() {
  if (process.env.NODE_ENV === 'production') return null;
  return <Suspense fallback={null}><Preview /></Suspense>;
}
