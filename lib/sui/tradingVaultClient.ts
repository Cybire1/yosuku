// PTB builders for yolev::trading_vault.
//
// TradingVault is the on-chain Trading Balance layer: users fund once, then
// trades, private cashouts, leverage, and agent budgets can debit/credit the
// same account without juggling wallet coins on every action.
import {
  Transaction,
  type TransactionObjectArgument,
  type TransactionResult,
} from '@mysten/sui/transactions';
import {
  CLOCK_ID,
  DUSDC_TYPE,
  MARGIN_DESK_ID,
  PACKAGE_ID,
  TRADING_VAULT_PACKAGE,
  TRADING_VAULT_ID,
} from './constants';

function configured(value: string, label: string): string {
  if (!value) {
    throw new Error(`${label} is not configured. Set NEXT_PUBLIC_${label} after deploying TradingVault.`);
  }
  return value;
}

function vaultId(): string {
  return configured(TRADING_VAULT_ID, 'TRADING_VAULT_ID');
}

function marginDeskId(): string {
  return configured(MARGIN_DESK_ID, 'MARGIN_DESK_ID');
}

function tradingVaultPackage(): string {
  return configured(TRADING_VAULT_PACKAGE, 'TRADING_VAULT_PACKAGE');
}

function mergedPrimary(tx: Transaction, coinIds: string[]) {
  if (coinIds.length === 0) throw new Error('No DUSDC coin selected');
  const primary = tx.object(coinIds[0]);
  if (coinIds.length > 1) tx.mergeCoins(primary, coinIds.slice(1).map((id) => tx.object(id)));
  return primary;
}

export function createTradingVaultTx(): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${tradingVaultPackage()}::trading_vault::create`,
    typeArguments: [DUSDC_TYPE],
    arguments: [],
  });
  return tx;
}

export function depositTradingBalanceTx(p: { coinIds: string[]; amount: bigint }): Transaction {
  const tx = new Transaction();
  const [funds] = tx.splitCoins(mergedPrimary(tx, p.coinIds), [p.amount]);
  depositTradingBalanceCall(tx, funds);
  return tx;
}

export function depositTradingBalanceCall(tx: Transaction, funds: TransactionObjectArgument) {
  tx.moveCall({
    target: `${tradingVaultPackage()}::trading_vault::deposit`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(vaultId()), funds],
  });
}

export function withdrawTradingBalanceTx(p: { amount: bigint; owner: string }): Transaction {
  const tx = new Transaction();
  const coin = withdrawTradingBalanceCall(tx, p.amount);
  tx.transferObjects([coin], tx.pure.address(p.owner));
  return tx;
}

export function withdrawTradingBalanceCall(tx: Transaction, amount: bigint): TransactionResult {
  return tx.moveCall({
    target: `${tradingVaultPackage()}::trading_vault::withdraw`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(vaultId()), tx.pure.u64(amount)],
  });
}

export function moveTradingToPrivateTx(amount: bigint): Transaction {
  const tx = new Transaction();
  moveTradingToPrivateCall(tx, amount);
  return tx;
}

export function moveTradingToPrivateCall(tx: Transaction, amount: bigint) {
  tx.moveCall({
    target: `${tradingVaultPackage()}::trading_vault::move_to_private`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(vaultId()), tx.pure.u64(amount)],
  });
}

export function withdrawPrivateTradingBalanceTx(p: { amount: bigint; owner: string }): Transaction {
  const tx = new Transaction();
  const coin = withdrawPrivateTradingBalanceCall(tx, p.amount);
  tx.transferObjects([coin], tx.pure.address(p.owner));
  return tx;
}

export function withdrawPrivateTradingBalanceCall(tx: Transaction, amount: bigint): TransactionResult {
  return tx.moveCall({
    target: `${tradingVaultPackage()}::trading_vault::withdraw_private`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(vaultId()), tx.pure.u64(amount)],
  });
}

export function allocateAgentBudgetTx(p: {
  amount: bigint;
  agent: string;
  maxTrade: bigint;
  maxLeverageBps: bigint;
  maxDailyLoss: bigint;
  expiresAtMs: bigint;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${tradingVaultPackage()}::trading_vault::allocate_agent`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(vaultId()),
      tx.pure.u64(p.amount),
      tx.pure.address(p.agent),
      tx.pure.u64(p.maxTrade),
      tx.pure.u64(p.maxLeverageBps),
      tx.pure.u64(p.maxDailyLoss),
      tx.pure.u64(p.expiresAtMs),
    ],
  });
  return tx;
}

