# Yosuku Pitch Deck

## 10-word hook

Leveraged, private, agent-powered prediction markets launched from X on Sui.

## One-sentence pitch

Yosuku turns DeepBook Predict into a consumer prediction trading app with mobile markets, Trade-from-X, leverage, private routing, copy-trading agents, and live testnet usage.

## 30-second pitch

Yosuku is the consumer layer for DeepBook Predict.

Most prediction market demos stop at "BTC up or down." Yosuku turns that primitive into a full product: users can trade short BTC rounds, post predictions on X that become executable on-chain bets, use leverage, route private-mode trades, follow agent strategies with capped budgets, and manage everything from web or mobile.

Normal 1x bets use standard DeepBook Predict. Advanced flows use Yosuku's own Move modules for Trading Balance, leverage, private balance routing, and no-divert agent budgets.

We already have live testnet usage: connected wallets, real Predict transactions, waitlist signups, and TestFlight demand.

## 90-second pitch

Prediction markets are entering a new phase. They cannot stay as fragmented event boards or terminal-style interfaces. If DeepBook Predict is the market infrastructure, Yosuku is the consumer product layer on top of it.

Yosuku lets users trade fast BTC prediction markets, but the product is bigger than a market card. A user can open the web app or mobile app, choose a side, trade normally through DeepBook Predict, use leverage through Yosuku's Trading Balance layer, opt into private-mode routing, follow strategy agents with capped budgets, and turn X posts into executable on-chain bets.

The key product insight is that prediction markets need distribution and repeat behavior. X is where people already make market calls. Mobile is where consumer behavior happens. Agents are where repeat strategies live. Yosuku brings those three into DeepBook Predict.

This is Sui-native in a meaningful way. We use DeepBook Predict for market pricing and settlement, Move modules for leverage and programmable custody, sponsored transaction infrastructure for onboarding, and capped social vaults so agents can trade for users without withdrawal control.

The result is not just another BTC up/down interface. It is a social, mobile, leveraged, private, agent-powered consumer layer for DeepBook Predict.

## Slide 1: Title

### Leveraged, private, agent-powered prediction markets launched from X on Sui.

Yosuku

Consumer prediction trading for DeepBook Predict.

### Speaker note

Do not open with "15-minute BTC markets." Open with the differentiated stack: leverage, privacy, agents, X, and Sui.

## Slide 2: Problem

### Prediction markets still feel like infrastructure.

Most products are:

- fragmented event boards
- terminal-style trading screens
- hard for new users to understand
- weak on mobile
- disconnected from social distribution
- missing programmable strategy layers

DeepBook Predict gives Sui a powerful market primitive. The missing piece is the consumer layer.

### Speaker note

The problem is not just liquidity or pricing. It is product adoption. People already make predictions socially, but the trade flow is not native to that behavior.

## Slide 3: Insight

### Prediction markets need three things to become daily products.

1. Social distribution
2. Mobile-first trading
3. Programmable strategy execution

X is where calls are made.
Mobile is where consumers trade.
Agents are where repeat strategies live.

Yosuku connects all three to DeepBook Predict.

## Slide 4: Solution

### Yosuku is the consumer layer for DeepBook Predict.

Users can:

- trade live BTC prediction markets
- make predictions on X that become executable bets
- use leverage with bounded downside
- opt into private-mode routing
- subscribe to agent strategies with capped budgets
- manage positions, PnL, cashout, and notifications
- use the product on web and mobile

### Speaker note

Position Yosuku as a product layer, not a wrapper. The market screen is only the entry point.

## Slide 5: Product Demo Flow

### A first-time user can complete the loop.

1. Land on Yosuku
2. Connect or sign in
3. See live BTC markets
4. Pick Higher or Lower
5. Trade normally through DeepBook Predict
6. See the position in portfolio
7. Cash out or settle
8. Share the result

### Advanced loops

- Turn an X post into a trade
- Boost exposure with leverage
- Route winnings through Private Balance
- Follow an agent strategy with a capped budget

