import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { decode, decodeAudioData, createBlob, type AudioBlob } from '../audio/audioUtils';
import {
  getCurrentRound,
  getRoundHistory,
  getWalletBalance,
  getActivePositions,
  prepareBet,
  analyzePortfolio,
} from '../voice/aleoTools';

export type AppState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface VoiceMessage {
  sender: 'user' | 'ai';
  text: string;
  isFinal: boolean;
  data?: any;
  displayType?: 'round_info' | 'round_history' | 'wallet_balance' | 'positions' | 'bet_prep' | 'portfolio' | 'loading' | 'text';
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
        ...({ googleSearch: {} } as any),
        systemInstruction: {
          parts: [{
            text: `You are DART, a voice assistant for BTC prediction rounds on Aleo.

YOUR IDENTITY:
- Name: DART (pronounce "dart")
- You help users bet on whether BTC will be above or below a target price when a round ends
- Be concise and friendly. Keep answers under 3 sentences.

HOW IT WORKS:
- Each round sets a BTC target price and a deadline (in blocks, ~3.5s each)
- Users bet YES (BTC above target) or NO (BTC below target) using DART tokens
- When the round ends, the winning side splits the total pool (minus 10% fee)
- Rounds last about 5 minutes and auto-cycle

PRONUNCIATION:
- "ALEO" = "AY-leo", "DART" = "dart"
- Say odds naturally: "68 percent" not "six eight percent"

YOUR TOOLS:
- getCurrentRound() — get the active round (target price, time left, pool sizes)
- getRoundHistory() — see recent resolved rounds and outcomes
- getWalletBalance() — ALEO credits + DART token balance
- getActivePositions() — user's bets across rounds
- prepareBet(side, amount) — validate a bet on the current round (does NOT execute)
- analyzePortfolio() — win rate, ROI, P&L breakdown

BEHAVIOR:
- Use tools proactively. "What's happening?" → call getCurrentRound()
- "Check my portfolio" → call analyzePortfolio()
- "I want to bet" → call prepareBet() then tell them to use the UI
- Use Google Search for live BTC price, crypto news, etc.
- Never call the same function twice per request

SECURITY:
- prepareBet validates only — user must complete bet in the UI
- Never execute trades directly`
          }],
        },
        tools: [
          {
            functionDeclarations: [
              {
                name: 'getCurrentRound',
                description: 'Get the current active BTC prediction round (target price, time left, pool sizes)',
                parameters: { type: 'OBJECT' as any, properties: {} },
              },
              {
                name: 'getRoundHistory',
                description: 'Get recent resolved rounds with outcomes',
                parameters: { type: 'OBJECT' as any, properties: {} },
              },
              {
                name: 'getWalletBalance',
                description: 'Get ALEO credits and DART token balance from blockchain',
                parameters: { type: 'OBJECT' as any, properties: {} },
              },
              {
                name: 'getActivePositions',
                description: 'Get all betting positions for the connected wallet across rounds',
                parameters: { type: 'OBJECT' as any, properties: {} },
              },
              {
                name: 'prepareBet',
                description: 'Validate a bet on the current round (DOES NOT execute). Shows estimated payout.',
                parameters: {
                  type: 'OBJECT' as any,
                  properties: {
                    side: {
                      type: 'STRING' as any,
                      description: 'YES (BTC above target) or NO (BTC below target)',
                      enum: ['YES', 'NO'],
                    },
                    amount: {
                      type: 'NUMBER' as any,
                      description: 'Amount in DART tokens to bet',
                    },
                  },
                  required: ['side', 'amount'],
                },
              },
              {
                name: 'analyzePortfolio',
                description: 'Analyze portfolio: win rate, ROI, P&L, claimable amounts',
                parameters: { type: 'OBJECT' as any, properties: {} },
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
          onMessage({ sender: 'ai', text: "Hey! I'm DART. I can check the current round, your positions, portfolio stats, or help you prepare a bet. What do you need?", isFinal: true });
        },
        onmessage: async (message: any) => {
          // Handle function calls
          if (message.toolCall) {
            console.log('[Voice] Function call:', message.toolCall);
            for (const fc of message.toolCall.functionCalls) {
              console.log(`[Voice] Calling: ${fc.name}`, fc.args);
              let result = 'ok';
              try {
                if (fc.name === 'getCurrentRound') {
                  onMessage({ sender: 'ai', text: 'Checking current round...', isFinal: false, displayType: 'loading' });
                  const toolResult = await getCurrentRound();
                  result = toolResult.success ? toolResult.message : `Error: ${toolResult.error}`;
                  if (toolResult.success && toolResult.data) {
                    onMessage({ sender: 'ai', text: '', isFinal: true, data: toolResult.data, displayType: 'round_info' });
                  }
                } else if (fc.name === 'getRoundHistory') {
                  onMessage({ sender: 'ai', text: 'Fetching round history...', isFinal: false, displayType: 'loading' });
                  const toolResult = await getRoundHistory();
                  result = toolResult.success ? toolResult.message : `Error: ${toolResult.error}`;
                  if (toolResult.success && toolResult.data?.length > 0) {
                    onMessage({ sender: 'ai', text: '', isFinal: true, data: toolResult.data, displayType: 'round_history' });
                  }
                } else if (fc.name === 'getWalletBalance') {
                  onMessage({ sender: 'ai', text: 'Checking wallet...', isFinal: false, displayType: 'loading' });
                  const toolResult = await getWalletBalance(publicKey);
                  result = toolResult.success ? toolResult.message : `Error: ${toolResult.error}`;
                  if (toolResult.success && toolResult.data) {
                    onMessage({ sender: 'ai', text: '', isFinal: true, data: toolResult.data, displayType: 'wallet_balance' });
                  }
                } else if (fc.name === 'getActivePositions') {
                  onMessage({ sender: 'ai', text: 'Checking positions...', isFinal: false, displayType: 'loading' });
                  const toolResult = await getActivePositions(publicKey);
                  result = toolResult.success ? toolResult.message : `Error: ${toolResult.error}`;
                  if (toolResult.success && toolResult.data) {
                    onMessage({ sender: 'ai', text: '', isFinal: true, data: toolResult.data, displayType: 'positions' });
                  }
                } else if (fc.name === 'prepareBet' && fc.args) {
                  const { side, amount } = fc.args;
                  onMessage({ sender: 'ai', text: `Validating ${amount} DART on ${side}...`, isFinal: false, displayType: 'loading' });
                  const toolResult = await prepareBet(publicKey, side, amount);
                  result = toolResult.success ? toolResult.message : `Error: ${toolResult.error}`;
                  if (toolResult.success && toolResult.data) {
                    onMessage({ sender: 'ai', text: '', isFinal: true, data: toolResult.data, displayType: 'bet_prep' });
                  }
                } else if (fc.name === 'analyzePortfolio') {
                  onMessage({ sender: 'ai', text: 'Analyzing portfolio...', isFinal: false, displayType: 'loading' });
                  const toolResult = await analyzePortfolio(publicKey);
                  result = toolResult.success ? toolResult.message : `Error: ${toolResult.error}`;
                  if (toolResult.success && toolResult.data) {
                    onMessage({ sender: 'ai', text: '', isFinal: true, data: toolResult.data, displayType: 'portfolio' });
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
