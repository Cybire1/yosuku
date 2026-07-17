#[test_only]
module yolev::margin_tests;

use std::unit_test::{assert_eq, destroy};
use sui::{
    clock,
    coin::{Self, Coin},
    object,
    test_scenario::{Self as ts},
};
use yolev::{
    lending_pool::{Self, LendingPool},
    margin::{Self, MarginDesk, OpenOrder, MarginPosition},
};

public struct TUSD has drop {}

const ADMIN: address = @0xA;
const LP: address = @0xB;
const USER: address = @0xC;
const KEEPER: address = @0xE;

const ORACLE: address = @0x2;
const MANAGER: address = @0x99;

// 0% interest for clean assertions; 3x max, liquidate <120%, 5% penalty.
fun setup(sc: &mut ts::Scenario, clk: &sui::clock::Clock) {
    lending_pool::create<TUSD>(0, 0, clk, ts::ctx(sc));
    ts::next_tx(sc, ADMIN);
    let pool = ts::take_shared<LendingPool<TUSD>>(sc);
    margin::create_desk<TUSD>(&pool, object::id_from_address(MANAGER), KEEPER, 30_000, 12_000, 500, ts::ctx(sc));
    ts::return_shared(pool);
}

// request_open → fill → close-on-win: the full custody handshake, winner force-paid.
#[test]
fun open_fill_close_winner() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);

    // LP funds the pool
    ts::next_tx(&mut sc, LP);
    let mut pool = ts::take_shared<LendingPool<TUSD>>(&sc);
    let sp = lending_pool::supply(&mut pool, coin::mint_for_testing<TUSD>(1_000_000, ts::ctx(&mut sc)), &clk, ts::ctx(&mut sc));
    ts::return_shared(pool);

    // USER escrows 100k margin at 3x
    ts::next_tx(&mut sc, USER);
    let desk = ts::take_shared<MarginDesk<TUSD>>(&sc);
    margin::request_open(&desk, coin::mint_for_testing<TUSD>(100_000, ts::ctx(&mut sc)), object::id_from_address(ORACLE), 30_000, 0, false, 0, 0, true, &clk, ts::ctx(&mut sc));

    // KEEPER fills: borrows 200k, hands back 300k notional (burned = "minted")
    ts::next_tx(&mut sc, KEEPER);
    let mut pool = ts::take_shared<LendingPool<TUSD>>(&sc);
    let order = ts::take_shared<OpenOrder<TUSD>>(&sc);
    let notional = margin::fill(&desk, &mut pool, order, 300_000, &clk, ts::ctx(&mut sc));
    assert_eq!(notional.value(), 300_000);
    assert_eq!(lending_pool::available_liquidity(&pool), 800_000);
    coin::burn_for_testing(notional);

    // round settles a winner: position redeems 330k. KEEPER closes → repay 200k → 130k to USER.
    ts::next_tx(&mut sc, KEEPER);
    let pos = ts::take_shared<MarginPosition<TUSD>>(&sc);
    let proceeds = coin::mint_for_testing<TUSD>(330_000, ts::ctx(&mut sc));
    margin::close(&desk, &mut pool, pos, proceeds, &clk, ts::ctx(&mut sc));
    assert_eq!(lending_pool::available_liquidity(&pool), 1_000_000); // pool whole

    ts::next_tx(&mut sc, USER);
    let won = ts::take_from_address<Coin<TUSD>>(&sc, USER);
    assert_eq!(won.value(), 130_000); // 100k margin + 30k amplified PnL
    coin::burn_for_testing(won);

    coin::burn_for_testing(lending_pool::withdraw(&mut pool, sp, &clk, ts::ctx(&mut sc)));
    ts::return_shared(pool); ts::return_shared(desk);
    destroy(clk); ts::end(sc);
}

// the showcase: liquidate a binary position mid-round at its live mark.
#[test]
fun liquidate_at_mark() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);

    ts::next_tx(&mut sc, LP);
    let mut pool = ts::take_shared<LendingPool<TUSD>>(&sc);
    let sp = lending_pool::supply(&mut pool, coin::mint_for_testing<TUSD>(1_000_000, ts::ctx(&mut sc)), &clk, ts::ctx(&mut sc));
    ts::return_shared(pool);

    ts::next_tx(&mut sc, USER);
    let desk = ts::take_shared<MarginDesk<TUSD>>(&sc);
    margin::request_open(&desk, coin::mint_for_testing<TUSD>(100_000, ts::ctx(&mut sc)), object::id_from_address(ORACLE), 30_000, 0, false, 0, 0, true, &clk, ts::ctx(&mut sc));

    ts::next_tx(&mut sc, KEEPER);
    let mut pool = ts::take_shared<LendingPool<TUSD>>(&sc);
    let order = ts::take_shared<OpenOrder<TUSD>>(&sc);
    coin::burn_for_testing(margin::fill(&desk, &mut pool, order, 300_000, &clk, ts::ctx(&mut sc)));
    // debt 200k, maintenance 120% → liquidatable below mark 240k.

    // mark falls to 230k mid-round. agent redeems at mark and liquidates.
    ts::next_tx(&mut sc, KEEPER);
    let pos = ts::take_shared<MarginPosition<TUSD>>(&sc);
    assert!(margin::is_liquidatable(&desk, &pool, &pos, 230_000));
    assert!(!margin::is_liquidatable(&desk, &pool, &pos, 250_000));
    let proceeds = coin::mint_for_testing<TUSD>(230_000, ts::ctx(&mut sc));
    let reward = margin::liquidate(&desk, &mut pool, pos, proceeds, &clk, ts::ctx(&mut sc));
    // penalty 5% of 230k = 11_500 to KEEPER; left 218_500 ≥ 200k debt → repay 200k, 18_500 to USER.
    assert_eq!(lending_pool::available_liquidity(&pool), 1_000_000); // pool made whole

    assert_eq!(reward.value(), 11_500);
    coin::burn_for_testing(reward);
    ts::next_tx(&mut sc, USER);
    let owner_left = ts::take_from_address<Coin<TUSD>>(&sc, USER);
    assert_eq!(owner_left.value(), 18_500);
    coin::burn_for_testing(owner_left);

    coin::burn_for_testing(lending_pool::withdraw(&mut pool, sp, &clk, ts::ctx(&mut sc)));
    ts::return_shared(pool); ts::return_shared(desk);
    destroy(clk); ts::end(sc);
}

