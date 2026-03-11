import test_usdcx_stablecoin.aleo;

program btc_pred_v8.aleo {

    @noupgrade
    async constructor() {}

    // ── Privacy Layer 1: ZK Commitment ─────────────────
    // Binds (side, amount, salt) without revealing side.
    // Computed inside the ZK circuit — can't be forged.
    struct BetCommit {
        side: bool,
        amt: u128,
        salt: field,
    }

    // ── Privacy Layer 3: Encrypted Receipt ─────────────
    // Private record — only the owner can decrypt.
    // Proves participation without revealing bet side.
    record BetReceipt {
        owner: address,
        rid: u64,
        commit: field,
    }

    // ── Mappings ────────────────────────────────────────
    mapping aa: u8 => address;      // admin (key 0u8)
    mapping rt: u64 => u64;         // round target price
    mapping rd: u64 => u32;         // round deadline
    mapping ro: u64 => u8;          // outcome: 0=pending 1=YES 2=NO
    mapping rp: u64 => u128;        // dark pool: combined total
    mapping ry: u64 => u128;        // YES pool (set at resolution)
    mapping rn: u64 => u128;        // NO pool (set at resolution)
    mapping cl: field => bool;      // claimed flag
    mapping fe: u8 => u128;         // accumulated fees (key 0u8)
    mapping bc: field => field;     // bet commitment hash
    mapping ba: field => u128;      // bet amount

    // ── 1. init_admin ───────────────────────────────────
    async transition init_admin() -> Future {
        return fin_init_admin(self.caller);
    }
    async function fin_init_admin(caller: address) {
        let exists: bool = Mapping::contains(aa, 0u8);
        assert(!exists);
        Mapping::set(aa, 0u8, caller);
    }

    // ── 2. create_round ─────────────────────────────────
    async transition create_round(
        public rid: u64,
        public target: u64,
        public deadline: u32,
        public seed: u128
    ) -> Future {
        return fin_create_round(
            self.caller, rid, target, deadline, seed
        );
    }
    async function fin_create_round(
        caller: address,
        rid: u64,
        target: u64,
        deadline: u32,
        seed: u128
    ) {
        let admin: address = Mapping::get(aa, 0u8);
        assert_eq(caller, admin);
        assert(deadline > block.height);
        Mapping::set(rt, rid, target);
        Mapping::set(rd, rid, deadline);
        Mapping::set(ro, rid, 0u8);
        Mapping::set(rp, rid, seed * 2u128);
    }

    // ── 3. bet — 4 PRIVACY LAYERS ─────────────────────
    //
    // Layer 1: side + salt are PRIVATE transition inputs
    //          → encrypted in tx, hidden by ZK proof
    // Layer 2: dark pool — only combined total updated,
    //          per-side pools stay hidden
    // Layer 3: BetReceipt record returned — encrypted,
    //          only owner can decrypt
    // Layer 4: anti-MEV — nobody can see your side to
    //          front-run or manipulate odds
    //
    async transition bet(
        public rid: u64,
        amt: u128,
        side: bool,
        salt: field
    ) -> (BetReceipt, Future) {
        assert(amt > 0u128);
        let commit: field = BHP256::hash_to_field(
            BetCommit { side, amt, salt }
        );
        let ok: field = BHP256::hash_to_field(
            self.caller
        );
        let rk: field = BHP256::hash_to_field(rid);
        let claim_key: field = ok + rk;
        // Issue encrypted receipt — private proof of bet
        let receipt: BetReceipt = BetReceipt {
            owner: self.caller,
            rid,
            commit,
        };
        return (
            receipt,
            fin_bet(
                self.caller, rid, amt,
                claim_key, commit
            )
        );
    }
    async function fin_bet(
        caller: address,
        rid: u64,
        amt: u128,
        claim_key: field,
        commit: field
    ) {
        let outcome: u8 = Mapping::get(ro, rid);
        assert_eq(outcome, 0u8);
        let dl: u32 = Mapping::get(rd, rid);
        assert(block.height < dl);
        // Prevent double-bet on same round
        let has: bool = Mapping::contains(bc, claim_key);
        assert(!has);
        // Update dark pool (combined total only)
        let pool: u128 = Mapping::get_or_use(
            rp, rid, 0u128
        );
        Mapping::set(rp, rid, pool + amt);
        // Store commitment + amount
        Mapping::set(bc, claim_key, commit);
        Mapping::set(ba, claim_key, amt);
    }

    // ── 4. resolve — dark pool reveal ───────────────────
    async transition resolve(
        public rid: u64,
        public actual_price: u64,
        public yes_total: u128,
        public no_total: u128
    ) -> Future {
        return fin_resolve(
            self.caller, rid, actual_price,
            yes_total, no_total
        );
    }
    async function fin_resolve(
        caller: address,
        rid: u64,
        actual_price: u64,
        yes_total: u128,
        no_total: u128
    ) {
        let admin: address = Mapping::get(aa, 0u8);
        assert_eq(caller, admin);
        let dl: u32 = Mapping::get(rd, rid);
        assert(block.height >= dl);
        let pool: u128 = Mapping::get(rp, rid);
        assert_eq(yes_total + no_total, pool);
        Mapping::set(ry, rid, yes_total);
        Mapping::set(rn, rid, no_total);
        let target: u64 = Mapping::get(rt, rid);
        let result: u8 = actual_price >= target
            ? 1u8
            : 2u8;
        Mapping::set(ro, rid, result);
    }

    // ── 5. claim — commitment-verified payout ───────────
    // No record inputs needed. User reveals preimage
    // (side, amt, salt) — verified against stored hash.
    // Side only revealed AFTER round is over.
    async transition claim(
        public rid: u64,
        side: bool,
        amt: u128,
        salt: field,
        public payout: u128
    ) -> Future {
        assert(payout > 0u128);
        let commit: field = BHP256::hash_to_field(
            BetCommit { side, amt, salt }
        );
        let ok: field = BHP256::hash_to_field(
            self.caller
        );
        let rk: field = BHP256::hash_to_field(rid);
        let claim_key: field = ok + rk;
        let f: Future =
            test_usdcx_stablecoin.aleo/transfer_public(
                self.caller, payout
            );
        return fin_claim(
            f, claim_key, rid,
            side, amt, commit, payout
        );
    }
    async function fin_claim(
        f: Future,
        claim_key: field,
        rid: u64,
        side: bool,
        amt: u128,
        commit: field,
        payout: u128
    ) {
        f.await();
        // Verify commitment matches stored
        let stored: field = Mapping::get(
            bc, claim_key
        );
        assert_eq(commit, stored);
        // Verify amount matches stored
        let stored_amt: u128 = Mapping::get(
            ba, claim_key
        );
        assert_eq(amt, stored_amt);
        // Round resolved?
        let outcome: u8 = Mapping::get(ro, rid);
        assert(outcome > 0u8);
        // On winning side?
        let won_yes: bool = outcome == 1u8;
        assert_eq(side, won_yes);
        // Not already claimed?
        let already: bool = Mapping::get_or_use(
            cl, claim_key, false
        );
        assert(!already);
        Mapping::set(cl, claim_key, true);
        // Validate payout math
        let yp: u128 = Mapping::get(ry, rid);
        let np: u128 = Mapping::get(rn, rid);
        let total: u128 = yp + np;
        let win_pool: u128 = side ? yp : np;
        let gross: u128 = amt * total / win_pool;
        let net: u128 = gross * 9u128 / 10u128;
        assert(payout <= net);
        // Accumulate fee
        let fee: u128 = gross - net;
        let cur_fee: u128 = Mapping::get_or_use(
            fe, 0u8, 0u128
        );
        Mapping::set(fe, 0u8, cur_fee + fee);
    }

    // ── 6. forfeit — loser releases bet ─────────────────
    async transition forfeit(
        public rid: u64,
        side: bool,
        amt: u128,
        salt: field
    ) -> Future {
        let commit: field = BHP256::hash_to_field(
            BetCommit { side, amt, salt }
        );
        let ok: field = BHP256::hash_to_field(
            self.caller
        );
        let rk: field = BHP256::hash_to_field(rid);
        let claim_key: field = ok + rk;
        return fin_forfeit(
            claim_key, rid, side, commit
        );
    }
    async function fin_forfeit(
        claim_key: field,
        rid: u64,
        side: bool,
        commit: field
    ) {
        let stored: field = Mapping::get(
            bc, claim_key
        );
        assert_eq(commit, stored);
        let outcome: u8 = Mapping::get(ro, rid);
        assert(outcome > 0u8);
        // Must be on LOSING side
        let won_yes: bool = outcome == 1u8;
        assert_neq(side, won_yes);
        let already: bool = Mapping::get_or_use(
            cl, claim_key, false
        );
        assert(!already);
        Mapping::set(cl, claim_key, true);
    }

    // ── 7. withdraw_fees ────────────────────────────────
    async transition withdraw_fees(
        public amount: u128
    ) -> Future {
        let f: Future =
            test_usdcx_stablecoin.aleo/transfer_public(
                self.caller, amount
            );
        return fin_withdraw_fees(
            f, self.caller, amount
        );
    }
    async function fin_withdraw_fees(
        f: Future,
        caller: address,
        amount: u128
    ) {
        f.await();
        let admin: address = Mapping::get(aa, 0u8);
        assert_eq(caller, admin);
        let cur: u128 = Mapping::get_or_use(
            fe, 0u8, 0u128
        );
        assert(amount <= cur);
        Mapping::set(fe, 0u8, cur - amount);
    }
}
