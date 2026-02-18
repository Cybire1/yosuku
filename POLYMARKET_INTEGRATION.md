# Polymarket API Integration - Complete Guide

## Overview

AleoMarket now integrates with **3 Polymarket APIs** to display trending prediction markets and allow users to clone them to the Aleo blockchain with privacy features.

---

## 🔌 APIs Integrated

### 1. **Gamma Markets API** (Market Discovery & Metadata)
**Base URL:** `https://gamma-api.polymarket.com`

**Purpose:**
- Browse available markets
- Get market metadata (questions, descriptions, images)
- Retrieve categories, volumes, resolution info
- Access market probabilities and outcomes

**Our Usage:**
- Fetch active, high-volume markets
- Get market questions, end dates, categories
- Display market images and descriptions
- Show total volume stats

**Endpoint We Use:**
```
GET /markets?limit=12&active=true&closed=false
```

**Response Data:**
```json
{
  "id": "12345",
  "question": "Will Bitcoin hit $200k by 2027?",
  "description": "Market resolves YES if...",
  "endDate": "2027-01-01T00:00:00Z",
  "category": "Crypto",
  "volumeNum": 1250000,
  "liquidityNum": 45000,
  "image": "https://...",
  "outcomePrices": "[\"0.65\", \"0.35\"]",
  "outcomes": "[\"Yes\", \"No\"]",
  "clobTokenIds": "[\"token123\", \"token456\"]",
  "active": true,
  "closed": false
}
```

---

### 2. **CLOB API** (Central Limit Order Book - Real-Time Pricing)
**Base URL:** `https://clob.polymarket.com`

**Purpose:**
- Get **real-time** price feeds (live order book data)
- Access current bid/ask spreads
- View order book depth
- Stream live price updates

**Our Usage:**
- Fetch live YES/NO prices for each market
- Display real-time odds percentages
- Show "LIVE" badge when using real-time data
- Update prices every 30-60 seconds

**Endpoint We Use:**
```
GET /price?token_id={token_id}
```

**Response Data:**
```json
{
  "price": "0.6524",
  "mid": "0.6500",
  "timestamp": 1769550000
}
```

**Features:**
- ✅ No authentication required for public price data
- ✅ Sub-second latency
- ✅ Real order book prices (not estimates)
- ✅ Parallel fetching for speed

---

### 3. **Data API** (User Positions & Portfolio - Not Yet Implemented)
**Base URL:** `https://data-api.polymarket.com`

**Purpose:**
- Query user positions
- Track trade history
- Calculate PnL (profit/loss)
- Build portfolio dashboards

**Potential Future Usage:**
- Show user's Polymarket positions
- Compare Polymarket vs Aleo positions
- Display trading performance
- Sync cross-platform portfolio

**Status:** 🔜 Not implemented yet (planned for v2)

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│              FRONTEND (Next.js)                      │
│  - Homepage displays Polymarket markets              │
│  - PolymarketCard shows live odds                   │
│  - "Create on Aleo" clones to blockchain            │
└────────────┬────────────────────────────────────────┘
             │
             │ GET /api/polymarket?limit=6
             ▼
┌─────────────────────────────────────────────────────┐
│        API ROUTE (/app/api/polymarket/route.ts)     │
│                                                      │
│  1. Fetch markets from Gamma API                    │
│  2. Extract clobTokenIds                            │
│  3. Fetch real-time prices from CLOB API (parallel) │
│  4. Merge data and return enriched markets          │
└────────┬────────────────────────────┬───────────────┘
         │                            │
         │                            │
         ▼                            ▼
┌─────────────────────┐   ┌─────────────────────────┐
│   GAMMA MARKETS API │   │      CLOB API           │
│  (Market Metadata)  │   │   (Live Prices)         │
│                     │   │                         │
│ - Questions         │   │ - YES price: 0.6524     │
│ - Categories        │   │ - NO price: 0.3476      │
│ - Volume            │   │ - Timestamp             │
│ - Images            │   │ - Bid/Ask               │
│ - Token IDs         │   │                         │
└─────────────────────┘   └─────────────────────────┘
```

---

## 📊 Data Flow

### Step 1: Homepage Loads
```typescript
// page.tsx
useEffect(() => {
  fetchPolymarkets();
}, []);

