/// Parlay tickets on DeepBook Predict **6-24** markets — settled on the venue's
/// own exact-stamp oracle print.
///
/// A **parlay** is ONE ticket bundling N band legs (each `(expiry, lower, higher]`
/// on the BTC settlement feed). It pays a single combined payout **only if every
/// leg settles in-the-money**; if *any* leg loses, the whole stake is forfeit.
///
/// This is the proven `yolev::parlay` reserve model (escrow-both-sides,
/// incremental resolve, early-kill, force-pay-owner claim) ported to the 6-24
/// venue. The 6-24 rewrite sealed `expiry_market`'s settlement surface
/// (`public(package)`), so instead of reading the market we read **the same
/// source the market reads**: propbook's `pyth_feed::normalized_spot_at(expiry)`
/// — the PUBLIC getter that `expiry_market::ensure_settled` itself calls. Same
/// shared object, same storage read, same 1e9 scaling ⇒ a parlay leg settles on
/// the byte-identical print as the venue market at that expiry. Nothing to vote
/// on, nothing to capture — and no venue dependency.
///
/// The win rule is copied verbatim from the venue
/// (`strike_exposure::close_settled_order`): a band `(lower, higher]` wins iff
/// `settlement > lower && settlement <= higher` — exclusive low, inclusive high
/// (an exactly-at-the-strike print settles DOWN, like the venue). Encodings:
///   UP at strike    → (strike, U64_MAX]
///   DOWN at strike  → (0, strike]
///   RANGE           → (lower, higher]
///
/// Legs on the SAME expiry are decided by the SAME print, so they are perfectly
/// correlated — the legacy per-oracle correlation surcharge + sub-cap map here to
/// per-expiry. Everything else (share-supply math, exposure caps, admin void,
/// idempotent cranks, sweep) carries over from the on-chain-proven original.
module parlay624::parlay624;

use sui::{
    balance::{Self, Balance},
    coin::Coin,
    clock::Clock,
    event,
    table::{Self, Table},
};
use propbook::pyth_feed::PythFeed;

// ─── errors ───
const ENotAdmin: u64 = 1;
const EZero: u64 = 2;
const EPaused: u64 = 3;
const EExposureCap: u64 = 4;
const EInsufficientLiquidity: u64 = 5;
const EWrongReserve: u64 = 6;
const ENotWon: u64 = 7;
const EUnderpriced: u64 = 8;
const EBadLegCount: u64 = 9;
const EStampNotRecorded: u64 = 10;
const EWrongFeed: u64 = 11;
const ENotLive: u64 = 13;
const EPayoutCap: u64 = 14;
const ENotExpired: u64 = 15;
const EBadConfig: u64 = 16;
const ELenMismatch: u64 = 17;
const EExpiryCap: u64 = 18;
const EBadBand: u64 = 19;

// ─── scaling ───
const BPS: u128 = 10_000;
/// Open-ended upper sentinel for UP legs ("over strike").
const U64_MAX: u64 = 18_446_744_073_709_551_615;

// parlay status
const ST_LIVE: u8 = 0;
const ST_WON: u8 = 1;
const ST_LOST: u8 = 2;

// per-leg status
const LEG_PENDING: u8 = 0;
const LEG_WON: u8 = 1;
const LEG_LOST: u8 = 2;

