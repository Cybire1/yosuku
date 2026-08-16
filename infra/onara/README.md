# Onara gas station — sponsored Yosuku actions

Each file in `policies/` defines the exact Move targets and command kinds that
one sponsored Yosuku flow may execute. Account setup remains separately
restricted to one `predict::create_manager` call.

`yosuku-vault-729` covers BOTH vault624 instances on package `0x51ed6dea`, because
Onara matches on target (`pkg::module::function`), not on the object a call touches.
That means it needs both subscription entrypoints, and dropping either one silently
breaks a product:

- `subscribe_with_risk` — the copy-desk join (`buildJoinDesk624`)
- `subscribe` — trade-from-X "Fund X wallet" (`buildEnableTweetTrading624`)

The 6-24 policy allowed `subscribe`; the 7-29 port carried over only
`subscribe_with_risk`. Every Fund X wallet transaction bundles deposit + subscribe,
and a PTB is declined unless EVERY call is allowlisted, so funding fell back to
wallet-paid gas. For users we onboard without SUI, which is the entire premise of
the X flow, that fallback cannot succeed. Restored 2026-08-11.

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

Clients check `GET /status` before asking Onara to sponsor an eligible action.
When sponsorship is unavailable they surface the unavailable state or use the
flow's explicit wallet-paid fallback; they must never silently broaden policy.

## Flow

1. App builds an allowlisted transaction with `setGasOwner(sponsor)`.
2. User signs in their wallet (authorization only, pays nothing).
3. `POST /sponsor` — Onara checks the policy, co-signs as gas owner, executes.

Keep the sponsor wallet topped up with testnet SUI; check balances at
`GET /status`.

`yosuku-creator-recovery` sponsors the two-stage creator setup and later recovery claims. The
first transaction is signed by zkLogin and registers a 1-of-2 zkLogin + passkey controller. The
second is signed by that controller and atomically mints + attaches its DeepBook BuilderCode.
Both targets are required: allowing mint without finalization would create an unindexed fee code,
while allowing registration without the controller signature would not prove recoverability.
