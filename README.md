# DART - Decentralized Prediction Markets on Aleo

A privacy-first prediction markets platform built on Aleo blockchain with AI-powered voice assistance and cinematic UX.

## Core Features

**Privacy-Preserving Prediction Markets**
- Create and trade on custom prediction markets with zero-knowledge proofs
- Private transaction history protected by Aleo's zkSNARKs
- Dynamic odds calculation based on liquidity pools
- Real-time market statistics and trending indicators
- Category-based browsing (Politics, Sports, Crypto, Culture, Economics)

**Voice Agent (DART AI)**
- Google Gemini 2.0 Live API integration
- Real-time voice interaction with internet search grounding
- Natural language market queries and analysis
- Portfolio tracking and insights

**Modern UI/UX**
- Kalshi-inspired professional interface
- Glass morphism design with ambient gradients
- Compact market cards with inline charts
- Responsive sidebar widgets (Trending, Top Movers)
- Horizontal category navigation

**Aleo Blockchain Integration**
- Zero-knowledge proofs for transaction privacy
- Private betting and trading history
- Wallet connection with @demox-labs/aleo-wallet-adapter
- Secure smart contract interactions

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Add your NEXT_PUBLIC_GEMINI_API_KEY

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## Tech Stack

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS
- **Blockchain**: Aleo blockchain, Leo smart contracts
- **Voice AI**: Google Gemini 2.0 Live API with WebRTC
- **Charts**: Recharts for market visualizations
- **Animations**: Framer Motion
- **Wallet**: @demox-labs/aleo-wallet-adapter-react

## Project Structure

```
frontend/
├── app/
│   ├── markets/          # Main markets browsing page
│   ├── market/[id]/      # Individual market details
│   ├── portfolio/        # User portfolio dashboard
│   └── claim/            # NFT claim pool interface
├── components/
│   ├── VoiceAgent.tsx    # DART AI voice interface
│   ├── MarketCard.tsx    # Compact market display
│   ├── FeaturedHero.tsx  # Hero market section
│   └── charts/           # Chart components
├── lib/
│   ├── hooks/            # Custom React hooks
│   └── searchUtils.ts    # Fuzzy search utilities
└── constants/
    └── contract.ts       # Aleo contract addresses
```

## Privacy Features

**Zero-Knowledge Trading**
- All bets and trades are private by default
- Users can verify trades without revealing amounts
- Private portfolio balances

**Aleo's zkSNARK Technology**
- Succinct proofs for all transactions
- No on-chain transaction history exposure
- Private yet verifiable market participation

## Key Features

**Market Search**
- Fuzzy search with Cmd+K / Ctrl+K shortcut
- Real-time filtering across all markets
- Category-based filtering

**Market Cards**
- Live market status indicators
- Inline mini price charts
- One-click YES/NO betting
- Volume and time remaining metadata

**Voice Agent**
- Floating orb trigger with living animations
- Modal interface with glass morphism
- Text and voice input support
- Real-time internet search grounding

**Sidebar Widgets**
- Trending markets by volume
- Top movers with percentage changes
- Category filtering

## Environment Variables

```env
NEXT_PUBLIC_GEMINI_API_KEY=your_gemini_api_key_here
NEXT_PUBLIC_ALEO_NETWORK=testnet3
```

## Development

```bash
# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run linter
npm run lint
```

## Deployment

The app is deployed on Vercel with automatic deployments from the main branch.

Repository: https://github.com/shaibuafeez/dart.git

## Built For

WaveHack - Build a Privacy-focused Application on Aleo

DART demonstrates the power of Aleo's zero-knowledge technology for creating private, fair, and transparent prediction markets where users can trade without revealing their positions or transaction history.

## License

MIT
