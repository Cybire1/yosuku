# DART - BTC Prediction Markets on Aleo

Privacy-first BTC price prediction platform built on Aleo. Bet on whether Bitcoin will go up or down using DART tokens, with zero-knowledge proofs keeping your positions private.

## What is DART?

DART runs timed prediction rounds where users bet YES or NO on BTC price targets. Winners split the pool proportionally (minus a 10% platform fee). All transactions are private via Aleo's zkSNARK technology.

## Features

- **BTC Price Predictions** - Timed rounds (1m, 5m, 15m, 30m, 1h) with real-time BTC price feeds
- **DART Token** - Platform token for placing bets, mintable on testnet via faucet
- **Live Ticker Tape** - Scrolling crypto prices (BTC, ETH, SOL, SUI, ALEO, DOGE) + Fear/Greed index
- **BTC News Feed** - Live Bitcoin news with sentiment indicators
- **Voice Agent (DART AI)** - Google Gemini 2.0 powered voice assistant for market queries
- **PnL Tracking** - Portfolio stats, round history, and performance charts
- **Privacy by Default** - Zero-knowledge proofs for all bets and balances

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Tech Stack

- **Framework**: Next.js 16, React 19, TypeScript
- **Blockchain**: Aleo (testnet), Leo smart contracts
- **Styling**: Tailwind CSS 4, Framer Motion
- **Voice AI**: Google Gemini 2.0 Live API
- **Wallet**: Leo Wallet via @demox-labs/aleo-wallet-adapter
- **Charts**: Recharts

## Smart Contracts

| Program | Purpose |
|---------|---------|
| `dart_token.aleo` | DART token (mint, transfer, balances) |
| `btc_prediction.aleo` | Rounds, bets, resolution, payouts |

## Environment Variables

```env
NEXT_PUBLIC_GEMINI_API_KEY=your_gemini_key
```

## Project Structure

```
app/
  markets/        # Main trading page (rounds, chart, betting)
  portfolio/      # User positions and PnL
  leaderboard/    # Top traders
  admin/          # Round management
  how-it-works/   # Platform guide
  api/
    ticker/       # Crypto price ticker data
    crypto-news/  # BTC news aggregation
    polymarket/   # External market data
components/
  TradingCard     # Round display with live chart
  BetSidebar      # YES/NO betting panel
  TickerTape      # Scrolling crypto prices
  NewsFeed        # BTC news with sentiment
  VoiceAgent      # DART AI voice interface
  RoundHistory    # Past rounds and claims
  PnLChart        # Performance visualization
lib/
  predictionContract.ts   # Contract constants and helpers
  hooks/useRounds.ts      # Round fetching and state
  hooks/useBtcPrice.ts    # Live BTC price feed
  voice/                  # Voice agent tools
```

## How It Works

1. A round opens with a BTC target price and duration
2. Users bet YES (price >= target) or NO (price < target) using DART tokens
3. When the timer expires, the round resolves against live BTC price
4. Winners split the losing side's pool proportionally (10% fee)

## Deployment

Deployed on Vercel with auto-deploys from main.

**Repo**: https://github.com/shaibuafeez/dart.git

## Built For

WaveHack - Privacy-focused Applications on Aleo

## License

MIT