const fetchPolymarkets = async () => {
  const response = await fetch('/api/polymarket?limit=6');
  const data = await response.json();
  setPolymarkets(data.markets);
};
```

### Step 2: API Route Processes Request
```typescript
// route.ts
export async function GET(request: Request) {
  // 1. Fetch from Gamma API
  const markets = await fetch('https://gamma-api.polymarket.com/markets?...');

  // 2. For each market, get live prices
  const enrichedMarkets = await Promise.all(
    markets.map(async (market) => {
      const tokenIds = JSON.parse(market.clobTokenIds);

      // Fetch YES and NO prices in parallel
      const [yesPrice, noPrice] = await Promise.all([
        fetch(`https://clob.polymarket.com/price?token_id=${tokenIds[0]}`),
        fetch(`https://clob.polymarket.com/price?token_id=${tokenIds[1]}`),
      ]);

      return {
        ...market,
        outcomePrices: [yesPrice, noPrice],
        hasLivePrice: true,
      };
    })
  );

  // 3. Sort by volume and return
  return NextResponse.json({
    success: true,
    markets: enrichedMarkets.sort(...),
  });
}
```

### Step 3: Display on Frontend
```typescript
// PolymarketCard.tsx
const yesProb = (parseFloat(market.outcomePrices[0]) * 100).toFixed(1);
const noProb = (parseFloat(market.outcomePrices[1]) * 100).toFixed(1);

// Show "LIVE" badge if real-time data
{market.hasLivePrice && (
  <div className="bg-green-600">
    <div className="animate-pulse" />
    LIVE
  </div>
)}
```

---

## 🎯 Features Implemented

### ✅ Live Price Display
- Real-time YES/NO odds from CLOB API
- Updates every 30-60 seconds via cache revalidation
- Green "LIVE" badge for markets with real-time data
- Fallback to static Gamma prices if CLOB unavailable

### ✅ Market Discovery
- Filters active, high-volume markets
- Sorts by 24hr volume
- Shows top 6 trending markets
- Categories: Crypto, Politics, Sports, Pop Culture, etc.

### ✅ Clone to Aleo
- One-click "Create on Aleo" button
- Pre-fills question and end date
- Shows "Cloned from Polymarket" badge
- Preserves user's ability to edit before creating

### ✅ Visual Integration
- Purple-themed cards (distinct from Aleo markets)
- Category badges
- Volume displays
- Direct links to Polymarket

---

## ⚡ Performance Optimizations

### Caching Strategy
```typescript
// Gamma API: 60 second cache
next: { revalidate: 60 }

// CLOB API: 30 second cache (fresher data)
next: { revalidate: 30 }
```

### Parallel Fetching
```typescript
// Fetch all prices in parallel (not sequential)
await Promise.all([
  fetchCLOBPrice(tokenIds[0]),
  fetchCLOBPrice(tokenIds[1]),
]);
```

### Request Efficiency
- Fetch 2x markets initially
- Sort by volume
- Return only top N
- Reduces frontend filtering

---

## 🔐 API Access & Authentication

### Public Endpoints (No Auth)
✅ **Gamma Markets API** - `/markets`, `/events`
✅ **CLOB API** - `/price`, `/book`, `/midpoint`

### Requires Authentication (Future)
🔒 **CLOB API** - Order placement, cancellation
🔒 **Data API** - User positions, trade history

**How to Authenticate (Future Implementation):**
```typescript
// Generate API credentials from Polygon wallet
// Use py-clob-client or similar
import { ClobClient } from '@polymarket/clob-client';

const client = new ClobClient({
  privateKey: process.env.POLYGON_PRIVATE_KEY,
  chainId: 137, // Polygon Mainnet
});