/// The parlay underwriting reserve for quote asset `T`. Shared.
public struct ParlayReserve<phantom T> has key {
    id: UID,
    /// The ONE settlement feed legs may reference (the venue's BTC PythFeed).
    /// Pinned at create; `resolve_leg` refuses any other object.
    feed_id: ID,
    /// Withdrawable supplier capital + kept stakes of losing parlays.
    liquid: Balance<T>,
    /// Σ `house_locked` over LIVE parlays — the reserve's contingent liability.
    locked: u64,
    /// Total supplier shares outstanding.
    supply_shares: u128,
    /// Per-expiry contingent liability (same-print correlation sub-cap).
    locked_by_expiry: Table<u64, u64>,
    admin: address,
    /// Runs the resolve/claim cranks. Liveness dependency only — it can never
    /// divert funds (claim force-pays the owner; resolve only moves escrow
    /// back to the reserve).
    keeper: address,
    paused: bool,
    // ── params ──
    /// House edge over fair value, bps (1200 = 12%).
    margin_bps: u64,
    /// Aggregate `locked` cap as a fraction of total value, bps (6000 = 60%).
    max_exposure_bps: u64,
    /// Per-parlay jackpot cap, base units.
    max_payout_cap: u64,
    /// Per-expiry aggregate contingent-liability cap, base units.
    max_expiry_locked: u64,
    /// Max legs per parlay.
    max_legs: u8,
    /// Reject ultra-longshots: min combined (surcharged) prob, bps.
    min_combined_prob_bps: u64,
    /// Same-expiry correlation surcharge factor λ, bps (4000 = 0.40).
    correlation_bps: u64,
    /// Grace window after `last_expiry` before admin may void a stuck parlay (ms).
    grace_ms: u64,
}

/// One band leg. `(lower, higher]` in the feed's 1e9 price scaling.
public struct Leg has store, copy, drop {
    /// ms — the exact settlement stamp this leg reads.
    expiry: u64,
    lower: u64,
    higher: u64,
    /// Priced win-prob ×1e4. Audit + on-chain fair-stake floor recompute.
    prob_bps: u64,
    status: u8,
    resolved_ms: u64,
    /// The print that decided the leg (0 while pending). Audit trail.
    settlement: u64,
}

/// A parlay ticket. Shared, so the keeper can crank it; `claim` force-pays the
/// `owner` field (not the caller). While LIVE, `escrow` holds the full
/// `max_payout` (the opener's `stake` + the reserve's `house_locked`).
public struct Parlay<phantom T> has key {
    id: UID,
    reserve: ID,
    owner: address,
    legs: vector<Leg>,
    n_legs: u8,
    won_count: u8,
    status: u8,
    /// `== max_payout` while LIVE; drained to reserve on loss; paid to owner on claim.
    escrow: Balance<T>,
    stake: u64,
    max_payout: u64,
    /// `max_payout - stake` — the reserve's contingent contribution.
    house_locked: u64,
    /// Combined (surcharged) win-prob recomputed on-chain, bps.
    combined_prob_bps: u64,
    /// max(leg.expiry) — gate for `admin_void`.
    last_expiry: u64,
    opened_ms: u64,
}

/// A supplier's claim on the reserve. Value = shares * total_value / supply_shares.
public struct SupplyPosition has key, store {
    id: UID,
    reserve: ID,
    shares: u128,
}

// ─── events ───
public struct ParlayReserveCreated has copy, drop {
    reserve: ID,
    feed: ID,
    admin: address,
    keeper: address,
    margin_bps: u64,
    max_exposure_bps: u64,
}
public struct Supplied has copy, drop { reserve: ID, who: address, amount: u64, shares: u128 }
public struct SupplyRedeemed has copy, drop { reserve: ID, who: address, amount: u64, shares: u128 }
public struct ParamsUpdated has copy, drop {
    reserve: ID,
    margin_bps: u64,
    max_exposure_bps: u64,
    max_payout_cap: u64,
    max_expiry_locked: u64,
}
public struct ParlayOpened has copy, drop {
    parlay: ID,
    owner: address,
    n_legs: u8,
    stake: u64,
    max_payout: u64,
    combined_prob_bps: u64,
    last_expiry: u64,
}
public struct LegResolved has copy, drop {
    parlay: ID,
    leg_idx: u64,
    won: bool,
    expiry: u64,
    settlement: u64,
}
public struct ParlayWonRecorded has copy, drop { parlay: ID, owner: address, payout: u64 }
public struct ParlayLostRecorded has copy, drop { parlay: ID, owner: address, kept: u64, on_leg: u64 }
public struct ParlayVoided has copy, drop { parlay: ID, owner: address, refund: u64 }

