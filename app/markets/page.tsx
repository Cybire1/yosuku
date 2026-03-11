'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, Search, Sparkles } from 'lucide-react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import Header from '@/components/Header';
import DoodleStrip from '@/components/DoodleStrip';
import TokenBalance from '@/components/TokenBalance';
import MirrorTradePanel from '@/components/MirrorTradePanel';
import MirrorMarketCard from '@/components/MirrorMarketCard';
import LiveBtcChart from '@/components/charts/LiveBtcChart';
import NewsFeed from '@/components/NewsFeed';
import { useBtcPrice } from '@/lib/hooks/useBtcPrice';
import { fetchMirrorCatalog, type MirrorMarketData } from '@/lib/mirrorMarkets';
import type { MirrorSide } from '@/lib/mirrorMarkets';
import {
  PRIVATE_ROOMS,
  loadUnlockedRooms,
  unlockRoom,
  type PrivateRoomId,
} from '@/lib/privateRooms';
import { getResolverBackendUrl } from '@/lib/backendUrl';

function getRoomMarketVisibility(
  market: MirrorMarketData,
  roomId: PrivateRoomId,
  unlockedRooms: PrivateRoomId[],
) {
  const text = `${market.question} ${market.description || ''} ${market.category}`.toLowerCase();
  const volume = market.volume24hr || market.volume;
  const isMajor = /(btc|bitcoin|eth|ethereum|rates|etf)/.test(text);
  const isAlt = /(sol|solana|doge|xrp|sui|memecoin|altcoin)/.test(text);
  const roomUnlocked = roomId === 'public' || unlockedRooms.includes(roomId);

  if (!roomUnlocked) return false;
  if (roomId === 'public') return !(/politics|government|election|trump|war|iran/.test(text) && volume < 100_000);
  if (roomId === 'macro-desk') return isMajor;
  if (roomId === 'altcoin-war-room') return isAlt;
  return !isMajor && !isAlt || volume >= 50_000;
}

