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

type CategoryBucket = 'all' | 'crypto' | 'sports' | 'politics' | 'tech' | 'economics' | 'science' | 'other';

const CATEGORY_BUCKETS: Array<{ id: CategoryBucket; label: string }> = [
  { id: 'all', label: 'All markets' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'sports', label: 'Sports' },
  { id: 'politics', label: 'Politics' },
  { id: 'tech', label: 'Tech' },
  { id: 'economics', label: 'Economics' },
  { id: 'science', label: 'Science' },
  { id: 'other', label: 'Other' },
];

function getCategoryBucket(market: MirrorMarketData): CategoryBucket {
  const text = `${market.category} ${market.question} ${market.description || ''}`.toLowerCase();

  if (/(bitcoin|btc|eth|ethereum|sol|solana|doge|xrp|sui|token|crypto|stablecoin|altcoin|memecoin)/.test(text)) {
    return 'crypto';
  }
  if (/(fifa|nba|nfl|mlb|nhl|sports|cup|tournament|qualify|match|team|league|championship)/.test(text)) {
    return 'sports';
  }
  if (/(election|trump|senate|president|government|policy|war|iran|ukraine|politic|congress|vote)/.test(text)) {
    return 'politics';
  }
  if (/(openai|ai|hardware|tech|apple|google|meta|nvidia|startup|consumer product)/.test(text)) {
    return 'tech';
  }
  if (/(economy|fed|rates|inflation|recession|gdp|tariff|etf|macro|oil|yield|employment|finance)/.test(text)) {
    return 'economics';
  }
  if (/(science|space|nasa|drug|trial|research|physics|biology|medical)/.test(text)) {
    return 'science';
  }

  return 'other';
}

export default function MarketsPage() {
  const { address } = useWallet();
  const { price: btcPrice, change24h, connected: btcConnected } = useBtcPrice();

  const [mintTrigger, setMintTrigger] = useState(0);
  const [mirrorMarkets, setMirrorMarkets] = useState<MirrorMarketData[]>([]);
  const [mirrorLoading, setMirrorLoading] = useState(true);
  const [selectedMirrorMarketId, setSelectedMirrorMarketId] = useState<string | null>(null);
  const [selectedTradeSide, setSelectedTradeSide] = useState<MirrorSide | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'live' | 'queued'>('all');
  const [sortBy, setSortBy] = useState<'volume' | 'ending' | 'signal'>('volume');
  const [categoryFilter, setCategoryFilter] = useState<CategoryBucket>('all');
  const tradePanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadMirrorCatalog() {
      try {
        const markets = await fetchMirrorCatalog();
        if (cancelled) return;

        setMirrorMarkets(markets);

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

  const categoryCounts = useMemo(() => {
    return mirrorMarkets.reduce<Record<CategoryBucket, number>>(
      (counts, market) => {
        counts.all += 1;
        counts[getCategoryBucket(market)] += 1;
        return counts;
      },
      {
        all: 0,
        crypto: 0,
        sports: 0,
        politics: 0,
        tech: 0,
        economics: 0,
        science: 0,
        other: 0,
      }
    );
  }, [mirrorMarkets]);

  const visibleMirrorMarkets = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    const filtered = mirrorMarkets.filter((market) => {
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
        categoryFilter === 'all' || getCategoryBucket(market) === categoryFilter;

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
  }, [mirrorMarkets, searchQuery, statusFilter, sortBy, categoryFilter]);

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
            <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">Markets</h1>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                {address && (
                  <div className="rounded-[1.35rem] border border-white/8 bg-black/35 px-4 py-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-500">Balance</p>
                    <TokenBalance refreshTrigger={mintTrigger} />
                  </div>
                )}
              </div>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2">
              {CATEGORY_BUCKETS.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setCategoryFilter(category.id)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.22em] transition-colors ${
                    categoryFilter === category.id
                      ? 'border-white bg-white text-black'
                      : 'border-white/8 bg-white/[0.03] text-gray-400 hover:text-white'
                  }`}
                >
                  <span>{category.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] tracking-[0.18em] ${
                    categoryFilter === category.id ? 'bg-black/10 text-black/70' : 'bg-black/25 text-gray-500'
                  }`}>
                    {categoryCounts[category.id]}
                  </span>
                </button>
              ))}
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

              <Link
                href="/markets/btc"
                className="group hidden items-center justify-between gap-3 rounded-[1.35rem] border border-white/8 bg-white/[0.03] px-4 py-3 transition-colors hover:border-white/16 lg:flex"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-new-mint/20 bg-new-mint/10">
                    <Sparkles className="h-4 w-4 text-new-mint" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">BTC Arena</p>
                    <p className="text-xs text-gray-500">5-minute route</p>
                  </div>
                </div>
                <ArrowUpRight className="h-4 w-4 text-gray-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white" />
              </Link>
            </div>
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
              <div className="mb-4 flex flex-col gap-4">
                <div>
                  <h2 className="text-2xl font-black text-white">All markets</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    {visibleMirrorMarkets.length} shown in {CATEGORY_BUCKETS.find((bucket) => bucket.id === categoryFilter)?.label.toLowerCase()}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {([
                    ['volume', 'Highest volume'],
                    ['ending', 'Ending soon'],
                    ['signal', 'Strongest signal'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setSortBy(value)}
                      className={`rounded-full border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.22em] transition-colors ${
                        sortBy === value
                          ? 'border-new-mint/20 bg-new-mint/10 text-new-mint'
                          : 'border-white/8 bg-white/[0.03] text-gray-400 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
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
                <div className="grid items-start gap-5 md:grid-cols-2 2xl:grid-cols-3">
                  {visibleMirrorMarkets.map((market) => (
                    <MirrorMarketCard
                      key={market.marketId}
                      market={market}
                      selected={selectedMirrorMarketId === market.marketId}
                      activeSide={selectedMirrorMarketId === market.marketId ? selectedTradeSide : null}
                      onSelect={(candidate) => setSelectedMirrorMarketId(candidate.marketId)}
                      onChooseSide={handleChooseSide}
                      roomLocked={false}
                      roomId="public"
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
                roomId="public"
                roomLocked={false}
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
