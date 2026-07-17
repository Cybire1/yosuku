#[test_only]
// Test-only lint: supplier positions are intentionally parked on test addresses.
#[allow(lint(self_transfer))]
module yolev::parlay_tests;

use std::unit_test::{assert_eq, destroy};
use sui::{
    clock,
    coin::{Self, Coin},
    test_scenario::{Self as ts},
};
use yolev::parlay::{Self, ParlayReserve, Parlay};
use deepbook_predict::{
    oracle::{Self, OracleSVI},
    oracle_helper,
};

public struct TUSD has drop {}

const ADMIN: address = @0xA;
const LP: address = @0xB;
const USER: address = @0xC;
const KEEPER: address = @0xE;

// 1e9 strike scale, identical to oracle::settlement_price.
const STRIKE: u64 = 100_000_000_000; // BTC strike at 100 (×1e9)
const ABOVE: u64 = 101_000_000_000; // sp > strike → UP-win
const BELOW: u64 = 99_000_000_000; //  sp < strike → DOWN-win

const MAX_PAYOUT: u64 = 10_000_000; // 10 DUSDC
// 3 legs @ prob 0.5: combined = 0.5^3 = 0.125 → 1250 bps; margin 1200 bps.
// fair       = ceil(10_000_000 * 1250  / 10000) = 1_250_000
// floor_stake= ceil( 1_250_000 * 11200 / 10000) = 1_400_000
const FAIR_STAKE: u64 = 1_400_000;
const HOUSE_LOCKED: u64 = 8_600_000; // MAX_PAYOUT - FAIR_STAKE

// keeper, margin 1200, exposure 6000, payout cap 50 DUSDC, oracle cap 50 DUSDC,
// max 3 legs, min combined 50 bps, correlation 4000 bps, grace 60s.
fun setup(sc: &mut ts::Scenario) {
    parlay::create<TUSD>(KEEPER, 1200, 6_000, 50_000_000, 50_000_000, 3, 50, 4_000, 60_000, ts::ctx(sc));
}

fun mint(sc: &mut ts::Scenario, amt: u64): Coin<TUSD> {
    coin::mint_for_testing<TUSD>(amt, ts::ctx(sc))
}

fun supply_liquidity(sc: &mut ts::Scenario, amt: u64) {
    ts::next_tx(sc, LP);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(sc);
    let sp = parlay::supply(&mut r, mint(sc, amt), ts::ctx(sc));
    transfer::public_transfer(sp, LP);
    ts::return_shared(r);
}

// Build N genuine settled OracleSVI objects, each frozen at `prices[i]`. Returns
// the oracles (held by the test) and their REAL object ids (used as leg oracle_ids
// so resolve_leg's `object::id(o) == leg.oracle_id` check passes by construction).
fun make_oracles(sc: &mut ts::Scenario, prices: vector<u64>): (vector<OracleSVI>, vector<ID>) {
    let mut oracles = vector<OracleSVI>[];
    let mut ids = vector<ID>[];
    let n = prices.length();
    n.do!(|i| {
        let o = oracle_helper::create_settled_oracle(prices[i], 1_000_000, ts::ctx(sc));
        ids.push_back(oracle::id(&o));
        oracles.push_back(o);
    });
    (oracles, ids)
}

// Open a 3-leg parlay (all UP) against the given oracle ids.
fun open_three(sc: &mut ts::Scenario, stake: u64, ids: vector<ID>) {
    ts::next_tx(sc, USER);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(sc);
    let clk = clock::create_for_testing(ts::ctx(sc));
    parlay::open_parlay<TUSD>(
        &mut r,
        mint(sc, stake),
        ids,
        vector[1000, 2000, 3000],
        vector[STRIKE, STRIKE, STRIKE],
        vector[true, true, true],
        vector[5000, 5000, 5000],
        MAX_PAYOUT,
        &clk,
        ts::ctx(sc),
    );
    destroy(clk);
    ts::return_shared(r);
}

// Crank one leg against its matching oracle object.
fun resolve(sc: &mut ts::Scenario, leg_idx: u64, oracle: &OracleSVI) {
    ts::next_tx(sc, KEEPER);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(sc);
    let mut p = ts::take_shared<Parlay<TUSD>>(sc);
    let clk = clock::create_for_testing(ts::ctx(sc));
    parlay::resolve_leg<TUSD>(&mut r, &mut p, oracle, leg_idx, &clk, ts::ctx(sc));
    destroy(clk);
    ts::return_shared(p);
    ts::return_shared(r);
}

