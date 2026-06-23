import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TESTNET = {
  rpcUrl: 'https://fullnode.testnet.sui.io:443',
  predictPackage: '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138',
  predictObject: '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a',
  dusdcType: '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC',
  clock: '0x6',
};

const cfg = {
  host: process.env.PRIVATE_BET_EXECUTOR_HOST ?? '127.0.0.1',
  port: Number(process.env.PRIVATE_BET_EXECUTOR_PORT ?? process.env.PORT ?? 8787),
  rpcUrl: process.env.SUI_RPC_URL ?? TESTNET.rpcUrl,
  network: process.env.NEXT_PUBLIC_SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet',
  packageId: process.env.PREDICT_PACKAGE_ID ?? TESTNET.predictPackage,
  predictId: process.env.PREDICT_OBJECT_ID ?? TESTNET.predictObject,
  dusdcType: process.env.DUSDC_TYPE ?? TESTNET.dusdcType,
  // Trading Balance vault — private-bet winnings settle straight here (no separate "Private Balance").
  tradingVaultPkg: process.env.TRADING_VAULT_PACKAGE ?? '0x3b76383b2bb9bc411dc56c571a1da22f348b3c19518115ae958fe96e031cf30e',
  tradingVault: process.env.TRADING_VAULT_ID ?? '0xc04516b582bfe73c71325408bfb9e9a5a8fdcd54952a313a288a135e272fa1e6',
  vortexPool: process.env.PRIVATE_BET_DUSDC_POOL || '0x0',
  sharedSecret: process.env.PRIVATE_BET_SHARED_SECRET ?? '',
  onaraUrl: (process.env.PRIVATE_BET_ONARA_URL ?? process.env.NEXT_PUBLIC_ONARA_URL ?? '').replace(/\/$/, ''),
  useOnara: process.env.PRIVATE_BET_USE_ONARA !== '0',
  privateKey: process.env.EXECUTOR_PRIVATE_KEY ?? process.env.PRIVATE_BET_EXECUTOR_PRIVATE_KEY ?? '',
  maxStakeMicro: BigInt(process.env.PRIVATE_BET_MAX_STAKE_MICRO ?? '2000000'),
  sponsoredBeta: process.env.PRIVATE_BET_SPONSORED_BETA === '1',
  allowlist: (process.env.PRIVATE_BET_OWNER_ALLOWLIST ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean),
  ticketStore: process.env.PRIVATE_BET_TICKET_STORE
    ? resolve(process.env.PRIVATE_BET_TICKET_STORE)
    : resolve(__dirname, '.private-bet-tickets.json'),
};

const client = new SuiJsonRpcClient({ url: cfg.rpcUrl, network: cfg.network });
const signer = cfg.privateKey ? Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(cfg.privateKey).secretKey) : null;
const sessionAddress = signer?.toSuiAddress() ?? '';
let sponsorStatusPromise = null;

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(data);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function requireAuth(req) {
  if (!cfg.sharedSecret) return;
  const expected = `Bearer ${cfg.sharedSecret}`;
  if (req.headers.authorization !== expected) {
    const err = new Error('unauthorized');
    err.status = 401;
    throw err;
  }
}

function assertAddress(value, field) {
  if (typeof value !== 'string' || !/^0x[a-fA-F0-9]{1,64}$/.test(value)) {
    throw new Error(`${field} must be a Sui address`);
  }
  return value;
}

function assertObjectId(value, field) {
  return assertAddress(value, field);
}

function assertU64String(value, field) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`${field} must be an integer string`);
  }
  return BigInt(value);
}

function assertReadyForOpen(owner, stakeMicro) {
  if (!signer) throw new Error('EXECUTOR_PRIVATE_KEY is not configured');
  if (!cfg.sponsoredBeta) {
    throw new Error(
      'User-funded private deposits are not enabled yet. Set PRIVATE_BET_SPONSORED_BETA=1 for a testnet sponsored beta.',
    );
  }
  if (stakeMicro <= 0n) throw new Error('stakeMicro must be positive');
  if (stakeMicro > cfg.maxStakeMicro) {
    throw new Error(`stakeMicro exceeds executor cap of ${cfg.maxStakeMicro.toString()}`);
  }
  if (cfg.allowlist.length && !cfg.allowlist.includes(owner.toLowerCase())) {
    throw new Error('owner is not allowlisted for the private beta');
  }
}

