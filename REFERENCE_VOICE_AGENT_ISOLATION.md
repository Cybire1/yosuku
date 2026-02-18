# Reference Voice Agent - Isolated Architecture Analysis

## Project: `/Users/cyber/Downloads/Aleo/move-by-practice/sui-voice-agent`

This document analyzes the **isolated, reusable voice agent components** from the reference Sui blockchain project for potential adoption in DART (Aleo prediction markets).

---

## 🏗️ Architecture Overview

### **Layout Pattern: Full-Screen Split View (NOT Floating Modal)**

```
┌─────────────────────────────────────────────┐
│  Navigation (Top Bar)                        │
│  ┌─────────┐                                │
│  │  Logo   │          [Connect Wallet]      │
│  └─────────┘                                │
├───────────────┬─────────────────────────────┤
│               │                             │
│  LEFT         │  RIGHT                      │
│  SIDEBAR      │  VOICE CHAT INTERFACE       │
│  (300px)      │  (Flexible width)           │
│               │                             │
│  ┌─────────┐ │  ┌──────────────────────┐   │
│  │ Wallet  │ │  │  Chat Header         │   │
│  │ Card    │ │  │  - Avatar            │   │
│  └─────────┘ │  │  - Status            │   │
│               │  │  - Wave visualizer   │   │
│  ┌─────────┐ │  └──────────────────────┘   │
│  │ Agent   │ │                             │
│  │ Status  │ │  ┌──────────────────────┐   │
│  └─────────┘ │  │                      │   │
│               │  │  Message Area        │   │
│  ┌─────────┐ │  │  (Scrollable)        │   │
│  │Features │ │  │                      │   │
│  └─────────┘ │  └──────────────────────┘   │
│               │                             │
│               │  ┌──────────────────────┐   │
│               │  │  Input Controls      │   │
│               │  │  - Text input        │   │
│               │  │  - Voice button      │   │
│               │  └──────────────────────┘   │
└───────────────┴─────────────────────────────┘
```

---

## 🎯 Core Isolatable Components

### **1. Voice Session Hook (`useLiveSession.ts`)**

**Purpose:** Manages Google Gemini Live API session with full blockchain integration

**Key Features:**
- Same audio pipeline as our implementation (ScriptProcessorNode)
- Function calling for blockchain operations
- Stable callbacks with `useCallback`
- Refs prevent duplicate sessions (`hasStartedSessionRef`)
- Auto-reconnect microphone after AI speaks
- Cross-chain support (Sui, Ethereum, Solana via dWallet)

**Critical Code Patterns:**

```typescript
// Session initialization guard
const isInitializingRef = useRef(false);
if (sessionPromiseRef.current || isInitializingRef.current) {
  console.log('[Live] Session already exists or initializing');
  return;
}
isInitializingRef.current = true;

// Microphone restart after AI speaks
if (wasListeningBeforeSpeaking.current && microphoneStreamRef.current) {
  console.log('[Live] AI finished - restarting microphone');
  wasListeningBeforeSpeaking.current = false;
  // Reconnect scriptProcessor...
}

// Dependency array WITHOUT appState (prevents infinite loop)
}, [apiKey, walletAddress, onMessage, onBalanceUpdate, delegatorExecute]);
```

**What They Got Right:**
✅ Prevents duplicate sessions with `isInitializingRef`
✅ Auto-restarts microphone after AI speaks (prevents feedback loop)
✅ Stable dependencies (no `appState` in `startSession`)
✅ Proper cleanup on unmount

---

### **2. Main Page Component (`page.tsx`)**

**Purpose:** Full-screen split layout with integrated voice interface

**Key Features:**
- **Left Sidebar (300px):**
  - Wallet balance display
  - Agent status card
  - Token balances (collapsible)
  - Features list

- **Right Panel (flexible):**
  - Chat header with avatar + status
  - Message area (scrollable)
  - Wave visualizer for listening/speaking states
  - Text input + voice button

**State Management:**
```typescript
const [messages, setMessages] = useState<LiveMessage[]>([]);
const hasStartedSessionRef = useRef(false);
const messagesEndRef = useRef<HTMLDivElement>(null);

// Stable callbacks
const handleMessage = useCallback((message: LiveMessage) => {
  setMessages((prev) => [...prev, message]);
}, []);

const handleBalanceUpdate = useCallback((newBalance: number) => {
  setBalance(newBalance);
}, []);

// Auto-scroll
useEffect(() => {
  messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
}, [messages]);
```

**Auto-Start Session Pattern:**
```typescript
// Start session when delegator wallet funded
useEffect(() => {
  if (delegatorWallet.delegatorBalance > BigInt(0) &&
      !isConnected &&
      !hasStartedSessionRef.current) {
    console.log('[App] Delegator funded, starting session...');
    hasStartedSessionRef.current = true;
    startSession();
  }
}, [delegatorWallet.delegatorBalance, isConnected, startSession]);
```

