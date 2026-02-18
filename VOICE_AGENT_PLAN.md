# Voice Agent Implementation Plan for Dart Prediction Market

**Based on Analysis of:** `/Users/cyber/Downloads/Aleo/move-by-practice/sui-voice-agent`
**Date:** January 30, 2026
**Tech Stack:** Next.js 16.1.5 (Turbopack), Aleo Blockchain, React 19

---

## Executive Summary

This plan outlines how to integrate a voice AI agent into the Dart prediction market platform to maximize user experience, reduce friction in trading, and create a competitive advantage in the prediction market space.

**Key Insight:** Voice AI in financial services is experiencing 37.2% CAGR growth, with trading execution times reduced by 50-75% and 65-75% win rates in automated trading systems.

---

## 1. Vision & Objectives

### Primary Goals
- **Hands-Free Trading:** Users can place bets, check odds, and monitor markets via voice
- **Accessibility:** Make prediction markets accessible to users while multitasking
- **Speed:** Sub-500ms response times for natural conversation flow
- **Trust:** Build confidence through voice confirmations and transparent actions

### User Experience Goals
- Natural conversation (no rigid command structures)
- Real-time market insights delivered via voice
- Secure transaction confirmations
- Multilingual support for global users

---

## 2. Core Features (Priority-Ordered)

### Phase 1: Market Intelligence (Week 1-2)
**Voice Capabilities:**
- "What are the trending markets?"
- "Show me crypto prediction markets"
- "What's the current probability for Bitcoin $150k?"
- "Read me the top 3 markets by volume"

**Technical Implementation:**
```typescript
functionDeclarations: [
  {
    name: 'getActiveMarkets',
    description: 'Get currently active prediction markets filtered by category',
    parameters: {
      category: 'All' | 'Crypto' | 'Politics' | 'Sports'
    }
  },
  {
    name: 'getMarketDetails',
    description: 'Get detailed information about a specific market including odds, volume, end date',
    parameters: {
      marketId: number
    }
  },
  {
    name: 'getTrendingMarkets',
    description: 'Get markets sorted by volume or recent activity'
  }
]
```

### Phase 2: Portfolio Management (Week 3-4)
**Voice Capabilities:**
- "What's my ALEO balance?"
- "Show my active positions"
- "What are my potential winnings?"
- "Have any of my markets resolved?"

**Technical Implementation:**
```typescript
functionDeclarations: [
  {
    name: 'getWalletBalance',
    description: 'Get user ALEO balance and transaction history'
  },
  {
    name: 'getActivePositions',
    description: 'Get all user positions across markets with current values'
  },
  {
    name: 'getClaimableWinnings',
    description: 'Check for resolved markets where user can claim winnings'
  }
]
```

### Phase 3: Trading Actions (Week 5-6)
**Voice Capabilities:**
- "Bet 5 ALEO on YES for market #42"
- "Place 10 ALEO on Bitcoin hitting $150k"
- "Show me the chart before I bet"
- "Confirm my bet"

**Security Protocol:**
```typescript
// CRITICAL: Always require explicit confirmation
const tradingFlow = {
  step1: "User: 'Bet 5 ALEO on YES for Bitcoin market'",
  step2: "Agent: 'I'll bet 5 ALEO on YES (68% odds). You'll receive 7.35 ALEO if YES wins. Confirm?'",
  step3: "User: 'yes' or 'confirm'",
  step4: "Agent: [Executes transaction] 'Done! Transaction confirmed.'",
}
```

### Phase 4: Advanced Intelligence (Week 7-8)
**Voice Capabilities:**
- "What's the sentiment for this market?"
- "Compare odds across similar markets"
- "Alert me when Bitcoin market odds reach 75%"
- "What's my win rate this month?"

---

## 3. Technical Architecture

### Core Components

