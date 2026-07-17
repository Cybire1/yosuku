#[test_only]
module yolev::trading_vault_tests;

use std::unit_test::{assert_eq, destroy};
use sui::{
    clock,
    coin::{Self, Coin},
    object,
    test_scenario::{Self as ts},
};
use yolev::{
    lending_pool::{Self, LendingPool},
    margin::{Self, MarginDesk, OpenOrder},
    trading_vault::{Self, TradingVault},
};

public struct TUSD has drop {}

const ADMIN: address = @0xA;
const USER: address = @0xB;
const AGENT: address = @0xC;
const STRANGER: address = @0xD;

const ORACLE: address = @0x2;
const MANAGER: address = @0x99;

fun mint(sc: &mut ts::Scenario, amount: u64): Coin<TUSD> {
    coin::mint_for_testing<TUSD>(amount, ts::ctx(sc))
}

fun setup(sc: &mut ts::Scenario, clk: &sui::clock::Clock) {
    lending_pool::create<TUSD>(0, 0, clk, ts::ctx(sc));
    ts::next_tx(sc, ADMIN);
    let pool = ts::take_shared<LendingPool<TUSD>>(sc);
    margin::create_desk<TUSD>(&pool, object::id_from_address(MANAGER), AGENT, 30_000, 12_000, 500, ts::ctx(sc));
    ts::return_shared(pool);
    ts::next_tx(sc, ADMIN);
    trading_vault::create<TUSD>(ts::ctx(sc));
}

#[test]
fun deposit_withdraw_and_private_balance() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);

    ts::next_tx(&mut sc, USER);
    let mut v = ts::take_shared<TradingVault<TUSD>>(&sc);
    trading_vault::deposit(&mut v, mint(&mut sc, 500_000), ts::ctx(&mut sc));
    assert_eq!(trading_vault::available_of(&v, USER), 500_000);
    assert_eq!(trading_vault::account_value_of(&v, USER), 500_000);
    assert_eq!(trading_vault::total_liquid(&v), 500_000);

    trading_vault::move_to_private(&mut v, 200_000, ts::ctx(&mut sc));
    assert_eq!(trading_vault::available_of(&v, USER), 300_000);
    assert_eq!(trading_vault::private_of(&v, USER), 200_000);

    let private_out = trading_vault::withdraw_private(&mut v, 50_000, ts::ctx(&mut sc));
    assert_eq!(private_out.value(), 50_000);
    coin::burn_for_testing(private_out);
    assert_eq!(trading_vault::private_of(&v, USER), 150_000);

    let out = trading_vault::withdraw(&mut v, 100_000, ts::ctx(&mut sc));
    assert_eq!(out.value(), 100_000);
    coin::burn_for_testing(out);
    assert_eq!(trading_vault::available_of(&v, USER), 200_000);
    assert_eq!(trading_vault::account_value_of(&v, USER), 350_000);
    assert_eq!(trading_vault::total_liquid(&v), 350_000);

    ts::return_shared(v);
    destroy(clk);
    ts::end(sc);
}

#[test]
fun allocate_and_revoke_agent_budget() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    setup(&mut sc, &clk);

    ts::next_tx(&mut sc, USER);
    let mut v = ts::take_shared<TradingVault<TUSD>>(&sc);
    trading_vault::deposit(&mut v, mint(&mut sc, 500_000), ts::ctx(&mut sc));
    trading_vault::allocate_agent(&mut v, 150_000, AGENT, 100_000, 30_000, 50_000, 60_000, ts::ctx(&mut sc));

    assert_eq!(trading_vault::available_of(&v, USER), 350_000);
    assert_eq!(trading_vault::agent_of(&v, USER), 150_000);
    assert_eq!(trading_vault::policy_agent(&v, USER), AGENT);
    assert!(trading_vault::policy_active(&v, USER));

    trading_vault::revoke_agent(&mut v, ts::ctx(&mut sc));
    assert_eq!(trading_vault::available_of(&v, USER), 500_000);
    assert_eq!(trading_vault::agent_of(&v, USER), 0);
    assert!(!trading_vault::policy_active(&v, USER));

    ts::return_shared(v);
    destroy(clk);
    ts::end(sc);
}

