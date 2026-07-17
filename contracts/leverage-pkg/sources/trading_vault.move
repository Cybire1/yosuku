/// Yosuku Trading Balance.
///
/// This is the platform account layer for prediction-market UX. Users deposit quote
/// assets once, then route those funds into normal trading, private balance, leverage,
/// and bounded agent/copy-trading flows without giving an agent wallet custody.
///
/// The vault deliberately separates buckets:
/// - `available`: withdrawable, ready for normal trades.
/// - `private_available`: cashouts from private/session routes, withdrawable by owner.
/// - `agent_available`: owner-allocated budget an agent may spend inside policy caps.
/// - `locked_margin`: accounting for margin moved out into an order/position.
///
/// Funds can leave to an arbitrary wallet only through owner-gated withdrawals. Agent
/// execution can only move allocated funds into `margin::request_open_for`, where the
/// resulting leveraged position is owned by the user and every exit force-pays them.
module yolev::trading_vault;

use sui::{
    balance::{Self, Balance},
    coin::{Self, Coin},
    clock::Clock,
    event,
    table::{Self, Table},
};
use yolev::margin::{Self, MarginDesk};

// errors
const ENotAdmin: u64 = 1;
const ENoAccount: u64 = 2;
const EInsufficient: u64 = 3;
const EZero: u64 = 4;
const ENoPolicy: u64 = 5;
const EPolicyInactive: u64 = 6;
const ENotPolicyAgent: u64 = 7;
const EPolicyExpired: u64 = 8;
const EOverTradeCap: u64 = 9;
const ELeverageTooHigh: u64 = 10;

public struct TradingVault<phantom T> has key {
    id: UID,
    admin: address,
    accounts: Table<address, Account<T>>,
    policies: Table<address, AgentPolicy>,
    total_liquid: u64,
    total_locked_margin: u64,
}

public struct Account<phantom T> has store {
    available: Balance<T>,
    private_available: Balance<T>,
    agent_available: Balance<T>,
    locked_margin: u64,
    total_deposited: u64,
    total_withdrawn: u64,
}

public struct AgentPolicy has store, copy, drop {
    agent: address,
    max_trade: u64,
    max_leverage_bps: u64,
    max_daily_loss: u64,
    expires_at_ms: u64,
    active: bool,
}

// events
public struct VaultCreated has copy, drop { vault: ID, admin: address }
public struct Deposited has copy, drop { vault: ID, user: address, amount: u64, available: u64 }
public struct Credited has copy, drop { vault: ID, user: address, amount: u64, available: u64 }
public struct Withdrawn has copy, drop { vault: ID, user: address, amount: u64, available: u64 }
public struct PrivateMoved has copy, drop { vault: ID, user: address, amount: u64, private_balance: u64 }
public struct PrivateWithdrawn has copy, drop { vault: ID, user: address, amount: u64, private_balance: u64 }
public struct AgentAllocated has copy, drop { vault: ID, user: address, agent: address, amount: u64, agent_balance: u64, max_trade: u64, max_leverage_bps: u64, expires_at_ms: u64 }
public struct AgentRevoked has copy, drop { vault: ID, user: address, returned: u64, available: u64 }
public struct LeverageOpened has copy, drop { vault: ID, user: address, margin: u64, leverage_bps: u64, locked_margin: u64 }
public struct AgentLeverageOpened has copy, drop { vault: ID, user: address, agent: address, margin: u64, leverage_bps: u64, locked_margin: u64 }
public struct LockedReturned has copy, drop { vault: ID, user: address, amount: u64, locked_margin: u64, available: u64 }
public struct LockedWrittenOff has copy, drop { vault: ID, user: address, amount: u64, locked_margin: u64 }

public fun create<T>(ctx: &mut TxContext) {
    let vault = TradingVault<T> {
        id: object::new(ctx),
        admin: ctx.sender(),
        accounts: table::new<address, Account<T>>(ctx),
        policies: table::new<address, AgentPolicy>(ctx),
        total_liquid: 0,
        total_locked_margin: 0,
    };
    event::emit(VaultCreated { vault: object::id(&vault), admin: ctx.sender() });
    transfer::share_object(vault);
}

public fun set_admin<T>(v: &mut TradingVault<T>, admin: address, ctx: &mut TxContext) {
    assert!(ctx.sender() == v.admin, ENotAdmin);
    v.admin = admin;
}

// user funding

