# Mobile copy — plain-language pass (match the web)

For the agent working in `/Users/cyber/suioverflow/mobile`. The web app (`sui-predict`) just had its
leverage + private + parlay + earn copy stripped of technical plumbing so users never see the
machinery ("another agent betting it," sessions, keepers, escrow). Apply the **same** transforms to
the mobile screens so web and mobile read identically. These are **copy-only** changes — labels,
toasts, helper text, button text. Don't change logic.

## The principle
The user just **places a bet → "opening…" → done**. Never expose: keeper, executor, session /
session-manager, relay, escrow, fill, mint, redeem, settle, "Predict position/manager", "payout
units", fronted, reserve, attestation, enclave, "beta route", Vortex, zk, OpenOrder, on-chain object.
Keep plain words: bet, position, opening, cash out, withdraw, stake, balance, UP/DOWN, health, boost.

## Honesty is preserved (do NOT overclaim)
- Private = **link-reduction**, not anonymity. Say *"kept separate from your main wallet,"* *"harder to
  link back to you,"* *"stronger privacy is coming."* **Never** "anonymous / untraceable / fully
  private / zk."
- Leverage = borrowed funds on top of your stake; it **auto-closes** so *"you can't lose more than
  your stake."* Keep that. Keep all verifiable receipt links (just relabel them "View receipt").

## Files to sweep (mobile)
`app/leverage.tsx`, `app/private-mode.tsx`, `app/market/[id].tsx`, `lib/privateBet.ts`,
`lib/leverage.ts`, and any toast/label strings in `components/` for those flows.

## Exact mapping (find the equivalent string → replace)

### Private
| If the copy says… | Change it to… |
|---|---|
| "the public **Predict position** doesn't point back to your wallet" | "kept separate from your main wallet so this bet is **harder to link back to you**" |
| "Private withdraw uses the **separated beta route**; full **zk unlinking** needs the **Vortex pool upgrade**" | "Private withdraw keeps the payout separate from your main wallet for an extra layer; **stronger privacy is coming**" |
| "…**via session route**" / "**separated beta route**" | drop it — "Private bet placed" / "kept separate from your main wallet" |
| "X **payout units**" | "**wins** X DUSDC" (or "X **to win**") |
| "**session** 0x1234…abcd" | "**Private bet · ready**" (or "· pending" when no session yet) |
| "**tx** 0x1234…abcd" (raw hash label) | "**View receipt ↗**" (keep the link href) |
| "private **route** is offline/not ready" | "private **mode** is unavailable/not ready yet" |
| "**Beta limit**: N DUSDC max per private ticket" | "For now, private bets are capped at N DUSDC each" |

### Leverage
| If the copy says… | Change it to… |
|---|---|
| "queued for **keeper fill**" / "waiting for keeper" / "being filled" | "**opening your position…**" |
| "**keeper** delayed — margin **escrowed**" | "taking a little longer than usual — your stake is safe" |
| "round expired before **fill** — cancel to reclaim **margin**" | "this round closed before your position opened — tap to refund" |
| "**Cancel escrow**" | "**Cancel**" (busy → "Refunding…") |
| "N× **order placed** — Yosuku is opening…" | "**Opening your N× position** — it'll be live in a few seconds" |
| "N DUSDC **exposure**" | "N DUSDC **position size**" |
| "**Filled** positions / custodied by **protocol manager**" | "Your leverage positions" / drop the subtitle (or "open") |
| "**held on-chain**" (status) | "**open**" |
| "**View object** / View on-chain" | "**View details**" |
| "**LIQUIDATE**" (badge) | "**AT RISK**" |
| "**Advanced leverage details**" | "**How this works**" |
| "**Reserve fronts** / Reserve repay / Net deployed" | "**Borrowed for the boost** / Working in the market" |
| "**Premium** (fee to the reserve for fronting)" | "**Boost fee** (a one-time fee for borrowing the extra funds)" |
| "Borrowed N DUSDC. … **Keeper liquidates** at 100% health" | "Leverage adds N DUSDC on top of your stake … your position **auto-closes** at 100% health so **you can't lose more than your stake**" |
| "outside DeepBook Predict **mint bounds**" | "this price is **too certain to bet on** — pick a less certain line" |

### General
| If the copy says… | Change it to… |
|---|---|
| "private **routes**" (feature list) | "private **bets**" |
| "the **reserve escrows / fronts** the payout" | "the full payout is **set aside / covered for you**" |
| "**syncing** order id / syncing from tx" | "**confirming**" |

## After applying
- `npx tsc --noEmit` should stay clean (copy-only edits).
- Spot-check the leverage screen, the private-mode screen, and a market trade sheet on the simulator
  so nothing overflows after the wording changes.

Reference: the web commits are `f94d4837` and `dd89c070` in `sui-predict` (same transforms, verbatim).
