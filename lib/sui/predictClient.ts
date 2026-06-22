// PTB (Programmable Transaction Block) builders for DeepBook Predict

import { Transaction } from '@mysten/sui/transactions';
import {
  PACKAGE_ID,
  PREDICT_ID,
  DUSDC_TYPE,
  CLOCK_ID,
} from './constants';
import {
  creditAvailableForCall,
  depositTradingBalanceCall,
  withdrawTradingBalanceCall,
} from './tradingVaultClient';

/**
 * Create a PredictManager for the connected wallet.
 * public fun create_manager(ctx: &mut TxContext): ID
 */
export function createManagerTx(): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::predict::create_manager`,
  });
  return tx;
}

/**
 * Deposit DUSDC into a PredictManager.
 * public fun deposit<T>(self: &mut PredictManager, coin: Coin<T>, ctx: &TxContext)
 */
export function depositTx(managerId: string, coinObjectId: string, amount: bigint): Transaction {
  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.object(coinObjectId), [amount]);
  tx.moveCall({
    target: `${PACKAGE_ID}::predict_manager::deposit`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(managerId), coin],
  });
  return tx;
}

/**
 * Withdraw DUSDC from the trading account (PredictManager) back to the wallet.
 * Winnings land here after the keeper auto-redeems winning positions, so this
 * is how a user actually collects: `predict_manager::withdraw<DUSDC>` → transfer.
 */
export function withdrawFromManagerTx(managerId: string, amount: bigint, owner: string): Transaction {
  const tx = new Transaction();
  const coin = tx.moveCall({
    target: `${PACKAGE_ID}::predict_manager::withdraw`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(managerId), tx.pure.u64(amount)],
  });
  tx.transferObjects([coin], tx.pure.address(owner));
  return tx;
}

/**
 * Deposit all DUSDC coins by merging them first, then splitting the exact amount.
 */
export function depositFromWalletTx(
  managerId: string,
  coinIds: string[],
  amount: bigint,
): Transaction {
  const tx = new Transaction();
  let primaryCoin;
  if (coinIds.length === 1) {
    primaryCoin = tx.object(coinIds[0]);
  } else {
    primaryCoin = tx.object(coinIds[0]);
    if (coinIds.length > 1) {
      tx.mergeCoins(primaryCoin, coinIds.slice(1).map(id => tx.object(id)));
    }
  }
  const [splitCoin] = tx.splitCoins(primaryCoin, [amount]);
  tx.moveCall({
    target: `${PACKAGE_ID}::predict_manager::deposit`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(managerId), splitCoin],
  });
  return tx;
}

/**
 * Build a MarketKey for binary positions (UP/DOWN).
 * market_key::up(oracle_id, expiry, strike) → MarketKey
 * market_key::down(oracle_id, expiry, strike) → MarketKey
 */
function marketKeyArgs(
  tx: Transaction,
  oracleId: string,
  expiry: bigint,
  strike: bigint,
  direction: 'UP' | 'DOWN',
) {
  const target = direction === 'UP'
    ? `${PACKAGE_ID}::market_key::up`
    : `${PACKAGE_ID}::market_key::down`;

  const [marketKey] = tx.moveCall({
    target,
    arguments: [
      tx.pure.id(oracleId),
      tx.pure.u64(expiry),
      tx.pure.u64(strike),
    ],
  });
  return marketKey;
}

/**
 * Mint a binary position.
 * public fun mint<Quote>(predict, manager, oracle, MarketKey, quantity, clock, ctx)
 */
export function mintPositionTx(
  managerId: string,
  oracleId: string,
  expiry: bigint,
  strike: bigint,
  direction: 'UP' | 'DOWN',
  quantity: bigint,
): Transaction {
  const tx = new Transaction();
  const marketKey = marketKeyArgs(tx, oracleId, expiry, strike, direction);
  tx.moveCall({
    target: `${PACKAGE_ID}::predict::mint`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PREDICT_ID),
      tx.object(managerId),
      tx.object(oracleId),
      marketKey,
      tx.pure.u64(quantity),
      tx.object(CLOCK_ID),
    ],
  });
  return tx;
}

/**
 * Redeem a binary position (works for both live and settled).
 * public fun redeem<Quote>(predict, manager, oracle, MarketKey, quantity, clock, ctx)
 */
export function redeemPositionTx(
  managerId: string,
  oracleId: string,
  expiry: bigint,
  strike: bigint,
  direction: 'UP' | 'DOWN',
  quantity: bigint,
): Transaction {
  const tx = new Transaction();
  const marketKey = marketKeyArgs(tx, oracleId, expiry, strike, direction);
  tx.moveCall({
    target: `${PACKAGE_ID}::predict::redeem`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PREDICT_ID),
      tx.object(managerId),
      tx.object(oracleId),
      marketKey,
      tx.pure.u64(quantity),
      tx.object(CLOCK_ID),
    ],
  });
  return tx;
}

export interface ClaimablePosition {
  managerId: string;
  oracleId: string;
  expiry: bigint;
  strike: bigint;
  direction: 'UP' | 'DOWN';
  quantity: bigint;
}

/** Add one redeem_permissionless call to a tx (settled binary winner → its manager). */
function addRedeemPermissionless(tx: Transaction, p: ClaimablePosition) {
  const marketKey = marketKeyArgs(tx, p.oracleId, p.expiry, p.strike, p.direction);
  tx.moveCall({
    target: `${PACKAGE_ID}::predict::redeem_permissionless`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PREDICT_ID),
      tx.object(p.managerId),
      tx.object(p.oracleId),
      marketKey,
      tx.pure.u64(p.quantity),
      tx.object(CLOCK_ID),
    ],
  });
}

/**
 * Redeem a SETTLED binary winner via the permissionless crank.
 * public fun redeem_permissionless<Quote>(predict, manager, oracle, MarketKey, quantity, clock, ctx)
 * No owner check — anyone (incl. a keeper) can settle any winner; gas-negative on full close.
 */
export function redeemPermissionlessTx(p: ClaimablePosition): Transaction {
  const tx = new Transaction();
  addRedeemPermissionless(tx, p);
  return tx;
}

/** Claim many settled winners in a single PTB — the gas-negative "claim all" crank. */
export function redeemAllPermissionlessTx(positions: ClaimablePosition[]): Transaction {
  const tx = new Transaction();
  for (const p of positions) addRedeemPermissionless(tx, p);
  return tx;
}

/** Claim settled binary winners, withdraw the payout, and credit TradingVault. */
export function redeemAllPermissionlessToTradingBalanceTx(positions: ClaimablePosition[], owner: string): Transaction {
  const tx = new Transaction();
  for (const p of positions) addRedeemPermissionless(tx, p);
  const managerId = positions[0]?.managerId;
  const payout = positions.reduce((sum, p) => sum + p.quantity, BigInt(0));
  if (!managerId || payout <= BigInt(0)) return tx;
  const funds = tx.moveCall({
    target: `${PACKAGE_ID}::predict_manager::withdraw`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(managerId), tx.pure.u64(payout)],
  });
  creditAvailableForCall(tx, owner, funds);
  return tx;
}

/**
 * Sweep the manager's *entire* free DUSDC balance back to the owner's wallet,
 * in the same PTB. Used by the plain (1×) bet builders so a normal bet never
 * leaves money parked in the trading account: we deposit the full stake (for
 * slippage headroom), mint, then return whatever the mint didn't spend.
 *
 * `predict_manager::balance` returns the post-mint residual at execution time,
 * which we feed straight into `withdraw` — no build-time guess about the exact
 * fill price. Binary/range mint only debits free balance (no collateral lock),
 * so this can't touch funds backing a live position.
 */
function sweepManagerResidual(tx: Transaction, managerId: string, owner: string) {
  const [residual] = tx.moveCall({
    target: `${PACKAGE_ID}::predict_manager::balance`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(managerId)],
  });
  const [change] = tx.moveCall({
    target: `${PACKAGE_ID}::predict_manager::withdraw`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(managerId), residual],
  });
  tx.transferObjects([change], tx.pure.address(owner));
}

/**
 * Atomic: deposit DUSDC from wallet + mint position + sweep residual in one PTB.
 */
export function depositAndMintTx(
  managerId: string,
  coinIds: string[],
  depositAmount: bigint,
  oracleId: string,
  expiry: bigint,
  strike: bigint,
  direction: 'UP' | 'DOWN',
  quantity: bigint,
  owner: string,
): Transaction {
  const tx = new Transaction();

  // Step 1: Merge and split coins for deposit
  let primaryCoin;
  if (coinIds.length === 1) {
    primaryCoin = tx.object(coinIds[0]);
  } else {
    primaryCoin = tx.object(coinIds[0]);
    if (coinIds.length > 1) {
      tx.mergeCoins(primaryCoin, coinIds.slice(1).map(id => tx.object(id)));
    }
  }
  const [splitCoin] = tx.splitCoins(primaryCoin, [depositAmount]);

  // Step 2: Deposit into manager
  tx.moveCall({
    target: `${PACKAGE_ID}::predict_manager::deposit`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(managerId), splitCoin],
  });

  // Step 3: Build market key and mint
  const marketKey = marketKeyArgs(tx, oracleId, expiry, strike, direction);
  tx.moveCall({
    target: `${PACKAGE_ID}::predict::mint`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PREDICT_ID),
      tx.object(managerId),
      tx.object(oracleId),
      marketKey,
      tx.pure.u64(quantity),
      tx.object(CLOCK_ID),
    ],
  });

  // Step 4: return whatever the mint didn't spend — a 1× bet leaves nothing
  // parked in the trading account (that's reserved for leverage).
  sweepManagerResidual(tx, managerId, owner);

  return tx;
}

function mergedPrimaryCoin(tx: Transaction, coinIds: string[]) {
  if (coinIds.length === 0) throw new Error('No DUSDC coin selected');
  const primaryCoin = tx.object(coinIds[0]);
  if (coinIds.length > 1) {
    tx.mergeCoins(primaryCoin, coinIds.slice(1).map(id => tx.object(id)));
  }
  return primaryCoin;
}

/**
 * Atomic: optional wallet top-up -> TradingVault -> PredictManager -> mint.
 *
 * This is the feature-test path for the new Trading Balance contract. The user
 * trades from TradingVault first; if vault funds are short, the same PTB tops the
 * vault up from wallet DUSDC before debiting it.
 */
export function tradingBalanceDepositAndMintTx(
  managerId: string,
  coinIds: string[],
  vaultAvailableAmount: bigint,
  spendAmount: bigint,
  oracleId: string,
  expiry: bigint,
  strike: bigint,
  direction: 'UP' | 'DOWN',
  quantity: bigint,
): Transaction {
  const tx = new Transaction();

  if (vaultAvailableAmount < spendAmount) {
    const topUp = spendAmount - vaultAvailableAmount;
    const [funds] = tx.splitCoins(mergedPrimaryCoin(tx, coinIds), [topUp]);
    depositTradingBalanceCall(tx, funds);
  }

  const spend = withdrawTradingBalanceCall(tx, spendAmount);
  tx.moveCall({
    target: `${PACKAGE_ID}::predict_manager::deposit`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(managerId), spend],
  });

  const marketKey = marketKeyArgs(tx, oracleId, expiry, strike, direction);
  tx.moveCall({
    target: `${PACKAGE_ID}::predict::mint`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PREDICT_ID),
      tx.object(managerId),
      tx.object(oracleId),
      marketKey,
      tx.pure.u64(quantity),
      tx.object(CLOCK_ID),
    ],
  });

  return tx;
}

/**
 * Build a RangeKey with arbitrary lower/higher strikes (for range positions).
 */
function rangeKeyDirect(
  tx: Transaction,
  oracleId: string,
  expiry: bigint,
  lowerStrike: bigint,
  higherStrike: bigint,
) {
  const [rangeKey] = tx.moveCall({
    target: `${PACKAGE_ID}::range_key::new`,
    arguments: [
      tx.pure.id(oracleId),
      tx.pure.u64(expiry),
      tx.pure.u64(lowerStrike),
      tx.pure.u64(higherStrike),
    ],
  });
  return rangeKey;
}

/**
 * Mint a range position with arbitrary lower/higher strikes.
 */
export function mintRangePositionTx(
  managerId: string,
  oracleId: string,
  expiry: bigint,
  lowerStrike: bigint,
  higherStrike: bigint,
  quantity: bigint,
): Transaction {
  const tx = new Transaction();
  const rangeKey = rangeKeyDirect(tx, oracleId, expiry, lowerStrike, higherStrike);
  tx.moveCall({
    target: `${PACKAGE_ID}::predict::mint_range`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PREDICT_ID),
      tx.object(managerId),
      tx.object(oracleId),
      rangeKey,
      tx.pure.u64(quantity),
      tx.object(CLOCK_ID),
    ],
  });
  return tx;
}

/**
 * Redeem a range position with arbitrary lower/higher strikes.
 */
export function redeemRangePositionTx(
  managerId: string,
  oracleId: string,
  expiry: bigint,
  lowerStrike: bigint,
  higherStrike: bigint,
  quantity: bigint,
): Transaction {
  const tx = new Transaction();
  const rangeKey = rangeKeyDirect(tx, oracleId, expiry, lowerStrike, higherStrike);
  tx.moveCall({
    target: `${PACKAGE_ID}::predict::redeem_range`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PREDICT_ID),
      tx.object(managerId),
      tx.object(oracleId),
      rangeKey,
      tx.pure.u64(quantity),
      tx.object(CLOCK_ID),
    ],
  });
  return tx;
}

/**
 * Atomic: deposit DUSDC from wallet + mint range position in one PTB.
 */
export function depositAndMintRangeTx(
  managerId: string,
  coinIds: string[],
  depositAmount: bigint,
  oracleId: string,
  expiry: bigint,
  lowerStrike: bigint,
  higherStrike: bigint,
  quantity: bigint,
  owner: string,
): Transaction {
  const tx = new Transaction();

  // Step 1: Merge and split coins for deposit
  let primaryCoin;
  if (coinIds.length === 1) {
    primaryCoin = tx.object(coinIds[0]);
  } else {
    primaryCoin = tx.object(coinIds[0]);
    if (coinIds.length > 1) {
      tx.mergeCoins(primaryCoin, coinIds.slice(1).map(id => tx.object(id)));
    }
  }
  const [splitCoin] = tx.splitCoins(primaryCoin, [depositAmount]);

  // Step 2: Deposit into manager
  tx.moveCall({
    target: `${PACKAGE_ID}::predict_manager::deposit`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(managerId), splitCoin],
  });

  // Step 3: Build range key and mint
  const rangeKey = rangeKeyDirect(tx, oracleId, expiry, lowerStrike, higherStrike);
  tx.moveCall({
    target: `${PACKAGE_ID}::predict::mint_range`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PREDICT_ID),
      tx.object(managerId),
      tx.object(oracleId),
      rangeKey,
      tx.pure.u64(quantity),
      tx.object(CLOCK_ID),
    ],
  });

  // Step 4: sweep the unspent remainder back to the wallet (see depositAndMintTx).
  sweepManagerResidual(tx, managerId, owner);

  return tx;
}

/**
 * Atomic range version: optional wallet top-up -> TradingVault -> PredictManager -> mint_range.
 */
export function tradingBalanceDepositAndMintRangeTx(
  managerId: string,
  coinIds: string[],
  vaultAvailableAmount: bigint,
  spendAmount: bigint,
  oracleId: string,
  expiry: bigint,
  lowerStrike: bigint,
  higherStrike: bigint,
  quantity: bigint,
): Transaction {
  const tx = new Transaction();

  if (vaultAvailableAmount < spendAmount) {
    const topUp = spendAmount - vaultAvailableAmount;
    const [funds] = tx.splitCoins(mergedPrimaryCoin(tx, coinIds), [topUp]);
    depositTradingBalanceCall(tx, funds);
  }

  const spend = withdrawTradingBalanceCall(tx, spendAmount);
  tx.moveCall({
    target: `${PACKAGE_ID}::predict_manager::deposit`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(managerId), spend],
  });

  const rangeKey = rangeKeyDirect(tx, oracleId, expiry, lowerStrike, higherStrike);
  tx.moveCall({
    target: `${PACKAGE_ID}::predict::mint_range`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PREDICT_ID),
      tx.object(managerId),
      tx.object(oracleId),
      rangeKey,
      tx.pure.u64(quantity),
      tx.object(CLOCK_ID),
    ],
  });

  return tx;
}

/**
 * Withdraw all PLP coins (merge if multiple) → receive DUSDC back.
 */
export function withdrawAllPlpTx(
  plpCoinIds: string[],
  senderAddress: string,
): Transaction {
  const tx = new Transaction();
  let primaryCoin = tx.object(plpCoinIds[0]);
  if (plpCoinIds.length > 1) {
    tx.mergeCoins(primaryCoin, plpCoinIds.slice(1).map(id => tx.object(id)));
  }
  const [dusdc] = tx.moveCall({
    target: `${PACKAGE_ID}::predict::withdraw`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PREDICT_ID),
      primaryCoin,
      tx.object(CLOCK_ID),
    ],
  });
  tx.transferObjects([dusdc], senderAddress);
  return tx;
}

/**
 * Supply DUSDC as LP → receive PLP tokens.
 * public fun supply<Quote>(predict, coin, clock, ctx): Coin<PLP>
 */
export function supplyLpTx(coinIds: string[], amount: bigint, senderAddress: string): Transaction {
  const tx = new Transaction();
  let primaryCoin;
  if (coinIds.length === 1) {
    primaryCoin = tx.object(coinIds[0]);
  } else {
    primaryCoin = tx.object(coinIds[0]);
    if (coinIds.length > 1) {
      tx.mergeCoins(primaryCoin, coinIds.slice(1).map(id => tx.object(id)));
    }
  }
  const [splitCoin] = tx.splitCoins(primaryCoin, [amount]);
  const [plpCoin] = tx.moveCall({
    target: `${PACKAGE_ID}::predict::supply`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PREDICT_ID),
      splitCoin,
      tx.object(CLOCK_ID),
    ],
  });
  tx.transferObjects([plpCoin], senderAddress);
  return tx;
}

/**
 * Withdraw PLP → receive DUSDC back.
 * public fun withdraw<Quote>(predict, lp_coin, clock, ctx): Coin<Quote>
 */
export function withdrawLpTx(plpCoinId: string, senderAddress: string): Transaction {
  const tx = new Transaction();
  const [dusdc] = tx.moveCall({
    target: `${PACKAGE_ID}::predict::withdraw`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PREDICT_ID),
      tx.object(plpCoinId),
      tx.object(CLOCK_ID),
    ],
  });
  // Transfer the received DUSDC back to sender
  tx.transferObjects([dusdc], senderAddress);
  return tx;
}
