# Private + Leverage — "unlinked, amplified bet" — implementation plan

> Status: **planned, not built.** Parked for later (2026-06-23). A power-user feature.

## Goal
One bet that is **both**:
- **Leveraged** — borrow from the lending pool to size the position beyond the user's stake, and
- **Private** — link-reduction: the public Predict position isn't tied to the user's main wallet.

## Why it doesn't exist today (two separate rails)
| | how it opens | linked to wallet? | leverage? |
|---|---|---|---|
| **Private** | AWS executor mints a **plain 1× position** into a throwaway session manager (no user signature) | no | no |
| **Leverage** | **user signs** `trading_vault::open_leverage`; keeper borrows + fills into a keeper-owned custody manager | yes (their sig is on-chain) | yes |

They conflict: leverage today needs the user's signature (which links them) or an agent that borrows on their behalf; the private executor only does 1× mints with no borrow. So flipping both toggles today can only honor one model.

## Design — let the executor open a *leveraged* position into a session manager
The executor is already unlinked + sponsored; give it a leveraged-open path:
1. Executor creates a fresh `PredictManager` (session manager) — as today.
2. Executor posts margin (sponsored beta) **and borrows from the lending pool** to reach the target notional.
3. Executor mints the **leveraged** position into the session manager; records the debt + leverage on the ticket.
4. Ticket fields: stake, leverage, notional, borrowed/debt, sessionManager, owner, status.

The closest existing primitive to reuse: the **trade-from-X rail** —
`social_vault::agent_trade → margin::request_open_for(owner = user)` already opens a *leveraged* position
with the user hard-wired as owner (no-divert). The new flow = the same idea, but route custody into a
**fresh session manager** (for unlinkability) instead of the user's named manager.

## Settlement / cashout
- On settle (keeper-cranked, or user "cash out"): redeem → **repay the lending pool first** → `trading_vault::credit_available_for(user, remainder)` → lands in the user's **Trading Balance** (matches the unified one-balance model).
- Loser: `margin::liquidate` — repay pool from recovered value, force-pay any remainder to the user.
- Mid-round early close: same testnet caveat as leverage today (disabled — thin AMM spread misprices an early exit).

## Contract surface (needs design + a redeploy)
- `margin::fill` is keeper-gated and tied to `request_open` (user-trader). Need an **executor-callable** path that borrows + mints into an executor-owned session manager with the **user as eventual beneficiary** (no-divert), e.g. a new `margin::agent_open_leverage_private` — or adapt the existing `trading_vault::agent_open_leverage` to accept a session-manager custody target.
- Lending-pool **borrow + repay** accounting must net correctly across the executor-owned manager.
- Keep the no-divert invariant: every exit force-pays the owner (the funded user).

## Liquidation of a private leveraged position
- The keeper must be able to liquidate a position held in a **session manager** (executor-owned). The executor records the managerId; wire the keeper to watch executor-opened leveraged tickets and crank liquidate/close on them.
- Force-pay the user on any exit (no-divert preserved).

## Privacy honesty (hard rule)
Still **link-reduction, not zk anonymity** — same as private 1× today. The eventual credit to the user's
Trading Balance links the *funds* (not the specific bet). Never label it "anonymous/untraceable."

## Frontend
- Allow the **leverage slider** + **incognito toggle** on the same bet. When both are on → route to the new
  executor private-leverage endpoint (no user signature, for privacy), show "private + N× leverage,"
  settle to Trading Balance at the bell.
- Honest copy: "Private (kept separate from your main wallet) + N× — settles to your Trading Balance at the bell."

## Phases
1. **Contract** — design + add the executor-callable leveraged-open-into-session-manager entry (or adapt `agent_open_leverage`); Move tests for borrow/mint/close/liquidate + no-divert.
2. **Executor** — `POST /open-leverage` (create manager → borrow → mint → record debt) + cashout that repays pool then `credit_available_for`.
3. **Keeper** — watch private-leveraged tickets; close winners / liquidate losers in their session managers.
4. **Frontend** — both toggles → combined endpoint; status + honest labels.
5. **Funding/caps** — executor margin float + lending-pool capacity for the extra borrows; cap `maxStake × maxLeverage` to bound sponsored exposure.
6. **Test** — end-to-end on testnet: open private-leveraged → keeper settles → user's Trading Balance credited; prove no-divert.

## Open risks
- Lending-pool capacity for sponsored private-leveraged borrows (cap it).
- Reliable liquidation of session-manager positions.
- **Operator-key contention** — the relay + keeper + private executor all share `0xaa50ec0f`; they contend for gas coins and the key drains (this caused the 2026-06-23 "gas selection failed" on a tweet-trade). Recommend **separate keys per service** + low-balance monitoring before adding another consumer of this key. Also consider Onara-sponsoring the agent's execution so it never needs SUI.
