# Trading Balance Agent Handoff

This file is the handoff for the Yosuku Trading Balance work.

The short version: a real `TradingVault<DUSDC>` stack now exists on Sui testnet, the frontend env points to it, and the TypeScript PTB builders are in place. The remaining work is product wiring: replace the app-level simulated accounting paths with these builders in the user-facing flows.

## Repos

- Web app: `/Users/cyber/sui-predict`
- Move package: `/Users/cyber/suioverflow/leverage-pkg`

## What Was Built

Added a new Move module:

- `/Users/cyber/suioverflow/leverage-pkg/sources/trading_vault.move`

The module implements a shared `TradingVault<T>` account layer with:

- user deposits and withdrawals
- public available balance
- private balance bucket
- agent-allocated balance bucket
- locked margin accounting
- owner-signed leverage opens from Trading Balance
- agent-signed leverage opens under an owner-created policy
- cashout credit hooks
- private cashout credit hooks
- locked-margin return hook
- admin write-off for unrecovered locked margin
- analytics events

Important caveat: `AgentPolicy.max_daily_loss` is stored but not yet enforced because realized daily-loss accounting is not wired. Do not claim daily loss enforcement is live until that accounting exists.

## Why It Exists

The product problem was that Yosuku had several funding paths:

- normal Predict trades use wallet or PredictManager funds
- private trades use session/executor managers
- leverage uses escrow orders and keeper fill
- agentic trades need bounded delegation

Trading Balance gives users one prefunded account:

```txt
Wallet DUSDC
  -> Yosuku Trading Balance
  -> normal trades
  -> private trades
  -> leveraged trades
  -> agentic trades
  -> withdraw to wallet
```

The UX promise:

```txt
Deposit once. Trade fast. Cash out into balance. Withdraw anytime.
```

## Live Testnet Deployment

Published fresh package:

```txt
NEXT_PUBLIC_TRADING_VAULT_PACKAGE=0x3b76383b2bb9bc411dc56c571a1da22f348b3c19518115ae958fe96e031cf30e
```

Shared objects:

```txt
NEXT_PUBLIC_TRADING_VAULT_ID=0xc04516b582bfe73c71325408bfb9e9a5a8fdcd54952a313a288a135e272fa1e6
NEXT_PUBLIC_MARGIN_DESK_ID=0x5aa4be2fb3084660e584d29a7323ea73ab96a07728496c5a3832b3b9cc0f4e40
TRADING_BALANCE_LENDING_POOL_ID=0x506023587cc1c08dc25882f9bc78e59fdc68c8cb6b58b04dee8d234a437cf12e
TRADING_BALANCE_CUSTODY_MANAGER_ID=0xc111d848df05dfc2efdccc7e4248918188ba2e28f2354f47859c7d0d47788c61
```

Publish transaction:

```txt
7xypTumhVRyFzqLUh5qX8kRQks73X4hjgX8pWrAiRkmz
```

Deployment transactions:

```txt
create pool: kNPDSsUzEzbt7sKJfEJuZPCV7dNB8utpa4NztzNWuU2
seed pool: 2BNGne7CPz1YC2Xo1d6tYfpyoGQpM8a9YZEs6vEPgpsN
create custody manager: 59jN5LZsojXPgfr8spaoFNw15eGNLzPRqyUohaEe7FEM
create margin desk: G4351xp5J96dG12MXoWQrFzGyoGkNVyDKqASvVg6mXWN
create trading vault: 4qwb1ycZZfskv4ki3KrtW7i9tqvZYAyqnL9dBjLhyDdT
```

The lending pool was seeded with `1 DUSDC`.

## Why Fresh Publish Instead Of Upgrade

An attempted upgrade against the existing yolev UpgradeCap dry-run failed:

```txt
PackageUpgradeError { upgrade_error: IncompatibleUpgrade }
```

So the safe route was a fresh package for Trading Balance. This avoids breaking the existing web app flows that still depend on the older deployed underwrite package.

Do not casually switch the old `YOLEV_PACKAGE` to the new package. The frontend intentionally separates:

- `YOLEV_PACKAGE`: old live underwrite/leverage flow
- `TRADING_VAULT_PACKAGE`: new Trading Balance flow

## Frontend Changes

Updated env:

- `/Users/cyber/sui-predict/.env.local`

Added:

```env
NEXT_PUBLIC_TRADING_VAULT_PACKAGE=0x3b76383b2bb9bc411dc56c571a1da22f348b3c19518115ae958fe96e031cf30e
NEXT_PUBLIC_TRADING_VAULT_ID=0xc04516b582bfe73c71325408bfb9e9a5a8fdcd54952a313a288a135e272fa1e6
NEXT_PUBLIC_MARGIN_DESK_ID=0x5aa4be2fb3084660e584d29a7323ea73ab96a07728496c5a3832b3b9cc0f4e40
```

Updated network config:

- `/Users/cyber/sui-predict/lib/sui/network.ts`

Added:

```ts
tradingVaultPackage: string;
marginDeskId: string;
tradingVaultId: string;
```

Testnet values are read from:

```txt
NEXT_PUBLIC_TRADING_VAULT_PACKAGE
NEXT_PUBLIC_TRADING_VAULT_ID
NEXT_PUBLIC_MARGIN_DESK_ID
```

Updated constants:

- `/Users/cyber/sui-predict/lib/sui/constants.ts`

Added:

```ts
export const TRADING_VAULT_PACKAGE = NET.tradingVaultPackage;
export const MARGIN_DESK_ID = NET.marginDeskId;
export const TRADING_VAULT_ID = NET.tradingVaultId;
```

Added PTB client:

- `/Users/cyber/sui-predict/lib/sui/tradingVaultClient.ts`

