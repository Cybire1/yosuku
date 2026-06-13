// PTB builders + readers for the yolev UNDERWRITING vault.
//
// The reserve is the counterparty: a trader posts margin, the reserve fronts the
// rest of the notional and charges a premium up front, and the trader mints a
// Predict position with the combined notional — all in one PTB. The trader has no
// debt (max loss = margin); on close, `settle` reclaims the reserve's fronted
// capital from the redeemed proceeds and returns the remainder.
import { Transaction } from '@mysten/sui/transactions';
import {
  YOLEV_PACKAGE,
  RESERVE_ID,
  PACKAGE_ID,
  PREDICT_ID,
  DUSDC_TYPE,
  CLOCK_ID,
  DUSDC_MULTIPLIER,
} from './constants';

const BPS = 10_000;

function mergedPrimary(tx: Transaction, coinIds: string[]) {
  const primary = tx.object(coinIds[0]);
  if (coinIds.length > 1) tx.mergeCoins(primary, coinIds.slice(1).map((id) => tx.object(id)));
  return primary;
}

/** LP: supply DUSDC to the reserve, receive a SupplyPosition. */
export function supplyTx(coinIds: string[], amount: bigint, owner: string): Transaction {
  const tx = new Transaction();
  const [c] = tx.splitCoins(mergedPrimary(tx, coinIds), [amount]);
  const sp = tx.moveCall({
    target: `${YOLEV_PACKAGE}::underwrite::supply`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(RESERVE_ID), c],
  });
  tx.transferObjects([sp], tx.pure.address(owner));
  return tx;
}

/** LP: redeem a SupplyPosition for principal + earned premiums. */
export function withdrawTx(positionId: string, owner: string): Transaction {
  const tx = new Transaction();
  const coin = tx.moveCall({
    target: `${YOLEV_PACKAGE}::underwrite::withdraw`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(RESERVE_ID), tx.object(positionId)],
  });
  tx.transferObjects([coin], tx.pure.address(owner));
  return tx;
}

/** underwrite::open → returns [Position, notionalCoin]. */
function openCall(tx: Transaction, p: {
  marginCoin: ReturnType<Transaction['splitCoins']>[number];
  leverageBps: number;
  managerId: string;
  oracleId: string;
  expiry: bigint;
  isRange: boolean;
  lower: bigint;
  higher: bigint;
  isUp: boolean;
  quantity: bigint;
}) {
  return tx.moveCall({
    target: `${YOLEV_PACKAGE}::underwrite::open`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(RESERVE_ID), p.marginCoin, tx.pure.u64(p.leverageBps),
      tx.pure.id(p.managerId), tx.pure.id(p.oracleId), tx.pure.u64(p.expiry),
      tx.pure.bool(p.isRange), tx.pure.u64(p.lower), tx.pure.u64(p.higher), tx.pure.bool(p.isUp), tx.pure.u64(p.quantity),
      tx.object(CLOCK_ID),
    ],
  });
}

/** Open a leveraged RANGE position: front the notional, deposit it, mint. */
export function openLeveragedRangeTx(p: {
  managerId: string;
  coinIds: string[];
  marginAmount: bigint;
  leverageBps: number;
  oracleId: string;
  expiry: bigint;
  lower: bigint;
  higher: bigint;
  quantity: bigint;
  owner: string;
}): Transaction {
  const tx = new Transaction();
  const [margin] = tx.splitCoins(mergedPrimary(tx, p.coinIds), [p.marginAmount]);
  const open = openCall(tx, { marginCoin: margin, leverageBps: p.leverageBps, managerId: p.managerId, oracleId: p.oracleId, expiry: p.expiry, isRange: true, lower: p.lower, higher: p.higher, isUp: false, quantity: p.quantity });
  tx.moveCall({
    target: `${PACKAGE_ID}::predict_manager::deposit`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(p.managerId), open[1]],
  });
  const rk = tx.moveCall({
    target: `${PACKAGE_ID}::range_key::new`,
    arguments: [tx.pure.id(p.oracleId), tx.pure.u64(p.expiry), tx.pure.u64(p.lower), tx.pure.u64(p.higher)],
  });
  tx.moveCall({
    target: `${PACKAGE_ID}::predict::mint_range`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(PREDICT_ID), tx.object(p.managerId), tx.object(p.oracleId), rk[0], tx.pure.u64(p.quantity), tx.object(CLOCK_ID)],
  });
  tx.transferObjects([open[0]], tx.pure.address(p.owner));
  return tx;
}

/** Open a leveraged BINARY (UP/DOWN) position. */
export function openLeveragedBinaryTx(p: {
  managerId: string;
  coinIds: string[];
  marginAmount: bigint;
  leverageBps: number;
  oracleId: string;
  expiry: bigint;
  strike: bigint;
  isUp: boolean;
  quantity: bigint;
  owner: string;
}): Transaction {
  const tx = new Transaction();
  const [margin] = tx.splitCoins(mergedPrimary(tx, p.coinIds), [p.marginAmount]);
  const open = openCall(tx, { marginCoin: margin, leverageBps: p.leverageBps, managerId: p.managerId, oracleId: p.oracleId, expiry: p.expiry, isRange: false, lower: p.strike, higher: BigInt(0), isUp: p.isUp, quantity: p.quantity });
  tx.moveCall({
    target: `${PACKAGE_ID}::predict_manager::deposit`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(p.managerId), open[1]],
  });
  const mk = tx.moveCall({
    target: `${PACKAGE_ID}::market_key::${p.isUp ? 'up' : 'down'}`,
    arguments: [tx.pure.id(p.oracleId), tx.pure.u64(p.expiry), tx.pure.u64(p.strike)],
  });
  tx.moveCall({
    target: `${PACKAGE_ID}::predict::mint`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(PREDICT_ID), tx.object(p.managerId), tx.object(p.oracleId), mk[0], tx.pure.u64(p.quantity), tx.object(CLOCK_ID)],
  });
  tx.transferObjects([open[0]], tx.pure.address(p.owner));
  return tx;
}

