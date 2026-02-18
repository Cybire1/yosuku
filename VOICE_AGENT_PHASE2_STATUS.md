# DART Voice Agent - Phase 2 Status (Advanced Trading Assistant)

## 🚀 What's New in Phase 2

### **Complete Voice Agent Upgrade** - Now with Trading Intelligence!

The voice agent has been upgraded from basic market intelligence to a **full-featured AI trading assistant** with advanced portfolio management, personalized recommendations, and bet preparation capabilities.

---

## ✅ Phase 2 Features - FULLY FUNCTIONAL

### 1. **Smart Portfolio Analysis** 🎯
```
User: "Analyze my portfolio"
Bot: ✓ Analyzing your portfolio performance...

     Portfolio Analysis:

     Total Positions: 5
     Active: 3
     Resolved: 2 (1 wins, 1 losses)

     Total Invested: 15.00 ALEO
     Current Value: 18.75 ALEO
     Profit/Loss: +3.75 ALEO
     ROI: +25.0%
     Win Rate: 50%

     🎉 Great job! You're making profits!
```

**What It Does:**
- Calculates ROI (Return on Investment) based on current market odds
- Tracks win/loss ratio on resolved markets
- Shows total profit/loss across all positions
- Provides encouragement and advice based on performance

---

### 2. **Personalized Market Recommendations** 💡
```
User: "Give me recommendations"
Bot: ✓ Analyzing your portfolio for recommendations...

     Smart recommendations based on your portfolio:

     You seem to like Crypto markets! Here are some opportunities:

     1. Ethereum $10k by 2026 (Crypto)
        Current odds: 72% YES, 28% NO
        Volume: 8.2 ALEO
        Suggestion: Consider NO - underdog opportunity

     2. Solana to $500 (Crypto)
        Current odds: 55% YES, 45% NO
        Volume: 4.5 ALEO
        Suggestion: Consider YES - underdog opportunity
```

**How It Works:**
- Analyzes your betting history to identify favorite categories
- Finds high-volume markets you haven't bet on yet
- Suggests underdog positions (contrarian strategy)
- Filters out markets with <1 ALEO volume (low quality)

---

### 3. **Bet Preparation with Full Validation** 🔒
```
User: "Prepare bet 5 ALEO on YES for market 1"
Bot: ✓ Validating bet: 5 ALEO on YES for market 1...
     ✓ Bet validated successfully!

     Ready to place bet:

     Market: Bitcoin $150k by Dec 2026
     Side: YES
     Amount: 5 ALEO
     Current odds: 68% YES
     New odds after bet: 71% YES
     Expected payout if you win: 7.35 ALEO
     Profit if you win: 2.35 ALEO

     Say "confirm" to place this bet, or "cancel" to abort.
```

**Safety Features:**
- ✅ **Balance check** - Verifies you have sufficient available ALEO
- ✅ **Market validation** - Confirms market exists and is still active
- ✅ **End date check** - Prevents bets on expired markets
- ✅ **Resolved check** - Blocks bets on already resolved markets
- ✅ **Odds calculation** - Shows how your bet will affect the odds
- ✅ **Payout preview** - Calculates exact expected return
- ✅ **Profit display** - Shows net profit (payout - bet amount)

**IMPORTANT:**
- `prepareBet` **DOES NOT** execute the bet automatically
- It only validates and shows confirmation
- User must complete the bet via UI (security by design)

---

### 4. **Real-Time Balance Queries** (Phase 1 - Still Working)
```
User: "What's my balance?"
Bot: Your wallet balance:

     Total: 47.50 ALEO
     Staked in markets: 12.00 ALEO
     Available: 35.50 ALEO

     You have 5 active positions.
```

**Data Sources:**
- ✅ **Blockchain API**: Real on-chain balance from Aleo Provable API
- ✅ **localStorage**: Staked amounts calculated from active positions
- ✅ **Calculated**: Available = Total - Staked

---

### 5. **Market Discovery** (Phase 1 - Enhanced)
```
User: "Show trending markets"
Bot: ✓ Getting trending markets...

     Top trending markets:
     1. Bitcoin $150k by Dec 2026 - 68% YES - 12.3 ALEO volume
     2. AI Turing Test 2026 - 52% YES - 8.5 ALEO volume
     3. Messi to Barcelona - 35% YES - 6.2 ALEO volume
```