Exports include:

```ts
createTradingVaultTx
depositTradingBalanceTx
depositTradingBalanceCall
withdrawTradingBalanceTx
withdrawTradingBalanceCall
moveTradingToPrivateTx
moveTradingToPrivateCall
withdrawPrivateTradingBalanceTx
withdrawPrivateTradingBalanceCall
allocateAgentBudgetTx
revokeAgentBudgetTx
openTradingBalanceBinaryLeverageTx
openTradingBalanceRangeLeverageTx
agentOpenTradingBalanceBinaryLeverageTx
agentOpenTradingBalanceLeverageTx
creditAvailableForCall
creditPrivateForCall
returnLockedForCall
writeOffLockedForTx
TRADING_VAULT_TYPE
TRADING_VAULT_EVENTS
```

## Deployment Scripts Added

Fresh publish:

- `/Users/cyber/suioverflow/leverage-pkg/publish-trading-vault.mjs`

Deploy live stack:

- `/Users/cyber/suioverflow/leverage-pkg/deploy-trading-balance-stack.mjs`

The deploy script creates:

1. `lending_pool::create<DUSDC>`
2. optional `lending_pool::supply<DUSDC>` seed
3. DeepBook Predict custody manager owned by the keeper/admin
4. `margin::create_desk<DUSDC>`
5. `trading_vault::create<DUSDC>`

There is also:

- `/Users/cyber/suioverflow/leverage-pkg/upgrade-trading-vault.mjs`

That script was kept, but the upgrade path failed as incompatible. Use the fresh package path unless the package lineage is made upgrade-compatible later.

## Verification Done

Move tests:

```bash
cd /Users/cyber/suioverflow/leverage-pkg
sui move test
```

Result:

```txt
Test result: OK. Total tests: 59; passed: 59; failed: 0
```

Frontend build:

```bash
cd /Users/cyber/sui-predict
npm run build
```

Result:

```txt
Compiled successfully
Running TypeScript passed
```

Only existing warning:

```txt
Next.js inferred your workspace root because multiple lockfiles exist.
```

On-chain sanity checks confirmed:

- TradingVault exists, is shared, admin is `0xaa50...7244`
- MarginDesk exists, is shared, keeper/admin is `0xaa50...7244`
- LendingPool exists, is shared, liquidity is `1000000` micro DUSDC

## Contract Behavior

### Deposit

User deposits DUSDC into Trading Balance:

```txt
wallet coin -> trading_vault::deposit -> account.available
```

### Withdraw

User withdraws public available balance:

```txt
account.available -> Coin<T> -> user wallet
```

### Private Balance

User can move available balance into a private bucket:

```txt
available -> private_available
```

Private cashout flows can credit:

```txt
executor/session flow -> credit_private_for(user, coin)
```

Only the user can withdraw private balance.

This improves privacy UX but is not full cryptographic anonymity. Full unlinkability still needs a pool/proof/relayer layer such as Vortex.

### Leverage

Owner-signed leverage open:

```txt
available balance -> locked_margin -> margin::request_open_for(...)
```

Agent-signed leverage open:

```txt
agent_available -> locked_margin -> margin::request_open_for(...)
```

Agent execution is bounded by:

- authorized agent address
- policy active flag
- expiry timestamp
- max trade
- max leverage

The user remains the economic owner. Exits force-pay the user through the margin desk logic.

### Agentic Trading

User allocates a budget:

```txt
available -> agent_available
```

Agent can only spend from that budget inside policy caps.

User can revoke:

```txt
agent_available -> available
policy.active = false
```

## Remaining Product Wiring

The contract and PTB builders exist, but not every UI flow has been switched to them.

Highest priority:

1. Wire deposit/withdraw buttons to `depositTradingBalanceTx` and `withdrawTradingBalanceTx`.
2. Wire Private Balance UX to `moveTradingToPrivateTx` and `withdrawPrivateTradingBalanceTx`.
3. Route private cashout server/PTB flows into `creditPrivateForCall`.
4. Route normal cashout/settlement into `creditAvailableForCall`.
5. Switch new leverage UX to `openTradingBalanceBinaryLeverageTx` or `openTradingBalanceRangeLeverageTx`.
6. Add agent budget UI for `allocateAgentBudgetTx` and `revokeAgentBudgetTx`.
7. Add read/indexer support for `TradingVault` account tables and events.
8. Keep old underwrite flow working until the new Trading Balance leverage flow is fully proven end to end.

## Important Safety Notes

- Do not print private keys. Scripts read the local Sui keystore but never log secrets.
- Do not replace `YOLEV_PACKAGE` globally with the fresh package. Existing underwrite code still uses the old live package.
- The new lending pool only has `1 DUSDC` seed liquidity. It is enough for smoke tests, not production-size leverage.
- `max_daily_loss` is not enforced yet.
- Private Balance is link reduction, not full cryptographic privacy.
- Vortex/proof/relayer integration remains future work.

## Suggested Next Agent Task

Start with the smallest visible end-to-end loop:

```txt
wallet DUSDC
  -> depositTradingBalanceTx
  -> display Trading Balance from vault/indexed events
  -> withdrawTradingBalanceTx
  -> wallet DUSDC
```

Then do the private loop:

```txt
Trading Balance
  -> moveTradingToPrivateTx
  -> private cashout credits creditPrivateForCall
  -> withdrawPrivateTradingBalanceTx
```

Then wire leverage:

```txt
Trading Balance
  -> openTradingBalanceBinaryLeverageTx
  -> keeper fill/mint
  -> close/liquidate
  -> returnLockedForCall or writeOffLockedForTx
```

This sequencing avoids breaking the existing app while making the new Trading Balance feature real in front of judges.
