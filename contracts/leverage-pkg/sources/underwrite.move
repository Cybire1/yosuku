/// Underwriting reserve for leveraged Predict positions.
///
/// This is the *sound* model for leverage on a binary (0/1) payoff, where there is
/// no surviving collateral to liquidate. Instead of lending against the position,
/// the reserve is the **counterparty**: a trader posts `margin`, the reserve
/// **fronts** the rest of the notional and charges a **premium** up front. The
/// trader then mints a Predict position with the combined notional.
///
/// Key properties — by construction, not by a keeper:
///   • The trader has **no debt**. Their maximum loss is their `margin`.
///   • There is **nothing to liquidate** mid-round. Settlement is deterministic.
///   • On a win, the trader's own close PTB redeems the position and returns the
///     proceeds through `settle`, which reclaims the fronted capital first; the
///     remainder (their amplified PnL) goes to the trader.
///   • On a loss, the position is worth 0 — the reserve eats the fronted amount,
///     funded statistically by the premiums it collects on every open plus a
///     per-reserve **exposure cap** that bounds how much can be at risk at once.
///
/// Suppliers `supply` DUSDC and earn the premiums (their share value grows as
/// premiums accrue and shrinks when a fronted position loses).
///
/// Scope note (testnet): like most composed-PTB DeFi, `open` hands back the
/// notional coin for the *same PTB* to mint with. A hand-crafted malicious PTB
/// could take the fronted funds without minting; the app always mints atomically,
/// and the exposure cap bounds the worst case. A production build would lock the
/// funds via module-controlled minting or a funding hot-potato.
module yolev::underwrite;

use sui::{
    balance::{Self, Balance},
    coin::{Self, Coin},
    clock::Clock,
    event,
};

// ─── errors ───
const ENotAdmin: u64 = 1;
const EZero: u64 = 2;
const EPaused: u64 = 3;
const ELeverageTooHigh: u64 = 4;
const EExposureCap: u64 = 5;
const EInsufficientLiquidity: u64 = 6;
const EWrongReserve: u64 = 7;
const ENotOwner: u64 = 8;
const ENotExpired: u64 = 9;
const EBadConfig: u64 = 10;
const ENotKeeper: u64 = 11;

const BPS: u128 = 10_000;

/// The underwriting reserve for quote asset `T`.
public struct Reserve<phantom T> has key {
    id: UID,
    /// Idle, withdrawable liquidity.
    liquid: Balance<T>,
    /// Fronted capital currently deployed in open leveraged positions (at cost).
    outstanding: u64,
    /// Total supplier shares outstanding.
    supply_shares: u128,
    admin: address,
    paused: bool,
    /// The settlement/fill keeper EOA — the OWNER of `leverage_manager`, the only
    /// address that can deposit/mint/withdraw there, and the only one allowed to
    /// `fill` orders. The keeper can never divert funds (settle force-pays owners).
    keeper: address,
    /// The protocol-owned (keeper-owned) PredictManager that custodies every
    /// leveraged position. Recorded so `fill` can stamp it into each Position.
    leverage_manager: ID,
    // ── params ──
    /// Max notional as a multiple of margin, bps (30000 = 3x).
    max_leverage_bps: u64,
    /// House premium charged on the fronted amount, bps (800 = 8%).
    premium_bps: u64,
    /// Max `outstanding` as a fraction of total value, bps (6000 = 60%).
    max_exposure_bps: u64,
}

