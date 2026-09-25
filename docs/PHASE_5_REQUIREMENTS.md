# PHASE 5 — Requirements Checklist

**Documentation:** Segment 5 — Suppliers & Accounts Payable  
**Builds on:** Phase 3 journals, GL, integration posting rules; Phase 4 subledger pattern

## Checklist

- [x] Supplier master (legal, tax, contact, location, financial profile, bank details, category, status) — 5.5, 5.6
- [x] Supplier opening balance posted to AP against suspense/retained earnings — 5.5
- [x] Supplier bills posted to purchases/expense, input VAT, and AP — 5.7
- [x] Supplier invoice number unique per supplier; PO and GRN references stored on the bill — 5.7, 5.17
- [x] Supplier payments: full, partial, multi-bill allocation, unallocated amount kept on account — 5.10
- [x] Payment methods: cash, bank transfer, mobile money, cheque, EFT — 5.10
- [x] Payment reversal restores bill balances and posts a reversing journal — 5.10
- [x] Withholding tax deducted on payment and credited to WHT payable; rate comes from the supplier record (user-configured, no built-in rates) — 5.15
- [x] Withholding tax report — 5.15, 5.20
- [x] Supplier advances: record, allocate (full or partial), refund, history — 5.9
- [x] Supplier credit notes (optionally against a bill) and debit notes — 5.11, 5.12
- [x] Supplier subsidiary ledger with running balance — 5.13
- [x] Supplier statement (outstanding and full) — 5.20
- [x] Payables ageing (current through over 120 days) — 5.14
- [x] Purchases by supplier / top suppliers report — 5.20
- [x] Dashboard: suppliers, outstanding, due today, overdue, advances, monthly purchases, average payment period, ageing, recent bills and payments, payment calendar — 5.4
- [x] Validation: supplier exists and is active, amounts positive, allocations within outstanding, duplicate supplier invoice blocked, period open (journal service) — 5.17
- [x] ERP `SUPPLIER_BILL_APPROVED` and `SUPPLIER_PAYMENT_COMPLETED` mirrored onto the AP subledger without a second journal — 5.8, 5.19
- [x] Capabilities: `ap:view`, `ap:manage`
- [x] Audit on supplier create/update and every posted AP document — 5.18
- [x] Web: suppliers, supplier account, bills, payables ageing, WHT report, sidebar entries
- [x] Automated tests (domain + API)

**PHASE STATUS: COMPLETE for the Segment 5 books core**

Purchase requisitions, purchase orders and goods received notes belong to the ERP procurement module; the books store their references and post `GOODS_RECEIVED` through the Phase 3 rule. WHT certificates as printable documents stay with document delivery (Phase 17).
