// PTB (Programmable Transaction Block) builders for DeepBook Predict

import { Transaction } from '@mysten/sui/transactions';
import {
  PACKAGE_ID,
  PREDICT_ID,
  DUSDC_TYPE,
  CLOCK_ID,
} from './constants';

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

/**
 * Atomic: deposit DUSDC from wallet + mint position in one PTB.
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
