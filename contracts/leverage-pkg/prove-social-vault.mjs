// Prove the trade-from-X NO-DIVERT custody flow end-to-end on testnet:
//   TX0 create_vault   (agent)  per-user custodied vault, agent = attested keeper
//   TX1 deposit        (USER)   USER deposits 2 DUSDC into THEIR OWN vault account
//   TX2 agent_trade    (AGENT)  agent debits 1 DUSDC of USER's balance → opens an order
//                               OWNED BY USER (request_open_for). agent names no beneficiary.
//   TX3 fill+mint      (AGENT)  borrow 1 from pool → mint a real 2 DUSDC Predict position
//                               into agent-owned custody; MarginPosition.owner = USER
//   TX4 redeem@mark    (AGENT)  sell the position at the live mark → proceeds into custody
//   TX5 close          (AGENT)  repay the pool, remainder FORCE-PAID to USER (not the agent)
//
// The headline: the agent moves a user's own funds into a user-owned position and the exit
// force-pays the user. There is no code path by which the agent is ever paid — even a fully
// prompt-injected agent cannot divert a cent. This is the structural answer to the Grok drain.
const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');

const RPC = 'https://fullnode.testnet.sui.io:443';
const PKG = '0xf3c3c446d233c4371c0faa4bf7aa07f740e1c3eac7956e1d128bf6ead09d0706'; // upgraded: social_vault + request_open_for
const PREDICT = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
const PREDICT_ID = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
const DUSDC = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const CLOCK = '0x6';
const DESK = '0x0c47d0aebe44f29c8e7d60d97a38ee327451485c0d5d5916a99f744da1ed7b09';
const POOL = '0x1b824d4bc498695e6adbeaf0f2dee57634c197c67df2f70d1ac93c3f972b8128';
const MGR = '0x3b2df4d0981a46759ce3d99087d109b25422fd570492166f624133ab3a439977';

const agent = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PKK).secretKey); // 0xaa50ec0f
const user = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PKD).secretKey);   // 0x0099f972
const USER = user.toSuiAddress();
const AGENT = agent.toSuiAddress();
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });
const rpc = async (m, p) =>
  (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json());
const run = async (signer, tx, budget = 250_000_000) => {
  tx.setGasBudget(budget);
  const res = await client.signAndExecuteTransaction({ signer, transaction: tx });
  const digest = res.$kind === 'Transaction' ? res.Transaction.digest : res.FailedTransaction.digest;
  await new Promise((r) => setTimeout(r, 4000));
  const tb = await rpc('sui_getTransactionBlock', [digest, { showObjectChanges: true, showEffects: true, showEvents: true }]);
  return { digest, tb, status: tb.result?.effects?.status };
};
const decodeU64 = (arr) => { let v = 0n; arr.forEach((b, i) => (v |= BigInt(b) << (8n * BigInt(i)))); return v; };
const devU64 = async (tx, idx = 0) => {
  const b64 = Buffer.from(await tx.build({ client, onlyTransactionKind: true })).toString('base64');
  const di = await rpc('sui_devInspectTransactionBlock', [AGENT, b64, null, null]);
  const rv = di.result?.results?.at(-1)?.returnValues || [];
  return rv[idx] ? decodeU64(rv[idx][0]) : 0n;
};
const created = (tb, needle) => (tb.result?.objectChanges || []).find((c) => c.type === 'created' && String(c.objectType).includes(needle))?.objectId;
const ev = (tb, needle) => (tb.result?.events || []).filter((e) => String(e.type).includes(needle)).map((e) => e.parsedJson);
const balU64 = async (obj, target, args) => { const t = new Transaction(); t.moveCall({ target, typeArguments: [DUSDC], arguments: args(t) }); return devU64(t, 0); };

console.log('USER', USER.slice(0, 12), '· AGENT', AGENT.slice(0, 12), '· pkg', PKG.slice(0, 12), '\n');

// ── TX0: create the per-user vault. agent = the attested keeper, max_trade = 5 DUSDC. ──
const tx0 = new Transaction();
tx0.moveCall({ target: `${PKG}::social_vault::create_vault`, typeArguments: [DUSDC], arguments: [tx0.pure.address(AGENT), tx0.pure.u64(5_000_000)] });
const r0 = await run(agent, tx0);
const VAULT = created(r0.tb, 'social_vault::Vault');
console.log('TX0 create_vault', r0.status?.status, '· vault', VAULT?.slice(0, 12), r0.digest);

