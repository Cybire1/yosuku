# AleoMarket System Logic - Complete Explanation

## Overview
AleoMarket is a **decentralized prediction market** on Aleo blockchain where users can:
1. Create binary YES/NO prediction markets
2. Buy shares on either side (YES or NO)
3. Win 2x payout if their side wins
4. Trade positions (future feature)

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js)                    │
│  - Create markets UI                                     │
│  - Place bets UI                                         │
│  - Display markets (localStorage + blockchain)           │
│  - Wallet connection (Leo Wallet)                        │
└─────────────────┬───────────────────────────────────────┘
                  │
                  │ Transaction calls
                  ▼
┌─────────────────────────────────────────────────────────┐
│           ALEO BLOCKCHAIN (predictionmarket_v2.aleo)    │
│                                                          │
│  PRIVATE DATA (Records):                                │
│  - Position records (who owns what)                     │
│  - Market records (market metadata)                     │
│  - Credits records (payouts)                            │
│                                                          │
│  PUBLIC DATA (Mappings):                                │
│  - total_yes_shares: market_id => total YES shares      │
│  - total_no_shares: market_id => total NO shares        │
│  - user_positions: user_hash => total shares            │
│  - market_exists: market_id => true/false               │
└─────────────────────────────────────────────────────────┘
```

---

## 📝 Step-by-Step: What Happens When You Create a Market

### Frontend (create/page.tsx):
```typescript
1. User enters question: "Will Bitcoin hit $200k by 2027?"
2. User selects end date: 2027-01-01
3. Click "Create Market"
```

### Transaction Construction:
```typescript
4. Generate market_id from timestamp: 1769550780
5. Hash question to field: "101286field" (simplified hash)
6. Build transaction object:
   {
     address: "aleo1xxx...",           // Your wallet
     chainId: "testnetbeta",            // Network
     transitions: [{
       program: "predictionmarket_v2.aleo",
       functionName: "create_market_public",
       inputs: ["1769550780u64", "101286field"]
     }],
     fee: 2000000,                      // 2 ALEO
     feePrivate: false
   }
```

### Smart Contract Execution (main.leo lines 117-137):
```leo
7. create_market_public() is called
8. Creates Market record (PRIVATE):
   {
     owner: your_address,
     market_id: 1769550780,
     question_hash: 101286field,
     resolved: false,
     outcome: false
   }
9. Returns this record to YOU (stored in your wallet)

10. Calls finalize_create_market_public():
    - Sets market_exists[1769550780] = true (PUBLIC)
    - Sets total_yes_shares[1769550780] = 0 (PUBLIC)
    - Sets total_no_shares[1769550780] = 0 (PUBLIC)
```

### After Transaction:
```
11. Frontend saves market metadata to localStorage:
    {
      id: 1769550780,
      question: "Will Bitcoin hit $200k by 2027?",
      end_timestamp: 1735689600,
      total_yes_shares: 0,
      total_no_shares: 0,
      total_volume: 0,
      resolved: false,
      creator: "aleo1xxx..."
    }

12. User redirected to homepage showing their new market
```

---

## 🎯 Step-by-Step: What Happens When You Place a Bet

### Frontend (BetModal.tsx):
```typescript
1. User clicks "Bet YES" on a market
2. Enters amount: 5 ALEO
3. Chooses mode: Public (visible) or Private (anonymous)
4. Click "Bet YES"
```

### Transaction Construction:
```typescript
5. Convert amount to microcredits: 5 * 1,000,000 = 5,000,000
6. Build inputs:
   [
     "1769550780u64",    // market_id
     "true",             // side (YES)
     "5000000u64"        // amount
   ]
7. Build transaction (same structure as before)
   Function: "buy_shares_public" or "buy_shares_private"
   Fee: 1 ALEO
```

### Smart Contract Execution - PUBLIC MODE (lines 59-100):

```leo
8. buy_shares_public() is called

9. Calculate shares (simplified 1:1):
   shares = amount = 5,000,000

10. Create Position record (PRIVATE - only you can see):
    {
      owner: your_address,
      market_id: 1769550780,
      side: true,              // YES
      shares: 5000000
    }

11. Return position to your wallet

