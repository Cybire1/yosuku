#[test_only]
module suioverflow::yosuku_vault_tests;

use sui::{
    clock::{Self, Clock},
    coin,
    test_scenario as ts,
};
use std::unit_test::{assert_eq, destroy};
use suioverflow::{
    attestation_verifier,
    bell_share::{Self, BELL_SHARE},
    yosuku_vault::{Self, Vault},
};

public struct TUSD has drop {}

const ADMIN: address = @0xAD;
const AGENT: address = @0xA6E;
const STRIKE: u64 = 63_000_000_000_000;
const EXPIRY: u64 = 1_700_000_000_000;
const QTY: u64 = 1_000_000;
const COST: u64 = 480_000;
const NONCE: u64 = 1;
const ISSUED: u64 = 500;

#[test_only]
fun setup(s: &mut ts::Scenario): (Clock, Vault<TUSD>) {
    let clk = clock::create_for_testing(s.ctx());
    let treasury = bell_share::new_treasury_for_testing(s.ctx());
    // cap 50%, max move 1 DUSDC, daily-loss 0.1 DUSDC
    let v = yosuku_vault::open<TUSD>(treasury, AGENT, 5000, 1_000_000, 100_000, &clk, s.ctx());
    (clk, v)
}

/// Byte-parity with agent/src/digest.ts::predictActionDigest (kind=3). The hex is
/// produced by that TS for this exact vector — if the layouts diverge, this fails.
#[test]
fun predict_digest_ts_parity() {
    let vault_id = object::id_from_bytes(x"1111111111111111111111111111111111111111111111111111111111111111");
    let oracle_id = object::id_from_bytes(x"2222222222222222222222222222222222222222222222222222222222222222");
    let d = yosuku_vault::predict_digest_for_testing(
        vault_id, oracle_id,
        64_000_000_000_000, // strike
        1_783_065_600_000,  // expiry
        10_000_000,         // qty
        0,                  // side = UP
        1,                  // approved
        42,                 // nonce
        1_700_000_000_000,  // issued_at_ms
        x"3333333333333333333333333333333333333333333333333333333333333333",
    );
    assert_eq!(d, x"6dfa808d6869c8e1c1ffd5cc1e2c2fc3e1907ba80a377a5a8ec2803c9da7b676");
}

#[test_only]
fun oracle(): ID { object::id_from_address(@0xC0FFEE) }

#[test_only]
fun fund(v: &mut Vault<TUSD>, amount: u64, s: &mut ts::Scenario): coin::Coin<BELL_SHARE> {
    let c = coin::mint_for_testing<TUSD>(amount, s.ctx());
    yosuku_vault::deposit(v, c, s.ctx())
}

#[test]
fun deposit_and_redeem_round_trip() {
    let mut s = ts::begin(ADMIN);
    let (clk, mut v) = setup(&mut s);

    let shares = fund(&mut v, 1_000_000, &mut s);
    assert_eq!(shares.value(), 1_000_000); // first deposit 1:1
    assert_eq!(yosuku_vault::idle_value(&v), 1_000_000);
    assert_eq!(yosuku_vault::share_supply(&v), 1_000_000);

    let out = yosuku_vault::redeem(&mut v, shares, s.ctx());
    assert_eq!(out.value(), 1_000_000);
    assert_eq!(yosuku_vault::idle_value(&v), 0);

    destroy(out);
    destroy(v);
    destroy(clk);
    s.end();
}

#[test]
fun open_leg_then_settle_profit() {
    let mut s = ts::begin(ADMIN);
    let (clk, mut v) = setup(&mut s);
    let o = oracle();
    yosuku_vault::set_oracle_allowed(&mut v, o, true, s.ctx());
    let shares = fund(&mut v, 1_000_000, &mut s);

    let vid = object::id(&v);
    let digest = yosuku_vault::predict_digest_for_testing(vid, o, STRIKE, EXPIRY, QTY, 0, 1, NONCE, ISSUED, b"ih");
    let verified = attestation_verifier::new_verified_for_testing(AGENT, digest, NONCE);

    let (ticket, coin) = yosuku_vault::begin_predict_action(
        &mut v, verified, o, EXPIRY, STRIKE, 0, QTY, COST, digest, ISSUED, b"ih", &clk, s.ctx(),
    );
    assert_eq!(coin.value(), COST);
    destroy(coin); // → manager deposit + predict::mint in the real PTB
    yosuku_vault::confirm_predict_action(&mut v, ticket, 0, &clk);

    assert_eq!(yosuku_vault::leg_qty(&v, o, EXPIRY, STRIKE, 0), QTY);
    assert_eq!(yosuku_vault::total_open_cost(&v), COST);
    assert_eq!(yosuku_vault::idle_value(&v), 1_000_000 - COST);
    // NAV unchanged at open: idle + open_cost == 1_000_000
    assert_eq!(yosuku_vault::nav(&v), 1_000_000);

    // settle a winner: proceeds 600_000 > cost 480_000
    let proceeds = coin::mint_for_testing<TUSD>(600_000, s.ctx());
    yosuku_vault::book_payout(&mut v, proceeds, &clk, o, EXPIRY, STRIKE, 0, 0);
    assert_eq!(yosuku_vault::idle_value(&v), (1_000_000 - COST) + 600_000);
    assert_eq!(yosuku_vault::leg_qty(&v, o, EXPIRY, STRIKE, 0), 0);
    assert_eq!(yosuku_vault::total_open_cost(&v), 0);
    assert!(!yosuku_vault::is_paused(&v));

    destroy(shares);
    destroy(v);
    destroy(clk);
    s.end();
}

