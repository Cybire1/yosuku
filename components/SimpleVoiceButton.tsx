'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { useVoiceSession, type VoiceMessage } from '@/lib/hooks/useVoiceSession';

export default function SimpleVoiceButton() {
  const { address } = useWallet();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [textInput, setTextInput] = useState('');
  const [mounted, setMounted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const renderCountRef = useRef(0);

  useEffect(() => {
    console.log('[SimpleVoiceButton] Component mounted');
    setMounted(true);
    return () => {
      console.log('[SimpleVoiceButton] Component unmounting - this should NOT happen while modal is open!');
    };
  }, []);

  // Track renders
  renderCountRef.current++;
  console.log('[SimpleVoiceButton] Render #', renderCountRef.current, {
    isOpen,
    mounted,
    messagesCount: messages.length,
    hasPublicKey: !!address
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleMessage = useCallback((message: VoiceMessage) => {
    console.log('[SimpleVoiceButton] handleMessage called:', message.sender, message.text.slice(0, 50));
    setMessages((prev) => [...prev, message]);
  }, []);

  console.log('[SimpleVoiceButton] Calling useVoiceSession with:', {
    hasApiKey: !!process.env.NEXT_PUBLIC_GEMINI_API_KEY,
    hasPublicKey: !!address,
    handleMessageFn: !!handleMessage
  });

  const { appState, startSession, toggleListening, sendTextMessage, isConnected } = useVoiceSession({
    apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || '',
    publicKey: address ?? undefined,
    onMessage: handleMessage,
  });

  console.log('[SimpleVoiceButton] useVoiceSession returned:', {
    appState,
    isConnected,
    hasStartSession: !!startSession,
    hasToggleListening: !!toggleListening
  });

  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    if (textInput.trim() && isConnected) {
      sendTextMessage(textInput);
      setTextInput('');
    }
  };

  const handleOpen = () => {
    console.log('[SimpleVoiceButton] ========================================');
    console.log('[SimpleVoiceButton] handleOpen called');
    console.log('[SimpleVoiceButton] Current state - isConnected:', isConnected);
    console.log('[SimpleVoiceButton] ========================================');
    setIsOpen(true);
    if (!isConnected) {
      console.log('[SimpleVoiceButton] Not connected, calling startSession...');
      startSession();
    } else {
      console.log('[SimpleVoiceButton] Already connected, skipping startSession');
    }
  };

  if (!mounted) return null;

  return (
    <>
      {/* Floating Button */}
      {!isOpen && (
        <button
          onClick={handleOpen}
          style={{
            position: 'fixed',
            bottom: '32px',
            right: '32px',
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            backgroundColor: '#00FFA3',
            border: 'none',
            cursor: 'pointer',
            zIndex: 9999,
            boxShadow: '0 4px 20px rgba(0, 255, 163, 0.5)',
            fontSize: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.2s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >
          🎤
        </button>
      )}

      {/* Voice Agent Modal */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setIsOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
              backdropFilter: 'blur(4px)',
              zIndex: 9998,
            }}
          />

          {/* Modal */}
          <div
            style={{
              position: 'fixed',
              right: '32px',
              bottom: '32px',
              top: '32px',
              width: '450px',
              maxWidth: 'calc(100vw - 64px)',
              backgroundColor: '#171717',
              borderRadius: '24px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              zIndex: 9999,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              padding: '24px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  position: 'relative',
                  width: '48px',
                  height: '48px',
                  backgroundColor: 'rgba(0, 255, 163, 0.2)',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <span style={{ fontSize: '24px' }}>🎤</span>
                  {isConnected && (
                    <div style={{
                      position: 'absolute',
                      bottom: '-2px',
                      right: '-2px',
                      width: '16px',
                      height: '16px',
                      backgroundColor: '#00C853',
                      borderRadius: '50%',
                      border: '2px solid #171717',
                    }} />
                  )}
                </div>
                <div>
                  <h2 style={{
                    fontSize: '18px',
                    fontWeight: '900',
                    color: 'white',
                    letterSpacing: '-0.5px',
                    margin: 0,
                  }}>DART</h2>
                  <p style={{
                    fontSize: '12px',
                    color: '#9CA3AF',
                    margin: 0,
                  }}>
                    {isConnected ? 'Voice Assistant Online' : 'Connecting...'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  border: 'none',
                  color: '#9CA3AF',
                  cursor: 'pointer',
                  fontSize: '18px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>

            {/* Messages */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}>
              {messages.length === 0 ? (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  textAlign: 'center',
                  gap: '16px',
                }}>
                  <div style={{
                    width: '64px',
                    height: '64px',
                    backgroundColor: 'rgba(0, 255, 163, 0.1)',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '32px',
                  }}>🎤</div>
                  <div>
                    <p style={{ fontSize: '18px', fontWeight: 'bold', color: 'white', margin: '0 0 8px 0' }}>
                      Ready to help!
                    </p>
                    <p style={{ fontSize: '14px', color: '#9CA3AF', margin: 0 }}>
                      Click the button below or type to start
                    </p>
                  </div>
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {[
                      { color: '#00FFA3', label: 'Market Discovery', text: '"What are the trending markets?"' },
                      { color: '#3B82F6', label: 'Portfolio Analysis', text: '"Analyze my portfolio performance"' },
                      { color: '#00C853', label: 'Smart Recommendations', text: '"Give me personalized recommendations"' },
                      { color: '#EF4444', label: 'Bet Preparation', text: '"Prepare bet: 5 ALEO on YES for market 1"' },
                    ].map((example, idx) => (
                      <div key={idx} style={{
                        backgroundColor: '#262626',
                        borderRadius: '12px',
                        padding: '12px',
                        textAlign: 'left',
                        border: `1px solid ${example.color}30`,
                      }}>
                        <p style={{
                          fontSize: '10px',
                          color: example.color,
                          margin: '0 0 4px 0',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          fontWeight: 'bold',
                        }}>{example.label}</p>
                        <p style={{ fontSize: '14px', color: '#D1D5DB', margin: 0 }}>{example.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg, idx) => {
                  const isFunctionCall = msg.text.includes('✓') || msg.text.includes('Success:');
                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        justifyContent: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <div
                        style={{
                          maxWidth: '80%',
                          padding: '12px 16px',
                          borderRadius: '16px',
                          backgroundColor: msg.sender === 'user' ? '#00FFA3' : isFunctionCall ? '#262626' : '#262626',
                          color: msg.sender === 'user' ? 'black' : 'white',
                          border: isFunctionCall ? '1px solid rgba(0, 255, 163, 0.3)' : 'none',
                          borderBottomRightRadius: msg.sender === 'user' ? '4px' : '16px',
                          borderBottomLeftRadius: msg.sender === 'ai' ? '4px' : '16px',
                          opacity: msg.isFinal ? 1 : 0.6,
                        }}
                      >
                        <p style={{
                          fontSize: '14px',
                          lineHeight: '1.6',
                          whiteSpace: 'pre-wrap',
                          margin: 0,
                        }}>
                          {msg.text}
                          {!msg.isFinal && <span style={{ fontSize: '12px', opacity: 0.5, marginLeft: '8px' }}>typing...</span>}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div style={{
              padding: '24px',
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}>
              {/* Text Input */}
              <form onSubmit={handleSendText} style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder={isConnected ? "Type a message..." : "Connecting..."}
                  disabled={!isConnected}
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    backgroundColor: '#262626',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '24px',
                    fontSize: '14px',
                    color: 'white',
                    outline: 'none',
                  }}
                />
                <button
                  type="submit"
                  disabled={!isConnected || !textInput.trim()}
                  style={{
                    padding: '12px 16px',
                    backgroundColor: '#00FFA3',
                    color: 'black',
                    border: 'none',
                    borderRadius: '24px',
                    fontWeight: 'bold',
                    cursor: isConnected && textInput.trim() ? 'pointer' : 'not-allowed',
                    opacity: isConnected && textInput.trim() ? 1 : 0.5,
                    fontSize: '14px',
                  }}
                >
                  Send
                </button>
              </form>

              {/* Voice Button */}
              <button
                onClick={toggleListening}
                disabled={!isConnected}
                style={{
                  width: '100%',
                  padding: '16px',
                  borderRadius: '24px',
                  fontWeight: 'bold',
                  fontSize: '14px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  border: 'none',
                  cursor: isConnected ? 'pointer' : 'not-allowed',
                  backgroundColor:
                    appState === 'listening' ? '#EF4444' :
                    appState === 'speaking' ? '#00C853' :
                    appState === 'thinking' ? '#3B82F6' : 'white',
                  color: appState === 'idle' ? 'black' : 'white',
                  boxShadow:
                    appState === 'listening' ? '0 0 20px rgba(239, 68, 68, 0.5)' :
                    appState === 'speaking' ? '0 0 20px rgba(0, 200, 83, 0.5)' : 'none',
                  opacity: isConnected ? 1 : 0.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                {appState === 'listening' && '🎤 Listening...'}
                {appState === 'speaking' && '🔊 Speaking...'}
                {appState === 'thinking' && '🤔 Thinking...'}
                {appState === 'idle' && '🎤 Tap to Talk'}
              </button>

              <p style={{
                textAlign: 'center',
                fontSize: '12px',
                color: '#6B7280',
                margin: 0,
              }}>
                {isConnected ? 'Type or use voice to interact with DART' : 'Connecting to voice service...'}
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}