export function revokeAgentBudgetTx(): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${tradingVaultPackage()}::trading_vault::revoke_agent`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(vaultId())],
  });
  return tx;
}

export function openTradingBalanceBinaryLeverageTx(p: {
  marginAmount: bigint;
  leverageBps: bigint;
  oracleId: string;
  expiry: bigint;
  strike: bigint;
  isUp: boolean;
}): Transaction {
  return openTradingBalanceLeverageTx({
    marginAmount: p.marginAmount,
    leverageBps: p.leverageBps,
    oracleId: p.oracleId,
    expiry: p.expiry,
    isRange: false,
    lowerStrike: p.strike,
    higherStrike: BigInt(0),
    isUp: p.isUp,
  });
}

export function fundAndOpenTradingBalanceBinaryLeverageTx(p: {
  coinIds: string[];
  vaultAvailableAmount: bigint;
  marginAmount: bigint;
  leverageBps: bigint;
  oracleId: string;
  expiry: bigint;
  strike: bigint;
  isUp: boolean;
}): Transaction {
  return fundAndOpenTradingBalanceLeverageTx({
    coinIds: p.coinIds,
    vaultAvailableAmount: p.vaultAvailableAmount,
    marginAmount: p.marginAmount,
    leverageBps: p.leverageBps,
    oracleId: p.oracleId,
    expiry: p.expiry,
    isRange: false,
    lowerStrike: p.strike,
    higherStrike: BigInt(0),
    isUp: p.isUp,
  });
}

export function openTradingBalanceRangeLeverageTx(p: {
  marginAmount: bigint;
  leverageBps: bigint;
  oracleId: string;
  expiry: bigint;
  lower: bigint;
  higher: bigint;
}): Transaction {
  return openTradingBalanceLeverageTx({
    marginAmount: p.marginAmount,
    leverageBps: p.leverageBps,
    oracleId: p.oracleId,
    expiry: p.expiry,
    isRange: true,
    lowerStrike: p.lower,
    higherStrike: p.higher,
    isUp: false,
  });
}

export function fundAndOpenTradingBalanceRangeLeverageTx(p: {
  coinIds: string[];
  vaultAvailableAmount: bigint;
  marginAmount: bigint;
  leverageBps: bigint;
  oracleId: string;
  expiry: bigint;
  lower: bigint;
  higher: bigint;
}): Transaction {
  return fundAndOpenTradingBalanceLeverageTx({
    coinIds: p.coinIds,
    vaultAvailableAmount: p.vaultAvailableAmount,
    marginAmount: p.marginAmount,
    leverageBps: p.leverageBps,
    oracleId: p.oracleId,
    expiry: p.expiry,
    isRange: true,
    lowerStrike: p.lower,
    higherStrike: p.higher,
    isUp: false,
  });
}

function openTradingBalanceLeverageTx(p: {
  marginAmount: bigint;
  leverageBps: bigint;
  oracleId: string;
  expiry: bigint;
  isRange: boolean;
  lowerStrike: bigint;
  higherStrike: bigint;
  isUp: boolean;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${tradingVaultPackage()}::trading_vault::open_leverage`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(vaultId()),
      tx.object(marginDeskId()),
      tx.pure.id(p.oracleId),
      tx.pure.u64(p.marginAmount),
      tx.pure.u64(p.leverageBps),
      tx.pure.u64(p.expiry),
      tx.pure.bool(p.isRange),
      tx.pure.u64(p.lowerStrike),
      tx.pure.u64(p.higherStrike),
      tx.pure.bool(p.isUp),
      tx.object(CLOCK_ID),
    ],
  });
  return tx;
}

function fundAndOpenTradingBalanceLeverageTx(p: {
  coinIds: string[];
  vaultAvailableAmount: bigint;
  marginAmount: bigint;
  leverageBps: bigint;
  oracleId: string;
  expiry: bigint;
  isRange: boolean;
  lowerStrike: bigint;
  higherStrike: bigint;
  isUp: boolean;
}): Transaction {
  const tx = new Transaction();
  if (p.vaultAvailableAmount < p.marginAmount) {
    const topUp = p.marginAmount - p.vaultAvailableAmount;
    const [funds] = tx.splitCoins(mergedPrimary(tx, p.coinIds), [topUp]);
    depositTradingBalanceCall(tx, funds);
  }
  tx.moveCall({
    target: `${tradingVaultPackage()}::trading_vault::open_leverage`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(vaultId()),
      tx.object(marginDeskId()),
      tx.pure.id(p.oracleId),
      tx.pure.u64(p.marginAmount),
      tx.pure.u64(p.leverageBps),
      tx.pure.u64(p.expiry),
      tx.pure.bool(p.isRange),
      tx.pure.u64(p.lowerStrike),
      tx.pure.u64(p.higherStrike),
      tx.pure.bool(p.isUp),
      tx.object(CLOCK_ID),
    ],
  });
  return tx;
}