#### 1. Voice Session Hook (`/lib/hooks/useVoiceSession.ts`)
```typescript
import { GoogleGenAI } from '@google/genai';

export function useVoiceSession({
  apiKey: string,
  aleoWallet: any,
  onMessage: (message: VoiceMessage) => void,
  onBalanceUpdate: (balance: number) => void,
}) {
  // Google Gemini Live API integration
  // Real-time voice streaming
  // Function calling for blockchain interactions
  // State management: idle | listening | thinking | speaking | error
}
```

#### 2. Voice Agent Component (`/components/VoiceAgent.tsx`)
```typescript
'use client';

export default function VoiceAgent() {
  const { publicKey } = useWallet(); // Leo Wallet
  const { appState, startSession, toggleListening, sendTextMessage } = useVoiceSession();

  return (
    <div className="voice-agent-container">
      {/* Visual feedback (listening/speaking animations) */}
      {/* Chat history */}
      {/* Voice/Text input */}
      {/* Transaction confirmations */}
    </div>
  );
}
```

#### 3. Aleo Integration Layer (`/lib/aleo/voiceTools.ts`)
```typescript
export async function placeBetViaVoice({
  marketId: number,
  side: 'YES' | 'NO',
  amount: number,
  publicKey: string,
  requestTransaction: Function
}): Promise<VoiceToolResult> {
  // 1. Validate market exists and is active
  // 2. Check user balance
  // 3. Calculate expected payout
  // 4. Create transaction
  // 5. Request user signature via Leo Wallet
  // 6. Return formatted voice response
}
```

### System Prompt Design

```typescript
const DART_AGENT_PROMPT = `You are DART Voice Agent, a professional prediction market assistant.

IDENTITY:
- Your name is DART (pronounce naturally: "dart")
- You help users trade on prediction markets built on Aleo blockchain
- Be concise, accurate, and proactive

CAPABILITIES:
- Check market odds and details
- Place bets on YES/NO outcomes
- Monitor user portfolio and positions
- Claim winnings from resolved markets
- Provide market analytics and insights

CRITICAL SECURITY RULES:
1. ALWAYS confirm bet details before executing: market, side (YES/NO), amount
2. Read back: "I'll bet [amount] ALEO on [YES/NO] for [market question]. Current odds: [X%]. Expected payout: [Y] ALEO. Confirm?"
3. Wait for explicit confirmation: "yes", "confirm", "go ahead"
4. NEVER execute trades without confirmation
5. Warn if user is risking >50% of balance on single bet

CONVERSATION STYLE:
- Use natural language, avoid jargon
- Proactive: "This market has high volume, would you like to see the analytics?"
- Educational: Explain odds, payouts, and risks clearly
- Transparent: Always show transaction hashes and explorer links

SUPPORTED MARKETS:
- Crypto (Bitcoin, Ethereum, Aleo prices)
- Politics (Elections, policy decisions)
- Sports (Game outcomes, championships)
- Custom user-created markets`;
```

---

## 4. UI/UX Design Patterns

### Visual Design (Based on Sui Voice Agent Analysis)

```typescript
// Position: Floating button (bottom-right) or dedicated page
<motion.button
  className="fixed bottom-8 right-8 w-16 h-16 bg-new-mint rounded-full shadow-2xl"
  whileHover={{ scale: 1.1 }}
  whileTap={{ scale: 0.95 }}
>
  {appState === 'listening' && <WaveformAnimation color="red" />}
  {appState === 'speaking' && <WaveformAnimation color="green" />}
  {appState === 'idle' && <MicrophoneIcon />}
</motion.button>
```

### Voice Agent Modal/Page Layout
```
┌─────────────────────────────────────┐
│  DART Voice Agent        [CLOSE]    │
├─────────────────────────────────────┤
│  🎙️ DART                            │
│  ● Online                           │
├─────────────────────────────────────┤
│  [Chat Messages Area]               │
│                                     │
│  User: Bet 5 ALEO on Bitcoin YES   │
│  Agent: I'll bet 5 ALEO on YES...  │
│         Confirm?                    │
│  User: yes                          │
│  Agent: ✓ Done! Tx: 0x7Jv...       │
│                                     │
├─────────────────────────────────────┤
│  [Type a message...] [Send]        │
│                                     │
│       [🎙️ TAP TO TALK]             │
│   Type or use voice to trade       │
└─────────────────────────────────────┘
```

