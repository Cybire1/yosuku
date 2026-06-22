// yolev MARGIN keeper — operates the production web leverage desk (the one yosuku.xyz uses).
//
// Desk model (pkg 0x3b76383b::margin): a trader's open_leverage escrows margin into a
// shared OpenOrder. The keeper (desk.keeper, owner of custody_manager) must:
//   FILL      : margin::fill(desk,pool,order,qty,clock) -> notional coin; SAME PTB deposits
//               it into custody_manager + mints exactly `qty` of the Predict position.
//   CLOSE     : settled winner -> redeem winning shares -> margin::close (repays pool, pays owner).
//   LIQUIDATE : settled loser OR mid-round undercollateralised -> margin::liquidate (pool repaid,
//               shortfall socialised, keeper earns liq_penalty).
// The keeper can never divert funds — every exit force-pays the position owner or the pool.
// Run:  PK=<keeper key (0xaa50ec0f)> node scripts/margin-keeper.mjs
const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');

const RPC = 'https://fullnode.testnet.sui.io:443';
const MPKG = '0x3b76383b2bb9bc411dc56c571a1da22f348b3c19518115ae958fe96e031cf30e'; // margin/lending_pool/trading_vault
const DESK = '0x5aa4be2fb3084660e584d29a7323ea73ab96a07728496c5a3832b3b9cc0f4e40';
const POOL = '0x506023587cc1c08dc25882f9bc78e59fdc68c8cb6b58b04dee8d234a437cf12e';
const MGR  = '0xc111d848df05dfc2efdccc7e4248918188ba2e28f2354f47859c7d0d47788c61'; // custody_manager (keeper-owned)
const PREDICT = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
const PREDICT_ID = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
const DUSDC = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const CLOCK = '0x6';
const ORACLES_URL = 'https://predict-server.testnet.mystenlabs.com/oracles';
const BPS = 10_000;
const MAINTENANCE_BPS = 12_000;   // matches the desk: liquidatable when mark*BPS < debt*12000
const SIZE_BUFFER = 0.92;         // mint slightly under notional so the coin always covers mintCost
const INTERVAL_MS = 20_000;

const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PK).secretKey);
const me = kp.toSuiAddress();
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });
const rpc = async (m, p) =>
  (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json()).result;
