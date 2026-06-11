# Onara gas station — sponsored account setup

Sponsors exactly one thing: `predict::create_manager` (the one-time trading
account). The policy in `policies/` allowlists only that Move call with a
1-call limit, so the sponsor wallet cannot be drained for anything else.

## Deploy (once)

```bash
git clone https://github.com/unconfirmedlabs/onara && cd onara/api
bun install
wrangler secret put SUI_MNEMONIC        # fresh testnet-only mnemonic, fund it with SUI from faucet.sui.io
# set in wrangler.jsonc vars: SUI_NETWORK=testnet, SUI_GRPC_URL=<testnet grpc>
bun run deploy --config /Users/cyber/sui-predict/infra/onara
```

The deploy script reads `policies/*.json` from this directory.

## Wire the app

```bash
# .env.local
NEXT_PUBLIC_ONARA_URL=https://<your-worker>.workers.dev
```

`components/AccountSetup.tsx` checks `GET /status` on mount: if the station is
reachable, the setup button reads "Set up account — free" and the sponsor pays
gas; if not, it falls back to user-paid setup automatically. No env var, no
behavior change — safe to ship before the worker exists.

## Flow

1. App builds `create_manager` tx with `setGasOwner(sponsor)` (gas coins
   resolve from the sponsor's address — public data).
2. User signs in their wallet (authorization only, pays nothing).
3. `POST /sponsor` — Onara checks the policy, co-signs as gas owner, executes.

Keep the sponsor wallet topped up with testnet SUI; check balances at
`GET /status`.
