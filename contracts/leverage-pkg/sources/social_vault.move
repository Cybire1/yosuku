/// Per-user custodied accounts for the **trade-from-X** on-ramp — the structural answer
/// to the Grok/Bankr agent-drain class of attack.
///
/// The failure mode of every custodial AI trading agent shipping today: the agent holds
/// a wallet that can *send funds anywhere*, so its decision layer becomes the attack
/// surface. A single prompt injection (Grok lost ~$170K to a Morse-code tweet) drains it
/// — "you don't hack the wallet, you hack the AI."
///
/// This vault removes the divert path entirely. A user deposits once, keyed to their own
/// Sui address. The attested agent can do **exactly one** thing with that balance: debit
/// it to open a leveraged Predict position **OWNED BY THE SAME USER** (via
/// `margin::request_open_for`). Every exit of that position force-pays the user. The only
/// way funds leave the vault to an arbitrary address is `withdraw`, which is owner-gated
/// to the depositor. So even a *fully* prompt-injected agent can only trade a user's own
/// funds into the user's own position — it has no instruction that pays a third party.
///
/// On top of no-divert, `max_trade` bounds the blast radius of a hijacked agent (it can't
/// dump a whole balance into one position), and the agent identity is a TEE-attested
/// enclave key. Theft is impossible by construction; reckless sizing is capped by policy.
module yolev::social_vault;

use sui::{
    balance::{Self, Balance},
    coin::{Self, Coin},
    clock::Clock,
    event,
    table::{Self, Table},
};
use yolev::margin::{Self, MarginDesk};

// ─── errors ───
const ENotAdmin: u64 = 1;
const ENotAgent: u64 = 2;
const EPaused: u64 = 3;
const ENoAccount: u64 = 4;
const EInsufficient: u64 = 5;
const EZero: u64 = 6;
const EOverTradeCap: u64 = 7;
const ENotAuthorized: u64 = 8;
const EWrongVault: u64 = 9;
const ERevoked: u64 = 10;

/// Custodied per-user balances for the social on-ramp, in quote asset `T`. Shared.
public struct Vault<phantom T> has key {
    id: UID,
    admin: address,
    /// The attested keeper EOA (the same identity running the TEE enclave). The ONLY
    /// address that can call `agent_trade` — and even it can only debit a user's balance
    /// into that user's own position. It can never move funds to a third party.
    agent: address,
    paused: bool,
    /// Per-depositor custodied balance, keyed by the depositor's Sui address.
    accounts: Table<address, Balance<T>>,
    /// Max margin the agent may deploy in a single `agent_trade` — a risk bound that
    /// caps a hijacked agent's blast radius (theft is already impossible; this stops it
    /// from over-sizing a user's whole balance into one bad bet).
    max_trade: u64,
    /// Total currently custodied across all accounts (book-keeping / transparency).
    total: u64,
}

// ─── events ───
public struct VaultCreated has copy, drop { vault: ID, admin: address, agent: address, max_trade: u64 }
public struct AgentUpdated has copy, drop { vault: ID, agent: address }
public struct MaxTradeUpdated has copy, drop { vault: ID, max_trade: u64 }
public struct PausedUpdated has copy, drop { vault: ID, paused: bool }
public struct Deposited has copy, drop { vault: ID, user: address, amount: u64, balance: u64 }
public struct BalanceClaimed has copy, drop { vault: ID, user: address, amount: u64, balance: u64 }
public struct AgentTraded has copy, drop { vault: ID, user: address, margin: u64, leverage_bps: u64, balance: u64 }

/// A subscriber's standing authorization for a strategy creator's agent to open positions
/// on the subscriber's behalf, bounded by caps. The position is ALWAYS owned by the
/// subscriber — this grant delegates *timing and sizing only, never custody*, so the
/// no-divert guarantee holds for copy-trading exactly as it does for the single agent.
/// Shared so the creator's agent can present it; the subscriber created it (= consent) and
/// is the only one who can revoke it.
public struct Subscription has key {
    id: UID,
    vault: ID,
    subscriber: address,
    /// the strategy creator's executing agent.
    agent: address,
    /// the strategy being copied (for audit / leaderboard attribution).
    strategy: ID,
    /// caps the subscriber granted: per-trade margin + max leverage.
    max_leverage_bps: u64,
    max_margin: u64,
    active: bool,
}