// ─── create / admin ───

/// Create and share a parlay reserve for quote asset `T`, pinned to ONE
/// settlement feed (pass the venue's BTC `PythFeed` — the same object its
/// markets settle on).
public fun create<T>(
    feed: &PythFeed,
    keeper: address,
    margin_bps: u64,
    max_exposure_bps: u64,
    max_payout_cap: u64,
    max_expiry_locked: u64,
    max_legs: u8,
    min_combined_prob_bps: u64,
    correlation_bps: u64,
    grace_ms: u64,
    ctx: &mut TxContext,
) {
    assert!(margin_bps < 100_000, EBadConfig);
    assert!(max_exposure_bps <= 10_000, EBadConfig);
    assert!(correlation_bps <= 10_000, EBadConfig);
    assert!(max_legs >= 2, EBadConfig);
    assert!(max_payout_cap > 0 && max_expiry_locked > 0, EBadConfig);
    let r = ParlayReserve<T> {
        id: object::new(ctx),
        feed_id: object::id(feed),
        liquid: balance::zero<T>(),
        locked: 0,
        supply_shares: 0,
        locked_by_expiry: table::new<u64, u64>(ctx),
        admin: ctx.sender(),
        keeper,
        paused: false,
        margin_bps,
        max_exposure_bps,
        max_payout_cap,
        max_expiry_locked,
        max_legs,
        min_combined_prob_bps,
        correlation_bps,
        grace_ms,
    };
    event::emit(ParlayReserveCreated {
        reserve: object::id(&r),
        feed: object::id(feed),
        admin: ctx.sender(),
        keeper,
        margin_bps,
        max_exposure_bps,
    });
    transfer::share_object(r);
}

/// Admin: rotate the keeper.
public fun set_keeper<T>(r: &mut ParlayReserve<T>, keeper: address, ctx: &mut TxContext) {
    assert!(ctx.sender() == r.admin, ENotAdmin);
    r.keeper = keeper;
}

/// Admin: update tunable parameters.
public fun set_params<T>(
    r: &mut ParlayReserve<T>,
    margin_bps: u64,
    max_exposure_bps: u64,
    max_payout_cap: u64,
    max_expiry_locked: u64,
    max_legs: u8,
    min_combined_prob_bps: u64,
    correlation_bps: u64,
    grace_ms: u64,
    ctx: &mut TxContext,
) {
    assert!(ctx.sender() == r.admin, ENotAdmin);
    assert!(margin_bps < 100_000, EBadConfig);
    assert!(max_exposure_bps <= 10_000, EBadConfig);
    assert!(correlation_bps <= 10_000, EBadConfig);
    assert!(max_legs >= 2, EBadConfig);
    assert!(max_payout_cap > 0 && max_expiry_locked > 0, EBadConfig);
    r.margin_bps = margin_bps;
    r.max_exposure_bps = max_exposure_bps;
    r.max_payout_cap = max_payout_cap;
    r.max_expiry_locked = max_expiry_locked;
    r.max_legs = max_legs;
    r.min_combined_prob_bps = min_combined_prob_bps;
    r.correlation_bps = correlation_bps;
    r.grace_ms = grace_ms;
    event::emit(ParamsUpdated {
        reserve: object::id(r),
        margin_bps,
        max_exposure_bps,
        max_payout_cap,
        max_expiry_locked,
    });
}

public fun set_paused<T>(r: &mut ParlayReserve<T>, paused: bool, ctx: &mut TxContext) {
    assert!(ctx.sender() == r.admin, ENotAdmin);
    r.paused = paused;
}

// ─── supplier supply / withdraw (share math cloned from the proven original) ───

