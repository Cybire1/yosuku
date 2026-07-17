#[test_only]
module suioverflow::agent_registry_tests;

use sui::{
    test_scenario::{Self as ts},
    clock,
};
use std::unit_test::destroy;
use suioverflow::agent_registry::{Self, Registry};

const ADMIN: address = @0xAD;
const STRANGER: address = @0xBEEF;
const A1: address = @0xA1;

// Shared object — test_scenario is the right tool here (we genuinely share + take the
// Registry across txs), not just a TxContext shim. The native Nitro attestation path
// (`register_attested`) can't run under `sui move test`, so these cover everything
// around it: the register/revoke/query state machine and its abort guards.
fun setup(): ts::Scenario {
    let mut sc = ts::begin(ADMIN);
    agent_registry::init_for_testing(sc.ctx());
    sc.next_tx(ADMIN);
    sc
}

#[test]
fun register_active_and_getters() {
    let mut sc = setup();
    let mut reg = sc.take_shared<Registry>();
    let c = clock::create_for_testing(sc.ctx());

    let cap = agent_registry::register(&mut reg, &c, A1, b"pcr0", b"pcr1", b"pcr2", b"enclavePK", sc.ctx());

    agent_registry::assert_active(&reg, A1); // must not abort
    let (p0, p1, p2) = agent_registry::expected_pcrs(&reg, A1);
    assert!(p0 == b"pcr0", 0);
    assert!(p1 == b"pcr1", 1);
    assert!(p2 == b"pcr2", 2);
    assert!(agent_registry::enclave_pk(&reg, A1) == b"enclavePK", 3);
    assert!(agent_registry::cap_agent(&cap) == A1, 4);

    destroy(cap);
    clock::destroy_for_testing(c);
    ts::return_shared(reg);
    sc.end();
}

#[test, expected_failure(abort_code = 2, location = suioverflow::agent_registry)]
fun double_register_aborts() {
    let mut sc = setup();
    let mut reg = sc.take_shared<Registry>();
    let c = clock::create_for_testing(sc.ctx());

    let cap1 = agent_registry::register(&mut reg, &c, A1, b"p0", b"p1", b"p2", b"pk", sc.ctx());
    // second registration for the same agent -> EAlreadyRegistered (2)
    destroy(agent_registry::register(&mut reg, &c, A1, b"p0", b"p1", b"p2", b"pk", sc.ctx()));

    destroy(cap1);
    clock::destroy_for_testing(c);
    ts::return_shared(reg);
    sc.end();
}

#[test, expected_failure(abort_code = 4, location = suioverflow::agent_registry)]
fun revoke_makes_inactive() {
    let mut sc = setup();
    let mut reg = sc.take_shared<Registry>();
    let c = clock::create_for_testing(sc.ctx());

    let cap = agent_registry::register(&mut reg, &c, A1, b"p0", b"p1", b"p2", b"pk", sc.ctx());
    agent_registry::revoke(&mut reg, A1, sc.ctx()); // ADMIN is the owner -> ok
    agent_registry::assert_active(&reg, A1); // revoked -> ERevoked (4)

    destroy(cap);
    clock::destroy_for_testing(c);
    ts::return_shared(reg);
    sc.end();
}

#[test, expected_failure(abort_code = 3, location = suioverflow::agent_registry)]
fun assert_active_unknown_aborts() {
    let sc = setup();
    let reg = sc.take_shared<Registry>();

    agent_registry::assert_active(&reg, A1); // never registered -> EUnknownAgent (3)

    ts::return_shared(reg);
    sc.end();
}

#[test, expected_failure(abort_code = 1, location = suioverflow::agent_registry)]
fun revoke_by_non_owner_aborts() {
    let mut sc = setup();
    let mut reg = sc.take_shared<Registry>();
    let c = clock::create_for_testing(sc.ctx());
    let cap = agent_registry::register(&mut reg, &c, A1, b"p0", b"p1", b"p2", b"pk", sc.ctx());
    ts::return_shared(reg);

    sc.next_tx(STRANGER);
    let mut reg = sc.take_shared<Registry>();
    agent_registry::revoke(&mut reg, A1, sc.ctx()); // sender != owner -> ENotOwner (1)

    destroy(cap);
    clock::destroy_for_testing(c);
    ts::return_shared(reg);
    sc.end();
}