fun destroy_oracles(oracles: vector<OracleSVI>) {
    oracles.destroy!(|oracle| destroy(oracle));
}

// ─── pricing math ───

#[test]
fun pricing_floor_is_exact() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    supply_liquidity(&mut sc, 20_000_000);

    let ids = vector[
        object::id_from_address(@0x111),
        object::id_from_address(@0x222),
        object::id_from_address(@0x333),
    ];
    open_three(&mut sc, FAIR_STAKE, ids);

    ts::next_tx(&mut sc, USER);
    let p = ts::take_shared<Parlay<TUSD>>(&sc);
    assert_eq!(parlay::parlay_status(&p), parlay::st_live());
    assert_eq!(parlay::parlay_stake(&p), FAIR_STAKE);
    assert_eq!(parlay::parlay_max_payout(&p), MAX_PAYOUT);
    // escrow holds the FULL max_payout (stake + house_locked) while live.
    assert_eq!(parlay::parlay_escrow_value(&p), MAX_PAYOUT);
    // combined = 0.5^3 = 0.125 → 1250 bps, no surcharge (distinct oracles).
    assert_eq!(parlay::parlay_combined_prob_bps(&p), 1250);
    assert_eq!(parlay::parlay_n_legs(&p), 3);
    ts::return_shared(p);

    ts::next_tx(&mut sc, USER);
    let r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    assert_eq!(parlay::locked(&r), HOUSE_LOCKED);
    assert_eq!(parlay::available_liquidity(&r), 20_000_000 - HOUSE_LOCKED);
    // tv = liquid + locked = supplied (stake sits in escrow, house counted in locked).
    assert_eq!(parlay::total_value(&r), 20_000_000);
    ts::return_shared(r);

    ts::end(sc);
}

#[test, expected_failure(abort_code = yolev::parlay::EUnderpriced)]
fun stake_below_floor_aborts() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    supply_liquidity(&mut sc, 20_000_000);
    let ids = vector[
        object::id_from_address(@0x111),
        object::id_from_address(@0x222),
        object::id_from_address(@0x333),
    ];
    open_three(&mut sc, FAIR_STAKE - 1, ids); // one base unit under the floor

    abort
}

#[test]
fun correlation_surcharge_raises_floor() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    supply_liquidity(&mut sc, 20_000_000);

    // Two legs share the SAME oracle (bell streak). Π prob = 1250, but
    // λ·min = 4000*5000/10000 = 2000 bps dominates → surcharged to 2000.
    // fair = ceil(10_000_000 * 2000/10000) = 2_000_000;
    // floor= ceil( 2_000_000 * 11200/10000) = 2_240_000.
    let shared = object::id_from_address(@0xAAA);
    let other = object::id_from_address(@0xBBB);
    ts::next_tx(&mut sc, USER);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let clk = clock::create_for_testing(ts::ctx(&mut sc));
    parlay::open_parlay<TUSD>(
        &mut r,
        mint(&mut sc, 2_240_000),
        vector[shared, shared, other],
        vector[1000, 2000, 3000],
        vector[STRIKE, STRIKE, STRIKE],
        vector[true, true, true],
        vector[5000, 5000, 5000],
        MAX_PAYOUT,
        &clk,
        ts::ctx(&mut sc),
    );
    destroy(clk);
    ts::return_shared(r);

    ts::next_tx(&mut sc, USER);
    let p = ts::take_shared<Parlay<TUSD>>(&sc);
    assert_eq!(parlay::parlay_combined_prob_bps(&p), 2000);
    assert_eq!(parlay::parlay_stake(&p), 2_240_000);
    ts::return_shared(p);

    ts::end(sc);
}

#[test, expected_failure(abort_code = yolev::parlay::EUnderpriced)]
fun correlation_floor_rejects_uncorrected_stake() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    supply_liquidity(&mut sc, 20_000_000);

    // Naive Π-prob floor is 1_400_000, but surcharge lifts it to 2_240_000. Paying
    // the naive stake on a correlated parlay → EUnderpriced.
    let shared = object::id_from_address(@0xAAA);
    let other = object::id_from_address(@0xBBB);
    ts::next_tx(&mut sc, USER);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let clk = clock::create_for_testing(ts::ctx(&mut sc));
    parlay::open_parlay<TUSD>(
        &mut r,
        mint(&mut sc, FAIR_STAKE),
        vector[shared, shared, other],
        vector[1000, 2000, 3000],
        vector[STRIKE, STRIKE, STRIKE],
        vector[true, true, true],
        vector[5000, 5000, 5000],
        MAX_PAYOUT,
        &clk,
        ts::ctx(&mut sc),
    );

    abort
}