## Slide 6: What Makes Yosuku Different

### Most teams build a market screen. Yosuku builds the whole product loop.

| Layer | Yosuku |
|---|---|
| Markets | DeepBook Predict BTC markets |
| Distribution | Trade-from-X |
| Power users | Leverage |
| Privacy | Private balance routing |
| Repeat behavior | Mobile notifications |
| Creator economy | Agent strategy marketplace |
| Safety | Capped budgets, no-divert custody, user-controlled revoke |
| Proof | Live testnet txs and user traction |

## Slide 7: Sui-Native Architecture

### We use Sui where Sui matters.

- DeepBook Predict for live pricing, minting, redeeming, and settlement
- Move contracts for leverage, Trading Balance, private balance, and strategy budgets
- Sui object custody to isolate user funds and agent permissions
- PTBs for multi-step user actions
- Sponsored transaction infrastructure for consumer onboarding
- Attested-agent proof stack for higher-trust automation
- Walrus / MemWal direction for strategy memory and verifiable artifacts

### Runtime boundary

- Normal 1x public bets: standard DeepBook Predict route
- Web leverage: Trading Balance / Yosuku advanced rail
- Private mode: Private Balance beta route
- Strategies and Trade-from-X: separate social-vault budget rails
- Mobile leverage today: older yolev underwriting route, migration planned

## Slide 8: Trust And Safety

### We do not ask users to trust agents with withdrawals.

Strategy agents can:

- trade within a capped user budget
- open positions for the subscriber
- operate only while active

Strategy agents cannot:

- withdraw user funds
- exceed the user budget
- keep trading after revoke

### Settlement honesty

Yosuku markets settle through DeepBook Predict's oracle flow. On testnet, settlement is oracle-trusted rather than fully trustless. We disclose this clearly.

Product-level protections:

- final trading cutoff
- expired-round dead zone
- vetted oracle allowlists for agent activity
- capped leverage and agent budgets
- circuit-breaker roadmap

### Speaker note

This slide makes the project look mature. Do not overclaim "trustless settlement." Say "oracle-settled, not committee-voted."

## Slide 9: Traction

### We are already seeing real usage.

- 42 connected wallets
- 18 wallets placed trades
- 71 on-chain Predict transactions
- 36 waitlist signups
- 12 TestFlight requests

### Why this matters

Overflow judges care about meaningful products and ecosystem impact. These numbers show Yosuku is not only a technical demo. It is already being used, tested, and requested.

## Slide 10: Contracts And Proof

### DeepBook Predict

- Predict package: `0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138`
- Predict object: `0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a`
- dUSDC: `0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC`

### Yosuku packages

- Strategy + no-divert social vault: `0x47d3c108b2165cb1190eefd0b67f73a386e8ca71b870f87a9afb096056795388`
- Social vault object: `0xbe9e96fb8cb6be797c00529fc1f4fe1119192299579167140a084d946851e07b`
- Leverage / underwriting: `0x75e00dc36b96cc4adafd4b180c791f7a0fb40aed92fd11c40968227fc6318a36`
- Underwriting reserve: `0xf715b4b8887b5e6de20f7d7eff5bd07f952f9aafaf65b477330d3c05b8c0cec0`
- Trading Balance: `0x3b76383b2bb9bc411dc56c571a1da22f348b3c19518115ae958fe96e031cf30e`
- TradingVault object: `0xc04516b582bfe73c71325408bfb9e9a5a8fdcd54952a313a288a135e272fa1e6`
- Trading Balance margin desk: `0x5aa4be2fb3084660e584d29a7323ea73ab96a07728496c5a3832b3b9cc0f4e40`

### Attested-agent proof stack

This is a proof stack, not the current consumer runtime:

- Attested vault + verifier package: `0xedb9292d970e8759360e37398cdb658719915803394329cb9ef061746eb8bf7c`
- Vault `<DUSDC>`: `0x1c95fb3703d841e1cb7b0742c9426fc7fb4e3c35903c8efd67bb0ae625e5f034`
- Agent registry: `0x29b36bb83939a8f7ceed420760b9864f0691266ce70db20e02ccc40aa62cf7e7`

