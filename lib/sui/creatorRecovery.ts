import { MultiSigPublicKey } from '@mysten/sui/multisig';
import { BrowserPasskeyProvider, PasskeyKeypair, PasskeyPublicKey } from '@mysten/sui/keypairs/passkey';
import { publicKeyFromRawBytes } from '@mysten/sui/verify';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { PREDICT624 } from './predict624Client';

export const CREATOR_RECOVERY_PACKAGE =
  '0xbda838f23b7035f7372c5a6984f26dadef10c1c70a7c64701e71554abc3e2d32';

export const CREATOR_RECOVERY_TYPE =
  `${CREATOR_RECOVERY_PACKAGE}::creator_recovery::CreatorRecovery`;

export type CreatorRecoveryProfile = {
  objectId: string;
  controller: string;
  login: string;
  builderCode: string | null;
  zkLoginPublicIdentifier: Uint8Array;
  passkeyPublicKey: Uint8Array;
};

export type StoredCreatorPasskey = {
  version: 1;
  login: string;
  controller: string;
  passkeyPublicKey: string;
  credentialId: string | null;
};

const storageKey = (login: string) => `yosuku:creator-passkey:${login.toLowerCase()}`;

export function creatorPasskeyProvider(): BrowserPasskeyProvider {
  if (typeof window === 'undefined') throw new Error('Passkeys are available in the browser only');
  // Pin production credentials to the registrable domain so a future www/app subdomain move does
  // not strand passkeys. Local development keeps its own hostname as required by WebAuthn.
  const hostname = window.location.hostname;
  const rpId = hostname === 'yosuku.xyz' || hostname.endsWith('.yosuku.xyz') ? 'yosuku.xyz' : hostname;
  return new BrowserPasskeyProvider('Yosuku creator recovery', {
    rp: { name: 'Yosuku', id: rpId },
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    },
  });
}

export function creatorController(
  zkLoginPublicIdentifier: Uint8Array,
  passkeyPublicKey: Uint8Array,
): MultiSigPublicKey {
  const zk = publicKeyFromRawBytes('ZkLogin', zkLoginPublicIdentifier);
  const passkey = new PasskeyPublicKey(passkeyPublicKey);
  return MultiSigPublicKey.fromPublicKeys({
    threshold: 1,
    publicKeys: [
      { publicKey: zk, weight: 1 },
      { publicKey: passkey, weight: 1 },
    ],
  });
}

/** Phase one is signed by zkLogin, proving that login authorized this recovery controller. */
export function buildRegisterCreatorRecoveryTx(args: {
  login: string;
  zkLoginPublicIdentifier: Uint8Array;
  passkeyPublicKey: Uint8Array;
}): { transaction: Transaction; controller: MultiSigPublicKey } {
  const controller = creatorController(args.zkLoginPublicIdentifier, args.passkeyPublicKey);
  const tx = new Transaction();
  tx.moveCall({
    target: `${CREATOR_RECOVERY_PACKAGE}::creator_recovery::register`,
    arguments: [
      tx.pure.address(controller.toSuiAddress()),
      tx.pure.vector('u8', [...args.zkLoginPublicIdentifier]),
      tx.pure.vector('u8', [...args.passkeyPublicKey]),
    ],
  });
  tx.setSender(args.login);
  return { transaction: tx, controller };
}

/** Phase two is signed by the recovered controller; mint + attachment remain atomic. */
export function buildFinalizeRecoverableCreatorCodeTx(args: {
  recoveryId: string;
  controller: MultiSigPublicKey;
  index?: bigint;
}): Transaction {
  const tx = new Transaction();
  const builderCode = tx.moveCall({
    target: `${PREDICT624.predictPackage}::registry::create_and_share_builder_code`,
    arguments: [
      tx.object(PREDICT624.registry),
      tx.object(PREDICT624.protocolConfig),
      tx.pure.u64(args.index ?? 0n),
    ],
  });
  tx.moveCall({
    target: `${CREATOR_RECOVERY_PACKAGE}::creator_recovery::finalize`,
    arguments: [tx.object(args.recoveryId), builderCode],
  });
  tx.setSender(args.controller.toSuiAddress());
  return tx;
}

export function storeCreatorPasskey(login: string, controller: string, keypair: PasskeyKeypair): void {
  const record: StoredCreatorPasskey = {
    version: 1,
    login: login.toLowerCase(),
    controller: controller.toLowerCase(),
    passkeyPublicKey: toBase64(keypair.getPublicKey().toRawBytes()),
    credentialId: keypair.getCredentialId() ? toBase64(keypair.getCredentialId()!) : null,
  };
  localStorage.setItem(storageKey(login), JSON.stringify(record));
}

export function loadCreatorPasskey(login: string): StoredCreatorPasskey | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(login)) || 'null') as StoredCreatorPasskey | null;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function passkeyFromStored(record: StoredCreatorPasskey): PasskeyKeypair {
  return new PasskeyKeypair(
    fromBase64(record.passkeyPublicKey),
    creatorPasskeyProvider(),
    record.credentialId ? fromBase64(record.credentialId) : undefined,
  );
}

