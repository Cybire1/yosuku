<div align="center">

# YOSUKU

### Prediction markets, made usable.

A consumer front door, a developer SDK, and an autonomous attested agent — all on **[DeepBook Predict](https://docs.sui.io/onchain-finance/deepbook-predict)**.

<br/>

[![Sui](https://img.shields.io/badge/Sui-Testnet-6FBCF0?style=for-the-badge)](https://sui.io)
[![DeepBook Predict](https://img.shields.io/badge/DeepBook-Predict-E04D26?style=for-the-badge)](https://docs.sui.io/onchain-finance/deepbook-predict)
[![Walrus](https://img.shields.io/badge/Walrus-MemWal%20·%20Seal-7C5CFC?style=for-the-badge)](https://walrus.xyz)
[![Nautilus](https://img.shields.io/badge/Nautilus-TEE-111111?style=for-the-badge)](https://github.com/MystenLabs/nautilus)

[![npm](https://img.shields.io/npm/v/@yosuku/deepbook-predict?style=flat-square&label=%40yosuku%2Fdeepbook-predict&color=E04D26)](https://www.npmjs.com/package/@yosuku/deepbook-predict)
[![MCP](https://img.shields.io/npm/v/@yosuku/deepbook-predict-mcp?style=flat-square&label=mcp&color=7C5CFC)](https://www.npmjs.com/package/@yosuku/deepbook-predict-mcp)
[![License](https://img.shields.io/badge/license-MIT-yellow?style=flat-square)](LICENSE)

**[Live → yosuku.xyz](https://yosuku.xyz)**  ·  **[SDK](https://www.npmjs.com/package/@yosuku/deepbook-predict)**  ·  **[X → @yosuku0](https://x.com/yosuku0)**  ·  *Sui Overflow 2026 — DeepBook Predict track*

</div>

> **Demo:** _add your 90-second demo video / GIF here_ — `docs/demo.gif`. Lead with the money-shot: a tweet becomes an attested on-chain trade.

---

<div align="center">

**The fastest, friendliest way to take a side on BTC — gasless, no seed phrase, settled by an oracle.<br/>And the only place an attested AI agent trades it for you, provably.**

</div>

---

## Contents

[The problem](#the-problem) · [What Yosuku is](#what-yosuku-is) · [How it works](#how-it-works) · [The Sui stack](#how-we-used-the-sui-stack) · [Proven on-chain](#proven-on-chain) · [Quickstart](#quickstart) · [Roadmap](#roadmap)

---

## The problem

[DeepBook Predict](https://docs.sui.io/onchain-finance/deepbook-predict) is a beautiful primitive — an oracle-settled, volatility-priced binary market that needs no order book and no counterparty, where the **oracle, not a committee vote, decides the outcome.** That settlement integrity is **Mysten's**, and it's the right foundation.

But a primitive isn't a product. Out of the box there's **no consumer app, no SDK, and no way for an agent to trade it.** Almost nobody can use it.

## What Yosuku is

> **Yosuku is the layer that makes DeepBook Predict usable — by people, by developers, and by agents.** We didn't reinvent the market. We built everything around it that turns it into something real people and agents actually use.

| | DeepBook Predict alone | **With Yosuku** |
|---|---|---|
| **People** | Raw Move calls, gas, seed phrases | One-tap UP/DOWN, **gasless**, **Google sign-in (zkLogin)**, faucet that finds you |
| **Developers** | Read the contract yourself | **First TypeScript SDK** + **first MCP server** — quote, trade, build in a few lines |
| **Agents** | No path | The **Bellkeeper** — an attested agent trading a contract-custodied vault, authority bounded *on-chain* |
| **Social** | — | **Trade-from-X** — tweet a trade, the attested agent executes it from your own un-drainable vault |
| **Markets** | One bell at a time | **Streak parlays** — stack 2–3 BTC bells into one ticket; the odds multiply, but every leg has to land |

## How it works

The headline: **a tweet becomes a verifiable on-chain trade, executed by an agent that provably can't run off with your money.**

```mermaid
flowchart LR
  T["You tweet<br/>'@yosuku BTC up 3x'"] --> R["Relay reads<br/>the mention"]
  R --> V["request_open_for<br/>(your social vault)"]
  V --> A["Bellkeeper<br/>signs inside a TEE"]
  A -->|signature verified<br/>on-chain, same tx| M["Move vault<br/>re-checks caps +<br/>attestation + replay"]
  M --> P["DeepBook Predict<br/>mint position"]
  P --> S["Oracle settles<br/>at the bell"]
  S --> U["Force-paid to YOU<br/>agent can't divert"]
```

Memory loop: every lesson the agent learns is SEAL-encrypted, stored on Walrus via MemWal, and **carries the on-chain tx that taught it** — so the agent's experience is as verifiable as its trades.

## How we used the Sui stack

Composed, not bolted on — five primitives woven together with on-chain receipts.

| Primitive | How Yosuku uses it |
|---|---|
| **DeepBook Predict** | The core markets — `mint` / `redeem` / `mint_range`, SVI → N(d2) pricing, the PLP vault as counterparty. |
| **Move** | Our moat — a contract-custodied agent vault that re-verifies the enclave attestation, re-checks hard caps, guards replay, and **force-pays the position owner**. Plus our `yolev` layer — an underwriting reserve, a margin desk, and a **parlay reserve** (escrow-both-sides AND-combo where the first losing leg kills the ticket). |
| **Nautilus (TEE)** | The Bellkeeper signs every decision in an enclave; the signature is verified **on-chain in the same tx** that places the trade. |
| **Walrus + MemWal** | Verifiable agent memory + on-chain-pinned decision/audit receipts. |
| **Seal** | Encrypts the agent's memory and strategy data over Walrus. |
| **zkLogin + sponsored gas** | Google sign-in and gasless trades — "never used Sui" → placed bet in two taps. |

## Proven on-chain

> DeepBook Predict is testnet-only, so the whole track is testnet. Everything below is real — click it.

| Claim | Proof |
|---|---|
| **Attested agent trade** — enclave signature verified on-chain, caps re-checked, position minted | [tx `9zN7Jac…` success](https://suiscan.xyz/testnet/tx/9zN7JacN5AdzKLRHRh5vDDocx5CTns6HqFSrfWEavAbj) |
| **Trade-from-X, un-drainable** — agent fills your order but **can't divert** the proceeds | proven (user +0.953 DUSDC, agent ±0.000) |
| **Parlays (multi-leg AND-combo)** — stack N bells, all must win; full lifecycle proven on-chain | [open](https://suiscan.xyz/testnet/tx/22RYaGccku5NprXZLDmtGEA8k7cWPyNyueHwjN4QCxiD) → resolve → [claim](https://suiscan.xyz/testnet/tx/5AmZGc2bp2hBGycVeMEdaJt3d14NTBByrkc6LSZcwJC1), plus the [early-kill](https://suiscan.xyz/testnet/tx/CC2V5dDEYmYMQHb7Ueb3UeBJwEMsHAgYj5GrYZovsdNj) |
| **First SDK for DeepBook Predict** | [`@yosuku/deepbook-predict`](https://www.npmjs.com/package/@yosuku/deepbook-predict) |
| **First MCP server** — let any LLM trade Predict | [`@yosuku/deepbook-predict-mcp`](https://www.npmjs.com/package/@yosuku/deepbook-predict-mcp) |

## Quickstart

```bash
git clone https://github.com/Cybire1/yosuku.git
cd yosuku
npm install
npm run dev          # → http://localhost:3000
```

Connect with Google (zkLogin) or any Sui wallet → the faucet auto-surfaces test DUSDC → pick a live BTC market → take a side → the oracle settles at the bell.

## Roadmap

- **Now** — live on testnet: gasless consumer markets, **streak parlays**, the SDK + MCP, the attested agent (on-chain verified), trade-from-X, the leverage desk.
- **Next** — real Nitro PCRs (the attestation is verified on-chain today; the hardware measurement is one redeploy away), more assets, leverage GA.
- **Later** — mainnet the day DeepBook Predict does; `@yosuku/deepbook-predict` as the primitive other builders ship on.

<details>
<summary><b>Key addresses & honest limitations</b></summary>

<br/>

| What | ID (testnet) |
|---|---|
| DeepBook Predict package | `0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138` |
| DUSDC coin type | `0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC` |
| yolev parlay package | `0xd950420d3b3ac026c6f3b242010bec2dd2f7cdab6a7d68fb00087516094cbc02` |
| `ParlayReserve<DUSDC>` | `0x939724d6fc82af88530368b06f952af0b7277d0da51bd419659a3bb1686c0851` |

**Limitations (we'd rather you know):**
- **Testnet only** — DeepBook Predict is testnet today; mainnet IDs will change.
- **BTC only** — more assets at mainnet.
- **The enclave attestation is verified on-chain, but the PCRs are currently dev-stub** — the signature / caps / replay moat is real today; the hardware measurement (real Nitro) is the remaining piece.
- **~2% round-trip spread** — shown transparently, never hidden.

</details>

---

<div align="center">

**Yosuku doesn't reinvent prediction markets — DeepBook Predict already settles them honestly.<br/>We make that primitive usable by people, buildable by developers, and tradeable by agents.**

[yosuku.xyz](https://yosuku.xyz) · [@yosuku0](https://x.com/yosuku0)

</div>