---

### **3. Wave Visualizer (CSS Animations)**

**Purpose:** Visual feedback for listening/speaking states

**HTML Structure:**
```tsx
{appState === 'listening' && (
  <div className="flex items-center gap-2">
    <span className="text-sm font-medium text-black mr-2 animate-pulse">
      Listening...
    </span>
    <div className="flex items-center gap-1.5 h-12">
      <div className="w-2 bg-red-500 rounded-full wave-bar" style={{height: '60%'}}></div>
      <div className="w-2 bg-red-500 rounded-full wave-bar" style={{height: '40%'}}></div>
      <div className="w-2 bg-red-500 rounded-full wave-bar" style={{height: '80%'}}></div>
      <div className="w-2 bg-red-500 rounded-full wave-bar" style={{height: '50%'}}></div>
      <div className="w-2 bg-red-500 rounded-full wave-bar" style={{height: '70%'}}></div>
    </div>
  </div>
)}
```

**CSS Animation:**
```css
@keyframes wave {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(1.5); }
}

.wave-bar {
  animation: wave 1s ease-in-out infinite;
}

.wave-bar:nth-child(2) { animation-delay: 0.1s; }
.wave-bar:nth-child(3) { animation-delay: 0.2s; }
.wave-bar:nth-child(4) { animation-delay: 0.3s; }
.wave-bar:nth-child(5) { animation-delay: 0.4s; }
```

**Color Coding:**
- **Red bars:** Listening (microphone active)
- **Green bars:** Speaking (AI responding)

---

### **4. Pulse Ring Animation (Avatar/Button)**

**Purpose:** Visual indicator when agent is active

**CSS:**
```css
@keyframes pulse-ring {
  0% {
    box-shadow: 0 0 0 0 rgba(0, 0, 0, 0.4);
  }
  70% {
    box-shadow: 0 0 0 10px rgba(0, 0, 0, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(0, 0, 0, 0);
  }
}

.pulse-ring {
  animation: pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
```

**Usage:**
```tsx
<div className="relative">
  <img src="/sasha.jpg" alt="SASHA" className="w-12 h-12 rounded-full" />
  {(appState === 'listening' || appState === 'speaking') && (
    <div className="absolute inset-0 rounded-full pulse-ring"></div>
  )}
</div>
```

---

### **5. Message Rendering with Function Call Detection**

**Purpose:** Differentiate between AI responses and function execution logs

**Code:**
```tsx
const isFunctionCall = msg.text.includes('Function call:') ||
                      msg.text.includes('✓') ||
                      msg.text.includes('Executing:') ||
                      msg.text.includes('Success:');

<div className={`px-5 py-3 rounded-2xl ${
  msg.sender === 'user'
    ? 'bg-black text-white rounded-br-sm'
    : isFunctionCall
    ? 'bg-white text-black rounded-bl-sm border border-black/10'
    : 'bg-black/5 text-black rounded-bl-sm'
}`}>
```

**Message Types:**
1. **User messages:** Black background, white text
2. **AI responses:** Light gray background
3. **Function calls:** White background with border (highlighted)

---

### **6. Chart Embedding System**

**Purpose:** Embed live token price charts in chat messages

**Format:** `[CHART:poolAddress:tokenName:network]`

**Detection:**
```typescript
const chartMatch = msg.text.match(/\[CHART:([^:]+):([^:]+):?([^\]]*)\]/);
const isChart = !!chartMatch;
const chartPoolAddress = chartMatch ? chartMatch[1] : null;
const chartTokenName = chartMatch ? chartMatch[2] : null;
const chartNetwork = chartMatch && chartMatch[3] ? chartMatch[3] : 'sui';
```

**Rendering:**
```tsx
{isChart && chartPoolAddress && chartTokenName ? (
  <TokenChart
    poolAddress={chartPoolAddress}
    tokenName={chartTokenName}
    network={chartNetwork as 'sui' | 'solana'}
  />
) : (
  <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
)}
```

---

### **7. Gradient Input Area (Depth Effect)**

**Purpose:** Visual separation for input controls

**Code:**
```tsx
<div className="border-t border-black/5 p-6 pb-10 bg-gradient-to-t from-black/5 to-transparent">
  {/* Text Input */}
  <form onSubmit={handleSendText} className="mb-4">
    <input type="text" ... />
  </form>

  {/* Voice Button */}
  <button onClick={toggleListening} ...>
    {appState === 'listening' ? 'Listening...' : 'Tap to Talk'}
  </button>
</div>
```

---

### **8. Custom Font Integration**

**Purpose:** Unique brand identity with Google Fonts

