// yolev keeper — the autonomous agent that operates the leverage desk.
//
// Two jobs, both permitted-but-not-trusted (the Move contract enforces every flow):
//   FILL   : a trader escrowed margin in an OpenOrder → the keeper fronts the
//            reserve's capital and mints the leveraged position into the protocol-
//            owned custody manager (only the keeper, as manager owner, can do this).
//            The Position receipt is stamped to the TRADER by the contract.
//   SETTLE : a round resolved → the keeper redeems each position, repays the reserve
//            its fronted capital, and `settle` force-routes the trader's PnL to them.
//
// The keeper can never divert funds. If it's offline, traders `cancel` to reclaim
// escrowed margin and positions simply wait — liveness only, never custody.
// Run:  PK=<keeper key> node scripts/keeper.mjs   (or seal the key in the Bellkeeper TEE)
const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');

const RPC = 'https://fullnode.testnet.sui.io:443';
const PKG = '0x75e00dc36b96cc4adafd4b180c791f7a0fb40aed92fd11c40968227fc6318a36';
const RESERVE = '0xf715b4b8887b5e6de20f7d7eff5bd07f952f9aafaf65b477330d3c05b8c0cec0';
const MGR = '0x45cd0bb299e63046c6d404af8d97a65bb53c9b6c6b0004f923f029a1042e61e6';
const PREDICT = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
const PREDICT_ID = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
const DUSDC = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const CLOCK = '0x6';
const ORACLES_URL = 'https://predict-server.testnet.mystenlabs.com/oracles';
const PREMIUM_BPS = 800, SIZE_BUFFER = 0.92, INTERVAL_MS = 20_000;
const MAINTENANCE_BUFFER_BPS = 1_000; // 10% of reserve debt
const MIN_MAINTENANCE_BUFFER = 20_000; // 0.02 DUSDC
const KEEPER_FEE = 10_000; // 0.01 DUSDC liquidation cushion
const LIQUIDATE_HEALTH_BPS = 10_000;

const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PK).secretKey);
const me = kp.toSuiAddress();
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });
const rpc = async (m, p) =>
  (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json()).result;
