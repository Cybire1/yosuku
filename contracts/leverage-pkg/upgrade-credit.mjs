import fs from 'fs';
import { execFileSync } from 'child_process';
const { SuiGrpcClient } = await import('@mysten/sui/grpc');
const { Transaction } = await import('@mysten/sui/transactions');
const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');
const RPC = 'https://fullnode.testnet.sui.io:443';
const PKG = '0xd950420d3b3ac026c6f3b242010bec2dd2f7cdab6a7d68fb00087516094cbc02';
const CAP = '0xb9c19a789f170d96f244e1eaa461719b3f9f4dc736e028d812b2eab946f95fdf';
const KEEPER = '0xaa50ec0fe985825bd45fcc65d301da096a487349d6993fe8f9305890284a7244';
const build = JSON.parse(fs.readFileSync('/tmp/yolev-upgrade.json','utf8'));
const DRY = process.env.DRY === '1';
const key = process.env.PKK || JSON.parse(execFileSync('sui',['keytool','export','--key-identity',KEEPER,'--json'],{encoding:'utf8'})).exportedPrivateKey;
const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(key).secretKey);
const client = new SuiGrpcClient({ network:'testnet', baseUrl:RPC });
const rpc = async (m,p)=>(await(await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:m,params:p})})).json()).result;
console.log('signer', kp.toSuiAddress().slice(0,12), '· modules', build.modules.length, '· from PKG', PKG.slice(0,12), '· DRY', DRY);
const tx = new Transaction();
tx.setSender(kp.toSuiAddress());
const cap = tx.object(CAP);
const ticket = tx.moveCall({ target:'0x2::package::authorize_upgrade', arguments:[cap, tx.pure.u8(0), tx.pure.vector('u8', build.digest)] });
const receipt = tx.upgrade({ modules: build.modules, dependencies: build.dependencies, package: PKG, ticket });
tx.moveCall({ target:'0x2::package::commit_upgrade', arguments:[cap, receipt] });
tx.setGasBudget(400_000_000);
if (DRY) {
  const bytes = await tx.build({ client });
  const r = await rpc('sui_dryRunTransactionBlock',[Buffer.from(bytes).toString('base64')]);
  console.log('DRY status:', JSON.stringify(r.effects?.status));
  for (const c of r.objectChanges||[]) if (c.type==='published') console.log('WOULD_NEW_PACKAGE', c.packageId);
} else {
  const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx });
  const digest = res.$kind==='Transaction'?res.Transaction.digest:res.FailedTransaction?.digest;
  console.log('digest', digest);
  await new Promise(r=>setTimeout(r,6000));
  const tb = await rpc('sui_getTransactionBlock',[digest,{showObjectChanges:true,showEffects:true}]);
  console.log('status', JSON.stringify(tb?.effects?.status));
  for (const c of tb?.objectChanges||[]) if (c.type==='published') console.log('NEW_PACKAGE_ID', c.packageId);
}