// ─── exposure / liquidity / cap guards ───

#[test, expected_failure(abort_code = yolev::parlay::EExposureCap)]
fun exposure_cap_enforced_at_open() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    // tv = 9_000_000, exposure cap 60% → max locked 5_400_000. house_locked 8.6M
    // > 5.4M, and liquidity 9M >= 8.6M so the EXPOSURE cap fires (not liquidity).
    supply_liquidity(&mut sc, 9_000_000);
    let ids = vector[
        object::id_from_address(@0x111),
        object::id_from_address(@0x222),
        object::id_from_address(@0x333),
    ];
    open_three(&mut sc, FAIR_STAKE, ids);

    abort
}

// Locked (contingent) capital isn't withdrawable: a supplier can't pull funds the
// reserve has fronted into a live parlay's escrow. (In the escrow model the open
// path's exposure cap already implies `liquid >= house_locked`, so the reachable
// EInsufficientLiquidity path is withdraw, not open.)
#[test, expected_failure(abort_code = yolev::parlay::EInsufficientLiquidity)]
fun withdraw_locked_capital_aborts() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);

    // Sole supplier puts in 20M and keeps the SupplyPosition.
    ts::next_tx(&mut sc, LP);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let sp = parlay::supply(&mut r, mint(&mut sc, 20_000_000), ts::ctx(&mut sc));
    ts::return_shared(r);

    // Open a parlay → 8.6M fronted into escrow, only 11.4M liquid remains.
    let ids = vector[
        object::id_from_address(@0x111),
        object::id_from_address(@0x222),
        object::id_from_address(@0x333),
    ];
    open_three(&mut sc, FAIR_STAKE, ids);

    // The LP's position is worth tv = 20M but liquid is 11.4M → EInsufficientLiquidity.
    ts::next_tx(&mut sc, LP);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let back = parlay::withdraw(&mut r, sp, ts::ctx(&mut sc));
    coin::burn_for_testing(back);

    abort
}

#[test, expected_failure(abort_code = yolev::parlay::EOracleCap)]
fun per_oracle_subcap_enforced() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    // Stake 2.24M on a 10M payout → house_locked 7_760_000. Tighten the per-oracle
    // cap to 7M; the shared oracle's 7.76M liability exceeds it even though
    // aggregate exposure/liquidity are fine.
    ts::next_tx(&mut sc, ADMIN);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    parlay::set_params<TUSD>(&mut r, 1200, 10_000, 50_000_000, 7_000_000, 3, 50, 4_000, 60_000, ts::ctx(&mut sc));
    ts::return_shared(r);
    supply_liquidity(&mut sc, 20_000_000);

    let shared = object::id_from_address(@0xAAA);
    let other = object::id_from_address(@0xBBB);
    ts::next_tx(&mut sc, USER);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let clk = clock::create_for_testing(ts::ctx(&mut sc));
    parlay::open_parlay<TUSD>(
        &mut r,
        mint(&mut sc, 2_240_000),
        vector[shared, shared, other],
        vector[1000, 2000, 3000],
        vector[STRIKE, STRIKE, STRIKE],
        vector[true, true, true],
        vector[5000, 5000, 5000],
        MAX_PAYOUT,
        &clk,
        ts::ctx(&mut sc),
    );

    abort
}

#[test, expected_failure(abort_code = yolev::parlay::EPayoutCap)]
fun payout_cap_enforced() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    supply_liquidity(&mut sc, 200_000_000);
    ts::next_tx(&mut sc, USER);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let clk = clock::create_for_testing(ts::ctx(&mut sc));
    // payout 60 DUSDC > 50 DUSDC cap → EPayoutCap.
    parlay::open_parlay<TUSD>(
        &mut r,
        mint(&mut sc, 20_000_000),
        vector[object::id_from_address(@0x111), object::id_from_address(@0x222)],
        vector[1000, 2000],
        vector[STRIKE, STRIKE],
        vector[true, true],
        vector[7000, 7000],
        60_000_000,
        &clk,
        ts::ctx(&mut sc),
    );

    abort
}

