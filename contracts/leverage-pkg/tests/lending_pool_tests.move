#[test_only]
module yolev::lending_pool_tests;

use std::unit_test::{assert_eq, destroy};
use sui::{
    balance,
    clock,
    coin,
    test_scenario::{Self as ts},
};
use yolev::lending_pool::{Self, LendingPool};

public struct TUSD has drop {}

const ADMIN: address = @0xA;
const LP: address = @0xB;

#[test]
fun supply_borrow_accrue_repay_withdraw() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);

    // pool: 10% base APR, +40% slope at full utilization
    lending_pool::create<TUSD>(1000, 4000, &clk, ts::ctx(&mut sc));
    ts::next_tx(&mut sc, LP);
    let mut pool = ts::take_shared<LendingPool<TUSD>>(&sc);

    // LP supplies 1,000,000
    let c = coin::mint_for_testing<TUSD>(1_000_000, ts::ctx(&mut sc));
    let pos = lending_pool::supply(&mut pool, c, &clk, ts::ctx(&mut sc));
    assert_eq!(lending_pool::available_liquidity(&pool), 1_000_000);
    assert_eq!(lending_pool::shares_of(&pos), 1_000_000);

    // borrow 500,000 → 50% utilization
    let (borrowed, principal) = lending_pool::borrow(&mut pool, 500_000, &clk);
    assert_eq!(lending_pool::available_liquidity(&pool), 500_000);
    assert_eq!(lending_pool::debt_of(&pool, principal), 500_000); // no time elapsed
    assert_eq!(lending_pool::utilization_bps(&pool), 5000);

    // advance ~1 year and accrue: rate = 10% + 40%*0.5 = 30% → debt ~650,000
    clk.set_for_testing(31_536_000_000);
    lending_pool::accrue(&mut pool, &clk);
    let debt = lending_pool::debt_of(&pool, principal);
    assert!(debt > 600_000 && debt < 700_000);

    // repay in full (borrowed 500k + accrued interest)
    let mut pay = borrowed;
    balance::join(&mut pay, coin::mint_for_testing<TUSD>(debt - 500_000, ts::ctx(&mut sc)).into_balance());
    let remainder = lending_pool::repay(&mut pool, pay, principal, &clk);
    assert_eq!(balance::value(&remainder), 0);
    balance::destroy_zero(remainder);
    assert_eq!(lending_pool::total_borrowed(&pool), 0);

    // LP withdraws — earns the interest (> supplied)
    let out = lending_pool::withdraw(&mut pool, pos, &clk, ts::ctx(&mut sc));
    assert!(out.value() > 1_000_000);
    assert_eq!(out.value(), debt + 500_000); // all liquidity is theirs

    coin::burn_for_testing(out);
    ts::return_shared(pool);
    destroy(clk);
    ts::end(sc);
}

#[test]
fun two_lps_share_interest_pro_rata() {
    let mut sc = ts::begin(ADMIN);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    lending_pool::create<TUSD>(2000, 0, &clk, ts::ctx(&mut sc)); // flat 20% APR
    ts::next_tx(&mut sc, LP);
    let mut pool = ts::take_shared<LendingPool<TUSD>>(&sc);

    // LP A supplies 1,000,000
    let posA = lending_pool::supply(&mut pool, coin::mint_for_testing<TUSD>(1_000_000, ts::ctx(&mut sc)), &clk, ts::ctx(&mut sc));
    // borrow 800,000, run a year, repay
    let (b, p) = lending_pool::borrow(&mut pool, 800_000, &clk);
    clk.set_for_testing(31_536_000_000);
    lending_pool::accrue(&mut pool, &clk);
    let owed = lending_pool::debt_of(&pool, p);
    let mut pay = b;
    balance::join(&mut pay, coin::mint_for_testing<TUSD>(owed - 800_000, ts::ctx(&mut sc)).into_balance());
    balance::destroy_zero(lending_pool::repay(&mut pool, pay, p, &clk));

    // Now LP B supplies AFTER interest accrued — gets fewer shares per coin
    let posB = lending_pool::supply(&mut pool, coin::mint_for_testing<TUSD>(1_000_000, ts::ctx(&mut sc)), &clk, ts::ctx(&mut sc));
    assert!(lending_pool::shares_of(&posB) < lending_pool::shares_of(&posA));

    // A is worth more than B (A earned the interest, B just joined)
    let valA = lending_pool::current_value_of(&pool, &posA);
    let valB = lending_pool::current_value_of(&pool, &posB);
    assert!(valA > 1_000_000);
    assert!(valB <= 1_000_001 && valB >= 999_999);

    coin::burn_for_testing(lending_pool::withdraw(&mut pool, posA, &clk, ts::ctx(&mut sc)));
    coin::burn_for_testing(lending_pool::withdraw(&mut pool, posB, &clk, ts::ctx(&mut sc)));
    ts::return_shared(pool);
    destroy(clk);
    ts::end(sc);
}