**Enhanced Features:**
- Sorted by real volume (not just creation date)
- Shows current odds for quick decision-making
- Top 3 results for voice-friendly brevity

---

## 📊 New Voice Commands (Phase 2)

### Portfolio Management
- "Analyze my portfolio" → Full performance analysis with ROI
- "How am I doing?" → Quick portfolio summary
- "Show my stats" → Win rate, total invested, profit/loss

### Smart Recommendations
- "Give me recommendations" → Personalized market suggestions
- "What should I bet on?" → AI-driven opportunities
- "Suggest underdog bets" → Contrarian positions

### Bet Preparation
- "Prepare bet 5 ALEO on YES for market 42" → Full validation
- "Validate bet 2 ALEO on NO for market 1" → Same as above
- "Check if I can bet 10 ALEO on market 5" → Balance + market check

### Market Intelligence (Phase 1 - Still Available)
- "What's trending?" → Top 3 markets by volume
- "Show me crypto markets" → Filtered by category
- "Tell me about market 1" → Detailed market info
- "What's my balance?" → Real blockchain balance

---

## 🔧 Technical Implementation

### New Functions in `/lib/voice/aleoTools.ts`

#### 1. `prepareBet(publicKey, marketId, side, amount)`
**Purpose:** Validate bet parameters and return confirmation data

**Validation Steps:**
1. Check wallet connected
2. Verify amount > 0
3. Fetch real blockchain balance
4. Calculate available balance (total - staked)
5. Ensure sufficient funds
6. Validate market exists
7. Check market not resolved
8. Check market not expired
9. Calculate new odds after bet
10. Calculate expected payout

**Returns:**
```typescript
{
  success: true,
  message: "Ready to place bet:\n\nMarket: ...",
  data: {
    marketId,
    side,
    amount,
    market,
    expectedPayout,
    currentOdds,
    newOdds,
    confirmed: false
  }
}
```

#### 2. `getSmartRecommendations(publicKey)`
**Purpose:** Analyze portfolio and suggest new betting opportunities

**Algorithm:**
1. Load user's positions from localStorage
2. Count bets by category (Crypto, Politics, Sports)
3. Identify favorite category
4. Find active markets user hasn't bet on
5. Filter for volume > 1 ALEO (quality threshold)
6. Sort by volume (highest first)
7. Suggest underdog side if odds > 60%

**Example Output:**
```typescript
{
  success: true,
  message: "Smart recommendations based on your portfolio:\n\n...",
  data: [market1, market2, market3]
}
```

#### 3. `analyzePortfolio(publicKey)`
**Purpose:** Calculate comprehensive portfolio metrics

**Metrics Calculated:**
- **Total Invested**: Sum of all bet amounts (p.shares)
- **Current Value**: For resolved markets, 2x bet if won, 0 if lost. For active markets, current payout based on live odds
- **Profit/Loss**: Total Value - Total Invested
- **ROI**: ((Total Value - Total Invested) / Total Invested) * 100
- **Win Rate**: (Wins / (Wins + Losses)) * 100

**Example Output:**
```typescript
{
  success: true,
  message: "Portfolio Analysis:\n\nTotal Positions: 5\n...",
  data: {
    totalPositions: 5,
    activePositions: 3,
    resolvedPositions: 2,
    winningPositions: 1,
    losingPositions: 1,
    totalInvested: 15.00,
    totalValue: 18.75,
    profitLoss: 3.75,
    roi: 25.0,
    winRate: 50.0
  }
}
```

---

### Updated System Prompts

**New Capabilities Section:**
```
CAPABILITIES - ADVANCED FEATURES (PHASE 2):
- Get personalized recommendations using getSmartRecommendations()
- Analyze portfolio performance using analyzePortfolio()
- Prepare bets with validation using prepareBet(marketId, side, amount)
- Provide market insights and strategy advice
```

**Security Instructions:**
```
SECURITY:
- prepareBet only validates and confirms - it does NOT execute the bet
- Always show full bet details before confirmation
- Tell users they need to complete the bet using the visual interface
- Never execute trades without explicit user confirmation through the UI
```

---

### UI Updates (`/components/VoiceAgent.tsx`)

