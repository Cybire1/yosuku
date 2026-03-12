'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Header from '@/components/Header';
import MirrorTradePanel from '@/components/MirrorTradePanel';
import PrivateRoomsPanel from '@/components/PrivateRoomsPanel';
import {
  fetchMirrorMarket,
  type MirrorMarketData,
} from '@/lib/mirrorMarkets';
import {
  getRoomIdsForMirrorMarket,
  isMirrorVisibleInRoom,
  loadUnlockedRooms,
  unlockRoom,
  type PrivateRoomId,
} from '@/lib/privateRooms';

export default function MirrorMarketDetailPage() {
  const params = useParams<{ marketId: string }>();
  const marketId = params?.marketId;

  const [market, setMarket] = useState<MirrorMarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeRoomId, setActiveRoomId] = useState<PrivateRoomId>('public');
  const [unlockedRooms, setUnlockedRooms] = useState<PrivateRoomId[]>([]);

  useEffect(() => {
    setUnlockedRooms(loadUnlockedRooms());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadMarket() {
      if (!marketId) return;
      setLoading(true);
      try {
        const found = await fetchMirrorMarket(marketId);
        if (!cancelled) {
          setMarket(found);
          if (found) {
            const roomIds = getRoomIdsForMirrorMarket(found);
            setActiveRoomId((current) => roomIds.includes(current) ? current : roomIds[0]);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadMarket();
    return () => {
      cancelled = true;
    };
  }, [marketId]);

  const roomIds = useMemo(() => (market ? getRoomIdsForMirrorMarket(market) : ['public'] as PrivateRoomId[]), [market]);
  const roomLocked = market ? !isMirrorVisibleInRoom(market, activeRoomId, unlockedRooms) : false;

  return (
    <div className="min-h-screen overflow-x-hidden selection:bg-white selection:text-black">
      <Header />

      <main className="pt-28 pb-16 relative">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
          <Link
            href="/markets"
            className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-4 py-2 text-xs font-bold uppercase tracking-[0.24em] text-gray-300 transition-colors hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to markets
          </Link>

          {loading ? (
            <div className="rounded-3xl border border-white/7 bg-neutral-950/70 p-8 text-sm text-gray-500">
              Loading mirrored market...
            </div>
          ) : !market ? (
            <div className="rounded-3xl border border-white/7 bg-neutral-950/70 p-8 text-sm text-gray-400">
              This mirrored market was not found in the current catalog.
            </div>
          ) : (
            <>
              <PrivateRoomsPanel
                activeRoomId={activeRoomId}
                unlockedRooms={unlockedRooms}
                onSelectRoom={setActiveRoomId}
                onUnlockRoom={(roomId, code) => {
                  const ok = unlockRoom(roomId, code);
                  if (ok) setUnlockedRooms(loadUnlockedRooms());
                  return ok;
                }}
                roomIds={roomIds}
              />

              <MirrorTradePanel
                market={market}
                roomId={activeRoomId}
                roomLocked={roomLocked}
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