public struct Subscribed has copy, drop { subscription: ID, vault: ID, subscriber: address, agent: address, strategy: ID, max_leverage_bps: u64, max_margin: u64 }
public struct Unsubscribed has copy, drop { subscription: ID, subscriber: address }
public struct CopyTraded has copy, drop { subscription: ID, vault: ID, subscriber: address, agent: address, strategy: ID, margin: u64, leverage_bps: u64, balance: u64 }

// ─── create / admin ───

public fun create_vault<T>(agent: address, max_trade: u64, ctx: &mut TxContext) {
    assert!(max_trade > 0, EZero);
    let vault = Vault<T> {
        id: object::new(ctx),
        admin: ctx.sender(),
        agent,
        paused: false,
        accounts: table::new<address, Balance<T>>(ctx),
        max_trade,
        total: 0,
    };
    event::emit(VaultCreated { vault: object::id(&vault), admin: ctx.sender(), agent, max_trade });
    transfer::share_object(vault);
}

/// Admin: rotate the agent identity (e.g. into a fresh TEE enclave key).
public fun set_agent<T>(v: &mut Vault<T>, agent: address, ctx: &mut TxContext) {
    assert!(ctx.sender() == v.admin, ENotAdmin);
    v.agent = agent;
    event::emit(AgentUpdated { vault: object::id(v), agent });
}

/// Admin: adjust the per-trade margin cap.
public fun set_max_trade<T>(v: &mut Vault<T>, max_trade: u64, ctx: &mut TxContext) {
    assert!(ctx.sender() == v.admin, ENotAdmin);
    assert!(max_trade > 0, EZero);
    v.max_trade = max_trade;
    event::emit(MaxTradeUpdated { vault: object::id(v), max_trade });
}

/// Admin: pause/unpause agent trading. Deposits and withdrawals are intentionally NOT
/// pausable — users can always get their funds out, no matter the vault state.
public fun set_paused<T>(v: &mut Vault<T>, paused: bool, ctx: &mut TxContext) {
    assert!(ctx.sender() == v.admin, ENotAdmin);
    v.paused = paused;
    event::emit(PausedUpdated { vault: object::id(v), paused });
}

// ─── user: deposit / withdraw (always available) ───

/// Credit the sender's custodied balance. The deposit is keyed to `ctx.sender()`, so
/// only the depositor can ever withdraw it or have the agent trade it. Off-chain, the
/// relay maps the depositor's X handle to this address — the chain only ever sees the
/// Sui address, so the custody guarantee never depends on the social layer.
public fun deposit<T>(v: &mut Vault<T>, funds: Coin<T>, ctx: &mut TxContext) {
    let amt = funds.value();
    assert!(amt > 0, EZero);
    let user = ctx.sender();
    if (table::contains(&v.accounts, user)) {
        balance::join(table::borrow_mut(&mut v.accounts, user), funds.into_balance());
    } else {
        table::add(&mut v.accounts, user, funds.into_balance());
    };
    v.total = v.total + amt;
    let bal = balance::value(table::borrow(&v.accounts, user));
    event::emit(Deposited { vault: object::id(v), user, amount: amt, balance: bal });
}

/// Fund ANOTHER user's custodied balance from an external flow — e.g. the relay sponsoring a
/// freshly tweet-onboarded account with $2 so the trade can open WITHOUT the user's key (the
/// withdraw key stays Seal-sealed). Permissionless: the caller contributes the coin and it
/// credits `user`, so there is no way to credit yourself or divert — funding can only ever ADD
/// to a user's own balance, which `withdraw` still gates to that user. This is what lets an
/// auto-account be funded while Yosuku holds no usable key for it.
public fun credit_for<T>(v: &mut Vault<T>, user: address, funds: Coin<T>) {
    let amt = funds.value();
    assert!(amt > 0, EZero);
    if (table::contains(&v.accounts, user)) {
        balance::join(table::borrow_mut(&mut v.accounts, user), funds.into_balance());
    } else {
        table::add(&mut v.accounts, user, funds.into_balance());
    };
    v.total = v.total + amt;
    let bal = balance::value(table::borrow(&v.accounts, user));
    event::emit(Deposited { vault: object::id(v), user, amount: amt, balance: bal });
}

