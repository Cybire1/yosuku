# Yosuku — Pitch Deck

> Slide-by-slide deck. **12 slides**, Sequoia/Web3-hybrid order (Problem → Solution → Why Now → Market → Proof).
> Design rule: one idea per slide, minimal text, real on-chain screenshots over words.
> Every number here is verified on-chain or from real package data — nothing inflated.
> Each slide: **HEADLINE**, on-slide content (keep it sparse), `[VISUAL]`, and _(speaker note — what you say)_.

---

## Slide 1 — Cover

# Yosuku
### The consumer front door to on-chain prediction markets.
**One-tap, non-custodial. Built on DeepBook Predict. Web + native mobile.**

`[VISUAL: the landing hero — "Read the room before the room reads itself" — with the live BTC market behind it. Bottom strip: 18 wallets · 51 gas-free trades · ~1,800 SDK installs · live on Sui testnet.]`

_(speaker: "Yosuku is the consumer front door to on-chain prediction markets — one tap, non-custodial, built on Sui.")_

---

## Slide 2 — Problem

# Prediction markets price the future. Normal people can't get in.

- **Gas + jargon** — order books, strikes, wallets, fees before you can even bet.
- **Custody risk** — most apps make you hand over your keys.
- **Disputed outcomes** — winners decided by committee votes, not data.
- **No mobile, no social** — built for terminals, not for people.

`[VISUAL: split — a cluttered trading terminal vs. a confused first-time user.]`

_(speaker: "Prediction markets are how the world prices the future. But for a normal person they're a wall: gas, jargon, custody risk, and outcomes settled by committee.")_

---

## Slide 3 — Solution

# Yosuku makes a prediction **one tap**.

> We help everyday users trade prediction markets through a **one-tap, non-custodial app** on DeepBook Predict.

- **Pick a side → see exactly what you'd win → tap.** Gas-free.
- **Non-custodial by design** — only you can withdraw.
- **Oracle-settled, not committee-voted** — outcomes from price data.
- **Web + a native iOS / Android app.**

`[VISUAL: the bettable hero card — UP/DOWN + "You could win" — one tap to a live position.]`

_(speaker: "Yosuku turns all of that into one tap. Pick a side, see what you'd win, tap — gas-free, non-custodial, settled by a price oracle.")_

---

## Slide 4 — Product / Demo

# From scroll to settled, in seconds.

- **Bet** in two taps from the live market card.
- **Cash out** at the live price, before the round ends.
- **Feed** — live markets as short-form video; any take becomes tradeable.
- **Trade from a tweet** — post a take, it becomes an on-chain bet.

`[VISUAL: 3–4 real app screenshots in a row — hero → bet → feed/post-a-take → cash out. Or embed the 30s demo clip.]`

_(speaker: "Here's the product. Bet in two taps. Cash out anytime. A feed of live markets like TikTok. And you can trade straight from a tweet.")_

---

## Slide 5 — Why Now

# The moment is here.

- **Demand is proven** — prediction markets cleared **billions** in 2024 (public data).
- **The rails just shipped** — DeepBook Predict brings oracle-settled markets to Sui.
- **Consumer crypto needs frictionless UX** — gasless, mobile, a stable unit — Sui delivers.

`[VISUAL: prediction-market volume curve (2024 spike) → DeepBook Predict logo → Sui.]`

_(speaker: "Polymarket proved the world wants this. DeepBook Predict just brought the rails to Sui. And consumer crypto finally has the gasless, mobile UX to make it mainstream.")_

---

## Slide 6 — Why Us (the moat)

# Four things, together, no one else has.

1. **Trade-from-X with no-divert custody** — an agent can trade for you, but by design can *only* return funds to you. Enforced on-chain, **proven on-chain**.
2. **Social by default** — feed + post-a-take turn opinions into markets.
3. **Native mobile + gasless onboarding** — first bet with zero friction.
4. **Settlement integrity** — oracle-settled, not committee-disputed.

`[VISUAL: four crisp icons; under #1, a snippet of the on-chain tx proving agent-in / user-out / no divert.]`

_(speaker: "What makes us different: trade-from-X where the agent can never touch your money — proven on-chain. Plus social, native mobile, and oracle-grade settlement.")_

---

## Slide 7 — Market

# A category going mainstream — and we're the consumer layer.

- **Prediction markets**: billions in volume, breaking into mainstream culture.
- **Crypto trading apps**: tens of millions of users want simple, mobile, on-chain.
- **On Sui**: DeepBook is the infra; **Yosuku is the consumer product** on top.

