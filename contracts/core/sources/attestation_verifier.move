module suioverflow::attestation_verifier;

use sui::{
    bcs,
    clock::Clock,
    ed25519,
    event,
};
use suioverflow::agent_registry::{Self, Registry};

const EExpired: u64 = 1;
const EBadTime: u64 = 2;
const EBadSignature: u64 = 3;

const MAX_ATTESTATION_AGE_MS: u64 = 300_000;
/// Domain separator for action-authorizing signatures. MUST match the enclave.
const INTENT_ACTION: u8 = 0;

/// Hot-potato. No abilities → must be consumed within the same PTB, preventing
/// replay across transactions. Holding one proves the enclave's attested key
/// signed this exact action recently.
public struct VerifiedAction {
    agent_addr: address,
    action_digest: vector<u8>,
    nonce: u64,
    issued_at_ms: u64,
}

/// The exact message the enclave signs, BCS-encoded. The field order/types MUST
/// be byte-identical to the Rust enclave's `ActionIntent` (see enclave/src).
public struct ActionIntent has copy, drop {
    intent: u8,
    timestamp_ms: u64,
    action_digest: vector<u8>,
    nonce: u64,
}

public struct AttestationVerified has copy, drop {
    agent_addr: address,
    action_digest: vector<u8>,
    nonce: u64,
}

/// Verify that the agent's attested enclave key signed this action, recently.
/// This is the real per-action check: the registered enclave public key (pinned
/// from the Nitro attestation at registration) must have produced `signature`
/// over `BCS(ActionIntent{INTENT_ACTION, timestamp_ms, action_digest, nonce})`.
public fun verify(
    reg: &Registry,
    agent_addr: address,
    action_digest: vector<u8>,
    nonce: u64,
    timestamp_ms: u64,
    signature: vector<u8>,
    clock: &Clock,
): VerifiedAction {
    agent_registry::assert_active(reg, agent_addr);

    let now = clock.timestamp_ms();
    assert!(now >= timestamp_ms, EBadTime);
    assert!(now - timestamp_ms <= MAX_ATTESTATION_AGE_MS, EExpired);

    let pk = agent_registry::enclave_pk(reg, agent_addr);
    let intent = ActionIntent { intent: INTENT_ACTION, timestamp_ms, action_digest, nonce };
    let msg = bcs::to_bytes(&intent);
    assert!(ed25519::ed25519_verify(&signature, &pk, &msg), EBadSignature);

    event::emit(AttestationVerified { agent_addr, action_digest, nonce });
    VerifiedAction { agent_addr, action_digest, nonce, issued_at_ms: timestamp_ms }
}

public fun agent(v: &VerifiedAction): address { v.agent_addr }
public fun digest(v: &VerifiedAction): vector<u8> { v.action_digest }

/// Consume the hot-potato, extracting (agent, action_digest, nonce).
public fun consume(v: VerifiedAction): (address, vector<u8>, u64) {
    let VerifiedAction { agent_addr, action_digest, nonce, .. } = v;
    (agent_addr, action_digest, nonce)
}

/// Test-only mint of a VerifiedAction, for modules whose tests exercise the
/// downstream flow without producing a real ed25519 signature.
#[test_only]
public fun new_verified_for_testing(
    agent_addr: address,
    action_digest: vector<u8>,
    nonce: u64,
): VerifiedAction {
    VerifiedAction { agent_addr, action_digest, nonce, issued_at_ms: 0 }
}