function marketKey(tx, oracleId, expiry, strike, isUp) {
  const target = isUp ? `${cfg.packageId}::market_key::up` : `${cfg.packageId}::market_key::down`;
  return tx.moveCall({
    target,
    arguments: [tx.pure.id(oracleId), tx.pure.u64(expiry), tx.pure.u64(strike)],
  });
}

async function signAndExecute(tx, gasBudget = 120_000_000) {
  if (cfg.useOnara && cfg.onaraUrl) {
    // Sponsored-only. Do NOT fall back to a self-paid retry of the SAME tx: it still carries
    // gas owner = sponsor, so re-submitting it with a single signature throws the misleading
    // "Expect 2 signer signatures but got 1". Let the real sponsor / simulation error surface.
    return await signAndExecuteSponsored(tx, gasBudget);
  }
  tx.setGasBudget(gasBudget);
  const res = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  });
  await client.waitForTransaction({ digest: res.digest });
  if (res.effects?.status?.status !== 'success') {
    throw new Error(res.effects?.status?.error ?? `transaction failed: ${res.digest}`);
  }
  return res;
}

async function sponsorStatus() {
  if (!sponsorStatusPromise) {
    sponsorStatusPromise = fetch(`${cfg.onaraUrl}/status`, { signal: AbortSignal.timeout(5_000) })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.address) throw new Error(`Onara status failed: ${res.status}`);
        return json;
      });
  }
  return sponsorStatusPromise;
}

async function signAndExecuteSponsored(tx, gasBudget) {
  if (!signer) throw new Error('EXECUTOR_PRIVATE_KEY is not configured');
  const sponsor = await sponsorStatus();
  tx.setSender(sessionAddress);
  tx.setGasOwner(sponsor.address);
  tx.setGasBudget(gasBudget);
  const bytes = await tx.build({ client });
  const signed = await signer.signTransaction(bytes);
  const res = await fetch(`${cfg.onaraUrl}/sponsor?waitForExecution=false`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sender: sessionAddress, txBytes: signed.bytes, txSignature: signed.signature }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error ? `Sponsor declined: ${json.error}` : `Sponsor declined: ${res.status}`);
  }
  if (json.FailedTransaction) {
    const err = json.FailedTransaction.effects?.status?.error;
    throw new Error(typeof err === 'string' ? err : `Sponsored transaction failed: ${JSON.stringify(json.FailedTransaction).slice(0, 300)}`);
  }
  const digest = json.Transaction?.digest ?? json.digest;
  if (!digest) throw new Error(`Sponsor response had no digest: ${JSON.stringify(json).slice(0, 300)}`);
  await client.waitForTransaction({ digest });
  return client.getTransactionBlock({
    digest,
    options: { showEffects: true, showObjectChanges: true },
  });
}

async function createManager() {
  const tx = new Transaction();
  tx.moveCall({ target: `${cfg.packageId}::predict::create_manager` });
  const res = await signAndExecute(tx, 60_000_000);
  const manager = res.objectChanges?.find((change) => {
    return change.type === 'created' && typeof change.objectType === 'string' && change.objectType.includes('PredictManager');
  });
  if (!manager?.objectId) throw new Error('PredictManager object was not created');
  return { digest: res.digest, managerId: manager.objectId };
}

async function getDusdcCoins(owner) {
  const coins = [];
  let cursor = null;
  do {
    const page = await client.getCoins({ owner, coinType: cfg.dusdcType, cursor, limit: 50 });
    coins.push(...page.data);
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);
  return coins;
}