#[test]
fun owner_open_leverage_uses_available_balance() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(1_000);
    setup(&mut sc, &clk);

    ts::next_tx(&mut sc, USER);
    let mut v = ts::take_shared<TradingVault<TUSD>>(&sc);
    let desk = ts::take_shared<MarginDesk<TUSD>>(&sc);
    trading_vault::deposit(&mut v, mint(&mut sc, 300_000), ts::ctx(&mut sc));
    trading_vault::open_leverage(
        &mut v,
        &desk,
        object::id_from_address(ORACLE),
        120_000,
        20_000,
        30_000,
        false,
        100,
        0,
        true,
        &clk,
        ts::ctx(&mut sc),
    );

    assert_eq!(trading_vault::available_of(&v, USER), 180_000);
    assert_eq!(trading_vault::locked_margin_of(&v, USER), 120_000);
    assert_eq!(trading_vault::account_value_of(&v, USER), 300_000);
    assert_eq!(trading_vault::total_liquid(&v), 180_000);
    assert_eq!(trading_vault::total_locked_margin(&v), 120_000);

    ts::return_shared(v);
    ts::return_shared(desk);
    destroy(clk);
    ts::end(sc);
}

#[test]
fun agent_open_leverage_locks_margin_and_return_restores_balance() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(1_000);
    setup(&mut sc, &clk);

    ts::next_tx(&mut sc, USER);
    let mut v = ts::take_shared<TradingVault<TUSD>>(&sc);
    trading_vault::deposit(&mut v, mint(&mut sc, 300_000), ts::ctx(&mut sc));
    trading_vault::allocate_agent(&mut v, 150_000, AGENT, 100_000, 30_000, 50_000, 0, ts::ctx(&mut sc));
    ts::return_shared(v);

    ts::next_tx(&mut sc, AGENT);
    let mut v = ts::take_shared<TradingVault<TUSD>>(&sc);
    let desk = ts::take_shared<MarginDesk<TUSD>>(&sc);
    trading_vault::agent_open_leverage(
        &mut v,
        &desk,
        object::id_from_address(ORACLE),
        USER,
        100_000,
        30_000,
        30_000,
        false,
        100,
        0,
        true,
        &clk,
        ts::ctx(&mut sc),
    );
    assert_eq!(trading_vault::available_of(&v, USER), 150_000);
    assert_eq!(trading_vault::agent_of(&v, USER), 50_000);
    assert_eq!(trading_vault::locked_margin_of(&v, USER), 100_000);
    assert_eq!(trading_vault::account_value_of(&v, USER), 300_000);
    assert_eq!(trading_vault::total_liquid(&v), 200_000);
    assert_eq!(trading_vault::total_locked_margin(&v), 100_000);
    ts::return_shared(v);
    ts::return_shared(desk);

    // User cancels the unfilled order and returns the margin to Trading Balance.
    ts::next_tx(&mut sc, USER);
    let mut v = ts::take_shared<TradingVault<TUSD>>(&sc);
    let desk = ts::take_shared<MarginDesk<TUSD>>(&sc);
    let order = ts::take_shared<OpenOrder<TUSD>>(&sc);
    let returned = margin::cancel(&desk, order, ts::ctx(&mut sc));
    trading_vault::return_locked_for(&mut v, USER, returned);
    assert_eq!(trading_vault::locked_margin_of(&v, USER), 0);
    assert_eq!(trading_vault::available_of(&v, USER), 250_000);
    assert_eq!(trading_vault::agent_of(&v, USER), 50_000);
    assert_eq!(trading_vault::account_value_of(&v, USER), 300_000);
    assert_eq!(trading_vault::total_liquid(&v), 300_000);
    assert_eq!(trading_vault::total_locked_margin(&v), 0);

    ts::return_shared(v);
    ts::return_shared(desk);
    destroy(clk);
    ts::end(sc);
}