function bytes(value: unknown): Uint8Array {
  if (Array.isArray(value)) return Uint8Array.from(value.map(Number));
  if (typeof value === 'string') {
    try { return fromBase64(value); } catch { return new Uint8Array(); }
  }
  return new Uint8Array();
}

function optionId(value: unknown): string | null {
  if (typeof value === 'string') return value.toLowerCase();
  if (Array.isArray(value)) return optionId(value[0]);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return optionId(o.vec ?? o.some ?? o.value ?? null);
  }
  return null;
}

type RecoveryNode = {
  address?: unknown;
  asMoveObject?: { contents?: { json?: Record<string, unknown> } };
};

type RecoveryQueryResponse = {
  errors?: Array<{ message?: string }>;
  data?: { objects?: {
    nodes?: RecoveryNode[];
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
  } };
};

function parseProfile(value: unknown): CreatorRecoveryProfile | null {
  const node = value as RecoveryNode;
  const j = node?.asMoveObject?.contents?.json ?? {};
  const profile: CreatorRecoveryProfile = {
    objectId: String(node?.address || ''),
    controller: String(j.controller || '').toLowerCase(),
    login: String(j.login || '').toLowerCase(),
    builderCode: optionId(j.builder_code),
    zkLoginPublicIdentifier: bytes(j.zklogin_public_identifier),
    passkeyPublicKey: bytes(j.passkey_public_key),
  };
  if (!profile.objectId || !/^0x[0-9a-f]{64}$/.test(profile.controller)
    || !/^0x[0-9a-f]{64}$/.test(profile.login)
    || (profile.builderCode != null && !/^0x[0-9a-f]{64}$/.test(profile.builderCode))
    || profile.passkeyPublicKey.length !== 33 || !profile.zkLoginPublicIdentifier.length) return null;
  try {
    const zk = publicKeyFromRawBytes('ZkLogin', profile.zkLoginPublicIdentifier);
    if (!zk.verifyAddress(profile.login)) return null;
    if (creatorController(profile.zkLoginPublicIdentifier, profile.passkeyPublicKey).toSuiAddress().toLowerCase()
      !== profile.controller) return null;
  } catch { return null; }
  return profile;
}

export async function listCreatorRecoveries(): Promise<CreatorRecoveryProfile[]> {
  const query = `query CreatorRecoveries($after: String) {
    objects(filter: {type: "${CREATOR_RECOVERY_TYPE}"}, first: 50, after: $after) {
      nodes { address asMoveObject { contents { json } } }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const profiles: CreatorRecoveryProfile[] = [];
  let after: string | null = null;
  do {
    const res = await fetch('https://graphql.testnet.sui.io/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { after } }),
    }).then((r) => r.json()) as RecoveryQueryResponse;
    if (res.errors?.length) throw new Error(res.errors[0]?.message || 'Recovery registry query failed');
    const connection = res.data?.objects;
    for (const node of connection?.nodes || []) {
      const profile = parseProfile(node);
      if (profile) profiles.push(profile);
    }
    after = connection?.pageInfo?.hasNextPage && connection?.pageInfo?.endCursor
      ? String(connection.pageInfo.endCursor) : null;
  } while (after);
  return profiles;
}

export async function findCreatorRecoveryForLogin(login: string): Promise<CreatorRecoveryProfile | null> {
  const want = login.toLowerCase();
  const matches = (await listCreatorRecoveries()).filter((profile) => profile.login === want);
  return matches.find((profile) => profile.builderCode != null) ?? matches[0] ?? null;
}

export async function waitForCreatorRecovery(
  login: string,
  controller: string,
  timeoutMs = 30_000,
): Promise<CreatorRecoveryProfile> {
  const deadline = Date.now() + timeoutMs;
  do {
    const profile = (await listCreatorRecoveries()).find((candidate) =>
      candidate.login === login.toLowerCase() && candidate.controller === controller.toLowerCase());
    if (profile) return profile;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  } while (Date.now() < deadline);
  throw new Error('Recovery registration is still indexing. Wait a moment and try again.');
}

export async function recoverCreatorPasskey(): Promise<{ keypair: PasskeyKeypair; profile: CreatorRecoveryProfile }> {
  const provider = creatorPasskeyProvider();
  const a = await PasskeyKeypair.signAndRecover(provider, new TextEncoder().encode('Yosuku creator recovery 1'));
  const b = await PasskeyKeypair.signAndRecover(provider, new TextEncoder().encode('Yosuku creator recovery 2'));
  const key = a.find((candidate) => b.some((other) => candidate.equals(other)));
  if (!key) throw new Error('Could not identify a unique creator passkey');
  const passkeyBytes = key.toRawBytes();
  const profile = (await listCreatorRecoveries()).find((candidate) =>
    candidate.passkeyPublicKey.length === passkeyBytes.length
      && candidate.passkeyPublicKey.every((v, i) => v === passkeyBytes[i]));
  if (!profile) throw new Error('No creator account is registered for this passkey');
  return { keypair: new PasskeyKeypair(passkeyBytes, provider), profile };
}
