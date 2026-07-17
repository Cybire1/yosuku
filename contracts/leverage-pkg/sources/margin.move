/// Margin desk for leveraged Predict positions — the **borrow-and-liquidate** model,
/// made to work on the LIVE binary market.
///
/// Mysten's Predict leverage (the unmerged `at/predict-leverage-redesign` branch)
/// borrows against collateral and liquidates underwater positions — but it targets
/// ExpiryMarket, a continuous CLOB, on the premise that "you can't liquidate a binary
/// 0/1 bet" (no surviving collateral, settlement jumps 0↔1).
///
/// You can. Predict's `redeem` works MID-ROUND and pays the live bid mark
/// (`predict::redeem`, pre-settlement → `bid * quantity`). A binary position therefore
/// has a continuously-updating, recoverable value all through the round. The only
/// thing blocking liquidation is *custody*: Predict managers are owner-gated, so a
/// liquidator can't reach a position sitting in the trader's manager. We custody every
/// leveraged position in an **agent-owned manager** (the escrow→fill handshake), so the
/// agent can redeem it at mark the instant health drops — repaying the pool *before*
/// settlement, exactly like a real margin desk.
///
/// Flow:
///   • `request_open` (trader): escrow margin + leverage intent into a shared OpenOrder.
///   • `fill` (agent): borrow the rest from the `lending_pool`, hand back the notional
///     for the *same PTB* to mint into the agent-owned custody manager; record a shared
///     `MarginPosition` (owner = trader, debt handle = `principal_scaled`).
///   • `liquidate` (permissionless to trigger, agent-executed): when the live mark falls
///     below `debt * maintenance`, redeem at mark → repay pool → liquidator penalty →
///     remainder to the trader. Move asserts undercollateralisation on the REAL
///     proceeds, so the agent can execute but can never fake a liquidation or divert.
///   • `close` (at settlement / voluntary): redeem → repay debt → amplified PnL to trader.
///   • `cancel` (trader, pre-fill) / `admin_writeoff` (post-expiry bad debt): liveness.
///
/// Capital comes from `yolev::lending_pool` (suppliers earn the borrow interest).
/// This desk only orchestrates custody, debt, and liquidation — it never holds the
/// pool's liquidity.
module yolev::margin;

use sui::{
    balance::{Self, Balance},
    coin::{Self, Coin},
    clock::Clock,
    event,
};
use yolev::lending_pool::{Self, LendingPool};

// ─── errors ───
const ENotAdmin: u64 = 1;
const EZero: u64 = 2;
const EPaused: u64 = 3;
const ELeverageTooHigh: u64 = 4;
const EWrongDesk: u64 = 5;
const EWrongPool: u64 = 6;
const ENotOwner: u64 = 7;
const ENotKeeper: u64 = 8;
const ENotExpired: u64 = 9;
const EBadConfig: u64 = 10;
const EStillHealthy: u64 = 11;

const BPS: u128 = 10_000;

/// The margin desk for quote asset `T`. Binds an agent keeper + its custody manager
/// to a lending pool, and carries the risk params. Shared; capital lives in the pool.
public struct MarginDesk<phantom T> has key {
    id: UID,
    admin: address,
    paused: bool,
    /// The agent EOA — OWNER of `custody_manager`, the only address that can
    /// deposit/mint/redeem/withdraw there, hence the only one that can `fill`,
    /// `liquidate`, or `close`. It can never divert funds (every exit force-pays the
    /// position owner or the pool).
    keeper: address,
    /// The agent-owned PredictManager that custodies every leveraged position.
    custody_manager: ID,
    /// The lending pool this desk borrows from.
    pool: ID,
    // ── params ──
    /// Max notional as a multiple of margin, bps (30000 = 3x).
    max_leverage_bps: u64,
    /// Liquidatable when `position_mark * BPS < debt * maintenance_bps` (12000 = 120%).
    maintenance_bps: u64,
    /// Liquidator reward off the top of the recovered proceeds, bps (500 = 5%).
    liq_penalty_bps: u64,
}

/// An escrowed open request. The trader's margin rests here (a shared object) until
/// the agent `fill`s it or the trader `cancel`s it — safe either way.
public struct OpenOrder<phantom T> has key {
    id: UID,
    desk: ID,
    trader: address,
    margin: Balance<T>,
    leverage_bps: u64,
    oracle_id: ID,
    expiry: u64,
    is_range: bool,
    lower_strike: u64,
    higher_strike: u64,
    is_up: bool,
    created_ms: u64,
}

