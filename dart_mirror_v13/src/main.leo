import test_usdcx_stablecoin.aleo;

program dart_mirror_v13.aleo {

    @noupgrade
    async constructor() {}

    // Hidden-side receipt for a mirrored binary market bet.
    // `payout` is computed privately at entry and only revealed when the receipt is settled.
    record BetReceipt {
        owner: address,
        mid: u64,
        side: bool,
        amt: u128,
        payout: u128,
    }

    // ── Core admin / vault state ──────────────────────────
    mapping aa: u8  => address;   // 0u8=admin, 1u8=vault

    // ── Market lifecycle ──────────────────────────────────
    mapping mc: u64 => u32;       // close block height
    mapping mo: u64 => u8;        // outcome: 0=pending 1=YES 2=NO 3=cancelled
    mapping ym: u64 => u64;       // YES multiplier in basis pts
    mapping nm: u64 => u64;       // NO multiplier in basis pts
    mapping wu: u64 => u32;       // withdrawal unlock block after resolution/cancellation
    mapping su: u64 => u32;       // sweep unlock block for stale unsettled reserve

    // ── Solvency accounting ───────────────────────────────
    mapping rb: u64 => u128;      // bankroll funded by admin
    mapping ol: u64 => u128;      // outstanding worst-case reserve for unsettled receipts
    mapping tp: u64 => u128;      // total premiums collected
    mapping pp: u64 => u128;      // actual payouts / refunds already settled
    mapping wp: u64 => u128;      // house profit already withdrawn
    mapping bc: u64 => u64;       // total bets placed
    mapping sc: u64 => u64;       // total receipts settled (claim / forfeit / refund)

    // ── Mirroring metadata ────────────────────────────────
    mapping sh: u64 => field;     // source market hash
    mapping ch: u64 => field;     // condition hash
    mapping rh: u64 => field;     // resolution or cancellation hash
    mapping sm: field => u64;     // source hash -> market id (dedupe)

    // ── 1. init_admin ─────────────────────────────────────
    async transition init_admin(
        public vault: address
    ) -> Future {
        return fin_init_admin(self.caller, vault);
    }
    async function fin_init_admin(
        caller: address,
        vault: address
    ) {
        let exists: bool = Mapping::contains(aa, 0u8);
        assert(!exists);
        Mapping::set(aa, 0u8, caller);
        Mapping::set(aa, 1u8, vault);
    }

    // ── 2. create_market ──────────────────────────────────
    async transition create_market(
        public mid: u64,
        public close_block: u32,
        public yes_mult: u64,
        public no_mult: u64,
        public source_hash: field,
        public condition_hash: field
    ) -> Future {
        return fin_create_market(
            self.caller,
            mid,
            close_block,
            yes_mult,
            no_mult,
            source_hash,
            condition_hash
        );
    }
    async function fin_create_market(
        caller: address,
        mid: u64,
        close_block: u32,
        yes_mult: u64,
        no_mult: u64,
        source_hash: field,
        condition_hash: field
    ) {
        let admin: address = Mapping::get(aa, 0u8);
        assert_eq(caller, admin);
        assert(close_block > block.height);
        assert(yes_mult > 10000u64);
        assert(no_mult > 10000u64);
        assert(!Mapping::contains(mc, mid));
        assert(!Mapping::contains(sm, source_hash));

        Mapping::set(mc, mid, close_block);
        Mapping::set(mo, mid, 0u8);
        Mapping::set(ym, mid, yes_mult);
        Mapping::set(nm, mid, no_mult);
        Mapping::set(wu, mid, close_block);
        Mapping::set(rb, mid, 0u128);
        Mapping::set(ol, mid, 0u128);
        Mapping::set(tp, mid, 0u128);
        Mapping::set(sh, mid, source_hash);
        Mapping::set(ch, mid, condition_hash);
        Mapping::set(rh, mid, 0field);
        Mapping::set(sm, source_hash, mid);
    }

    // ── 3. fund_market ────────────────────────────────────
    async transition fund_market(
        public vault: address,
        public mid: u64,
        public amount: u128
    ) -> Future {
        let f: Future =
            test_usdcx_stablecoin.aleo/transfer_public_as_signer(vault, amount);
        return fin_fund_market(f, self.caller, vault, mid, amount);
    }
    async function fin_fund_market(
        f: Future,
        caller: address,
        vault: address,
        mid: u64,
        amount: u128
    ) {
        f.await();
        let admin: address = Mapping::get(aa, 0u8);
        assert_eq(caller, admin);
        assert(Mapping::contains(mc, mid));
        let stored_vault: address = Mapping::get(aa, 1u8);
        assert_eq(vault, stored_vault);
        let cur: u128 = Mapping::get_or_use(rb, mid, 0u128);
        Mapping::set(rb, mid, cur + amount);
    }

    // ── 4. bet — hidden side, conservative reserve ───────
    async transition bet(
        public vault: address,
        public mid: u64,
        public amt: u128,
        public yes_mult: u64,
        public no_mult: u64,
        side: bool
    ) -> (BetReceipt, Future) {
        assert(amt > 0u128);
        let mult: u64 = side ? yes_mult : no_mult;
        let payout: u128 = amt * (mult as u128) / 10000u128;
        assert(payout > 0u128);

        let f: Future =
            test_usdcx_stablecoin.aleo/transfer_public_as_signer(vault, amt);
        let receipt: BetReceipt = BetReceipt {
            owner: self.signer,
            mid,
            side,
            amt,
            payout,
        };
        return (receipt, fin_bet(f, vault, mid, amt, yes_mult, no_mult));
    }
    async function fin_bet(
        f: Future,
        vault: address,
        mid: u64,
        amt: u128,
        yes_mult: u64,
        no_mult: u64
    ) {
        f.await();
        let stored_vault: address = Mapping::get(aa, 1u8);
        assert_eq(vault, stored_vault);
        assert(Mapping::contains(mc, mid));

        let outcome: u8 = Mapping::get(mo, mid);
        assert_eq(outcome, 0u8);
        let close_block: u32 = Mapping::get(mc, mid);
        assert(block.height < close_block);

        let stored_yes: u64 = Mapping::get(ym, mid);
        let stored_no: u64 = Mapping::get(nm, mid);
        assert_eq(yes_mult, stored_yes);
        assert_eq(no_mult, stored_no);

        let reserve_mult: u64 = stored_yes >= stored_no ? stored_yes : stored_no;
        let reserve: u128 = amt * (reserve_mult as u128) / 10000u128;

        let bank: u128 = Mapping::get(rb, mid);
        let cur_tp: u128 = Mapping::get_or_use(tp, mid, 0u128);
        let cur_pp: u128 = Mapping::get_or_use(pp, mid, 0u128);
        let cur_ol: u128 = Mapping::get_or_use(ol, mid, 0u128);
        let cur_bc: u64 = Mapping::get_or_use(bc, mid, 0u64);

        let gross: u128 = bank + cur_tp;
        assert(gross >= cur_pp);
        let funds_after: u128 = gross - cur_pp + amt;
        let new_ol: u128 = cur_ol + reserve;

        assert(funds_after >= new_ol);

        Mapping::set(tp, mid, cur_tp + amt);
        Mapping::set(ol, mid, new_ol);
        Mapping::set(bc, mid, cur_bc + 1u64);
    }

    // ── 5. resolve ────────────────────────────────────────
    async transition resolve(
        public mid: u64,
        public outcome: bool,
        public resolution_hash: field
    ) -> Future {
        return fin_resolve(self.caller, mid, outcome, resolution_hash);
    }
    async function fin_resolve(
        caller: address,
        mid: u64,
        outcome: bool,
        resolution_hash: field
    ) {
        let admin: address = Mapping::get(aa, 0u8);
        assert_eq(caller, admin);
        let close_block: u32 = Mapping::get(mc, mid);
        assert(block.height >= close_block);
        let cur: u8 = Mapping::get(mo, mid);
        assert_eq(cur, 0u8);

        let result: u8 = outcome ? 1u8 : 2u8;
        let unlock_block: u32 = block.height + 50u32;
        let sweep_block: u32 = unlock_block + 200u32;
        Mapping::set(mo, mid, result);
        Mapping::set(rh, mid, resolution_hash);
        Mapping::set(wu, mid, unlock_block);
        Mapping::set(su, mid, sweep_block);
    }

    // ── 6. cancel_market ──────────────────────────────────
    async transition cancel_market(
        public mid: u64,
        public cancellation_hash: field
    ) -> Future {
        return fin_cancel_market(self.caller, mid, cancellation_hash);
    }
    async function fin_cancel_market(
        caller: address,
        mid: u64,
        cancellation_hash: field
    ) {
        let admin: address = Mapping::get(aa, 0u8);
        assert_eq(caller, admin);
        let cur: u8 = Mapping::get(mo, mid);
        assert_eq(cur, 0u8);

        let unlock_block: u32 = block.height + 50u32;
        let sweep_block: u32 = unlock_block + 200u32;
        Mapping::set(mo, mid, 3u8);
        Mapping::set(rh, mid, cancellation_hash);
        Mapping::set(wu, mid, unlock_block);
        Mapping::set(su, mid, sweep_block);
    }

    // ── 7. claim — reveal side only after resolution ─────
    async transition claim(
        receipt: BetReceipt
    ) -> (test_usdcx_stablecoin.aleo/ComplianceRecord, test_usdcx_stablecoin.aleo/Token, Future) {
        let payout_transfer: (
            test_usdcx_stablecoin.aleo/ComplianceRecord,
            test_usdcx_stablecoin.aleo/Token,
            Future
        ) = test_usdcx_stablecoin.aleo/transfer_public_to_private(receipt.owner, receipt.payout);
        return (
            payout_transfer.0,
            payout_transfer.1,
            fin_claim(payout_transfer.2, receipt.mid, receipt.side, receipt.amt, receipt.payout)
        );
    }
    async function fin_claim(
        f: Future,
        mid: u64,
        side: bool,
        amt: u128,
        payout: u128
    ) {
        f.await();
        let outcome: u8 = Mapping::get(mo, mid);
        assert(outcome > 0u8);
        assert_neq(outcome, 3u8);

        let won_yes: bool = outcome == 1u8;
        assert_eq(side, won_yes);

        let yes_mult: u64 = Mapping::get(ym, mid);
        let no_mult: u64 = Mapping::get(nm, mid);
        let mult: u64 = side ? yes_mult : no_mult;
        let expected: u128 = amt * (mult as u128) / 10000u128;
        assert_eq(payout, expected);

        let reserve_mult: u64 = yes_mult >= no_mult ? yes_mult : no_mult;
        let reserve: u128 = amt * (reserve_mult as u128) / 10000u128;
        let outstanding: u128 = Mapping::get_or_use(ol, mid, 0u128);
        let settled: u64 = Mapping::get_or_use(sc, mid, 0u64);
        let paid: u128 = Mapping::get_or_use(pp, mid, 0u128);

        assert(outstanding >= reserve);
        Mapping::set(ol, mid, outstanding - reserve);
        Mapping::set(pp, mid, paid + payout);
        Mapping::set(sc, mid, settled + 1u64);
    }

    // ── 8. forfeit — losing receipt is burned ─────────────
    async transition forfeit(
        receipt: BetReceipt
    ) -> Future {
        return fin_forfeit(receipt.mid, receipt.side, receipt.amt, receipt.payout);
    }
    async function fin_forfeit(
        mid: u64,
        side: bool,
        amt: u128,
        payout: u128
    ) {
        let outcome: u8 = Mapping::get(mo, mid);
        assert(outcome > 0u8);
        assert_neq(outcome, 3u8);

        let won_yes: bool = outcome == 1u8;
        assert_neq(side, won_yes);

        let yes_mult: u64 = Mapping::get(ym, mid);
        let no_mult: u64 = Mapping::get(nm, mid);
        let mult: u64 = side ? yes_mult : no_mult;
        let expected: u128 = amt * (mult as u128) / 10000u128;
        assert_eq(payout, expected);

        let reserve_mult: u64 = yes_mult >= no_mult ? yes_mult : no_mult;
        let reserve: u128 = amt * (reserve_mult as u128) / 10000u128;
        let outstanding: u128 = Mapping::get_or_use(ol, mid, 0u128);
        let settled: u64 = Mapping::get_or_use(sc, mid, 0u64);

        assert(outstanding >= reserve);
        Mapping::set(ol, mid, outstanding - reserve);
        Mapping::set(sc, mid, settled + 1u64);
    }

    // ── 9. refund — cancelled market settlement ───────────
    async transition refund(
        receipt: BetReceipt
    ) -> (test_usdcx_stablecoin.aleo/ComplianceRecord, test_usdcx_stablecoin.aleo/Token, Future) {
        let refund_transfer: (
            test_usdcx_stablecoin.aleo/ComplianceRecord,
            test_usdcx_stablecoin.aleo/Token,
            Future
        ) = test_usdcx_stablecoin.aleo/transfer_public_to_private(receipt.owner, receipt.amt);
        return (
            refund_transfer.0,
            refund_transfer.1,
            fin_refund(refund_transfer.2, receipt.mid, receipt.amt)
        );
    }
    async function fin_refund(
        f: Future,
        mid: u64,
        amt: u128
    ) {
        f.await();
        let outcome: u8 = Mapping::get(mo, mid);
        assert_eq(outcome, 3u8);

        let yes_mult: u64 = Mapping::get(ym, mid);
        let no_mult: u64 = Mapping::get(nm, mid);
        let reserve_mult: u64 = yes_mult >= no_mult ? yes_mult : no_mult;
        let reserve: u128 = amt * (reserve_mult as u128) / 10000u128;
        let outstanding: u128 = Mapping::get_or_use(ol, mid, 0u128);
        let settled: u64 = Mapping::get_or_use(sc, mid, 0u64);
        let paid: u128 = Mapping::get_or_use(pp, mid, 0u128);

        assert(outstanding >= reserve);
        Mapping::set(ol, mid, outstanding - reserve);
        Mapping::set(pp, mid, paid + amt);
        Mapping::set(sc, mid, settled + 1u64);
    }

    // ── 10. withdraw_profit — after grace window only ─────
    async transition sweep_unsettled(
        public mid: u64,
        public amount: u128
    ) -> Future {
        let f: Future =
            test_usdcx_stablecoin.aleo/transfer_public(self.caller, amount);
        return fin_sweep_unsettled(f, self.caller, mid, amount);
    }
    async function fin_sweep_unsettled(
        f: Future,
        caller: address,
        mid: u64,
        amount: u128
    ) {
        f.await();
        let admin: address = Mapping::get(aa, 0u8);
        assert_eq(caller, admin);

        let outcome: u8 = Mapping::get(mo, mid);
        assert(outcome > 0u8);

        let sweep_block: u32 = Mapping::get(su, mid);
        assert(block.height >= sweep_block);

        let outstanding: u128 = Mapping::get_or_use(ol, mid, 0u128);
        assert(amount <= outstanding);
        Mapping::set(ol, mid, outstanding - amount);
    }

    // ── 11. withdraw_profit — after grace window only ─────
    async transition withdraw_profit(
        public mid: u64,
        public amount: u128
    ) -> Future {
        let f: Future =
            test_usdcx_stablecoin.aleo/transfer_public(self.caller, amount);
        return fin_withdraw_profit(f, self.caller, mid, amount);
    }
    async function fin_withdraw_profit(
        f: Future,
        caller: address,
        mid: u64,
        amount: u128
    ) {
        f.await();
        let admin: address = Mapping::get(aa, 0u8);
        assert_eq(caller, admin);

        let outcome: u8 = Mapping::get(mo, mid);
        assert(outcome > 0u8);
        let unlock_block: u32 = Mapping::get(wu, mid);
        assert(block.height >= unlock_block);

        let bank: u128 = Mapping::get(rb, mid);
        let premiums: u128 = Mapping::get(tp, mid);
        let paid: u128 = Mapping::get_or_use(pp, mid, 0u128);
        let outstanding: u128 = Mapping::get_or_use(ol, mid, 0u128);
        let already_withdrawn: u128 = Mapping::get_or_use(wp, mid, 0u128);

        let gross: u128 = bank + premiums;
        let committed: u128 = paid + outstanding;
        assert(gross >= committed);
        let available: u128 = gross - committed;

        assert(available >= already_withdrawn);
        assert(amount <= available - already_withdrawn);
        Mapping::set(wp, mid, already_withdrawn + amount);
    }
}