### Visual Feedback States

1. **Idle:** Pulsing mint green button
2. **Listening:** Red waveform animation + "Listening..." text
3. **Thinking:** Loading spinner + "Processing..."
4. **Speaking:** Green waveform animation + transcribed text
5. **Error:** Red border + error message + retry button

---

## 5. User Journey Examples

### Journey 1: Quick Market Check
```
User: "Hey DART, what's trending?"

Agent: [Executes getTrendingMarkets()]
"The top markets right now are:
1. Bitcoin $150k by Dec 2026 - 68% YES - $3.2M volume
2. AI Turing Test 2026 - 52% YES - $8.5M volume
3. Messi to Barcelona - 35% YES - $4.2M volume

Would you like details on any of these?"

User: "Show me the Bitcoin one"

Agent: [Executes getMarketDetails(id: 1)]
"Bitcoin $150k market ends Dec 31, 2026.
Current odds: 68% YES, 32% NO
Volume: $3.2M traded
If you bet 1 ALEO on YES, you'd win 1.47 ALEO total.
Want to place a bet?"
```

### Journey 2: Placing a Bet
```
User: "Bet 5 ALEO on YES"

Agent: "I'll bet 5 ALEO on YES for Bitcoin $150k.
Current odds: 68% YES
Expected payout: 7.35 ALEO if YES wins
Risk: 5 ALEO
Confirm this bet?"

User: "yes"

Agent: [Creates transaction, requests Leo Wallet signature]
"✓ Signing transaction...
✓ Transaction confirmed!
View on explorer: https://aleo.network/tx/7Jv...
Your position: 5 ALEO on YES"
```

### Journey 3: Portfolio Check
```
User: "What are my active bets?"

Agent: [Executes getActivePositions()]
"You have 3 active positions:
1. Bitcoin $150k - 5 ALEO on YES (68% odds)
2. AI Turing Test - 2 ALEO on NO (48% odds)
3. NBA Finals Lakers - 1 ALEO on YES (42% odds)

Total at risk: 8 ALEO
Potential winnings: 13.2 ALEO

Would you like details on any market?"
```

### Journey 4: Claiming Winnings
```
Agent: [Proactive notification]
"Good news! Your bet on Bitcoin $150k has resolved to YES.
You won!
Original bet: 5 ALEO
Winnings: 7.35 ALEO
Ready to claim?"

User: "claim it"

Agent: [Executes claimWinnings(marketId: 1)]
"✓ Claimed 7.35 ALEO successfully!
New balance: 42.35 ALEO
View transaction: https://aleo.network/tx/..."
```

---

## 6. Implementation Roadmap

### Week 1-2: Foundation
- [ ] Install Google Gemini API dependencies
- [ ] Create `useVoiceSession` hook
- [ ] Build basic VoiceAgent UI component
- [ ] Implement audio streaming (mic input + speaker output)
- [ ] Test voice recognition accuracy

### Week 3-4: Market Intelligence
- [ ] Implement `getActiveMarkets()` function
- [ ] Implement `getMarketDetails()` function
- [ ] Implement `getTrendingMarkets()` function
- [ ] Voice response formatting for market data
- [ ] Test conversation flows

### Week 5-6: Trading Actions
- [ ] Implement `placeBet()` with Aleo integration
- [ ] Add Leo Wallet transaction signing flow
- [ ] Security confirmations and validations
- [ ] Error handling and retry logic
- [ ] Transaction status tracking

### Week 7-8: Portfolio & Advanced
- [ ] Implement `getWalletBalance()`
- [ ] Implement `getActivePositions()`
- [ ] Implement `claimWinnings()`
- [ ] Analytics and insights functions
- [ ] Voice alerts/notifications system