export function agentOpenTradingBalanceBinaryLeverageTx(p: {
  user: string;
  marginAmount: bigint;
  leverageBps: bigint;
  oracleId: string;
  expiry: bigint;
  strike: bigint;
  isUp: boolean;
}): Transaction {
  return agentOpenTradingBalanceLeverageTx({
    user: p.user,
    marginAmount: p.marginAmount,
    leverageBps: p.leverageBps,
    oracleId: p.oracleId,
    expiry: p.expiry,
    isRange: false,
    lowerStrike: p.strike,
    higherStrike: BigInt(0),
    isUp: p.isUp,
  });
}

export function agentOpenTradingBalanceLeverageTx(p: {
  user: string;
  marginAmount: bigint;
  leverageBps: bigint;
  oracleId: string;
  expiry: bigint;
  isRange: boolean;
  lowerStrike: bigint;
  higherStrike: bigint;
  isUp: boolean;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${tradingVaultPackage()}::trading_vault::agent_open_leverage`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(vaultId()),
      tx.object(marginDeskId()),
      tx.pure.id(p.oracleId),
      tx.pure.address(p.user),
      tx.pure.u64(p.marginAmount),
      tx.pure.u64(p.leverageBps),
      tx.pure.u64(p.expiry),
      tx.pure.bool(p.isRange),
      tx.pure.u64(p.lowerStrike),
      tx.pure.u64(p.higherStrike),
      tx.pure.bool(p.isUp),
      tx.object(CLOCK_ID),
    ],
  });
  return tx;
}

export function creditAvailableForCall(
  tx: Transaction,
  user: string,
  funds: TransactionObjectArgument,
) {
  tx.moveCall({
    target: `${tradingVaultPackage()}::trading_vault::credit_available_for`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(vaultId()), tx.pure.address(user), funds],
  });
}

export function creditPrivateForCall(
  tx: Transaction,
  user: string,
  funds: TransactionObjectArgument,
) {
  tx.moveCall({
    target: `${tradingVaultPackage()}::trading_vault::credit_private_for`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(vaultId()), tx.pure.address(user), funds],
  });
}

export function returnLockedForCall(
  tx: Transaction,
  user: string,
  funds: TransactionObjectArgument,
) {
  tx.moveCall({
    target: `${tradingVaultPackage()}::trading_vault::return_locked_for`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(vaultId()), tx.pure.address(user), funds],
  });
}

export function writeOffLockedForTx(p: { user: string; amount: bigint }): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${tradingVaultPackage()}::trading_vault::write_off_locked_for`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(vaultId()), tx.pure.address(p.user), tx.pure.u64(p.amount)],
  });
  return tx;
}

export function sweepManagerToTradingBalanceTx(p: {
  managerId: string;
  amount: bigint;
  owner: string;
}): Transaction {
  const tx = new Transaction();
  const funds = tx.moveCall({
    target: `${PACKAGE_ID}::predict_manager::withdraw`,
    typeArguments: [DUSDC_TYPE],
    arguments: [tx.object(p.managerId), tx.pure.u64(p.amount)],
  });
  creditAvailableForCall(tx, p.owner, funds);
  return tx;
}

export const TRADING_VAULT_TYPE = `${TRADING_VAULT_PACKAGE}::trading_vault::TradingVault<${DUSDC_TYPE}>`;
export const TRADING_VAULT_EVENTS = {
  deposited: `${TRADING_VAULT_PACKAGE}::trading_vault::Deposited`,
  credited: `${TRADING_VAULT_PACKAGE}::trading_vault::Credited`,
  withdrawn: `${TRADING_VAULT_PACKAGE}::trading_vault::Withdrawn`,
  privateMoved: `${TRADING_VAULT_PACKAGE}::trading_vault::PrivateMoved`,
  privateWithdrawn: `${TRADING_VAULT_PACKAGE}::trading_vault::PrivateWithdrawn`,
  leverageOpened: `${TRADING_VAULT_PACKAGE}::trading_vault::LeverageOpened`,
  agentAllocated: `${TRADING_VAULT_PACKAGE}::trading_vault::AgentAllocated`,
  agentLeverageOpened: `${TRADING_VAULT_PACKAGE}::trading_vault::AgentLeverageOpened`,
  lockedReturned: `${TRADING_VAULT_PACKAGE}::trading_vault::LockedReturned`,
  lockedWrittenOff: `${TRADING_VAULT_PACKAGE}::trading_vault::LockedWrittenOff`,
} as const;