public fun supply<T>(r: &mut ParlayReserve<T>, coin: Coin<T>, ctx: &mut TxContext): SupplyPosition {
    assert!(!r.paused, EPaused);
    let amount = coin.value();
    assert!(amount > 0, EZero);
    let tv = total_value_u128(r);
    let shares = if (r.supply_shares == 0 || tv == 0) {
        (amount as u128)
    } else {
        (amount as u128) * r.supply_shares / tv
    };
    r.supply_shares = r.supply_shares + shares;
    balance::join(&mut r.liquid, coin.into_balance());
    event::emit(Supplied { reserve: object::id(r), who: ctx.sender(), amount, shares });
    SupplyPosition { id: object::new(ctx), reserve: object::id(r), shares }
}

/// Withdraw supplier capital. Locked (contingent) funds are not withdrawable.
public fun withdraw<T>(r: &mut ParlayReserve<T>, pos: SupplyPosition, ctx: &mut TxContext): Coin<T> {
    assert!(pos.reserve == object::id(r), EWrongReserve);
    let SupplyPosition { id, shares, .. } = pos;
    id.delete();
    let tv = total_value_u128(r);
    let value = if (r.supply_shares == 0) { 0 } else { (shares * tv / r.supply_shares) as u64 };
    assert!(balance::value(&r.liquid) >= value, EInsufficientLiquidity);
    r.supply_shares = r.supply_shares - shares;
    let out = balance::split(&mut r.liquid, value).into_coin(ctx);
    event::emit(SupplyRedeemed { reserve: object::id(r), who: ctx.sender(), amount: value, shares });
    out
}

// ─── open: one trader-signed PTB, both sides escrowed atomically ───

