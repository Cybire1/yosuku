/// Leveraged positions on top of the lending pool.
///
/// A user posts `margin` and borrows the rest from `lending_pool`, funding a
/// position of `notional = margin + borrowed` (which the same PTB uses to mint a
/// Predict position). The loan accrues interest in the pool. On close the owner
/// returns the redeemed proceeds, repays the debt, and keeps the remainder (PnL).
/// If the position falls under the maintenance threshold, anyone can `liquidate`
/// by returning the redeemed proceeds: the debt is repaid, the liquidator earns a
/// penalty, and any shortfall is socialised across suppliers.
///
/// The module is generic over the position — it never touches Predict directly,
/// so it composes with binary OR range positions at the PTB layer. Liquidation
/// eligibility is proven by the *actual* redeemed value, not an oracle.
module yolev::leverage;

use sui::{
    balance,
    coin::{Self, Coin},
    clock::Clock,
    event,
};
use yolev::lending_pool::{Self, LendingPool};

// ─── errors ───
const ENotAdmin: u64 = 1;
const EZero: u64 = 2;
const ELeverageTooHigh: u64 = 3;
const ENotOwner: u64 = 4;
const EWrongPool: u64 = 5;
const EStillHealthy: u64 = 6;
const EPaused: u64 = 7;
const EBadConfig: u64 = 8;

const BPS: u128 = 10_000;

/// Global leverage parameters.
public struct LevConfig has key {
    id: UID,
    admin: address,
    /// Max position notional as a multiple of margin, in bps (30000 = 3x).
    max_leverage_bps: u64,
    /// Liquidate when position value < debt * maintenance_bps / BPS (11000 = 110%).
    maintenance_bps: u64,
    /// Liquidator reward as bps of the redeemed proceeds (500 = 5%).
    liq_penalty_bps: u64,
    paused: bool,
}

/// A user's open leveraged position. The funds live in the Predict position;
/// this tracks the debt + margin AND a descriptor of the funded position so the
/// UI can redeem exactly the right position when closing.
public struct Loan<phantom T> has key, store {
    id: UID,
    owner: address,
    pool: ID,
    margin: u64,
    borrowed: u64,
    notional: u64,
    principal_scaled: u128,
    opened_ms: u64,
    // ── position descriptor (the position this loan funded) ──
    manager_id: ID,
    oracle_id: ID,
    expiry: u64,
    is_range: bool,
    lower_strike: u64,  // binary: the strike; range: lower bound
    higher_strike: u64, // range: upper bound (0 for binary)
    is_up: bool,        // binary direction (ignored for range)
    quantity: u64,
}

// ─── events ───
public struct ConfigCreated has copy, drop { config: ID, admin: address, max_leverage_bps: u64, maintenance_bps: u64 }
public struct Opened has copy, drop { loan: ID, owner: address, margin: u64, borrowed: u64, notional: u64 }
public struct Closed has copy, drop { loan: ID, owner: address, debt_repaid: u64, returned: u64 }
public struct Liquidated has copy, drop { loan: ID, owner: address, proceeds: u64, debt: u64, penalty: u64, shortfall: u64 }

// ─── admin ───

public fun create_config(max_leverage_bps: u64, maintenance_bps: u64, liq_penalty_bps: u64, ctx: &mut TxContext) {
    assert!(max_leverage_bps >= 10_000 && maintenance_bps >= 10_000 && liq_penalty_bps < 5_000, EBadConfig);
    let cfg = LevConfig {
        id: object::new(ctx),
        admin: ctx.sender(),
        max_leverage_bps,
        maintenance_bps,
        liq_penalty_bps,
        paused: false,
    };
    event::emit(ConfigCreated { config: object::id(&cfg), admin: ctx.sender(), max_leverage_bps, maintenance_bps });
    transfer::share_object(cfg);
}

public fun set_params(cfg: &mut LevConfig, max_leverage_bps: u64, maintenance_bps: u64, liq_penalty_bps: u64, ctx: &mut TxContext) {
    assert!(ctx.sender() == cfg.admin, ENotAdmin);
    assert!(max_leverage_bps >= 10_000 && maintenance_bps >= 10_000 && liq_penalty_bps < 5_000, EBadConfig);
    cfg.max_leverage_bps = max_leverage_bps;
    cfg.maintenance_bps = maintenance_bps;
    cfg.liq_penalty_bps = liq_penalty_bps;
}

public fun set_paused(cfg: &mut LevConfig, paused: bool, ctx: &mut TxContext) {
    assert!(ctx.sender() == cfg.admin, ENotAdmin);
    cfg.paused = paused;
}

// ─── open ───

