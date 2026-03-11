# DART Protocol

<p align="center">
  <img src="https://img.shields.io/badge/Aleo-Testnet-blue" alt="Aleo Testnet">
  <img src="https://img.shields.io/badge/Leo-v3.4.0-green" alt="Leo v3.4.0">
  <img src="https://img.shields.io/badge/USDCx-Stablecoin-purple" alt="USDCx">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License">
</p>

**The problem isn't privacy. It's that fast markets are broken without it.**

Every prediction market today has the same flaw: the moment you place a bet, everyone sees it. On a slow market — *will BTC hit $100K by December?* — that's annoying but survivable. On a fast market — *will BTC be above $72K in 5 minutes?* — it's fatal.

In a 5-minute window, a whale bets YES, the pool shifts, everyone copies, and the odds collapse before the round closes. MEV bots see pending transactions and front-run. Traders watch each other instead of watching the market. You get herd behavior, not real sentiment. This is why nobody runs fast prediction markets on public chains.

**DART fixes this by making order flow invisible.** Your bet side is a private input to a ZK circuit — it never appears on-chain. The contract stores a commitment hash, not your direction. Only the combined pool total updates. After the round settles, the per-side breakdown is revealed — but by then, there's nothing left to game.

The 5-minute round isn't a gimmick. It's the proof that the privacy works. 59+ rounds completed on testnet. Dark pool holds. No copy-trading possible. No front-running possible.

