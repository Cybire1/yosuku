// PTB builders + readers for the yolev leverage layer (lending pool + leveraged CDP).
import { Transaction } from '@mysten/sui/transactions';
import {
  YOLEV_PACKAGE,
  LENDING_POOL_ID,
  LEV_CONFIG_ID,
  PACKAGE_ID,
  PREDICT_ID,
  DUSDC_TYPE,
  CLOCK_ID,
  DUSDC_MULTIPLIER,
} from './constants';

const RAY = 1_000_000_000_000; // 1e12 index scale (mirrors lending_pool.move)
const MS_PER_YEAR = 31_536_000_000;

function mergedPrimary(tx: Transaction, coinIds: string[]) {
  const primary = tx.object(coinIds[0]);
  if (coinIds.length > 1) tx.mergeCoins(primary, coinIds.slice(1).map((id) => tx.object(id)));
  return primary;
}

/** LP: supply DUSDC to the pool, receive a SupplyPosition. */
export function supplyTx(coinIds: string[], amount: bigint, owner: string): Transaction {
  const tx = new Transaction();
  const [c] = tx.splitCoins(mergedPrimary(tx, coinIds), [amount]);
  const sp = tx.moveCall({
    target: `${YOLEV_PACKAGE}::lending_pool::supply`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(LENDING_POOL_ID), c, tx.object(CLOCK_ID)],
  });
  tx.transferObjects([sp], tx.pure.address(owner));
  return tx;
}

/** LP: redeem a SupplyPosition for principal + earned interest. */
export function withdrawTx(positionId: string, owner: string): Transaction {
  const tx = new Transaction();
  const coin = tx.moveCall({
    target: `${YOLEV_PACKAGE}::lending_pool::withdraw`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(LENDING_POOL_ID), tx.object(positionId), tx.object(CLOCK_ID)],
  });
  tx.transferObjects([coin], tx.pure.address(owner));
  return tx;
}

/** Open a leveraged position and mint a RANGE Predict position with the notional. */
export function openLeveragedRangeTx(p: {
  managerId: string;
  coinIds: string[];
  marginAmount: bigint;
  borrowAmount: bigint;
  oracleId: string;
  expiry: bigint;
  lower: bigint;
  higher: bigint;
  quantity: bigint;
  owner: string;
}): Transaction {
  const tx = new Transaction();
  const [margin] = tx.splitCoins(mergedPrimary(tx, p.coinIds), [p.marginAmount]);
  const open = tx.moveCall({
    target: `${YOLEV_PACKAGE}::leverage::open`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(LEV_CONFIG_ID), tx.object(LENDING_POOL_ID), margin, tx.pure.u64(p.borrowAmount), tx.object(CLOCK_ID)],
  });
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

/** Open a leveraged position and mint a BINARY (UP/DOWN) Predict position. */
export function openLeveragedBinaryTx(p: {
  managerId: string;
  coinIds: string[];
  marginAmount: bigint;
  borrowAmount: bigint;
  oracleId: string;
  expiry: bigint;
  strike: bigint;
  isUp: boolean;
  quantity: bigint;
  owner: string;
}): Transaction {
  const tx = new Transaction();
  const [margin] = tx.splitCoins(mergedPrimary(tx, p.coinIds), [p.marginAmount]);
  const open = tx.moveCall({
    target: `${YOLEV_PACKAGE}::leverage::open`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(LEV_CONFIG_ID), tx.object(LENDING_POOL_ID), margin, tx.pure.u64(p.borrowAmount), tx.object(CLOCK_ID)],
  });
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

// ─── read: pool stats (computed from the on-chain object fields) ───
export interface PoolStats {
  liquidity: number;      // idle DUSDC
  totalBorrowed: number;  // outstanding DUSDC (incl. accrued)
  totalValue: number;     // liquidity + borrowed
  utilizationBps: number;
  borrowAprBps: number;
  supplyAprBps: number;
  supplyShares: number;   // raw (u128)
  borrowIndex: number;    // raw (u128)
}

interface PoolFields {
  liquidity: string;
  total_borrow_scaled: string;
  supply_shares: string;
  borrow_index: string;
  base_rate_bps: string;
  slope_bps: string;
}

export function computePoolStats(fields: PoolFields): PoolStats {
  const liquidity = Number(fields.liquidity);
  const scaled = Number(fields.total_borrow_scaled);
  const index = Number(fields.borrow_index);
  const totalBorrowed = (scaled * index) / RAY;
  const totalValue = liquidity + totalBorrowed;
  const utilizationBps = totalValue > 0 ? Math.round((totalBorrowed / totalValue) * 10_000) : 0;
  const borrowAprBps = Number(fields.base_rate_bps) + Math.round((Number(fields.slope_bps) * utilizationBps) / 10_000);
  // suppliers earn borrow interest scaled by utilization
  const supplyAprBps = Math.round((borrowAprBps * utilizationBps) / 10_000);
  return {
    liquidity: liquidity / DUSDC_MULTIPLIER,
    totalBorrowed: totalBorrowed / DUSDC_MULTIPLIER,
    totalValue: totalValue / DUSDC_MULTIPLIER,
    utilizationBps,
    borrowAprBps,
    supplyAprBps,
    supplyShares: Number(fields.supply_shares),
    borrowIndex: index,
  };
}

/** Value (DUSDC) of a SupplyPosition given its shares and the pool stats. */
export function supplyPositionValue(shares: number, stats: PoolStats): number {
  if (stats.supplyShares === 0) return 0;
  return (shares * stats.totalValue) / stats.supplyShares;
}

export const SUPPLY_POSITION_TYPE = `${YOLEV_PACKAGE}::lending_pool::SupplyPosition`;
export const LOAN_TYPE = `${YOLEV_PACKAGE}::leverage::Loan<${DUSDC_TYPE}>`;
export { MS_PER_YEAR };
