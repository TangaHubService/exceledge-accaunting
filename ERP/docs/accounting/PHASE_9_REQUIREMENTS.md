# PHASE 9 — Requirements Checklist

**Documentation:** Segment 12 — Expense Management  
**Builds on:** Phase 3 journals/GL; Phase 5 AP (on-account payables); Phase 7 banking (settlement accounts); Phase 8 tax (input VAT amounts)

## Design

- Expenses are **operating cost documents** that post balanced journals when approved/posted. Amounts and tax come from the user (or ERP event) — rates are not recalculated here.
- Categories map to expense GL accounts; a Rwanda-oriented seed set is created on first use and creates missing 61xx accounts when needed.
- Workflow: Draft → Submitted → Approved → Posted (or Rejected). Accountants can post drafts directly. Posted expenses reverse; they are never deleted.
- Payment modes: paid now (Dr expense / VAT, Cr bank), on account (Cr AP or accrued expenses), employee reimbursement.
- Optional allocation lines must sum to the gross. Branch / department / cost centre / project are free-text dimensions until Phase 15.
- Recurring templates generate expenses on demand (`Run now`); scheduled automation stays with Phase 11/17.
- ERP `EXPENSE_APPROVED` events create a posted expense idempotently.

## Checklist

- [x] Expense categories linked to GL accounts; seed set — 12.5
- [x] Record expense with payee, amounts, tax, payment mode, dimensions, allocations — 12.6, 12.9
- [x] Employee claims (reimbursement mode) — 12.7
- [x] Recurring expense templates with frequency and generate — 12.8
- [x] Approval workflow Draft → Submitted → Approved → Posted / Rejected — 12.10
- [x] Automatic journals for immediate and on-account — 12.11
- [x] Dashboard and by-category report — 12.4, 12.17
- [x] Validation: category, amount, open period (via journal service), payment account — 12.14
- [x] Audit on create/submit/approve/reject/post/reverse — 12.15
- [x] Capabilities: `expense:view`, `expense:manage`, `expense:approve`
- [x] Web: overview, list, recurring, categories, report
- [x] Automated tests (domain helpers; API roles, post, claim, recurring, ERP sync)

**PHASE STATUS: COMPLETE for Segment 12 expense books core**

Budget checks wait on Phase 15. File attachments wait on Phase 17. Multi-level approval matrices wait on Phase 16.
