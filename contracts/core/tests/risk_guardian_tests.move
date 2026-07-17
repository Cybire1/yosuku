#[test_only]
module suioverflow::risk_guardian_tests;

use sui::{
    clock::{Self, Clock},
    test_scenario as ts,
};
use std::unit_test::{assert_eq, destroy};
use suioverflow::{
    agent_registry::{Self, Registry},
    attestation_verifier::{Self, VerifiedAction},
    risk_guardian::{Self, RiskRegistry},
};

const OWNER: address = @0xCAFE;
const GUARDIAN: address = @0x6A123;
const ATTACKER: address = @0xBAD;
const NAVI: vector<u8> = b"navi";

#[test_only]
fun mk_verified(_reg: &Registry, _clk: &Clock, who: address): VerifiedAction {
    attestation_verifier::new_verified_for_testing(who, b"digest", 1)
}

#[test_only]
fun setup(s: &mut ts::Scenario): (Registry, Clock, RiskRegistry) {
    agent_registry::init_for_testing(s.ctx());
    s.next_tx(OWNER);
    let mut reg = s.take_shared<Registry>();
    let clk = clock::create_for_testing(s.ctx());
    let cap = agent_registry::register(&mut reg, &clk, GUARDIAN, b"p0", b"p1", b"p2", b"pk", s.ctx());
    destroy(cap);
    let risk = risk_guardian::new_registry_for_testing(GUARDIAN, s.ctx());
    (reg, clk, risk)
}

#[test]
fun high_score_flags_protocol() {
    let mut s = ts::begin(OWNER);
    let (reg, clk, mut risk) = setup(&mut s);

    risk_guardian::update_score(&mut risk, mk_verified(&reg, &clk, GUARDIAN), NAVI, 90, b"depeg", &clk);
    assert_eq!(risk_guardian::score_of(&risk, NAVI), 90);
    assert!(risk_guardian::is_high_risk(&risk, NAVI, &clk));

    destroy(risk);
    destroy(clk);
    ts::return_shared(reg);
    s.end();
}

#[test]
fun low_score_is_safe() {
    let mut s = ts::begin(OWNER);
    let (reg, clk, mut risk) = setup(&mut s);

    risk_guardian::update_score(&mut risk, mk_verified(&reg, &clk, GUARDIAN), NAVI, 30, b"calm", &clk);
    assert!(!risk_guardian::is_high_risk(&risk, NAVI, &clk));

    destroy(risk);
    destroy(clk);
    ts::return_shared(reg);
    s.end();
}

#[test]
fun stale_high_score_fails_open() {
    let mut s = ts::begin(OWNER);
    let (reg, clk, mut risk) = setup(&mut s);

    risk_guardian::update_score(&mut risk, mk_verified(&reg, &clk, GUARDIAN), NAVI, 95, b"depeg", &clk);
    let mut clk2 = clk;
    clock::increment_for_testing(&mut clk2, 600_001); // past MAX_SCORE_AGE_MS
    assert!(!risk_guardian::is_high_risk(&risk, NAVI, &clk2)); // fail-open

    destroy(risk);
    destroy(clk2);
    ts::return_shared(reg);
    s.end();
}

#[test, expected_failure(abort_code = suioverflow::risk_guardian::ENotGuardian)]
fun only_guardian_may_write() {
    let mut s = ts::begin(OWNER);
    let (mut reg, clk, mut risk) = setup(&mut s);
    let _cap2 = agent_registry::register(&mut reg, &clk, ATTACKER, b"p0", b"p1", b"p2", b"pk", s.ctx());

    risk_guardian::update_score(&mut risk, mk_verified(&reg, &clk, ATTACKER), NAVI, 90, b"spoof", &clk);
    abort 0
}

#[test]
fun b2b_guardian_pause_then_dao_override() {
    let mut s = ts::begin(OWNER);
    let (reg, clk, mut risk) = setup(&mut s);

    let mut guard = risk_guardian::subscribe(NAVI, s.ctx());
    risk_guardian::update_score(&mut risk, mk_verified(&reg, &clk, GUARDIAN), NAVI, 88, b"flash crash", &clk);

    risk_guardian::guardian_pause(&mut guard, &risk, &clk); // permissionless, allowed because high-risk
    assert!(risk_guardian::is_paused(&guard));

    risk_guardian::dao_unpause(&mut guard, s.ctx()); // owner override
    assert!(!risk_guardian::is_paused(&guard));

    destroy(guard);
    destroy(risk);
    destroy(clk);
    ts::return_shared(reg);
    s.end();
}

#[test, expected_failure(abort_code = suioverflow::risk_guardian::ENotHighRisk)]
fun cannot_pause_a_safe_protocol() {
    let mut s = ts::begin(OWNER);
    let (_reg, clk, risk) = setup(&mut s);

    let mut guard = risk_guardian::subscribe(NAVI, s.ctx());
    risk_guardian::guardian_pause(&mut guard, &risk, &clk); // no score → not high risk → abort
    abort 0
}