### Week 9-10: Polish & Launch
- [ ] Multi-language support (Spanish, French, Chinese)
- [ ] Accessibility features (screen reader compatibility)
- [ ] Performance optimization (reduce latency <500ms)
- [ ] Security audit
- [ ] User testing with 10+ beta users
- [ ] Documentation and onboarding

---

## 7. Technical Requirements

### Dependencies
```json
{
  "dependencies": {
    "@google/genai": "^0.3.1",
    "framer-motion": "^11.15.0",
    "@demox-labs/aleo-wallet-adapter-react": "latest",
    "@demox-labs/aleo-wallet-adapter-leo": "latest"
  }
}
```

### Environment Variables
```env
NEXT_PUBLIC_GEMINI_API_KEY=your_gemini_api_key_here
```

### Browser Requirements
- Modern browsers with Web Audio API support
- Microphone permissions
- HTTPS (required for microphone access)

---

## 8. Best Practices from Industry Research

### Response Time Optimization
- **Target:** <500ms latency (industry standard for natural conversation)
- **Strategy:** Stream audio chunks, don't wait for complete response
- **Caching:** Cache common market data locally

### Voice Quality
- Use Google Gemini's native audio (24kHz) for natural speech
- Test across different accents and dialects
- Provide text fallback for noisy environments

### Security (Critical for Finance)
- **Always confirm** high-value transactions (>10 ALEO)
- **Read back** bet details before execution
- **Rate limiting:** Max 10 trades per minute per user
- **Session timeout:** 15 minutes of inactivity
- **Audit log:** Record all voice commands and executions

### Error Handling
```typescript
const errorResponses = {
  WALLET_NOT_CONNECTED: "Please connect your Leo wallet first to place bets.",
  INSUFFICIENT_BALANCE: "You don't have enough ALEO. Your balance is {balance} ALEO, but you're trying to bet {amount} ALEO.",
  MARKET_RESOLVED: "This market has already ended and been resolved. Check your winnings if you had a position.",
  TRANSACTION_FAILED: "Transaction failed. Please try again or check your wallet.",
  NETWORK_ERROR: "I'm having trouble connecting. Please check your internet and try again."
}
```

### User Onboarding
1. **First-time users:** "Hi! I'm DART. I can help you trade on prediction markets using just your voice. Try saying: 'What are the trending markets?'"
2. **Guided tutorial:** Interactive voice walkthrough (2 minutes)
3. **Example commands:** Display on screen while voice is active
4. **Help command:** "Say 'help' anytime to hear what I can do"

---

## 9. Competitive Advantages

### Why Voice for Prediction Markets?

1. **Speed:** Voice trading is 50-75% faster than UI clicking (industry data)
2. **Multitasking:** Users can trade while watching events unfold
3. **Accessibility:** Opens markets to users with visual impairments
4. **Mobile-first:** Perfect for on-the-go trading
5. **Natural UX:** Mimics how people discuss predictions naturally

### Unique Features for Dart
- **Event Listening:** "Alert me when Bitcoin market reaches 75% odds"
- **Natural Language:** "I think Bitcoin won't hit 150k" → Auto-converts to NO bet
- **Social Proof:** "What are other traders betting on?"
- **Risk Management:** "Don't let me bet more than 20% of my balance on one market"

---

## 10. Success Metrics

### KPIs to Track

**Adoption:**
- % of users who try voice agent (Target: 40% in month 1)
- % of users who use voice for >5 trades (Target: 25%)
- Average session duration (Target: 8+ minutes)

**Performance:**
- Average response latency (Target: <500ms)
- Voice recognition accuracy (Target: >95%)
- Transaction success rate (Target: >98%)

**Business Impact:**
- Trading volume via voice vs UI (Target: 15% of volume)
- User retention with voice vs without (Target: +30%)
- Customer satisfaction score (Target: 4.5/5)

### A/B Testing Ideas
- Voice-only onboarding vs traditional
- Different agent personalities (professional vs casual)
- Proactive suggestions vs reactive only
- Voice confirmations vs text confirmations

---

## 11. Risk Mitigation

### Technical Risks
- **Risk:** API rate limits from Gemini
  - **Mitigation:** Implement connection pooling, fallback to text-only mode