public fun deposit<T>(v: &mut TradingVault<T>, funds: Coin<T>, ctx: &mut TxContext) {
    let amount = funds.value();
    assert!(amount > 0, EZero);
    let user = ctx.sender();
    let vault_id = object::id(v);
    ensure_account(v, user);
    let available = {
        let account = table::borrow_mut(&mut v.accounts, user);
        balance::join(&mut account.available, funds.into_balance());
        account.total_deposited = account.total_deposited + amount;
        balance::value(&account.available)
    };
    v.total_liquid = v.total_liquid + amount;
    event::emit(Deposited { vault: vault_id, user, amount, available });
}

/// Credit a user's public Trading Balance from an external flow. This is how a
/// cashout/settlement PTB can return funds to the account instead of forcing them
/// straight to the wallet. Anyone may call because the caller contributes the coin.
public fun credit_available_for<T>(v: &mut TradingVault<T>, user: address, funds: Coin<T>) {
    let amount = funds.value();
    assert!(amount > 0, EZero);
    let vault_id = object::id(v);
    ensure_account(v, user);
    let available = {
        let account = table::borrow_mut(&mut v.accounts, user);
        balance::join(&mut account.available, funds.into_balance());
        balance::value(&account.available)
    };
    v.total_liquid = v.total_liquid + amount;
    event::emit(Credited { vault: vault_id, user, amount, available });
}

public fun withdraw<T>(v: &mut TradingVault<T>, amount: u64, ctx: &mut TxContext): Coin<T> {
    assert!(amount > 0, EZero);
    let user = ctx.sender();
    let vault_id = object::id(v);
    assert!(table::contains(&v.accounts, user), ENoAccount);
    let (out, available) = {
        let account = table::borrow_mut(&mut v.accounts, user);
        assert!(balance::value(&account.available) >= amount, EInsufficient);
        let out = balance::split(&mut account.available, amount);
        account.total_withdrawn = account.total_withdrawn + amount;
        (out, balance::value(&account.available))
    };
    v.total_liquid = v.total_liquid - amount;
    event::emit(Withdrawn { vault: vault_id, user, amount, available });
    out.into_coin(ctx)
}

// private balance

public fun move_to_private<T>(v: &mut TradingVault<T>, amount: u64, ctx: &mut TxContext) {
    assert!(amount > 0, EZero);
    let user = ctx.sender();
    let vault_id = object::id(v);
    assert!(table::contains(&v.accounts, user), ENoAccount);
    let private_balance = {
        let account = table::borrow_mut(&mut v.accounts, user);
        assert!(balance::value(&account.available) >= amount, EInsufficient);
        let funds = balance::split(&mut account.available, amount);
        balance::join(&mut account.private_available, funds);
        balance::value(&account.private_available)
    };
    event::emit(PrivateMoved { vault: vault_id, user, amount, private_balance });
}

/// Credit a private/session route cashout into Private Balance. Anyone may call
/// because the caller contributes the coin; only the user can withdraw it.
public fun credit_private_for<T>(v: &mut TradingVault<T>, user: address, funds: Coin<T>) {
    let amount = funds.value();
    assert!(amount > 0, EZero);
    let vault_id = object::id(v);
    ensure_account(v, user);
    let private_balance = {
        let account = table::borrow_mut(&mut v.accounts, user);
        balance::join(&mut account.private_available, funds.into_balance());
        balance::value(&account.private_available)
    };
    v.total_liquid = v.total_liquid + amount;
    event::emit(PrivateMoved { vault: vault_id, user, amount, private_balance });
}

public fun withdraw_private<T>(v: &mut TradingVault<T>, amount: u64, ctx: &mut TxContext): Coin<T> {
    assert!(amount > 0, EZero);
    let user = ctx.sender();
    let vault_id = object::id(v);
    assert!(table::contains(&v.accounts, user), ENoAccount);
    let (out, private_balance) = {
        let account = table::borrow_mut(&mut v.accounts, user);
        assert!(balance::value(&account.private_available) >= amount, EInsufficient);
        let out = balance::split(&mut account.private_available, amount);
        account.total_withdrawn = account.total_withdrawn + amount;
        (out, balance::value(&account.private_available))
    };
    v.total_liquid = v.total_liquid - amount;
    event::emit(PrivateWithdrawn { vault: vault_id, user, amount, private_balance });
    out.into_coin(ctx)
}

// agent policy and allocation