#[test, expected_failure(abort_code = yolev::parlay::EBadLegCount)]
fun single_leg_rejected() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    supply_liquidity(&mut sc, 20_000_000);
    ts::next_tx(&mut sc, USER);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let clk = clock::create_for_testing(ts::ctx(&mut sc));
    parlay::open_parlay<TUSD>(
        &mut r,
        mint(&mut sc, 6_000_000),
        vector[object::id_from_address(@0x111)],
        vector[1000],
        vector[STRIKE],
        vector[true],
        vector[5000],
        MAX_PAYOUT,
        &clk,
        ts::ctx(&mut sc),
    );

    abort
}

#[test, expected_failure(abort_code = yolev::parlay::ELenMismatch)]
fun mismatched_vectors_rejected() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    supply_liquidity(&mut sc, 20_000_000);
    ts::next_tx(&mut sc, USER);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let clk = clock::create_for_testing(ts::ctx(&mut sc));
    // strikes has 1 element vs 2 oracle ids → ELenMismatch.
    parlay::open_parlay<TUSD>(
        &mut r,
        mint(&mut sc, 6_000_000),
        vector[object::id_from_address(@0x111), object::id_from_address(@0x222)],
        vector[1000, 2000],
        vector[STRIKE],
        vector[true, true],
        vector[5000, 5000],
        MAX_PAYOUT,
        &clk,
        ts::ctx(&mut sc),
    );

    abort
}

// ─── resolution: all legs win → claim pays max_payout ───

#[test]
fun all_legs_win_claim_pays_max_payout() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    supply_liquidity(&mut sc, 20_000_000);

    // three distinct oracles, all settle ABOVE strike → every UP leg wins.
    let (oracles, ids) = make_oracles(&mut sc, vector[ABOVE, ABOVE, ABOVE]);
    open_three(&mut sc, FAIR_STAKE, ids);

    resolve(&mut sc, 0, &oracles[0]);
    ts::next_tx(&mut sc, KEEPER);
    let p = ts::take_shared<Parlay<TUSD>>(&sc);
    assert_eq!(parlay::leg_status(&p, 0), parlay::leg_won());
    assert_eq!(parlay::parlay_won_count(&p), 1);
    assert_eq!(parlay::parlay_status(&p), parlay::st_live());
    ts::return_shared(p);

    resolve(&mut sc, 1, &oracles[1]);
    resolve(&mut sc, 2, &oracles[2]);

    ts::next_tx(&mut sc, KEEPER);
    let p = ts::take_shared<Parlay<TUSD>>(&sc);
    assert_eq!(parlay::parlay_won_count(&p), 3);
    assert_eq!(parlay::parlay_status(&p), parlay::st_won());
    ts::return_shared(p);

    // CLAIM (permissionless) → force-pays the OWNER the full max_payout.
    ts::next_tx(&mut sc, KEEPER);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let p = ts::take_shared<Parlay<TUSD>>(&sc);
    parlay::claim<TUSD>(&mut r, p, ts::ctx(&mut sc));
    // liability released; reserve paid 10M jackpot but kept the 1.4M stake that was
    // in escrow. started 20M → liquid 20M - house_locked = 11.4M.
    assert_eq!(parlay::locked(&r), 0);
    assert_eq!(parlay::available_liquidity(&r), 20_000_000 - HOUSE_LOCKED);
    assert_eq!(parlay::total_value(&r), 20_000_000 - HOUSE_LOCKED);
    ts::return_shared(r);

    // OWNER (USER) — not the keeper — received exactly max_payout.
    ts::next_tx(&mut sc, USER);
    let won = ts::take_from_sender<Coin<TUSD>>(&sc);
    assert_eq!(won.value(), MAX_PAYOUT);
    coin::burn_for_testing(won);

    destroy_oracles(oracles);
    ts::end(sc);
}

// ─── resolution: first losing leg kills the parlay; reserve keeps the stake ───

