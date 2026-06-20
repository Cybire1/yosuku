# Yosuku Trading Balance Plan

## Summary

Trading Balance is an internal Yosuku account layer for DUSDC.

Instead of forcing every action to start from loose wallet coins, the user deposits once into a Yosuku-controlled smart contract balance. From there, Yosuku can route normal bets, private bets, leverage, and agentic trading through one consistent account model.

The user still owns the funds. The system only acts inside explicit limits.

```txt
Wallet DUSDC
  -> Yosuku Trading Balance
  -> normal trades
  -> private trades
  -> leveraged trades
  -> agentic trades
  -> withdraw to wallet
```

The core benefit is simple:

```txt
Deposit once. Trade fast. Cash out into balance. Withdraw anytime.
```

## Current Implementation

The app ships the Phase 1 product/accounting layer, and the Move package now includes the first real `yolev::trading_vault` contract.

Current visible model:

```txt
Yosuku Balance
  = Predict manager account value
  + Private Balance
  + leverage margin/equity
  + agent allocation

Total visible funds
  = wallet DUSDC + Yosuku Balance
```

What is live in the web app:

- Portfolio shows Wallet, Available, In trades, Private, Leverage, Agent, Positions, Realized P&L, Unrealized P&L.
- Trade panel labels balances as Wallet vs Trading instead of forcing users to understand "manager" language.
- PortfolioTable names the withdrawable manager funds "Available Trading Balance" and explains where cashouts/winners land.
- Private cashouts are represented as Private Balance.
- Leverage orders and filled leverage positions are visible in Portfolio with cancel/health context.

What is now implemented in Move:

- shared `TradingVault<T>`
- owner deposit and withdraw
- available balance, private balance, agent balance, and locked margin buckets
- owner-signed leverage opens from Trading Balance
- policy-based agent budget allocation and revocation
- agent leverage opens capped by max trade, max leverage, expiry, and authorized agent
- credit hooks for cashouts and private cashouts to return into Trading Balance
- locked-margin return and admin write-off accounting for losses
- balance and policy read helpers
- clean events for analytics

Live testnet deployment:

- `NEXT_PUBLIC_TRADING_VAULT_PACKAGE=0x3b76383b2bb9bc411dc56c571a1da22f348b3c19518115ae958fe96e031cf30e`
- `NEXT_PUBLIC_TRADING_VAULT_ID=0xc04516b582bfe73c71325408bfb9e9a5a8fdcd54952a313a288a135e272fa1e6`
- `NEXT_PUBLIC_MARGIN_DESK_ID=0x5aa4be2fb3084660e584d29a7323ea73ab96a07728496c5a3832b3b9cc0f4e40`
- lending pool: `0x506023587cc1c08dc25882f9bc78e59fdc68c8cb6b58b04dee8d234a437cf12e`
- keeper custody manager: `0xc111d848df05dfc2efdccc7e4248918188ba2e28f2354f47859c7d0d47788c61`

What still needs product wiring:

- switch live leverage/private cashout paths from app-level accounting to the vault PTB builders
- add Vortex/proof/relayer integration for stronger private withdrawals

## Why This Matters

The current app has several powerful features, but each one has its own funding path:

- normal Predict trades use wallet/manager funds
- private trades use session/executor managers
- leverage uses escrow orders and keeper fill
- agentic trades need safe delegated execution

Trading Balance turns these into one account model.

Users do not need to understand loose coins, temporary managers, keeper custody, or how every PTB is funded. They see one balance, while the protocol routes funds correctly underneath.

## Product UX

User-facing balances:

```txt
Wallet Balance:       3.00 DUSDC
Yosuku Balance:      12.50 DUSDC
Available:           9.50 DUSDC
Locked Margin:        3.00 DUSDC
Private Balance:      2.10 DUSDC
Agent Allocation:     5.00 DUSDC
```

The app should simplify this by default:

```txt
Yosuku Balance: 12.50 DUSDC
Available to trade
Withdraw anytime
```

Advanced users can expand the breakdown.

## Core Contract Shape

```move
struct TradingVault<phantom T> has key {
    id: UID,
    admin: address,
    accounts: Table<address, Account<T>>,
    policies: Table<address, AgentPolicy>,
    total_liquid: u64,
    total_locked_margin: u64,
}

struct Account<phantom T> has store {
    available: Balance<T>,
    private_available: Balance<T>,
    agent_available: Balance<T>,
    locked_margin: u64,
    total_deposited: u64,
    total_withdrawn: u64,
}

struct AgentPolicy has store, copy, drop {
    agent: address,
    max_trade: u64,
    max_leverage_bps: u64,
    max_daily_loss: u64,
    expires_at_ms: u64,
    active: bool,
}
```

Main actions:

```txt
deposit(amount)
withdraw(amount)
move_to_private(amount)
withdraw_private(amount)
open_leverage(...)
allocate_agent(...)
revoke_agent(...)
agent_open_leverage(...)
credit_available_for(...)
credit_private_for(...)
return_locked_for(...)
write_off_locked_for(...)
```

## Normal Trading Benefit

Without Trading Balance:

```txt
wallet coin -> deposit into PredictManager -> mint trade
```

With Trading Balance:

```txt
Trading Balance -> mint trade -> cashout/settlement returns to Trading Balance
```

Benefits:

- fewer funding errors
- fewer failed trades from coin selection issues
- cleaner portfolio accounting
- faster repeat trades
- simpler mobile UX

## Private Trade Benefit

Trading Balance is especially useful for private trade, but the privacy version should be called **Private Balance**.

Current private flow should become:

```txt
Wallet
  -> Private Balance
  -> session/executor manager opens Predict trade
  -> cashout returns to Private Balance
  -> user withdraws later
```

