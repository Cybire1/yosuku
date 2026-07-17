/// A minimal but real interest-bearing lending pool for the leverage layer.
///
/// Liquidity providers `supply` a quote asset (DUSDC) and receive shares whose
/// value grows as borrowers pay interest. The `leverage` module (same package)
/// `borrow`s liquidity to open larger Predict positions and `repay`s on close or
/// liquidation. Interest accrues continuously via a borrow index (Compound/Aave
/// style), with a utilization-linear rate model.
///
/// v1 scope: full-repay loans (the leverage module repays the whole principal on
/// close/liquidation), no protocol reserve cut, single quote asset per pool.
/// Borrow/repay are `public(package)` so only the leverage module can move debt.
module yolev::lending_pool;

use sui::{
    balance::{Self, Balance},
    coin::{Self, Coin},
    clock::Clock,
    event,
};

// ─── errors ───
const ENotAdmin: u64 = 1;
const EZeroAmount: u64 = 2;
const EInsufficientLiquidity: u64 = 3;
const EPaused: u64 = 4;
const ERepayTooLittle: u64 = 5;
const EWrongPool: u64 = 6;
const EBadRate: u64 = 7;

// ─── scaling ───
/// Index / share fixed-point scale (1e12).
const RAY: u128 = 1_000_000_000_000;
const BPS: u128 = 10_000;
/// Milliseconds in a 365-day year.
const MS_PER_YEAR: u128 = 31_536_000_000;
/// Sanity ceiling on configured APR (1000%).
const MAX_RATE_BPS: u64 = 100_000;

/// A peer-to-pool lending market for quote asset `T`.
public struct LendingPool<phantom T> has key {
    id: UID,
    /// Idle liquidity available to lend / withdraw.
    liquidity: Balance<T>,
    /// Sum of every loan's `principal_scaled` (= amount * RAY / borrow_index at draw).
    total_borrow_scaled: u128,
    /// Total LP shares outstanding.
    supply_shares: u128,
    /// Accrued interest index, RAY-scaled, monotonically increasing.
    borrow_index: u128,
    last_accrued_ms: u64,
    /// APR (bps) at 0% utilization.
    base_rate_bps: u64,
    /// Extra APR (bps) added linearly up to 100% utilization.
    slope_bps: u64,
    admin: address,
    paused: bool,
}

/// An LP's claim on a pool. Value = shares * pool_total_value / supply_shares.
public struct SupplyPosition has key, store {
    id: UID,
    pool: ID,
    shares: u128,
}

// ─── events ───
public struct PoolCreated has copy, drop { pool: ID, admin: address, base_rate_bps: u64, slope_bps: u64 }
public struct Supplied has copy, drop { pool: ID, who: address, amount: u64, shares: u128 }
public struct SupplyRedeemed has copy, drop { pool: ID, who: address, amount: u64, shares: u128 }
public struct Borrowed has copy, drop { pool: ID, amount: u64, principal_scaled: u128 }
public struct DebtRepaymentRecorded has copy, drop { pool: ID, amount: u64, principal_scaled: u128 }
public struct RatesUpdated has copy, drop { pool: ID, base_rate_bps: u64, slope_bps: u64 }

// ─── create / admin ───

/// Create and share a new pool. Caller becomes admin.
public fun create<T>(base_rate_bps: u64, slope_bps: u64, clock: &Clock, ctx: &mut TxContext) {
    assert!(base_rate_bps <= MAX_RATE_BPS && slope_bps <= MAX_RATE_BPS, EBadRate);
    let pool = LendingPool<T> {
        id: object::new(ctx),
        liquidity: balance::zero<T>(),
        total_borrow_scaled: 0,
        supply_shares: 0,
        borrow_index: RAY,
        last_accrued_ms: clock.timestamp_ms(),
        base_rate_bps,
        slope_bps,
        admin: ctx.sender(),
        paused: false,
    };
    event::emit(PoolCreated { pool: object::id(&pool), admin: ctx.sender(), base_rate_bps, slope_bps });
    transfer::share_object(pool);
}