**New Example Prompts:**
```tsx
<div className="bg-neutral-800 rounded-xl p-3 text-left border border-off-blue/20">
  <p className="text-xs text-off-blue mb-1 uppercase tracking-wider font-bold">Portfolio Analysis</p>
  <p className="text-sm text-gray-300">"Analyze my portfolio performance"</p>
</div>

<div className="bg-neutral-800 rounded-xl p-3 text-left border border-off-green/20">
  <p className="text-xs text-off-green mb-1 uppercase tracking-wider font-bold">Smart Recommendations</p>
  <p className="text-sm text-gray-300">"Give me personalized recommendations"</p>
</div>

<div className="bg-neutral-800 rounded-xl p-3 text-left border border-off-red/20">
  <p className="text-xs text-off-red mb-1 uppercase tracking-wider font-bold">Bet Preparation</p>
  <p className="text-sm text-gray-300">"Prepare bet: 5 ALEO on YES for market 1"</p>
</div>
```

**Color Coding:**
- 🟢 **Mint Green** - Market Discovery
- 🔵 **Blue** - Portfolio Analysis
- 🟢 **Green** - Smart Recommendations
- 🔴 **Red** - Bet Preparation (caution)

---

## 🎯 User Experience Improvements

### Before Phase 2:
❌ "Can I bet on market 1?" → Bot: "I can't help with betting yet"
❌ "What should I bet on?" → Bot: "I don't have recommendations"
❌ "How am I doing?" → Bot: "I can't analyze your performance"

### After Phase 2:
✅ "Can I bet on market 1?" → Bot validates balance, market status, shows confirmation
✅ "What should I bet on?" → Bot analyzes portfolio and suggests 3 personalized markets
✅ "How am I doing?" → Bot shows ROI, win rate, profit/loss with encouragement

---

## 🔐 Security & Limitations

### What Phase 2 CAN Do:
✅ Validate bet parameters (amount, market, balance)
✅ Calculate expected payouts and profit
✅ Show full bet confirmation with odds impact
✅ Analyze portfolio performance metrics
✅ Recommend markets based on user behavior

### What Phase 2 CANNOT Do (By Design):
❌ **Execute bets automatically** - User must complete via UI
❌ **Access private wallet keys** - Only reads public data
❌ **Modify user balances** - Read-only blockchain queries
❌ **Override user decisions** - Recommendations, not mandates

**Why No Auto-Execution?**
- **Security**: Voice commands could be spoofed or misheard
- **Compliance**: Financial transactions require explicit confirmation
- **User Control**: Users should review all bet details visually
- **Error Prevention**: Mishearing "5" as "15" could be costly

---

## 📈 Example User Journey (Full Phase 2 Flow)

### Scenario: New User Exploring Voice Trading

```
1. User opens voice agent
   Bot: "Hi! I'm DART, your AI prediction market assistant. I can help you
        discover markets, analyze your portfolio, get personalized recommendations,
        and prepare bets with full validation. What would you like to know?"

2. User: "What's trending?"
   Bot: ✓ Getting trending markets...
        Top trending markets:
        1. Bitcoin $150k by Dec 2026 - 68% YES - 12.3 ALEO volume
        2. AI Turing Test 2026 - 52% YES - 8.5 ALEO volume
        3. Messi to Barcelona - 35% YES - 6.2 ALEO volume

3. User: "Tell me about market 1"
   Bot: ✓ Getting details for market 1...
        Market 1: Bitcoin $150k by Dec 2026
        Status: Active
        Odds: 68% YES, 32% NO
        Volume: 12.3 ALEO
        Ends: Dec 31, 2026
        If you bet 1 ALEO on YES, you'd win 1.47 ALEO total.
        If you bet 1 ALEO on NO, you'd win 3.13 ALEO total.

4. User: "Prepare bet 5 ALEO on YES for market 1"
   Bot: ✓ Validating bet: 5 ALEO on YES for market 1...
        ✓ Bet validated successfully!

        Ready to place bet:

        Market: Bitcoin $150k by Dec 2026
        Side: YES
        Amount: 5 ALEO
        Current odds: 68% YES
        New odds after bet: 71% YES
        Expected payout if you win: 7.35 ALEO
        Profit if you win: 2.35 ALEO

        To complete this bet, please use the visual interface on the market page.

5. User places bet via UI (not voice)

6. User: "Analyze my portfolio"
   Bot: ✓ Analyzing your portfolio performance...
        Portfolio Analysis:

        Total Positions: 1
        Active: 1
        Resolved: 0

        Total Invested: 5.00 ALEO
        Current Value: 7.35 ALEO (if market closed now)
        Profit/Loss: +2.35 ALEO
        ROI: +47.0%
        Win Rate: N/A (no resolved bets yet)

        📈 You're off to a great start!

7. User: "Give me recommendations"
   Bot: ✓ Analyzing your portfolio for recommendations...
        Smart recommendations based on your portfolio:

        You seem to like Crypto markets! Here are some opportunities:

        1. Ethereum $10k by 2026 (Crypto)
           Current odds: 72% YES, 28% NO
           Volume: 8.2 ALEO
           Suggestion: Consider NO - underdog opportunity

        2. Solana to $500 (Crypto)
           Current odds: 55% YES, 45% NO
           Volume: 4.5 ALEO
           Suggestion: Consider YES - underdog opportunity
```

