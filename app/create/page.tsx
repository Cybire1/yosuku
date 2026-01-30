'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import { motion } from 'framer-motion';
import { ArrowLeft, Plus, Calendar, Hash, Copy } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';

export default function CreateMarketPage() {
  const router = useRouter();
  const { publicKey, requestTransaction } = useWallet();

  const [question, setQuestion] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [clonedFrom, setClonedFrom] = useState(false);

  // Check if we're cloning from Polymarket
  useEffect(() => {
    const cloneData = sessionStorage.getItem('cloneMarket');
    if (cloneData) {
      try {
        const data = JSON.parse(cloneData);
        setQuestion(data.question);
        setEndDate(data.endDate);
        setClonedFrom(true);
        sessionStorage.removeItem('cloneMarket'); // Clear after loading
      } catch (err) {
        console.error('Error loading clone data:', err);
      }
    }
  }, []);

  // Generate market ID from timestamp
  const generateMarketId = () => {
    return Math.floor(Date.now() / 1000);
  };

  // Hash question to field element (simplified - using first 16 chars as seed)
  const hashQuestion = (q: string): string => {
    // Simple hash: convert question to a number
    let hash = 0;
    for (let i = 0; i < q.length; i++) {
      hash = ((hash << 5) - hash) + q.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    return `${Math.abs(hash)}field`;
  };

  const handleCreateMarket = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!publicKey || !requestTransaction) {
      setError('Please connect your wallet first');
      return;
    }

    if (!question.trim()) {
      setError('Please enter a question');
      return;
    }

    if (!endDate) {
      setError('Please select an end date');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const marketId = generateMarketId();
      const questionHash = hashQuestion(question);

      console.log('Creating market:', { marketId, question, questionHash });

      // Construct proper AleoTransaction object
      const transaction = {
        address: publicKey,
        chainId: 'testnetbeta',
        transitions: [{
          program: 'predictionmarket_v2.aleo',
          functionName: 'create_market_public',
          inputs: [
            `${marketId}u64`,      // market_id: u64
            questionHash,          // question_hash: field
          ],
        }],
        fee: 2000000, // 2 ALEO fee for market creation
        feePrivate: false,
      };

      // Call create_market_public on the blockchain
      const txResult = await requestTransaction(transaction);

      console.log('Market creation result:', txResult);

      setSuccess(`Market created successfully! ID: ${marketId}`);

      // Store market details in localStorage for now (until we implement indexer)
      const markets = JSON.parse(localStorage.getItem('aleomarkets') || '[]');
      markets.push({
        id: marketId,
        question: question.trim(),
        end_timestamp: Math.floor(new Date(endDate).getTime() / 1000),
        total_yes_shares: 0,
        total_no_shares: 0,
        total_volume: 0,
        resolved: false,
        creator: publicKey,
      });
      localStorage.setItem('aleomarkets', JSON.stringify(markets));

      // Reset form
      setTimeout(() => {
        setQuestion('');
        setEndDate('');
        setSuccess('');
        router.push('/');
      }, 3000);

    } catch (err: any) {
      console.error('Market creation error:', err);

      // Better error messages for common issues
      let errorMessage = 'Failed to create market';

      if (err.message?.includes('NOT_GRANTED') || err.message?.includes('Permission Not Granted')) {
        errorMessage = 'Transaction rejected. Please approve the transaction in your wallet and ensure you have at least 3 ALEO (2 ALEO fee + gas).';
      } else if (err.message?.includes('Insufficient')) {
        errorMessage = 'Insufficient balance. You need at least 3 ALEO (2 ALEO creation fee + gas fees).';
      } else if (err.message?.includes('timeout')) {
        errorMessage = 'Transaction timed out. Please try again.';
      } else if (err.message) {
        errorMessage = err.message;
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white selection:bg-off-blue/30 overflow-x-hidden">
      <div className="fixed inset-0 bg-noise opacity-[0.03] pointer-events-none z-50"></div>
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-off-blue/10 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-off-green/5 blur-[120px] rounded-full"></div>
      </div>

      <Header />

      <main className="container mx-auto px-4 py-32 relative z-10">

        <div className="max-w-3xl mx-auto">
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
            <div className="flex flex-col gap-6 mb-8">
              {clonedFrom && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="self-start px-4 py-2 rounded-full border border-off-blue/20 bg-off-blue/10 text-off-blue flex items-center gap-2"
                >
                  <Copy className="w-3 h-3" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Cloned from Polymarket</span>
                </motion.div>
              )}
              <h1 className="text-6xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white to-gray-500">
                Create Market
              </h1>
            </div>
            <p className="text-xl text-gray-400 max-w-xl leading-relaxed">
              {clonedFrom
                ? "Sanitize this market for the Aleo privacy blockchain."
                : "Launch a new privacy-first prediction market."
              }
            </p>
          </div>

          {/* Form Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative"
          >
            {/* Glass Background */}
            <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-2xl border border-white/10 rounded-3xl" />
            <div className="absolute inset-0 bg-noise opacity-20 mix-blend-overlay rounded-3xl pointer-events-none" />

            <form onSubmit={handleCreateMarket} className="relative p-10 space-y-10">

              {/* Question Input */}
              <div className="space-y-4">
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest">
                  Market Question
                </label>
                <div className="relative group">
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="e.g. Will Bitcoin hit $100k?"
                    className="w-full h-32 bg-black/40 border border-white/10 rounded-xl px-6 py-6 text-2xl font-bold text-white placeholder-gray-700 resize-none focus:border-off-blue/50 focus:bg-black/60 focus:outline-none focus:ring-4 focus:ring-off-blue/5 transition-all"
                    maxLength={200}
                  />
                  <div className="absolute bottom-4 right-4 text-[10px] font-bold text-gray-600">
                    {question.length}/200
                  </div>
                </div>
              </div>

              {/* End Date Input */}
              <div className="space-y-4">
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest">
                  Resolution Date
                </label>
                <div className="relative group">
                  <Calendar className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-off-blue transition-colors" />
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full bg-black/40 border border-white/10 rounded-xl pl-16 pr-6 py-6 text-xl font-mono text-white placeholder-gray-700 focus:border-off-blue/50 focus:bg-black/60 focus:outline-none focus:ring-4 focus:ring-off-blue/5 transition-all text-white/90"
                  />
                </div>
              </div>

              {/* Fee Info */}
              <div className="flex items-start gap-4 p-4 rounded-xl bg-off-blue/5 border border-off-blue/10">
                <div className="p-2 bg-off-blue/10 rounded-lg text-off-blue">
                  <Hash className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-white font-bold text-sm mb-1">Creation Fee: 2 ALEO</div>
                  <p className="text-gray-400 text-xs leading-relaxed">
                    This fee creates the on-chain storage for your market. It is non-refundable.
                  </p>
                </div>
              </div>

              {/* Feedback Messages */}
              {error && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 bg-off-red/10 border border-off-red/20 rounded-xl text-off-red text-sm font-bold text-center">
                  {error}
                </motion.div>
              )}
              {success && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 bg-off-green/10 border border-off-green/20 rounded-xl text-off-green text-sm font-bold text-center">
                  {success}
                </motion.div>
              )}

              {/* Actions */}
              <div className="grid grid-cols-2 gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => router.push('/')}
                  className="px-8 py-5 rounded-xl border border-white/10 text-white font-bold uppercase tracking-widest text-xs hover:bg-white/5 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !publicKey || !question || !endDate}
                  className="px-8 py-5 rounded-xl bg-white text-black font-black uppercase tracking-widest text-xs hover:bg-off-blue hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_30px_rgba(255,255,255,0.1)] hover:shadow-[0_0_50px_rgba(96,165,250,0.3)] flex items-center justify-center gap-2"
                >
                  {loading ? 'Creating...' : (
                    <>
                      <Plus className="w-4 h-4" />
                      Create Market
                    </>
                  )}
                </button>
              </div>

              {!publicKey && (
                <div className="text-center">
                  <span className="text-off-orange text-xs font-bold uppercase tracking-widest animate-pulse">
                    Please connect wallet to continue
                  </span>
                </div>
              )}
            </form>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