// ── TX1: USER deposits 2 DUSDC into their own vault account ──
const coins = await rpc('suix_getCoins', [USER, DUSDC, null, 5]);
const tx1 = new Transaction();
const [dep] = tx1.splitCoins(tx1.object(coins.result.data[0].coinObjectId), [2_000_000n]);
tx1.moveCall({ target: `${PKG}::social_vault::deposit`, typeArguments: [DUSDC], arguments: [tx1.object(VAULT), dep] });
const r1 = await run(user, tx1);
console.log('TX1 deposit 2 DUSDC', r1.status?.status, '· event', JSON.stringify(ev(r1.tb, 'Deposited')[0]), r1.digest);

// pick the soonest active BTC oracle with >1h left, ATM up-strike
const oracles = await (await fetch('https://predict-server.testnet.mystenlabs.com/oracles')).json();
const o = (Array.isArray(oracles) ? oracles : oracles.data || [])
  .filter((x) => x.status === 'active' && Number(x.expiry) > Date.now() + 3600_000).sort((a, b) => Number(a.expiry) - Number(b.expiry))[0];
const pl = await (await fetch(`https://predict-server.testnet.mystenlabs.com/oracles/${o.oracle_id}/prices/latest`)).json();
let fwd = Number(pl?.forward ?? pl?.spot ?? 0); if (fwd > 0 && fwd < 1e9) fwd *= 1e9;
const minS = Number(o.min_strike), tick = Number(o.tick_size);
const strike = BigInt(Math.max(minS + tick, minS + Math.round((fwd - minS) / tick) * tick));
const expiry = BigInt(o.expiry);
console.log('oracle', o.oracle_id.slice(0, 10), '· strike $' + (Number(strike) / 1e9).toFixed(0), '· expiry', new Date(Number(o.expiry)).toISOString());
const mkArgs = (tx) => tx.moveCall({ target: `${PREDICT}::market_key::up`, arguments: [tx.pure.id(o.oracle_id), tx.pure.u64(expiry), tx.pure.u64(strike)] });

// size QTY so mint cost ≈ 88% of the 2 DUSDC notional (AMM impact); ensures proceeds > debt.
const NOTIONAL = 2_000_000n;
const quoteCost = async (qty) => {
  const t = new Transaction();
  const k = mkArgs(t);
  t.moveCall({ target: `${PREDICT}::predict::get_trade_amounts`, arguments: [t.object(PREDICT_ID), t.object(o.oracle_id), k, t.pure.u64(qty), t.object(CLOCK)] });
  return devU64(t, 0);
};
const askPerShare = await quoteCost(1_000_000n);
let QTY = (NOTIONAL * 1_000_000n * 88n / 100n) / askPerShare;
const realCost = await quoteCost(QTY);
if (realCost > 0n) QTY = (QTY * NOTIONAL * 88n / 100n) / realCost;
console.log('ask/share', Number(askPerShare) / 1e6, '· QTY', Number(QTY) / 1e6, 'shares · est mint cost', Number(await quoteCost(QTY)) / 1e6, 'DUSDC (<2 notional)\n');

// ── TX2: AGENT trades 1 DUSDC of USER's balance at 2x → order OWNED BY USER ──
const tx2 = new Transaction();
tx2.moveCall({
  target: `${PKG}::social_vault::agent_trade`, typeArguments: [DUSDC],
  arguments: [tx2.object(VAULT), tx2.object(DESK), tx2.pure.address(USER), tx2.pure.u64(1_000_000), tx2.pure.u64(20_000), tx2.pure.id(o.oracle_id), tx2.pure.u64(expiry), tx2.pure.bool(false), tx2.pure.u64(strike), tx2.pure.u64(0n), tx2.pure.bool(true), tx2.object(CLOCK)],
});
const r2 = await run(agent, tx2);
const order = created(r2.tb, 'margin::OpenOrder');
console.log('TX2 agent_trade ', r2.status?.status, '· AgentTraded', JSON.stringify(ev(r2.tb, 'AgentTraded')[0]));
console.log('   OrderRequested trader =', ev(r2.tb, 'OrderRequested')[0]?.trader?.slice(0, 12), '(must equal USER) · order', order?.slice(0, 12), r2.digest);
const vbal1 = await balU64(VAULT, `${PKG}::social_vault::balance_of`, (t) => [t.object(VAULT), t.pure.address(USER)]);
console.log('   USER vault balance now', Number(vbal1) / 1e6, 'DUSDC (was 2, agent deployed 1)');

