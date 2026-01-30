import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { decode, decodeAudioData, createBlob, type AudioBlob } from '../audio/audioUtils';
import {
  getActiveMarkets,
  getTrendingMarkets,
  getMarketDetails,
  getWalletBalance,
  getActivePositions,
  prepareBet,
  getSmartRecommendations,
  analyzePortfolio
} from '../voice/aleoTools';

export type AppState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface VoiceMessage {
  sender: 'user' | 'ai';
  text: string;
  isFinal: boolean;
}

interface UseVoiceSessionProps {
  apiKey: string;
  publicKey?: string;
  onMessage: (message: VoiceMessage) => void;
}

export function useVoiceSession({
  apiKey,
  publicKey,
  onMessage,
}: UseVoiceSessionProps) {
  const [appState, setAppState] = useState<AppState>('idle');

  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const sessionRef = useRef<any | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const isInitializingRef = useRef(false);

  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');
  const wasListeningBeforeSpeaking = useRef(false);

  // Stop microphone
  const stopMicrophone = useCallback(() => {
    if (microphoneStreamRef.current) {
      microphoneStreamRef.current.getTracks().forEach(track => track.stop());
      microphoneStreamRef.current = null;
    }
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    wasListeningBeforeSpeaking.current = false;
    setAppState((current) => current === 'listening' ? 'idle' : current);
  }, []);

  // Start microphone
  const startMicrophone = useCallback(async () => {
    console.log('[Voice] startMicrophone called');
    console.log('[Voice] Session exists:', !!sessionPromiseRef.current);
    console.log('[Voice] Session ref:', !!sessionRef.current);
    console.log('[Voice] Microphone exists:', !!microphoneStreamRef.current);

    if (!sessionPromiseRef.current || microphoneStreamRef.current) {
      console.log('[Voice] ⚠️ Cannot start microphone - session not ready or mic already active');
      return;
    }

    // CRITICAL: Wait for session to be fully connected before starting mic
    if (!sessionRef.current) {
      console.log('[Voice] ⚠️ Session promise exists but session not yet resolved - waiting...');
      try {
        await sessionPromiseRef.current;
        console.log('[Voice] ✅ Session resolved, proceeding with microphone setup');
      } catch (e) {
        console.error('[Voice] ❌ Session failed to resolve:', e);
        return;
      }
    }

    try {
      console.log('[Voice] 🎤 Requesting microphone access...');
      setAppState('listening');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneStreamRef.current = stream;
      console.log('[Voice] ✅ Microphone access granted');

      const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });
      const source = inputAudioContext.createMediaStreamSource(stream);
      const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = scriptProcessor;

      scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
        // Only send audio if session is still connected
        if (!sessionRef.current) {
          console.warn('[Voice] ⚠️ Skipping audio send - session not connected');
          return;
        }

        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
        const audioBlob: AudioBlob = createBlob(inputData);

        try {
          sessionRef.current.sendRealtimeInput({ media: audioBlob });
        } catch (e) {
          console.error('[Voice] ❌ Error sending audio:', e);
        }
      };

      source.connect(scriptProcessor);
      scriptProcessor.connect(inputAudioContext.destination);
      console.log('[Voice] ✅ Audio pipeline connected');
    } catch (error) {
      console.error('[Voice] ❌ Error accessing microphone:', error);
      onMessage({
        sender: 'ai',
        text: 'I need microphone access to hear you. Please enable it in your browser settings.',
        isFinal: true,
      });
      setAppState('idle');
    }
  }, [onMessage]);

  // Start session
  const startSession = useCallback(async () => {
    console.log('[Voice] ========================================');
    console.log('[Voice] Starting session...');
    console.log('[Voice] API Key present:', !!apiKey);
    console.log('[Voice] Public Key:', publicKey?.slice(0, 10) + '...' || 'Not connected');
    console.log('[Voice] Session exists:', !!sessionPromiseRef.current);
    console.log('[Voice] Is initializing:', isInitializingRef.current);

    if (!apiKey) {
      console.error('[Voice] ❌ API key missing!');
      onMessage({ sender: 'ai', text: 'API key not configured. Please add NEXT_PUBLIC_GEMINI_API_KEY to your .env file.', isFinal: true });
      return;
    }
    if (sessionPromiseRef.current || isInitializingRef.current) {
      console.log('[Voice] ⚠️ Session already exists or initializing - aborting');
      return;
    }

    isInitializingRef.current = true;
    console.log('[Voice] ✅ Passed all checks, proceeding with connection...');
    setAppState('thinking');

    const ai = new GoogleGenAI({ apiKey });
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 24000,
    });
    let nextStartTime = 0;

    const sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      config: {
        responseModalities: ['AUDIO' as any],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Kore',
            },
          },
        },
        // Enable Google Search for real-time information
        googleSearch: {} as any,
        systemInstruction: {
          parts: [{
            text: `You are DART, a professional prediction market voice assistant for the Aleo blockchain.

YOUR IDENTITY:
- Your name is DART (pronounce: "dart")
- You help users trade on prediction markets built on Aleo
- Be concise, accurate, and friendly
- You have access to real-time internet search for current events, prices, and news

PRONUNCIATION:
- Say "ALEO" as "AY-leo" (not A-L-E-O)
- Say market odds naturally: "68 percent" not "six eight percent"

INTERNET SEARCH CAPABILITIES:
- Use Google Search to find current information when users ask about:
  * Crypto prices (Bitcoin, Ethereum, Aleo, etc.)
  * Sports scores and stats
  * Political polling data and election updates
  * Breaking news and current events
  * Market trends and financial data
- Always cite your sources when using search results
- Combine search data with blockchain data for comprehensive answers
- Don't search for things you already know (like how prediction markets work)

CAPABILITIES - MARKET INTELLIGENCE:
- Check active markets using getActiveMarkets(category)
- Get trending markets using getTrendingMarkets()
- Get market details using getMarketDetails(marketId)
- Check wallet balance using getWalletBalance() - fetches REAL on-chain ALEO balance from blockchain
- View user positions using getActivePositions()

CAPABILITIES - ADVANCED FEATURES (PHASE 2):
- Get personalized recommendations using getSmartRecommendations()
- Analyze portfolio performance using analyzePortfolio()
- Prepare bets with validation using prepareBet(marketId, side, amount) - returns confirmation, DOES NOT execute
- Provide market insights and strategy advice

BEHAVIOR:
- Always use function calls when appropriate - don't just explain, DO the action
- Be proactive: when users ask "what's happening", automatically call getTrendingMarkets()
- Use search for real-time data: "What's Bitcoin's price?" → search and respond with current price
- Explain odds clearly: "68% YES means if you bet 1 ALEO on YES and win, you get 1.47 ALEO back"
- Keep responses under 3 sentences unless providing detailed market info
- When users want to bet, use prepareBet to validate and show confirmation - then tell them to use the UI to complete
- For prediction market questions, combine search (current events) with blockchain data (market odds)

SECURITY:
- prepareBet only validates and confirms - it does NOT execute the bet
- Always show full bet details (market, side, amount, odds, expected payout) before confirmation
- Tell users they need to complete the bet using the visual interface
- Never execute trades without explicit user confirmation through the UI

CRITICAL RULE:
- NEVER call the same function twice for the same user request
- After a function returns success, just respond conversationally with the results`
          }],
        },
        tools: [
          {
            functionDeclarations: [
              {
                name: 'getActiveMarkets',
                description: 'Get currently active prediction markets, optionally filtered by category',
                parameters: {
                  type: 'OBJECT' as any,
                  properties: {
                    category: {
                      type: 'STRING' as any,
                      description: 'Filter by category: All, Crypto, Politics, or Sports',
                      enum: ['All', 'Crypto', 'Politics', 'Sports'],
                    },
                  },
                },
              },
              {
                name: 'getTrendingMarkets',
                description: 'Get the top trending markets sorted by volume',
                parameters: {
                  type: 'OBJECT' as any,
                  properties: {},
                },
              },
              {
                name: 'getMarketDetails',
                description: 'Get detailed information about a specific market including odds, volume, end date',
                parameters: {
                  type: 'OBJECT' as any,
                  properties: {
                    marketId: {
                      type: 'NUMBER' as any,
                      description: 'The ID of the market to get details for',
                    },
                  },
                  required: ['marketId'],
                },
              },
              {
                name: 'getWalletBalance',
                description: 'Get real-time ALEO balance from blockchain. Shows total balance, staked amount, and available credits.',
                parameters: {
                  type: 'OBJECT' as any,
                  properties: {},
                },
              },
              {
                name: 'getActivePositions',
                description: 'Get all active betting positions for the connected wallet',
                parameters: {
                  type: 'OBJECT' as any,
                  properties: {},
                },
              },
              {
                name: 'prepareBet',
                description: 'Validate and prepare a bet (DOES NOT execute). Returns confirmation with odds, expected payout, and profit calculation.',
                parameters: {
                  type: 'OBJECT' as any,
                  properties: {
                    marketId: {
                      type: 'NUMBER' as any,
                      description: 'The ID of the market to bet on',
                    },
                    side: {
                      type: 'STRING' as any,
                      description: 'YES or NO',
                      enum: ['YES', 'NO'],
                    },
                    amount: {
                      type: 'NUMBER' as any,
                      description: 'Amount in ALEO to bet',
                    },
                  },
                  required: ['marketId', 'side', 'amount'],
                },
              },
              {
                name: 'getSmartRecommendations',
                description: 'Get personalized market recommendations based on user portfolio and betting patterns',
                parameters: {
                  type: 'OBJECT' as any,
                  properties: {},
                },
              },
              {
                name: 'analyzePortfolio',
                description: 'Analyze portfolio performance with ROI, win rate, profit/loss metrics',
                parameters: {
                  type: 'OBJECT' as any,
                  properties: {},
                },
              },
            ],
          },
        ],
      },
      callbacks: {
        onopen: () => {
          console.log('[Voice] ========================================');
          console.log('[Voice] ✅ Session opened successfully!');
          console.log('[Voice] Session ref will be set after promise resolves');
          console.log('[Voice] ========================================');
          setAppState('idle');
          onMessage({ sender: 'ai', text: "Hi! I'm DART, your AI prediction market assistant. I can help you discover markets, analyze your portfolio, get personalized recommendations, and prepare bets with full validation. What would you like to know?", isFinal: true });
        },
        onmessage: async (message: any) => {
          // Handle function calls
          if (message.toolCall) {
            console.log('[Voice] Function call:', message.toolCall);
            for (const fc of message.toolCall.functionCalls) {
              console.log(`[Voice] Calling: ${fc.name}`, fc.args);
              let result = 'ok';
              try {
                if (fc.name === 'getActiveMarkets') {
                  const category = fc.args?.category || 'All';
                  onMessage({ sender: 'ai', text: `✓ Fetching ${category} markets...`, isFinal: true });
                  const toolResult = await getActiveMarkets(category);
                  result = toolResult.success ? toolResult.message : `Error: ${toolResult.error}`;
                  if (toolResult.success) {
                    onMessage({ sender: 'ai', text: `Success: Found markets`, isFinal: true });
                  }
                } else if (fc.name === 'getTrendingMarkets') {
                  onMessage({ sender: 'ai', text: '✓ Getting trending markets...', isFinal: true });
                  const toolResult = await getTrendingMarkets();
                  result = toolResult.success ? toolResult.message : `Error: ${toolResult.error}`;
                  if (toolResult.success) {
                    onMessage({ sender: 'ai', text: `Success: Found ${toolResult.data?.length || 0} trending markets`, isFinal: true });
                  }
                } else if (fc.name === 'getMarketDetails' && fc.args) {
                  const { marketId } = fc.args;
                  onMessage({ sender: 'ai', text: `✓ Getting details for market ${marketId}...`, isFinal: true });
                  const toolResult = await getMarketDetails(marketId);
                  result = toolResult.success ? toolResult.message : `Error: ${toolResult.error}`;
                  if (toolResult.success) {
                    onMessage({ sender: 'ai', text: `Success: Retrieved market details`, isFinal: true });
                  }
                } else if (fc.name === 'getWalletBalance') {
                  onMessage({ sender: 'ai', text: '✓ Checking wallet balance...', isFinal: true });
                  const toolResult = await getWalletBalance(publicKey);
                  result = toolResult.success ? toolResult.message : `Error: ${toolResult.error}`;
                  if (toolResult.success) {
                    onMessage({ sender: 'ai', text: `Success: Retrieved balance`, isFinal: true });
                  }
                } else if (fc.name === 'getActivePositions') {
                  onMessage({ sender: 'ai', text: '✓ Checking active positions...', isFinal: true });
                  const toolResult = await getActivePositions(publicKey);
                  result = toolResult.success ? toolResult.message : `Error: ${toolResult.error}`;
                  if (toolResult.success) {
                    onMessage({ sender: 'ai', text: `Success: Found ${toolResult.data?.length || 0} positions`, isFinal: true });
                  }
                } else if (fc.name === 'prepareBet' && fc.args) {
                  const { marketId, side, amount } = fc.args;
                  onMessage({ sender: 'ai', text: `✓ Validating bet: ${amount} ALEO on ${side} for market ${marketId}...`, isFinal: true });
                  const toolResult = await prepareBet(publicKey, marketId, side, amount);
                  result = toolResult.success ? toolResult.message : `Error: ${toolResult.error}`;
                  if (toolResult.success) {
                    onMessage({ sender: 'ai', text: `✓ Bet validated successfully!`, isFinal: true });
                  }
                } else if (fc.name === 'getSmartRecommendations') {
                  onMessage({ sender: 'ai', text: '✓ Analyzing your portfolio for recommendations...', isFinal: true });
                  const toolResult = await getSmartRecommendations(publicKey);
                  result = toolResult.success ? toolResult.message : `Error: ${toolResult.error}`;
                  if (toolResult.success) {
                    onMessage({ sender: 'ai', text: `Success: Found ${toolResult.data?.length || 0} recommendations`, isFinal: true });
                  }
                } else if (fc.name === 'analyzePortfolio') {
                  onMessage({ sender: 'ai', text: '✓ Analyzing your portfolio performance...', isFinal: true });
                  const toolResult = await analyzePortfolio(publicKey);
                  result = toolResult.success ? toolResult.message : `Error: ${toolResult.error}`;
                  if (toolResult.success) {
                    const roi = toolResult.data?.roi || 0;
                    onMessage({ sender: 'ai', text: `Success: ROI ${roi > 0 ? '+' : ''}${roi.toFixed(1)}%`, isFinal: true });
                  }
                }
              } catch (e: any) {
                result = `Error: ${e.message}`;
                console.error('[Voice] Function error:', e);
              }
              console.log('[Voice] Function response:', result);
              sessionPromiseRef.current?.then((session) => {
                session.sendToolResponse({
                  functionResponses: { id: fc.id, name: fc.name, response: { result } },
                } as any);
              });
            }
          }

          // Handle transcriptions
          if (message.serverContent?.inputTranscription) {
            currentInputTranscription.current += message.serverContent.inputTranscription.text;
          }
          if (message.serverContent?.outputTranscription) {
            if (microphoneStreamRef.current && !wasListeningBeforeSpeaking.current) {
              wasListeningBeforeSpeaking.current = true;
              if (scriptProcessorRef.current) {
                scriptProcessorRef.current.disconnect();
                scriptProcessorRef.current = null;
              }
            }
            if (appState !== 'speaking') setAppState('speaking');
            currentOutputTranscription.current += message.serverContent.outputTranscription.text;
          }

          // Handle turn complete
          if (message.serverContent?.turnComplete) {
            const finalInput = currentInputTranscription.current.trim();
            const finalOutput = currentOutputTranscription.current.trim();

            if (finalInput) {
              onMessage({ sender: 'user', text: finalInput, isFinal: true });
            }
            if (finalOutput) {
              onMessage({ sender: 'ai', text: finalOutput, isFinal: true });
            }

            currentInputTranscription.current = '';
            currentOutputTranscription.current = '';

            // Restart microphone
            if (wasListeningBeforeSpeaking.current && microphoneStreamRef.current) {
              wasListeningBeforeSpeaking.current = false;
              const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
                sampleRate: 16000,
              });
              const source = inputAudioContext.createMediaStreamSource(microphoneStreamRef.current);
              const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
              scriptProcessorRef.current = scriptProcessor;

              scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                const audioBlob: AudioBlob = createBlob(inputData);
                if (sessionRef.current) {
                  try {
                    sessionRef.current.sendRealtimeInput({ media: audioBlob });
                  } catch (e) {
                    console.error('[Voice] ❌ Error sending audio (restart):', e);
                  }
                }
              };

              source.connect(scriptProcessor);
              scriptProcessor.connect(inputAudioContext.destination);
              setAppState('listening');
            }
          }

          // Handle audio playback
          const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
          if (audioData && audioContextRef.current) {
            if (appState !== 'speaking') setAppState('speaking');
            const audioBuffer = await decodeAudioData(
              decode(audioData),
              audioContextRef.current,
              24000,
              1
            );
            const source = audioContextRef.current.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContextRef.current.destination);

            const currentTime = audioContextRef.current.currentTime;
            const startTime = Math.max(currentTime, nextStartTime);
            source.start(startTime);
            nextStartTime = startTime + audioBuffer.duration;

            source.onended = () => {
              if (audioContextRef.current && nextStartTime <= audioContextRef.current.currentTime) {
                setAppState('idle');
              }
            };
          }
        },
        onerror: (e: ErrorEvent) => {
          console.log('[Voice] ========================================');
          console.error('[Voice] ❌ ERROR EVENT RECEIVED');
          console.error('[Voice] Error type:', e.type);
          console.error('[Voice] Error message:', e.message);
          console.error('[Voice] Full error object:', e);
          console.log('[Voice] ========================================');
          onMessage({
            sender: 'ai',
            text: `Connection error: ${e.message}`,
            isFinal: true,
          });
          setAppState('error');
        },
        onclose: (e: CloseEvent) => {
          console.log('[Voice] ========================================');
          console.log('[Voice] ❌ SESSION CLOSED EVENT');
          console.log('[Voice] Close code:', e?.code);
          console.log('[Voice] Close reason:', e?.reason);
          console.log('[Voice] Was clean:', e?.wasClean);
          console.log('[Voice] Full close event:', e);
          console.log('[Voice] Current refs state:');
          console.log('[Voice]   - sessionRef:', !!sessionRef.current);
          console.log('[Voice]   - sessionPromiseRef:', !!sessionPromiseRef.current);
          console.log('[Voice]   - microphoneStreamRef:', !!microphoneStreamRef.current);
          console.log('[Voice]   - isInitializingRef:', isInitializingRef.current);
          console.log('[Voice] ========================================');
          stopMicrophone();
          sessionRef.current = null;
          sessionPromiseRef.current = null;
          isInitializingRef.current = false;
          setAppState('idle');
        },
      },
    });

    console.log('[Voice] 🔄 Session promise created, storing in ref...');
    sessionPromiseRef.current = sessionPromise;

    try {
      console.log('[Voice] ⏳ Waiting for session to resolve...');
      sessionRef.current = await sessionPromise;
      console.log('[Voice] ========================================');
      console.log('[Voice] ✅ SESSION CONNECTED SUCCESSFULLY!');
      console.log('[Voice] Session object:', sessionRef.current);
      console.log('[Voice] Session has sendRealtimeInput:', typeof sessionRef.current?.sendRealtimeInput);
      console.log('[Voice] Session has sendToolResponse:', typeof sessionRef.current?.sendToolResponse);
      console.log('[Voice] ========================================');
      isInitializingRef.current = false;
    } catch (e: any) {
      console.log('[Voice] ========================================');
      console.error('[Voice] ❌ CONNECTION FAILED');
      console.error('[Voice] Error message:', e.message);
      console.error('[Voice] Error stack:', e.stack);
      console.error('[Voice] Full error:', e);
      console.log('[Voice] ========================================');
      setAppState('error');
      onMessage({
        sender: 'ai',
        text: `Failed to connect: ${e.message}`,
        isFinal: true,
      });
      sessionPromiseRef.current = null;
      isInitializingRef.current = false;
    }
  }, [apiKey, publicKey, onMessage, stopMicrophone]);

  // Toggle listening
  const toggleListening = useCallback(() => {
    if (appState === 'listening') {
      stopMicrophone();
    } else {
      startMicrophone();
    }
  }, [appState, startMicrophone, stopMicrophone]);

  // Send text message
  const sendTextMessage = useCallback((text: string) => {
    if (!sessionPromiseRef.current || !text.trim()) return;

    onMessage({ sender: 'user', text: text.trim(), isFinal: true });

    sessionPromiseRef.current.then((session) => {
      session.sendRealtimeInput({ text: text.trim() } as any);
    });
  }, [onMessage]);

  // Cleanup - ONLY on component unmount, NOT on dependency changes
  useEffect(() => {
    console.log('[Voice] 🎯 Cleanup effect mounted');
    return () => {
      console.log('[Voice] ========================================');
      console.log('[Voice] ⚠️ CLEANUP EFFECT TRIGGERED');
      console.log('[Voice] This should ONLY happen on component unmount');
      console.log('[Voice] If you see this while modal is still open, we have a problem!');
      console.log('[Voice] ========================================');
      // Don't use stopMicrophone callback - call cleanup directly to avoid dependency issues
      if (microphoneStreamRef.current) {
        microphoneStreamRef.current.getTracks().forEach(track => track.stop());
        microphoneStreamRef.current = null;
      }
      if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current = null;
      }
      if (sessionRef.current) {
        console.log('[Voice] Cleaning up session refs...');
        sessionRef.current = null;
        sessionPromiseRef.current = null;
      }
    };
  }, []); // Empty deps - only run on mount/unmount

  return {
    appState,
    startSession,
    toggleListening,
    sendTextMessage,
    isConnected: !!sessionRef.current,
  };
}