12. Call finalize_buy_shares_public():
    a. If side == YES:
       - Get current total_yes_shares[1769550780] = 0
       - Set total_yes_shares[1769550780] = 0 + 5,000,000 = 5,000,000

    b. If side == NO:
       - Get current total_no_shares[1769550780] = 0
       - Set total_no_shares[1769550780] = 0 + 5,000,000 = 5,000,000

    c. Hash your address and update user_positions:
       - position_key = hash(your_address)
       - user_positions[position_key] = 5,000,000
```

### After Transaction:
```
13. Position record stored in YOUR WALLET (private)
14. Public mappings updated (visible to everyone):
    - total_yes_shares[market_id] increased
    - Market odds change based on ratio
```

---

## 🔐 Privacy Model: Public vs Private Mode

### PRIVATE MODE (`buy_shares_private`):
```
✅ Position record created (private to you)
❌ NO public mappings updated
❌ Nobody knows you bet
❌ Nobody knows how much you bet
✅ Complete anonymity via zero-knowledge proofs

Current Implementation: Basic (lines 41-56)
```

### PUBLIC MODE (`buy_shares_public`):
```
✅ Position record created (private to you)
✅ Public mappings updated (everyone can see totals)
✅ Shows on leaderboard
✅ Market odds visible
✅ Total volume visible
⚠️ Your individual position still private

Current Implementation: Full (lines 59-100)
```

---

## 💰 Economics & Payouts

### Pricing Model (Current - Simplified):
```
1 ALEO = 1 share (1:1 ratio)
No AMM pricing yet (planned for future)
```

### Example Market Lifecycle:

```
MARKET: "Will Bitcoin hit $200k by 2027?"

DAY 1 - Market Created:
├── total_yes_shares: 0
├── total_no_shares: 0
└── Odds: 50/50

DAY 2 - Alice bets 10 ALEO on YES:
├── total_yes_shares: 10,000,000
├── total_no_shares: 0
├── Odds: 100% YES / 0% NO
└── Alice's Position record: {side: YES, shares: 10,000,000}

DAY 3 - Bob bets 5 ALEO on NO:
├── total_yes_shares: 10,000,000
├── total_no_shares: 5,000,000
├── Odds: 67% YES / 33% NO
├── Alice's Position: {side: YES, shares: 10,000,000}
└── Bob's Position: {side: NO, shares: 5,000,000}

DAY 4 - Charlie bets 10 ALEO on NO:
├── total_yes_shares: 10,000,000
├── total_no_shares: 15,000,000
├── Odds: 40% YES / 60% NO
├── Alice's Position: {side: YES, shares: 10,000,000}
├── Bob's Position: {side: NO, shares: 5,000,000}
└── Charlie's Position: {side: NO, shares: 10,000,000}

2027-01-01 - Market Resolves: Bitcoin = $250k (YES wins!)
```

### Claiming Winnings (lines 158-178):

```leo
Alice calls claim():
├── Input: Her Position record + Resolved Market record
├── Verify market.resolved == true ✅
├── Verify position.market_id == market.market_id ✅
├── Verify position.side == market.outcome (YES == YES) ✅
├── Calculate payout: 10,000,000 * 2 = 20,000,000 microcredits
└── Return Credits record: {owner: Alice, amount: 20,000,000}

Alice receives: 20 ALEO (2x her bet!)

Bob calls claim():
├── Verify position.side == market.outcome (NO != YES) ❌
└── TRANSACTION FAILS - Wrong side!

Bob loses his 5 ALEO bet 💸

Charlie calls claim():
├── Verify position.side == market.outcome (NO != YES) ❌
└── TRANSACTION FAILS - Wrong side!

Charlie loses his 10 ALEO bet 💸
```

---

## 🔄 Data Flow Diagram

```
┌──────────────┐
│     USER     │
└──────┬───────┘
       │
       │ 1. Create Market
       ▼
┌──────────────────┐      2. Transaction      ┌─────────────────┐
│    FRONTEND      │ ───────────────────────> │   BLOCKCHAIN    │
│  (Next.js)       │                           │   (Aleo)        │
│                  │ <─────────────────────── │                 │
│  - localStorage  │      3. Market Record     │ - Records       │
│  - State         │                           │ - Mappings      │
└──────┬───────────┘                           └─────────────────┘
       │
       │ 4. Display Markets
       ▼