#[test]
fun settle_loss_trips_breaker() {
    let mut s = ts::begin(ADMIN);
    let (clk, mut v) = setup(&mut s);
    let o = oracle();
    yosuku_vault::set_oracle_allowed(&mut v, o, true, s.ctx());
    let shares = fund(&mut v, 1_000_000, &mut s);
    let vid = object::id(&v);
    let digest = yosuku_vault::predict_digest_for_testing(vid, o, STRIKE, EXPIRY, QTY, 0, 1, NONCE, ISSUED, b"ih");
    let verified = attestation_verifier::new_verified_for_testing(AGENT, digest, NONCE);
    let (ticket, coin) = yosuku_vault::begin_predict_action(
        &mut v, verified, o, EXPIRY, STRIKE, 0, QTY, COST, digest, ISSUED, b"ih", &clk, s.ctx(),
    );
    destroy(coin);
    yosuku_vault::confirm_predict_action(&mut v, ticket, 0, &clk);

    // settle a loser: proceeds 300_000 → loss 180_000 > daily_loss_limit 100_000
    let proceeds = coin::mint_for_testing<TUSD>(300_000, s.ctx());
    yosuku_vault::book_payout(&mut v, proceeds, &clk, o, EXPIRY, STRIKE, 0, 0);
    assert!(yosuku_vault::is_paused(&v));
    assert_eq!(yosuku_vault::realized_loss_today(&v), 180_000);

    destroy(shares);
    destroy(v);
    destroy(clk);
    s.end();
}

#[test, expected_failure(abort_code = suioverflow::yosuku_vault::EDigestBind)]
fun rejects_tampered_params() {
    let mut s = ts::begin(ADMIN);
    let (clk, mut v) = setup(&mut s);
    let o = oracle();
    yosuku_vault::set_oracle_allowed(&mut v, o, true, s.ctx());
    let _shares = fund(&mut v, 1_000_000, &mut s);
    let vid = object::id(&v);
    // sign for STRIKE …
    let digest = yosuku_vault::predict_digest_for_testing(vid, o, STRIKE, EXPIRY, QTY, 0, 1, NONCE, ISSUED, b"ih");
    let verified = attestation_verifier::new_verified_for_testing(AGENT, digest, NONCE);
    // … but try to open a DIFFERENT strike → on-chain re-derivation won't match → abort.
    let (_ticket, _coin) = yosuku_vault::begin_predict_action(
        &mut v, verified, o, EXPIRY, STRIKE + 1_000_000_000, 0, QTY, COST, digest, ISSUED, b"ih", &clk, s.ctx(),
    );
    abort 0
}

#[test, expected_failure(abort_code = suioverflow::yosuku_vault::EOracleNotAllowed)]
fun rejects_unallowlisted_oracle() {
    let mut s = ts::begin(ADMIN);
    let (clk, mut v) = setup(&mut s);
    let o = oracle(); // NOT allowlisted
    let _shares = fund(&mut v, 1_000_000, &mut s);
    let vid = object::id(&v);
    let digest = yosuku_vault::predict_digest_for_testing(vid, o, STRIKE, EXPIRY, QTY, 0, 1, NONCE, ISSUED, b"ih");
    let verified = attestation_verifier::new_verified_for_testing(AGENT, digest, NONCE);
    let (_ticket, _coin) = yosuku_vault::begin_predict_action(
        &mut v, verified, o, EXPIRY, STRIKE, 0, QTY, COST, digest, ISSUED, b"ih", &clk, s.ctx(),
    );
    abort 0
}

#[test, expected_failure(abort_code = suioverflow::yosuku_vault::EExceedsMoveCap)]
fun rejects_over_cap_cost() {
    let mut s = ts::begin(ADMIN);
    let (clk, mut v) = setup(&mut s);
    let o = oracle();
    yosuku_vault::set_oracle_allowed(&mut v, o, true, s.ctx());
    let _shares = fund(&mut v, 5_000_000, &mut s);
    let vid = object::id(&v);
    let bigCost = 2_000_000; // > max_single_move (1_000_000)
    let digest = yosuku_vault::predict_digest_for_testing(vid, o, STRIKE, EXPIRY, QTY, 0, 1, NONCE, ISSUED, b"ih");
    let verified = attestation_verifier::new_verified_for_testing(AGENT, digest, NONCE);
    let (_ticket, _coin) = yosuku_vault::begin_predict_action(
        &mut v, verified, o, EXPIRY, STRIKE, 0, QTY, bigCost, digest, ISSUED, b"ih", &clk, s.ctx(),
    );
    abort 0
}

#[test, expected_failure(abort_code = suioverflow::yosuku_vault::EPaused)]
fun pause_blocks_open() {
    let mut s = ts::begin(ADMIN);
    let (clk, mut v) = setup(&mut s);
    let o = oracle();
    yosuku_vault::set_oracle_allowed(&mut v, o, true, s.ctx());
    let _shares = fund(&mut v, 1_000_000, &mut s);
    yosuku_vault::emergency_pause(&mut v, s.ctx());
    let vid = object::id(&v);
    let digest = yosuku_vault::predict_digest_for_testing(vid, o, STRIKE, EXPIRY, QTY, 0, 1, NONCE, ISSUED, b"ih");
    let verified = attestation_verifier::new_verified_for_testing(AGENT, digest, NONCE);
    let (_ticket, _coin) = yosuku_vault::begin_predict_action(
        &mut v, verified, o, EXPIRY, STRIKE, 0, QTY, COST, digest, ISSUED, b"ih", &clk, s.ctx(),
    );
    abort 0
}
