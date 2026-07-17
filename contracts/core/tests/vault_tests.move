#[test_only]
module suioverflow::vault_tests;

use sui::{
    clock::{Self, Clock},
    coin,
    test_scenario as ts,
};
use std::unit_test::{assert_eq, destroy};
use suioverflow::{
    agent_registry::{Self, Registry},
    attestation_verifier::{Self, VerifiedAction},
    vault::{Self, Vault},
};

const OWNER: address = @0xCAFE;
const AGENT: address = @0xA6E27;

/// Test-only base asset.
public struct TUSD has drop {}

const NAVI: vector<u8> = b"navi";
const DIGEST: vector<u8> = b"decision_record_hash";

#[test_only]
fun mk_verified(_reg: &Registry, _clk: &Clock, digest: vector<u8>): VerifiedAction {
    // Downstream-flow tests mint a VerifiedAction directly; the real ed25519
    // signature path is covered in integration_tests.
    attestation_verifier::new_verified_for_testing(AGENT, digest, 1)
}

/// Stand up a registry with AGENT registered, a clock, and a funded vault.
#[test_only]
fun setup(
    s: &mut ts::Scenario,
    cap_bps: u64,
    max_move: u64,
    daily_loss: u64,
    deposit: u64,
): (Registry, Clock, Vault<TUSD>, agent_registry::AgentCap) {
    agent_registry::init_for_testing(s.ctx());
    s.next_tx(OWNER);
    let mut reg = s.take_shared<Registry>();
    let clk = clock::create_for_testing(s.ctx());
    let cap = agent_registry::register(&mut reg, &clk, AGENT, b"p0", b"p1", b"p2", b"pk", s.ctx());

    let mut v = vault::open<TUSD>(AGENT, cap_bps, max_move, daily_loss, &clk, s.ctx());
    let c = coin::mint_for_testing<TUSD>(deposit, s.ctx());
    vault::deposit(&mut v, c, s.ctx());
    (reg, clk, v, cap)
}

#[test_only]
fun teardown(reg: Registry, clk: Clock, v: Vault<TUSD>, cap: agent_registry::AgentCap) {
    destroy(cap);
    destroy(v);
    destroy(clk);
    ts::return_shared(reg);
}

#[test]
fun deposit_and_owner_withdraw() {
    let mut s = ts::begin(OWNER);
    let (reg, clk, mut v, cap) = setup(&mut s, 5000, 1_000_000, 100, 1000);

    assert_eq!(vault::idle_value(&v), 1000);
    assert_eq!(vault::total_assets(&v), 1000);

    let out = vault::owner_withdraw(&mut v, 400, s.ctx());
    assert_eq!(out.value(), 400);
    assert_eq!(vault::idle_value(&v), 600);

    destroy(out);
    teardown(reg, clk, v, cap);
    s.end();
}

#[test]
/// Full allocate -> collect-with-profit loop. Ledger and PnL accounting check out.
fun allocate_then_collect_profit() {
    let mut s = ts::begin(OWNER);
    let (reg, clk, mut v, cap) = setup(&mut s, 5000, 1_000_000, 100, 1000);

    // Allocate 500 into Navi.
    let va = mk_verified(&reg, &clk, DIGEST);
    let ticket = vault::begin_allocation(&mut v, va, NAVI, 500, DIGEST, &clk);
    let to_protocol = vault::withdraw_for_allocation(&mut v, &ticket, s.ctx());
    assert_eq!(to_protocol.value(), 500);
    destroy(to_protocol); // funds "enter" the protocol building
    vault::confirm_allocation(&mut v, ticket, 0, &clk);

    assert_eq!(vault::idle_value(&v), 500);
    assert_eq!(vault::total_deployed(&v), 500);
    assert_eq!(vault::allocation_principal(&v, NAVI), 500);

    // Collect with 100 of yield (proceeds 600).
    let vc = mk_verified(&reg, &clk, DIGEST);
    let cticket = vault::begin_collection(&mut v, vc, NAVI, DIGEST);
    let proceeds = coin::mint_for_testing<TUSD>(600, s.ctx());
    vault::confirm_collection(&mut v, cticket, proceeds, 0, &clk);

    assert_eq!(vault::total_deployed(&v), 0);
    assert_eq!(vault::idle_value(&v), 1100);
    assert_eq!(vault::allocation_principal(&v, NAVI), 0);
    assert_eq!(vault::realized_loss_today(&v), 0);
    assert!(!vault::is_paused(&v));

    teardown(reg, clk, v, cap);
    s.end();
}

