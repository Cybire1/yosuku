// btcOnramp.ts — fund a Yosuku bet with Bitcoin.
//
// Hashi bridges native BTC to Sui as hBTC. Predict settles in DUSDC, and on testnet there is no
// hBTC/DUSDC spot market, so this shim is the missing hop: hBTC in, DUSDC out, in the same
// atomic transaction that opens the bet. Nothing is ever custodied — the swap is a PTB command,
// so if any later step fails the whole thing reverts and the Bitcoin never left the wallet.
//
// MAINNET: replace `appendBtcSwap` with a real DeepBook spot or Cetus swap at this same seam.
// Everything downstream is unchanged, because everything downstream is the normal bet path.
//
// This file deliberately holds NO copy of the mint chain. An earlier version did, and it rotted
// without anyone noticing: it kept calling the 6-24 `load_live_pricer` with eight arguments long
// after 7-29 collapsed two Block Scholes feeds into one, so the Bitcoin path would have aborted
// on the live venue while the normal path worked fine. The bet is built by
// `buildCreateFundAndMint624`, which the whole app uses, so it cannot drift alone again.

import { Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions';
import { PREDICT624, buildCreateFundAndMint624 } from './predict624Client';

/** Deployed on-ramp shim (Sui testnet). */
export const ONRAMP = {
  /** yosuku_onramp package. */
  pkg: '0x6794caacfc8c4e88a8ff4cdf2f57169bf625bf345430a220683858d3184f72b0',
  /** The live OnRamp<DUSDC, hBTC> shared object (oracle-priced DUSDC reserve). */
  ramp: '0x5291d2fbd5a1aa335b3e43537637cfa22127d3ec6f7fecbee93b19f509a815a9',
  /** hBTC coin type (Hashi). NOTE: 8 decimals, unlike DUSDC's 6. */
  hbtcType: '0xfcea10cadbb553c4874201584abf68771592678952efd957b2e82c010c7f4360::btc::BTC',
  /** hBTC is 8dp. */
  hbtcDecimals: 8,
} as const;

/**
 * THE SEAM. Consume an hBTC coin and return the DUSDC it swapped to, as a PTB result to pass
 * into the rest of the transaction.
 *
 * `minOut` is the caller's slippage floor in micro-DUSDC and it matters more than it looks: the
 * shim prices from an admin-pushed oracle value, so a stale price is the one way a user gets a
 * bad rate. Passing 0 accepts whatever the shim currently says. Quote the expected output and
 * pass a real floor.
 */
export function appendBtcSwap(
  tx: Transaction,
  hbtcCoin: TransactionObjectArgument,
  minOut: bigint = 0n,
): TransactionObjectArgument {
  return tx.moveCall({
    target: `${ONRAMP.pkg}::onramp::swap`,
    typeArguments: [PREDICT624.dusdcType, ONRAMP.hbtcType],
    arguments: [tx.object(ONRAMP.ramp), hbtcCoin, tx.pure.u64(minOut)],
  });
}

/**
 * Deposit only: swap hBTC to DUSDC and fund a fresh account, no bet.
 *
 * Worth having separately because it is always valid — no market, no admission rules, nothing to
 * be closed or unfunded. When "bet with Bitcoin" fails for a market reason, this still works, so
 * the user's Bitcoin can always get in.
 */
export function buildFundAccountFromBtc(p: { hbtcCoinId: string; minOut?: bigint }): Transaction {
  const tx = new Transaction();
  const swapped = appendBtcSwap(tx, tx.object(p.hbtcCoinId), p.minOut ?? 0n);

  const wrapper = tx.moveCall({
    target: `${PREDICT624.accountPackage}::account_registry::new`,
    arguments: [tx.object(PREDICT624.accountRegistry)],
  });
  const authDep = tx.moveCall({
    target: `${PREDICT624.accountPackage}::account::generate_auth`,
    arguments: [],
  });
  tx.moveCall({
    target: `${PREDICT624.accountPackage}::account::deposit_funds`,
    typeArguments: [PREDICT624.dusdcType],
    arguments: [
      wrapper,
      authDep,
      swapped,
      tx.object(PREDICT624.accumulatorRoot),
      tx.object(PREDICT624.clock),
    ],
  });
  tx.moveCall({ target: `${PREDICT624.accountPackage}::account::share`, arguments: [wrapper] });
  return tx;
}

/**
 * One signature, Bitcoin to open position: swap hBTC to DUSDC, create and fund the account with
 * the proceeds, and place the bet. Atomic, so a failed bet returns the Bitcoin.
 *
 * The whole swap output funds the account, so size the bet to fit it: `maxCostMicro` must be at
 * or under what the swap yields, or the mint aborts and the transaction reverts.
 */
export function buildBetWithBtc(p: {
  hbtcCoinId: string;
  minOut?: bigint;
  marketId: string;
  lowerTick: number | bigint;
  higherTick: number | bigint;
  qtyMicro: bigint;
  leverage1e9: bigint;
  maxCostMicro: bigint;
  maxProb1e9: bigint;
}): Transaction {
  const tx = new Transaction();
  const swapped = appendBtcSwap(tx, tx.object(p.hbtcCoinId), p.minOut ?? 0n);

  return buildCreateFundAndMint624({
    tx,
    fundingCoin: swapped,
    coinIds: [],
    depositMicro: 0n, // unused when fundingCoin is supplied; the swapped coin goes in whole
    marketId: p.marketId,
    lowerTick: p.lowerTick,
    higherTick: p.higherTick,
    qtyMicro: p.qtyMicro,
    leverage1e9: p.leverage1e9,
    maxCostMicro: p.maxCostMicro,
    maxProb1e9: p.maxProb1e9,
  });
}

/** Convert a human BTC amount to hBTC base units (8dp). */
export function btcToBase(btc: number): bigint {
  return BigInt(Math.round(btc * 10 ** ONRAMP.hbtcDecimals));
}
