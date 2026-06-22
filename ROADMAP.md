# Yosuku Roadmap

## North Star

Yosuku becomes the consumer and agent trading layer for DeepBook Predict: fast markets, social prediction, leverage, private routing, and copy-trading strategies on Sui.

The goal is not to ship another BTC up/down screen. The goal is to make DeepBook Predict feel like a product people can use every day.

## Strategic Pillars

### 1. Consumer-grade prediction trading

Make short-duration prediction markets feel simple, fast, and mobile-native.

- One clear market question
- Clean UP/DOWN trade flow
- Portfolio, cashout, PnL, and settlement history
- Notifications for expiring markets, wins, cashouts, and strategy activity
- Gas-aware onboarding and sponsored transactions where available

### 2. Social distribution

Turn prediction markets into a social habit, not a terminal workflow.

- Trade-from-X: users post predictions on X and Yosuku turns them into executable on-chain bets
- Shareable market cards, result cards, and strategy cards
- Public stats, leaderboards, and creator profiles
- Referral and waitlist loops tied to real usage

### 3. Advanced trading without advanced UX

Expose powerful Sui-native flows without making users manage protocol details.

- Normal 1x public bets use standard DeepBook Predict
- Trading Balance powers leverage, private balance, and portfolio cashout routing
- Private mode remains opt-in and clearly labeled while it is beta
- Leverage is presented as boosted exposure with bounded downside
- Strategy budgets are capped and revocable

### 4. Agent strategy marketplace

Make Yosuku the place where prediction agents earn reputation and users can safely copy them.

- Strategy marketplace with performance history
- Capped agent budgets with no withdrawal control
- Agent leaderboards by PnL, win rate, drawdown, volume, and consistency
- Strategy artifacts and memory stored with verifiable data layers where useful
- X-native strategy distribution: agents publish calls, followers trade them

### 5. Sui-native composability

Use Sui for what it is good at: objects, programmable custody, PTBs, sponsored transactions, and composable DeFi rails.

- DeepBook Predict for market pricing, minting, redeeming, and settlement
- Move modules for leverage, Trading Balance, social vaults, and attested-agent proofs
- Sponsored transactions for smoother onboarding
- zkLogin / social login as the default consumer entry path
- Walrus / MemWal for strategy memory and auditable agent artifacts

## Phase 0: Overflow Submission

Goal: prove Yosuku is a real product, not a technical demo.

### Product

- Polished web app at `yosuku.xyz`
- Live market cards for multiple horizons: 15-min, 30-min, 45-min, 1-hr
- End-to-end normal Predict trade flow
- End-to-end leverage flow through Yosuku advanced rails
- Private mode as a clearly labeled beta path
- Strategy marketplace with capped copy-trading budgets
- Trade-from-X flow for social prediction posts
- Portfolio, cashout, achievements, analytics, and onboarding
- Mobile Expo app with markets, portfolio, strategies, notifications, and Trade-from-X

### Proof

- Show package addresses and live testnet txs
- Show traction metrics
- Show demo video
- Show wallet/trade analytics
- Show honest trust model for settlement

### Current traction

- 42 connected wallets
- 18 wallets placed trades
- 71 on-chain Predict transactions
- 36 waitlist signups
- 12 TestFlight requests

### Success metric

A judge can open Yosuku, understand the product in 30 seconds, and complete a trade without needing a protocol explanation.

## Phase 1: First 30 Days After Overflow

Goal: turn the hackathon product into a reliable closed beta.

### UX hardening

- Make onboarding shorter and more guided
- Add stronger empty states and loading states
- Improve mobile/web parity
- Improve trade receipt clarity
- Make the portfolio the source of truth for all open, settled, and cashout-ready positions

### Trading hardening

- Migrate mobile leverage to the newer Trading Balance architecture
- Keep normal 1x public bets on the standard Predict route
- Expand sponsored transaction coverage
- Improve error messages for expired markets, insufficient gas, stale quotes, and mint-range failures
- Add clearer close-to-expiry warnings

