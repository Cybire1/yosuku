// DeepBook Predict testnet contract addresses and constants

export const PACKAGE_ID = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
export const REGISTRY_ID = '0x43af14fed5480c20ff77e2263d5f794c35b9fab7e2212903127062f4fe2a6e64';
export const PREDICT_ID = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';

export const DUSDC_TYPE = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
export const DUSDC_CURRENCY = '0xf3000dff421833d4bb8ed58fac146d691a3aaba2785aa1989af65a7089ca3e9c';
export const PLP_TYPE = `${PACKAGE_ID}::plp::PLP`;

export const CLOCK_ID = '0x6';
export const PREDICT_SERVER = 'https://predict-server.testnet.mystenlabs.com';

// yolev — yosuku's own leverage layer. v3 (2026-06-13): the UNDERWRITING model.
// The reserve is the counterparty: it fronts the leveraged notional and charges a
// premium up front. Traders have NO debt — max loss = margin — so there is nothing
// to liquidate; settlement is deterministic. See project_yosuku_leverage memory.
export const YOLEV_PACKAGE = '0x0a991b2fdb16614ae5c720655cd145103f910522fbc43547c9f525fd6124841a';
// underwrite::Reserve<DUSDC> (Shared) — 3x max, 8% premium on fronted, 60% exposure cap.
export const RESERVE_ID = '0x69acf004bd0d7eff54fa442840458c31ad01c96a4952d8dcf381d55fbbf5908c';
// kept for any lingering references during the migration (old lending pool, unused).
export const LENDING_POOL_ID = '0xba9eb2d107118d0b9dd2d577d158ec82c4aa97e4f1a5cda196b01bb293aeb9d5';
export const LEV_CONFIG_ID = '0xd4dbc902e98cdc94b5c766c3e8fa4063f170bf7dbd711fc5eabde4d84f57fe8c';

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