public fun set_rates<T>(pool: &mut LendingPool<T>, base_rate_bps: u64, slope_bps: u64, clock: &Clock, ctx: &mut TxContext) {
    assert!(ctx.sender() == pool.admin, ENotAdmin);
    assert!(base_rate_bps <= MAX_RATE_BPS && slope_bps <= MAX_RATE_BPS, EBadRate);
    accrue(pool, clock);
    pool.base_rate_bps = base_rate_bps;
    pool.slope_bps = slope_bps;
    event::emit(RatesUpdated { pool: object::id(pool), base_rate_bps, slope_bps });
}

public fun set_paused<T>(pool: &mut LendingPool<T>, paused: bool, ctx: &mut TxContext) {
    assert!(ctx.sender() == pool.admin, ENotAdmin);
    pool.paused = paused;
}

// ─── interest accrual ───

/// Roll the borrow index forward to `now`. Safe to call on every interaction.
public fun accrue<T>(pool: &mut LendingPool<T>, clock: &Clock) {
    let now = clock.timestamp_ms();
    if (now <= pool.last_accrued_ms) return;
    let dt = (now - pool.last_accrued_ms) as u128;
    let borrowed = current_borrowed_u128(pool);
    if (borrowed > 0) {
        let liq = balance::value(&pool.liquidity) as u128;
        let denom = borrowed + liq;
        let util_bps = if (denom == 0) { 0 } else { borrowed * BPS / denom };
        let rate_bps = (pool.base_rate_bps as u128) + (pool.slope_bps as u128) * util_bps / BPS;
        // borrow_index *= (1 + rate * dt / year)
        let growth = pool.borrow_index * rate_bps * dt / (BPS * MS_PER_YEAR);
        pool.borrow_index = pool.borrow_index + growth;
    };
    pool.last_accrued_ms = now;
}

// ─── LP supply / withdraw ───

public fun supply<T>(pool: &mut LendingPool<T>, coin: Coin<T>, clock: &Clock, ctx: &mut TxContext): SupplyPosition {
    assert!(!pool.paused, EPaused);
    accrue(pool, clock);
    let amount = coin.value();
    assert!(amount > 0, EZeroAmount);
    let tv = total_value_u128(pool);
    let shares = if (pool.supply_shares == 0 || tv == 0) {
        (amount as u128)
    } else {
        (amount as u128) * pool.supply_shares / tv
    };
    pool.supply_shares = pool.supply_shares + shares;
    balance::join(&mut pool.liquidity, coin.into_balance());
    event::emit(Supplied { pool: object::id(pool), who: ctx.sender(), amount, shares });
    SupplyPosition { id: object::new(ctx), pool: object::id(pool), shares }
}

/// Redeem an entire SupplyPosition for its current value (principal + interest).
public fun withdraw<T>(pool: &mut LendingPool<T>, pos: SupplyPosition, clock: &Clock, ctx: &mut TxContext): Coin<T> {
    assert!(pos.pool == object::id(pool), EWrongPool);
    accrue(pool, clock);
    let SupplyPosition { id, shares, .. } = pos;
    id.delete();
    let tv = total_value_u128(pool);
    let value = if (pool.supply_shares == 0) { 0 } else { (shares * tv / pool.supply_shares) as u64 };
    assert!(balance::value(&pool.liquidity) >= value, EInsufficientLiquidity);
    pool.supply_shares = pool.supply_shares - shares;
    let out = balance::split(&mut pool.liquidity, value).into_coin(ctx);
    event::emit(SupplyRedeemed { pool: object::id(pool), who: ctx.sender(), amount: value, shares });
    out
}

// ─── borrow / repay (leverage module only) ───

