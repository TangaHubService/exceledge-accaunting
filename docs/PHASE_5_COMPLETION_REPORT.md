# PHASE 5 — Completion Report

**Phase:** 5 — Suppliers & Accounts Payable  
**Date:** 2026-09-24  
**Documentation:** Segment 5

## Requirements implemented

- Supplier profiles: category, TIN, VAT registration, payment terms, bank details, AP and default expense accounts, withholding category and rate, opening balance, status
- Posted supplier bills with duplicate supplier-invoice protection, PO and GRN references, and due dates from payment terms
- Supplier payments with allocation to bills, unallocated amounts, withholding tax, and dated reversal
- Supplier credit notes and debit notes (debit notes are allocatable and aged like bills)
- Supplier advances: record, apply to bills, refund
- Supplier ledger, statements, payables ageing, withholding tax report, purchases by supplier, AP dashboard with a 30-day payment calendar
- ERP `SUPPLIER_BILL_APPROVED` and `SUPPLIER_PAYMENT_COMPLETED` events written to the AP subledger after the GL journal (idempotent)
- `ap:view` and `ap:manage` capabilities and audit entries for every AP action

## Backend completed

| Area | Path |
|------|------|
| Domain rules | `packages/domain` AP bill, note, payment, withholding, and advance journal lines |
| Shared document helpers | `apps/api/src/lib/documents.ts` (numbering, money, default accounts) |
| AP service/routes | `apps/api/src/modules/ap/*` |
| ERP subledger hooks | `integration.service.ts` → `SUBLEDGER_SYNC` map |
| Migration | `20260924223000_phase5_accounts_payable` |
| Tests | `apps/api/tests/ap.test.ts` (roles, full flow with GL reconciliation, inactive supplier, ERP sync) |

## Frontend completed

- Purchases navigation: Suppliers, Bills, Supplier payments
- Supplier account page: figures, open and all bills, payments, advances, account activity, and all AP dialogs
- Reports: Payables ageing, Purchases by supplier, Withholding tax
- Overview: amount owed to suppliers, overdue and due-today alerts, upcoming supplier payments, payables by age

## Known limits

1. Purchase requisitions, purchase orders, and goods received notes belong to ERP procurement; Accounting stores their references only.
2. Withholding tax certificates are deferred to Phase 17 (documents).
3. The ERP does not yet publish supplier bill or payment events; the Accounting side accepts them when it does.
4. Purchase discount and purchase returns accounts are not mapped by default. Bills with a discount are refused until an account is mapped, and credit notes post to Purchases.
5. The seeded Supplier Advances account (2110) is a liability; supplier prepayments are normally an asset. It should be reviewed before go-live.
6. Only the first financial period is open until period management (Phase 12), so AP dates must fall in an open period.
