# Private Bets — Expo / mobile integration spec

Handoff for the mobile agent. Goal: add **incognito (private) bets** to the Expo app, mirroring the
web flow. This is a thin client integration — all the on-chain work happens server-side.

---

## 1. What "private" actually is (label it honestly)

Mode: `sponsored-session-manager` (link-reduction beta). For each private bet the backend executor
spins up a **fresh PredictManager**, funds it, mints the position, and tracks the ticket — so the
trade is **not linked to the user's main wallet**.

It is **NOT** zk anonymity. The honest UI label is **"BETA"** / "private routing" — never "fully
private", "untraceable", or "anonymous". (This is GUARDRAILS rule #4. Do not overclaim.)

---

## 2. Architecture — the one rule that matters

```
Expo app ──HTTPS──► yosuku.xyz/api/private-bet/*  ──(secret, server-side)──► executor on box ──► DeepBook Predict
   (no secret)          (Next.js API routes)            Bearer token              systemd service
```

- The app calls the **web backend's API routes** (`https://yosuku.xyz/api/private-bet/...`).
- Those routes hold `PRIVATE_BET_SHARED_SECRET` and add the `Authorization: Bearer` header.
- **NEVER put the shared secret, the executor URL, or any signing key in the mobile app.** The app
  only ever sends market params + the user's address. No wallet signature is needed to *open* a
  private bet (the executor mints on the user's behalf; the position settles back to the user).

Base URL: use the same backend the app already hits for other server routes (prod
`https://yosuku.xyz`; point at a local Next dev server for testing). Just prefix the paths below.

---

## 3. API the app calls (4 endpoints)

### GET `/api/private-bet/status`  — call on screen mount
Returns whether the private route is live. **Gate the whole feature on `ready`.**
```jsonc
{ "ready": true, "label": "READY"|"BETA", "reasons": [],
  "vortexPool": "0x0",            // pass this back verbatim as `vortexPool` in open/cashout/withdraw
  "mode": "sponsored-session-manager",
  "maxStakeDusdc": 1,             // cap — disable stakes above this
  "privateBalanceEnabled": true,
  "withdrawModes": ["fast","private"] }
```
If `ready === false` → show the toggle **disabled** with a "Private bets — coming soon (beta)" note
and `reasons[0]` as the reason. (It is `false` today until the executor is exposed + Vercel env set —
see §6.)

### POST `/api/private-bet/open`  — place a private bet (no wallet signature)
Request (all amounts are **u64 strings**, except `maxCostDusdc` which is a number):
```jsonc
{ "owner": "0x<user wallet>",      // device/zkLogin address — ticket owner + final payout dest
  "vortexPool": "<status.vortexPool>",
  "oracleId": "0x<oracle>",         // same market params as a normal bet
  "expiry": "1750000000000",
  "strike": "63140000000000",
  "isUp": true,                      // UP = true, DOWN = false
  "stakeMicro": "500000",            // DUSDC × 1e6 (0.5 DUSDC here); must be ≤ maxStakeDusdc×1e6
  "quantity": "...",                 // from the on-chain quote, same value you'd mint normally
  "maxCostDusdc": 0.6 }              // client-side guard
```
Response:
```jsonc
{ "ok": true, "digest": "<mint tx>", "costDusdc": 0.5,
  "sessionManager": "0x<fresh manager>", "sessionAddress": "0x...", "entryDigest": "<create tx>",
  "mode": "sponsored-session-manager" }
```
→ Build a **ticket** from this (see §4) and persist it locally.

### POST `/api/private-bet/cashout`  — redeem a settled ticket into "private balance"
```jsonc
{ "owner": "0x...", "vortexPool": "<status.vortexPool>",
  "ticket": { "digest","sessionAddress","sessionManager","oracleId",
              "expiry":"<str>","strike":"<str>","isUp":<bool>,"stakeMicro":"<str>","quantity":"<str>" } }
```
Response: `{ ok, digest, payoutDusdc, creditedAt, returnDigest }` → set ticket `status:"credited"`,
`payoutDusdc`.

### POST `/api/private-bet/withdraw`  — send credited balance to the user's wallet
```jsonc
{ "owner": "0x...", "vortexPool": "<status.vortexPool>",
  "mode": "fast" | "private", "ticketDigests": ["<digest>", ...] }
```
Response: `{ ok, digest, payoutDusdc, ticketDigests, mode }` → mark those tickets `status:"withdrawn"`.
(Note: in the current build both `fast` and `private` transfer to `owner`; the mode is a forward-looking
UI choice — don't claim `private` withdraw is more anonymous yet.)

All endpoints return `{ ok:false, error:"..." }` with a non-2xx status on failure — surface `error`.

---

## 4. The ticket model (port this type + persist locally)

A private bet's lifecycle lives **client-side** as a ticket (the executor also stores it, but the app
shows the user's own). Persist with **`expo-secure-store`** (or `@react-native-async-storage`),
keyed per `owner` address — NOT `localStorage`.

```ts
type PrivacyMode = 'public' | 'private';
type PrivateWithdrawMode = 'fast' | 'private';

interface PrivateBetTicket {
  digest: string;            // the open/mint tx — the ticket id
  owner: string; oracleId: string; expiry: number; strike: number;
  side: 'UP' | 'DOWN'; stakeMicro: number; quantity: number; costDusdc: number;
  sessionManager?: string; sessionAddress?: string; entryDigest?: string;
  redeemDigest?: string; payoutDusdc?: number; withdrawDigest?: string; withdrawMode?: PrivateWithdrawMode;
  status: 'open' | 'credited' | 'withdrawn';
  openedAt: number; creditedAt?: number; withdrewAt?: number; mode?: string;
}

// "Private Balance" shown in the UI = sum of credited (not-yet-withdrawn) tickets:
const privateBalance = tickets
  .filter(t => t.status === 'credited')
  .reduce((s, t) => s + Math.max(0, t.payoutDusdc ?? 0), 0);
```

Lifecycle: **open** (`status:'open'`) → after the bell, **cashout** (`status:'credited'`, gains a
`payoutDusdc`) → **withdraw** (`status:'withdrawn'`, funds land in the user's wallet).

**Reference implementation to port:** `/Users/cyber/sui-predict/lib/privateBet.ts` — copy the types and
the `openPrivateBet` / `cashOutPrivateBet` / `withdrawPrivateBalance` / `getPrivateBetStatus` functions
almost verbatim. Only two changes for RN:
1. `fetch('/api/private-bet/...')` → `fetch('https://yosuku.xyz/api/private-bet/...')` (absolute base URL).
2. ticket persistence: `window.localStorage` → `expo-secure-store` / AsyncStorage.

---

## 5. UI to build

- An **Incognito toggle** on the trade sheet (mirror `components/IncognitoToggle.tsx` — a mask icon,
  off = public / on = private). Disabled + "BETA / coming soon" when `status.ready === false`.
- When ON, route the bet through `openPrivateBet(...)` instead of the normal wallet-signed mint.
  Same market params; **no wallet popup** (executor mints).
- A small **"Private balance"** surface (sum of credited tickets) with **Cash out** (per settled
  ticket) and **Withdraw to wallet** actions.
- Honest one-liner near the toggle: *"Separates this bet from your main wallet. Beta — link-reduction,
  not full anonymity."*

---

## 6. Deployment dependency (why it may be OFF today)

The executor is **deployed and running** on the box (`yosuku-relay`-style systemd service
`yosuku-private-bet.service`, sponsored-session-manager, max stake 1 DUSDC). But `/status` returns
`ready:false` until **both** are true:
1. The executor is reachable from the Vercel backend (port exposed / tunnel), and
2. Vercel has `PRIVATE_BET_EXECUTOR_URL` + `PRIVATE_BET_SHARED_SECRET` set and is redeployed.

**Until then, the app must degrade gracefully** — `getPrivateBetStatus()` returns `ready:false`, so the
toggle stays disabled with the "coming soon (beta)" note. Build against that contract; the moment the
backend env flips on, the same code goes live with no app change.

---

## 7. Gotchas
- **Amounts are u64 strings** in the request bodies (`expiry`, `strike`, `stakeMicro`, `quantity`) —
  stringify them. `maxCostDusdc` is a plain number.
- `owner` = the device wallet / zkLogin address. It's used for ticket ownership **and** as the withdraw
  destination — the executor can only ever pay this address, never a third party.
- Respect `status.maxStakeDusdc` (1 DUSDC today) — reject larger stakes client-side with a clear message.
- `quantity` comes from the same on-chain quote you already use for a normal mint; private just routes
  those params through the API instead of signing locally.
- No SUI/gas needed from the user for private bets — the executor pays.
