<div align="center">

# YOSUKU 

### The consumer layer for DeepBook Predict.

Predict directly from X, with leverage, private trading, and agent strategies. On web and a native iOS + Android app.

<br/>

[![Sui](https://img.shields.io/badge/Sui-Testnet-6FBCF0?style=for-the-badge)](https://sui.io)
[![DeepBook Predict](https://img.shields.io/badge/DeepBook-Predict-E04D26?style=for-the-badge)](https://docs.sui.io/onchain-finance/deepbook-predict)
[![Walrus](https://img.shields.io/badge/Walrus-MemWal%20·%20Seal-7C5CFC?style=for-the-badge)](https://walrus.xyz)
[![Nautilus](https://img.shields.io/badge/Nautilus-TEE-111111?style=for-the-badge)](https://github.com/MystenLabs/nautilus)

[![npm](https://img.shields.io/npm/v/@yosuku/deepbook-predict?style=flat-square&label=%40yosuku%2Fdeepbook-predict&color=E04D26)](https://www.npmjs.com/package/@yosuku/deepbook-predict)
[![MCP](https://img.shields.io/npm/v/@yosuku/deepbook-predict-mcp?style=flat-square&label=mcp&color=7C5CFC)](https://www.npmjs.com/package/@yosuku/deepbook-predict-mcp)
[![License](https://img.shields.io/badge/license-MIT-yellow?style=flat-square)](LICENSE)

**[Live → yosuku.xyz](https://yosuku.xyz)**  ·  **[SDK](https://www.npmjs.com/package/@yosuku/deepbook-predict)**  ·  **[Demo](https://x.com/yosuku0/status/2052336134387114053)**  ·  **[X → @yosuku0](https://x.com/yosuku0)**  ·  *Sui Overflow 2026, DeepBook Predict track*

</div>

---

<div align="center">

**Tweet "@yosuku BTC up 3x" and an AI agent opens that exact position on-chain, from a vault only you can withdraw from.<br/>It trades your money. It cannot take it. Proven on-chain: user +0.953 DUSDC, agent ±0.000.**

</div>

---

## Contents

[The problem](#the-problem) · [What Yosuku is](#what-yosuku-is) · [The everyday loop](#the-everyday-loop) · [How predict-from-X works](#how-predict-from-x-works) · [The Sui stack](#how-we-used-the-sui-stack) · [Proven on-chain](#proven-on-chain) · [Traction](#traction) · [Quickstart](#quickstart) · [Roadmap](#roadmap)

---

## The problem

[DeepBook Predict](https://docs.sui.io/onchain-finance/deepbook-predict) is a beautiful primitive: an oracle-settled, volatility-priced binary market that needs no order book and no counterparty, where the **oracle, not a committee vote, decides the outcome.** That settlement integrity is **Mysten's**, and it is the right foundation.

But a primitive is not a product. Out of the box there is **no consumer app, no SDK, and no safe way for an agent to trade it.** Almost nobody can use it.

## What Yosuku is

> **Yosuku is the layer that makes DeepBook Predict usable, by people, by developers, and by agents.** We did not reinvent the market. We built everything around it that turns it into something real people and agents actually use, safely.

| | DeepBook Predict alone | **With Yosuku** |
|---|---|---|
| **People** | Raw Move calls, gas, seed phrases | One-tap UP/DOWN, **gasless** (sponsored), no seed phrase, a **TikTok-style live feed** you post your own take into, a faucet that finds you |
| **Mobile** | Nothing | A **native iOS + Android app** (Expo), installable today as an Android APK and an iOS TestFlight build, per-device non-custodial keys, full feature parity with web |
| **Social** | Nothing | **Predict directly from X**, post a call, a bounded executor opens it from your own un-drainable vault. No-divert enforced in Move, proven on-chain |
| **Agents** | No path | **Agent strategies**, subscribe to a creator's agent with a capped budget and zero withdrawal control, plus the attested **Bellkeeper** (decisions signed in a Nitro enclave, verified on-chain) |
| **Money** | Funds stranded across wallet, managers, escrow | One **Trading Balance**, deposit once and route into normal / private / leverage / agentic trades, withdraw anytime |
| **Developers** | Read the contract yourself | The **first TypeScript SDK** and the **first MCP server**, quote, trade, and build in a few lines |
| **Markets** | One bell at a time | **Streak parlays**, stack 2 to 3 BTC bells into one ticket, the odds multiply but every leg has to land |

## The everyday loop

Open the app and you land in a **live feed**, one full-screen BTC market at a time, its price drawing itself in, the clock counting down. Swipe up for the next. Tap **UP** or **DOWN** and you are in: gasless, no seed phrase, settled by the oracle.

Want your own market? **Post a take**, drag a strike line to the price you are calling, scrub the horizon to when it closes, slide to confirm. Your prediction is the post.

Underneath it all sits one **Trading Balance**: deposit DUSDC once, and leverage, private trades, and fast repeat bets draw from the same prefunded account. Withdraw to your wallet anytime.

## How predict-from-X works

The headline: **a tweet becomes a verifiable on-chain trade, opened by an executor that provably cannot run off with your money.**

```mermaid
flowchart LR
  T["You tweet<br/>'@yosuku BTC up 3x'"] --> R["Relay reads<br/>the mention"]
  R --> V["social_vault::agent_trade<br/>(bounded executor key,<br/>owner hard-wired to YOU)"]
  V --> F["margin::fill →<br/>DeepBook Predict mint"]
  F --> S["Oracle settles<br/>at the bell"]
  S --> U["Force-paid to YOU<br/>agent cannot divert (enforced in Move)"]
```

The guarantee is **structural, not a promise**: `agent_trade` hard-wires the position owner to you and `withdraw` is owner-gated, so even a fully prompt-injected executor can only move your funds into your own position. This is the answer to the agent-drain class (Grok, Bankr), and it is verifiable by reading the Move source.

The autonomous **Bellkeeper** agent goes one step further: its decisions are ed25519-signed inside an **AWS Nitro enclave** and verified on-chain (Sui's native `nitro_attestation`, genuine PCRs pinned) before the vault releases funds. See [Proven on-chain](#proven-on-chain).

## How we used the Sui stack

Composed, not bolted on.

| Primitive | How Yosuku uses it |
|---|---|
| **DeepBook Predict** | The core markets: `mint` / `redeem` / `mint_range`, SVI to N(d2) pricing reconstructed to roughly half-a-cent parity against the on-chain quote, the PLP vault as counterparty. |
| **Move** | Our moat: a no-divert custody (`social_vault::agent_trade` hard-wires the owner, `withdraw` is owner-gated) that powers predict-from-X and copy-trade strategies. Plus an attested-action verifier (single-PTB hot-potato + replay guard) for the Bellkeeper, a `yolev` layer (underwriting reserve, margin desk, parlay reserve), and a `TradingVault` account vault. |
| **Nautilus (TEE)** | The autonomous Bellkeeper agent signs its decisions inside a Nitro enclave; the attestation is verified on-chain by Sui's native `nitro_attestation` before the vault acts. |
| **Walrus + Seal via MemWal** | Agent strategies are MemWal-backed: each strategy capsule pins a Seal-encrypted playbook on Walrus and a pointer to the agent's MemWal memory (the reasoning behind its trades), and the agent writes each decision to Walrus as a verifiable audit trail. |
| **Sponsored gas** | Gasless onboarding on web and mobile, "never used Sui" to placed-a-bet in two taps, no seed phrase. |

## Proven on-chain

> DeepBook Predict is testnet-only, so the whole track is testnet. Everything below is real, click it.

| Claim | Proof |
|---|---|
| **No-divert predict-from-X** — an executor fills your order but **cannot divert** the proceeds | proven: user **+0.953 DUSDC**, agent **±0.000** |
| **Attested agent trade** — Bellkeeper decision signed in the enclave, attestation verified on-chain, caps re-checked, position minted | [tx `9zN7Jac…`](https://suiscan.xyz/testnet/tx/9zN7JacN5AdzKLRHRh5vDDocx5CTns6HqFSrfWEavAbj) |
| **Real Nitro attestation** — genuine PCRs pinned on-chain via Sui's native verifier | [tx `6gczxvyR…`](https://suiscan.xyz/testnet/tx/6gczxvyRXMUeub6GVU7xennCgXb2kahyjg3eRzqzjLzH) |
| **Parlays (multi-leg AND-combo)** — stack N bells, all must win; full lifecycle | [open](https://suiscan.xyz/testnet/tx/22RYaGccku5NprXZLDmtGEA8k7cWPyNyueHwjN4QCxiD) → resolve → [claim](https://suiscan.xyz/testnet/tx/5AmZGc2bp2hBGycVeMEdaJt3d14NTBByrkc6LSZcwJC1), plus the [early-kill](https://suiscan.xyz/testnet/tx/CC2V5dDEYmYMQHb7Ueb3UeBJwEMsHAgYj5GrYZovsdNj) |
| **Leverage** — margin desk with real liquidations on recovered value | 12 liquidations proven on-chain |
| **Trading Balance** — one account routes normal / private / leverage trades, withdrawals owner-only | shared `TradingVault<DUSDC>` live, 59/59 Move tests, wired into web (deposit, withdraw, leverage, private) |
| **First SDK for DeepBook Predict** | [`@yosuku/deepbook-predict`](https://www.npmjs.com/package/@yosuku/deepbook-predict) (v0.3.0, 198 installs) |
| **First MCP server** — let any LLM trade Predict | [`@yosuku/deepbook-predict-mcp`](https://www.npmjs.com/package/@yosuku/deepbook-predict-mcp) (v0.1.0, 172 installs) |

## Traction

Testnet, to date: **42 connected wallets · 18 wallets placed trades · 71 on-chain Predict transactions · 36 waitlist signups · 12 TestFlight requests.** Developer pull: about **1,870 npm installs** combined across the @yosuku Predict packages (`@yosuku/deepbook-predict` 198, `@yosuku/deepbook-predict-mcp` 172, `@yosuku/predict` 1,504).

## Quickstart

```bash
git clone https://github.com/Cybire1/yosuku.git
cd yosuku
npm install
npm run dev          # → http://localhost:3000
```

Connect a Sui wallet, the faucet auto-surfaces test DUSDC, pick a live BTC market, take a side, the oracle settles at the bell. Gas is sponsored, so the first trade is free.

## Roadmap

- **Now** (live on testnet): gasless consumer markets, the TikTok-style feed + post-a-take composer, a native iOS + Android app, predict-from-X (no-divort, proven on-chain), agent strategies, streak parlays, the leverage desk, the Trading Balance account, and the SDK + MCP.
- **Next**: bind the live Nitro enclave as the signer for the agentic flows (the attestation is verified on-chain today; wiring the enclave key into predict-from-X is the remaining step), an always-on public X listener, more assets.
- **Later**: mainnet the day DeepBook Predict does; `@yosuku/deepbook-predict` as the primitive other builders ship on.

<details>
<summary><b>Key addresses & honest limitations</b></summary>

<br/>

| What | ID (testnet) |
|---|---|
| DeepBook Predict package | `0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138` |
| DUSDC coin type | `0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC` |
| Strategy + social-vault (no-divert) package | `0x47d3c108b2165cb1190eefd0b67f73a386e8ca71b870f87a9afb096056795388` |
| yolev leverage package | `0x75e00dc36b96cc4adafd4b180c791f7a0fb40aed92fd11c40968227fc6318a36` |
| Trading Balance package | `0x3b76383b2bb9bc411dc56c571a1da22f348b3c19518115ae958fe96e031cf30e` |
| `TradingVault<DUSDC>` | `0xc04516b582bfe73c71325408bfb9e9a5a8fdcd54952a313a288a135e272fa1e6` |
| yolev parlay package | `0xd950420d3b3ac026c6f3b242010bec2dd2f7cdab6a7d68fb00087516094cbc02` |

**Limitations (we would rather you know):**
- **Testnet only.** DeepBook Predict is testnet today; mainnet IDs will change.
- **BTC only.** More assets at mainnet.
- **Predict-from-X is no-divort and proven on-chain, but the always-on public X listener is not running yet.** The mechanism and the proof are real; the live "tweet at it and wait" bot is the remaining step.
- **The Nitro enclave is registered on-chain with genuine PCRs, but it is not yet the signer for the live agentic flows.** The attested-agent trade is proven; binding the enclave key into predict-from-X is remaining work.
- **Private Balance is link-reduction, not full cryptographic privacy.** Full unlinkability needs the pool/proof/relayer (Vortex) layer.
- **About 2 percent round-trip spread**, shown transparently, never hidden.

</details>

---

<div align="center">

**Yosuku does not reinvent prediction markets. DeepBook Predict already settles them honestly.<br/>We make that primitive usable by people, buildable by developers, and tradeable by agents, with custody users cannot lose.**

[yosuku.xyz](https://yosuku.xyz) · [@yosuku0](https://x.com/yosuku0)

</div>