#[test]
fun first_loss_kills_parlay_reserve_keeps_stake() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    supply_liquidity(&mut sc, 20_000_000);

    // leg 0's oracle settles BELOW strike (UP bet loses); legs 1,2 would have won.
    let (oracles, ids) = make_oracles(&mut sc, vector[BELOW, ABOVE, ABOVE]);
    open_three(&mut sc, FAIR_STAKE, ids);

    // Crank ONLY bell t (leg 0) → it loses → parlay DEAD before later bells consulted.
    resolve(&mut sc, 0, &oracles[0]);

    ts::next_tx(&mut sc, KEEPER);
    let p = ts::take_shared<Parlay<TUSD>>(&sc);
    assert_eq!(parlay::leg_status(&p, 0), parlay::leg_lost());
    assert_eq!(parlay::parlay_status(&p), parlay::st_lost());
    // later legs untouched — still pending; no later bell ever consulted.
    assert_eq!(parlay::leg_status(&p, 1), parlay::leg_pending());
    assert_eq!(parlay::leg_status(&p, 2), parlay::leg_pending());
    assert_eq!(parlay::parlay_escrow_value(&p), 0); // escrow swept out
    ts::return_shared(p);

    // Whole escrow (max_payout 10M) swept back to reserve; the opener's 1.4M stake
    // is now the reserve's. liquid = 20M - 8.6M fronted + 10M swept = 21.4M; zero
    // contingent liability; oracle sub-cap released.
    ts::next_tx(&mut sc, KEEPER);
    let r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    assert_eq!(parlay::locked(&r), 0);
    assert_eq!(parlay::available_liquidity(&r), 20_000_000 + FAIR_STAKE);
    assert_eq!(parlay::total_value(&r), 20_000_000 + FAIR_STAKE);
    assert_eq!(parlay::oracle_locked(&r, ids[0]), 0);
    ts::return_shared(r);

    // sweep the dead husk (permissionless).
    ts::next_tx(&mut sc, USER);
    let r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let p = ts::take_shared<Parlay<TUSD>>(&sc);
    parlay::sweep<TUSD>(&r, p);
    ts::return_shared(r);

    destroy_oracles(oracles);
    ts::end(sc);
}

// At-the-money settles as a DOWN win: an UP leg with settlement == strike LOSES.
#[test]
fun atm_settles_as_down_win() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    supply_liquidity(&mut sc, 20_000_000);

    let (oracles, ids) = make_oracles(&mut sc, vector[STRIKE, ABOVE, ABOVE]);
    open_three(&mut sc, FAIR_STAKE, ids);

    // leg 0 is UP; settlement_price == strike → up_wins=false → leg LOSES.
    resolve(&mut sc, 0, &oracles[0]);

    ts::next_tx(&mut sc, KEEPER);
    let p = ts::take_shared<Parlay<TUSD>>(&sc);
    assert_eq!(parlay::leg_status(&p, 0), parlay::leg_lost());
    assert_eq!(parlay::parlay_status(&p), parlay::st_lost());
    ts::return_shared(p);

    destroy_oracles(oracles);
    ts::end(sc);
}

// A DOWN leg wins at ATM (the mirror of the rule above).
#[test]
fun atm_down_leg_wins() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    supply_liquidity(&mut sc, 20_000_000);

    let o0 = oracle_helper::create_settled_oracle(STRIKE, 1_000_000, ts::ctx(&mut sc));
    let o1 = oracle_helper::create_settled_oracle(ABOVE, 1_000_000, ts::ctx(&mut sc));
    let id0 = oracle::id(&o0);
    let id1 = oracle::id(&o1);

    ts::next_tx(&mut sc, USER);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let clk = clock::create_for_testing(ts::ctx(&mut sc));
    // leg 0 is DOWN, leg 1 is UP.
    parlay::open_parlay<TUSD>(
        &mut r,
        mint(&mut sc, FAIR_STAKE),
        vector[id0, id1],
        vector[1000, 2000],
        vector[STRIKE, STRIKE],
        vector[false, true],
        vector[5000, 5000],
        4_000_000, // payout small enough that 0.25 combined * 1.12 margin floor passes
        &clk,
        ts::ctx(&mut sc),
    );
    destroy(clk);
    ts::return_shared(r);

    // leg 0 DOWN at ATM → !up_wins = true → WIN.
    resolve(&mut sc, 0, &o0);
    ts::next_tx(&mut sc, KEEPER);
    let p = ts::take_shared<Parlay<TUSD>>(&sc);
    assert_eq!(parlay::leg_status(&p, 0), parlay::leg_won());
    assert_eq!(parlay::parlay_status(&p), parlay::st_live());
    ts::return_shared(p);

    destroy(o0);
    destroy(o1);
    ts::end(sc);
}