// ── TX3: AGENT fills → borrow 1 from pool → mint the 2 DUSDC position into custody ──
const tx3 = new Transaction();
const notional = tx3.moveCall({ target: `${PKG}::margin::fill`, typeArguments: [DUSDC], arguments: [tx3.object(DESK), tx3.object(POOL), tx3.object(order), tx3.pure.u64(QTY), tx3.object(CLOCK)] });
tx3.moveCall({ target: `${PREDICT}::predict_manager::deposit`, typeArguments: [DUSDC], arguments: [tx3.object(MGR), notional] });
const mk3 = mkArgs(tx3);
tx3.moveCall({ target: `${PREDICT}::predict::mint`, typeArguments: [DUSDC], arguments: [tx3.object(PREDICT_ID), tx3.object(MGR), tx3.object(o.oracle_id), mk3, tx3.pure.u64(QTY), tx3.object(CLOCK)] });
const r3 = await run(agent, tx3);
const position = created(r3.tb, 'margin::MarginPosition');
const opened = ev(r3.tb, 'PositionOpened')[0];
console.log('TX3 fill+mint   ', r3.status?.status, '· position', position?.slice(0, 12), '· owner =', opened?.owner?.slice(0, 12), '(must equal USER)', r3.digest);

// ── TX4: AGENT redeems the position at the LIVE mark → proceeds into custody ──
const tx4 = new Transaction();
const mk4 = mkArgs(tx4);
tx4.moveCall({ target: `${PREDICT}::predict::redeem`, typeArguments: [DUSDC], arguments: [tx4.object(PREDICT_ID), tx4.object(MGR), tx4.object(o.oracle_id), mk4, tx4.pure.u64(QTY), tx4.object(CLOCK)] });
const r4 = await run(agent, tx4);
const proceedsAmt = await balU64(MGR, `${PREDICT}::predict_manager::balance`, (t) => [t.object(MGR)]);
console.log('TX4 redeem@mark ', r4.status?.status, '· recovered', Number(proceedsAmt) / 1e6, 'DUSDC into custody', r4.digest);

// ── TX5: AGENT withdraws proceeds → margin::close → repay pool, remainder FORCE-PAID to USER ──
const userBalBefore = Number((await rpc('suix_getBalance', [USER, DUSDC])).result.totalBalance) / 1e6;
const agentBalBefore = Number((await rpc('suix_getBalance', [AGENT, DUSDC])).result.totalBalance) / 1e6;
const tx5 = new Transaction();
const proceeds = tx5.moveCall({ target: `${PREDICT}::predict_manager::withdraw`, typeArguments: [DUSDC], arguments: [tx5.object(MGR), tx5.pure.u64(proceedsAmt)] });
tx5.moveCall({ target: `${PKG}::margin::close`, typeArguments: [DUSDC], arguments: [tx5.object(DESK), tx5.object(POOL), tx5.object(position), proceeds, tx5.object(CLOCK)] });
const r5 = await run(agent, tx5);
console.log('TX5 CLOSE       ', r5.status?.status, '· Closed', JSON.stringify(ev(r5.tb, 'Closed')[0]), r5.digest);

await new Promise((r) => setTimeout(r, 2000));
const userBalAfter = Number((await rpc('suix_getBalance', [USER, DUSDC])).result.totalBalance) / 1e6;
const agentBalAfter = Number((await rpc('suix_getBalance', [AGENT, DUSDC])).result.totalBalance) / 1e6;
console.log('\n=== NO-DIVERT PROOF ===');
console.log('USER  DUSDC  before', userBalBefore.toFixed(6), '→ after', userBalAfter.toFixed(6), '  Δ', (userBalAfter - userBalBefore).toFixed(6), '(force-paid the close remainder)');
console.log('AGENT DUSDC  before', agentBalBefore.toFixed(6), '→ after', agentBalAfter.toFixed(6), '  Δ', (agentBalAfter - agentBalBefore).toFixed(6), '(only paid gas; received ZERO of the trade)');
console.log('USER still holds', Number(await balU64(VAULT, `${PKG}::social_vault::balance_of`, (t) => [t.object(VAULT), t.pure.address(USER)])) / 1e6, 'DUSDC in the vault (withdrawable any time, owner-gated)');
console.log('\nVAULT', VAULT);