/// Owner-gated withdrawal: pull `amount` of YOUR OWN custodied balance back to your
/// wallet. Only the account owner (`ctx.sender()`) can call this for their balance, and
/// the funds go to the caller — this is the only path by which funds leave the vault to
/// an arbitrary address, and it is owner-gated. The agent has no withdraw capability.
public fun withdraw<T>(v: &mut Vault<T>, amount: u64, ctx: &mut TxContext): Coin<T> {
    assert!(amount > 0, EZero);
    let user = ctx.sender();
    assert!(table::contains(&v.accounts, user), ENoAccount);
    let bal = table::borrow_mut(&mut v.accounts, user);
    assert!(balance::value(bal) >= amount, EInsufficient);
    let out = balance::split(bal, amount);
    v.total = v.total - amount;
    let remaining = balance::value(table::borrow(&v.accounts, user));
    event::emit(BalanceClaimed { vault: object::id(v), user, amount, balance: remaining });
    out.into_coin(ctx)
}

// ─── agent: trade a user's own funds into a user-owned position ───

/// Agent: open a leveraged position for `user`, funded from `user`'s custodied balance.
/// Asserts the caller is the attested agent and the per-trade cap, debits the user's
/// balance, and escrows an order whose owner is `user` — so when the position later
/// closes/settles/liquidates it force-pays `user`, never the agent. The agent fills the
/// resulting order in the same flow (`margin::fill`, keeper-gated). There is no argument
/// or code path here that lets the agent name a different beneficiary: the position owner
/// is hard-wired to the funded `user`. This is the no-divert guarantee.
public fun agent_trade<T>(
    v: &mut Vault<T>,
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
    assert!(!v.paused, EPaused);
    assert!(ctx.sender() == v.agent, ENotAgent);
    assert!(margin_amount > 0, EZero);
    assert!(margin_amount <= v.max_trade, EOverTradeCap);
    assert!(table::contains(&v.accounts, user), ENoAccount);

    let bal = table::borrow_mut(&mut v.accounts, user);
    assert!(balance::value(bal) >= margin_amount, EInsufficient);
    let margin_bal = balance::split(bal, margin_amount);
    v.total = v.total - margin_amount;
    let margin_coin = margin_bal.into_coin(ctx);

    // The position owner is hard-wired to `user` — the agent cannot name itself or any
    // third party. Every exit of this position force-pays `user`.
    margin::request_open_for(
        desk, margin_coin, oracle_id, user, leverage_bps, expiry,
        is_range, lower_strike, higher_strike, is_up, clock, ctx,
    );

    let remaining = balance::value(table::borrow(&v.accounts, user));
    event::emit(AgentTraded { vault: object::id(v), user, margin: margin_amount, leverage_bps, balance: remaining });
}

// ─── copy-trading: subscribe to a strategy, agent trades your funds within caps ───

/// Subscriber: authorize `agent` (a strategy creator's executor) to open positions on
/// your behalf from this vault, bounded by `max_margin` / `max_leverage_bps`. Creates a
/// shared `Subscription` whose `subscriber` is `ctx.sender()` — only YOU can grant access
/// to your own balance; an agent can never authorize itself. Usually called by
/// `strategy::subscribe` (which also collects the creator's fee), but standalone-safe.
public fun create_subscription<T>(
    v: &Vault<T>,
    strategy: ID,
    agent: address,
    max_leverage_bps: u64,
    max_margin: u64,
    ctx: &mut TxContext,
) {
    assert!(max_margin > 0 && max_leverage_bps >= 10_000, EZero);
    let sub = Subscription {
        id: object::new(ctx),
        vault: object::id(v),
        subscriber: ctx.sender(),
        agent,
        strategy,
        max_leverage_bps,
        max_margin,
        active: true,
    };
    event::emit(Subscribed {
        subscription: object::id(&sub), vault: object::id(v), subscriber: ctx.sender(),
        agent, strategy, max_leverage_bps, max_margin,
    });
    transfer::share_object(sub);
}