// resolve_leg is idempotent — re-cranking a resolved leg / dead parlay no-ops.
#[test]
fun resolve_is_idempotent() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    supply_liquidity(&mut sc, 20_000_000);

    let (oracles, ids) = make_oracles(&mut sc, vector[BELOW, ABOVE, ABOVE]);
    open_three(&mut sc, FAIR_STAKE, ids);

    resolve(&mut sc, 0, &oracles[0]); // kills the parlay
    // crank the SAME leg again, and a different leg, on the dead parlay — both no-op.
    resolve(&mut sc, 0, &oracles[0]);
    resolve(&mut sc, 1, &oracles[1]);

    ts::next_tx(&mut sc, KEEPER);
    let r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let p = ts::take_shared<Parlay<TUSD>>(&sc);
    assert_eq!(parlay::parlay_status(&p), parlay::st_lost());
    // accounting released exactly once: liquid = 20M - 8.6M + 10M swept = 21.4M.
    assert_eq!(parlay::locked(&r), 0);
    assert_eq!(parlay::available_liquidity(&r), 20_000_000 + FAIR_STAKE);
    ts::return_shared(p);
    ts::return_shared(r);

    destroy_oracles(oracles);
    ts::end(sc);
}

#[test, expected_failure(abort_code = yolev::parlay::EWrongOracle)]
fun resolve_with_wrong_oracle_aborts() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    supply_liquidity(&mut sc, 20_000_000);

    let (oracles, ids) = make_oracles(&mut sc, vector[ABOVE, ABOVE, ABOVE]);
    open_three(&mut sc, FAIR_STAKE, ids);

    // Pass oracle[1] for leg 0 → object id mismatch → EWrongOracle.
    ts::next_tx(&mut sc, KEEPER);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let mut p = ts::take_shared<Parlay<TUSD>>(&sc);
    let clk = clock::create_for_testing(ts::ctx(&mut sc));
    parlay::resolve_leg<TUSD>(&mut r, &mut p, &oracles[1], 0, &clk, ts::ctx(&mut sc));

    abort
}

#[test, expected_failure(abort_code = yolev::parlay::EOracleNotSettled)]
fun resolve_unsettled_oracle_aborts() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    supply_liquidity(&mut sc, 20_000_000);

    // an UNSETTLED oracle (no settlement_price).
    let (unsettled, clk0) = oracle_helper::create_simple_oracle(0, 0, 1_000_000, 0, ts::ctx(&mut sc));
    destroy(clk0);
    let uid = oracle::id(&unsettled);

    ts::next_tx(&mut sc, USER);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let clk = clock::create_for_testing(ts::ctx(&mut sc));
    parlay::open_parlay<TUSD>(
        &mut r,
        mint(&mut sc, FAIR_STAKE),
        vector[uid, object::id_from_address(@0x222), object::id_from_address(@0x333)],
        vector[1000, 2000, 3000],
        vector[STRIKE, STRIKE, STRIKE],
        vector[true, true, true],
        vector[5000, 5000, 5000],
        MAX_PAYOUT,
        &clk,
        ts::ctx(&mut sc),
    );
    destroy(clk);
    ts::return_shared(r);

    ts::next_tx(&mut sc, KEEPER);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let mut p = ts::take_shared<Parlay<TUSD>>(&sc);
    let clk = clock::create_for_testing(ts::ctx(&mut sc));
    // never settled → EOracleNotSettled.
    parlay::resolve_leg<TUSD>(&mut r, &mut p, &unsettled, 0, &clk, ts::ctx(&mut sc));

    abort
}

#[test, expected_failure(abort_code = yolev::parlay::ENotWon)]
fun claim_before_all_won_aborts() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    supply_liquidity(&mut sc, 20_000_000);

    let (oracles, ids) = make_oracles(&mut sc, vector[ABOVE, ABOVE, ABOVE]);
    open_three(&mut sc, FAIR_STAKE, ids);

    resolve(&mut sc, 0, &oracles[0]); // only one leg won — not claimable.

    ts::next_tx(&mut sc, USER);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let p = ts::take_shared<Parlay<TUSD>>(&sc);
    parlay::claim<TUSD>(&mut r, p, ts::ctx(&mut sc));

    abort
}

// ─── admin_void: stuck/never-settling oracle refunds stake to owner ───

