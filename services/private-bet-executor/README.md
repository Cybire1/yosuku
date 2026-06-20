# Private Bet Executor

Standalone testnet executor for Yosuku private bets.

The current live mode is `sponsored-session-manager`:

- Yosuku web app asks this service to open/cash out a private ticket.
- The executor creates a fresh PredictManager per ticket.
- The executor funds that manager with testnet DUSDC, mints the Predict position, and stores the ticket locally.
- Cashout redeems from that ticket manager and credits the user's Yosuku Private Balance.
- Withdraw sends the credited Private Balance back to the user's connected wallet.

This is suitable for a controlled testnet beta/demo. It separates public Predict market activity from the user's wallet, but it is not full zk anonymity. A production user-funded private route still needs a wallet-signed Vortex deposit step before `/open` and a real proof-backed private withdraw path; do not present sponsored mode as non-custodial mainnet privacy.

## Env

```env
PRIVATE_BET_EXECUTOR_PORT=8787
PRIVATE_BET_SHARED_SECRET=change-me
EXECUTOR_PRIVATE_KEY=suiprivkey...
PRIVATE_BET_DUSDC_POOL=0x0
PRIVATE_BET_SPONSORED_BETA=1
PRIVATE_BET_MAX_STAKE_MICRO=2000000
PRIVATE_BET_OWNER_ALLOWLIST=
PRIVATE_BET_TICKET_STORE=services/private-bet-executor/.private-bet-tickets.json
```

The web app should point at the service:

```env
PRIVATE_BET_DUSDC_POOL=0x0
PRIVATE_BET_EXECUTOR_URL=http://127.0.0.1:8787
PRIVATE_BET_SHARED_SECRET=same-secret
```

For the sponsored beta, `PRIVATE_BET_DUSDC_POOL=0x0` is fine because the executor is not using Vortex proofs yet. If you upgrade to user-funded Vortex privacy, replace it with the real dUSDC pool object.

If `npm run private-bet:find-vortex-pool` fails against the default Vortex API domain, ask Interest/Vortex for the current API URL or the dUSDC pool object directly and set `PRIVATE_BET_DUSDC_POOL` manually.

## Run

```bash
npm run private-bet:executor
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

API surface:

```text
POST /open      -> opens a one-use manager position
POST /cashout   -> redeems and credits Private Balance
POST /withdraw  -> withdraws credited Private Balance to the owner wallet
```

## Important

This service needs:

- SUI gas on the executor address.
- Testnet DUSDC on the executor address for sponsored beta opens.
- A real Vortex DUSDC pool object once the Vortex route is moved from beta custody to user-funded privacy.
