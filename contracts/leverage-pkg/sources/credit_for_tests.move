#[test_only]
/// Proves `social_vault::credit_for` credits the NAMED user (not the caller) — so the relay can
/// fund a tweet-onboarded account's vault without ever holding/using that account's key, and only
/// the named user can withdraw it.
module yolev::credit_for_tests;

use sui::test_scenario as ts;
use sui::coin;
use sui::sui::SUI;
use yolev::social_vault::{Self, Vault};

#[test]
fun credit_for_credits_target_and_only_target_can_withdraw() {
    let admin = @0xA1; let agent = @0xA9; let user = @0xB2;
    let mut sc = ts::begin(admin);
    social_vault::create_vault<SUI>(agent, 5_000_000, ts::ctx(&mut sc));
    ts::next_tx(&mut sc, admin);
    let mut v = ts::take_shared<Vault<SUI>>(&sc);

    // admin/relay funds USER's vault with 2 — the coin is the caller's, the credit is the user's.
    let c = coin::mint_for_testing<SUI>(2_000_000, ts::ctx(&mut sc));
    social_vault::credit_for<SUI>(&mut v, user, c);

    // the USER (not the funder) can withdraw exactly that balance → it was credited to them.
    ts::next_tx(&mut sc, user);
    let out = social_vault::withdraw<SUI>(&mut v, 2_000_000, ts::ctx(&mut sc));
    assert!(coin::value(&out) == 2_000_000, 0);
    coin::burn_for_testing(out);

    ts::return_shared(v);
    ts::end(sc);
}

#[test]
#[expected_failure]
fun funder_cannot_withdraw_what_it_credited() {
    let admin = @0xA1; let agent = @0xA9; let user = @0xB2;
    let mut sc = ts::begin(admin);
    social_vault::create_vault<SUI>(agent, 5_000_000, ts::ctx(&mut sc));
    ts::next_tx(&mut sc, admin);
    let mut v = ts::take_shared<Vault<SUI>>(&sc);
    let c = coin::mint_for_testing<SUI>(2_000_000, ts::ctx(&mut sc));
    social_vault::credit_for<SUI>(&mut v, user, c);
    // the admin/funder has no account of its own → withdraw aborts ENoAccount (no divert path).
    ts::next_tx(&mut sc, admin);
    let out = social_vault::withdraw<SUI>(&mut v, 2_000_000, ts::ctx(&mut sc));
    coin::burn_for_testing(out);
    ts::return_shared(v);
    ts::end(sc);
}