`[VISUAL: three nested circles — prediction markets → consumer crypto → Sui/DeepBook — with Yosuku at the consumer edge.]`

_(speaker: "If DeepBook Predict is the infrastructure, Yosuku is the consumer product on top of it — for a category that's going mainstream.")_

---

## Slide 8 — Traction (the slide judges remember)

# Real usage. All on-chain. All verifiable.

- **18** distinct wallets placed **gas-free** trades on testnet
- **51** sponsored on-chain actions
- **~1,870** installs across our `@yosuku` SDK + MCP packages
- **Native iOS + Android** app (TestFlight)
- **Live on Sui testnet** — every number checkable on-chain

`[VISUAL: a Sui explorer tx + the live /stats page. Real screenshots, not mockups.]`

_(speaker: "And it's real. Eighteen wallets have placed gas-free trades, across fifty-one sponsored actions, our SDKs have ~1,800 installs, and there's a native mobile app — all verifiable on-chain.")_

---

## Slide 9 — How it's built (Technical)

# DeepBook Predict for the markets. Our Move for the moat.

- **Core markets** → DeepBook Predict (oracle-settled, Mysten).
- **Yosuku Move modules** → no-divert agent custody (`social_vault`), Trading Balance (leverage / private), PLP "be-the-house" yield.
- **Attested keeper** + **SDK & MCP on npm** — open, verifiable, reusable.

`[VISUAL: clean architecture diagram — user → Yosuku app → DeepBook Predict + Yosuku Move modules → Sui — with "non-custodial" called out on the user edge.]`

_(speaker: "We don't reinvent the market — we build on DeepBook Predict, and add our own Move modules for the things that make Yosuku safe and different: no-divert custody, leverage, and real vault yield.")_

---

## Slide 10 — Business model

# We earn when the market works.

- **Vault spread (PLP)** — be the house; earn the protocol spread.
- **Premium on leverage** — the reserve charges for boosted exposure.
- **Builder fees on volume** — when DeepBook enables them.
- **Strategy marketplace** — copy-trade fees on agent strategies.

`[VISUAL: four small revenue tiles, each tied to a live product surface.]`

_(speaker: "Revenue tracks usage: the vault spread, leverage premium, builder fees on volume, and a strategy marketplace.")_

---

## Slide 11 — Team / Execution

# Built a full consumer product — web, mobile, SDKs, Move — fast.

- _[Founder / team — names + one credibility line each]_
- **Proof is velocity:** consumer web app + native mobile + Move modules + published SDKs, all live on testnet.
- We ship at the speed this category demands.

`[VISUAL: team photos/handles, or — if solo — a "shipped" wall: app, mobile, npm packages, on-chain contracts.]`

_(speaker: "We're builders. In the time most teams ship a market card, we shipped the whole product — web, mobile, SDKs, and on-chain Move.")_

---

## Slide 12 — Vision / Ask / Close

# The consumer front door to on-chain prediction markets.

- **Today:** live on Sui testnet — bet, cash out, trade-from-X, earn.
- **Next:** mainnet, more assets, deeper social.
- **Ask:** _[the prize / the partnership / the raise]_

### yosuku.xyz

`[VISUAL: logo + tagline + QR to the live app.]`

_(speaker: "Polymarket proved the demand. Yosuku is the front door that makes it one tap — honest, non-custodial, native to Sui. Live on testnet today, mainnet next.")_

---

### Build / design notes
- **10–12 slides max** for the live pitch; this is already lean — cut Market or Business model if time is tight (judges weight Real-World + Product + Demo + Traction highest).
- **2:30 of attention** — make every slide skimmable in ~10s; the headline alone should carry the point.
- **Visuals > text** — real app screenshots and on-chain tx shots beat bullet lists. Use the brand: near-black background, vermilion accent (#E04D26), Sora display + JetBrains mono.
- **Honesty guardrails baked in:** traction = the verified 18 / 51 / ~1,870; trade-from-X framed as *capability + proven no-divert custody* (not "auto-runs live"); no TEE claim on the live trade path; market sizes qualitative ("billions") not fabricated precise figures.
- **Mirror the rubric:** Slides 2–4 + 7–8 = Real-World (50%); Slides 3–4 + 6 = Product/UX (20%); Slide 9 = Technical (20%); the whole deck's clarity = Presentation (10%).