/// A live leveraged position. Custodied in the desk's `custody_manager`; the `owner`
/// field (not object ownership) records the trader, and every exit force-pays them.
/// `principal_scaled` is the debt handle into the pool (index-based, accrues interest).
public struct MarginPosition<phantom T> has key, store {
    id: UID,
    owner: address,
    desk: ID,
    pool: ID,
    margin: u64,
    borrowed: u64,
    notional: u64, // margin + borrowed, deployed into the Predict position
    principal_scaled: u128,
    opened_ms: u64,
    // ── position descriptor (so an exit PTB redeems exactly this position) ──
    manager_id: ID,
    oracle_id: ID,
    expiry: u64,
    is_range: bool,
    lower_strike: u64,  // binary: strike; range: lower bound
    higher_strike: u64, // range: upper bound (0 for binary)
    is_up: bool,
    quantity: u64,
}

// ─── events ───
public struct DeskCreated has copy, drop { desk: ID, admin: address, pool: ID, keeper: address, max_leverage_bps: u64, maintenance_bps: u64, liq_penalty_bps: u64 }
public struct ParamsUpdated has copy, drop { desk: ID, max_leverage_bps: u64, maintenance_bps: u64, liq_penalty_bps: u64 }
public struct OrderRequested has copy, drop { order: ID, desk: ID, trader: address, margin: u64, leverage_bps: u64, oracle_id: ID, expiry: u64, is_range: bool, lower_strike: u64, higher_strike: u64, is_up: bool }
public struct OrderCancelled has copy, drop { order: ID, trader: address, margin: u64 }
public struct PositionOpened has copy, drop { order: ID, position: ID, owner: address, margin: u64, borrowed: u64, notional: u64, quantity: u64 }
public struct CloseRequested has copy, drop { position: ID, owner: address }
public struct Closed has copy, drop { position: ID, owner: address, proceeds: u64, debt_repaid: u64, returned: u64 }
public struct Liquidated has copy, drop { position: ID, owner: address, liquidator: address, proceeds: u64, debt: u64, penalty: u64, returned: u64, shortfall: u64 }
public struct BadDebtRecorded has copy, drop { position: ID, owner: address, borrowed: u64 }

// ─── create / admin ───

public fun create_desk<T>(
    pool: &LendingPool<T>,
    custody_manager: ID,
    keeper: address,
    max_leverage_bps: u64,
    maintenance_bps: u64,
    liq_penalty_bps: u64,
    ctx: &mut TxContext,
) {
    assert!(max_leverage_bps >= 10_000 && maintenance_bps >= 10_000 && liq_penalty_bps < 5_000, EBadConfig);
    let desk = MarginDesk<T> {
        id: object::new(ctx),
        admin: ctx.sender(),
        paused: false,
        keeper,
        custody_manager,
        pool: object::id(pool),
        max_leverage_bps,
        maintenance_bps,
        liq_penalty_bps,
    };
    event::emit(DeskCreated {
        desk: object::id(&desk), admin: ctx.sender(), pool: object::id(pool), keeper,
        max_leverage_bps, maintenance_bps, liq_penalty_bps,
    });
    transfer::share_object(desk);
}

/// Admin: rotate the agent keeper and its custody manager (e.g. moving the keeper
/// identity into a TEE enclave with a fresh enclave-owned manager).
public fun set_keeper<T>(d: &mut MarginDesk<T>, custody_manager: ID, keeper: address, ctx: &mut TxContext) {
    assert!(ctx.sender() == d.admin, ENotAdmin);
    d.keeper = keeper;
    d.custody_manager = custody_manager;
}

public fun set_params<T>(d: &mut MarginDesk<T>, max_leverage_bps: u64, maintenance_bps: u64, liq_penalty_bps: u64, ctx: &mut TxContext) {
    assert!(ctx.sender() == d.admin, ENotAdmin);
    assert!(max_leverage_bps >= 10_000 && maintenance_bps >= 10_000 && liq_penalty_bps < 5_000, EBadConfig);
    d.max_leverage_bps = max_leverage_bps;
    d.maintenance_bps = maintenance_bps;
    d.liq_penalty_bps = liq_penalty_bps;
    event::emit(ParamsUpdated { desk: object::id(d), max_leverage_bps, maintenance_bps, liq_penalty_bps });
}

public fun set_paused<T>(d: &mut MarginDesk<T>, paused: bool, ctx: &mut TxContext) {
    assert!(ctx.sender() == d.admin, ENotAdmin);
    d.paused = paused;
}

