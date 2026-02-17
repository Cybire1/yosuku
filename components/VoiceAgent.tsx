'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, X, Send, Loader2, ArrowUpRight, Sparkles } from 'lucide-react';
import { useWallet } from '@demox-labs/aleo-wallet-adapter-react';
import { useVoiceSession, type VoiceMessage } from '@/lib/hooks/useVoiceSession';
import MarketCard from './MarketCard';

export default function VoiceAgent() {
  const { publicKey } = useWallet();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [textInput, setTextInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  // Ensure component only renders on client
  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleMessage = useCallback((message: VoiceMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const { appState, startSession, toggleListening, sendTextMessage, isConnected } = useVoiceSession({
    apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || '',
    publicKey: publicKey ?? undefined,
    onMessage: handleMessage,
  });

  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    if (textInput.trim() && isConnected) {
      sendTextMessage(textInput);
      setTextInput('');
    }
  };

  const handleOpen = () => {
    setIsOpen(true);
    if (!isConnected) {
      startSession();
    }
  };

  // Don't render until mounted to avoid hydration issues
  if (!mounted) return null;

  return (
    <>
      {/* Floating Button - Living Orb Trigger (No Icon) */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0, opacity: 0, y: 20 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleOpen}
            className="fixed bottom-6 right-6 h-14 pl-4 pr-6 rounded-full flex items-center gap-3 z-50 group shadow-[0_4px_20px_rgba(52,211,153,0.3)] hover:shadow-[0_4px_30px_rgba(52,211,153,0.5)] transition-all duration-300 pointer-events-auto"
          >
            {/* Button Background - Gradient Glass */}
            <div className="absolute inset-0 bg-neutral-900/90 backdrop-blur-xl border border-white/10 rounded-full" />
            <div className="absolute inset-0 bg-gradient-to-r from-new-mint/10 to-new-blue/10 rounded-full opacity-50 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="absolute -inset-[1px] bg-gradient-to-r from-new-mint to-new-blue rounded-full opacity-30 blur-sm group-hover:opacity-60 transition-opacity duration-500" />

            {/* Icon Container - Living Orb */}
            <div className="relative w-8 h-8 flex items-center justify-center">
              <div className="absolute inset-0 bg-new-mint blur-md rounded-full opacity-50 animate-pulse" />
              <div className="relative z-10 w-full h-full bg-gradient-to-br from-new-mint to-new-blue rounded-full flex items-center justify-center text-black">
                <Sparkles className="w-4 h-4" fill="currentColor" />
              </div>
              {/* Orbiting Ring */}
              <div className="absolute inset-[-4px] border border-white/20 rounded-full animate-[spin_4s_linear_infinite]" />
            </div>

            {/* Text Label */}
            <div className="relative z-10 flex flex-col items-start mt-0.5">
              <span className="text-xs font-bold text-new-mint leading-none uppercase tracking-wider mb-0.5">Dart</span>
              <span className="text-lg font-black text-white leading-none tracking-tight group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-gray-200">AI AGENT</span>
            </div>
          </motion.button>
        )}
      </AnimatePresence >

      {/* Voice Agent Modal - "Floating Intelligence" */}
      <AnimatePresence>
        {
          isOpen && (
            <>
              {/* Deep Glass Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsOpen(false)}
                className="fixed inset-0 bg-black/80 backdrop-blur-[20px] z-50 transition-all duration-700"
              />

              {/* Modal Container */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 40 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 40 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className="fixed inset-4 md:inset-auto md:right-8 md:bottom-8 md:top-24 md:w-[480px] bg-neutral-950/90 rounded-[32px] border border-white/10 shadow-2xl z-50 flex flex-col overflow-hidden ring-1 ring-white/5"
              >
                {/* Cinematic Background Orbs */}
                <div className="absolute top-[-50px] right-[-50px] w-60 h-60 bg-new-mint/10 blur-[100px] rounded-full pointer-events-none animate-pulse" />
                <div className="absolute bottom-[-50px] left-[-50px] w-60 h-60 bg-new-blue/10 blur-[100px] rounded-full pointer-events-none animate-pulse delay-1000" />

                {/* Header */}
                <div className="relative z-10 p-6 flex items-center justify-between border-b border-white/5 bg-white/5 backdrop-blur-md">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <div className="w-10 h-10 bg-gradient-to-br from-neutral-800 to-black rounded-full flex items-center justify-center border border-white/10 shadow-inner">
                        <Mic className={`w-5 h-5 transition-colors duration-300 ${isConnected ? 'text-new-mint' : 'text-gray-500'}`} />
                      </div>
                      {/* Status Dot */}
                      <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-black transition-colors duration-300 ${isConnected ? 'bg-new-mint shadow-[0_0_10px_rgba(52,211,153,0.8)]' : 'bg-gray-500'}`} />
                    </div>
                    <div>
                      <h2 className="text-lg font-black text-white tracking-tight leading-none">A.I. AGENT</h2>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`w-1 h-1 rounded-full ${isConnected ? 'bg-new-mint animate-pulse' : 'bg-gray-500'}`} />
                        <p className="text-[10px] font-mono text-gray-400 uppercase tracking-widest">
                          {isConnected ? 'System Online' : 'Initializing...'}
                        </p>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="w-10 h-10 rounded-full bg-black/20 hover:bg-white/10 border border-white/5 flex items-center justify-center transition-all hover:rotate-90 duration-300 group"
                  >
                    <X className="w-5 h-5 text-gray-400 group-hover:text-white" />
                  </button>
                </div>

                {/* Messages Area - Glass Scroll */}
                <div
                  data-lenis-prevent
                  className="relative z-10 flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar overscroll-contain"
                >
                  {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center space-y-8">

                      {/* Zero State Orb */}
                      <div className="relative w-32 h-32 flex items-center justify-center">
                        <div className="absolute inset-0 bg-new-mint/20 blur-[60px] rounded-full animate-pulse" />
                        <div className="w-24 h-24 bg-gradient-to-b from-neutral-800 to-black rounded-full border border-white/10 flex items-center justify-center shadow-2xl relative z-10">
                          <Mic className="w-8 h-8 text-white/50" />
                        </div>
                        {/* Spinning Rings */}
                        <div className="absolute inset-0 border border-white/5 rounded-full animate-[spin_10s_linear_infinite]" />
                        <div className="absolute inset-4 border border-white/5 rounded-full animate-[spin_15s_linear_infinite_reverse]" />
                      </div>

                      <div>
                        <h3 className="text-xl font-bold text-white mb-2 tracking-tight">How can I help you?</h3>
                        <p className="text-sm text-gray-500 max-w-[260px] mx-auto leading-relaxed">
                          I can analyze markets, place bets, or check your portfolio. Just ask.
                        </p>
                      </div>

                      {/* Quick Prompts Grid */}
                      <div className="grid grid-cols-1 gap-3 w-full">
                        {[
                          { label: "Trending Markets", icon: "Trending", color: "border-new-mint/20 text-new-mint" },
                          { label: "Check Portfolio", icon: "Chart", color: "border-new-blue/20 text-new-blue" },
                        ].map((prompt, i) => (
                          <button key={i} className={`w-full p-4 rounded-2xl bg-white/5 hover:bg-white/10 border ${prompt.color} transition-all flex items-center justify-between group`}>
                            <span className="text-sm font-bold text-gray-300 group-hover:text-white transition-colors">{prompt.label}</span>
                            <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center">
                              <ArrowUpRight className="w-3 h-3 text-gray-400 group-hover:text-white" />
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    messages.map((msg, idx) => {
                      const isUser = msg.sender === 'user';
                      return (
                        <motion.div
                          key={idx}
                          initial={{ opacity: 0, scale: 0.95, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                        >
                          <div
                            className={`max-w-[85%] p-4 rounded-3xl backdrop-blur-md border ${isUser
                              ? 'bg-new-mint/10 border-new-mint/20 text-white rounded-br-none'
                              : 'bg-neutral-900/80 border-white/10 text-gray-300 rounded-bl-none shadow-lg'
                              }`}
                          >
                            <p className="text-sm leading-relaxed whitespace-pre-wrap font-medium">{msg.text}</p>
                            {!msg.isFinal && <span className="text-xs text-new-mint animate-pulse mt-2 block">processing...</span>}
                          </div>

                          {/* Rich Content Rendering */}
                          {msg.displayType === 'market_list' && msg.data && (
                            <div className="w-full mt-4 pl-4 overflow-x-auto pb-4 snap-x flex gap-4 no-scrollbar">
                              {msg.data.map((market: any) => (
                                <div key={market.id} className="min-w-[280px] max-w-[280px] flex-shrink-0 snap-center">
                                  <div className="scale-90 origin-top-left transform">
                                    <MarketCard market={market} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </motion.div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Footer / Input Area */}
                <div className="relative z-10 p-6 bg-neutral-900/90 backdrop-blur-xl border-t border-white/10">

                  {/* Voice Visualization - The Glowing Orb */}
                  <div className={`transition-all duration-500 ease-in-out flex items-center justify-center ${appState === 'listening' || appState === 'speaking' || appState === 'thinking' ? 'h-24 mb-4' : 'h-6 mb-2'}`}>
                    {appState === 'listening' || appState === 'speaking' ? (
                      <div className="relative w-20 h-20 flex items-center justify-center">
                        {/* Core */}
                        <div className={`w-12 h-12 rounded-full blur-[20px] transition-all duration-300 ${appState === 'listening' ? 'bg-off-red animate-pulse' : 'bg-new-mint animate-pulse'}`} />
                        <div className={`absolute inset-0 rounded-full border opacity-50 transition-all duration-300 ${appState === 'listening' ? 'border-off-red animate-[ping_1.5s_ease-out_infinite]' : 'border-new-mint animate-[ping_2s_ease-out_infinite]'}`} />
                        <Mic className={`relative z-10 w-6 h-6 transition-colors ${appState === 'listening' ? 'text-off-red' : 'text-new-mint'}`} />
                      </div>
                    ) : appState === 'thinking' ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-5 h-5 text-new-blue animate-spin" />
                        <span className="text-xs font-mono text-new-blue uppercase tracking-widest">Thinking...</span>
                      </div>
                    ) : (
                      <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest opacity-60">Mic Ready</p>
                    )}
                  </div>

                  {/* Input Bar */}
                  <form onSubmit={handleSendText} className="relative flex items-end gap-2">
                    <div className="relative flex-1 group">
                      {/* Glow effect on focus */}
                      <div className="absolute -inset-0.5 bg-gradient-to-r from-new-mint to-new-blue opacity-0 group-focus-within:opacity-30 blur transition-opacity duration-500 rounded-2xl" />
                      <textarea
                        value={textInput}
                        onChange={(e) => setTextInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendText(e);
                          }
                        }}
                        placeholder="Type a message..."
                        disabled={!isConnected}
                        className="relative w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/20 focus:bg-black/60 transition-all resize-none min-h-[56px] max-h-[120px]"
                        rows={1}
                      />
                    </div>

                    {/* Voice Toggle */}
                    <button
                      type="button"
                      onClick={toggleListening}
                      disabled={!isConnected}
                      className={`w-14 h-14 shrink-0 rounded-2xl flex items-center justify-center transition-all duration-300 border border-white/5 ${appState === 'listening' ? 'bg-off-red text-white shadow-[0_0_20px_rgba(239,68,68,0.4)]' :
                        appState === 'speaking' ? 'bg-new-mint text-black shadow-[0_0_20px_rgba(52,211,153,0.4)]' :
                          'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                        }`}
                    >
                      {appState === 'listening' ? <Mic className="w-6 h-6 animate-pulse" /> : <Mic className="w-6 h-6" />}
                    </button>

                    {/* Send Button (Only shows when typing) */}
                    <AnimatePresence>
                      {textInput.trim() && (
                        <motion.button
                          initial={{ scale: 0, width: 0, opacity: 0, marginLeft: 0 }}
                          animate={{ scale: 1, width: 56, opacity: 1, marginLeft: 8 }}
                          exit={{ scale: 0, width: 0, opacity: 0, marginLeft: 0 }}
                          type="submit"
                          className="w-14 h-14 shrink-0 bg-new-blue rounded-2xl flex items-center justify-center text-white hover:bg-new-blue/90 shadow-[0_0_20px_rgba(59,130,246,0.4)]"
                        >
                          <Send className="w-5 h-5" />
                        </motion.button>
                      )}
                    </AnimatePresence>

                  </form>
                </div>

              </motion.div>
            </>
          )
        }
      </AnimatePresence >
    </>
  );
}