#[test, expected_failure(abort_code = suioverflow::vault::EExceedsProtocolCap)]
/// 50% cap on a 1000 vault => 500 max per protocol; 600 must abort.
fun allocation_exceeds_protocol_cap() {
    let mut s = ts::begin(OWNER);
    let (reg, clk, mut v, cap) = setup(&mut s, 5000, 1_000_000, 100, 1000);

    let va = mk_verified(&reg, &clk, DIGEST);
    let ticket = vault::begin_allocation(&mut v, va, NAVI, 600, DIGEST, &clk);

    destroy(ticket);
    teardown(reg, clk, v, cap);
    s.end();
}

#[test, expected_failure(abort_code = suioverflow::vault::EExceedsMoveCap)]
fun allocation_exceeds_single_move_cap() {
    let mut s = ts::begin(OWNER);
    let (reg, clk, mut v, _cap) = setup(&mut s, 9000, 100, 100, 1000);

    let va = mk_verified(&reg, &clk, DIGEST);
    let _ticket = vault::begin_allocation(&mut v, va, NAVI, 200, DIGEST, &clk);
    abort 0
}

#[test, expected_failure(abort_code = suioverflow::vault::EPaused)]
/// Owner emergency-pause freezes the agent: new allocations must abort.
fun pause_blocks_agent_allocation() {
    let mut s = ts::begin(OWNER);
    let (reg, clk, mut v, _cap) = setup(&mut s, 9000, 1_000_000, 100, 1000);

    vault::emergency_pause(&mut v, s.ctx());
    assert!(vault::is_paused(&v));

    let va = mk_verified(&reg, &clk, DIGEST);
    let _ticket = vault::begin_allocation(&mut v, va, NAVI, 100, DIGEST, &clk);
    abort 0
}

#[test]
/// Even while paused, the owner can always withdraw idle funds (no rug).
fun owner_withdraw_works_while_paused() {
    let mut s = ts::begin(OWNER);
    let (reg, clk, mut v, cap) = setup(&mut s, 9000, 1_000_000, 100, 1000);

    vault::emergency_pause(&mut v, s.ctx());
    let out = vault::owner_withdraw(&mut v, 1000, s.ctx());
    assert_eq!(out.value(), 1000);
    assert_eq!(vault::idle_value(&v), 0);

    destroy(out);
    teardown(reg, clk, v, cap);
    s.end();
}

#[test]
/// A loss beyond the daily limit trips the breaker and auto-pauses the vault,
/// but the collection itself still completes (funds come home).
fun circuit_breaker_trips_on_excess_loss() {
    let mut s = ts::begin(OWNER);
    let (reg, clk, mut v, cap) = setup(&mut s, 9000, 1_000_000, 50, 1000);

    // Deploy 500 into Navi.
    let va = mk_verified(&reg, &clk, DIGEST);
    let ticket = vault::begin_allocation(&mut v, va, NAVI, 500, DIGEST, &clk);
    let to_protocol = vault::withdraw_for_allocation(&mut v, &ticket, s.ctx());
    destroy(to_protocol);
    vault::confirm_allocation(&mut v, ticket, 0, &clk);

    // Collect back only 400 -> 100 loss > 50 limit.
    let vc = mk_verified(&reg, &clk, DIGEST);
    let cticket = vault::begin_collection(&mut v, vc, NAVI, DIGEST);
    let proceeds = coin::mint_for_testing<TUSD>(400, s.ctx());
    vault::confirm_collection(&mut v, cticket, proceeds, 0, &clk);

    assert!(vault::is_paused(&v));
    assert_eq!(vault::realized_loss_today(&v), 100);
    assert_eq!(vault::idle_value(&v), 900); // 500 idle remainder + 400 proceeds
    assert_eq!(vault::total_deployed(&v), 0);

    teardown(reg, clk, v, cap);
    s.end();
}