const submit = async (tx) => {
  tx.setGasBudget(120_000_000);
  const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx });
  return res.$kind === 'Transaction' ? res.Transaction.digest : ('FAILED ' + (res.FailedTransaction?.digest || JSON.stringify(res).slice(0,120)));
};
const u64le = (arr) => { let v = 0n; for (let i = arr.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(arr[i]); return v; };
const DRY = process.env.DRY === '1';

console.log(`yolev margin-keeper ${me} · desk ${DESK.slice(0,10)} · every ${INTERVAL_MS/1000}s${DRY ? ' · DRY-RUN' : ''}`);
if (me.toLowerCase() !== '0xaa50ec0fe985825bd45fcc65d301da096a487349d6993fe8f9305890284a7244')
  console.log('WARNING: signer is not the desk keeper 0xaa50ec0f — fill/close/liquidate will abort ENotKeeper');

// live mint cost + redeem (bid) value for `qty` units, via devInspect get_trade_amounts
async function quoteTradeMicro(p, qty) {
  const tx = new Transaction();
  const key = p.is_range
    ? tx.moveCall({ target: `${PREDICT}::range_key::new`, arguments: [tx.pure.id(p.oracle_id), tx.pure.u64(p.expiry), tx.pure.u64(p.lower_strike), tx.pure.u64(p.higher_strike)] })
    : tx.moveCall({ target: `${PREDICT}::market_key::${p.is_up ? 'up' : 'down'}`, arguments: [tx.pure.id(p.oracle_id), tx.pure.u64(p.expiry), tx.pure.u64(p.lower_strike)] });
  tx.moveCall({ target: `${PREDICT}::predict::${p.is_range ? 'get_range_trade_amounts' : 'get_trade_amounts'}`, arguments: [tx.object(PREDICT_ID), tx.object(p.oracle_id), key, tx.pure.u64(qty), tx.object(CLOCK)] });
  const bytes = await tx.build({ client, onlyTransactionKind: true });
  const dr = await rpc('sui_devInspectTransactionBlock', [me, Buffer.from(bytes).toString('base64'), null, null]);
  const rv = dr?.results?.[dr.results.length - 1]?.returnValues;
  return rv ? { mintCost: Number(u64le(rv[0][0])), redeemPayout: Number(u64le(rv[1][0])) } : { mintCost: 0, redeemPayout: 0 };
}

async function debtOf(principalScaled) {
  const tx = new Transaction();
  tx.moveCall({ target: `${MPKG}::lending_pool::debt_of`, typeArguments: [DUSDC], arguments: [tx.object(POOL), tx.pure.u128(BigInt(principalScaled))] });
  const bytes = await tx.build({ client, onlyTransactionKind: true });
  const dr = await rpc('sui_devInspectTransactionBlock', [me, Buffer.from(bytes).toString('base64'), null, null]);
  const rv = dr?.results?.[dr.results.length - 1]?.returnValues;
  return rv ? Number(u64le(rv[0][0])) : 0;
}

const keyFor = (tx, p) => p.is_range
  ? tx.moveCall({ target: `${PREDICT}::range_key::new`, arguments: [tx.pure.id(p.oracle_id), tx.pure.u64(p.expiry), tx.pure.u64(p.lower_strike), tx.pure.u64(p.higher_strike)] })
  : tx.moveCall({ target: `${PREDICT}::market_key::${p.is_up ? 'up' : 'down'}`, arguments: [tx.pure.id(p.oracle_id), tx.pure.u64(p.expiry), tx.pure.u64(p.lower_strike)] });

async function fillTx(order) {
  const m = Number(order.margin), lev = Number(order.leverage_bps);
  const notional = Math.floor((m * lev) / BPS); // margin + borrowed, fully deployed
  const ref = Math.max(1_000_000, notional);
  const { mintCost } = await quoteTradeMicro(order, ref);
  const pricePerUnit = mintCost > 0 ? mintCost / ref : 0.5;
  const quantity = Math.max(1, Math.floor((notional * SIZE_BUFFER) / pricePerUnit));
  const tx = new Transaction();
  const notionalCoin = tx.moveCall({ target: `${MPKG}::margin::fill`, typeArguments: [DUSDC], arguments: [tx.object(DESK), tx.object(POOL), tx.object(order.id), tx.pure.u64(quantity), tx.object(CLOCK)] });
  tx.moveCall({ target: `${PREDICT}::predict_manager::deposit`, typeArguments: [DUSDC], arguments: [tx.object(MGR), notionalCoin] });
  const key = keyFor(tx, order);
  tx.moveCall({ target: `${PREDICT}::predict::${order.is_range ? 'mint_range' : 'mint'}`, typeArguments: [DUSDC], arguments: [tx.object(PREDICT_ID), tx.object(MGR), tx.object(order.oracle_id), key, tx.pure.u64(quantity), tx.object(CLOCK)] });
  return tx;
}

// redeem `payout` micro from the position into a proceeds coin (settled winner or live mark)
function redeemProceeds(tx, p, settled, payout) {
  const key = keyFor(tx, p);
  if (p.is_range) {
    tx.moveCall({ target: `${PREDICT}::predict::redeem_range`, typeArguments: [DUSDC], arguments: [tx.object(PREDICT_ID), tx.object(MGR), tx.object(p.oracle_id), key, tx.pure.u64(p.quantity), tx.object(CLOCK)] });
  } else {
    const fn = settled ? 'redeem_permissionless' : 'redeem';
    tx.moveCall({ target: `${PREDICT}::predict::${fn}`, typeArguments: [DUSDC], arguments: [tx.object(PREDICT_ID), tx.object(MGR), tx.object(p.oracle_id), key, tx.pure.u64(p.quantity), tx.object(CLOCK)] });
  }
  return tx.moveCall({ target: `${PREDICT}::predict_manager::withdraw`, typeArguments: [DUSDC], arguments: [tx.object(MGR), tx.pure.u64(Math.floor(payout))] });
}

// Settled winner: at settlement the winning payout (= quantity) is auto-credited to the
// manager's balance and the position count is zeroed — so we WITHDRAW it directly, no redeem.
function closeTx(p) {
  const tx = new Transaction();
  const proceeds = tx.moveCall({ target: `${PREDICT}::predict_manager::withdraw`, typeArguments: [DUSDC], arguments: [tx.object(MGR), tx.pure.u64(Number(p.quantity))] });
  tx.moveCall({ target: `${MPKG}::margin::close`, typeArguments: [DUSDC], arguments: [tx.object(DESK), tx.object(POOL), tx.object(p.id), proceeds, tx.object(CLOCK)] });
  return tx;
}

function liquidateTx(p, settled, payout) {
  const tx = new Transaction();
  const proceeds = payout > 0
    ? redeemProceeds(tx, p, settled, payout)
    : tx.moveCall({ target: '0x2::coin::zero', typeArguments: [DUSDC], arguments: [] });
  const reward = tx.moveCall({ target: `${MPKG}::margin::liquidate`, typeArguments: [DUSDC], arguments: [tx.object(DESK), tx.object(POOL), tx.object(p.id), proceeds, tx.object(CLOCK)] });
  tx.transferObjects([reward], me);
  return tx;
}

const won = (p, s) => p.is_range ? (s >= Number(p.lower_strike) && s <= Number(p.higher_strike)) : (p.is_up ? s > Number(p.lower_strike) : s <= Number(p.lower_strike));

// live shared objects referenced by an event's id field (filter to ones still on-chain)
async function liveObjects(eventType, idField) {
  const ev = await rpc('suix_queryEvents', [{ MoveEventType: `${MPKG}::margin::${eventType}` }, null, 200, true]);
  const ids = [...new Set((ev?.data || []).map((e) => e.parsedJson?.[idField]).filter(Boolean))];
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = await rpc('sui_multiGetObjects', [ids.slice(i, i + 50), { showContent: true }]);
    for (const o of batch || []) if (o?.data?.content?.fields) out.push({ ...o.data.content.fields, id: o.data.objectId });
  }
  return out;
}