// Place orders, view positions, etc.
```

---

## 📈 Rate Limits

### Current Limits (Unauthenticated)
- **Gamma API:** ~1,000 calls/hour
- **CLOB API:** ~1,000 calls/hour

### Our Usage
- Homepage: 1 Gamma call + 12 CLOB calls per load
- With caching: Effectively 1 call/minute for Gamma, 1 call/30s for CLOB
- Well under rate limits

### Future Optimizations
- WebSocket for real-time price streaming
- Server-side caching layer (Redis)
- Batch price requests

---

## 🚀 Future Enhancements

### Phase 1 (Current) ✅
- [x] Gamma API integration
- [x] CLOB price fetching
- [x] Clone to Aleo functionality
- [x] Live price badges

### Phase 2 (Planned) 🔜
- [ ] WebSocket price streams
- [ ] User position tracking (Data API)
- [ ] Order book depth visualization
- [ ] Historical price charts
- [ ] Cross-platform portfolio view

### Phase 3 (Advanced) 🔮
- [ ] Arbitrage detection (Polymarket vs Aleo)
- [ ] Price prediction models
- [ ] Social sentiment integration
- [ ] Automated market making

---

## 🛠️ Technical Details

### File Structure
```
/app/api/polymarket/route.ts         # API aggregation layer
/components/PolymarketCard.tsx       # Market display component
/app/page.tsx                        # Homepage integration
/app/create/page.tsx                 # Clone functionality
```

### Dependencies
- Next.js 14+ (App Router)
- TypeScript
- Framer Motion (animations)
- Lucide React (icons)

### Environment Variables
None required for public API access!

### Error Handling
```typescript
try {
  const clobResponse = await fetch(...);
  if (clobResponse.ok) {
    return await clobResponse.json();
  }
} catch (error) {
  console.error('CLOB API error:', error);
  return null; // Graceful fallback to Gamma prices
}
```

---

## 📚 Official Documentation

- **Gamma API:** https://docs.polymarket.com/developers/gamma-markets-api/overview
- **CLOB API:** https://docs.polymarket.com/developers/CLOB/introduction
- **Python Client:** https://github.com/Polymarket/py-clob-client
- **WebSocket Streams:** https://docs.polymarket.com/developers/CLOB/websocket

---

## 🎨 UI/UX Features

### Visual Indicators
- 🟣 Purple theme for Polymarket cards
- 🟢 Green "LIVE" badge for real-time prices
- 📊 Volume displays ($1.2M format)
- 📅 End date formatting
- 🏷️ Category badges

### Interactions
- Click "View on Polymarket" → Opens in new tab
- Click "Create on Aleo" → Pre-fills create form
- Hover effects and animations
- Loading states

### Responsive Design
- Grid layout (3 cols desktop, 2 tablet, 1 mobile)
- Touch-friendly buttons
- Readable on all screen sizes

---

## 🔍 Example API Calls

### Get Trending Markets
```bash
curl "https://gamma-api.polymarket.com/markets?limit=10&active=true&closed=false"
```

### Get Live Price
```bash
curl "https://clob.polymarket.com/price?token_id=53135072462907880191400140706440867753044989936304433583131786753949599718775"
```

### Our API Route
```bash
curl "http://localhost:3000/api/polymarket?limit=6"
```

---

## 💡 Key Insights

### Why Polymarket Integration?
1. **Market Discovery** - Users see popular prediction topics
2. **Legitimacy** - Shows real market demand
3. **Education** - Users understand how prediction markets work
4. **Privacy Angle** - Highlights Aleo's unique value (ZK proofs)
5. **Network Effects** - Cross-pollinate user bases

### Competitive Advantages Over Polymarket
- ✅ **Privacy:** Zero-knowledge proofs (Polymarket is fully public)
- ✅ **Censorship Resistance:** Decentralized on Aleo
- ✅ **No KYC:** Anonymous participation
- ✅ **Lower Fees:** Blockchain efficiency

### Why Users Would Clone Markets
- Privacy for large bets
- Avoid Polymarket's geo-restrictions
- Participate without Polygon wallet
- Support decentralization
- Test Aleo blockchain

---

## 🐛 Debugging

### Common Issues

**Issue 1:** Markets not loading
**Fix:** Check CORS, verify API endpoints, check network tab

**Issue 2:** Prices showing 0.5/0.5
**Fix:** CLOB API might be down, using Gamma fallback

**Issue 3:** "LIVE" badge not showing
**Fix:** Token IDs missing in Gamma response, check `clobTokenIds` field

### Console Logs
```javascript
// Enable verbose logging
console.log('Fetching Polymarket markets...');
console.log('CLOB price for token:', tokenId, '→', price);
console.log('Enriched markets:', enrichedMarkets);
```

---

## 📊 Metrics to Track

### API Performance
- Average response time (Gamma vs CLOB)
- Cache hit rate
- Error rate
- Failed price fetches

### User Engagement
- Click-through rate to Polymarket
- "Create on Aleo" conversion rate
- Markets cloned by category
- User retention after cloning

### Business Metrics
- Markets created from Polymarket
- Volume on cloned markets
- User acquisition from Polymarket traffic

---

## 🎓 Learning Resources

- [Polymarket Docs](https://docs.polymarket.com)
- [CLOB Architecture](https://docs.polymarket.com/developers/CLOB/introduction)
- [Gamma API Reference](https://docs.polymarket.com/developers/gamma-markets-api)
- [Polygon Integration](https://polygon.technology/developers)

---

Generated: 2026-01-27
Integration Version: 1.0.0
Status: ✅ Production Ready
