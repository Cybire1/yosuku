#[test_only]
module yolev::leverage_tests;

use std::unit_test::{assert_eq, destroy};
use sui::{
    clock,
    coin::{Self, Coin},
    test_scenario::{Self as ts},
};
use yolev::{
    lending_pool::{Self, LendingPool},
    leverage::{Self, LevConfig, Loan},
};

public struct TUSD has drop {}

const ADMIN: address = @0xA;
const LP: address = @0xB;
const USER: address = @0xC;
const LIQ: address = @0xD;

fun setup(sc: &mut ts::Scenario, clk: &sui::clock::Clock) {
    lending_pool::create<TUSD>(0, 0, clk, ts::ctx(sc)); // 0% interest for clean assertions
    leverage::create_config(30_000, 11_000, 500, ts::ctx(sc)); // 3x, liquidate <110%, 5% penalty
}

#[test]
fun open_and_close_with_profit() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);

    ts::next_tx(&mut sc, LP);
    let mut pool = ts::take_shared<LendingPool<TUSD>>(&sc);
    let cfg = ts::take_shared<LevConfig>(&sc);
    // fund the pool
    let sp = lending_pool::supply(&mut pool, coin::mint_for_testing<TUSD>(1_000_000, ts::ctx(&mut sc)), &clk, ts::ctx(&mut sc));

    // USER opens 3x: 100k margin + 200k borrow = 300k notional
    ts::next_tx(&mut sc, USER);
    let margin = coin::mint_for_testing<TUSD>(100_000, ts::ctx(&mut sc));
    let (loan, notional) = leverage::open(&cfg, &mut pool, margin, sui::object::id_from_address(@0x1), sui::object::id_from_address(@0x2), 200_000, 0, false, 0, 0, true, 300_000, &clk, ts::ctx(&mut sc));
    assert_eq!(notional.value(), 300_000);
    assert_eq!(leverage::loan_notional(&loan), 300_000);
    assert_eq!(lending_pool::available_liquidity(&pool), 800_000);
    coin::burn_for_testing(notional); // simulating funds going into a Predict position

    // position redeems for 330k (profit). close → repay 200k debt → 130k back
    let proceeds = coin::mint_for_testing<TUSD>(330_000, ts::ctx(&mut sc));
    let back = leverage::close(loan, &mut pool, proceeds, &clk, ts::ctx(&mut sc));
    assert_eq!(back.value(), 130_000);        // margin 100k + 30k PnL
    assert_eq!(lending_pool::available_liquidity(&pool), 1_000_000); // pool whole again
    coin::burn_for_testing(back);

    coin::burn_for_testing(lending_pool::withdraw(&mut pool, sp, &clk, ts::ctx(&mut sc)));
    ts::return_shared(pool); ts::return_shared(cfg);
    destroy(clk); ts::end(sc);
}

#[test]
fun liquidate_undercollateralized() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);

    ts::next_tx(&mut sc, LP);
    let mut pool = ts::take_shared<LendingPool<TUSD>>(&sc);
    let cfg = ts::take_shared<LevConfig>(&sc);
    let sp = lending_pool::supply(&mut pool, coin::mint_for_testing<TUSD>(1_000_000, ts::ctx(&mut sc)), &clk, ts::ctx(&mut sc));

    ts::next_tx(&mut sc, USER);
    let (loan, notional) = leverage::open(&cfg, &mut pool, coin::mint_for_testing<TUSD>(100_000, ts::ctx(&mut sc)), sui::object::id_from_address(@0x1), sui::object::id_from_address(@0x2), 200_000, 0, false, 0, 0, true, 300_000, &clk, ts::ctx(&mut sc));
    coin::burn_for_testing(notional);
    // debt = 200k (0% interest). maintenance 110% → threshold 220k.

    // position dropped to 215k (< 220k) → liquidatable. penalty 5% of 215k = 10_750.
    ts::next_tx(&mut sc, LIQ);
    let proceeds = coin::mint_for_testing<TUSD>(215_000, ts::ctx(&mut sc));
    let reward = leverage::liquidate(&cfg, loan, &mut pool, proceeds, &clk, ts::ctx(&mut sc));
    // left after penalty = 204_250 ≥ debt 200k → repay 200k, owner leftover 4_250

    assert_eq!(reward.value(), 10_750);
    coin::burn_for_testing(reward);
    ts::next_tx(&mut sc, USER);
    let owner_left = ts::take_from_address<Coin<TUSD>>(&sc, USER);
    assert_eq!(owner_left.value(), 4_250);
    coin::burn_for_testing(owner_left);
    // pool got 200k back → whole
    assert_eq!(lending_pool::available_liquidity(&pool), 1_000_000);

    coin::burn_for_testing(lending_pool::withdraw(&mut pool, sp, &clk, ts::ctx(&mut sc)));
    ts::return_shared(pool); ts::return_shared(cfg);
    destroy(clk); ts::end(sc);
}

#[test, expected_failure(abort_code = yolev::leverage::ELeverageTooHigh)]
fun cannot_exceed_max_leverage() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);
    ts::next_tx(&mut sc, LP);
    let mut pool = ts::take_shared<LendingPool<TUSD>>(&sc);
    let cfg = ts::take_shared<LevConfig>(&sc);
    let sp = lending_pool::supply(&mut pool, coin::mint_for_testing<TUSD>(1_000_000, ts::ctx(&mut sc)), &clk, ts::ctx(&mut sc));

    ts::next_tx(&mut sc, USER);
    // 100k margin + 250k borrow = 350k = 3.5x > 3x max → abort
    let (loan, notional) = leverage::open(&cfg, &mut pool, coin::mint_for_testing<TUSD>(100_000, ts::ctx(&mut sc)), sui::object::id_from_address(@0x1), sui::object::id_from_address(@0x2), 250_000, 0, false, 0, 0, true, 350_000, &clk, ts::ctx(&mut sc));
    coin::burn_for_testing(notional);
    sui::transfer::public_transfer(loan, USER);
    coin::burn_for_testing(lending_pool::withdraw(&mut pool, sp, &clk, ts::ctx(&mut sc)));
    ts::return_shared(pool); ts::return_shared(cfg);
    destroy(clk); ts::end(sc);
}
