/// On-chain claim authority for **Seal-sealed, tweet-onboarded account keys**.
///
/// A tweet-onboarded user has no wallet, so the relay generates the account's withdraw key,
/// Seal-encrypts it (ciphertext on Walrus) and DISCARDS the plaintext — Yosuku holds no usable
/// key (no honeypot, still non-custodial). The Seal key servers only release that key to whoever
/// `seal_approve` authorizes. This registry IS that authority:
///   - Before claim: no address is bound to the account, so `seal_approve` aborts for everyone →
///     the key can't be unsealed → funds are tradeable by the no-divert agent but un-drainable.
///   - On claim: the user proves handle ownership (the existing connect flow), the relay (admin)
///     binds the account key to the user's verified wallet, and ONLY that wallet can unseal it.
///
/// Trading never touches this — every tweet-trade is agent-signed (`social_vault::agent_trade`).
/// This gates only the WITHDRAW key, which is the one thing that must stay the user's.
module yosuku_seal::handle_registry;

use sui::{event, table::{Self, Table}};

const ENotAdmin: u64 = 1;
const ENoOwner: u64 = 2;
const ENotOwner: u64 = 3;
const EBadNamespace: u64 = 4;

/// Maps an account key (the Seal identity suffix — e.g. the X author_id bytes) → the wallet
/// allowed to unseal that account's withdraw key. Shared.
public struct HandleRegistry has key {
    id: UID,
    admin: address,
    owners: Table<vector<u8>, address>,
}

public struct RegistryCreated has copy, drop { registry: ID, admin: address }
public struct OwnerSet has copy, drop { registry: ID, key: vector<u8>, owner: address }
public struct AdminUpdated has copy, drop { registry: ID, admin: address }

/// Create the shared registry. Called once post-deploy by the relay admin (not `init`, so it's
/// deterministic across a package upgrade rather than relying on upgrade-time init semantics).
public fun create_registry(ctx: &mut TxContext) {
    let reg = HandleRegistry { id: object::new(ctx), admin: ctx.sender(), owners: table::new(ctx) };
    event::emit(RegistryCreated { registry: object::id(&reg), admin: ctx.sender() });
    transfer::share_object(reg);
}

/// Admin (relay): bind an account key to its claim owner — set when a user proves handle ownership.
public fun set_owner(reg: &mut HandleRegistry, key: vector<u8>, owner: address, ctx: &TxContext) {
    assert!(ctx.sender() == reg.admin, ENotAdmin);
    if (table::contains(&reg.owners, key)) {
        *table::borrow_mut(&mut reg.owners, key) = owner;
    } else {
        table::add(&mut reg.owners, key, owner);
    };
    event::emit(OwnerSet { registry: object::id(reg), key, owner });
}

/// Admin: rotate the admin (e.g. into a TEE-attested key).
public fun set_admin(reg: &mut HandleRegistry, admin: address, ctx: &TxContext) {
    assert!(ctx.sender() == reg.admin, ENotAdmin);
    reg.admin = admin;
    event::emit(AdminUpdated { registry: object::id(reg), admin });
}

public fun has_owner(reg: &HandleRegistry, key: vector<u8>): bool { table::contains(&reg.owners, key) }
public fun owner_of(reg: &HandleRegistry, key: vector<u8>): address { *table::borrow(&reg.owners, key) }
public fun admin(reg: &HandleRegistry): address { reg.admin }

/// Seal approval. Seal key servers dry-run this with the encryption `id` and the requester as
/// the tx sender; it aborts unless the requester is the bound owner of the account. `id` is
/// namespaced with this registry's object id, then the account key: `registry_id_bytes ++ key`.
entry fun seal_approve(id: vector<u8>, reg: &HandleRegistry, ctx: &TxContext) {
    let ns = object::id(reg).to_bytes();
    assert!(starts_with(&id, &ns), EBadNamespace);
    let key = suffix(&id, ns.length());
    assert!(table::contains(&reg.owners, key), ENoOwner);
    assert!(ctx.sender() == *table::borrow(&reg.owners, key), ENotOwner);
}

fun starts_with(haystack: &vector<u8>, needle: &vector<u8>): bool {
    if (needle.length() > haystack.length()) { return false };
    let mut i = 0;
    while (i < needle.length()) {
        if (haystack[i] != needle[i]) { return false };
        i = i + 1;
    };
    true
}

fun suffix(v: &vector<u8>, from: u64): vector<u8> {
    let mut out = vector[];
    let n = v.length();
    let mut i = from;
    while (i < n) { out.push_back(v[i]); i = i + 1; };
    out
}

// ─── tests (in-module: seal_approve is a private entry, only callable here) ───
#[test_only] use sui::test_scenario as ts;

#[test_only]
fun seal_id(reg: &HandleRegistry, key: vector<u8>): vector<u8> {
    let mut id = object::id(reg).to_bytes();
    id.append(key);
    id
}

#[test]
fun seal_approve_passes_for_bound_owner() {
    let admin = @0xA; let owner = @0xB;
    let mut sc = ts::begin(admin);
    create_registry(ts::ctx(&mut sc));
    ts::next_tx(&mut sc, admin);
    let mut reg = ts::take_shared<HandleRegistry>(&sc);
    let key = b"2002090717779460096";
    set_owner(&mut reg, key, owner, ts::ctx(&mut sc));
    let id = seal_id(&reg, key);
    ts::next_tx(&mut sc, owner);
    seal_approve(id, &reg, ts::ctx(&mut sc)); // must NOT abort
    ts::return_shared(reg);
    ts::end(sc);
}

#[test]
#[expected_failure(abort_code = ENotOwner)]
fun seal_approve_rejects_stranger() {
    let admin = @0xA; let owner = @0xB; let stranger = @0xC;
    let mut sc = ts::begin(admin);
    create_registry(ts::ctx(&mut sc));
    ts::next_tx(&mut sc, admin);
    let mut reg = ts::take_shared<HandleRegistry>(&sc);
    let key = b"handle-1";
    set_owner(&mut reg, key, owner, ts::ctx(&mut sc));
    let id = seal_id(&reg, key);
    ts::next_tx(&mut sc, stranger);
    seal_approve(id, &reg, ts::ctx(&mut sc)); // stranger != owner → abort ENotOwner
    ts::return_shared(reg);
    ts::end(sc);
}

#[test]
#[expected_failure(abort_code = ENoOwner)]
fun seal_approve_rejects_unclaimed() {
    let admin = @0xA; let someone = @0xB;
    let mut sc = ts::begin(admin);
    create_registry(ts::ctx(&mut sc));
    ts::next_tx(&mut sc, admin);
    let reg = ts::take_shared<HandleRegistry>(&sc);
    let id = seal_id(&reg, b"never-claimed"); // no owner bound → nobody can unseal
    ts::next_tx(&mut sc, someone);
    seal_approve(id, &reg, ts::ctx(&mut sc)); // abort ENoOwner
    ts::return_shared(reg);
    ts::end(sc);
}

#[test]
#[expected_failure(abort_code = ENotAdmin)]
fun only_admin_sets_owner() {
    let admin = @0xA; let intruder = @0xC;
    let mut sc = ts::begin(admin);
    create_registry(ts::ctx(&mut sc));
    ts::next_tx(&mut sc, intruder);
    let mut reg = ts::take_shared<HandleRegistry>(&sc);
    set_owner(&mut reg, b"h", @0xD, ts::ctx(&mut sc)); // intruder != admin → abort
    ts::return_shared(reg);
    ts::end(sc);
}