const submit = async (tx) => {
  tx.setGasBudget(180_000_000);
  const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx });
  return res.$kind === 'Transaction' ? res.Transaction.digest : res.FailedTransaction.digest;
};
const u64le = (arr) => { let v = 0n; for (let i = arr.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(arr[i]); return v; };

console.log('yolev keeper', me, '· every', INTERVAL_MS / 1000, 's');

// live quote for `qty` units (devInspect get_trade_amounts) → micro-DUSDC amounts
async function quoteTradeMicro(p, qty) {
  const tx = new Transaction();
  const key = p.is_range
    ? tx.moveCall({ target: `${PREDICT}::range_key::new`, arguments: [tx.pure.id(p.oracle_id), tx.pure.u64(p.expiry), tx.pure.u64(p.lower_strike), tx.pure.u64(p.higher_strike)] })
    : tx.moveCall({ target: `${PREDICT}::market_key::${p.is_up ? 'up' : 'down'}`, arguments: [tx.pure.id(p.oracle_id), tx.pure.u64(p.expiry), tx.pure.u64(p.lower_strike)] });
  tx.moveCall({ target: `${PREDICT}::predict::${p.is_range ? 'get_range_trade_amounts' : 'get_trade_amounts'}`, typeArguments: [DUSDC], arguments: [tx.object(PREDICT_ID), tx.object(p.oracle_id), key, tx.pure.u64(qty), tx.object(CLOCK)] });
  const bytes = await tx.build({ client, onlyTransactionKind: true });
  const dr = await rpc('sui_devInspectTransactionBlock', [me, Buffer.from(bytes).toString('base64'), null, null]);
  const rv = dr?.results?.[dr.results.length - 1]?.returnValues;
  return rv ? {
    mintCost: Number(u64le(rv[0][0])),
    redeemPayout: Number(u64le(rv[1][0])),
  } : { mintCost: 0, redeemPayout: 0 };
}

function leverageHealth(p, redeemPayout) {
  const debt = Number(p.fronted ?? 0);
  const maintenance = Math.max(MIN_MAINTENANCE_BUFFER, Math.floor((debt * MAINTENANCE_BUFFER_BPS) / 10_000));
  const required = debt + maintenance + KEEPER_FEE;
  const healthBps = required > 0 ? Math.floor((redeemPayout * 10_000) / required) : 0;
  return { debt, maintenance, required, healthBps };
}

function settleTx(id, p, isWin) {
  const tx = new Transaction();
  let proceeds;
  if (isWin) {
    if (p.is_range) {
      const rk = tx.moveCall({ target: `${PREDICT}::range_key::new`, arguments: [tx.pure.id(p.oracle_id), tx.pure.u64(p.expiry), tx.pure.u64(p.lower_strike), tx.pure.u64(p.higher_strike)] });
      tx.moveCall({ target: `${PREDICT}::predict::redeem_range`, typeArguments: [DUSDC], arguments: [tx.object(PREDICT_ID), tx.object(MGR), tx.object(p.oracle_id), rk, tx.pure.u64(p.quantity), tx.object(CLOCK)] });
    } else {
      const mk = tx.moveCall({ target: `${PREDICT}::market_key::${p.is_up ? 'up' : 'down'}`, arguments: [tx.pure.id(p.oracle_id), tx.pure.u64(p.expiry), tx.pure.u64(p.lower_strike)] });
      tx.moveCall({ target: `${PREDICT}::predict::redeem_permissionless`, typeArguments: [DUSDC], arguments: [tx.object(PREDICT_ID), tx.object(MGR), tx.object(p.oracle_id), mk, tx.pure.u64(p.quantity), tx.object(CLOCK)] });
    }
    proceeds = tx.moveCall({ target: `${PREDICT}::predict_manager::withdraw`, typeArguments: [DUSDC], arguments: [tx.object(MGR), tx.pure.u64(p.quantity)] });
  } else {
    proceeds = tx.moveCall({ target: '0x2::coin::zero', typeArguments: [DUSDC], arguments: [] });
  }
  tx.moveCall({ target: `${PKG}::underwrite::settle`, typeArguments: [DUSDC], arguments: [tx.object(RESERVE), tx.object(id), proceeds] });
  return tx;
}

function liquidationTx(id, p, redeemPayout) {
  const tx = new Transaction();
  const payout = Math.floor(redeemPayout);
  if (p.is_range) {
    const rk = tx.moveCall({ target: `${PREDICT}::range_key::new`, arguments: [tx.pure.id(p.oracle_id), tx.pure.u64(p.expiry), tx.pure.u64(p.lower_strike), tx.pure.u64(p.higher_strike)] });
    tx.moveCall({ target: `${PREDICT}::predict::redeem_range`, typeArguments: [DUSDC], arguments: [tx.object(PREDICT_ID), tx.object(MGR), tx.object(p.oracle_id), rk, tx.pure.u64(p.quantity), tx.object(CLOCK)] });
  } else {
    const mk = tx.moveCall({ target: `${PREDICT}::market_key::${p.is_up ? 'up' : 'down'}`, arguments: [tx.pure.id(p.oracle_id), tx.pure.u64(p.expiry), tx.pure.u64(p.lower_strike)] });
    tx.moveCall({ target: `${PREDICT}::predict::redeem`, typeArguments: [DUSDC], arguments: [tx.object(PREDICT_ID), tx.object(MGR), tx.object(p.oracle_id), mk, tx.pure.u64(p.quantity), tx.object(CLOCK)] });
  }
  const proceeds = payout > 0
    ? tx.moveCall({ target: `${PREDICT}::predict_manager::withdraw`, typeArguments: [DUSDC], arguments: [tx.object(MGR), tx.pure.u64(payout)] })
    : tx.moveCall({ target: '0x2::coin::zero', typeArguments: [DUSDC], arguments: [] });
  tx.moveCall({ target: `${PKG}::underwrite::settle`, typeArguments: [DUSDC], arguments: [tx.object(RESERVE), tx.object(id), proceeds] });
  return tx;
}

async function fillTx(order) {
  const m = Number(order.margin), lev = Number(order.leverage_bps);
  const fronted = Math.floor((m * lev) / 10_000) - m;
  const premium = Math.floor((fronted * PREMIUM_BPS) / 10_000);
  const notional = m * lev / 10_000 - premium; // micro deployed into the position
  // size the mint so the full notional is spent (quote per-unit price)
  const ref = Math.max(1_000_000, Math.floor(notional));
  const { mintCost } = await quoteTradeMicro(order, ref);
  const pricePerUnit = mintCost > 0 ? mintCost / ref : 0.5;
  const quantity = pricePerUnit > 0 ? Math.max(1, Math.floor((notional * SIZE_BUFFER) / pricePerUnit)) : Math.floor(notional);
  const tx = new Transaction();
  const notionalCoin = tx.moveCall({ target: `${PKG}::underwrite::fill`, typeArguments: [DUSDC], arguments: [tx.object(RESERVE), tx.object(order.id), tx.pure.u64(quantity), tx.object(CLOCK)] });
  tx.moveCall({ target: `${PREDICT}::predict_manager::deposit`, typeArguments: [DUSDC], arguments: [tx.object(MGR), notionalCoin] });
  if (order.is_range) {
    const rk = tx.moveCall({ target: `${PREDICT}::range_key::new`, arguments: [tx.pure.id(order.oracle_id), tx.pure.u64(order.expiry), tx.pure.u64(order.lower_strike), tx.pure.u64(order.higher_strike)] });
    tx.moveCall({ target: `${PREDICT}::predict::mint_range`, typeArguments: [DUSDC], arguments: [tx.object(PREDICT_ID), tx.object(MGR), tx.object(order.oracle_id), rk, tx.pure.u64(quantity), tx.object(CLOCK)] });
  } else {
    const mk = tx.moveCall({ target: `${PREDICT}::market_key::${order.is_up ? 'up' : 'down'}`, arguments: [tx.pure.id(order.oracle_id), tx.pure.u64(order.expiry), tx.pure.u64(order.lower_strike)] });
    tx.moveCall({ target: `${PREDICT}::predict::mint`, typeArguments: [DUSDC], arguments: [tx.object(PREDICT_ID), tx.object(MGR), tx.object(order.oracle_id), mk, tx.pure.u64(quantity), tx.object(CLOCK)] });
  }
  return tx;
}

const won = (p, s) => p.is_range ? (s >= Number(p.lower_strike) && s <= Number(p.higher_strike)) : (p.is_up ? s > Number(p.lower_strike) : s <= Number(p.lower_strike));

// collect live objects of a given event type's `position`/`order` id field
async function liveObjects(eventType, idField) {
  const ev = await rpc('suix_queryEvents', [{ MoveEventType: `${PKG}::underwrite::${eventType}` }, null, 200, true]);
  const ids = [...new Set((ev?.data || []).map((e) => e.parsedJson?.[idField]).filter(Boolean))];
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = await rpc('sui_multiGetObjects', [ids.slice(i, i + 50), { showContent: true }]);
    for (const o of batch || []) if (o?.data?.content?.fields) out.push({ ...o.data.content.fields, id: o.data.objectId });
  }
  return out;
}

