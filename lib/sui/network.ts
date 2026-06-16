// THE NETWORK SWITCH — flip the whole app between testnet and mainnet from one place.
//
//   NEXT_PUBLIC_SUI_NETWORK=mainnet  → retargets every address, endpoint, and the wallet.
//   (default: testnet)
//
// Why this exists: Yosuku mints DeepBook **Predict** positions, and DeepBook Predict is
// NOT on mainnet yet (verified on-chain 2026-06-16: the testnet predict package returns
// notExists on mainnet RPC; Sui docs + the deepbookv3 repo confirm "testnet only, mainnet
// later in 2026"). DeepBook **spot** V3 IS live on mainnet. So we keep the product running
// on testnet (where Predict works and our flows are proven on-chain) while staying
// genuinely mainnet-READY: the day Mysten ships Predict to mainnet, fill the MAINNET block
// below and flip the env var — no code changes. `PREDICT_LIVE` gates the Predict-dependent
// surface so a premature mainnet flip degrades gracefully instead of erroring.

export type SuiNetwork = 'testnet' | 'mainnet';

export const SUI_NETWORK: SuiNetwork =
  (process.env.NEXT_PUBLIC_SUI_NETWORK as SuiNetwork) === 'mainnet' ? 'mainnet' : 'testnet';

export interface NetworkConfig {
  network: SuiNetwork;
  // ── DeepBook Predict (the prediction-market protocol Yosuku mints on) ──
  predictPackage: string;
  predictRegistry: string;
  predictObject: string;
  predictServer: string;
  dusdcType: string;
  dusdcCurrency: string;
  // ── yosuku's own deployed packages ──
  yolevPackage: string;
  reserveId: string;
  leverageManagerId: string;
  keeperAddress: string;
  strategyPackage: string; // yolev upgrade #2 — strategy + social_vault copy-trade
  socialVaultId: string;   // the shared no-divert social vault
  // ── DeepBook SPOT v3 (CLOB) — LIVE on mainnet today; usable for spot-routed flows ──
  deepbookSpotPackage: string;
  deepbookSpotRegistry: string;
  // ── endpoints (post-JSON-RPC: GraphQL reads + gRPC simulate/execute) ──
  graphqlUrl: string;
  grpcUrl: string;
  // ── is the Predict-dependent core actually deployable/usable on this network? ──
  predictLive: boolean;
}

const TESTNET: NetworkConfig = {
  network: 'testnet',
  predictPackage: '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138',
  predictRegistry: '0x43af14fed5480c20ff77e2263d5f794c35b9fab7e2212903127062f4fe2a6e64',
  predictObject: '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a',
  predictServer: 'https://predict-server.testnet.mystenlabs.com',
  dusdcType: '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC',
  dusdcCurrency: '0xf3000dff421833d4bb8ed58fac146d691a3aaba2785aa1989af65a7089ca3e9c',
  yolevPackage: '0x75e00dc36b96cc4adafd4b180c791f7a0fb40aed92fd11c40968227fc6318a36',
  reserveId: '0xf715b4b8887b5e6de20f7d7eff5bd07f952f9aafaf65b477330d3c05b8c0cec0',
  leverageManagerId: '0x45cd0bb299e63046c6d404af8d97a65bb53c9b6c6b0004f923f029a1042e61e6',
  keeperAddress: '0xaa50ec0fe985825bd45fcc65d301da096a487349d6993fe8f9305890284a7244',
  strategyPackage: '0x47d3c108b2165cb1190eefd0b67f73a386e8ca71b870f87a9afb096056795388',
  socialVaultId: '0xbe9e96fb8cb6be797c00529fc1f4fe1119192299579167140a084d946851e07b',
  deepbookSpotPackage: '0x337f4f4f6567fcd778d5454f27c16c70e2f274cc6377ea6249ddf491482ef497',
  deepbookSpotRegistry: '0xaf16199a2dff736e9f07a845f23c5da6df6f756eddb631aed9d24a93efc4549d',
  graphqlUrl: 'https://graphql.testnet.sui.io/graphql',
  grpcUrl: 'https://fullnode.testnet.sui.io:443',
  predictLive: true,
};

// MAINNET — DeepBook Predict is not deployed here yet (as of 2026-06-16). The spot V3
// CLOB and the endpoints ARE real and live. The empty fields below fill in the moment
// Predict launches on mainnet; `predictLive: false` keeps the Predict surface dormant
// (graceful empty states, no errors) until they do. Our OWN packages (yolev / strategy /
// social vault) also redeploy to mainnet at that point — they're Predict-dependent.
const MAINNET: NetworkConfig = {
  network: 'mainnet',
  predictPackage: '',   // TODO: DeepBook Predict mainnet package (unannounced)
  predictRegistry: '',  // TODO
  predictObject: '',    // TODO
  predictServer: 'https://predict-server.mainnet.mystenlabs.com', // not live yet
  dusdcType: '',        // mainnet quote asset TBD (docs note testnet=DUSDC, mainnet may differ)
  dusdcCurrency: '',
  yolevPackage: '',     // TODO: redeploy yolev to mainnet once Predict is live
  reserveId: '',
  leverageManagerId: '',
  keeperAddress: '0xaa50ec0fe985825bd45fcc65d301da096a487349d6993fe8f9305890284a7244',
  strategyPackage: '',
  socialVaultId: '',
  deepbookSpotPackage: '0x337f4f4f6567fcd778d5454f27c16c70e2f274cc6377ea6249ddf491482ef497', // LIVE
  deepbookSpotRegistry: '0xaf16199a2dff736e9f07a845f23c5da6df6f756eddb631aed9d24a93efc4549d', // LIVE
  graphqlUrl: 'https://graphql.mainnet.sui.io/graphql',
  grpcUrl: 'https://fullnode.mainnet.sui.io:443',
  predictLive: false,
};

/** The active network's full config — the single source of truth for every address/endpoint. */
export const NET: NetworkConfig = SUI_NETWORK === 'mainnet' ? MAINNET : TESTNET;

/** True when the Predict-dependent surface (markets, leverage, copy-trade) can actually run
 *  on the active network. Use it to gate Predict UI so a mainnet flip degrades gracefully. */
export const PREDICT_LIVE = NET.predictLive;