#[test]
/// Budget-capped DeepBook round-trip that returns a profit.
fun trade_round_trip_profit() {
    let mut s = ts::begin(OWNER);
    let (reg, clk, mut v, cap) = setup(&mut s, 9000, 1_000_000, 100, 1000);

    let va = mk_verified(&reg, &clk, DIGEST);
    let (ticket, spent) = vault::begin_trade(&mut v, va, 500, DIGEST, &clk, s.ctx());
    assert_eq!(spent.value(), 500);
    assert_eq!(vault::idle_value(&v), 500);
    destroy(spent); // routed into DeepBook

    let proceeds = coin::mint_for_testing<TUSD>(520, s.ctx());
    vault::settle_trade(&mut v, ticket, proceeds, 0, &clk);

    assert_eq!(vault::idle_value(&v), 1020);
    assert_eq!(vault::realized_loss_today(&v), 0);
    assert!(!vault::is_paused(&v));

    teardown(reg, clk, v, cap);
    s.end();
}

#[test]
/// A losing round-trip beyond the daily limit trips the breaker.
fun trade_loss_trips_breaker() {
    let mut s = ts::begin(OWNER);
    let (reg, clk, mut v, cap) = setup(&mut s, 9000, 1_000_000, 50, 1000);

    let va = mk_verified(&reg, &clk, DIGEST);
    let (ticket, spent) = vault::begin_trade(&mut v, va, 500, DIGEST, &clk, s.ctx());
    destroy(spent);

    let proceeds = coin::mint_for_testing<TUSD>(400, s.ctx()); // 100 loss > 50 limit
    vault::settle_trade(&mut v, ticket, proceeds, 0, &clk);

    assert!(vault::is_paused(&v));
    assert_eq!(vault::realized_loss_today(&v), 100);
    assert_eq!(vault::idle_value(&v), 900);

    teardown(reg, clk, v, cap);
    s.end();
}

#[test, expected_failure(abort_code = suioverflow::vault::EExceedsMoveCap)]
fun trade_exceeds_budget_cap() {
    let mut s = ts::begin(OWNER);
    let (reg, clk, mut v, _cap) = setup(&mut s, 9000, 100, 100, 1000);

    let va = mk_verified(&reg, &clk, DIGEST);
    let (_ticket, _spent) = vault::begin_trade(&mut v, va, 200, DIGEST, &clk, s.ctx());
    abort 0
}

#[test]
/// Collection is permitted even while paused — positions can always unwind.
fun collection_allowed_while_paused() {
    let mut s = ts::begin(OWNER);
    let (reg, clk, mut v, cap) = setup(&mut s, 9000, 1_000_000, 100, 1000);

    let va = mk_verified(&reg, &clk, DIGEST);
    let ticket = vault::begin_allocation(&mut v, va, NAVI, 500, DIGEST, &clk);
    let to_protocol = vault::withdraw_for_allocation(&mut v, &ticket, s.ctx());
    destroy(to_protocol);
    vault::confirm_allocation(&mut v, ticket, 0, &clk);

    vault::emergency_pause(&mut v, s.ctx());

    let vc = mk_verified(&reg, &clk, DIGEST);
    let cticket = vault::begin_collection(&mut v, vc, NAVI, DIGEST);
    let proceeds = coin::mint_for_testing<TUSD>(500, s.ctx());
    vault::confirm_collection(&mut v, cticket, proceeds, 0, &clk);

    assert_eq!(vault::total_deployed(&v), 0);
    assert_eq!(vault::idle_value(&v), 1000);

    teardown(reg, clk, v, cap);
    s.end();
}