---

## 🚀 Phase 3 Roadmap (Future)

### Voice-Executed Trading (NOT in Phase 2)
- **Multi-step confirmation** - "Confirm bet" → "Say YES to proceed"
- **Wallet integration** - Direct Leo Wallet adapter calls
- **Transaction signing** - Voice-triggered, UI-confirmed
- **Real-time execution** - Place bet without leaving voice interface

### Advanced Portfolio Features
- **Price alerts** - "Notify me when Bitcoin market hits 75% YES"
- **Stop-loss automation** - Voice-configured risk management
- **Transaction history** - "Show my last 10 bets"
- **Profit tracking** - "How much have I made this month?"

### Social Trading
- **Copy trading** - "Follow top trader's positions"
- **Leaderboard queries** - "Who's the best crypto trader?"
- **Market sentiment** - "What are people betting on today?"

---

## 📊 Data Accuracy (Phase 2)

All Phase 2 features use **100% real data**:

### Portfolio Analysis
- ✅ **Real positions**: localStorage tracks actual bets
- ✅ **Live odds**: Current market share pools
- ✅ **Accurate payouts**: AMM formula for exact calculations
- ✅ **Resolved markets**: Real winning_side from resolution system

### Smart Recommendations
- ✅ **User behavior analysis**: Real betting history
- ✅ **Volume filtering**: Actual market.total_volume
- ✅ **Category detection**: Real market.category data
- ✅ **Odds calculations**: Live share pool ratios

### Bet Preparation
- ✅ **Blockchain balance**: Live Aleo API query
- ✅ **Market validation**: Real market.resolved and end_timestamp
- ✅ **Odds impact**: Accurate AMM calculations
- ✅ **Expected payout**: (newTotalShares / newSideShares) * amount

---

## 🎓 How to Use Phase 2 Features

### Getting Started
1. Click the mint green mic button (bottom right)
2. Wait for "Voice Assistant Online" status
3. Say one of the example commands or type your question

### Best Practices
- **Be specific**: "Prepare bet 5 ALEO on YES for market 1" works better than "I want to bet"
- **Use numbers**: Market IDs make queries faster (market 1, market 42)
- **Ask for help**: "What can you do?" to see all capabilities
- **Check balance first**: "What's my balance?" before preparing bets

### Voice vs Text
- **Voice**: Hands-free, great for quick queries while multitasking
- **Text**: Precise, better for complex bet amounts (e.g., 3.14159 ALEO)
- **Both work identically** - Same functions, same results

---

## 🏆 Phase 2 Success Metrics

### Functionality
- ✅ 8 voice commands (5 Phase 1 + 3 Phase 2)
- ✅ 3 new AI functions (prepareBet, getSmartRecommendations, analyzePortfolio)
- ✅ 100% real data integration
- ✅ Multi-level validation for bet preparation
- ✅ Portfolio analytics with ROI and win rate

### User Experience
- ✅ 6 example prompts color-coded by category
- ✅ Real-time status indicators (listening/speaking/thinking)
- ✅ Dual input modes (voice + text)
- ✅ Personalized recommendations based on betting patterns
- ✅ Encouraging feedback for portfolio performance

### Security
- ✅ Bet validation without execution
- ✅ Balance checks before bet preparation
- ✅ Market status verification (resolved, expired)
- ✅ Read-only blockchain queries
- ✅ No automatic fund transfers

---

**Date:** January 30, 2026
**Version:** Phase 2 - Advanced Trading Assistant
**Status:** Production-Ready ✅
**Next:** Phase 3 - Voice-Executed Trading (Q2 2026)
