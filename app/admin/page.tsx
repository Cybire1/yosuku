'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Shield, CheckCircle, XCircle, Clock, TrendingUp, Users, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import Header from '@/components/Header';
import type { Market } from '@/components/MarketCard';

// Admin addresses (replace with your actual admin addresses)
const ADMIN_ADDRESSES = [
  'aleo1...', // Add your admin wallet addresses here
];

export default function AdminPage() {
  const router = useRouter();
  const { publicKey, requestTransaction } = useWallet();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Check if connected user is admin
  const isAdmin = publicKey && ADMIN_ADDRESSES.includes(publicKey);

  useEffect(() => {
    loadMarkets();
  }, []);

  const loadMarkets = () => {
    try {
      const storedMarkets = localStorage.getItem('aleomarkets');
      if (storedMarkets) {
        const parsedMarkets = JSON.parse(storedMarkets);
        setMarkets(parsedMarkets);
      }
    } catch (error) {
      console.error('Error loading markets:', error);
    }
  };

  const handleResolve = async (market: Market, outcome: 'YES' | 'NO') => {
    if (!publicKey || !requestTransaction) {
      setError('Please connect your wallet first');
      return;
    }

    if (!isAdmin) {
      setError('Only admins can resolve markets');
      return;
    }

    setResolving(market.id.toString());
    setError('');
    setLoading(true);

    try {
      // Call resolve_market transition
      const inputs = [
        `${market.id}u64`,                    // market_id: u64
        outcome === 'YES' ? 'true' : 'false', // winning_side: bool
      ];

      const transaction = {
        address: publicKey,
        chainId: 'testnetbeta',
        transitions: [{
          program: 'predictionmarket_v2.aleo',
          functionName: 'resolve_market',
          inputs,
        }],
        fee: 1000000, // 1 ALEO
        feePrivate: false,
      };

      const txResult = await requestTransaction(transaction);
      console.log('Resolution transaction:', txResult);

      // Update market status locally
      const updatedMarkets = markets.map(m =>
        m.id === market.id
          ? { ...m, resolved: true, winning_side: outcome }
          : m
      );

      localStorage.setItem('aleomarkets', JSON.stringify(updatedMarkets));
      setMarkets(updatedMarkets);

      alert(`Market resolved successfully! Winner: ${outcome}`);
    } catch (err: any) {
      console.error('Resolution error:', err);
      setError(err.message || 'Failed to resolve market');
    } finally {
      setLoading(false);
      setResolving(null);
    }
  };

  if (!publicKey) {
    return (
      <div className="min-h-screen bg-black text-white selection:bg-off-blue/30 overflow-x-hidden">
        <div className="fixed inset-0 bg-noise opacity-[0.03] pointer-events-none z-50"></div>
        <Header />

        <main className="container mx-auto px-4 py-32 relative z-10">
          <div className="max-w-2xl mx-auto text-center">
            <Shield className="w-20 h-20 mx-auto text-gray-600 mb-8" />
            <h1 className="text-4xl font-black mb-4">Admin Panel</h1>
            <p className="text-gray-400 mb-8">Please connect your wallet to access the admin panel.</p>
          </div>
        </main>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-black text-white selection:bg-off-blue/30 overflow-x-hidden">
        <div className="fixed inset-0 bg-noise opacity-[0.03] pointer-events-none z-50"></div>
        <Header />

        <main className="container mx-auto px-4 py-32 relative z-10">
          <div className="max-w-2xl mx-auto text-center">
            <XCircle className="w-20 h-20 mx-auto text-off-red mb-8" />
            <h1 className="text-4xl font-black mb-4">Access Denied</h1>
            <p className="text-gray-400 mb-8">You do not have admin privileges.</p>
            <button
              onClick={() => router.push('/')}
              className="px-8 py-4 bg-white text-black hover:bg-gray-200 transition-colors font-bold uppercase tracking-widest text-sm rounded-full"
            >
              Back to Markets
            </button>
          </div>
        </main>
      </div>
    );
  }

  const unresolvedMarkets = markets.filter(m => !m.resolved);
  const resolvedMarkets = markets.filter(m => m.resolved);

  return (
    <div className="min-h-screen bg-black text-white selection:bg-off-blue/30 overflow-x-hidden">
      <div className="fixed inset-0 bg-noise opacity-[0.03] pointer-events-none z-50"></div>
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-off-blue/10 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-new-mint/10 blur-[120px] rounded-full"></div>
      </div>

      <Header />

      <main className="container mx-auto px-4 py-32 relative z-10">
        <div className="max-w-6xl mx-auto">
          {/* Back Button */}
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-2 text-gray-500 hover:text-white transition-colors mb-12 text-sm font-bold uppercase tracking-widest group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            Back to Markets
          </button>

          {/* Header */}
          <div className="mb-12">
            <div className="flex items-center gap-4 mb-4">
              <Shield className="w-12 h-12 text-off-blue" />
              <h1 className="text-6xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white to-gray-500">
                Admin Panel
              </h1>
            </div>
            <p className="text-xl text-gray-400 max-w-2xl leading-relaxed">
              Resolve markets and manage the platform.
            </p>
          </div>

          {/* Stats Overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
            <div className="relative group">
              <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-xl" />
              <div className="relative p-6">
                <div className="flex items-center justify-between mb-2">
                  <Clock className="w-5 h-5 text-yellow-400" />
                  <span className="text-2xl font-black text-white">{unresolvedMarkets.length}</span>
                </div>
                <div className="text-xs font-bold uppercase tracking-widest text-gray-500">Pending</div>
              </div>
            </div>

            <div className="relative group">
              <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-xl" />
              <div className="relative p-6">
                <div className="flex items-center justify-between mb-2">
                  <CheckCircle className="w-5 h-5 text-off-green" />
                  <span className="text-2xl font-black text-white">{resolvedMarkets.length}</span>
                </div>
                <div className="text-xs font-bold uppercase tracking-widest text-gray-500">Resolved</div>
              </div>
            </div>

            <div className="relative group">
              <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-xl" />
              <div className="relative p-6">
                <div className="flex items-center justify-between mb-2">
                  <TrendingUp className="w-5 h-5 text-new-blue" />
                  <span className="text-2xl font-black text-white">{markets.length}</span>
                </div>
                <div className="text-xs font-bold uppercase tracking-widest text-gray-500">Total Markets</div>
              </div>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="mb-8 p-4 bg-off-red/10 border border-off-red/30 rounded-xl text-off-red text-sm font-bold text-center">
              {error}
            </div>
          )}

          {/* Unresolved Markets */}
          <div className="mb-12">
            <h2 className="text-3xl font-black uppercase tracking-tight mb-6">Markets Pending Resolution</h2>

            {unresolvedMarkets.length === 0 ? (
              <div className="text-center py-20 text-gray-500">
                <CheckCircle className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>All markets are resolved!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {unresolvedMarkets.map((market) => (
                  <motion.div
                    key={market.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="relative group"
                  >
                    <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-2xl" />
                    <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-2xl pointer-events-none" />

                    <div className="relative p-6">
                      <div className="flex items-start justify-between gap-6">
                        <div className="flex-1">
                          <h3 className="text-xl font-bold text-white mb-3">{market.question}</h3>
                          <div className="flex gap-4 text-sm">
                            <span className="text-gray-400">
                              ID: <span className="text-white font-mono">{market.id}</span>
                            </span>
                            <span className="text-gray-400">
                              Category: <span className="text-white">{market.category}</span>
                            </span>
                            <span className="text-gray-400">
                              End Date: <span className="text-white">{new Date(market.end_date * 1000).toLocaleDateString()}</span>
                            </span>
                          </div>

                          <div className="flex gap-4 mt-4">
                            <div className="text-sm">
                              <span className="text-gray-400">YES Pool: </span>
                              <span className="text-off-green font-bold">{market.total_yes_shares.toFixed(2)}</span>
                            </div>
                            <div className="text-sm">
                              <span className="text-gray-400">NO Pool: </span>
                              <span className="text-off-red font-bold">{market.total_no_shares.toFixed(2)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => handleResolve(market, 'YES')}
                            disabled={loading && resolving === market.id.toString()}
                            className="px-6 py-3 bg-off-green hover:bg-off-green/90 text-black rounded-xl font-bold uppercase tracking-widest text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed min-w-[120px]"
                          >
                            {loading && resolving === market.id.toString() ? 'Resolving...' : 'YES Wins'}
                          </button>
                          <button
                            onClick={() => handleResolve(market, 'NO')}
                            disabled={loading && resolving === market.id.toString()}
                            className="px-6 py-3 bg-off-red hover:bg-off-red/90 text-black rounded-xl font-bold uppercase tracking-widest text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed min-w-[120px]"
                          >
                            {loading && resolving === market.id.toString() ? 'Resolving...' : 'NO Wins'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Resolved Markets */}
          {resolvedMarkets.length > 0 && (
            <div>
              <h2 className="text-3xl font-black uppercase tracking-tight mb-6">Resolved Markets</h2>
              <div className="space-y-4">
                {resolvedMarkets.map((market) => (
                  <motion.div
                    key={market.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="relative group"
                  >
                    <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-2xl" />
                    <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-2xl pointer-events-none" />

                    <div className="relative p-6">
                      <div className="flex items-start justify-between gap-6">
                        <div className="flex-1">
                          <h3 className="text-xl font-bold text-white mb-3">{market.question}</h3>
                          <div className="flex gap-4 text-sm">
                            <span className="text-gray-400">
                              ID: <span className="text-white font-mono">{market.id}</span>
                            </span>
                            <span className="text-gray-400">
                              Winner: <span className={`font-bold ${market.winning_side === 'YES' ? 'text-off-green' : 'text-off-red'}`}>
                                {market.winning_side}
                              </span>
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <CheckCircle className="w-5 h-5 text-off-green" />
                          <span className="text-sm font-bold text-gray-400 uppercase tracking-widest">Resolved</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