/// Open a parlay. Legs are passed as parallel pure vectors (Move entry can't take
/// a `vector<Leg>`) and zipped on-chain. The reserve recomputes the combined
/// probability from `prob_bps[]`, applies the same-expiry correlation surcharge,
/// asserts the `stake` clears the margined fair floor, pre-funds the full
/// `max_payout` into the ticket's escrow, and shares the `Parlay`.
public fun open_parlay<T>(
    r: &mut ParlayReserve<T>,
    stake: Coin<T>,
    expiries: vector<u64>,
    lowers: vector<u64>,
    highers: vector<u64>,
    prob_bps: vector<u64>,
    max_payout: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(!r.paused, EPaused);

    let n = expiries.length();
    assert!(
        lowers.length() == n && highers.length() == n && prob_bps.length() == n,
        ELenMismatch,
    );
    assert!(n >= 2 && n <= (r.max_legs as u64), EBadLegCount);

    let stake_value = stake.value();
    assert!(stake_value > 0, EZero);
    assert!(max_payout <= r.max_payout_cap, EPayoutCap);
    assert!(max_payout > stake_value, EUnderpriced);

    // Every leg must be a non-empty band on a FUTURE stamp — a leg whose expiry
    // has already passed would let the opener pick known outcomes.
    let now = clock.timestamp_ms();
    n.do!(|i| {
        assert!(lowers[i] < highers[i], EBadBand);
        assert!(expiries[i] > now, ENotExpired);
    });

    // Recompute the combined probability on-chain from the per-leg probs. Start at
    // 1.0 in bps and multiply down: combined *= prob_i / BPS.
    let mut combined_bps: u128 = BPS;
    let mut min_prob_bps: u64 = 10_000;
    n.do!(|i| {
        let p = prob_bps[i];
        assert!(p > 0 && p <= 10_000, EUnderpriced);
        combined_bps = combined_bps * (p as u128) / BPS;
        if (p < min_prob_bps) { min_prob_bps = p; };
    });

    // Same-expiry correlation surcharge: legs at one expiry are decided by the SAME
    // print, so Π prob understates the joint win-prob. Charge against a conservative
    // floor: combined' = max(Π prob, λ · min_i prob_i).
    if (has_duplicate_expiry(&expiries)) {
        let floor = (min_prob_bps as u128) * (r.correlation_bps as u128) / BPS;
        if (floor > combined_bps) { combined_bps = floor; };
    };

    assert!(combined_bps >= (r.min_combined_prob_bps as u128), EUnderpriced);

    // Fair stake floor = max_payout * combined' * (1 + margin). Round UP so the
    // reserve is never short a base unit.
    let fair = mul_div_ceil((max_payout as u128), combined_bps, BPS);
    let floor_stake = mul_div_ceil(fair, BPS + (r.margin_bps as u128), BPS);
    assert!((stake_value as u128) >= floor_stake, EUnderpriced);

    let house_locked = max_payout - stake_value;
    assert!(house_locked > 0, EUnderpriced);

    // Exposure cap, then liquidity (defense-in-depth; see the proven original).
    let tv = total_value_u128(r);
    assert!(
        ((r.locked + house_locked) as u128) * BPS <= tv * (r.max_exposure_bps as u128),
        EExposureCap,
    );
    assert!(balance::value(&r.liquid) >= house_locked, EInsufficientLiquidity);

    // Per-expiry correlation sub-cap: each DISTINCT expiry in this parlay takes on
    // the full `house_locked` of contingent liability.
    n.do!(|j| {
        let e = expiries[j];
        if (!seen_before(&expiries, j)) {
            let cur = if (r.locked_by_expiry.contains(e)) { *r.locked_by_expiry.borrow(e) } else { 0 };
            let next = cur + house_locked;
            assert!(next <= r.max_expiry_locked, EExpiryCap);
            if (r.locked_by_expiry.contains(e)) {
                *r.locked_by_expiry.borrow_mut(e) = next;
            } else {
                r.locked_by_expiry.add(e, next);
            };
        };
    });

    // Pre-fund the escrow: split `house_locked` out of liquid, join the stake →
    // escrow == max_payout. Record the contingent liability.
    let mut escrow = balance::split(&mut r.liquid, house_locked);
    balance::join(&mut escrow, stake.into_balance());
    r.locked = r.locked + house_locked;

    // Zip the parallel vectors into Legs.
    let legs = vector::tabulate!(n, |k| {
        Leg {
            expiry: expiries[k],
            lower: lowers[k],
            higher: highers[k],
            prob_bps: prob_bps[k],
            status: LEG_PENDING,
            resolved_ms: 0,
            settlement: 0,
        }
    });

    let last_expiry = max_u64(&expiries);
    let p = Parlay<T> {
        id: object::new(ctx),
        reserve: object::id(r),
        owner: ctx.sender(),
        legs,
        n_legs: (n as u8),
        won_count: 0,
        status: ST_LIVE,
        escrow,
        stake: stake_value,
        max_payout,
        house_locked,
        combined_prob_bps: (combined_bps as u64),
        last_expiry,
        opened_ms: now,
    };
    event::emit(ParlayOpened {
        parlay: object::id(&p),
        owner: ctx.sender(),
        n_legs: (n as u8),
        stake: stake_value,
        max_payout,
        combined_prob_bps: (combined_bps as u64),
        last_expiry,
    });
    transfer::share_object(p);
}

// ─── resolve_leg: permissionless incremental crank (the time-staggered core) ───

