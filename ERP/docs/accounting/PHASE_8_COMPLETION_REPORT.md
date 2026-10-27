# PHASE 8 — Completion Report

**Phase:** 8 — Tax Management  
**Date:** 2026-09-25  
**Documentation:** Segment 14

## Requirements implemented

- Tax settings and company-editable tax codes (Rwanda seed: VAT 18%, zero-rated, exempt, input VAT, WHT 3% / 15%).
- VAT return built from posted output and input GL movements; tax payments excluded from gross so outstanding = net − paid.
- Tax adjustments post journals with a mandatory reason; payments and refunds post and reverse through the journal service.
- Filings for VAT and WHT (and stubs for PAYE / excise / annual): prepare snapshots figures; Admin files; prepared returns can be discarded.
- Tax ledger, reconciliation (return vs GL without settlements, vs filed, vs EBM fiscal tax; WHT withheld vs payable GL), and fiscal document register from Excel Edge sale events.
- Capabilities: `tax:view`, `tax:manage`, `tax:file`. Branch managers view; accountants manage; only Admin / System Owner file.

## Backend completed

| Area | Path |
|------|------|
| Domain rules | `packages/domain` tax helpers, capabilities, default account keys |
| Tax service/routes | `apps/api/src/modules/tax/*` (`/api/v1/tax/...`) |
| Integration | Fiscal documents recorded on SALE_COMPLETED / SALES_RETURN_COMPLETED |
| Migration | `20260925140000_phase8_tax_management` |
| Tests | Domain tax block; `apps/api/tests/tax.test.ts` |

## Frontend completed

- Tax navigation: overview, VAT return, filings, tax payments
- Pages: tax ledger, reconciliation, fiscal documents, codes & settings
- Drawers: record payment/refund, adjustment, prepare/file return, add/edit code, settings

## Verification

- Domain 48/48; tax API 3/3; full accounting API suite green when run with Phase 8
- Web type-check clean
- VAT outstanding after a 100,000 payment against 144,000 net = 44,000; reconciliation ledgerVsGl = 0 when settlements are excluded from the GL side

## Known limits

1. Rates are not statutory tables — companies edit their own codes. Do not treat seed rates as legal advice.
2. PAYE and excise filing summaries wait on payroll / product postings.
3. EBM transmission and QR generation stay in Excel Edge; Accounting stores the fiscal link only.
4. Only the first financial period is open until Phase 12; tax payment and adjustment dates must fall in an open period.
5. Supplier WHT detail report remains under Purchases reports; Tax filings hold the WHT return summary.