// ─── open: escrow → fill (the custody handshake) ───
//
// Predict managers are owner-gated (deposit/mint/redeem/withdraw all assert
// ctx.sender == owner, NO delegate cap). A leveraged position can therefore only be
// custodied — and later liquidated — in a manager the AGENT owns. But only the TRADER
// can spend their own margin, and one tx has one sender, so the open is two steps.

/// Trader: escrow `margin` + the leverage intent. Validates the leverage cap; the
/// borrow + liquidity draw happen at `fill` against live pool state.
public fun request_open<T>(
    d: &MarginDesk<T>,
    margin: Coin<T>,
    oracle_id: ID,
    leverage_bps: u64,
    expiry: u64,
    is_range: bool,
    lower_strike: u64,
    higher_strike: u64,
    is_up: bool,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    new_order(d, ctx.sender(), margin, leverage_bps, oracle_id, expiry, is_range, lower_strike, higher_strike, is_up, clock, ctx);
}

/// Escrow an order on behalf of `owner`, funded by whoever supplies `margin`. The
/// resulting `MarginPosition` is owned (by field) by `owner`, so every exit force-pays
/// `owner` — NOT the caller. This is the custody primitive the `social_vault` uses: a
/// vault debits a user's escrowed balance and opens a position the user owns, so even a
/// fully-hijacked agent can only move the user's own position, never divert to itself.
/// Anyone may call (the funds and the position both belong to `owner`); the cap is still
/// enforced and `fill` is still keeper-gated.
public fun request_open_for<T>(
    d: &MarginDesk<T>,
    margin: Coin<T>,
    oracle_id: ID,
    owner: address,
    leverage_bps: u64,
    expiry: u64,
    is_range: bool,
    lower_strike: u64,
    higher_strike: u64,
    is_up: bool,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    new_order(d, owner, margin, leverage_bps, oracle_id, expiry, is_range, lower_strike, higher_strike, is_up, clock, ctx);
}

/// Shared escrow logic for `request_open` / `request_open_for`. The position's `trader`
/// is whatever `owner` the caller specifies; the leverage cap is validated here so no
/// entry point can bypass it.
fun new_order<T>(
    d: &MarginDesk<T>,
    owner: address,
    margin: Coin<T>,
    leverage_bps: u64,
    oracle_id: ID,
    expiry: u64,
    is_range: bool,
    lower_strike: u64,
    higher_strike: u64,
    is_up: bool,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(!d.paused, EPaused);
    let m = margin.value();
    assert!(m > 0, EZero);
    assert!(leverage_bps >= 10_000 && leverage_bps <= d.max_leverage_bps, ELeverageTooHigh);
    let order = OpenOrder<T> {
        id: object::new(ctx),
        desk: object::id(d),
        trader: owner,
        margin: margin.into_balance(),
        leverage_bps,
        oracle_id,
        expiry,
        is_range,
        lower_strike,
        higher_strike,
        is_up,
        created_ms: clock.timestamp_ms(),
    };
    event::emit(OrderRequested {
        order: object::id(&order), desk: object::id(d), trader: owner,
        margin: m, leverage_bps, oracle_id, expiry, is_range, lower_strike, higher_strike, is_up,
    });
    transfer::share_object(order);
}

/// Trader: reclaim an unfilled order's margin (e.g. the agent is down). Only the
/// original trader can cancel — pure liveness, never a custody dependency.
public fun cancel<T>(d: &MarginDesk<T>, order: OpenOrder<T>, ctx: &mut TxContext): Coin<T> {
    let OpenOrder { id, desk, trader, margin, .. } = order;
    assert!(desk == object::id(d), EWrongDesk);
    assert!(ctx.sender() == trader, ENotOwner);
    let oid = id.to_inner();
    id.delete();
    event::emit(OrderCancelled { order: oid, trader, margin: balance::value(&margin) });
    margin.into_coin(ctx)
}