public fun allocate_agent<T>(
    v: &mut TradingVault<T>,
    amount: u64,
    agent: address,
    max_trade: u64,
    max_leverage_bps: u64,
    max_daily_loss: u64,
    expires_at_ms: u64,
    ctx: &mut TxContext,
) {
    assert!(amount > 0 && max_trade > 0, EZero);
    assert!(max_leverage_bps >= 10_000, ELeverageTooHigh);
    let user = ctx.sender();
    let vault_id = object::id(v);
    assert!(table::contains(&v.accounts, user), ENoAccount);
    let agent_balance = {
        let account = table::borrow_mut(&mut v.accounts, user);
        assert!(balance::value(&account.available) >= amount, EInsufficient);
        let funds = balance::split(&mut account.available, amount);
        balance::join(&mut account.agent_available, funds);
        balance::value(&account.agent_available)
    };

    let policy = AgentPolicy { agent, max_trade, max_leverage_bps, max_daily_loss, expires_at_ms, active: true };
    if (table::contains(&v.policies, user)) {
        *table::borrow_mut(&mut v.policies, user) = policy;
    } else {
        table::add(&mut v.policies, user, policy);
    };

    event::emit(AgentAllocated {
        vault: vault_id,
        user,
        agent,
        amount,
        agent_balance,
        max_trade,
        max_leverage_bps,
        expires_at_ms,
    });
}

public fun revoke_agent<T>(v: &mut TradingVault<T>, ctx: &mut TxContext) {
    let user = ctx.sender();
    let vault_id = object::id(v);
    assert!(table::contains(&v.accounts, user), ENoAccount);
    let (returned, available) = {
        let account = table::borrow_mut(&mut v.accounts, user);
        let returned = balance::value(&account.agent_available);
        if (returned > 0) {
            let funds = balance::split(&mut account.agent_available, returned);
            balance::join(&mut account.available, funds);
        };
        (returned, balance::value(&account.available))
    };
    if (table::contains(&v.policies, user)) {
        table::borrow_mut(&mut v.policies, user).active = false;
    };
    event::emit(AgentRevoked { vault: vault_id, user, returned, available });
}

/// User opens a leveraged order directly from Trading Balance. This removes the
/// wallet-coin delay from the trade path: the user pre-funds once, then each trade
/// only debits vault balance and creates the same owner-safe margin order.
public fun open_leverage<T>(
    v: &mut TradingVault<T>,
    desk: &MarginDesk<T>,
    oracle_id: ID,
    margin_amount: u64,
    leverage_bps: u64,
    expiry: u64,
    is_range: bool,
    lower_strike: u64,
    higher_strike: u64,
    is_up: bool,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(margin_amount > 0, EZero);
    let user = ctx.sender();
    let vault_id = object::id(v);
    assert!(table::contains(&v.accounts, user), ENoAccount);

    let (margin, locked_margin) = {
        let account = table::borrow_mut(&mut v.accounts, user);
        assert!(balance::value(&account.available) >= margin_amount, EInsufficient);
        let margin = balance::split(&mut account.available, margin_amount).into_coin(ctx);
        account.locked_margin = account.locked_margin + margin_amount;
        (margin, account.locked_margin)
    };
    v.total_liquid = v.total_liquid - margin_amount;
    v.total_locked_margin = v.total_locked_margin + margin_amount;

    margin::request_open_for(
        desk,
        margin,
        oracle_id,
        user,
        leverage_bps,
        expiry,
        is_range,
        lower_strike,
        higher_strike,
        is_up,
        clock,
        ctx,
    );

    event::emit(LeverageOpened {
        vault: vault_id,
        user,
        margin: margin_amount,
        leverage_bps,
        locked_margin,
    });
}

/// Agent opens a leveraged order from the user's allocated agent budget. The order's
/// owner is hard-wired to `user`; exits can never pay the agent.
public fun agent_open_leverage<T>(
    v: &mut TradingVault<T>,
    desk: &MarginDesk<T>,
    oracle_id: ID,
    user: address,
    margin_amount: u64,
    leverage_bps: u64,
    expiry: u64,
    is_range: bool,
    lower_strike: u64,
    higher_strike: u64,
    is_up: bool,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(margin_amount > 0, EZero);
    let vault_id = object::id(v);
    assert!(table::contains(&v.policies, user), ENoPolicy);
    let policy = *table::borrow(&v.policies, user);
    assert!(policy.active, EPolicyInactive);
    assert!(ctx.sender() == policy.agent, ENotPolicyAgent);
    assert!(policy.expires_at_ms == 0 || clock.timestamp_ms() <= policy.expires_at_ms, EPolicyExpired);
    assert!(margin_amount <= policy.max_trade, EOverTradeCap);
    assert!(leverage_bps <= policy.max_leverage_bps, ELeverageTooHigh);
    assert!(table::contains(&v.accounts, user), ENoAccount);

    let (margin, locked_margin) = {
        let account = table::borrow_mut(&mut v.accounts, user);
        assert!(balance::value(&account.agent_available) >= margin_amount, EInsufficient);
        let margin = balance::split(&mut account.agent_available, margin_amount).into_coin(ctx);
        account.locked_margin = account.locked_margin + margin_amount;
        (margin, account.locked_margin)
    };
    v.total_liquid = v.total_liquid - margin_amount;
    v.total_locked_margin = v.total_locked_margin + margin_amount;

    margin::request_open_for(
        desk,
        margin,
        oracle_id,
        user,
        leverage_bps,
        expiry,
        is_range,
        lower_strike,
        higher_strike,
        is_up,
        clock,
        ctx,
    );

    event::emit(AgentLeverageOpened {
        vault: vault_id,
        user,
        agent: policy.agent,
        margin: margin_amount,
        leverage_bps,
        locked_margin,
    });
}

