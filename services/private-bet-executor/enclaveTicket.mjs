// Enclave-signed private-bet tickets.
//
// The desk no longer keeps a table of who owns which position, because a table the operator can
// read is not privacy. That removes the desk's own answer to "whose position is this?", so the
// user hands their ticket back at cashout instead. A user handing back a self-authored ticket
// would be theft with extra steps, so the ticket is signed inside the attested enclave and
// verified here before a cent moves.
//
// The layout below is the wire contract with enclave/src/private_bet.rs. BCS, fixed order:
//   u8   intent (7)
//   [32] owner
//   [32] session_manager
//   [32] oracle_id
//   u64  expiry
//   u64  strike
//   bool is_up
//   u64  stake_micro
//   u64  quantity
//   u64  issued_at_ms
//   u64  nonce
// It is append-only. Reordering or resizing a field silently invalidates every outstanding
// ticket, so the Move package carries a parity test built from real enclave output.

import { spawn } from 'node:child_process';
import { verify } from 'node:crypto';

export const TICKET_INTENT = 7;
const TICKET_BYTES = 1 + 32 + 32 + 32 + 8 + 8 + 1 + 8 + 8 + 8 + 8; // 146

const hex = (buf) => Buffer.from(buf).toString('hex');
const addr = (buf) => '0x' + hex(buf);

/** Parse the canonical BCS record. Rejects anything that is not exactly the expected shape. */
export function decodeTicket(ticketHex) {
  const b = Buffer.from(String(ticketHex).replace(/^0x/, ''), 'hex');
  if (b.length !== TICKET_BYTES) {
    throw new Error(`ticket must be ${TICKET_BYTES} bytes, got ${b.length}`);
  }
  if (b[0] !== TICKET_INTENT) throw new Error('ticket intent mismatch');
  let o = 1;
  const take = (n) => { const s = b.subarray(o, o + n); o += n; return s; };
  const u64 = () => { const v = b.readBigUInt64LE(o); o += 8; return v; };

  const owner = addr(take(32));
  const sessionManager = addr(take(32));
  const oracleId = addr(take(32));
  const expiry = u64();
  const strike = u64();
  const isUpByte = b[o]; o += 1;
  if (isUpByte !== 0 && isUpByte !== 1) throw new Error('ticket isUp is not a bool');
  const stakeMicro = u64();
  const quantity = u64();
  const issuedAtMs = u64();
  const nonce = u64();

  return {
    owner, sessionManager, oracleId,
    expiry, strike, isUp: isUpByte === 1,
    stakeMicro, quantity, issuedAtMs, nonce,
  };
}

/**
 * Verify the enclave authored these exact bytes.
 *
 * Node's ed25519 needs a DER-wrapped SPKI key; the enclave emits a raw 32-byte one, so the
 * prefix below is the fixed SPKI header for Ed25519. Doing it here (rather than shelling out to
 * a library) keeps the executor free of a crypto dependency it would otherwise have to trust.
 */
export function verifyTicketSignature({ ticketHex, signatureHex, publicKeyHex }) {
  const raw = Buffer.from(String(publicKeyHex).replace(/^0x/, ''), 'hex');
  if (raw.length !== 32) throw new Error('enclave public key must be 32 bytes');
  const sig = Buffer.from(String(signatureHex).replace(/^0x/, ''), 'hex');
  if (sig.length !== 64) throw new Error('signature must be 64 bytes');
  const msg = Buffer.from(String(ticketHex).replace(/^0x/, ''), 'hex');

  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
  const key = { key: spki, format: 'der', type: 'spki' };
  try {
    return verify(null, msg, key, sig);
  } catch {
    return false;
  }
}

/**
 * Ask the enclave to issue a ticket. The enclave runs its own guard, so a host that has been
 * tampered with cannot raise the stake cap or backdate an expiry: it can only be refused.
 */
export function issueTicket(req, { command, args = [], timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('enclave timed out')); }, timeoutMs);

    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`enclave exited ${code}: ${err.slice(0, 300)}`));
      let reply;
      try { reply = JSON.parse(out); } catch { return reject(new Error('enclave returned non-JSON')); }
      if (!reply.issued) {
        return reject(new Error(`enclave refused: ${(reply.violated ?? []).join('; ') || 'no reason given'}`));
      }
      // Never trust the reply blindly: check the signature we are about to hand a user, so a
      // broken or swapped enclave surfaces here rather than at cashout when funds are moving.
      if (!verifyTicketSignature(reply)) return reject(new Error('enclave signature did not verify'));
      resolve(reply);
    });

    child.stdin.write(JSON.stringify({ kind: 'private_ticket', ...req }));
    child.stdin.end();
  });
}