async function tick() {
  // 1) FILL escrowed orders that haven't expired
  const orders = (await liveObjects('OrderRequested', 'order')).filter((o) => Date.now() < Number(o.expiry));
  for (const order of orders) {
    try { console.log(`  fill ${order.id.slice(0,10)} margin ${(Number(order.margin)/1e6).toFixed(2)} ${Number(order.leverage_bps)/10000}x → ${DRY ? '(dry) '+JSON.stringify((await (await fillTx(order)).build({client})).length)+'b' : await submit(await fillTx(order))}`); }
    catch (e) { console.log(`  fill skip ${order.id.slice(0,10)} · ${String(e.message||e).split('\n')[0].slice(0,90)}`); }
  }
  // 2) manage live positions
  const positions = await liveObjects('PositionOpened', 'position');
  const oracles = await (await fetch(ORACLES_URL)).json();
  const omap = Object.fromEntries((Array.isArray(oracles) ? oracles : oracles.data || []).map((o) => [o.oracle_id, o]));
  let ready = 0, liq = 0;
  for (const p of positions) {
    const o = omap[p.oracle_id];
    if (!o) continue;
    const settled = o.settlement_price != null && (o.status === 'settled' || Date.now() > Number(p.expiry));
    try {
      if (settled) {
        ready++;
        const isWin = won(p, Number(o.settlement_price));
        if (isWin) {
          console.log(`  close WIN ${p.id.slice(0,10)} payout ${(Number(p.quantity)/1e6).toFixed(3)} → ${DRY ? '(dry)' : await submit(closeTx(p))}`);
        } else {
          console.log(`  liquidate LOSS ${p.id.slice(0,10)} → ${DRY ? '(dry)' : await submit(liquidateTx(p, true, 0))}`);
        }
      }
      // NOTE: mid-life liquidation is intentionally disabled. The thin testnet AMM has a
      // wide bid-ask spread, so the instantaneous bid mark would wrongly flag freshly-opened
      // positions as undercollateralised and instakill them. Positions ride to settlement,
      // where winners `close` and losers `liquidate` (the proven paths). TODO: re-enable with
      // a spread-aware / time-decayed health mark before mainnet.
    } catch (e) { console.log(`  manage skip ${p.id.slice(0,10)} · ${String(e.message||e).split('\n')[0].slice(0,90)}`); }
  }
  console.log(`${new Date().toISOString()} orders ${orders.length} · positions ${positions.length} · settled ${ready} · liq ${liq}`);
}

await tick();
if (!process.env.ONCE) setInterval(() => tick().catch((e) => console.log('tick error', String(e).slice(0,140))), INTERVAL_MS);