### Strategy hardening

- Persist subscription state across reloads
- Add strategy performance cards
- Rank strategies by PnL, win rate, max drawdown, subscriber count, and volume
- Add strategy risk labels
- Add creator pages

### Success metric

- 100+ connected wallets
- 50+ traders
- 300+ Predict txs
- 50+ TestFlight users
- 10+ active strategy subscribers

## Phase 2: Mainnet-Ready Launch

Goal: be ready the day DeepBook Predict mainnet addresses are available.

### Mainnet readiness

- Redeploy Yosuku contracts against mainnet Predict once mainnet Predict exists
- Replace test dUSDC assumptions with the official mainnet quote asset
- Make network switching config-driven, not code-driven
- Prepare production Onara/sponsored transaction policies
- Add production monitoring for RPC, indexer, keeper, oracle freshness, and sponsor health

### Risk controls

- Max notional per user
- Max reserve utilization
- Expiry cutoff for leverage
- Volatility buffer near settlement
- Daily loss caps for advanced flows
- Circuit breakers for oracle delay or stale market data

### Settlement honesty

Yosuku markets settle through DeepBook Predict's oracle flow. On testnet this is oracle-trusted, not fully trustless. Our product-level protections are:

- final trading cutoff
- expired-round dead zone
- vetted oracle allowlists for agent activity
- capped leverage and agent budgets
- transparent disclosure in docs and pitch materials

Mainnet roadmap item: use aggregated, medianized, or TWAP-based settlement if Predict exposes it.

### Success metric

Mainnet launch is a package/config migration, not a product rewrite.

## Phase 3: Agent Strategy Marketplace

Goal: make Yosuku more than a betting app. Make it a prediction strategy network.

### Strategy creators

- Publish a strategy
- Attach a trading thesis
- Attach memory/artifacts
- Show performance history
- Charge subscription fees
- Build audience through X

### Strategy followers

- Browse strategies by performance and risk
- Allocate a capped budget
- Pause or revoke instantly
- Track copied trades in portfolio
- See agent explanations and historical calls

### Agent safety

- Agents can trade only within the user-approved budget
- Agents cannot withdraw user funds
- User-owned positions remain tied to the subscriber
- Attested-agent proof stack becomes the premium trust layer

### Success metric

Users follow strategies because they trust measured performance, not because they understand the contract.

## Phase 4: Ecosystem Expansion

Goal: become the consumer distribution layer for DeepBook Predict and Sui prediction products.

### Product expansion

- Add more assets as DeepBook Predict supports them
- Add more market durations
- Add shareable public profiles
- Add social leagues and prediction streaks
- Add creator rewards

### DeFi expansion

- Strategy baskets
- Protected prediction products
- Yield plus hedge products
- Predict position analytics
- Collateral and risk dashboards where compatible with Sui DeFi

### Developer expansion

- SDK helpers for Trade-from-X
- Strategy marketplace APIs
- Embeddable market cards
- Predict portfolio widgets
- Agent budget templates

### Success metric

Yosuku is no longer just an app using Predict. It becomes the product, social, and strategy layer that grows Predict usage.

## Why This Roadmap Fits Overflow

### Meaningful problem

Prediction markets are powerful but still hard to use, shallow, and fragmented. Yosuku makes DeepBook Predict usable as a consumer product.

### Polished UX

The roadmap prioritizes onboarding, mobile, portfolio truth, notifications, clear copy, and social flows.

### Meaningful Sui usage

Yosuku uses DeepBook Predict, Move modules, Sui object custody, sponsored transactions, zkLogin direction, and programmable agent budgets.

### Strong product thinking

Yosuku is not only a trading screen. It includes social distribution, leverage, private routing, copy-trading strategies, mobile UX, analytics, and growth loops.

### Long-term potential

If DeepBook Predict becomes market infrastructure, Yosuku can become its consumer and strategy distribution layer.

