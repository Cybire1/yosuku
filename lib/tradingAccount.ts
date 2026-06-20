export interface TradingAccountInput {
  walletDusdc: number;
  tradingAvailableDusdc: number;
  tradingAccountValueDusdc: number;
  privateBalanceDusdc: number;
  leverageEscrowDusdc: number;
  leverageEquityDusdc: number;
  agentAllocationDusdc?: number;
}

export interface TradingAccountSnapshot {
  walletDusdc: number;
  yosukuBalanceDusdc: number;
  totalVisibleDusdc: number;
  tradingAvailableDusdc: number;
  normalOpenValueDusdc: number;
  privateBalanceDusdc: number;
  leverageLockedDusdc: number;
  leverageEquityDusdc: number;
  leverageValueDusdc: number;
  agentAllocationDusdc: number;
}

export function computeTradingAccountSnapshot(input: TradingAccountInput): TradingAccountSnapshot {
  const walletDusdc = Math.max(0, input.walletDusdc);
  const tradingAvailableDusdc = Math.max(0, input.tradingAvailableDusdc);
  const tradingAccountValueDusdc = Math.max(0, input.tradingAccountValueDusdc);
  const privateBalanceDusdc = Math.max(0, input.privateBalanceDusdc);
  const leverageLockedDusdc = Math.max(0, input.leverageEscrowDusdc);
  const leverageEquityDusdc = Math.max(0, input.leverageEquityDusdc);
  const leverageValueDusdc = leverageLockedDusdc + leverageEquityDusdc;
  const agentAllocationDusdc = Math.max(0, input.agentAllocationDusdc ?? 0);
  const normalOpenValueDusdc = Math.max(0, tradingAccountValueDusdc - tradingAvailableDusdc);
  const yosukuBalanceDusdc = tradingAccountValueDusdc + privateBalanceDusdc + leverageValueDusdc + agentAllocationDusdc;

  return {
    walletDusdc,
    yosukuBalanceDusdc,
    totalVisibleDusdc: walletDusdc + yosukuBalanceDusdc,
    tradingAvailableDusdc,
    normalOpenValueDusdc,
    privateBalanceDusdc,
    leverageLockedDusdc,
    leverageEquityDusdc,
    leverageValueDusdc,
    agentAllocationDusdc,
  };
}