/** The underwritten position record stored on-chain. */
export interface PositionData {
  id: string;
  owner: string;
  margin: number;     // DUSDC
  fronted: number;    // DUSDC the reserve put up
  premium: number;    // DUSDC paid to the reserve
  notional: number;   // DUSDC deployed into the Predict position
  leverage: number;   // (margin + fronted) / margin
  managerId: string;
  oracleId: string;
  expiry: bigint;
  isRange: boolean;
  lowerStrike: bigint;
  higherStrike: bigint;
  isUp: boolean;
  quantity: bigint;
}

/**
 * Close an underwritten position. For a WIN, redeem the settled position → the
 * payout lands in the manager → withdraw it → `settle` reclaims the reserve's
 * fronted capital and returns the trader's PnL. For a LOSS, the position is worth
 * 0, so we settle with a zero coin (the reserve absorbs the fronted amount).
 */
export function settleTx(pos: PositionData, won: boolean, owner: string): Transaction {
  const tx = new Transaction();
  let proceeds;
  if (won) {
    if (pos.isRange) {
      const rk = tx.moveCall({
        target: `${PACKAGE_ID}::range_key::new`,
        arguments: [tx.pure.id(pos.oracleId), tx.pure.u64(pos.expiry), tx.pure.u64(pos.lowerStrike), tx.pure.u64(pos.higherStrike)],
      });
      tx.moveCall({
        target: `${PACKAGE_ID}::predict::redeem_range`,
        typeArguments: [DUSDC_TYPE],
        arguments: [tx.object(PREDICT_ID), tx.object(pos.managerId), tx.object(pos.oracleId), rk[0], tx.pure.u64(pos.quantity), tx.object(CLOCK_ID)],
      });
    } else {
      const mk = tx.moveCall({
        target: `${PACKAGE_ID}::market_key::${pos.isUp ? 'up' : 'down'}`,
        arguments: [tx.pure.id(pos.oracleId), tx.pure.u64(pos.expiry), tx.pure.u64(pos.lowerStrike)],
      });
      tx.moveCall({
        target: `${PACKAGE_ID}::predict::redeem_permissionless`,
        typeArguments: [DUSDC_TYPE],
        arguments: [tx.object(PREDICT_ID), tx.object(pos.managerId), tx.object(pos.oracleId), mk[0], tx.pure.u64(pos.quantity), tx.object(CLOCK_ID)],
      });
    }
    [proceeds] = [tx.moveCall({
      target: `${PACKAGE_ID}::predict_manager::withdraw`,
      typeArguments: [DUSDC_TYPE],
      arguments: [tx.object(pos.managerId), tx.pure.u64(pos.quantity)],
    })];
  } else {
    proceeds = tx.moveCall({ target: `0x2::coin::zero`, typeArguments: [DUSDC_TYPE], arguments: [] });
  }
  const remainder = tx.moveCall({
    target: `${YOLEV_PACKAGE}::underwrite::settle`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(RESERVE_ID), tx.object(pos.id), proceeds],
  });
  tx.transferObjects([remainder], tx.pure.address(owner));
  return tx;
}

// ─── read: reserve stats ───
export interface ReserveStats {
  liquid: number;       // idle DUSDC (withdrawable)
  outstanding: number;  // DUSDC fronted into open positions
  totalValue: number;   // liquid + outstanding
  utilizationBps: number;
  premiumBps: number;
  maxLeverageBps: number;
  maxExposureBps: number;
  supplyShares: number; // raw
}

interface ReserveFields {
  liquid: string;
  outstanding: string;
  supply_shares: string;
  premium_bps: string;
  max_leverage_bps: string;
  max_exposure_bps: string;
}

export function computeReserveStats(fields: ReserveFields): ReserveStats {
  const liquid = Number(fields.liquid);
  const outstanding = Number(fields.outstanding);
  const totalValue = liquid + outstanding;
  const utilizationBps = totalValue > 0 ? Math.round((outstanding / totalValue) * BPS) : 0;
  return {
    liquid: liquid / DUSDC_MULTIPLIER,
    outstanding: outstanding / DUSDC_MULTIPLIER,
    totalValue: totalValue / DUSDC_MULTIPLIER,
    utilizationBps,
    premiumBps: Number(fields.premium_bps),
    maxLeverageBps: Number(fields.max_leverage_bps),
    maxExposureBps: Number(fields.max_exposure_bps),
    supplyShares: Number(fields.supply_shares),
  };
}

/** Value (DUSDC) of a SupplyPosition given its shares and the reserve stats. */
export function supplyPositionValue(shares: number, stats: ReserveStats): number {
  if (stats.supplyShares === 0) return 0;
  return (shares * stats.totalValue) / stats.supplyShares;
}

export const SUPPLY_POSITION_TYPE = `${YOLEV_PACKAGE}::underwrite::SupplyPosition`;
export const POSITION_TYPE = `${YOLEV_PACKAGE}::underwrite::Position<${DUSDC_TYPE}>`;