/// Subscriber: revoke their subscription (stops the agent from opening new positions).
/// Owner-gated to the subscriber. Existing positions are unaffected — they're already
/// owned by the subscriber and exit-force-paid to them regardless.
public fun cancel_subscription(sub: &mut Subscription, ctx: &mut TxContext) {
    assert!(ctx.sender() == sub.subscriber, ENotAuthorized);
    sub.active = false;
    event::emit(Unsubscribed { subscription: object::id(sub), subscriber: sub.subscriber });
}

/// Creator-agent: copy-trade — open a position for the subscription's `subscriber`, funded
/// from their vault balance, within the caps THEY granted. Identical no-divert guarantee to
/// `agent_trade`: the position owner is hard-wired to `sub.subscriber` (via
/// `request_open_for`), so every exit force-pays the subscriber, never the agent. The
/// caller must be the subscription's agent and stay within the subscriber-granted caps; a
/// revoked subscription can no longer be traded. The subscriber's withdrawals stay
/// owner-gated. A strategy creator can copy a signal across many subscribers' vaults and
/// cannot divert a cent from any of them.
public fun authorized_trade<T>(
    v: &mut Vault<T>,
    sub: &Subscription,
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
    assert!(!v.paused, EPaused);
    assert!(sub.vault == object::id(v), EWrongVault);
    assert!(sub.active, ERevoked);
    assert!(ctx.sender() == sub.agent, ENotAuthorized);
    assert!(margin_amount > 0, EZero);
    assert!(margin_amount <= sub.max_margin, EOverTradeCap);
    assert!(leverage_bps <= sub.max_leverage_bps, EOverTradeCap);

    let subscriber = sub.subscriber;
    assert!(table::contains(&v.accounts, subscriber), ENoAccount);
    let bal = table::borrow_mut(&mut v.accounts, subscriber);
    assert!(balance::value(bal) >= margin_amount, EInsufficient);
    let margin_bal = balance::split(bal, margin_amount);
    v.total = v.total - margin_amount;
    let margin_coin = margin_bal.into_coin(ctx);

    // owner hard-wired to the subscriber — the creator-agent cannot name itself or a 3rd party.
    margin::request_open_for(
        desk, margin_coin, oracle_id, subscriber, leverage_bps, expiry,
        is_range, lower_strike, higher_strike, is_up, clock, ctx,
    );

    let remaining = balance::value(table::borrow(&v.accounts, subscriber));
    event::emit(CopyTraded {
        subscription: object::id(sub), vault: object::id(v), subscriber, agent: sub.agent,
        strategy: sub.strategy, margin: margin_amount, leverage_bps, balance: remaining,
    });
}

// ─── views ───

public fun balance_of<T>(v: &Vault<T>, user: address): u64 {
    if (table::contains(&v.accounts, user)) { balance::value(table::borrow(&v.accounts, user)) } else { 0 }
}
public fun has_account<T>(v: &Vault<T>, user: address): bool { table::contains(&v.accounts, user) }
public fun agent<T>(v: &Vault<T>): address { v.agent }
public fun admin<T>(v: &Vault<T>): address { v.admin }
public fun max_trade<T>(v: &Vault<T>): u64 { v.max_trade }
public fun total<T>(v: &Vault<T>): u64 { v.total }
public fun is_paused<T>(v: &Vault<T>): bool { v.paused }

// Subscription views
public fun sub_subscriber(s: &Subscription): address { s.subscriber }
public fun sub_agent(s: &Subscription): address { s.agent }
public fun sub_strategy(s: &Subscription): ID { s.strategy }
public fun sub_active(s: &Subscription): bool { s.active }
public fun sub_max_margin(s: &Subscription): u64 { s.max_margin }
public fun sub_max_leverage_bps(s: &Subscription): u64 { s.max_leverage_bps }
