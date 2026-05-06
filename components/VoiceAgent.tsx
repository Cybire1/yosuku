// @ts-nocheck
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, X, Send, Loader2, Sparkles, Zap, BarChart3, Target, Clock, TrendingUp, TrendingDown, Wallet, Trophy, Check } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useVoiceSession, type VoiceMessage } from '@/lib/hooks/useVoiceSession';
import { formatPred } from '@/lib/predictionContract';

// ── Rich Card Components ─────────────────────────────

function RoundInfoCard({ data }: { data: any }) {
  if (!data) return null;
  const targetUsd = (data.targetPrice / 100).toFixed(2);
  const totalPool = data.totalPool || (data.yesPool + data.noPool);
  const secsLeft = Math.max(0, Math.floor((data.endTime - Date.now()) / 1000));
  const mins = Math.floor(secsLeft / 60);
  const secs = secsLeft % 60;
  const isDarkPool = data.yesPool === 0 && data.noPool === 0 && totalPool > 0;
  const yesPct = isDarkPool ? 50 : (totalPool > 0 ? Math.round((data.yesPool / totalPool) * 100) : 50);

  return (
    <div className="w-full rounded-xl bg-white/[0.04] border border-white/10 overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-white/[0.03]">
        <div className="flex items-center gap-2">
          <Target className="w-3.5 h-3.5 text-new-mint" />
          <span className="text-xs font-bold text-white">Round #{data.id}</span>
        </div>
        {data.resolved ? (
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${data.outcome ? 'bg-new-mint/15 text-new-mint' : 'bg-off-red/15 text-off-red'}`}>
            {data.outcome ? 'YES Won' : 'NO Won'}
          </span>
        ) : (
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-gray-500" />
            <span className="text-xs font-mono font-bold text-white">
              {secsLeft > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : 'Resolving...'}
            </span>
          </div>
        )}
      </div>
      {/* Body */}
      <div className="px-3 py-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500 block">Target</span>
            <span className="text-sm font-mono font-bold text-gray-300">${targetUsd}</span>
          </div>
          <div className="text-right">
            <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500 block">Pool</span>
            <span className="text-sm font-mono font-bold text-new-mint">{formatPred(totalPool)} Credits</span>
          </div>
        </div>
        {/* Pool bar */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-new-mint w-8 text-right">{yesPct}%</span>
          <div className="flex-1 h-1.5 rounded-full overflow-hidden flex bg-white/5">
            <div className="h-full bg-new-mint/70 rounded-full" style={{ width: `${yesPct}%` }} />
            <div className="h-full bg-off-red/70 rounded-full" style={{ width: `${100 - yesPct}%` }} />
          </div>
          <span className="text-[10px] font-bold text-off-red w-8">{100 - yesPct}%</span>
        </div>
        <div className="flex justify-between text-[10px] text-gray-500">
          <span>YES: {formatPred(data.yesPool)}</span>
          <span>NO: {formatPred(data.noPool)}</span>
        </div>
      </div>
    </div>
  );
}

function RoundHistoryCard({ data }: { data: any[] }) {
  if (!data?.length) return null;
  return (
    <div className="w-full rounded-xl bg-white/[0.04] border border-white/10 overflow-hidden">
      <div className="px-3 py-2 bg-white/[0.03] flex items-center gap-2">
        <Clock className="w-3.5 h-3.5 text-new-blue" />
        <span className="text-xs font-bold text-white">Recent Rounds</span>
      </div>
      <div className="divide-y divide-white/5">
        {data.slice(0, 5).map((r: any) => (
          <div key={r.id} className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-2">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center ${r.outcome ? 'bg-new-mint/15' : 'bg-off-red/15'}`}>
                {r.outcome ? <TrendingUp className="w-3 h-3 text-new-mint" /> : <TrendingDown className="w-3 h-3 text-off-red" />}
              </div>
              <span className="text-xs font-bold text-gray-300">#{r.id}</span>
              <span className="text-[10px] font-mono text-gray-500">${(r.targetPrice / 100).toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold ${r.outcome ? 'text-new-mint' : 'text-off-red'}`}>
                {r.outcome ? 'YES' : 'NO'}
              </span>
              <span className="text-[10px] font-mono text-gray-500">{formatPred(r.totalPool || (r.yesPool + r.noPool))}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WalletBalanceCard({ data }: { data: any }) {
  if (!data) return null;
  return (
    <div className="w-full rounded-xl bg-white/[0.04] border border-white/10 overflow-hidden">
      <div className="px-3 py-2 bg-white/[0.03] flex items-center gap-2">
        <Wallet className="w-3.5 h-3.5 text-new-mint" />
        <span className="text-xs font-bold text-white">Wallet</span>
      </div>
      <div className="px-3 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">ALEO Credits</span>
          <span className="text-sm font-mono font-bold text-white">{data.aleoBalance?.toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Credits</span>
          <span className="text-sm font-mono font-bold text-new-mint">{data.dartBalance?.toFixed(0)}</span>
        </div>
        {data.totalStaked > 0 && (
          <div className="flex items-center justify-between pt-1 border-t border-white/5">
            <span className="text-xs text-gray-500">Staked</span>
            <span className="text-xs font-mono text-yellow-400">{formatPred(data.totalStaked)} Credits</span>
          </div>
        )}
        {data.activeCount > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Active Bets</span>
            <span className="text-xs font-mono text-new-blue">{data.activeCount}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function PositionsCard({ data }: { data: any[] }) {
  if (!data?.length) return null;
  return (
    <div className="w-full rounded-xl bg-white/[0.04] border border-white/10 overflow-hidden">
      <div className="px-3 py-2 bg-white/[0.03] flex items-center gap-2">
        <Zap className="w-3.5 h-3.5 text-yellow-400" />
        <span className="text-xs font-bold text-white">{data.length} Position{data.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="divide-y divide-white/5">
        {data.map((pos: any, i: number) => {
          const side = pos.yesDeposit > 0 ? 'YES' : 'NO';
          const deposit = Math.max(pos.yesDeposit || 0, pos.noDeposit || 0);
          return (
            <div key={i} className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${side === 'YES' ? 'bg-new-mint/15 text-new-mint' : 'bg-off-red/15 text-off-red'}`}>
                  {side}
                </span>
                <span className="text-xs text-gray-400">Round #{pos.roundId}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-white">{formatPred(deposit)}</span>
                <span className="text-[10px] text-gray-500">Credits</span>
                {pos.claimed && <Check className="w-3 h-3 text-new-mint" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BetPrepCard({ data }: { data: any }) {
  if (!data) return null;
  return (
    <div className="w-full rounded-xl border overflow-hidden bg-white/[0.04] border-new-mint/20">
      <div className="px-3 py-2 bg-new-mint/10 flex items-center gap-2">
        <Check className="w-3.5 h-3.5 text-new-mint" />
        <span className="text-xs font-bold text-new-mint">Bet Ready</span>
      </div>
      <div className="px-3 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Round</span>
          <span className="text-xs font-bold text-white">#{data.roundId}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Side</span>
          <span className={`text-xs font-bold ${data.side === 'YES' ? 'text-new-mint' : 'text-off-red'}`}>{data.side}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Amount</span>
          <span className="text-xs font-mono font-bold text-white">{data.amount} Credits</span>
        </div>
        <div className="flex items-center justify-between pt-1 border-t border-white/5">
          <span className="text-xs text-gray-500">Est. Payout</span>
          <span className="text-xs font-mono font-bold text-new-mint">{data.estPayout} Credits</span>
        </div>
        <p className="text-[10px] text-gray-500 pt-1">Use the betting panel to confirm.</p>
      </div>
    </div>
  );
}

function PortfolioCard({ data }: { data: any }) {
  if (!data) return null;
  const isProfit = data.totalPnL >= 0;
  return (
    <div className="w-full rounded-xl bg-white/[0.04] border border-white/10 overflow-hidden">
      <div className="px-3 py-2 bg-white/[0.03] flex items-center gap-2">
        <BarChart3 className="w-3.5 h-3.5 text-new-blue" />
        <span className="text-xs font-bold text-white">Portfolio</span>
      </div>
      <div className="px-3 py-3 space-y-2">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center p-2 rounded-lg bg-white/[0.03]">
            <span className="text-[9px] uppercase tracking-wider text-gray-500 block">Win Rate</span>
            <span className="text-sm font-mono font-bold text-white">{data.winRate || 0}%</span>
          </div>
          <div className="text-center p-2 rounded-lg bg-white/[0.03]">
            <span className="text-[9px] uppercase tracking-wider text-gray-500 block">ROI</span>
            <span className={`text-sm font-mono font-bold ${isProfit ? 'text-new-mint' : 'text-off-red'}`}>
              {data.roi > 0 ? '+' : ''}{data.roi?.toFixed(1)}%
            </span>
          </div>
          <div className="text-center p-2 rounded-lg bg-white/[0.03]">
            <span className="text-[9px] uppercase tracking-wider text-gray-500 block">Rounds</span>
            <span className="text-sm font-mono font-bold text-white">{data.totalPositions || 0}</span>
          </div>
        </div>
        {/* P&L */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-gray-500">P&L</span>
          <div className="flex items-center gap-1.5">
            {isProfit ? <TrendingUp className="w-3 h-3 text-new-mint" /> : <TrendingDown className="w-3 h-3 text-off-red" />}
            <span className={`text-sm font-mono font-bold ${isProfit ? 'text-new-mint' : 'text-off-red'}`}>
              {isProfit ? '+' : ''}{formatPred(data.totalPnL || 0)} Credits
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Invested</span>
          <span className="text-xs font-mono text-gray-300">{formatPred(data.totalInvested || 0)} Credits</span>
        </div>
        {data.wins > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Record</span>
            <span className="text-xs">
              <span className="text-new-mint font-bold">{data.wins}W</span>
              <span className="text-gray-600 mx-1">/</span>
              <span className="text-off-red font-bold">{data.losses}L</span>
            </span>
          </div>
        )}
        {data.claimable > 0 && (
          <div className="flex items-center justify-between pt-1 border-t border-white/5">
            <span className="text-xs text-gray-500">Claimable</span>
            <div className="flex items-center gap-1">
              <Trophy className="w-3 h-3 text-yellow-400" />
              <span className="text-xs font-mono font-bold text-yellow-400">{formatPred(data.claimable)} Credits</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LoadingCard({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/5">
      <Loader2 className="w-3.5 h-3.5 text-new-mint animate-spin" />
      <span className="text-xs text-gray-400">{text}</span>
    </div>
  );
}

// ── Message Renderer ─────────────────────────────────

function MessageBubble({ msg }: { msg: VoiceMessage }) {
  const isUser = msg.sender === 'user';

  // Loading state
  if (msg.displayType === 'loading') {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
        <LoadingCard text={msg.text} />
      </motion.div>
    );
  }

  // Rich cards
  if (msg.displayType && msg.displayType !== 'text' && msg.data) {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="w-full">
        {msg.displayType === 'round_info' && <RoundInfoCard data={msg.data} />}
        {msg.displayType === 'round_history' && <RoundHistoryCard data={msg.data} />}
        {msg.displayType === 'wallet_balance' && <WalletBalanceCard data={msg.data} />}
        {msg.displayType === 'positions' && <PositionsCard data={msg.data} />}
        {msg.displayType === 'bet_prep' && <BetPrepCard data={msg.data} />}
        {msg.displayType === 'portfolio' && <PortfolioCard data={msg.data} />}
      </motion.div>
    );
  }

  // Skip empty text messages
  if (!msg.text) return null;

  // Regular text bubble
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed ${
          isUser
            ? 'bg-new-mint/15 text-white rounded-br-md'
            : 'bg-white/[0.05] text-gray-300 rounded-bl-md'
        }`}
      >
        <p className="whitespace-pre-wrap">{msg.text}</p>
      </div>
    </motion.div>
  );
}

// ── Main Component ───────────────────────────────────

export default function VoiceAgent() {
  const account = useCurrentAccount();
  const address = account?.address ?? null;
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [textInput, setTextInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleMessage = useCallback((message: VoiceMessage) => {
    setMessages((prev) => {
      // Replace loading messages with the final result
      if (message.displayType && message.displayType !== 'loading' && message.displayType !== 'text') {
        const filtered = prev.filter(m => m.displayType !== 'loading');
        return [...filtered, message];
      }
      return [...prev, message];
    });
  }, []);

  const { appState, startSession, toggleListening, sendTextMessage, isConnected } = useVoiceSession({
    apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || '',
    publicKey: address ?? undefined,
    onMessage: handleMessage,
  });

  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    if (textInput.trim() && isConnected) {
      sendTextMessage(textInput);
      setTextInput('');
    }
  };

  const handleQuickPrompt = (text: string) => {
    if (isConnected) sendTextMessage(text);
  };

  const pendingMicRef = useRef(false);

  const handleOpen = () => {
    setIsOpen(true);
    if (!isConnected) {
      pendingMicRef.current = true;
      startSession();
    } else {
      toggleListening();
    }
  };

  useEffect(() => {
    if (isConnected && pendingMicRef.current) {
      pendingMicRef.current = false;
      toggleListening();
    }
  }, [isConnected, toggleListening]);

  if (!mounted || pathname !== '/markets') return null;

  const stateLabel = appState === 'listening' ? 'Listening...'
    : appState === 'speaking' ? 'Speaking...'
    : appState === 'thinking' ? 'Thinking...'
    : isConnected ? 'Ready' : 'Connecting...';

  return (
    <>
      {/* Floating Trigger */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleOpen}
            className="fixed bottom-6 right-6 z-50 pointer-events-auto"
          >
            <div className="relative h-12 pl-3.5 pr-5 rounded-full flex items-center gap-2.5 bg-new-mint shadow-[0_4px_24px_rgba(52,211,153,0.35)] hover:shadow-[0_4px_32px_rgba(52,211,153,0.5)] hover:brightness-110 transition-all">
              <Sparkles className="w-4 h-4 text-black/70" fill="currentColor" />
              <span className="text-sm font-black text-black tracking-tight">DART AI</span>
            </div>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Modal */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            />

            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="fixed bottom-4 right-4 w-[calc(100%-2rem)] max-w-[420px] h-[min(600px,calc(100vh-6rem))] bg-neutral-950 rounded-2xl border border-white/10 shadow-2xl z-50 flex flex-col overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-new-mint to-new-blue flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-black" fill="currentColor" />
                  </div>
                  <div>
                    <span className="text-sm font-bold text-white block leading-none">DART AI</span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-new-mint' : 'bg-gray-500'} ${appState === 'listening' ? 'bg-off-red animate-pulse' : appState === 'speaking' ? 'animate-pulse' : ''}`} />
                      <span className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">{stateLabel}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="w-8 h-8 rounded-full hover:bg-white/5 flex items-center justify-center transition-colors"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>

              {/* Messages */}
              <div
                data-lenis-prevent
                className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5 overscroll-contain"
              >
                {messages.length === 0 && isConnected ? (
                  <div className="flex flex-col items-center justify-center h-full gap-5 py-6">
                    <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-center">
                      <Mic className="w-6 h-6 text-gray-600" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-white mb-1">Ask DART anything</p>
                      <p className="text-[11px] text-gray-600 max-w-[220px]">
                        Current round, positions, portfolio, or BTC price.
                      </p>
                    </div>
                    <div className="w-full space-y-1.5">
                      {[
                        { label: 'Current Round', icon: Target, text: "What's the current round?" },
                        { label: 'My Positions', icon: Zap, text: 'Show my positions' },
                        { label: 'Portfolio Stats', icon: BarChart3, text: 'Analyze my portfolio' },
                      ].map((p) => (
                        <button
                          key={p.label}
                          onClick={() => handleQuickPrompt(p.text)}
                          className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] hover:border-white/10 transition-all text-left group"
                        >
                          <p.icon className="w-3.5 h-3.5 text-gray-600 group-hover:text-new-mint transition-colors" />
                          <span className="text-[11px] font-medium text-gray-400 group-hover:text-gray-200 transition-colors">{p.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="w-5 h-5 text-gray-600 animate-spin" />
                  </div>
                ) : (
                  messages.map((msg, idx) => <MessageBubble key={idx} msg={msg} />)
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Voice state indicator */}
              <AnimatePresence>
                {(appState === 'listening' || appState === 'speaking') && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 36, opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="flex items-center justify-center gap-2 border-t border-white/5 overflow-hidden"
                  >
                    <div className="flex gap-0.5">
                      {[0, 1, 2, 3, 4].map(i => (
                        <motion.div
                          key={i}
                          className={`w-0.5 rounded-full ${appState === 'listening' ? 'bg-off-red' : 'bg-new-mint'}`}
                          animate={{ height: [3, appState === 'listening' ? 10 : 14, 3] }}
                          transition={{ duration: appState === 'listening' ? 0.6 : 0.8, repeat: Infinity, delay: i * 0.1 }}
                        />
                      ))}
                    </div>
                    <span className={`text-[10px] font-mono uppercase tracking-wider ${appState === 'listening' ? 'text-off-red' : 'text-new-mint'}`}>
                      {appState === 'listening' ? 'Listening' : 'Speaking'}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Input */}
              <div className="px-3 py-3 border-t border-white/5">
                <form onSubmit={handleSendText} className="flex items-center gap-2">
                  <input
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    placeholder={isConnected ? 'Ask something...' : 'Connecting...'}
                    disabled={!isConnected}
                    className="flex-1 bg-white/[0.04] border border-white/5 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-white/15 transition-colors"
                  />
                  {textInput.trim() ? (
                    <button
                      type="submit"
                      className="w-11 h-11 shrink-0 rounded-xl bg-new-mint flex items-center justify-center text-black hover:bg-new-mint/90 transition-colors"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={toggleListening}
                      disabled={!isConnected}
                      className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center transition-all ${
                        appState === 'listening'
                          ? 'bg-off-red text-white'
                          : 'bg-white/[0.04] border border-white/5 text-gray-500 hover:text-white hover:bg-white/[0.08]'
                      }`}
                    >
                      {appState === 'listening' ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </button>
                  )}
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