export default function MarketsPage() {
  const { address } = useWallet();
  const { price: btcPrice, change24h, connected: btcConnected } = useBtcPrice();

  const [mintTrigger, setMintTrigger] = useState(0);
  const [mirrorMarkets, setMirrorMarkets] = useState<MirrorMarketData[]>([]);
  const [mirrorLoading, setMirrorLoading] = useState(true);
  const [mirrorLastSyncAt, setMirrorLastSyncAt] = useState<string | null>(null);
  const [mirrorCreateOnChain, setMirrorCreateOnChain] = useState(false);
  const [selectedMirrorMarketId, setSelectedMirrorMarketId] = useState<string | null>(null);
  const [selectedTradeSide, setSelectedTradeSide] = useState<MirrorSide | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<PrivateRoomId>('public');
  const [unlockedRooms, setUnlockedRooms] = useState<PrivateRoomId[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'live' | 'queued'>('all');
  const [sortBy, setSortBy] = useState<'volume' | 'ending' | 'signal'>('volume');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [unlockCode, setUnlockCode] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const tradePanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setUnlockedRooms(loadUnlockedRooms());

    async function loadMirrorCatalog() {
      try {
        const markets = await fetchMirrorCatalog();
        if (cancelled) return;

        setMirrorMarkets(markets);

        const res = await fetch(`${getResolverBackendUrl()}/api/mirrors`);
        const data = res.ok ? await res.json() : null;
        setMirrorLastSyncAt(data?.status?.lastSyncAt || null);
        setMirrorCreateOnChain(Boolean(data?.status?.createOnChain));

        setSelectedMirrorMarketId((current) => {
          if (current && markets.some((market) => market.marketId === current)) {
            return current;
          }
          return markets.find((market) => market.onChainCreated && !market.onChainResolved)?.marketId
            || markets[0]?.marketId
            || null;
        });
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load mirror catalog:', error);
          setMirrorMarkets([]);
          setSelectedMirrorMarketId(null);
        }
      } finally {
        if (!cancelled) {
          setMirrorLoading(false);
        }
      }
    }

    void loadMirrorCatalog();
    const interval = window.setInterval(() => {
      void loadMirrorCatalog();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const roomVisibleMarkets = useMemo(
    () => mirrorMarkets.filter((market) => getRoomMarketVisibility(market, activeRoomId, unlockedRooms)),
    [mirrorMarkets, activeRoomId, unlockedRooms]
  );

  const categoryOptions = useMemo(() => {
    const unique = new Set<string>();
    roomVisibleMarkets.forEach((market) => unique.add(market.category));
    return ['all', ...Array.from(unique).slice(0, 10)];
  }, [roomVisibleMarkets]);

  useEffect(() => {
    if (categoryFilter !== 'all' && !categoryOptions.includes(categoryFilter)) {
      setCategoryFilter('all');
    }
  }, [categoryFilter, categoryOptions]);

  const visibleMirrorMarkets = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    const filtered = roomVisibleMarkets.filter((market) => {
      const matchesQuery =
        !normalizedQuery ||
        `${market.question} ${market.description || ''} ${market.category}`.toLowerCase().includes(normalizedQuery);

      const matchesStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'live'
            ? Boolean(market.onChainCreated && !market.onChainResolved)
            : !market.onChainCreated;

      const matchesCategory =
        categoryFilter === 'all' || market.category.toLowerCase() === categoryFilter.toLowerCase();

      return matchesQuery && matchesStatus && matchesCategory;
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'ending') {
        const aTime = a.endDate ? new Date(a.endDate).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.endDate ? new Date(b.endDate).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
      }

      if (sortBy === 'signal') {
        const aSignal = Math.abs(a.publicYesPrice - 0.5);
        const bSignal = Math.abs(b.publicYesPrice - 0.5);
        return bSignal - aSignal;
      }

      return (b.volume24hr || b.volume) - (a.volume24hr || a.volume);
    });
  }, [roomVisibleMarkets, searchQuery, statusFilter, sortBy, categoryFilter]);

  useEffect(() => {
    setSelectedMirrorMarketId((current) => {
      if (current && visibleMirrorMarkets.some((market) => market.marketId === current)) {
        return current;
      }
      return visibleMirrorMarkets.find((market) => market.onChainCreated && !market.onChainResolved)?.marketId
        || visibleMirrorMarkets[0]?.marketId
        || null;
    });
  }, [visibleMirrorMarkets]);

  const selectedMirrorMarket =
    visibleMirrorMarkets.find((market) => market.marketId === selectedMirrorMarketId) || null;
  const selectedRoom = PRIVATE_ROOMS.find((room) => room.id === activeRoomId) || PRIVATE_ROOMS[0];
  const selectedRoomLocked = selectedRoom.privacy === 'invite-only' && !unlockedRooms.includes(selectedRoom.id);
  const btcPriceLabel = btcPrice > 0 ? `$${btcPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : 'Loading';
  const btcChangeLabel = `${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%`;

  const handleChooseSide = (market: MirrorMarketData, side: MirrorSide) => {
    setSelectedMirrorMarketId(market.marketId);
    setSelectedTradeSide(side);

    if (typeof window !== 'undefined' && window.innerWidth < 1280) {
      window.requestAnimationFrame(() => {
        tradePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden selection:bg-white selection:text-black">
      <Header />
      <DoodleStrip />

      <main className="relative pb-24 pt-28 sm:pt-30">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[#050505]" />
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.045),transparent_42%),radial-gradient(circle_at_bottom,rgba(255,255,255,0.02),transparent_38%)]" />
        <motion.div
          className="mx-auto max-w-[1400px] px-4 sm:px-6"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: { opacity: 0 },
            visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
          }}
        >
          <motion.section
            variants={{
              hidden: { opacity: 0, y: 16 },
              visible: { opacity: 1, y: 0, transition: { type: 'spring', damping: 24, stiffness: 220 } },
            }}
            className="mb-5 rounded-[1.9rem] border border-white/7 bg-neutral-950/75 p-4 sm:p-5"
          >
            <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-new-mint/20 bg-new-mint/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-new-mint">
                    Markets
                  </span>
                  <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-gray-300">
                    {visibleMirrorMarkets.length} visible
                  </span>
                  {mirrorCreateOnChain && (
                    <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-gray-300">
                      Auto-sync live
                    </span>
                  )}
                  {mirrorLastSyncAt && (
                    <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-gray-300">
                      Synced {new Date(mirrorLastSyncAt).toLocaleTimeString()}
                    </span>
                  )}
                </div>
                <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">Markets</h1>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                {address && (
                  <div className="rounded-[1.35rem] border border-white/8 bg-black/35 px-4 py-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-500">Balance</p>
                    <TokenBalance refreshTrigger={mintTrigger} />
                  </div>
                )}

                <Link
                  href="/markets/btc"
                  className="group flex items-center justify-between gap-3 rounded-[1.35rem] border border-white/8 bg-white/[0.03] px-4 py-3 transition-colors hover:border-white/16"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full border border-new-mint/20 bg-new-mint/10">
                      <Sparkles className="h-4 w-4 text-new-mint" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">Classic BTC Arena</p>
                      <p className="text-xs text-gray-500">5-minute route</p>
                    </div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-gray-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white" />
                </Link>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
              <label className="flex items-center gap-3 rounded-[1.35rem] border border-white/8 bg-black/35 px-4 py-3">
                <Search className="h-4 w-4 text-gray-500" />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search markets"
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-gray-600"
                />
              </label>

              <div className="flex items-center gap-2 rounded-[1.35rem] border border-white/8 bg-black/35 px-3 py-2">
                {(['all', 'live', 'queued'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setStatusFilter(filter)}
                    className={`rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] transition-colors ${
                      statusFilter === filter ? 'bg-white text-black' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>

              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
                className="rounded-[1.35rem] border border-white/8 bg-black/35 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="volume">Sort: Volume</option>
                <option value="ending">Sort: Ending soon</option>
                <option value="signal">Sort: Signal</option>
              </select>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {PRIVATE_ROOMS.map((room) => {
                const unlocked = room.privacy === 'public' || unlockedRooms.includes(room.id);
                return (
                  <button
                    key={room.id}
                    onClick={() => {
                      setActiveRoomId(room.id);
                      setUnlockError('');
                    }}
                    className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                      activeRoomId === room.id
                        ? 'border-white bg-white text-black'
                        : 'border-white/8 bg-white/[0.03] text-gray-300 hover:text-white'
                    }`}
                  >
                    {room.name}
                    <span className={`ml-2 text-[10px] uppercase tracking-[0.2em] ${unlocked ? 'text-new-mint' : 'text-gray-500'}`}>
                      {unlocked ? 'open' : 'private'}
                    </span>
                  </button>
                );
              })}
            </div>

            {selectedRoomLocked && (
              <div className="mt-3 flex flex-col gap-3 rounded-[1.35rem] border border-white/8 bg-black/35 p-4 lg:flex-row lg:items-center">
                <p className="min-w-0 flex-1 text-sm text-gray-400">{selectedRoom.description}</p>
                <input
                  value={unlockCode}
                  onChange={(event) => setUnlockCode(event.target.value)}
                  placeholder={`Unlock ${selectedRoom.name}`}
                  className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none placeholder:text-gray-600 lg:min-w-[260px]"
                />
                <button
                  onClick={() => {
                    const ok = unlockRoom(selectedRoom.id, unlockCode);
                    if (ok) {
                      setUnlockedRooms(loadUnlockedRooms());
                      setUnlockCode('');
                      setUnlockError('');
                    } else {
                      setUnlockError('Invalid invite code');
                    }
                  }}
                  className="rounded-2xl border border-new-mint/20 bg-new-mint/10 px-4 py-3 text-sm font-bold uppercase tracking-[0.2em] text-new-mint transition-colors hover:bg-new-mint/15"
                >
                  Unlock
                </button>
              </div>
            )}

            {unlockError && <p className="mt-3 text-sm text-off-red">{unlockError}</p>}
          </motion.section>

          <motion.section
            variants={{
              hidden: { opacity: 0, y: 16 },
              visible: { opacity: 1, y: 0, transition: { type: 'spring', damping: 24, stiffness: 220 } },
            }}
            className="mb-6 grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_340px]"
          >
            <div className="flex h-full flex-col rounded-[1.9rem] border border-white/7 bg-neutral-950/75 p-5 sm:p-6">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-gray-300">
                  Featured
                </span>
                <span className="rounded-full border border-[#f59e0b]/15 bg-[#f59e0b]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-[#fbbf24]">
                  BTC 5m
                </span>
                <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] ${
                  btcConnected
                    ? 'border-new-mint/20 bg-new-mint/10 text-new-mint'
                    : 'border-white/8 bg-white/[0.03] text-gray-400'
                }`}>
                  {btcConnected ? 'Pyth live' : 'Connecting'}
                </span>
              </div>

              <div className="flex flex-1 flex-col rounded-[1.5rem] border border-white/6 bg-black/35 p-5">
                <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="max-w-4xl">
                    <h2 className="text-3xl font-black leading-tight text-white">
                      Bitcoin up or down in 5 minutes?
                    </h2>
                    <p className="mt-3 max-w-3xl text-sm leading-relaxed text-gray-400">
                      Live BTC/USD is streamed from Pyth. Enter the classic arena to trade the next five-minute move with the dedicated BTC route.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full bg-white/[0.04] px-3 py-2 text-sm font-bold text-white">
                        <span className="mr-2 text-[10px] uppercase tracking-[0.22em] text-gray-500">BTC</span>
                        {btcPriceLabel}
                      </span>
                      <span className={`rounded-full px-3 py-2 text-sm font-bold ${
                        change24h >= 0 ? 'bg-new-mint/12 text-white' : 'bg-off-red/12 text-white'
                      }`}>
                        <span className={`mr-2 text-[10px] uppercase tracking-[0.22em] ${change24h >= 0 ? 'text-new-mint' : 'text-off-red'}`}>
                          24h
                        </span>
                        <span className={change24h >= 0 ? 'text-new-mint' : 'text-off-red'}>{btcChangeLabel}</span>
                      </span>
                      <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.2em] text-gray-300">
                        Pyth BTC/USD
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      href="/markets/btc"
                      className="rounded-full bg-white px-4 py-2 text-[11px] font-bold uppercase tracking-[0.22em] text-black"
                    >
                      Open BTC
                    </Link>
                    <a
                      href="https://www.pyth.network"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full border border-white/8 bg-white/[0.03] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.22em] text-gray-300 transition-colors hover:text-white"
                    >
                      View Pyth
                    </a>
                  </div>
                </div>

                <div className="min-h-[420px] flex-1 overflow-hidden rounded-[1.25rem] border border-white/6 bg-black/60">
                  <LiveBtcChart height={420} />
                </div>
              </div>
            </div>

            <NewsFeed className="mt-0 sm:mt-0" />
          </motion.section>

          <motion.section
            variants={{
              hidden: { opacity: 0, y: 16 },
              visible: { opacity: 1, y: 0, transition: { type: 'spring', damping: 24, stiffness: 220 } },
            }}
            className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]"
          >
            <div className="rounded-[1.9rem] border border-white/7 bg-neutral-950/75 p-5 sm:p-6">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <h2 className="mr-3 text-2xl font-black text-white">All markets</h2>
                {categoryOptions.map((category) => (
                  <button
                    key={category}
                    onClick={() => setCategoryFilter(category)}
                    className={`rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] transition-colors ${
                      categoryFilter === category
                        ? 'bg-white text-black'
                        : 'border border-white/8 bg-white/[0.03] text-gray-400 hover:text-white'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>

              {mirrorLoading && visibleMirrorMarkets.length === 0 ? (
                <div className="rounded-[1.5rem] border border-white/6 bg-black/35 px-6 py-16 text-center text-sm text-gray-500">
                  Loading market board...
                </div>
              ) : visibleMirrorMarkets.length === 0 ? (
                <div className="rounded-[1.5rem] border border-white/6 bg-black/35 px-6 py-16 text-center text-sm text-gray-500">
                  No markets match the current filters.
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {visibleMirrorMarkets.map((market) => (
                    <MirrorMarketCard
                      key={market.marketId}
                      market={market}
                      selected={selectedMirrorMarketId === market.marketId}
                      activeSide={selectedMirrorMarketId === market.marketId ? selectedTradeSide : null}
                      onSelect={(candidate) => setSelectedMirrorMarketId(candidate.marketId)}
                      onChooseSide={handleChooseSide}
                      roomLocked={selectedRoomLocked}
                      roomId={activeRoomId}
                      onTradeSuccess={() => {
                        setMintTrigger((prev) => prev + 1);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            <div ref={tradePanelRef}>
              <MirrorTradePanel
                className="xl:sticky xl:top-28 xl:self-start"
                compact
                market={selectedMirrorMarket}
                roomId={activeRoomId}
                roomLocked={selectedRoomLocked}
                preferredSide={selectedTradeSide}
                onSuccess={() => {
                  setMintTrigger((prev) => prev + 1);
                }}
              />
            </div>
          </motion.section>
        </motion.div>
      </main>
    </div>
  );
}