- **Risk:** Voice recognition errors in noisy environments
  - **Mitigation:** Always show text transcription, allow text corrections

- **Risk:** Blockchain transaction failures
  - **Mitigation:** Retry logic, clear error messages, gas estimation

### Security Risks
- **Risk:** Voice spoofing/deepfakes
  - **Mitigation:** Require wallet signature for all transactions

- **Risk:** Accidental trades from ambient speech
  - **Mitigation:** Explicit confirmation required, "DART" wake word

### UX Risks
- **Risk:** Users frustrated by voice errors
  - **Mitigation:** Seamless fallback to text/UI, "I didn't catch that, can you type it?"

---

## 12. Cost Analysis

### Google Gemini API Costs (Estimated)
- **Voice input:** $0.000125 per second (~$0.0075/minute)
- **Voice output:** $0.0002 per second (~$0.012/minute)
- **Average conversation:** 3 minutes = ~$0.06 per session
- **1000 users/day @ 2 sessions:** ~$120/day = $3,600/month

### Cost Optimization Strategies
- Cache frequent queries (market lists, balances)
- Batch API calls when possible
- Use text-to-speech only when needed (silent mode option)
- Free tier for basic queries, premium for advanced features

---

## 13. Future Enhancements (Post-Launch)

### Phase 2 Features
- **Multi-language support:** Spanish, French, Mandarin
- **Voice analytics:** Sentiment analysis of user confidence
- **Social trading:** "What is @elonmusk betting on?"
- **AI insights:** "Should I bet on this market?" (ML predictions)
- **Voice-to-voice:** Call DART like a phone assistant

### Advanced Integrations
- **Telegram/Discord bots:** Voice trading in chat
- **Smart speakers:** Alexa/Google Home integration
- **Mobile apps:** Native iOS/Android with always-on listening
- **Wearables:** Apple Watch voice commands

---

## 14. Implementation Checklist

### Pre-Development
- [ ] Obtain Google Gemini API key
- [ ] Set up development environment with HTTPS
- [ ] Create voice testing protocol
- [ ] Design conversation flows
- [ ] Get user feedback on concept (5+ potential users)

### Development (10 weeks)
- [ ] Week 1-2: Core voice infrastructure
- [ ] Week 3-4: Market intelligence features
- [ ] Week 5-6: Trading actions + security
- [ ] Week 7-8: Portfolio management
- [ ] Week 9-10: Polish, testing, launch

### Pre-Launch
- [ ] Security audit by third party
- [ ] Load testing (100+ concurrent users)
- [ ] Beta testing with 20+ users
- [ ] Documentation complete
- [ ] Marketing materials ready

### Post-Launch (First Month)
- [ ] Monitor metrics daily
- [ ] Collect user feedback
- [ ] Fix critical bugs within 24 hours
- [ ] Weekly feature iterations
- [ ] Prepare Phase 2 roadmap

---

## 15. Conclusion

Adding a voice agent to Dart prediction markets positions the platform at the cutting edge of Web3 UX. With voice AI in finance growing at 37.2% CAGR and reducing trading friction by 50-75%, this feature could:

1. **Increase user engagement** by making trading accessible anywhere
2. **Reduce bounce rate** through natural, conversational onboarding
3. **Drive volume** via faster, hands-free betting
4. **Create competitive moat** as first prediction market with native voice

**Next Steps:**
1. Get Gemini API key and start Week 1 development
2. Build MVP voice agent (Weeks 1-6)
3. Beta test with 20 users (Week 7-8)
4. Launch to production (Week 10)

**Recommended Start:** Begin with Phase 1 (Market Intelligence) as a low-risk, high-value proof of concept. This allows users to explore markets via voice without financial risk, building trust before enabling trading actions.

---

**Reference Implementation:** `/Users/cyber/Downloads/Aleo/move-by-practice/sui-voice-agent`
**Documentation:** This plan is based on production voice agent code for Sui blockchain with similar architecture patterns