/// Resolve one leg against the settlement feed's exact-stamp print. Permissionless
/// and idempotent (safe under racing crankers). Reads
/// `pyth_feed::normalized_spot_at(leg.expiry)` — the IDENTICAL call the venue's
/// `ensure_settled` makes, on the SAME pinned shared object — and applies the
/// venue's verbatim band rule: won ⟺ `sp > lower && sp <= higher`.
///
/// If the leg LOSES, the parlay is dead the instant this runs: the entire escrow
/// sweeps back to the reserve and all contingent liability is released — no later
/// bell is ever consulted. If it WINS and it was the last pending leg, the parlay
/// flips to ST_WON (escrow stays put for `claim`).
public fun resolve_leg<T>(
    r: &mut ParlayReserve<T>,
    p: &mut Parlay<T>,
    feed: &PythFeed,
    leg_idx: u64,
    clock: &Clock,
    _ctx: &mut TxContext,
) {
    assert!(p.reserve == object::id(r), EWrongReserve);
    assert!(object::id(feed) == r.feed_id, EWrongFeed);
    // Idempotent: a finished parlay or an already-resolved leg is a no-op.
    if (p.status != ST_LIVE) { return };
    if (p.legs[leg_idx].status != LEG_PENDING) { return };

    let expiry = p.legs[leg_idx].expiry;
    let lower = p.legs[leg_idx].lower;
    let higher = p.legs[leg_idx].higher;

    let now = clock.timestamp_ms();
    assert!(now >= expiry, ENotExpired);

    // The exact-stamp read the venue itself settles on. None ⇒ the print for this
    // second isn't recorded yet — crank again once the venue's feed catches up.
    let read = feed.normalized_spot_at(expiry);
    assert!(read.is_some(), EStampNotRecorded);
    let sp = read.destroy_some().read_value();

    // Venue rule, verbatim (strike_exposure::close_settled_order):
    // lose ⟺ settlement <= lower || settlement > higher.
    let won = sp > lower && sp <= higher;

    let leg = &mut p.legs[leg_idx];
    leg.resolved_ms = now;
    leg.settlement = sp;

    if (!won) {
        leg.status = LEG_LOST;
        p.status = ST_LOST;
        // Sweep the whole escrow back to the reserve; release all liability.
        let swept = balance::withdraw_all(&mut p.escrow);
        balance::join(&mut r.liquid, swept);
        release_locked(r, p);
        event::emit(ParlayLostRecorded {
            parlay: object::id(p),
            owner: p.owner,
            kept: p.max_payout,
            on_leg: leg_idx,
        });
    } else {
        leg.status = LEG_WON;
        p.won_count = p.won_count + 1;
        if (p.won_count == p.n_legs) {
            p.status = ST_WON;
        };
        event::emit(LegResolved {
            parlay: object::id(p),
            leg_idx,
            won: true,
            expiry,
            settlement: sp,
        });
    };
}

// ─── claim: permissionless, force-pays the owner ───

/// Claim a fully-won parlay. The entire escrow (`== max_payout`) is paid to the
/// `owner` field, never the caller — so payout never depends on keeper liveness
/// and no one can divert it.
public fun claim<T>(r: &mut ParlayReserve<T>, p: Parlay<T>, ctx: &mut TxContext) {
    assert!(p.reserve == object::id(r), EWrongReserve);
    assert!(p.status == ST_WON, ENotWon);
    release_locked(r, &p);
    let Parlay {
        id,
        reserve: _,
        owner,
        legs: _,
        n_legs: _,
        won_count: _,
        status: _,
        escrow,
        stake: _,
        max_payout,
        house_locked: _,
        combined_prob_bps: _,
        last_expiry: _,
        opened_ms: _,
    } = p;
    let parlay_id = id.to_inner();
    id.delete();
    let payout = balance::value(&escrow);
    transfer::public_transfer(escrow.into_coin(ctx), owner);
    event::emit(ParlayWonRecorded { parlay: parlay_id, owner, payout });
    assert!(payout == max_payout, EUnderpriced);
}

// ─── cleanup / liveness ───

/// Reap a dead (ST_LOST) parlay husk — escrow is already empty. Permissionless.
public fun sweep<T>(r: &ParlayReserve<T>, p: Parlay<T>) {
    assert!(p.reserve == object::id(r), EWrongReserve);
    assert!(p.status == ST_LOST, ENotLive);
    let Parlay {
        id,
        reserve: _,
        owner: _,
        legs: _,
        n_legs: _,
        won_count: _,
        status: _,
        escrow,
        stake: _,
        max_payout: _,
        house_locked: _,
        combined_prob_bps: _,
        last_expiry: _,
        opened_ms: _,
    } = p;
    id.delete();
    balance::destroy_zero(escrow);
}

