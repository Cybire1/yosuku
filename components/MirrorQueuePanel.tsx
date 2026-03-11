'use client';

import Link from 'next/link';
import { ArrowRightLeft, Clock3, EyeOff, RadioTower, RefreshCw } from 'lucide-react';
import type { MirrorMarketData } from '@/lib/mirrorMarkets';

interface MirrorQueuePanelProps {
  markets: MirrorMarketData[];
  loading?: boolean;
  lastSyncAt?: string | null;
  createOnChain?: boolean;
  selectedMarketId?: string | null;
  onSelectMarket?: (market: MirrorMarketData) => void;
  className?: string;
}

function formatVolume(volume: number) {
  if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `$${(volume / 1_000).toFixed(0)}K`;
  return `$${volume.toFixed(0)}`;
}

function formatMultiplier(multiplierBps: number) {
  return `${(multiplierBps / 10000).toFixed(2)}x`;
}

function formatEndDate(endDate?: string) {
  if (!endDate) return 'No close time';
  const date = new Date(endDate);
  if (Number.isNaN(date.getTime())) return 'Invalid close time';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function MirrorQueuePanel({
  markets,
  loading = false,
  lastSyncAt,
  createOnChain = false,
  selectedMarketId,
  onSelectMarket,
  className = '',
}: MirrorQueuePanelProps) {
  return (
    <section className={`${className} rounded-3xl border border-white/7 bg-neutral-950/70 p-4 sm:p-5`}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-gray-300">
              <ArrowRightLeft className="h-3 w-3 text-new-mint" />
              Live Market Queue
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-new-mint/15 bg-new-mint/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-new-mint">
              <EyeOff className="h-3 w-3" />
              Private execution
            </span>
          </div>
          <h3 className="text-lg font-bold text-white">Market feed</h3>
          <p className="mt-1 text-sm text-gray-400">
            Select a market to load the trade ticket. Live cards are tradable immediately, queued cards remain visible for discovery.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 font-semibold text-gray-300">
            <RadioTower className="h-3.5 w-3.5 text-off-blue" />
            {markets.length} candidates
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 font-semibold text-gray-300">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-new-mint' : 'text-gray-400'}`} />
            {lastSyncAt ? `Synced ${new Date(lastSyncAt).toLocaleTimeString()}` : 'Waiting for sync'}
          </span>
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-semibold ${
            createOnChain
              ? 'border-new-mint/20 bg-new-mint/10 text-new-mint'
              : 'border-white/8 bg-white/[0.03] text-gray-400'
          }`}>
            {createOnChain ? 'Auto-create enabled' : 'Catalog mode'}
          </span>
        </div>
      </div>

      {loading && markets.length === 0 ? (
        <div className="rounded-2xl border border-white/6 bg-black/35 px-4 py-8 text-center text-sm text-gray-500">
          Fetching live markets...
        </div>
      ) : markets.length === 0 ? (
        <div className="rounded-2xl border border-white/6 bg-black/35 px-4 py-8 text-center text-sm text-gray-500">
          No live markets are available right now.
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {markets.map((market) => {
            const yesPct = Math.round(market.publicYesPrice * 100);
            const noPct = Math.round(market.publicNoPrice * 100);
            const isSelected = selectedMarketId === market.marketId;

            return (
              <div
                key={market.sourceMarketId}
                className={`rounded-2xl border p-4 transition-colors ${
                  isSelected
                    ? 'border-new-mint/25 bg-new-mint/[0.07] shadow-[0_0_0_1px_rgba(52,211,153,0.08)]'
                    : 'border-white/6 bg-black/35'
                }`}
              >
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-off-blue/15 bg-off-blue/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-off-blue">
                    Live feed
                  </span>
                  <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-gray-400">
                    {market.category}
                  </span>
                  {market.hasLivePrice && (
                    <span className="rounded-full border border-new-mint/15 bg-new-mint/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-new-mint">
                      Live CLOB
                    </span>
                  )}
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.24em] ${
                    market.onChainCreated
                      ? 'border-off-blue/15 bg-off-blue/10 text-off-blue'
                      : 'border-white/8 bg-white/[0.03] text-gray-400'
                  }`}>
                    {market.onChainCreated ? 'Live' : 'Queued'}
                  </span>
                  {isSelected && (
                    <span className="rounded-full border border-new-mint/20 bg-new-mint/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-new-mint">
                      Selected
                    </span>
                  )}
                </div>

                <h4 className="text-lg font-bold leading-tight text-white">{market.question}</h4>
                <p className="mt-2 line-clamp-2 min-h-[40px] text-sm text-gray-400">
                  {market.description || 'Binary market synchronized into a hidden-side fixed-odds DART market.'}
                </p>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Signal</p>
                    <div className="mt-2 flex items-center justify-between text-sm font-bold">
                      <span className="text-new-mint">{market.outcomeLabels[0]} {yesPct}%</span>
                      <span className="text-off-red">{market.outcomeLabels[1]} {noPct}%</span>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-gray-500">Locked odds</p>
                    <div className="mt-2 flex items-center justify-between text-sm font-bold">
                      <span className="text-new-mint">{formatMultiplier(market.yesMultiplierBps)}</span>
                      <span className="text-off-red">{formatMultiplier(market.noMultiplierBps)}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 text-xs text-gray-400 sm:grid-cols-3">
                  <div>
                    <p className="mb-1 uppercase tracking-[0.22em] text-gray-500">Volume</p>
                    <p className="font-semibold text-white">{formatVolume(market.volume24hr || market.volume)}</p>
                  </div>
                  <div>
                    <p className="mb-1 uppercase tracking-[0.22em] text-gray-500">Close</p>
                    <p className="inline-flex items-center gap-1 font-semibold text-white">
                      <Clock3 className="h-3.5 w-3.5 text-gray-500" />
                      {formatEndDate(market.endDate)}
                    </p>
                  </div>
                  <div>
                    <p className="mb-1 uppercase tracking-[0.22em] text-gray-500">Market</p>
                    <p className="font-mono font-semibold text-white">{market.marketId}</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button
                    onClick={() => onSelectMarket?.(market)}
                    className={`rounded-2xl border px-4 py-3 text-sm font-bold uppercase tracking-[0.22em] transition-all ${
                      market.onChainCreated
                        ? 'border-new-mint/20 bg-new-mint/10 text-new-mint hover:bg-new-mint/15'
                        : 'border-white/8 bg-white/[0.03] text-gray-300 hover:text-white'
                    }`}
                  >
                    {isSelected ? 'Viewing Ticket' : market.onChainCreated ? 'Open Ticket' : 'Inspect'}
                  </button>
                  <Link
                    href={`/markets/${market.marketId}`}
                    className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-center text-sm font-bold uppercase tracking-[0.22em] text-gray-300 transition-colors hover:text-white"
                  >
                    Details
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