#[test]
fun admin_void_refunds_stake() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    supply_liquidity(&mut sc, 20_000_000);

    // legs expire at 1000 ms; grace 60_000 ms.
    let ids = vector[
        object::id_from_address(@0x111),
        object::id_from_address(@0x222),
        object::id_from_address(@0x333),
    ];
    ts::next_tx(&mut sc, USER);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let clk = clock::create_for_testing(ts::ctx(&mut sc));
    parlay::open_parlay<TUSD>(
        &mut r,
        mint(&mut sc, FAIR_STAKE),
        ids,
        vector[1000, 1000, 1000],
        vector[STRIKE, STRIKE, STRIKE],
        vector[true, true, true],
        vector[5000, 5000, 5000],
        MAX_PAYOUT,
        &clk,
        ts::ctx(&mut sc),
    );
    destroy(clk);
    ts::return_shared(r);

    // admin voids after last_expiry + grace.
    ts::next_tx(&mut sc, ADMIN);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let p = ts::take_shared<Parlay<TUSD>>(&sc);
    let mut clk = clock::create_for_testing(ts::ctx(&mut sc));
    clk.set_for_testing(1000 + 60_000 + 1);
    parlay::admin_void<TUSD>(&mut r, p, &clk, ts::ctx(&mut sc));
    destroy(clk);
    // house_locked returned, liability cleared.
    assert_eq!(parlay::locked(&r), 0);
    assert_eq!(parlay::available_liquidity(&r), 20_000_000);
    ts::return_shared(r);

    // owner got the stake back (a VOID, not a loss).
    ts::next_tx(&mut sc, USER);
    let refund = ts::take_from_sender<Coin<TUSD>>(&sc);
    assert_eq!(refund.value(), FAIR_STAKE);
    coin::burn_for_testing(refund);

    ts::end(sc);
}

#[test, expected_failure(abort_code = yolev::parlay::ENotExpired)]
fun admin_void_before_grace_aborts() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    supply_liquidity(&mut sc, 20_000_000);
    let ids = vector[
        object::id_from_address(@0x111),
        object::id_from_address(@0x222),
        object::id_from_address(@0x333),
    ];
    open_three(&mut sc, FAIR_STAKE, ids);

    ts::next_tx(&mut sc, ADMIN);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let p = ts::take_shared<Parlay<TUSD>>(&sc);
    let clk = clock::create_for_testing(ts::ctx(&mut sc)); // t=0, before grace
    parlay::admin_void<TUSD>(&mut r, p, &clk, ts::ctx(&mut sc));

    abort
}

// ─── supplier accounting ───

#[test]
fun supply_then_withdraw_roundtrips() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);

    ts::next_tx(&mut sc, LP);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let sp = parlay::supply(&mut r, mint(&mut sc, 7_000_000), ts::ctx(&mut sc));
    assert_eq!(parlay::share_value(&r, &sp), 7_000_000); // first supplier: shares==amount
    let back = parlay::withdraw(&mut r, sp, ts::ctx(&mut sc));
    assert_eq!(back.value(), 7_000_000);
    coin::burn_for_testing(back);
    assert_eq!(parlay::supply_shares(&r), 0);
    ts::return_shared(r);

    ts::end(sc);
}

// A losing parlay grows supplier share value by the kept stake.
#[test]
fun losing_parlay_grows_supplier_value() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);

    ts::next_tx(&mut sc, LP);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    let sp = parlay::supply(&mut r, mint(&mut sc, 20_000_000), ts::ctx(&mut sc));
    ts::return_shared(r);

    let (oracles, ids) = make_oracles(&mut sc, vector[BELOW, ABOVE, ABOVE]);
    open_three(&mut sc, FAIR_STAKE, ids);
    resolve(&mut sc, 0, &oracles[0]); // dies, reserve keeps the 1.4M stake

    ts::next_tx(&mut sc, LP);
    let r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    // sole supplier now owns 20M + 1.4M kept stake.
    assert_eq!(parlay::share_value(&r, &sp), 20_000_000 + FAIR_STAKE);
    ts::return_shared(r);
    destroy(sp);

    destroy_oracles(oracles);
    ts::end(sc);
}

#[test, expected_failure(abort_code = yolev::parlay::ENotAdmin)]
fun non_admin_cannot_set_params() {
    let mut sc = ts::begin(ADMIN);
    setup(&mut sc);
    ts::next_tx(&mut sc, USER);
    let mut r = ts::take_shared<ParlayReserve<TUSD>>(&sc);
    parlay::set_paused<TUSD>(&mut r, true, ts::ctx(&mut sc));

    abort
}