/// An escrowed open request. The trader holds their margin here (a shared object)
/// until the keeper `fill`s it (executes the open into custody) or the trader
/// `cancel`s it. Funds are safe either way — only the trader can cancel, and fill
/// can only mint a Position owned by `trader`.
public struct OpenOrder<phantom T> has key {
    id: UID,
    reserve: ID,
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

/// A supplier's claim on the reserve. Value = shares * total_value / supply_shares.
public struct SupplyPosition has key, store {
    id: UID,
    reserve: ID,
    shares: u128,
}

/// A trader's open leveraged (underwritten) position. No debt — just a record of
/// the margin, the reserve's fronted capital, the premium paid, and a descriptor
/// of the Predict position it funded so the close PTB can redeem exactly it.
public struct Position<phantom T> has key, store {
    id: UID,
    owner: address,
    reserve: ID,
    margin: u64,
    fronted: u64,
    premium: u64,
    notional: u64, // deployed into the Predict position = (margin - premium) + fronted
    opened_ms: u64,
    // ── position descriptor ──
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
public struct ReserveCreated has copy, drop { reserve: ID, admin: address, max_leverage_bps: u64, premium_bps: u64 }
public struct Supplied has copy, drop { reserve: ID, who: address, amount: u64, shares: u128 }
public struct SupplyRedeemed has copy, drop { reserve: ID, who: address, amount: u64, shares: u128 }
public struct OrderRequested has copy, drop { order: ID, reserve: ID, trader: address, margin: u64, leverage_bps: u64, oracle_id: ID, is_range: bool }
public struct OrderFilled has copy, drop { order: ID, position: ID, trader: address, margin: u64, fronted: u64, premium: u64, notional: u64 }
public struct OrderCancelled has copy, drop { order: ID, trader: address, margin: u64 }
public struct Settled has copy, drop { position: ID, owner: address, proceeds: u64, reclaimed: u64, returned: u64 }
public struct BadDebtRecorded has copy, drop { position: ID, owner: address, fronted: u64 }
public struct ParamsUpdated has copy, drop { reserve: ID, max_leverage_bps: u64, premium_bps: u64, max_exposure_bps: u64 }

// ─── create / admin ───

public fun create<T>(leverage_manager: ID, keeper: address, max_leverage_bps: u64, premium_bps: u64, max_exposure_bps: u64, ctx: &mut TxContext) {
    assert!(max_leverage_bps >= 10_000 && premium_bps < 10_000 && max_exposure_bps <= 10_000, EBadConfig);
    let r = Reserve<T> {
        id: object::new(ctx),
        liquid: balance::zero<T>(),
        outstanding: 0,
        supply_shares: 0,
        admin: ctx.sender(),
        paused: false,
        keeper,
        leverage_manager,
        max_leverage_bps,
        premium_bps,
        max_exposure_bps,
    };
    event::emit(ReserveCreated { reserve: object::id(&r), admin: ctx.sender(), max_leverage_bps, premium_bps });
    transfer::share_object(r);
}

/// Admin: rotate the keeper or the custody manager.
public fun set_keeper<T>(r: &mut Reserve<T>, leverage_manager: ID, keeper: address, ctx: &mut TxContext) {
    assert!(ctx.sender() == r.admin, ENotAdmin);
    r.keeper = keeper;
    r.leverage_manager = leverage_manager;
}

public fun set_params<T>(r: &mut Reserve<T>, max_leverage_bps: u64, premium_bps: u64, max_exposure_bps: u64, ctx: &mut TxContext) {
    assert!(ctx.sender() == r.admin, ENotAdmin);
    assert!(max_leverage_bps >= 10_000 && premium_bps < 10_000 && max_exposure_bps <= 10_000, EBadConfig);
    r.max_leverage_bps = max_leverage_bps;
    r.premium_bps = premium_bps;
    r.max_exposure_bps = max_exposure_bps;
    event::emit(ParamsUpdated { reserve: object::id(r), max_leverage_bps, premium_bps, max_exposure_bps });
}

public fun set_paused<T>(r: &mut Reserve<T>, paused: bool, ctx: &mut TxContext) {
    assert!(ctx.sender() == r.admin, ENotAdmin);
    r.paused = paused;
}

// ─── supplier supply / withdraw ───

public fun supply<T>(r: &mut Reserve<T>, coin: Coin<T>, ctx: &mut TxContext): SupplyPosition {
    assert!(!r.paused, EPaused);
    let amount = coin.value();
    assert!(amount > 0, EZero);
    let tv = total_value_u128(r);
    let shares = if (r.supply_shares == 0 || tv == 0) { (amount as u128) } else { (amount as u128) * r.supply_shares / tv };
    r.supply_shares = r.supply_shares + shares;
    balance::join(&mut r.liquid, coin.into_balance());
    event::emit(Supplied { reserve: object::id(r), who: ctx.sender(), amount, shares });
    SupplyPosition { id: object::new(ctx), reserve: object::id(r), shares }
}

public fun withdraw<T>(r: &mut Reserve<T>, pos: SupplyPosition, ctx: &mut TxContext): Coin<T> {
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

// ─── open: escrow → fill (the trustless custody handshake) ───
//
// Predict managers are owner-private (deposit/mint/withdraw gated by ctx.sender,
// no delegate cap), so a leveraged position can only be custodied in a manager the
// KEEPER owns — and only the keeper can deposit/mint there. But only the TRADER can
// spend their own margin. One tx has one sender, so the open is split in two:
//   1) request_open — trader escrows their margin into a shared OpenOrder.
//   2) fill — keeper consumes the order, fronts, and (in the same PTB) deposits +
//      mints into the keeper-owned manager. The Position is owned by the trader.
// The trader can `cancel` anytime before fill to reclaim their margin, so the
// keeper is a liveness dependency only — never a custody-of-funds one.

/// Trader: escrow `margin` and the trade intent. Creates a shared OpenOrder the
/// keeper will fill. Validates only the leverage cap here; fronting + the exposure
/// check happen at fill time against live reserve state.
public fun request_open<T>(
    r: &Reserve<T>,
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
    assert!(!r.paused, EPaused);
    let m = margin.value();
    assert!(m > 0, EZero);
    assert!(leverage_bps >= 10_000 && leverage_bps <= r.max_leverage_bps, ELeverageTooHigh);
    let order = OpenOrder<T> {
        id: object::new(ctx),
        reserve: object::id(r),
        trader: ctx.sender(),
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
    event::emit(OrderRequested { order: object::id(&order), reserve: object::id(r), trader: ctx.sender(), margin: m, leverage_bps, oracle_id, is_range });
    transfer::share_object(order);
}

/// Trader: reclaim an unfilled order's margin (e.g. the keeper is down). Only the
/// original trader can cancel; the margin goes straight back to them.
public fun cancel<T>(r: &Reserve<T>, order: OpenOrder<T>, ctx: &mut TxContext): Coin<T> {
    let OpenOrder { id, reserve: rid, trader, margin, .. } = order;
    assert!(rid == object::id(r), EWrongReserve);
    assert!(ctx.sender() == trader, ENotOwner);
    let oid = id.to_inner();
    id.delete();
    event::emit(OrderCancelled { order: oid, trader, margin: balance::value(&margin) });
    margin.into_coin(ctx)
}

/// Keeper: execute an escrowed order. Fronts the reserve's capital, charges the
/// premium, mints a Position OWNED BY THE TRADER, and returns the notional coin for
/// the same PTB to deposit + mint into the keeper-owned manager. `quantity` is the
/// keeper's live-quoted size; the PTB must mint exactly it (else the tx reverts and
/// the order is untouched). Only the keeper may call this.
public fun fill<T>(
    r: &mut Reserve<T>,
    order: OpenOrder<T>,
    quantity: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<T> {
    assert!(!r.paused, EPaused);
    assert!(ctx.sender() == r.keeper, ENotKeeper);
    let OpenOrder { id, reserve: rid, trader, margin, leverage_bps, oracle_id, expiry, is_range, lower_strike, higher_strike, is_up, .. } = order;
    assert!(rid == object::id(r), EWrongReserve);
    let order_id = id.to_inner();
    id.delete();

    let m = balance::value(&margin);
    let notional_gross = ((m as u128) * (leverage_bps as u128) / BPS) as u64;
    let fronted = notional_gross - m;
    let premium = ((fronted as u128) * (r.premium_bps as u128) / BPS) as u64;

    // exposure cap + liquidity (escrowed margins are NOT in total_value)
    let tv = total_value_u128(r);
    assert!(((r.outstanding + fronted) as u128) * BPS <= tv * (r.max_exposure_bps as u128), EExposureCap);
    assert!(balance::value(&r.liquid) >= fronted, EInsufficientLiquidity);

    // premium → reserve (booked income); front reserve capital into the notional
    let mut notional_bal = margin;
    balance::join(&mut r.liquid, balance::split(&mut notional_bal, premium));
    balance::join(&mut notional_bal, balance::split(&mut r.liquid, fronted));
    r.outstanding = r.outstanding + fronted;
    let notional = balance::value(&notional_bal);

    let pos = Position<T> {
        id: object::new(ctx),
        owner: trader,
        reserve: object::id(r),
        margin: m,
        fronted,
        premium,
        notional,
        opened_ms: clock.timestamp_ms(),
        manager_id: r.leverage_manager,
        oracle_id,
        expiry,
        is_range,
        lower_strike,
        higher_strike,
        is_up,
        quantity,
    };
    event::emit(OrderFilled { order: order_id, position: object::id(&pos), trader, margin: m, fronted, premium, notional });
    // SHARED, not owned — so the keeper can reference it to settle. The `owner` field
    // (not object ownership) records the trader; `settle` force-pays that owner.
    transfer::share_object(pos);
    notional_bal.into_coin(ctx)
}

// ─── settle (permissionless crank) ───

/// Settle a position: pass the redeemed `proceeds` (face value for a winner; a ~0
/// coin for a loser). The reserve reclaims its fronted capital first; the remainder
/// (the trader's amplified PnL) is sent to the position OWNER — never the caller.
/// This is **permissionless**: the keeper settles every position, but a trader can
/// also self-settle if the keeper is down. Because funds can only ever route to the
/// owner, and the position lives in a protocol-controlled manager, the reserve is
/// always repaid its fronted capital and no one can divert the proceeds.
public fun settle<T>(
    r: &mut Reserve<T>,
    pos: Position<T>,
    proceeds: Coin<T>,
    ctx: &mut TxContext,
) {
    let Position { id, owner, reserve: rid, fronted, .. } = pos;
    assert!(rid == object::id(r), EWrongReserve);
    let pos_id = id.to_inner();
    id.delete();

    // the fronted capital is no longer deployed
    r.outstanding = if (r.outstanding > fronted) { r.outstanding - fronted } else { 0 };

    let p = proceeds.value();
    let reclaim = if (p >= fronted) { fronted } else { p };
    let mut pbal = proceeds.into_balance();
    balance::join(&mut r.liquid, balance::split(&mut pbal, reclaim));
    let returned = balance::value(&pbal);
    event::emit(Settled { position: pos_id, owner, proceeds: p, reclaimed: reclaim, returned });
    // PnL (if any) always goes to the trader, regardless of who cranked the settle
    if (returned > 0) {
        transfer::public_transfer(pbal.into_coin(ctx), owner);
    } else {
        balance::destroy_zero(pbal);
    };
}

// ─── admin cleanup ───

/// Write off an abandoned position after expiry (a loser the owner never closed):
/// realise the fronted loss in the reserve accounting and delete the receipt. The
/// trader's own (worthless) Predict position is untouched. Admin-only and gated to
/// after expiry, so it can never deny a live or winning position its reclaim.
public fun admin_writeoff<T>(r: &mut Reserve<T>, pos: Position<T>, clock: &Clock, ctx: &mut TxContext) {
    assert!(ctx.sender() == r.admin, ENotAdmin);
    assert!(clock.timestamp_ms() > pos.expiry, ENotExpired);
    let Position { id, owner, reserve: rid, fronted, .. } = pos;
    assert!(rid == object::id(r), EWrongReserve);
    let pos_id = id.to_inner();
    id.delete();
    r.outstanding = if (r.outstanding > fronted) { r.outstanding - fronted } else { 0 };
    event::emit(BadDebtRecorded { position: pos_id, owner, fronted });
}

// ─── views ───

fun total_value_u128<T>(r: &Reserve<T>): u128 {
    (balance::value(&r.liquid) as u128) + (r.outstanding as u128)
}

/// Premium (in T) the reserve would charge for `margin` at `leverage_bps`.
public fun quote_premium<T>(r: &Reserve<T>, margin: u64, leverage_bps: u64): u64 {
    let notional_gross = ((margin as u128) * (leverage_bps as u128) / BPS) as u64;
    let fronted = if (notional_gross > margin) { notional_gross - margin } else { 0 };
    ((fronted as u128) * (r.premium_bps as u128) / BPS) as u64
}

public fun available_liquidity<T>(r: &Reserve<T>): u64 { balance::value(&r.liquid) }
public fun outstanding<T>(r: &Reserve<T>): u64 { r.outstanding }
public fun total_value<T>(r: &Reserve<T>): u64 { total_value_u128(r) as u64 }
public fun supply_shares<T>(r: &Reserve<T>): u128 { r.supply_shares }
public fun max_leverage_bps<T>(r: &Reserve<T>): u64 { r.max_leverage_bps }
public fun premium_bps<T>(r: &Reserve<T>): u64 { r.premium_bps }
public fun max_exposure_bps<T>(r: &Reserve<T>): u64 { r.max_exposure_bps }
public fun keeper<T>(r: &Reserve<T>): address { r.keeper }
public fun leverage_manager<T>(r: &Reserve<T>): ID { r.leverage_manager }
public fun shares_of(pos: &SupplyPosition): u128 { pos.shares }
public fun position_owner<T>(pos: &Position<T>): address { pos.owner }
public fun position_quantity<T>(pos: &Position<T>): u64 { pos.quantity }
public fun utilization_bps<T>(r: &Reserve<T>): u64 {
    let tv = total_value_u128(r);
    if (tv == 0) { 0 } else { ((r.outstanding as u128) * BPS / tv) as u64 }
}

#[test_only]
public fun share_value<T>(r: &Reserve<T>, pos: &SupplyPosition): u64 {
    if (r.supply_shares == 0) { 0 } else { (pos.shares * total_value_u128(r) / r.supply_shares) as u64 }
}