async function buildFundAndMintTx({ managerId, stakeMicro, oracleId, expiry, strike, isUp, quantity }) {
  const coins = await getDusdcCoins(sessionAddress);
  const total = coins.reduce((sum, coin) => sum + BigInt(coin.balance), 0n);
  if (total < stakeMicro) {
    throw new Error(`executor has ${(Number(total) / 1e6).toFixed(2)} DUSDC, needs ${(Number(stakeMicro) / 1e6).toFixed(2)}`);
  }

  const tx = new Transaction();
  const primary = tx.object(coins[0].coinObjectId);
  const rest = coins.slice(1).map((coin) => tx.object(coin.coinObjectId));
  if (rest.length) tx.mergeCoins(primary, rest);
  const [stakeCoin] = tx.splitCoins(primary, [tx.pure.u64(stakeMicro)]);

  tx.moveCall({
    target: `${cfg.packageId}::predict_manager::deposit`,
    typeArguments: [cfg.dusdcType],
    arguments: [tx.object(managerId), stakeCoin],
  });

  const key = marketKey(tx, oracleId, expiry, strike, isUp);
  tx.moveCall({
    target: `${cfg.packageId}::predict::mint`,
    typeArguments: [cfg.dusdcType],
    arguments: [
      tx.object(cfg.predictId),
      tx.object(managerId),
      tx.object(oracleId),
      key,
      tx.pure.u64(quantity),
      tx.object(TESTNET.clock),
    ],
  });

  return tx;
}

function redeemTx({ managerId, oracleId, expiry, strike, isUp, quantity }) {
  const tx = new Transaction();
  const key = marketKey(tx, oracleId, expiry, strike, isUp);
  tx.moveCall({
    target: `${cfg.packageId}::predict::redeem`,
    typeArguments: [cfg.dusdcType],
    arguments: [
      tx.object(cfg.predictId),
      tx.object(managerId),
      tx.object(oracleId),
      key,
      tx.pure.u64(quantity),
      tx.object(TESTNET.clock),
    ],
  });
  return tx;
}

async function managerDusdcBalance(managerId) {
  const obj = await client.getObject({ id: managerId, options: { showContent: true } });
  const content = obj.data?.content;
  if (content?.dataType !== 'moveObject') return 0n;
  const bagId = content.fields?.balance_manager?.fields?.balances?.fields?.id?.id;
  if (!bagId) return 0n;
  const fields = await client.getDynamicFields({ parentId: bagId });
  const entry = fields.data.find((field) => {
    const type = typeof field.name?.type === 'string' ? field.name.type : '';
    return type.includes('dusdc::DUSDC');
  });
  if (!entry) return 0n;
  const fieldObj = await client.getObject({ id: entry.objectId, options: { showContent: true } });
  const value = fieldObj.data?.content?.fields?.value;
  return value ? BigInt(value) : 0n;
}

function withdrawManyTx(items, owner) {
  const tx = new Transaction();
  const coins = items.map(({ managerId, amount }) => tx.moveCall({
    target: `${cfg.packageId}::predict_manager::withdraw`,
    typeArguments: [cfg.dusdcType],
    arguments: [tx.object(managerId), tx.pure.u64(amount)],
  }));
  tx.transferObjects(coins, tx.pure.address(owner));
  return tx;
}

async function loadTickets() {
  try {
    return JSON.parse(await readFile(cfg.ticketStore, 'utf8'));
  } catch {
    return {};
  }
}

async function saveTickets(tickets) {
  await mkdir(dirname(cfg.ticketStore), { recursive: true });
  await writeFile(cfg.ticketStore, JSON.stringify(tickets, null, 2));
}

async function recordTicket(ticket) {
  const tickets = await loadTickets();
  tickets[ticket.digest] = ticket;
  await saveTickets(tickets);
}

async function updateTicket(digest, patch) {
  const tickets = await loadTickets();
  if (!tickets[digest]) throw new Error('private ticket not found in executor store');
  tickets[digest] = { ...tickets[digest], ...patch, updatedAt: Date.now() };
  await saveTickets(tickets);
  return tickets[digest];
}