/// Admin: void a parlay whose stamp never got recorded, after
/// `last_expiry + grace`. Treated as a VOID (not a loss): the opener's `stake` is
/// refunded to the owner and the reserve's `house_locked` returns to liquid.
/// Funds are never trapped.
public fun admin_void<T>(r: &mut ParlayReserve<T>, p: Parlay<T>, clock: &Clock, ctx: &mut TxContext) {
    assert!(ctx.sender() == r.admin, ENotAdmin);
    assert!(p.reserve == object::id(r), EWrongReserve);
    assert!(p.status == ST_LIVE, ENotLive);
    assert!(clock.timestamp_ms() > p.last_expiry + r.grace_ms, ENotExpired);
    release_locked(r, &p);
    let Parlay {
        id,
        reserve: _,
        owner,
        legs: _,
        n_legs: _,
        won_count: _,
        status: _,
        mut escrow,
        stake,
        max_payout: _,
        house_locked,
        combined_prob_bps: _,
        last_expiry: _,
        opened_ms: _,
    } = p;
    let parlay_id = id.to_inner();
    id.delete();
    // Return the fronted house portion to the reserve, refund the stake to owner.
    balance::join(&mut r.liquid, balance::split(&mut escrow, house_locked));
    let refund = balance::value(&escrow);
    transfer::public_transfer(escrow.into_coin(ctx), owner);
    event::emit(ParlayVoided { parlay: parlay_id, owner, refund });
    assert!(refund == stake, EUnderpriced);
}

// ─── internal helpers ───

/// Release a parlay's contingent liability: subtract `house_locked` from `locked`
/// and from each DISTINCT expiry's running liability.
fun release_locked<T>(r: &mut ParlayReserve<T>, p: &Parlay<T>) {
    r.locked = if (r.locked > p.house_locked) { r.locked - p.house_locked } else { 0 };
    let n = p.legs.length();
    n.do!(|i| {
        let e = p.legs[i].expiry;
        if (!leg_expiry_seen_before(&p.legs, i)) {
            if (r.locked_by_expiry.contains(e)) {
                let cur = *r.locked_by_expiry.borrow(e);
                let next = if (cur > p.house_locked) { cur - p.house_locked } else { 0 };
                *r.locked_by_expiry.borrow_mut(e) = next;
            };
        };
    });
}

/// True iff `xs[idx]` equals any earlier element (so each distinct expiry is
/// counted exactly once).
fun seen_before(xs: &vector<u64>, idx: u64): bool {
    'seen: {
        idx.do!(|i| if (xs[i] == xs[idx]) return 'seen true);
        false
    }
}

fun has_duplicate_expiry(xs: &vector<u64>): bool {
    let n = xs.length();
    'duplicate: {
        (n - 1).do!(|offset| {
            let i = offset + 1;
            if (seen_before(xs, i)) { return 'duplicate true };
        });
        false
    }
}

fun leg_expiry_seen_before(legs: &vector<Leg>, idx: u64): bool {
    let target = legs[idx].expiry;
    'seen: {
        idx.do!(|i| if (legs[i].expiry == target) return 'seen true);
        false
    }
}

fun max_u64(v: &vector<u64>): u64 {
    let n = v.length();
    let mut m = 0;
    n.do!(|i| {
        if (v[i] > m) { m = v[i]; };
    });
    m
}

/// ceil(a * b / c). Guards against c == 0 (a math precondition, not app policy).
fun mul_div_ceil(a: u128, b: u128, c: u128): u128 {
    assert!(c > 0, EZero);
    let num = a * b;
    if (num == 0) { 0 } else { (num - 1) / c + 1 }
}