/// Return a cancelled order margin or settlement remainder to Trading Balance. Anyone
/// may call because the caller contributes the coin. The locked counter is reduced if
/// this account had locked margin.
public fun return_locked_for<T>(v: &mut TradingVault<T>, user: address, funds: Coin<T>) {
    let amount = funds.value();
    assert!(amount > 0, EZero);
    let vault_id = object::id(v);
    ensure_account(v, user);
    let (reduce, locked_margin, available) = {
        let account = table::borrow_mut(&mut v.accounts, user);
        let reduce = min_u64(account.locked_margin, amount);
        account.locked_margin = account.locked_margin - reduce;
        balance::join(&mut account.available, funds.into_balance());
        (reduce, account.locked_margin, balance::value(&account.available))
    };
    v.total_locked_margin = v.total_locked_margin - reduce;
    v.total_liquid = v.total_liquid + amount;
    event::emit(LockedReturned { vault: vault_id, user, amount, locked_margin, available });
}

/// Admin/accounting hook for a realized loss where no coin returns from the margin
/// position. This keeps the user's account value honest after liquidation or expiry.
public fun write_off_locked_for<T>(v: &mut TradingVault<T>, user: address, amount: u64, ctx: &mut TxContext) {
    assert!(ctx.sender() == v.admin, ENotAdmin);
    assert!(amount > 0, EZero);
    let vault_id = object::id(v);
    assert!(table::contains(&v.accounts, user), ENoAccount);
    let (written_off, locked_margin) = {
        let account = table::borrow_mut(&mut v.accounts, user);
        let reduce = min_u64(account.locked_margin, amount);
        account.locked_margin = account.locked_margin - reduce;
        v.total_locked_margin = v.total_locked_margin - reduce;
        (reduce, account.locked_margin)
    };
    event::emit(LockedWrittenOff { vault: vault_id, user, amount: written_off, locked_margin });
}

// views

public fun has_account<T>(v: &TradingVault<T>, user: address): bool {
    table::contains(&v.accounts, user)
}

public fun available_of<T>(v: &TradingVault<T>, user: address): u64 {
    if (table::contains(&v.accounts, user)) { balance::value(&table::borrow(&v.accounts, user).available) } else { 0 }
}

public fun private_of<T>(v: &TradingVault<T>, user: address): u64 {
    if (table::contains(&v.accounts, user)) { balance::value(&table::borrow(&v.accounts, user).private_available) } else { 0 }
}

public fun agent_of<T>(v: &TradingVault<T>, user: address): u64 {
    if (table::contains(&v.accounts, user)) { balance::value(&table::borrow(&v.accounts, user).agent_available) } else { 0 }
}

public fun locked_margin_of<T>(v: &TradingVault<T>, user: address): u64 {
    if (table::contains(&v.accounts, user)) { table::borrow(&v.accounts, user).locked_margin } else { 0 }
}

public fun account_value_of<T>(v: &TradingVault<T>, user: address): u64 {
    available_of(v, user) + private_of(v, user) + agent_of(v, user) + locked_margin_of(v, user)
}

public fun total_liquid<T>(v: &TradingVault<T>): u64 { v.total_liquid }
public fun total_locked_margin<T>(v: &TradingVault<T>): u64 { v.total_locked_margin }
public fun admin<T>(v: &TradingVault<T>): address { v.admin }

public fun policy_agent<T>(v: &TradingVault<T>, user: address): address {
    assert!(table::contains(&v.policies, user), ENoPolicy);
    table::borrow(&v.policies, user).agent
}

public fun policy_active<T>(v: &TradingVault<T>, user: address): bool {
    table::contains(&v.policies, user) && table::borrow(&v.policies, user).active
}

fun ensure_account<T>(v: &mut TradingVault<T>, user: address) {
    if (!table::contains(&v.accounts, user)) {
        table::add(&mut v.accounts, user, Account<T> {
            available: balance::zero<T>(),
            private_available: balance::zero<T>(),
            agent_available: balance::zero<T>(),
            locked_margin: 0,
            total_deposited: 0,
            total_withdrawn: 0,
        });
    };
}

fun min_u64(a: u64, b: u64): u64 {
    if (a < b) { a } else { b }
}