#[test]
fun admin_writeoff_clears_lost_locked_margin() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(1_000);
    setup(&mut sc, &clk);

    ts::next_tx(&mut sc, USER);
    let mut v = ts::take_shared<TradingVault<TUSD>>(&sc);
    let desk = ts::take_shared<MarginDesk<TUSD>>(&sc);
    trading_vault::deposit(&mut v, mint(&mut sc, 300_000), ts::ctx(&mut sc));
    trading_vault::open_leverage(
        &mut v,
        &desk,
        object::id_from_address(ORACLE),
        120_000,
        20_000,
        30_000,
        false,
        100,
        0,
        true,
        &clk,
        ts::ctx(&mut sc),
    );
    ts::return_shared(v);
    ts::return_shared(desk);

    ts::next_tx(&mut sc, ADMIN);
    let mut v = ts::take_shared<TradingVault<TUSD>>(&sc);
    trading_vault::write_off_locked_for(&mut v, USER, 120_000, ts::ctx(&mut sc));
    assert_eq!(trading_vault::locked_margin_of(&v, USER), 0);
    assert_eq!(trading_vault::available_of(&v, USER), 180_000);
    assert_eq!(trading_vault::account_value_of(&v, USER), 180_000);
    assert_eq!(trading_vault::total_liquid(&v), 180_000);
    assert_eq!(trading_vault::total_locked_margin(&v), 0);

    ts::return_shared(v);
    destroy(clk);
    ts::end(sc);
}

#[test, expected_failure(abort_code = yolev::trading_vault::ENotPolicyAgent)]
fun wrong_agent_cannot_spend_budget() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(1_000);
    setup(&mut sc, &clk);

    ts::next_tx(&mut sc, USER);
    let mut v = ts::take_shared<TradingVault<TUSD>>(&sc);
    trading_vault::deposit(&mut v, mint(&mut sc, 300_000), ts::ctx(&mut sc));
    trading_vault::allocate_agent(&mut v, 150_000, AGENT, 100_000, 30_000, 50_000, 0, ts::ctx(&mut sc));
    ts::return_shared(v);

    ts::next_tx(&mut sc, STRANGER);
    let mut v = ts::take_shared<TradingVault<TUSD>>(&sc);
    let desk = ts::take_shared<MarginDesk<TUSD>>(&sc);
    trading_vault::agent_open_leverage(
        &mut v,
        &desk,
        object::id_from_address(ORACLE),
        USER,
        100_000,
        30_000,
        30_000,
        false,
        100,
        0,
        true,
        &clk,
        ts::ctx(&mut sc),
    );
    ts::return_shared(v);
    ts::return_shared(desk);
    destroy(clk);
    ts::end(sc);
}

#[test, expected_failure(abort_code = yolev::trading_vault::EOverTradeCap)]
fun agent_policy_caps_trade_size() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(1_000);
    setup(&mut sc, &clk);

    ts::next_tx(&mut sc, USER);
    let mut v = ts::take_shared<TradingVault<TUSD>>(&sc);
    trading_vault::deposit(&mut v, mint(&mut sc, 300_000), ts::ctx(&mut sc));
    trading_vault::allocate_agent(&mut v, 150_000, AGENT, 90_000, 30_000, 50_000, 0, ts::ctx(&mut sc));
    ts::return_shared(v);

    ts::next_tx(&mut sc, AGENT);
    let mut v = ts::take_shared<TradingVault<TUSD>>(&sc);
    let desk = ts::take_shared<MarginDesk<TUSD>>(&sc);
    trading_vault::agent_open_leverage(
        &mut v,
        &desk,
        object::id_from_address(ORACLE),
        USER,
        100_000,
        30_000,
        30_000,
        false,
        100,
        0,
        true,
        &clk,
        ts::ctx(&mut sc),
    );
    ts::return_shared(v);
    ts::return_shared(desk);
    destroy(clk);
    ts::end(sc);
}
