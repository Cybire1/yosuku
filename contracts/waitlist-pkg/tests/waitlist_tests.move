#[test_only]
module waitlist::waitlist_tests;

use std::unit_test::{assert_eq, destroy};
use sui::{
    clock,
    test_scenario::{Self as ts},
};
use waitlist::waitlist::{Self, Waitlist};

const A: address = @0xA;
const B: address = @0xB;
const ZERO: address = @0x0;

#[test]
fun join_increments_and_positions() {
    let mut sc = ts::begin(A);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    // publish runs init → Waitlist is shared
    waitlist::init_for_testing(ts::ctx(&mut sc));

    ts::next_tx(&mut sc, A);
    let mut w = ts::take_shared<Waitlist>(&sc);
    waitlist::join(&mut w, ZERO, &clk, ts::ctx(&mut sc));
    assert_eq!(waitlist::count(&w), 1);
    assert!(waitlist::has_joined(&w, A));
    assert_eq!(waitlist::position_of(&w, A), 1);

    // a referred second joiner takes slot 2
    ts::next_tx(&mut sc, B);
    waitlist::join(&mut w, A, &clk, ts::ctx(&mut sc));
    assert_eq!(waitlist::count(&w), 2);
    assert_eq!(waitlist::position_of(&w, B), 2);

    ts::return_shared(w);
    destroy(clk); ts::end(sc);
}

#[test, expected_failure(abort_code = 1)] // EAlreadyJoined
fun double_join_aborts() {
    let mut sc = ts::begin(A);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(0);
    waitlist::init_for_testing(ts::ctx(&mut sc));

    ts::next_tx(&mut sc, A);
    let mut w = ts::take_shared<Waitlist>(&sc);
    waitlist::join(&mut w, ZERO, &clk, ts::ctx(&mut sc));
    waitlist::join(&mut w, ZERO, &clk, ts::ctx(&mut sc)); // same wallet again → abort

    ts::return_shared(w);
    destroy(clk); ts::end(sc);
}