async function tick() {
  // 1) FILL escrowed orders
  const orders = await liveObjects('OrderRequested', 'order');
  for (const order of orders) {
    try { console.log(`  fill ${order.id.slice(0, 10)} → ${await submit(await fillTx(order))}`); }
    catch (e) { console.log(`  fill skip ${order.id.slice(0, 10)} · ${String(e.message || e).split('\n')[0].slice(0, 80)}`); }
  }
  // 2) SETTLE positions whose oracle resolved
  const positions = await liveObjects('OrderFilled', 'position');
  const oracles = await (await fetch(ORACLES_URL)).json();
  const omap = Object.fromEntries((Array.isArray(oracles) ? oracles : oracles.data || []).map((o) => [o.oracle_id, o]));

  // 2a) LIQUIDATE positions whose live redeem value no longer safely covers reserve debt.
  const live = positions.filter((p) => {
    const o = omap[p.oracle_id];
    return o && o.settlement_price == null && o.status !== 'settled' && Date.now() < Number(p.expiry);
  });
  for (const p of live) {
    try {
      const { redeemPayout } = await quoteTradeMicro(p, Number(p.quantity));
      const h = leverageHealth(p, redeemPayout);
      if (h.healthBps <= LIQUIDATE_HEALTH_BPS) {
        console.log(`  liquidate ${p.id.slice(0, 10)} health ${(h.healthBps / 100).toFixed(1)}% redeem ${(redeemPayout / 1e6).toFixed(4)} → ${await submit(liquidationTx(p.id, p, redeemPayout))}`);
      } else if (h.healthBps < 11_000) {
        console.log(`  watch ${p.id.slice(0, 10)} health ${(h.healthBps / 100).toFixed(1)}% redeem ${(redeemPayout / 1e6).toFixed(4)} required ${(h.required / 1e6).toFixed(4)}`);
      }
    } catch (e) {
      console.log(`  health skip ${p.id.slice(0, 10)} · ${String(e.message || e).split('\n')[0].slice(0, 80)}`);
    }
  }

  const ready = positions.filter((p) => { const o = omap[p.oracle_id]; return o && o.settlement_price != null && (o.status === 'settled' || Date.now() > Number(p.expiry)); });
  console.log(new Date().toISOString(), `orders ${orders.length} · positions ${positions.length} · ready ${ready.length}`);
  for (const p of ready) {
    const isWin = won(p, omap[p.oracle_id].settlement_price);
    try { console.log(`  settle ${p.id.slice(0, 10)} ${isWin ? 'WIN' : 'loss'} → ${await submit(settleTx(p.id, p, isWin))}`); }
    catch (e) { console.log(`  settle skip ${p.id.slice(0, 10)} · ${String(e.message || e).split('\n')[0].slice(0, 80)}`); }
  }
}

await tick();
setInterval(() => tick().catch((e) => console.log('tick error', String(e).slice(0, 120))), INTERVAL_MS);