**Fonts:**
- **Share Tech:** Sans-serif tech font (used throughout UI)
- **Great Vibes:** Cursive script font (logo only)

**Implementation:**
```tsx
<style jsx global>{`
  @import url('https://fonts.googleapis.com/css2?family=Great+Vibes&family=Share+Tech&display=swap');

  .share-tech-regular {
    font-family: "Share Tech", sans-serif;
    font-weight: 400;
    font-style: normal;
  }

  .great-vibes-regular {
    font-family: "Great Vibes", cursive;
    font-weight: 400;
    font-style: normal;
  }
`}</style>

<div className="min-h-screen share-tech-regular">
  <Link href="/landing" className="flex items-center">
    <img src="/.changeset/logo.png" alt="SASHA Logo" />
    <span className="text-5xl text-black great-vibes-regular">Sasha.</span>
  </Link>
</div>
```

---

## 📊 Comparison: Reference vs DART Implementation

| Feature | Reference (Sui) | DART (Aleo) |
|---------|----------------|-------------|
| **Layout** | Full-screen split | Floating modal |
| **Primary Use Case** | Voice-first interface | Auxiliary voice assistant |
| **Visual Feedback** | Wave visualizer + pulse ring | Color-coded button states |
| **Fonts** | Custom (Share Tech, Great Vibes) | Default (Outfit, Space Grotesk) |
| **Message Styling** | Rounded bubbles with borders | Rounded bubbles (no borders) |
| **Function Call Detection** | `✓`, `Executing:`, `Success:` | `✓`, `Success:` |
| **Chart Embedding** | ✅ Token charts (Sui/Solana) | ❌ Not implemented |
| **Background Image** | ✅ Custom background | ❌ Solid colors |
| **Gradient Effects** | ✅ Input area gradients | ❌ No gradients |
| **Auto-Start Session** | ✅ When wallet funded | ❌ Manual start |
| **Balance Polling** | ✅ 15s interval (staggered) | ✅ Real-time via API |
| **Token Balances** | ✅ Collapsible list | ❌ Not shown in modal |
| **Cross-Chain Support** | ✅ Sui, Ethereum, Solana | ❌ Aleo only |
| **Advanced Features** | Token swaps, SuiNS, dWallets | Portfolio analysis, recommendations |

---

## 🎨 Adoptable Design Patterns for DART

### **1. Wave Visualizer (Easy Win - 5 min)**

**Recommendation:** Add to `SimpleVoiceButton` modal header

```tsx
{/* In SimpleVoiceButton modal header, replace mic icon with wave visualizer */}
{appState === 'listening' && (
  <div className="flex items-center gap-1.5 h-12">
    <div className="w-2 bg-red-500 rounded-full wave-bar" style={{height: '60%'}}></div>
    <div className="w-2 bg-red-500 rounded-full wave-bar" style={{height: '40%'}}></div>
    <div className="w-2 bg-red-500 rounded-full wave-bar" style={{height: '80%'}}></div>
    <div className="w-2 bg-red-500 rounded-full wave-bar" style={{height: '50%'}}></div>
    <div className="w-2 bg-red-500 rounded-full wave-bar" style={{height: '70%'}}></div>
  </div>
)}
```

**Impact:** Better visual feedback, more engaging UX

---

### **2. Pulse Ring on Floating Button (Easy Win - 3 min)**

**Recommendation:** Add to `SimpleVoiceButton` floating button

```tsx
<button style={{ position: 'fixed', ... }}>
  {appState === 'listening' && (
    <div style={{
      position: 'absolute',
      inset: 0,
      borderRadius: '50%',
      boxShadow: '0 0 0 0 rgba(0, 255, 163, 0.7)',
      animation: 'pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
    }} />
  )}
  🎤
</button>
```

**Impact:** Clear visual indicator when listening (accessibility improvement)

---

### **3. Gradient Input Area (Easy Win - 2 min)**

**Recommendation:** Add to `SimpleVoiceButton` input container

```tsx
<div style={{
  padding: '24px',
  borderTop: '1px solid rgba(255, 255, 255, 0.1)',
  background: 'linear-gradient(to top, rgba(0, 0, 0, 0.05), transparent)'
}}>
  {/* Input controls */}
</div>
```

**Impact:** Subtle depth effect, professional polish

---

### **4. Function Call Detection (Already Implemented ✅)**

Both implementations use similar patterns:
```typescript
const isFunctionCall = msg.text.includes('✓') || msg.text.includes('Success:');
```

**DART Enhancement:** Could add border styling like reference project:
```tsx
border: isFunctionCall ? '1px solid rgba(0, 255, 163, 0.3)' : 'none'
```

---

### **5. Auto-Start Session (Optional Enhancement)**