// a healthy position cannot be liquidated.
#[test, expected_failure(abort_code = yolev::margin::EStillHealthy)]
fun liquidate_rejects_healthy() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);

    ts::next_tx(&mut sc, LP);
    let mut pool = ts::take_shared<LendingPool<TUSD>>(&sc);
    let sp = lending_pool::supply(&mut pool, coin::mint_for_testing<TUSD>(1_000_000, ts::ctx(&mut sc)), &clk, ts::ctx(&mut sc));
    ts::return_shared(pool);

    ts::next_tx(&mut sc, USER);
    let desk = ts::take_shared<MarginDesk<TUSD>>(&sc);
    margin::request_open(&desk, coin::mint_for_testing<TUSD>(100_000, ts::ctx(&mut sc)), object::id_from_address(ORACLE), 30_000, 0, false, 0, 0, true, &clk, ts::ctx(&mut sc));

    ts::next_tx(&mut sc, KEEPER);
    let mut pool = ts::take_shared<LendingPool<TUSD>>(&sc);
    let order = ts::take_shared<OpenOrder<TUSD>>(&sc);
    coin::burn_for_testing(margin::fill(&desk, &mut pool, order, 300_000, &clk, ts::ctx(&mut sc)));

    // mark 250k > 240k threshold → still healthy → liquidate must abort
    ts::next_tx(&mut sc, KEEPER);
    let pos = ts::take_shared<MarginPosition<TUSD>>(&sc);
    let proceeds = coin::mint_for_testing<TUSD>(250_000, ts::ctx(&mut sc));
    coin::burn_for_testing(margin::liquidate(&desk, &mut pool, pos, proceeds, &clk, ts::ctx(&mut sc)));

    coin::burn_for_testing(lending_pool::withdraw(&mut pool, sp, &clk, ts::ctx(&mut sc)));
    ts::return_shared(pool); ts::return_shared(desk);
    destroy(clk); ts::end(sc);
}

// only the agent keeper can fill an order.
#[test, expected_failure(abort_code = yolev::margin::ENotKeeper)]
fun only_keeper_can_fill() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);

    ts::next_tx(&mut sc, LP);
    let mut pool = ts::take_shared<LendingPool<TUSD>>(&sc);
    let sp = lending_pool::supply(&mut pool, coin::mint_for_testing<TUSD>(1_000_000, ts::ctx(&mut sc)), &clk, ts::ctx(&mut sc));
    ts::return_shared(pool);

    ts::next_tx(&mut sc, USER);
    let desk = ts::take_shared<MarginDesk<TUSD>>(&sc);
    margin::request_open(&desk, coin::mint_for_testing<TUSD>(100_000, ts::ctx(&mut sc)), object::id_from_address(ORACLE), 30_000, 0, false, 0, 0, true, &clk, ts::ctx(&mut sc));

    // USER (not the keeper) tries to fill → abort
    ts::next_tx(&mut sc, USER);
    let mut pool = ts::take_shared<LendingPool<TUSD>>(&sc);
    let order = ts::take_shared<OpenOrder<TUSD>>(&sc);
    coin::burn_for_testing(margin::fill(&desk, &mut pool, order, 300_000, &clk, ts::ctx(&mut sc)));

    coin::burn_for_testing(lending_pool::withdraw(&mut pool, sp, &clk, ts::ctx(&mut sc)));
    ts::return_shared(pool); ts::return_shared(desk);
    destroy(clk); ts::end(sc);
}

// trader reclaims escrowed margin if the agent never fills (liveness).
#[test]
fun cancel_reclaims_margin() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);

    ts::next_tx(&mut sc, USER);
    let desk = ts::take_shared<MarginDesk<TUSD>>(&sc);
    margin::request_open(&desk, coin::mint_for_testing<TUSD>(100_000, ts::ctx(&mut sc)), object::id_from_address(ORACLE), 30_000, 0, false, 0, 0, true, &clk, ts::ctx(&mut sc));

    ts::next_tx(&mut sc, USER);
    let order = ts::take_shared<OpenOrder<TUSD>>(&sc);
    let back = margin::cancel(&desk, order, ts::ctx(&mut sc));
    assert_eq!(back.value(), 100_000);
    coin::burn_for_testing(back);

    ts::return_shared(desk);
    destroy(clk); ts::end(sc);
}

// leverage above the desk cap is rejected at request time.
#[test, expected_failure(abort_code = yolev::margin::ELeverageTooHigh)]
fun request_open_caps_leverage() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);

    ts::next_tx(&mut sc, USER);
    let desk = ts::take_shared<MarginDesk<TUSD>>(&sc);
    // 4x > 3x cap → abort
    margin::request_open(&desk, coin::mint_for_testing<TUSD>(100_000, ts::ctx(&mut sc)), object::id_from_address(ORACLE), 40_000, 0, false, 0, 0, true, &clk, ts::ctx(&mut sc));

    ts::return_shared(desk);
    destroy(clk); ts::end(sc);
}
