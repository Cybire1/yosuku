'use client';

import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import Header from '@/components/Header';
import FeaturedHero from '@/components/FeaturedHero';
import MarketCard from '@/components/MarketCard';
import MarketSearch from '@/components/MarketSearch';
import type { Market } from '@/components/MarketCard';
import { TrendingUp, Flame, Zap, ArrowUpRight, ArrowDownRight, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';

const CATEGORIES = [
  { name: 'Trending', value: 'Trending', icon: Flame },
  { name: 'New', value: 'New', icon: Zap },
  { name: 'Politics', value: 'Politics', icon: null },
  { name: 'Sports', value: 'Sports', icon: null },
  { name: 'Culture', value: 'Culture', icon: null },
  { name: 'Crypto', value: 'Crypto', icon: null },
  { name: 'Economics', value: 'Economics', icon: null },
];

export default function MarketsPage() {
  const router = useRouter();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [searchResults, setSearchResults] = useState<Market[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('Trending');

  useEffect(() => {
    loadMarkets();
  }, []);

  const loadMarkets = () => {
    try {
      const storedMarkets = localStorage.getItem('aleomarkets');
      if (storedMarkets) {
        let parsedMarkets: Market[] = JSON.parse(storedMarkets);

        // Inject Award-Winning Cinematic Images (Mock)
        parsedMarkets = parsedMarkets.map((m, i) => ({
          ...m,
          image: getMockImage(m.category || 'Trending', i)
        }));

        setMarkets(parsedMarkets);
      }
    } catch (error) {
      console.error('Error loading markets:', error);
    } finally {
      setLoading(false);
    }
  };

  // Helper for cinematic backgrounds
  const getMockImage = (cat: string, index: number) => {
    const images = {
      'Crypto': ['https://images.unsplash.com/photo-1621761191319-c6fb62004040?auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1622630998477-20aa696fa4f5?auto=format&fit=crop&w=800&q=80'],
      'Sports': ['https://images.unsplash.com/photo-1579952363873-27f3bade9f55?auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=800&q=80'],
      'Politics': ['https://images.unsplash.com/photo-1541872703-74c5963631df?auto=format&fit=crop&w=800&q=80', 'https://images.unsplash.com/photo-1575320181282-9afab399332c?auto=format&fit=crop&w=800&q=80'],
      'Trending': ['https://images.unsplash.com/photo-1639762681485-074b7f938ba0?auto=format&fit=crop&w=800&q=80']
    };
    const catImages = images[cat as keyof typeof images] || images['Trending'];
    return catImages[index % catImages.length];
  }

  const handleSearch = (query: string, results: Market[]) => {
    setIsSearching(query.trim().length > 0);
    setSearchResults(results);
  };

  // Use search results if searching, otherwise use filter
  const displayMarkets = isSearching ? searchResults : markets;

  // Filter markets based on active category
  const getFilteredMarkets = () => {
    if (activeCategory === 'Trending') {
      // Sort by volume for trending
      return [...displayMarkets].sort((a, b) => (b.total_volume || 0) - (a.total_volume || 0));
    } else if (activeCategory === 'New') {
      // Sort by creation date for new
      return [...displayMarkets].sort((a, b) => (b.id || 0) - (a.id || 0));
    } else {
      // Filter by category
      return displayMarkets.filter(m => m.category === activeCategory);
    }
  };

  const filteredMarkets = getFilteredMarkets();
  const activeMarkets = filteredMarkets.filter(m => !m.resolved);
  const resolvedMarkets = filteredMarkets.filter(m => m.resolved);

  // Calculate trending markets for sidebar
  const trendingMarkets = [...markets]
    .filter(m => !m.resolved)
    .sort((a, b) => (b.total_volume || 0) - (a.total_volume || 0))
    .slice(0, 3);

  // Calculate top movers (markets with highest recent change)
  const topMovers = [...markets]
    .filter(m => !m.resolved)
    .map(m => {
      const total = m.total_yes_shares + m.total_no_shares || 1;
      const yesOdds = Math.round((m.total_yes_shares / total) * 100);
      // Mock change percentage (in real app, this would be calculated from historical data)
      const change = Math.floor(Math.random() * 30) - 15; // -15 to +15
      return { ...m, yesOdds, change };
    })
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 3);

  return (
    <div className="min-h-screen bg-neutral-950 overflow-x-hidden selection:bg-white selection:text-black">
      <Header />

      <main className="pt-24 relative">
        {/* Category Navigation - Horizontal Scroll like Kalshi */}
        <div className="sticky top-24 z-40 bg-neutral-950/95 backdrop-blur-xl border-b border-white/10">
          <div className="max-w-[1600px] mx-auto px-6">
            <div className="flex gap-1 overflow-x-auto scrollbar-hide py-3">
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const isActive = activeCategory === cat.value;

                return (
                  <button
                    key={cat.value}
                    onClick={() => setActiveCategory(cat.value)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${isActive
                      ? 'bg-white/10 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                  >
                    {Icon && <Icon className="w-4 h-4" />}
                    {cat.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Main Content with Sidebar */}
        <div className="max-w-[1600px] mx-auto px-6 py-8">
          <div className="flex gap-8">
            {/* Main Content Area */}
            <div className="flex-1 min-w-0">

              {/* Market Grid */}
              {loading ? (
                <div className="flex flex-col gap-4">
                  <div className="w-full h-[400px] bg-neutral-900/50 rounded-2xl animate-pulse" />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[1, 2, 3, 4].map(i => <div key={i} className="h-40 bg-neutral-900/50 rounded-xl animate-pulse" />)}
                  </div>
                </div>
              ) : activeMarkets.length > 0 ? (
                <div className="space-y-12">

                  {/* Hero Section (Only on Trending/Home) */}
                  {activeCategory === 'Trending' && activeMarkets[0] && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.5 }}
                    >
                      <FeaturedHero market={activeMarkets[0]} />
                    </motion.div>
                  )}

                  {/* Pro/Category Sections */}
                  <div>
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        {activeCategory === 'Trending' ? 'Popular Markets' : activeCategory}
                        <ChevronRight className="w-5 h-5 text-gray-600" />
                      </h3>
                      <div className="flex gap-2">
                        <button className="px-3 py-1 text-xs font-bold bg-white/5 hover:bg-white/10 text-white rounded-lg transition-colors">Vol</button>
                        <button className="px-3 py-1 text-xs font-bold hover:bg-white/5 text-gray-500 hover:text-white rounded-lg transition-colors">New</button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      {(activeCategory === 'Trending' ? activeMarkets.slice(1) : activeMarkets).map((market, index) => (
                        <motion.div
                          key={market.id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3, delay: index * 0.05 }}
                        >
                          <MarketCard market={market} />
                        </motion.div>
                      ))}
                    </div>
                  </div>

                </div>
              ) : (
                <div className="text-center py-20">
                  <p className="text-gray-500 mb-6">No markets found in this category.</p>
                  <button
                    onClick={() => setActiveCategory('Trending')}
                    className="inline-block px-8 py-4 bg-white text-black hover:bg-gray-200 transition-colors font-bold text-sm rounded-lg"
                  >
                    View Trending Markets
                  </button>
                </div>
              )}
            </div>

            {/* Sidebar - Award Winning Glass Widgets */}
            <div className="hidden lg:block w-[360px] space-y-8 flex-shrink-0">

              {/* Trending Widget */}
              <div className="bg-neutral-900/40 backdrop-blur-xl border border-white/5 rounded-3xl p-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-new-mint/10 blur-[50px] rounded-full pointer-events-none" />

                <div className="flex items-center justify-between mb-6 relative z-10">
                  <h3 className="text-xs font-black text-gray-500 uppercase tracking-[0.2em] flex items-center gap-2">
                    <Flame className="w-4 h-4 text-orange-500" />
                    Trending Now
                  </h3>
                </div>

                <div className="space-y-3 relative z-10">
                  {trendingMarkets.map((market, idx) => {
                    const total = market.total_yes_shares + market.total_no_shares || 1;
                    const yesOdds = Math.round((market.total_yes_shares / total) * 100);
                    const rankColors = ['text-yellow-400', 'text-gray-300', 'text-amber-600'];
                    const rankColor = rankColors[idx] || 'text-gray-600';

                    return (
                      <div
                        key={market.id}
                        onClick={() => router.push(`/market/${market.id}`)}
                        className="group cursor-pointer p-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.08] border border-transparent hover:border-white/5 transition-all duration-300 hover:scale-[1.02] flex items-center gap-4"
                      >
                        <span className={`text-xl font-black italic ${rankColor}`}>{idx + 1}</span>

                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm text-gray-200 font-bold leading-snug line-clamp-2 group-hover:text-new-mint transition-colors mb-1">
                            {market.question}
                          </h4>
                          <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">
                            {market.category}
                          </span>
                        </div>

                        <div className="text-right">
                          <div className="text-base font-black text-white">{yesOdds}%</div>
                          <div className="text-[10px] font-mono text-new-mint">Vol ${(market.total_volume / 1000).toFixed(1)}k</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Top Movers Widget */}
              <div className="bg-neutral-900/40 backdrop-blur-xl border border-white/5 rounded-3xl p-6 relative overflow-hidden">
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-new-blue/10 blur-[50px] rounded-full pointer-events-none" />

                <div className="flex items-center justify-between mb-6 relative z-10">
                  <h3 className="text-xs font-black text-gray-500 uppercase tracking-[0.2em] flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-new-blue" />
                    Top Movers
                  </h3>
                </div>

                <div className="space-y-3 relative z-10">
                  {topMovers.map((market, idx) => {
                    const isPositive = market.change > 0;
                    return (
                      <div
                        key={market.id}
                        onClick={() => router.push(`/market/${market.id}`)}
                        className="cursor-pointer p-3 rounded-2xl bg-white/[0.03] hover:bg-white/[0.08] border border-transparent hover:border-white/5 transition-all duration-300 flex items-center justify-between gap-3 group"
                      >
                        <div className="flex-1">
                          <h4 className="text-sm text-gray-300 font-medium leading-snug line-clamp-1 group-hover:text-white transition-colors">
                            {market.question}
                          </h4>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-gray-500">{market.winning_side || 'Yes'}</span>
                            <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isPositive ? 'bg-new-mint/10 text-new-mint' : 'bg-red-500/10 text-red-500'}`}>
                              {isPositive ? '+' : ''}{market.change}%
                            </div>
                          </div>
                        </div>

                        <ArrowUpRight className="w-4 h-4 text-gray-600 group-hover:text-white transition-colors" />
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