/// Draw `amount` of liquidity. Returns the funds and the loan's principal_scaled,
/// which the borrower must store and pass back to `repay`.
public(package) fun borrow<T>(pool: &mut LendingPool<T>, amount: u64, clock: &Clock): (Balance<T>, u128) {
    assert!(!pool.paused, EPaused);
    assert!(amount > 0, EZeroAmount);
    accrue(pool, clock);
    assert!(balance::value(&pool.liquidity) >= amount, EInsufficientLiquidity);
    let principal_scaled = (amount as u128) * RAY / pool.borrow_index;
    pool.total_borrow_scaled = pool.total_borrow_scaled + principal_scaled;
    let out = balance::split(&mut pool.liquidity, amount);
    event::emit(Borrowed { pool: object::id(pool), amount, principal_scaled });
    (out, principal_scaled)
}

/// Repay a loan in full. `payment` must cover the current debt; any excess is
/// returned to the caller. Reduces outstanding debt by `principal_scaled`.
public(package) fun repay<T>(pool: &mut LendingPool<T>, mut payment: Balance<T>, principal_scaled: u128, clock: &Clock): Balance<T> {
    accrue(pool, clock);
    let owed = (principal_scaled * pool.borrow_index / RAY) as u64;
    assert!(balance::value(&payment) >= owed, ERepayTooLittle);
    balance::join(&mut pool.liquidity, balance::split(&mut payment, owed));
    pool.total_borrow_scaled = if (pool.total_borrow_scaled > principal_scaled) {
        pool.total_borrow_scaled - principal_scaled
    } else { 0 };
    event::emit(DebtRepaymentRecorded { pool: object::id(pool), amount: owed, principal_scaled });
    payment
}

/// Absorb a shortfall (bad debt) during liquidation: take whatever `payment`
/// covers, clear the loan, and socialise any loss across suppliers (lower
/// exchange rate). Only the leverage module's liquidation path calls this.
public(package) fun repay_lossy<T>(pool: &mut LendingPool<T>, payment: Balance<T>, principal_scaled: u128, clock: &Clock) {
    accrue(pool, clock);
    balance::join(&mut pool.liquidity, payment);
    pool.total_borrow_scaled = if (pool.total_borrow_scaled > principal_scaled) {
        pool.total_borrow_scaled - principal_scaled
    } else { 0 };
}

// ─── views ───

fun current_borrowed_u128<T>(pool: &LendingPool<T>): u128 {
    pool.total_borrow_scaled * pool.borrow_index / RAY
}

fun total_value_u128<T>(pool: &LendingPool<T>): u128 {
    (balance::value(&pool.liquidity) as u128) + current_borrowed_u128(pool)
}

/// Current debt (incl. accrued interest) for a loan of `principal_scaled`.
public fun debt_of<T>(pool: &LendingPool<T>, principal_scaled: u128): u64 {
    (principal_scaled * pool.borrow_index / RAY) as u64
}

public fun available_liquidity<T>(pool: &LendingPool<T>): u64 { balance::value(&pool.liquidity) }
public fun total_borrowed<T>(pool: &LendingPool<T>): u64 { current_borrowed_u128(pool) as u64 }
public fun total_value<T>(pool: &LendingPool<T>): u64 { total_value_u128(pool) as u64 }
public fun supply_shares<T>(pool: &LendingPool<T>): u128 { pool.supply_shares }
public fun borrow_index<T>(pool: &LendingPool<T>): u128 { pool.borrow_index }
public fun shares_of(pos: &SupplyPosition): u128 { pos.shares }

/// Utilization in bps (borrowed / (borrowed + idle)).
public fun utilization_bps<T>(pool: &LendingPool<T>): u64 {
    let b = current_borrowed_u128(pool);
    let denom = b + (balance::value(&pool.liquidity) as u128);
    if (denom == 0) { 0 } else { (b * BPS / denom) as u64 }
}

/// Current annualized borrow APR (bps).
public fun borrow_apr_bps<T>(pool: &LendingPool<T>): u64 {
    pool.base_rate_bps + (((pool.slope_bps as u128) * (utilization_bps(pool) as u128) / BPS) as u64)
}

// ─── test-only ───
#[test_only]
public fun current_value_of<T>(pool: &LendingPool<T>, pos: &SupplyPosition): u64 {
    if (pool.supply_shares == 0) { 0 } else { (pos.shares * total_value_u128(pool) / pool.supply_shares) as u64 }
}