## Slide 11: Roadmap

### Phase 1: Overflow submission

Polished web and mobile product, live Predict trades, leverage, private mode, Trade-from-X, strategy marketplace, usage metrics.

### Phase 2: Closed beta

Mobile/web parity, stronger onboarding, sponsored transaction coverage, portfolio truth, strategy performance, notification reliability.

### Phase 3: Mainnet-ready

Redeploy when Predict mainnet addresses exist, production risk controls, official quote asset, monitoring, reserve limits.

### Phase 4: Agent strategy marketplace

Creator profiles, strategy subscriptions, agent leaderboards, verifiable memory, X distribution, capped budgets.

### Phase 5: Ecosystem layer

More assets, more expiries, structured products, SDKs, embeddable market cards, Predict analytics, Sui DeFi integrations.

## Slide 12: Why We Win

### Yosuku matches the Overflow bar.

| Criteria | Yosuku |
|---|---|
| Meaningful problem | Prediction markets need consumer UX and distribution |
| Polished UX | Web, mobile, portfolio, onboarding, notifications |
| Leverages Sui | DeepBook Predict, Move modules, object custody, sponsored txs |
| Product thinking | Social, leverage, privacy, agents, analytics, growth loops |
| Long-term potential | Consumer and strategy layer for DeepBook Predict |

## Slide 13: Ask

### Help us make Yosuku the consumer layer for DeepBook Predict.

We are looking for:

- feedback from DeepBook Predict and Sui teams
- support for mainnet Predict launch readiness
- oracle settlement roadmap clarity
- mobile beta users
- strategy creators and agent builders
- ecosystem partners for distribution

## Submission Description

Leveraged, private, agent-powered prediction markets launched from X on Sui.

Yosuku turns DeepBook Predict into a consumer prediction trading app with mobile-first BTC markets, Trade-from-X, leverage, private-mode routing, copy-trading agents, Trading Balance, portfolio analytics, and live testnet usage.

Users can trade short BTC rounds, post predictions on X that become executable on-chain bets, follow agent strategies with capped budgets, and manage positions from a clean web and mobile interface.

Normal 1x public bets use standard DeepBook Predict. Advanced flows use Yosuku's own Move modules for leverage, private balance routing, Trading Balance, and agent budgets.

Yosuku is not just another BTC market screen. It is the consumer layer that makes DeepBook Predict social, mobile, leveraged, private, and agent-powered.

## Demo Video Structure

### 0:00 - 0:10

Show the hook and the live web app.

Voiceover: "Yosuku is leveraged, private, agent-powered prediction markets launched from X on Sui."

### 0:10 - 0:35

Show normal market flow.

- Open markets
- Select a live BTC market
- Pick Higher or Lower
- Place a standard Predict trade
- Show portfolio update

### 0:35 - 1:00

Show advanced flows.

- Leverage
- Private mode
- Trading Balance
- Cashout routing

### 1:00 - 1:25

Show social and agent flows.

- Trade-from-X
- Strategy marketplace
- Capped budget
- No withdrawal control

### 1:25 - 1:45

Show traction and proof.

- Connected wallets
- Predict txs
- Waitlist
- TestFlight requests
- Package addresses

### 1:45 - 2:00

Close with roadmap.

Voiceover: "Yosuku is built to become the consumer and strategy layer for DeepBook Predict."

## Lines To Avoid

Avoid these claims:

- "fully trustless settlement"
- "decentralized oracle settlement"
- "agents can never do anything wrong"
- "private trades are fully untraceable"
- "all features use Trading Balance"

Use these instead:

- "oracle-settled through DeepBook Predict"
- "oracle-trusted on testnet, with clear disclosure"
- "agents are bounded by capped budgets and no-withdrawal custody"
- "private mode is an opt-in beta routing layer"
- "Trading Balance powers leverage, private balance, and cashout routing"