**Reference Pattern:**
```typescript
useEffect(() => {
  if (walletConnected && !isConnected && !hasStartedSessionRef.current) {
    hasStartedSessionRef.current = true;
    startSession();
  }
}, [walletConnected, isConnected, startSession]);
```

**DART Adoption:** Could auto-start when user connects wallet (more proactive UX)

---

## 🚫 What NOT to Adopt from Reference

### **1. Full-Screen Layout**
- **Why:** DART is a prediction market browser, not a voice-first app
- **Better:** Keep floating modal for non-intrusive access

### **2. Delegator Wallet System**
- **What it is:** Temporary wallet funded by user for gas-free transactions
- **Why not:** Aleo uses private records; users control their own wallets

### **3. Chart Embedding**
- **What it is:** Live token price charts in chat messages
- **Why not:** DART focuses on prediction markets, not token trading (different use case)

### **4. Cross-Chain dWallets**
- **What it is:** Multi-chain wallet creation (Ethereum, Solana, Bitcoin)
- **Why not:** Aleo-only ecosystem, different account model

### **5. Custom Background Image**
- **Why not:** DART has clean dark theme; background would be distracting

---

## 🔧 Technical Insights to Apply

### **1. Session Stability**
```typescript
// Prevent duplicate sessions
const isInitializingRef = useRef(false);
if (sessionPromiseRef.current || isInitializingRef.current) return;
isInitializingRef.current = true;
```

**Status in DART:** ✅ Already implemented in our `useVoiceSession` hook

---

### **2. Microphone Auto-Reconnect**
```typescript
// After AI speaks, reconnect microphone
if (wasListeningBeforeSpeaking.current && microphoneStreamRef.current) {
  wasListeningBeforeSpeaking.current = false;
  // Recreate scriptProcessor...
}
```

**Status in DART:** ✅ Already implemented with `wasListeningBeforeSpeaking` ref

---

### **3. Stable Callbacks**
```typescript
const handleMessage = useCallback((message: VoiceMessage) => {
  setMessages((prev) => [...prev, message]);
}, []);
```

**Status in DART:** ✅ Already using `useCallback` for `handleMessage`

---

### **4. Rate Limiting API Calls**
```typescript
// Add delay between token balance requests
await new Promise(resolve => setTimeout(resolve, 100));
```

**Status in DART:** ❌ Not needed (localStorage-based data, no RPC polling)

---

## 📈 Performance Optimizations They Use

1. **Staggered polling intervals:**
   - Balance: 15s
   - Token balances: 45s
   - Delegator balance: 30s

2. **Loading states for async data:**
   ```typescript
   { loading: true, balance: 0 }
   ```

3. **Auto-scroll with smooth behavior:**
   ```typescript
   messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
   ```

4. **Prevent re-renders with useCallback:**
   All event handlers wrapped in `useCallback`

---

## 🎯 Recommended Action Items for DART

### **Priority 1: Visual Enhancements (10 min total)**
1. ✅ Add wave visualizer to modal header (5 min)
2. ✅ Add pulse ring to floating button (3 min)
3. ✅ Add gradient to input area (2 min)

### **Priority 2: UX Improvements (Optional)**
1. ⚠️ Auto-start session when wallet connected (if desired)
2. ⚠️ Add "typing..." animation with dots (already have text, add animation)
3. ⚠️ Add estimated response time indicator

### **Priority 3: Advanced Features (Future)**
1. ❌ Market trend charts (not token charts, but market volume/odds over time)
2. ❌ Voice command shortcuts (e.g., "/balance" auto-types)
3. ❌ Message history persistence (localStorage)
4. ❌ Quick action buttons (pre-fill bet amounts like "1 ALEO", "5 ALEO")

---

## ✅ Final Assessment

### **What DART Has That Reference Doesn't:**
✅ **Portfolio analysis** with ROI calculation
✅ **Smart recommendations** based on betting patterns
✅ **Bet preparation** with multi-level validation
✅ **Floating modal** design (more flexible than full-screen)
✅ **Color-coded example prompts** (categorized by feature)

### **What Reference Has That DART Could Use:**
🎨 **Wave visualizer** (easy to add)
🎨 **Pulse ring animation** (easy to add)
🎨 **Gradient input area** (easy to add)
⚠️ **Auto-start session** (optional enhancement)
⚠️ **Chart embedding** (different use case, but concept is reusable)

### **Overall Conclusion:**
DART's voice agent is **feature-superior** (Phase 2 vs Phase 1) and **more flexible** (floating vs full-screen). The reference project has **better visual polish** in a few areas, which can be added in **10-15 minutes** if desired.

---

**Date:** January 30, 2026
**Status:** Analysis Complete
**Priority:** Visual enhancements are nice-to-have, not blockers
