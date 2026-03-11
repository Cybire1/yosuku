# DART Protocol

<p align="center">
  <img src="https://img.shields.io/badge/Aleo-Testnet-blue" alt="Aleo Testnet">
  <img src="https://img.shields.io/badge/Leo-v3.4.0-green" alt="Leo v3.4.0">
  <img src="https://img.shields.io/badge/USDCx-Stablecoin-purple" alt="USDCx">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License">
</p>

**A prediction market where nobody can see your bet.**

DART lets you bet on BTC price movements using USDCx stablecoins. What makes it different: your bet side is never revealed until you choose to claim. Not to other traders, not to observers, not even to the contract admin. The pool itself operates as a dark pool — only the combined total is visible while betting is active.

This isn't a privacy wrapper on top of a public market. The entire protocol is designed around Aleo's ZK circuit — the privacy is the product.

> **Live on Aleo Testnet** | Contract: [`btc_pred_v8.aleo`](https://testnet.explorer.provable.com) | [Shield Wallet](https://www.shieldwallet.xyz/)

---

## What Happens When You Place a Bet

Here's what an on-chain observer sees when Alice bets 10 USDCx on YES for BTC hitting $72,000:

```
On Polymarket:                          On DART:
─────────────────────────────           ─────────────────────────────
Alice bets YES, $10                     Alice calls bet()
Pool: YES $8,420 / NO $6,310           Pool total: $14,740
Odds shift to 57/43                     Pool total: $14,750
Everyone adjusts their bets             Nobody knows anything changed
Bob front-runs with $500 on YES         Bob sees nothing to front-run
```

This is possible because of three things happening simultaneously:

1. **Alice's bet side is a private input** — it enters the ZK circuit but never appears on-chain
2. **The contract stores `hash(YES, 10, random_salt)`** — a commitment that can't be reversed without Alice's salt
3. **Only the combined pool total updates** — per-side breakdown stays hidden until resolution

After the round ends, Alice reveals her commitment to claim. By then, the market is settled — there's nothing left to front-run.

---

## Why This Requires Aleo

This protocol cannot exist on Ethereum, Solana, or any transparent blockchain. Here's why:

**On Ethereum/Solana**, a `bet(side, amount)` function call puts `side` in the transaction calldata. Everyone sees it. You can try to encrypt it, but:
- The contract needs to update per-side pool totals → those pool changes reveal the side
- Even with commit-reveal schemes, the pool update happens at commit time
- MEV bots see the pending transaction in the mempool before it's even confirmed

**On Aleo**, the `bet()` transition takes `side` and `salt` as **private inputs**. The ZK circuit:
- Computes `hash(side, amount, salt)` inside the proof
- Updates only the combined pool total (public)
- Never exposes which side received the funds
- Returns an encrypted `BetReceipt` that only Alice can read

The private input mechanism is native to Aleo's execution model — it's not bolted on. The proof guarantees the bet is valid without revealing what it is.

---

## The Commitment Scheme

Every bet creates a binding commitment:

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

To claim winnings later:

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

The critical property: `claim()` takes **all scalar inputs**. No records are consumed. The wallet doesn't need to find, decrypt, or pass any records. This is a deliberate design choice — [see Design Decisions](#design-decisions) for why.

---

## Dark Pool

During active betting, the contract exposes a single number: the combined pool total.

```
Active Round #9 (as seen by any observer):
┌────────────────────────────────┐
│  Target: BTC > $71,594         │
│  Total Pool: 3,000,000 USDCx  │
│  YES Pool: ???                 │
│  NO Pool:  ???                 │
│  Deadline: block 15,092,325    │
└────────────────────────────────┘

After Resolution:
┌────────────────────────────────┐
│  Target: BTC > $71,594         │
│  Total Pool: 3,000,000 USDCx  │
│  YES Pool: 1,000,000           │  ← revealed
│  NO Pool:  2,000,000           │  ← revealed
│  Outcome: NO won               │
└────────────────────────────────┘
```

The resolver bot tracks per-side totals off-chain and submits them at resolution. The contract enforces `yes_total + no_total == pool_total` — the admin can't inflate or deflate the pool.

---

## Design Decisions

Building through 8 contract versions taught us things that aren't obvious from documentation.

### Why not records for claims? (v7 → v8)

v7 used a `BetSlot` record model (inspired by [ZKPerp](https://github.com/hwdeboer1977/ZKPerp)'s slot system). Users received a record with their bet data and passed it back to `claim()`. Elegant in theory.

In practice, Shield Wallet's `requestRecords` intermittently fails with *"Could not establish connection. Receiving end does not exist."* Users could bet but couldn't claim. We built a [debug page](/test-wallet) to isolate the issue and confirmed it's a wallet-level reliability problem, not an origin or permissions issue.

v8's commitment scheme eliminates record inputs entirely. Claims use scalar values (round ID, side, amount, salt, payout). The wallet only needs `executeTransaction` — which works reliably.

### Why random salt, not deterministic?

We initially tried deriving salt from `SHA-256(address + roundId + side + amount)`. Seems cleaner than localStorage.

It's broken. All inputs except `side` are publicly visible on-chain. `side` is binary (YES or NO). An attacker computes both hashes and compares against the stored commitment. Two guesses, guaranteed crack.

We then tested Shield Wallet's `signMessage` for deterministic-but-secret salt derivation. It works, but **signing the same message twice produces different signatures**. Non-deterministic signatures can't reproduce the same salt at claim time.

Random salt stored in browser localStorage is the only approach that works. The tradeoff: clearing browser data means losing the ability to claim. Users are warned.

### Why short mapping names?

Leo 3.4.0 has a 31-byte identifier limit. `finalize_transfer_private_to_public` doesn't compile. All mappings use 2-letter names (`rt` for round target, `rp` for round pool, etc.). Ugly but necessary.

### Why parimutuel, not AMM?

Prediction markets have binary outcomes (YES/NO). AMM curves (Uniswap-style) create artificial slippage that doesn't reflect actual probability. Parimutuel pooling — where winners split the losers' pool proportionally — is mathematically simpler and better suited to binary events. It's what Polymarket uses under the hood.

---

## System Overview

```
                    ┌─────────────────────────────┐
                    │        DART Frontend         │
                    │  Next.js 16 + Shield Wallet  │
                    │                              │
                    │  Markets ─ Portfolio ─ Voice  │
                    │  Live BTC Chart ─ Dark Pool  │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────┴───────────────┐
                    │      Aleo Testnet             │
                    │                               │
                    │  btc_pred_v8.aleo              │
                    │  ├─ Commitments (bc, ba)       │
                    │  ├─ Dark Pool (rp, ry, rn)     │
                    │  ├─ Outcomes (ro, rt, rd)       │
                    │  └─ Claims (cl, fe)             │
                    │                               │
                    │  test_usdcx_stablecoin.aleo   │
                    │  └─ USDCx balances + transfers │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────┴───────────────┐
                    │     Auto-Resolver (Railway)   │
                    │  Pyth oracle ─ Round lifecycle │
                    │  Create ─ Monitor ─ Resolve   │
                    └─────────────────────────────┘
```

### Frontend

Next.js 16, TypeScript, Tailwind 4, Framer Motion. Live BTC price via Binance WebSocket. Polymarket-style probability display. Voice agent powered by Google Gemini 2.0 Live API.

| Page | Purpose |
|---|---|
| `/markets` | Active round, betting panel, live chart |
| `/portfolio` | Positions, P&L, claim/forfeit |
| `/how-it-works` | Privacy architecture explained |
| `/leaderboard` | Top predictors |
| `/test-wallet` | Shield Wallet capability testing |

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

## Version History

DART has been through 8 contract iterations. Each solved a specific problem:

| Version | Problem It Solved |
|---|---|
| v1-v2 | None — first working prediction market on Aleo |
| v3 | Bets were public → added private BetReceipt records + reputation tiers |
| v4 | Custom token friction → switched to native Aleo credits |
| v5 | Credits too volatile → integrated USDCx stablecoin (u128 precision) |
| v6 | Record-based claims were complex → mapping-based claims |
| v7 | Pool composition leaked sentiment → added dark pool + private bet sides |
| **v8** | **Wallet couldn't reliably provide records for claims → ZK commitment scheme with all-scalar claims** |

8 iterations, each driven by a real problem encountered during testing. Not planned architecture — evolved architecture.

---

## Deployment

| Component | Location | Details |
|---|---|---|
| Contract | Aleo Testnet | `btc_pred_v8.aleo` at `aleo1v5wrxmqe2urj30wqxyhnfymghw03kcdgu2pdcv7hhlw3z2vcs5rqwl2f7e` |
| Frontend | Vercel | Auto-deploys from `main` branch |
| Resolver | Railway | Pyth oracle, configurable round duration |
| Token | Aleo Testnet | `test_usdcx_stablecoin.aleo` (USDCx) |

---

## Known Limitations

- **Salt in localStorage**: Clearing browser = can't claim. No recovery mechanism yet.
- **Single admin key**: Round creation and resolution are centralized. Multi-sig planned.
- **Off-chain pool tracking**: The dark pool reveal at resolution relies on the bot's per-side tally. The contract verifies the total matches, but can't independently verify the split.
- **Locked seed funds**: `create_round` seed amounts are permanently locked (no admin drain function). ~61 USDCx lost in v7.
- **Oracle trust**: Resolution price comes from admin via Pyth. Decentralized oracles don't support Aleo yet.

Full assessment: [LIMITATIONS.md](LIMITATIONS.md) | Privacy deep-dive: [PRIVACY_ARCHITECTURE.md](PRIVACY_ARCHITECTURE.md)

---

## Links

| | |
|---|---|
| **GitHub** | [github.com/shaibuafeez/dart](https://github.com/shaibuafeez/dart) |
| **USDCx Bridge** | [usdcx.aleo.dev](https://usdcx.aleo.dev/) |
| **Shield Wallet** | [shieldwallet.xyz](https://www.shieldwallet.xyz/) |
| **Aleo Explorer** | [testnet.explorer.provable.com](https://testnet.explorer.provable.com) |

---

**Built for WaveHack.** A prediction market that treats your bets like they're nobody else's business.
