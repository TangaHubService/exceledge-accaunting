# PHASE 8 — Requirements Checklist

**Documentation:** Segment 14 — Tax Management  
**Builds on:** Phase 4 AR (output VAT), Phase 5 AP (input VAT and WHT), Phase 7 banking (tax settlements), Excel Edge EBM (fiscal documents)

## Design

- Tax is a **subledger and reporting layer** over amounts already posted by sales, purchases, payroll and Excel Edge. Accounting does **not** invent or recalculate statutory rates; rates live on company-editable tax codes (Rwanda seed codes are defaults).
- VAT return output/input come from the mapped tax GL accounts for the period. Tax payments are listed separately so they are not double-counted in net VAT due.
- Filings snapshot return figures at prepare time. Only Admin / System Owner mark a return filed (`tax:file`).
- Fiscal documents store EBM receipt metadata from ERP sale events; Excel Edge owns transmission to VSDC/RRA.

## Checklist

- [x] Tax settings: authority, TIN, VAT registration, filing frequency, currency, rounding, default codes — 14.5
- [x] Tax codes: code, name, type, rate, effective dates, authority, applies-to, GL account, active flag; Rwanda seed set — 14.6
- [x] Output / input VAT from posted AR and AP; adjustments with reason — 14.7, 14.11
- [x] Withholding from AP payments; WHT filing summary — 14.8
- [x] PAYE account mapping ready for payroll hand-off (no invented payroll engine) — 14.9
- [x] Fiscal documents from SALE_COMPLETED / SALES_RETURN_COMPLETED metadata — 14.10
- [x] Tax payments and refunds post balanced journals; reversible — 14.12
- [x] VAT return schedule, tax ledger, reconciliation (return vs GL excl. settlements, vs filed, vs EBM; WHT vs GL) — 14.13–14.15
- [x] Filings: prepare → file; discard only while unfiled — 14.14
- [x] Dashboard: balances, month movement, due filings, recent payments — 14.4
- [x] Capabilities: `tax:view`, `tax:manage`, `tax:file`
- [x] Web: overview, VAT return, ledger, payments, filings, settings/codes, reconciliation, fiscal documents
- [x] Automated tests (domain tax helpers; API roles, VAT pay/file, adjustments, WHT filing, fiscal docs)

**PHASE STATUS: COMPLETE for Segment 14 tax books core**

Statutory rate tables are company configuration, not hard-coded law. PAYE and excise returns wait on payroll / product modules. EBM transmission remains in Excel Edge.
