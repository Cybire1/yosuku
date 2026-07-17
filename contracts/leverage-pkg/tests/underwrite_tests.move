#[test_only]
module yolev::underwrite_tests;

use std::unit_test::{assert_eq, destroy};
use sui::{
    clock,
    coin::{Self, Coin},
    test_scenario::{Self as ts},
};
use yolev::underwrite::{Self, Reserve, SupplyPosition, Position, OpenOrder};

public struct TUSD has drop {}

const ADMIN: address = @0xA;
const LP: address = @0xB;
const USER: address = @0xC;
const KEEPER: address = @0xE;

// 3x max, 8% premium on fronted, 60% exposure cap
fun setup(sc: &mut ts::Scenario) {
    let mgr = object::id_from_address(@0x99); // dummy custody manager id for tests
    underwrite::create<TUSD>(mgr, KEEPER, 30_000, 800, 6_000, ts::ctx(sc));
}

fun mint(sc: &mut ts::Scenario, amt: u64): Coin<TUSD> {
    coin::mint_for_testing<TUSD>(amt, ts::ctx(sc))
}

#[test]
fun premium_quote() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    ts::next_tx(&mut sc, USER);
    let r = ts::take_shared<Reserve<TUSD>>(&sc);
    assert_eq!(underwrite::quote_premium(&r, 1000, 20_000), 80);
    assert_eq!(underwrite::quote_premium(&r, 1000, 30_000), 160);
    ts::return_shared(r);
    ts::end(sc);
}

#[test]
fun escrow_fill_win_settle() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(1000);
    setup(&mut sc);

    // LP supplies 10_000
    ts::next_tx(&mut sc, LP);
    let mut r = ts::take_shared<Reserve<TUSD>>(&sc);
    let sp = underwrite::supply(&mut r, mint(&mut sc, 10_000), ts::ctx(&mut sc));
    transfer::public_transfer(sp, LP);
    ts::return_shared(r);

    // USER requests a 3x open on margin 1000 (escrows the margin)
    ts::next_tx(&mut sc, USER);
    let r = ts::take_shared<Reserve<TUSD>>(&sc);
    underwrite::request_open(&r, mint(&mut sc, 1000), object::id_from_address(@0x1), 30_000, 2000, false, 100, 0, true, &clk, ts::ctx(&mut sc));
    ts::return_shared(r);

    // KEEPER fills it: fronted 2000, premium 160, notional 2840
    ts::next_tx(&mut sc, KEEPER);
    let mut r = ts::take_shared<Reserve<TUSD>>(&sc);
    let order = ts::take_shared<OpenOrder<TUSD>>(&sc);
    let notional = underwrite::fill(&mut r, order, 3000, &clk, ts::ctx(&mut sc));
    assert_eq!(notional.value(), 2840);
    assert_eq!(underwrite::available_liquidity(&r), 8160);
    assert_eq!(underwrite::outstanding(&r), 2000);
    assert_eq!(underwrite::total_value(&r), 10_160);
    coin::burn_for_testing(notional); // stands in for deposit+mint into the keeper manager
    ts::return_shared(r);

    // the Position is SHARED; its owner field is the trader (USER)
    ts::next_tx(&mut sc, KEEPER);
    let pos = ts::take_shared<Position<TUSD>>(&sc);
    assert_eq!(underwrite::position_owner(&pos), USER);

    // WIN: KEEPER settles (permissionless) with the 3000 payout → PnL routes to USER
    let mut r = ts::take_shared<Reserve<TUSD>>(&sc);
    underwrite::settle(&mut r, pos, mint(&mut sc, 3000), ts::ctx(&mut sc));
    assert_eq!(underwrite::available_liquidity(&r), 10_160);
    assert_eq!(underwrite::outstanding(&r), 0);
    ts::return_shared(r);

    // USER (not the keeper) received remainder 3000 - 2000 = 1000
    ts::next_tx(&mut sc, USER);
    let pnl = ts::take_from_sender<Coin<TUSD>>(&sc);
    assert_eq!(pnl.value(), 1000);
    coin::burn_for_testing(pnl);

    destroy(clk);
    ts::end(sc);
}

#[test]
fun cancel_returns_margin() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(1000);
    setup(&mut sc);

    ts::next_tx(&mut sc, USER);
    let r = ts::take_shared<Reserve<TUSD>>(&sc);
    underwrite::request_open(&r, mint(&mut sc, 1000), object::id_from_address(@0x1), 20_000, 2000, false, 100, 0, true, &clk, ts::ctx(&mut sc));
    ts::return_shared(r);

    // USER cancels the unfilled order → margin back
    ts::next_tx(&mut sc, USER);
    let r = ts::take_shared<Reserve<TUSD>>(&sc);
    let order = ts::take_shared<OpenOrder<TUSD>>(&sc);
    let back = underwrite::cancel(&r, order, ts::ctx(&mut sc));
    assert_eq!(back.value(), 1000);
    coin::burn_for_testing(back);
    ts::return_shared(r);

    destroy(clk);
    ts::end(sc);
}