Benefits:

- cashout does not immediately return to the same wallet after every trade
- multiple private trades can settle into one internal balance
- withdrawals can be delayed, batched, or split
- user does not need to manage temporary managers
- much better UX than "fund a fresh wallet every time"

Important limitation:

Private Balance is not full cryptographic anonymity by itself.

It reduces obvious wallet-to-bet linking, but timing, amounts, and executor behavior may still leak patterns. Full privacy needs a pool/proof/relayer layer such as Vortex or a similar mixer-style primitive.

Best framing:

```txt
Private Balance = privacy UX and link reduction
Vortex/proofs = stronger cryptographic unlinkability
```

## Leverage Benefit

Trading Balance directly improves leverage.

The current leverage model is:

```txt
user signs request_open
margin goes into OpenOrder escrow
keeper later fills from reserve
position sits in keeper-owned PredictManager
```

This is safe, but it can feel delayed if the keeper is not running or the queue is busy.

With Trading Balance:

```txt
user deposits once
user sets leverage limits
keeper executes instantly from Trading Balance
margin is locked
reserve fronts debt
position opens in custody manager
receipt appears immediately
```

Benefits:

- faster leverage execution
- fewer stuck escrow orders
- easier liquidation accounting
- cleaner user portfolio
- capped keeper authority instead of open-ended trust

The keeper never touches the user wallet. It only acts against funds the user already deposited and only inside the user's signed policy.

Example leverage policy:

```txt
max trade size: 2 DUSDC
max leverage: 3x
allowed market: BTC Predict
no leverage in final 2 minutes
daily loss limit: 5 DUSDC
expires in: 24 hours
```

## Liquidation With Trading Balance

Leverage liquidation becomes easier to account for:

```txt
cashout = live Predict redeem value
debt = reserve fronted amount
required = debt + maintenance buffer + keeper fee
health = cashout / required
```

If health reaches the liquidation threshold:

```txt
keeper redeems position
reserve is repaid first
fee is paid
leftover returns to Trading Balance
```

Priority:

```txt
redeem proceeds
  -> repay reserve debt
  -> keeper/liquidation fee
  -> user's Trading Balance
```

This gives the user a clear post-liquidation result inside the app instead of making funds disappear into confusing intermediate objects.

## Agentic Trade Benefit

Yes, Trading Balance benefits agentic trading significantly.

Without Trading Balance, an agent has two bad options:

1. ask the user to sign every trade
2. receive broad wallet authority, which is unsafe

Trading Balance gives a better model:

```txt
user deposits funds
user allocates a budget to an agent
user signs strict policy limits
agent trades only inside that allocation
cashouts return to Trading Balance
user can revoke anytime
```

Example agent policy:

```txt
Agent: Yosuku BTC Momentum
Budget: 5 DUSDC
Max per trade: 1 DUSDC
Max leverage: 2x
Allowed direction: UP/DOWN BTC only
Allowed expiries: 15m, 1h
Daily loss stop: 2 DUSDC
Expires: tonight at 23:59
Revocable: yes
```

Benefits:

- agents can trade without asking for every signature
- user never gives wallet custody
- agent cannot drain beyond budget
- agent cannot trade unsupported markets
- agent PnL is easy to track
- copy-trading strategies become safer
- paid strategy agents can be monetized by performance or subscription

This is a stronger story for judges because it connects three Yosuku pillars:

```txt
consumer trading
private trading
agentic trading
```

through one account primitive.

## Safety Model

The keeper/agent should never receive unlimited access.

Every automated action must be bounded by:

- max trade size
- max daily loss
- max leverage
- allowed market
- allowed expiry window
- no-trade-before-expiry cutoff
- nonce/replay protection
- policy expiry time
- user revocation

The contract should reject anything outside the policy.

## Suggested Implementation Phases

### Phase 1: App-Level Balance Model

Goal: unify UX before shipping a new contract.

- rename current manager balance to "Trading Balance"
- show "Available", "In trades", "Private", "Leverage"
- route normal cashouts into the same visible balance
- show private cashouts as "Private Balance"
- explain withdraw clearly

This improves UX immediately.

### Phase 2: TradingVault Contract

Goal: actual shared balance contract.

- deposit DUSDC
- withdraw available DUSDC
- lock margin
- unlock margin
- emit clean balance events
- expose user balance reads

### Phase 3: Leverage Integration

Goal: instant leverage.

- debit margin from Trading Balance
- reserve fronts debt
- custody manager mints Predict position
- receipt appears immediately
- liquidation returns leftover to Trading Balance

### Phase 4: Private Balance Integration

Goal: better private-trade UX.

- allow user to allocate to Private Balance
- route private cashouts back to Private Balance
- delay/batch withdrawals
- later integrate Vortex/proof/relayer for stronger anonymity

### Phase 5: Agent Policy Layer

Goal: safe agentic trading.

- user creates agent policy
- agent trades from allocated balance
- contract enforces limits
- user can revoke
- strategy performance is tracked

## Submission Framing

Short pitch:

> Trading Balance is Yosuku's account layer for prediction-market UX. It makes normal trading faster, private trading less linkable, leverage executable without stuck escrow, and agentic trading safe through capped allocations instead of wallet custody.

Why judges should care:

- it solves a real Sui UX problem: loose coins and repeated signing
- it makes leverage feel instant
- it gives private trade a cleaner balance flow
- it gives agents a safe execution budget
- it turns separate features into one coherent platform

## Key Message

Trading Balance is not just a wallet balance.

It is the primitive that lets Yosuku become a full prediction trading platform:

```txt
one account
many execution modes
bounded automation
clean withdrawals
better privacy UX
instant leverage path
safe agentic trading
```