/// Agent: execute an escrowed order. Borrows `notional - margin` from the pool,
/// combines it with the margin, and returns the notional coin for the SAME PTB to
/// deposit + mint into the agent-owned custody manager. Records a shared
/// `MarginPosition` owned (by field) by the trader. `quantity` is the agent's
/// live-quoted size; the PTB must mint exactly it. Only the agent keeper may call.
public fun fill<T>(
    d: &MarginDesk<T>,
    pool: &mut LendingPool<T>,
    order: OpenOrder<T>,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<T> {
    assert!(!d.paused, EPaused);
    assert!(ctx.sender() == d.keeper, ENotKeeper);
    assert!(object::id(pool) == d.pool, EWrongPool);
    let OpenOrder { id, desk, trader, margin, leverage_bps, oracle_id, expiry, is_range, lower_strike, higher_strike, is_up, .. } = order;
    assert!(desk == object::id(d), EWrongDesk);
    let order_id = id.to_inner();
    id.delete();

    let m = balance::value(&margin);
    let notional_gross = ((m as u128) * (leverage_bps as u128) / BPS) as u64;
    // (margin + borrowed) / margin <= max_leverage
    assert!((notional_gross as u128) * BPS <= (m as u128) * (d.max_leverage_bps as u128), ELeverageTooHigh);
    let borrow_amount = notional_gross - m;

    let (borrowed_bal, principal_scaled) = lending_pool::borrow(pool, borrow_amount, clock);
    let mut notional_bal = margin;
    balance::join(&mut notional_bal, borrowed_bal);
    let notional = balance::value(&notional_bal);

    let pos = MarginPosition<T> {
        id: object::new(ctx),
        owner: trader,
        desk: object::id(d),
        pool: object::id(pool),
        margin: m,
        borrowed: borrow_amount,
        notional,
        principal_scaled,
        opened_ms: clock.timestamp_ms(),
        manager_id: d.custody_manager,
        oracle_id,
        expiry,
        is_range,
        lower_strike,
        higher_strike,
        is_up,
        quantity,
    };
    event::emit(PositionOpened { order: order_id, position: object::id(&pos), owner: trader, margin: m, borrowed: borrow_amount, notional, quantity });
    transfer::share_object(pos);
    notional_bal.into_coin(ctx)
}

// ─── close (at settlement or voluntary) ───

/// Trader: flag a healthy position for the agent to close (take profit early). Pure
/// signal — the agent redeems it from custody and calls `close`, which force-pays you.
public fun request_close<T>(pos: &MarginPosition<T>, ctx: &mut TxContext) {
    assert!(ctx.sender() == pos.owner, ENotOwner);
    event::emit(CloseRequested { position: object::id(pos), owner: pos.owner });
}

/// Close a position with its redeemed `proceeds` (the face value of a settled winner,
/// or the live mark of a voluntary close). Repays the debt; the remainder (margin ±
/// amplified PnL) is force-paid to the OWNER, never the caller. Aborts if proceeds
/// can't cover the debt — that's the `liquidate` path. Agent-executed (only it can
/// redeem from custody), but safe for anyone to call.
public fun close<T>(
    d: &MarginDesk<T>,
    pool: &mut LendingPool<T>,
    pos: MarginPosition<T>,
    proceeds: Coin<T>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let MarginPosition { id, owner, desk, pool: pid, principal_scaled, .. } = pos;
    assert!(desk == object::id(d), EWrongDesk);
    assert!(pid == object::id(pool), EWrongPool);
    let pos_id = id.to_inner();
    id.delete();

    lending_pool::accrue(pool, clock);
    let debt = lending_pool::debt_of(pool, principal_scaled);
    let p = proceeds.value();
    let remainder = lending_pool::repay(pool, proceeds.into_balance(), principal_scaled, clock);
    let returned = balance::value(&remainder);
    event::emit(Closed { position: pos_id, owner, proceeds: p, debt_repaid: debt, returned });
    if (returned > 0) {
        transfer::public_transfer(remainder.into_coin(ctx), owner);
    } else {
        balance::destroy_zero(remainder);
    };
}

// ─── liquidate (permissionless to trigger, agent-executed) ───

/// Liquidate an undercollateralised position by returning its redeemed-at-mark
/// `proceeds`. Eligible only if `proceeds * BPS < debt * maintenance_bps` — the Move
/// check is on the REAL recovered value, so a liquidation can't be faked. The caller
/// (the agent, in practice — only it can redeem from custody) earns `liq_penalty_bps`
/// of the proceeds; the pool is repaid (shortfall socialised); any leftover force-pays
/// the position owner.
public fun liquidate<T>(
    d: &MarginDesk<T>,
    pool: &mut LendingPool<T>,
    pos: MarginPosition<T>,
    proceeds: Coin<T>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<T> {
    let MarginPosition { id, owner, desk, pool: pid, principal_scaled, .. } = pos;
    assert!(desk == object::id(d), EWrongDesk);
    assert!(pid == object::id(pool), EWrongPool);
    let pos_id = id.to_inner();
    id.delete();

    lending_pool::accrue(pool, clock);
    let debt = lending_pool::debt_of(pool, principal_scaled);
    let pv = proceeds.value();
    // eligible only if undercollateralised
    assert!((pv as u128) * BPS < (debt as u128) * (d.maintenance_bps as u128), EStillHealthy);

    let mut bal = proceeds.into_balance();
    // liquidator reward off the top
    let penalty = ((pv as u128) * (d.liq_penalty_bps as u128) / BPS) as u64;
    let reward = balance::split(&mut bal, penalty);
    let reward_coin = reward.into_coin(ctx);

    let left = balance::value(&bal);
    let mut shortfall = 0;
    let mut returned = 0;
    if (left >= debt) {
        let remainder = lending_pool::repay(pool, bal, principal_scaled, clock);
        returned = balance::value(&remainder);
        if (returned > 0) {
            transfer::public_transfer(remainder.into_coin(ctx), owner);
        } else {
            balance::destroy_zero(remainder);
        };
    } else {
        shortfall = debt - left;
        lending_pool::repay_lossy(pool, bal, principal_scaled, clock);
    };
    event::emit(Liquidated { position: pos_id, owner, liquidator: ctx.sender(), proceeds: pv, debt, penalty, returned, shortfall });
    reward_coin
}

// ─── admin cleanup ───

/// Write off an abandoned position after expiry whose Predict position settled to ~0
/// (a loser the agent never liquidated in time): realise the bad debt in the pool and
/// delete the receipt. Admin-only, gated to after expiry so it can never touch a live
/// or winning position. The (worthless) Predict position in custody is left as-is.
public fun admin_writeoff<T>(d: &MarginDesk<T>, pool: &mut LendingPool<T>, pos: MarginPosition<T>, clock: &Clock, ctx: &mut TxContext) {
    assert!(ctx.sender() == d.admin, ENotAdmin);
    assert!(clock.timestamp_ms() > pos.expiry, ENotExpired);
    let MarginPosition { id, owner, desk, pool: pid, borrowed, principal_scaled, .. } = pos;
    assert!(desk == object::id(d), EWrongDesk);
    assert!(pid == object::id(pool), EWrongPool);
    let pos_id = id.to_inner();
    id.delete();
    lending_pool::accrue(pool, clock);
    // realise the full borrowed principal as bad debt (no proceeds recovered)
    lending_pool::repay_lossy(pool, balance::zero<T>(), principal_scaled, clock);
    event::emit(BadDebtRecorded { position: pos_id, owner, borrowed });
}

// ─── views (health is computed off-chain from the live Predict mark) ───

/// Current debt (principal + accrued interest). Call after `accrue` for exactness.
public fun position_debt<T>(pool: &LendingPool<T>, pos: &MarginPosition<T>): u64 {
    lending_pool::debt_of(pool, pos.principal_scaled)
}

/// Health in bps = `position_mark * BPS / debt`. Below `maintenance_bps` → liquidatable.
/// `position_mark` is the live redeem value (bid * quantity), read off-chain.
public fun health_bps<T>(pool: &LendingPool<T>, pos: &MarginPosition<T>, position_mark: u64): u64 {
    let debt = lending_pool::debt_of(pool, pos.principal_scaled);
    if (debt == 0) { return 1_000_000 };
    (((position_mark as u128) * BPS) / (debt as u128)) as u64
}

/// True if a position with this `position_mark` is liquidatable right now.
public fun is_liquidatable<T>(d: &MarginDesk<T>, pool: &LendingPool<T>, pos: &MarginPosition<T>, position_mark: u64): bool {
    let debt = lending_pool::debt_of(pool, pos.principal_scaled);
    (position_mark as u128) * BPS < (debt as u128) * (d.maintenance_bps as u128)
}

public fun keeper<T>(d: &MarginDesk<T>): address { d.keeper }
public fun custody_manager<T>(d: &MarginDesk<T>): ID { d.custody_manager }
public fun pool_id<T>(d: &MarginDesk<T>): ID { d.pool }
public fun max_leverage_bps<T>(d: &MarginDesk<T>): u64 { d.max_leverage_bps }
public fun maintenance_bps<T>(d: &MarginDesk<T>): u64 { d.maintenance_bps }
public fun liq_penalty_bps<T>(d: &MarginDesk<T>): u64 { d.liq_penalty_bps }
public fun position_owner<T>(pos: &MarginPosition<T>): address { pos.owner }
public fun position_quantity<T>(pos: &MarginPosition<T>): u64 { pos.quantity }
public fun position_borrowed<T>(pos: &MarginPosition<T>): u64 { pos.borrowed }
public fun position_notional<T>(pos: &MarginPosition<T>): u64 { pos.notional }
