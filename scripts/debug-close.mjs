const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');
const RPC = 'https://fullnode.testnet.sui.io:443';
const MGR = '0xc111d848df05dfc2efdccc7e4248918188ba2e28f2354f47859c7d0d47788c61';
const PREDICT = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
const PREDICT_ID = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
const DUSDC = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const CLOCK = '0x6';
const POS = process.argv[2] || '0x58ee4ec7';
const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.PK).secretKey);
const me = kp.toSuiAddress();
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: RPC });
const rpc = async (m, p) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p }) })).json());

const ev = (await rpc('suix_queryEvents', [{ MoveEventType: `0x3b76383b2bb9bc411dc56c571a1da22f348b3c19518115ae958fe96e031cf30e::margin::PositionOpened` }, null, 50, true])).result.data;
const pid = ev.map(e => e.parsedJson.position).find(x => x.startsWith(POS)) || POS;
const obj = (await rpc('sui_getObject', [pid, { showContent: true }])).result.data.content.fields;
console.log('position', pid, 'strike', obj.lower_strike, 'is_up', obj.is_up, 'expiry', obj.expiry, 'quantity', obj.quantity);

async function tryRedeem(qty, fn) {
  const tx = new Transaction();
  const key = tx.moveCall({ target: `${PREDICT}::market_key::${obj.is_up ? 'up' : 'down'}`, arguments: [tx.pure.id(obj.oracle_id), tx.pure.u64(obj.expiry), tx.pure.u64(obj.lower_strike)] });
  tx.moveCall({ target: `${PREDICT}::predict::${fn}`, typeArguments: [DUSDC], arguments: [tx.object(PREDICT_ID), tx.object(MGR), tx.object(obj.oracle_id), key, tx.pure.u64(qty), tx.object(CLOCK)] });
  const b = await tx.build({ client, onlyTransactionKind: true });
  const r = (await rpc('sui_devInspectTransactionBlock', [me, Buffer.from(b).toString('base64'), null, null])).result;
  return r?.error || 'OK';
}
console.log('redeem_permissionless full qty', obj.quantity, '->', await tryRedeem(Number(obj.quantity), 'redeem_permissionless'));
console.log('redeem_permissionless qty 1000  ->', await tryRedeem(1000, 'redeem_permissionless'));
console.log('redeem (sell) full qty           ->', await tryRedeem(Number(obj.quantity), 'redeem'));
