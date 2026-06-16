// DeepBook Predict + yosuku contract addresses — now sourced from the single network
// switch in ./network.ts. Every export name below is unchanged (call sites untouched);
// the VALUES come from the active network (NEXT_PUBLIC_SUI_NETWORK, default testnet).
// To retarget mainnet: fill the MAINNET block in network.ts and flip the env var.
import { NET, SUI_NETWORK, PREDICT_LIVE } from './network';

export { SUI_NETWORK, PREDICT_LIVE };

export const PACKAGE_ID = NET.predictPackage;
export const REGISTRY_ID = NET.predictRegistry;
export const PREDICT_ID = NET.predictObject;

export const DUSDC_TYPE = NET.dusdcType;
export const DUSDC_CURRENCY = NET.dusdcCurrency;
export const PLP_TYPE = `${PACKAGE_ID}::plp::PLP`;

export const CLOCK_ID = '0x6';
export const PREDICT_SERVER = NET.predictServer;

// yolev — yosuku's own leverage layer. v4: UNDERWRITING + a KEEPER. The reserve is the
// counterparty: it fronts the leveraged notional and charges a premium up front. Traders
// have NO debt — max loss = margin. Leveraged positions are custodied in a protocol-owned
// (keeper-owned) PredictManager; a settlement keeper redeems winners → repays the reserve
// → pays the trader. `settle` is permissionless and always routes PnL to the position
// owner, so it's trustless: no one can divert proceeds and the reserve is always repaid.
export const YOLEV_PACKAGE = NET.yolevPackage;
// underwrite::Reserve<DUSDC> (Shared) — 3x max, 8% premium on fronted, 60% exposure cap.
export const RESERVE_ID = NET.reserveId;
// keeper-owned shared PredictManager that holds every leveraged position.
export const LEVERAGE_MANAGER_ID = NET.leverageManagerId;
// the settlement keeper EOA (owns the leverage manager; runs the settle crank).
export const KEEPER_ADDRESS = NET.keeperAddress;

// DeepBook spot v3 (CLOB) — LIVE on mainnet; available for spot-routed / spot-collateral flows.
export const DEEPBOOK_SPOT_PACKAGE = NET.deepbookSpotPackage;
export const DEEPBOOK_SPOT_REGISTRY = NET.deepbookSpotRegistry;

// FLOAT_SCALING used in DeepBook Predict (1e9)
export const FLOAT_SCALING = 1_000_000_000;

// DUSDC has 6 decimals, same as USDCx
export const DUSDC_DECIMALS = 6;
export const DUSDC_MULTIPLIER = 1_000_000;

// Sentinel strike values for binary positions
// neg_inf = 0, pos_inf = u64::MAX
export const NEG_INF = '0';
export const POS_INF = '18446744073709551615';

// Module paths for transaction building
export const MODULES = {
  predict: `${PACKAGE_ID}::predict`,
  predictManager: `${PACKAGE_ID}::predict_manager`,
  registry: `${PACKAGE_ID}::registry`,
  rangeKey: `${PACKAGE_ID}::range_key`,
} as const;
