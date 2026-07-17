#[test_only]
module suioverflow::integration_tests;

use sui::{
    clock,
    test_scenario as ts,
};
use std::unit_test::{assert_eq, destroy};
use suioverflow::{
    agent_registry::{Self, Registry},
    attestation_verifier,
};

const ADMIN: address = @0xA;
const USER: address = @0xB;
const AGENT: address = @0xC0FFEE;
const TS_MS: u64 = 1700000000000;

// Real ed25519 vector: signature over BCS(ActionIntent{0, TS_MS, "action-xyz", 42}).
// Generated offline (node crypto ed25519); also proves Move BCS == external BCS.
#[test]
fun register_then_verify_real_signature() {
    let mut s = ts::begin(ADMIN);
    agent_registry::init_for_testing(s.ctx());

    s.next_tx(USER);
    let mut reg = s.take_shared<Registry>();
    let mut clk = clock::create_for_testing(s.ctx());
    clk.increment_for_testing(TS_MS);

    let pk = vector[
        65u8, 154u8, 6u8, 208u8, 102u8, 66u8, 157u8, 16u8, 36u8, 188u8, 107u8, 204u8, 163u8,
        163u8, 18u8, 223u8, 242u8, 103u8, 252u8, 148u8, 65u8, 67u8, 149u8, 253u8, 193u8, 225u8,
        165u8, 208u8, 76u8, 78u8, 246u8, 199u8,
    ];
    let cap = agent_registry::register(&mut reg, &clk, AGENT, b"pcr0", b"pcr1", b"pcr2", pk, s.ctx());

    let sig = vector[
        177u8, 168u8, 205u8, 112u8, 94u8, 173u8, 247u8, 169u8, 216u8, 194u8, 32u8, 54u8, 11u8,
        251u8, 106u8, 20u8, 75u8, 55u8, 151u8, 136u8, 43u8, 216u8, 227u8, 33u8, 27u8, 248u8, 196u8,
        250u8, 238u8, 147u8, 226u8, 216u8, 67u8, 138u8, 32u8, 195u8, 134u8, 13u8, 39u8, 113u8,
        174u8, 44u8, 71u8, 209u8, 22u8, 176u8, 110u8, 177u8, 205u8, 44u8, 136u8, 105u8, 13u8, 67u8,
        234u8, 180u8, 224u8, 46u8, 48u8, 60u8, 194u8, 57u8, 23u8, 2u8,
    ];
    let digest = vector[97u8, 99u8, 116u8, 105u8, 111u8, 110u8, 45u8, 120u8, 121u8, 122u8]; // "action-xyz"

    let verified = attestation_verifier::verify(&reg, AGENT, digest, 42, TS_MS, sig, &clk);
    let (a, _d, _n) = attestation_verifier::consume(verified);
    assert_eq!(a, AGENT);

    destroy(cap);
    destroy(clk);
    ts::return_shared(reg);
    s.end();
}

#[test, expected_failure(abort_code = suioverflow::attestation_verifier::EBadSignature)]
fun verify_rejects_tampered_action() {
    let mut s = ts::begin(ADMIN);
    agent_registry::init_for_testing(s.ctx());

    s.next_tx(USER);
    let mut reg = s.take_shared<Registry>();
    let mut clk = clock::create_for_testing(s.ctx());
    clk.increment_for_testing(TS_MS);

    let pk = vector[
        65u8, 154u8, 6u8, 208u8, 102u8, 66u8, 157u8, 16u8, 36u8, 188u8, 107u8, 204u8, 163u8,
        163u8, 18u8, 223u8, 242u8, 103u8, 252u8, 148u8, 65u8, 67u8, 149u8, 253u8, 193u8, 225u8,
        165u8, 208u8, 76u8, 78u8, 246u8, 199u8,
    ];
    let _cap = agent_registry::register(&mut reg, &clk, AGENT, b"pcr0", b"pcr1", b"pcr2", pk, s.ctx());

    let sig = vector[
        177u8, 168u8, 205u8, 112u8, 94u8, 173u8, 247u8, 169u8, 216u8, 194u8, 32u8, 54u8, 11u8,
        251u8, 106u8, 20u8, 75u8, 55u8, 151u8, 136u8, 43u8, 216u8, 227u8, 33u8, 27u8, 248u8, 196u8,
        250u8, 238u8, 147u8, 226u8, 216u8, 67u8, 138u8, 32u8, 195u8, 134u8, 13u8, 39u8, 113u8,
        174u8, 44u8, 71u8, 209u8, 22u8, 176u8, 110u8, 177u8, 205u8, 44u8, 136u8, 105u8, 13u8, 67u8,
        234u8, 180u8, 224u8, 46u8, 48u8, 60u8, 194u8, 57u8, 23u8, 2u8,
    ];
    // Tampered: a different action_digest than what was signed → signature fails.
    let tampered = vector[1u8, 2u8, 3u8];

    let verified = attestation_verifier::verify(&reg, AGENT, tampered, 42, TS_MS, sig, &clk);
    let (_a, _d, _n) = attestation_verifier::consume(verified);
    abort 0
}