┌──────────────────┐
│   USER WALLET    │
│                  │
│ - Position       │
│   records        │
│ - Market         │
│   records        │
│ - Credits        │
│   records        │
└──────────────────┘
```

---

## 📊 Data Storage

### BLOCKCHAIN (Permanent, Immutable):
```
PUBLIC MAPPINGS (Everyone can read):
├── market_exists[market_id] => true/false
├── total_yes_shares[market_id] => 10000000
├── total_no_shares[market_id] => 5000000
└── user_positions[user_hash] => 15000000

PRIVATE RECORDS (Only owner can see):
├── Position {owner, market_id, side, shares}
├── Market {owner, market_id, question_hash, resolved, outcome}
└── Credits {owner, amount}
```

### LOCALSTORAGE (Temporary, Browser):
```json
{
  "aleomarkets": [
    {
      "id": 1769550780,
      "question": "Will Bitcoin hit $200k?",
      "end_timestamp": 1735689600,
      "total_yes_shares": 10000000,
      "total_no_shares": 5000000,
      "total_volume": 15000000,
      "resolved": false,
      "creator": "aleo1xxx..."
    }
  ]
}
```

**Why localStorage?**
- Quick display of market metadata (question text, end date)
- Blockchain only stores question_hash (not full text)
- Future: Replace with indexer service reading blockchain events

---

## 🎮 Complete User Journey

### Journey 1: Market Creator
```
1. Connect Leo Wallet
2. Click "Create" button
3. Enter question + end date
4. Pay 2 ALEO fee
5. Transaction confirmed ✅
6. Market appears on homepage
7. Others can now bet on your market
8. You resolve market when time comes
9. Winners claim 2x payouts
```

### Journey 2: Bettor
```
1. Connect Leo Wallet
2. Browse markets on homepage
3. Click market card
4. Choose YES or NO
5. Enter amount (e.g., 5 ALEO)
6. Choose Public/Private mode
7. Click "Bet YES/NO"
8. Pay 1 ALEO fee
9. Transaction confirmed ✅
10. Position record in wallet
11. Wait for market resolution
12. If you win: Call claim() for 2x payout
13. If you lose: Funds are gone
```

---

## 🚀 Future Enhancements

### Currently Missing:
1. **Indexer Service**:
   - Real-time blockchain data reading
   - Replace localStorage with API
   - Show all on-chain markets

2. **AMM Pricing**:
   - Dynamic odds based on liquidity
   - Not 1:1 pricing
   - Better price discovery

3. **Market Resolution**:
   - Frontend UI to resolve markets
   - Oracle integration for automatic resolution

4. **Leaderboard**:
   - Top traders
   - Total volume
   - Win rates

5. **Position Trading**:
   - Sell positions before resolution
   - Secondary market

---

## 🔐 Security Features

### Zero-Knowledge Proofs (Aleo):
```
✅ Position records are private (only owner knows)
✅ Transaction details encrypted
✅ Optional full anonymity (private mode)
✅ Provable ownership without revealing data
```

### Smart Contract Guarantees:
```
✅ Only market creator can resolve
✅ Only winners can claim
✅ 2x payout enforced by code
✅ No admin can steal funds
✅ Immutable after deployment
```

---

## 💡 Key Takeaways

**When you create a market:**
- 2 ALEO fee to blockchain
- Market record stored in your wallet (private)
- Public mappings track total shares
- Question stored in localStorage (temp)

**When you place a bet:**
- 1 ALEO fee to blockchain
- Position record stored in your wallet (private)
- Public mappings updated (if public mode)
- You own proof of your bet

**When market resolves:**
- Creator calls resolve_market()
- Winners call claim() for 2x payout
- Losers get nothing
- No refunds!

**Privacy:**
- Your positions are ALWAYS private (records)
- Public mode shows TOTALS only
- Private mode shows NOTHING
- Zero-knowledge proofs protect you

---

## 📞 Next Steps

Want to understand more? Check:
- `/Users/cyber/Downloads/Aleo/aleomarket/contract/src/main.leo` - Full contract
- `/Users/cyber/Downloads/Aleo/frontend/components/BetModal.tsx` - Betting logic
- `/Users/cyber/Downloads/Aleo/frontend/app/create/page.tsx` - Market creation
- `/Users/cyber/Downloads/Aleo/aleomarket/DEPLOYMENT.md` - Deployment info