fun total_value_u128<T>(r: &ParlayReserve<T>): u128 {
    (balance::value(&r.liquid) as u128) + (r.locked as u128)
}

// ─── views ───

public fun available_liquidity<T>(r: &ParlayReserve<T>): u64 { balance::value(&r.liquid) }
public fun locked<T>(r: &ParlayReserve<T>): u64 { r.locked }
public fun total_value<T>(r: &ParlayReserve<T>): u64 { total_value_u128(r) as u64 }
public fun supply_shares<T>(r: &ParlayReserve<T>): u128 { r.supply_shares }
public fun margin_bps<T>(r: &ParlayReserve<T>): u64 { r.margin_bps }
public fun max_exposure_bps<T>(r: &ParlayReserve<T>): u64 { r.max_exposure_bps }
public fun max_payout_cap<T>(r: &ParlayReserve<T>): u64 { r.max_payout_cap }
public fun max_expiry_locked<T>(r: &ParlayReserve<T>): u64 { r.max_expiry_locked }
public fun keeper<T>(r: &ParlayReserve<T>): address { r.keeper }
public fun max_legs<T>(r: &ParlayReserve<T>): u8 { r.max_legs }
public fun correlation_bps<T>(r: &ParlayReserve<T>): u64 { r.correlation_bps }
public fun feed_id<T>(r: &ParlayReserve<T>): ID { r.feed_id }
public fun expiry_locked<T>(r: &ParlayReserve<T>, expiry: u64): u64 {
    if (r.locked_by_expiry.contains(expiry)) { *r.locked_by_expiry.borrow(expiry) } else { 0 }
}
public fun utilization_bps<T>(r: &ParlayReserve<T>): u64 {
    let tv = total_value_u128(r);
    if (tv == 0) { 0 } else { ((r.locked as u128) * BPS / tv) as u64 }
}

public fun parlay_status<T>(p: &Parlay<T>): u8 { p.status }
public fun parlay_owner<T>(p: &Parlay<T>): address { p.owner }
public fun parlay_max_payout<T>(p: &Parlay<T>): u64 { p.max_payout }
public fun parlay_stake<T>(p: &Parlay<T>): u64 { p.stake }
public fun parlay_escrow_value<T>(p: &Parlay<T>): u64 { balance::value(&p.escrow) }
public fun parlay_won_count<T>(p: &Parlay<T>): u8 { p.won_count }
public fun parlay_n_legs<T>(p: &Parlay<T>): u8 { p.n_legs }
public fun parlay_combined_prob_bps<T>(p: &Parlay<T>): u64 { p.combined_prob_bps }
public fun parlay_last_expiry<T>(p: &Parlay<T>): u64 { p.last_expiry }
public fun leg_status<T>(p: &Parlay<T>, idx: u64): u8 { p.legs[idx].status }
public fun leg_expiry<T>(p: &Parlay<T>, idx: u64): u64 { p.legs[idx].expiry }
public fun leg_band<T>(p: &Parlay<T>, idx: u64): (u64, u64) { (p.legs[idx].lower, p.legs[idx].higher) }
public fun leg_settlement<T>(p: &Parlay<T>, idx: u64): u64 { p.legs[idx].settlement }

/// The open-ended upper sentinel for UP legs — client encodes `(strike, u64_max()]`.
public fun u64_max(): u64 { U64_MAX }

/// Status code constants for off-chain consumers.
public fun st_live(): u8 { ST_LIVE }
public fun st_won(): u8 { ST_WON }
public fun st_lost(): u8 { ST_LOST }
public fun leg_pending(): u8 { LEG_PENDING }
public fun leg_won(): u8 { LEG_WON }
public fun leg_lost(): u8 { LEG_LOST }

#[test_only]
public fun share_value<T>(r: &ParlayReserve<T>, pos: &SupplyPosition): u64 {
    if (r.supply_shares == 0) { 0 } else { (pos.shares * total_value_u128(r) / r.supply_shares) as u64 }
}