async function openPrivateBet(body) {
  const owner = assertAddress(body.owner, 'owner');
  assertObjectId(body.vortexPool, 'vortexPool');
  const oracleId = assertObjectId(body.oracleId, 'oracleId');
  const expiry = assertU64String(body.expiry, 'expiry');
  const strike = assertU64String(body.strike, 'strike');
  const stakeMicro = assertU64String(body.stakeMicro, 'stakeMicro');
  const quantity = assertU64String(body.quantity, 'quantity');
  if (typeof body.isUp !== 'boolean') throw new Error('isUp must be boolean');

  assertReadyForOpen(owner, stakeMicro);

  const { digest: entryDigest, managerId } = await createManager();
  const tx = await buildFundAndMintTx({
    managerId,
    stakeMicro,
    oracleId,
    expiry,
    strike,
    isUp: body.isUp,
    quantity,
  });
  const mint = await signAndExecute(tx, 100_000_000);

  const ticket = {
    digest: mint.digest,
    owner,
    sessionAddress,
    sessionManager: managerId,
    oracleId,
    expiry: expiry.toString(),
    strike: strike.toString(),
    isUp: body.isUp,
    stakeMicro: stakeMicro.toString(),
    quantity: quantity.toString(),
    status: 'open',
    entryDigest,
    openedAt: Date.now(),
    mode: 'sponsored-session-manager',
    vortexPool: cfg.vortexPool,
  };
  await recordTicket(ticket);

  return {
    ok: true,
    digest: mint.digest,
    costDusdc: Number(stakeMicro) / 1e6,
    sessionAddress,
    sessionManager: managerId,
    entryDigest,
    mode: ticket.mode,
  };
}

async function cashoutPrivateBet(body) {
  const owner = assertAddress(body.owner, 'owner');
  assertObjectId(body.vortexPool, 'vortexPool');
  const incoming = body.ticket;
  if (!incoming || typeof incoming !== 'object') throw new Error('ticket required');
  const digest = String(incoming.digest ?? '');
  if (!digest) throw new Error('ticket.digest required');

  const tickets = await loadTickets();
  const stored = tickets[digest];
  if (!stored) throw new Error('private ticket not found in executor store');
  if (stored.owner.toLowerCase() !== owner.toLowerCase()) throw new Error('ticket owner mismatch');
  if (stored.status !== 'open') throw new Error(`ticket is ${stored.status}`);

  const managerId = assertObjectId(stored.sessionManager, 'ticket.sessionManager');
  const redeem = await signAndExecute(
    redeemTx({
      managerId,
      oracleId: stored.oracleId,
      expiry: BigInt(stored.expiry),
      strike: BigInt(stored.strike),
      isUp: stored.isUp,
      quantity: BigInt(stored.quantity),
    }),
    140_000_000,
  );

  const balance = await managerDusdcBalance(managerId);
  const settledAt = Date.now();

  // Return the proceeds STRAIGHT to the user's Trading Balance (no separate "Private
  // Balance" + withdraw step). credit_available_for is permissionless and built for this.
  let creditDigest = null;
  if (balance > 0n) {
    const tx = new Transaction();
    const coin = tx.moveCall({
      target: `${cfg.packageId}::predict_manager::withdraw`,
      typeArguments: [cfg.dusdcType],
      arguments: [tx.object(managerId), tx.pure.u64(balance)],
    });
    tx.moveCall({
      target: `${cfg.tradingVaultPkg}::trading_vault::credit_available_for`,
      typeArguments: [cfg.dusdcType],
      arguments: [tx.object(cfg.tradingVault), tx.pure.address(owner), coin],
    });
    const credit = await signAndExecute(tx, 120_000_000);
    creditDigest = credit.digest;
  }

  await updateTicket(digest, {
    status: 'settled',
    redeemDigest: redeem.digest,
    creditDigest,
    payoutMicro: balance.toString(),
    settledAt,
    cashedOutAt: settledAt,
  });

  return {
    ok: true,
    digest: creditDigest ?? redeem.digest,
    settledToTradingBalance: true,
    payoutDusdc: Number(balance) / 1e6,
    settledAt,
  };
}

