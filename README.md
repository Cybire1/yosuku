# Yosuku — prediction markets, made usable

<p align="center">
  <img src="https://img.shields.io/badge/Sui-Testnet-6FBCF0" alt="Sui Testnet">
  <img src="https://img.shields.io/badge/DeepBook-Predict-E04D26" alt="DeepBook Predict">
  <img src="https://img.shields.io/badge/Walrus-MemWal%20%2B%20Seal-7C5CFC" alt="Walrus">
  <img src="https://img.shields.io/badge/Nautilus-TEE-black" alt="Nautilus TEE">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License">
</p>

**Submission: Sui Overflow 2026 — DeepBook Predict track.** Live at **[yosuku.xyz](https://yosuku.xyz)**.

---

## The problem

[DeepBook Predict](https://docs.sui.io/onchain-finance/deepbook-predict) is a powerful primitive: an oracle-settled, volatility-surface-priced binary options market that needs no order book and no counterparty — a fair quote exists from the first second, and the oracle (not a committee vote) decides the outcome at expiry. That settlement integrity is **DeepBook Predict's**, and it's excellent.

But a primitive is not a product. Out of the box there is **no consumer app, no SDK, and no way for an autonomous agent to trade it.** Almost nobody can use it.

## What Yosuku is

**Yosuku is the layer that makes DeepBook Predict usable — by people, by developers, and by agents.**

- **A front door for people.** One-tap UP/DOWN on BTC, settled at "the bell." Google sign-in via **zkLogin** (no seed phrase), **gasless** trades via a sponsored gas station, and a faucet that comes to you. We lower the bar to DeFi instead of raising it.
- **A toolkit for developers.** The **first TypeScript SDK** (`@yosuku/deepbook-predict`) and the **first MCP server** for DeepBook Predict — so anyone (or any LLM) can quote, trade, and build on it in a few lines.
- **An autonomous desk for agents.** The **Bellkeeper** — an attested agent that trades a contract-custodied vault, with authority bounded *on-chain*, not by trust. And **trade-from-X**: tweet a trade, the attested agent executes it from your own un-drainable vault.

We did not invent the market. We built everything around it that turns it into something real people and agents use.

---

## How we used the Sui stack

This is composed, not bolted on — five primitives, woven together with on-chain receipts.

| Primitive | How Yosuku uses it |
|---|---|
| **DeepBook Predict** | The core markets — `mint` / `redeem` / `mint_range`, SVI → N(d2) pricing, the PLP vault as counterparty. The thing we build on. |
| **Move** | Our own moat: a contract-custodied agent vault that re-verifies an enclave attestation, re-checks hard caps, guards replay, and force-pays the position owner — the agent *provably* can't overspend or divert. Plus our `yolev` leverage layer (underwriting reserve + margin desk). |
| **Nautilus (TEE)** | The Bellkeeper signs every decision inside an enclave; the signature is verified **on-chain in the same transaction** that places the trade. |
| **Walrus + MemWal** | Verifiable agent memory — every lesson the agent learns is SEAL-encrypted, stored on Walrus, owned by a Sui account, and **carries the on-chain tx that taught it**. Decision/audit records are pinned by blob id on-chain. |
| **Seal** | Encrypts the agent's memory and strategy data over Walrus. |
| **zkLogin + sponsored gas** | Google sign-in and gasless trades — a first-time user goes from "never used Sui" to a placed bet in a couple of taps. |

---

## Proven on-chain (testnet)

> DeepBook Predict is testnet-only, so the whole track is testnet. Everything below is real, on Sui testnet — click the digests.

- **Attested agent trade** — one PTB verified the enclave signature on-chain (`attestation_verifier::verify`), re-checked caps, and minted a Predict position: tx [`9zN7JacN5AdzKLRHRh5vDDocx5CTns6HqFSrfWEavAbj`](https://suiscan.xyz/testnet/tx/9zN7JacN5AdzKLRHRh5vDDocx5CTns6HqFSrfWEavAbj).
- **Trade-from-X, un-drainable** — a per-user `social_vault` + `request_open_for`: the agent fills the user's order but **cannot divert the proceeds** (proven: user +0.953 DUSDC, agent ±0.000).
- **Leverage desk** — the `yolev` underwriting reserve is live and funded on testnet (`request_open → keeper-fill → settle`); the margin desk (borrow + mark-to-market liquidation) is deployed.
- **SDK** — [`@yosuku/deepbook-predict`](https://www.npmjs.com/package/@yosuku/deepbook-predict) published to npm; [`@yosuku/deepbook-predict-mcp`](https://www.npmjs.com/package/@yosuku/deepbook-predict-mcp) for MCP clients.

### Key addresses (testnet)

| What | ID |
|---|---|
| DeepBook Predict package | `0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138` |
| DUSDC coin type | `0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC` |

---

## What's in the repo

| Area | Where |
|---|---|
| Consumer app (Next.js) | this repo — `/markets`, `/markets/[id]`, `/portfolio`, `/pool`, `/earn`, `/leaderboard`, `/docs` |
| SDK + MCP | [`yosuku-lab/predict-sdk`](https://github.com/yosuku-lab/predict-sdk) (`@yosuku/deepbook-predict`) |
| Move contracts (vault / attestation / leverage), the agent, the enclave, trade-from-X relay | the `suioverflow` monorepo |

The primary user journey: **land → pick a live BTC market → take a side (gasless, zkLogin) → the oracle settles at the bell → claim / cash out → portfolio.**

---

## Run locally

```bash
git clone https://github.com/Cybire1/yosuku.git
cd yosuku
npm install
npm run dev            # http://localhost:3000
```

Testnet flow: connect (Google via zkLogin or any Sui wallet) → the faucet auto-surfaces test DUSDC → pick a market → take a side → settle at the bell.

---

## Honest limitations

- **Testnet only.** DeepBook Predict is testnet today; mainnet IDs will change when it ships.
- **BTC only.** The live markets are Bitcoin; more assets at mainnet.
- **The enclave attestation is verified on-chain, but the PCRs are currently dev-stub** — real Nitro PCRs are a fresh redeploy away (gated on a provisioned AWS Nitro EC2). The signature/caps/replay moat is real today; the hardware measurement is the remaining piece.
- **~2% round-trip spread**, shown transparently, never hidden.

---

## Links

| | |
|---|---|
| **Live app** | [yosuku.xyz](https://yosuku.xyz) |
| **SDK (npm)** | [@yosuku/deepbook-predict](https://www.npmjs.com/package/@yosuku/deepbook-predict) |
| **MCP server** | [@yosuku/deepbook-predict-mcp](https://www.npmjs.com/package/@yosuku/deepbook-predict-mcp) |
| **X** | [@yosuku0](https://x.com/yosuku0) |
| **Sui explorer** | [suiscan.xyz/testnet](https://suiscan.xyz/testnet) |

---

Yosuku doesn't reinvent prediction markets — DeepBook Predict already settles them honestly. **We make that primitive usable by people, buildable by developers, and tradeable by agents.**