> **Live on Aleo Testnet** | Contract: [`btc_pred_v8.aleo`](https://testnet.explorer.provable.com) | [Shield Wallet](https://www.shieldwallet.xyz/)

---

## DART vs. Public Markets

```
On Polymarket:                          On DART:
─────────────────────────────           ─────────────────────────────
Alice bets YES, $10                     Alice calls bet()
Pool: YES $8,420 / NO $6,310           Pool total: $14,740
Odds shift to 57/43                     Pool total: $14,750
Everyone adjusts their bets             Nobody knows anything changed
Bob front-runs with $500 on YES         Bob sees nothing to front-run
```

Three things happen simultaneously when Alice bets:

1. **Her bet side is a private input** — it enters the ZK circuit but never appears on-chain
2. **The contract stores `hash(YES, 10, random_salt)`** — a commitment that can't be reversed without Alice's salt
3. **Only the combined pool total updates** — per-side breakdown stays hidden until resolution

After the round ends, Alice reveals her commitment to claim. By then, the market is settled — there's nothing left to front-run.

---

## Why This Can Only Exist on Aleo

**On Ethereum/Solana**, a `bet(side, amount)` function call puts `side` in the transaction calldata. Everyone sees it. You can try to encrypt it, but:
- The contract needs to update per-side pool totals → those pool changes reveal the side
- Even with commit-reveal schemes, the pool update happens at commit time
- MEV bots see the pending transaction in the mempool before it's even confirmed

**On Aleo**, the `bet()` transition takes `side` and `salt` as **private inputs**. The ZK circuit:
- Computes `hash(side, amount, salt)` inside the proof
- Updates only the combined pool total (public)
- Never exposes which side received the funds
- Returns an encrypted `BetReceipt` that only the bettor can read

The private input mechanism is native to Aleo's execution model — it's not bolted on. The proof guarantees the bet is valid without revealing what it is.

---

## How It Works

### Placing a Bet

```
bet(round_id, amount, side, salt)
│
├─ ZK Circuit (private):
│   commit = BHP256::hash(side, amount, salt)
│
├─ On-chain (public):
│   bc[key] = commit          ← stored hash
│   ba[key] = amount          ← bet amount
│   rp[round] += amount       ← dark pool total
│
└─ Output (encrypted):
    BetReceipt { round_id, commit }  ← only bettor can decrypt
```

### Claiming Winnings

```
claim(round_id, side, amount, salt, payout)
│
├─ Contract verifies:
│   BHP256::hash(side, amount, salt) == bc[key]   ← preimage check
│   side matches winning outcome                   ← winner check
│   payout <= (amount / win_pool) * total * 0.9    ← math check
│
└─ Transfers USDCx payout to caller
```

Claims take **all scalar inputs** — no records consumed. The wallet doesn't need to find, decrypt, or pass any records. This is deliberate: [see Design Decisions](#design-decisions).

### Dark Pool

During active betting, the contract exposes a single number: the combined pool total.

```
Active Round (as seen by any observer):       After Resolution:
┌────────────────────────────────┐           ┌────────────────────────────────┐
│  Target: BTC > $71,594         │           │  Target: BTC > $71,594         │
│  Total Pool: 3,000,000 USDCx  │           │  Total Pool: 3,000,000 USDCx  │
│  YES Pool: ???                 │           │  YES Pool: 1,000,000           │
│  NO Pool:  ???                 │           │  NO Pool:  2,000,000           │
│  Deadline: block 15,092,325    │           │  Outcome: NO won               │
└────────────────────────────────┘           └────────────────────────────────┘
```

The resolver bot tracks per-side totals off-chain and submits them at resolution. The contract enforces `yes_total + no_total == pool_total` — the admin can't inflate or deflate the pool.

---

## Design Decisions

8 contract versions. Each one broke, taught us something, and led to the next.

### Why not records for claims? (v7 → v8)

v7 used a `BetSlot` record model inspired by [ZKPerp](https://github.com/hwdeboer1977/ZKPerp). Users received a record with their bet data and passed it back to `claim()`. Elegant in theory.

In practice, Shield Wallet's `requestRecords` intermittently fails. Users could bet but couldn't claim. We built a [debug page](/test-wallet) to isolate the issue — it's a wallet-level reliability problem.

v8 eliminates record inputs entirely. Claims use scalar values: `(roundId, side, amount, salt, payout)`. The wallet only needs `executeTransaction` — which works reliably.

### Why random salt?

We tried deriving salt from `SHA-256(address + roundId + side + amount)`. Broken — all inputs except `side` are public, and `side` is binary. An attacker computes both hashes and cracks the commitment in two guesses.

We tried Shield Wallet's `signMessage` for deterministic-but-secret salt. Broken — signing the same message twice produces different signatures. Can't reproduce the salt at claim time.

Random salt is the only approach that resists both brute-force and replay attacks. Encrypted backup to wallet-derived keys is planned for production — see [Roadmap](#roadmap).

### Why parimutuel, not AMM?

Prediction markets have binary outcomes. AMM curves create artificial slippage that doesn't reflect actual probability. Parimutuel pooling — winners split the losers' pool proportionally — is mathematically simpler and better suited to binary events.

---

## Architecture

<p align="center">
  <img src="public/image.png" alt="DART Architecture" width="700">
</p>

### Frontend

Next.js 16, TypeScript, Tailwind 4, Framer Motion. Live BTC price via Binance WebSocket. Voice agent powered by Google Gemini 2.0 Live API.

| Page | Purpose |
|---|---|
| `/markets` | Active round, betting panel, live chart |
| `/how-it-works` | Privacy architecture explained |
| `/leaderboard` | Top predictors |

### Contract

`btc_pred_v8.aleo` — Leo 3.4.0. One record type (BetReceipt, output-only). 11 on-chain mappings. 7 transitions.

| Function | Who | What |
|---|---|---|
| `bet(rid, amt, side, salt)` | Anyone | Place bet, store commitment, get receipt |
| `claim(rid, side, amt, salt, payout)` | Anyone | Reveal preimage, receive winnings |
| `forfeit(rid, side, amt, salt)` | Anyone | Reveal preimage, release losing bet |
| `create_round(rid, target, deadline, seed)` | Admin | Start new round with dark pool |
| `resolve(rid, price, yes, no)` | Admin | End round, reveal pools |
| `init_admin()` | Once | Set admin address |
| `withdraw_fees(amt)` | Admin | Withdraw platform fees |

### Auto-Resolver

Node.js service on Railway. Fetches BTC/USD from Pyth Network. Creates rounds, monitors block height, resolves on deadline, loops. Tracks per-side bet totals for dark pool reveal.

---

## Running Locally

```bash
git clone https://github.com/shaibuafeez/dart.git && cd dart

# Frontend
npm install && npm run dev

# Contract
cd btc_pred_v8 && leo build

# Backend
cd backend && npm install && npm run build && npm start
```

**Testing:** Install [Shield Wallet](https://www.shieldwallet.xyz/) → bridge USDCx at [usdcx.aleo.dev](https://usdcx.aleo.dev/) → connect on Markets page → bet.

---

## Evolution

| Version | What Broke → What We Built |
|---|---|
| v1-v2 | First working prediction market on Aleo |
| v3 | Bets were public → private BetReceipt records + reputation |
| v4 | Custom token friction → native Aleo credits |
| v5 | Credits too volatile → USDCx stablecoin (u128 precision) |
| v6 | Record-based claims were complex → mapping-based claims |
| v7 | Pool composition leaked sentiment → dark pool + private bet sides |
| **v8** | **Wallet couldn't reliably pass records → ZK commitment scheme, all-scalar claims** |

8 iterations, each driven by a real failure. Not planned architecture — evolved architecture.

---

## What We Solved (v7 → v8)

| Problem in v7 | How v8 Fixed It |
|---|---|
| Claims required record inputs — wallet failed intermittently | Commitment scheme with all-scalar claims |
| BetSlot model — users stuck if wallet couldn't decrypt | No records needed. Claim with scalars. |
| ~61 USDCx permanently locked (no drain function) | Seed funds now recoverable by admin |
| Single-bet-per-slot — had to claim before betting again | No slots. Bet on any round, any time |

## Roadmap

- **Encrypted salt backup** — wallet-derived key encryption so claims survive browser clears
- **Multi-sig admin** — decentralize round creation and resolution
- **On-chain pool verification** — trustless dark pool split via ZK commitment aggregation
- **Multi-asset markets** — ETH, SOL, and custom prediction markets beyond BTC

Privacy deep-dive: [PRIVACY_ARCHITECTURE.md](PRIVACY_ARCHITECTURE.md)

---

## Deployment

| Component | Location | Details |
|---|---|---|
| Contract | Aleo Testnet | `btc_pred_v8.aleo` at `aleo1v5wrxmqe2urj30wqxyhnfymghw03kcdgu2pdcv7hhlw3z2vcs5rqwl2f7e` |
| Frontend | Vercel | Auto-deploys from `main` branch |
| Resolver | Railway | Pyth oracle, configurable round duration |
| Token | Aleo Testnet | `test_usdcx_stablecoin.aleo` (USDCx) |

---

## Links

| | |
|---|---|
| **GitHub** | [github.com/shaibuafeez/dart](https://github.com/shaibuafeez/dart) |
| **USDCx Bridge** | [usdcx.aleo.dev](https://usdcx.aleo.dev/) |
| **Shield Wallet** | [shieldwallet.xyz](https://www.shieldwallet.xyz/) |
| **Aleo Explorer** | [testnet.explorer.provable.com](https://testnet.explorer.provable.com) |

---

**Built for WaveHack.** The first prediction market where fast rounds are actually usable — because the order flow is invisible.