async function withdrawPrivateBalance(body) {
  const owner = assertAddress(body.owner, 'owner');
  assertObjectId(body.vortexPool, 'vortexPool');
  const mode = body.mode === 'private' ? 'private' : 'fast';
  const ticketDigests = Array.isArray(body.ticketDigests)
    ? body.ticketDigests.filter((digest) => typeof digest === 'string' && digest.length > 0)
    : [];
  if (!ticketDigests.length) throw new Error('ticketDigests required');

  if (!signer) throw new Error('EXECUTOR_PRIVATE_KEY is not configured');

  const tickets = await loadTickets();
  const selected = [];
  for (const digest of ticketDigests) {
    const ticket = tickets[digest];
    if (!ticket) throw new Error(`private ticket not found: ${digest}`);
    if (ticket.owner.toLowerCase() !== owner.toLowerCase()) throw new Error('ticket owner mismatch');
    if (ticket.status !== 'credited') throw new Error(`ticket ${digest} is ${ticket.status}`);
    const managerId = assertObjectId(ticket.sessionManager, 'ticket.sessionManager');
    const balance = await managerDusdcBalance(managerId);
    if (balance > 0n) selected.push({ digest, managerId, amount: balance });
  }

  if (!selected.length) throw new Error('private balance is empty');

  const total = selected.reduce((sum, item) => sum + item.amount, 0n);
  const withdrawal = await signAndExecute(withdrawManyTx(selected, owner), 120_000_000);
  const withdrewAt = Date.now();

  for (const item of selected) {
    await updateTicket(item.digest, {
      status: 'withdrawn',
      returnDigest: withdrawal.digest,
      withdrawDigest: withdrawal.digest,
      withdrawMode: mode,
      withdrawnMicro: item.amount.toString(),
      withdrewAt,
    });
  }

  return {
    ok: true,
    digest: withdrawal.digest,
    returnDigest: withdrawal.digest,
    payoutDusdc: Number(total) / 1e6,
    ticketDigests: selected.map((item) => item.digest),
    mode,
  };
}

function health() {
  const ready = Boolean(signer && cfg.sponsoredBeta);
  const reasons = [];
  if (!signer) reasons.push('EXECUTOR_PRIVATE_KEY missing');
  if (!cfg.sponsoredBeta) reasons.push('PRIVATE_BET_SPONSORED_BETA must be 1 for this testnet executor mode');
  return {
    ok: true,
    ready,
    reasons,
    mode: 'sponsored-session-manager',
    sessionAddress,
    vortexPool: cfg.vortexPool,
    maxStakeDusdc: Number(cfg.maxStakeMicro) / 1e6,
    onaraGas: Boolean(cfg.useOnara && cfg.onaraUrl),
    onaraUrl: cfg.onaraUrl ? cfg.onaraUrl.replace(/^https?:\/\//, '') : '',
    privateBalanceEnabled: true,
    withdrawModes: ['fast', 'private'],
    ticketStore: cfg.ticketStore,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json(res, 200, health());
    }

    if (req.method === 'POST' && url.pathname === '/open') {
      requireAuth(req);
      return json(res, 200, await openPrivateBet(await readJson(req)));
    }

    if (req.method === 'POST' && url.pathname === '/cashout') {
      requireAuth(req);
      return json(res, 200, await cashoutPrivateBet(await readJson(req)));
    }

    if (req.method === 'POST' && url.pathname === '/withdraw') {
      requireAuth(req);
      return json(res, 200, await withdrawPrivateBalance(await readJson(req)));
    }

    return json(res, 404, { ok: false, error: 'not found' });
  } catch (error) {
    return json(res, error.status ?? 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(cfg.port, cfg.host, () => {
  console.log(`private-bet executor listening on http://${cfg.host}:${cfg.port}`);
  console.log(JSON.stringify(health(), null, 2));
});