/// Post `margin`, borrow `borrow_amount` from the pool, and receive the combined
/// `notional` coin to fund a Predict position in the same PTB. Returns the Loan
/// receipt (keep it to close/liquidate) and the notional coin.
public fun open<T>(
    cfg: &LevConfig,
    pool: &mut LendingPool<T>,
    margin: Coin<T>,
    // position descriptor (must match the position the PTB mints with the notional)
    manager_id: ID,
    oracle_id: ID,
    borrow_amount: u64,
    expiry: u64,
    is_range: bool,
    lower_strike: u64,
    higher_strike: u64,
    is_up: bool,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): (Loan<T>, Coin<T>) {
    assert!(!cfg.paused, EPaused);
    let m = margin.value();
    assert!(m > 0, EZero);
    let notional = m + borrow_amount;
    // (margin + borrowed) / margin <= max_leverage
    assert!((notional as u128) * BPS <= (m as u128) * (cfg.max_leverage_bps as u128), ELeverageTooHigh);

    let (borrowed_bal, principal_scaled) = lending_pool::borrow(pool, borrow_amount, clock);
    let mut out = margin;
    coin::join(&mut out, borrowed_bal.into_coin(ctx));

    let loan = Loan<T> {
        id: object::new(ctx),
        owner: ctx.sender(),
        pool: object::id(pool),
        margin: m,
        borrowed: borrow_amount,
        notional,
        principal_scaled,
        opened_ms: clock.timestamp_ms(),
        manager_id,
        oracle_id,
        expiry,
        is_range,
        lower_strike,
        higher_strike,
        is_up,
        quantity,
    };
    event::emit(Opened { loan: object::id(&loan), owner: ctx.sender(), margin: m, borrowed: borrow_amount, notional });
    (loan, out)
}

// ─── close (owner) ───

/// Owner closes: pass the redeemed position proceeds. Debt is repaid, remainder
/// (margin ± PnL) returned. Aborts if proceeds can't cover the debt — that case
/// is for `liquidate`.
public fun close<T>(
    loan: Loan<T>,
    pool: &mut LendingPool<T>,
    proceeds: Coin<T>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<T> {
    assert!(ctx.sender() == loan.owner, ENotOwner);
    let Loan { id, owner, pool: pid, principal_scaled, .. } = loan;
    assert!(pid == object::id(pool), EWrongPool);
    let loan_id = id.to_inner();
    id.delete();

    lending_pool::accrue(pool, clock);
    let debt = lending_pool::debt_of(pool, principal_scaled);
    let remainder = lending_pool::repay(pool, proceeds.into_balance(), principal_scaled, clock);
    let returned = balance::value(&remainder);
    event::emit(Closed { loan: loan_id, owner, debt_repaid: debt, returned });
    remainder.into_coin(ctx)
}

// ─── liquidate (permissionless) ───

/// Anyone may liquidate by returning the redeemed proceeds, IF the position value
/// is below the maintenance threshold. The liquidator earns `liq_penalty_bps` of
/// the proceeds; the debt is repaid (shortfall socialised); any leftover goes to
/// the owner.
public fun liquidate<T>(
    cfg: &LevConfig,
    loan: Loan<T>,
    pool: &mut LendingPool<T>,
    proceeds: Coin<T>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<T> {
    let Loan { id, owner, pool: pid, principal_scaled, .. } = loan;
    assert!(pid == object::id(pool), EWrongPool);
    let loan_id = id.to_inner();
    id.delete();

    lending_pool::accrue(pool, clock);
    let debt = lending_pool::debt_of(pool, principal_scaled);
    let pv = proceeds.value();
    // eligible only if undercollateralised: pv * BPS < debt * maintenance_bps
    assert!((pv as u128) * BPS < (debt as u128) * (cfg.maintenance_bps as u128), EStillHealthy);

    let mut bal = proceeds.into_balance();
    // liquidator reward off the top
    let penalty = ((pv as u128) * (cfg.liq_penalty_bps as u128) / BPS) as u64;
    let reward = balance::split(&mut bal, penalty);
    let reward_coin = reward.into_coin(ctx);

    let left = balance::value(&bal);
    let mut shortfall = 0;
    if (left >= debt) {
        let remainder = lending_pool::repay(pool, bal, principal_scaled, clock);
        let leftover = balance::value(&remainder);
        if (leftover > 0) {
            transfer::public_transfer(remainder.into_coin(ctx), owner);
        } else {
            balance::destroy_zero(remainder);
        };
    } else {
        shortfall = debt - left;
        lending_pool::repay_lossy(pool, bal, principal_scaled, clock);
    };
    event::emit(Liquidated { loan: loan_id, owner, proceeds: pv, debt, penalty, shortfall });
    reward_coin
}

// ─── views ───

/// Current debt (principal + accrued interest) of a loan. Call after accrue.
public fun loan_debt<T>(pool: &LendingPool<T>, loan: &Loan<T>): u64 {
    lending_pool::debt_of(pool, loan.principal_scaled)
}

/// Health in bps = position_value * BPS / debt. < maintenance_bps → liquidatable.
public fun health_bps<T>(pool: &LendingPool<T>, loan: &Loan<T>, position_value: u64): u64 {
    let debt = lending_pool::debt_of(pool, loan.principal_scaled);
    if (debt == 0) { return 1_000_000 };
    ((position_value as u128) * BPS / (debt as u128)) as u64
}

public fun loan_owner<T>(loan: &Loan<T>): address { loan.owner }
public fun loan_margin<T>(loan: &Loan<T>): u64 { loan.margin }
public fun loan_borrowed<T>(loan: &Loan<T>): u64 { loan.borrowed }
public fun loan_notional<T>(loan: &Loan<T>): u64 { loan.notional }
public fun max_leverage_bps(cfg: &LevConfig): u64 { cfg.max_leverage_bps }
public fun maintenance_bps(cfg: &LevConfig): u64 { cfg.maintenance_bps }