#[test]
fun loss_costs_only_margin() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(1000);
    setup(&mut sc);

    ts::next_tx(&mut sc, LP);
    let mut r = ts::take_shared<Reserve<TUSD>>(&sc);
    let sp = underwrite::supply(&mut r, mint(&mut sc, 10_000), ts::ctx(&mut sc));
    transfer::public_transfer(sp, LP);
    ts::return_shared(r);

    ts::next_tx(&mut sc, USER);
    let r = ts::take_shared<Reserve<TUSD>>(&sc);
    underwrite::request_open(&r, mint(&mut sc, 1000), object::id_from_address(@0x1), 30_000, 2000, false, 100, 0, true, &clk, ts::ctx(&mut sc));
    ts::return_shared(r);

    ts::next_tx(&mut sc, KEEPER);
    let mut r = ts::take_shared<Reserve<TUSD>>(&sc);
    let order = ts::take_shared<OpenOrder<TUSD>>(&sc);
    coin::burn_for_testing(underwrite::fill(&mut r, order, 3000, &clk, ts::ctx(&mut sc)));
    ts::return_shared(r);

    // LOSS: KEEPER settles the SHARED position with a zero coin
    ts::next_tx(&mut sc, KEEPER);
    let pos = ts::take_shared<Position<TUSD>>(&sc);
    let mut r = ts::take_shared<Reserve<TUSD>>(&sc);
    underwrite::settle(&mut r, pos, coin::zero<TUSD>(ts::ctx(&mut sc)), ts::ctx(&mut sc));
    // reserve kept premium 160, lost fronted 2000 → total_value 8160
    assert_eq!(underwrite::total_value(&r), 8160);
    assert_eq!(underwrite::outstanding(&r), 0);
    ts::return_shared(r);

    destroy(clk);
    ts::end(sc);
}

#[test, expected_failure(abort_code = yolev::underwrite::EExposureCap)]
fun exposure_cap_enforced_at_fill() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(1000);
    setup(&mut sc);

    // supply 1000; cap 60% → max outstanding 600
    ts::next_tx(&mut sc, LP);
    let mut r = ts::take_shared<Reserve<TUSD>>(&sc);
    let sp = underwrite::supply(&mut r, mint(&mut sc, 1000), ts::ctx(&mut sc));
    transfer::public_transfer(sp, LP);
    ts::return_shared(r);

    ts::next_tx(&mut sc, USER);
    let r = ts::take_shared<Reserve<TUSD>>(&sc);
    underwrite::request_open(&r, mint(&mut sc, 1000), object::id_from_address(@0x1), 30_000, 2000, false, 100, 0, true, &clk, ts::ctx(&mut sc));
    ts::return_shared(r);

    // fronted 2000 > cap 600 → abort at fill
    ts::next_tx(&mut sc, KEEPER);
    let mut r = ts::take_shared<Reserve<TUSD>>(&sc);
    let order = ts::take_shared<OpenOrder<TUSD>>(&sc);
    coin::burn_for_testing(underwrite::fill(&mut r, order, 3000, &clk, ts::ctx(&mut sc)));
    ts::return_shared(r);
    destroy(clk);
    ts::end(sc);
}

#[test, expected_failure(abort_code = yolev::underwrite::ELeverageTooHigh)]
fun leverage_cap_enforced_at_request() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(1000);
    setup(&mut sc);

    ts::next_tx(&mut sc, USER);
    let r = ts::take_shared<Reserve<TUSD>>(&sc);
    // 4x > 3x cap → abort at request
    underwrite::request_open(&r, mint(&mut sc, 1000), object::id_from_address(@0x1), 40_000, 2000, false, 100, 0, true, &clk, ts::ctx(&mut sc));
    ts::return_shared(r);
    destroy(clk);
    ts::end(sc);
}

#[test, expected_failure(abort_code = yolev::underwrite::ENotKeeper)]
fun only_keeper_can_fill() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(1000);
    setup(&mut sc);

    ts::next_tx(&mut sc, LP);
    let mut r = ts::take_shared<Reserve<TUSD>>(&sc);
    let sp = underwrite::supply(&mut r, mint(&mut sc, 10_000), ts::ctx(&mut sc));
    transfer::public_transfer(sp, LP);
    ts::return_shared(r);

    ts::next_tx(&mut sc, USER);
    let r = ts::take_shared<Reserve<TUSD>>(&sc);
    underwrite::request_open(&r, mint(&mut sc, 1000), object::id_from_address(@0x1), 30_000, 2000, false, 100, 0, true, &clk, ts::ctx(&mut sc));
    ts::return_shared(r);

    // USER (not the keeper) tries to fill → abort
    ts::next_tx(&mut sc, USER);
    let mut r = ts::take_shared<Reserve<TUSD>>(&sc);
    let order = ts::take_shared<OpenOrder<TUSD>>(&sc);
    coin::burn_for_testing(underwrite::fill(&mut r, order, 3000, &clk, ts::ctx(&mut sc)));
    ts::return_shared(r);
    destroy(clk);
    ts::end(sc);
}
