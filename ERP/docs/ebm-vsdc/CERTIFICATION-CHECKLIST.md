# RRA VSDC / EBM certification checklist (Excledge)

Use this as a working checklist alongside RRA’s official forms. Requirements change; verify with **cis_sdc_certification@rra.gov.rw** and [RRA EBM pages](https://www.rra.gov.rw/en/ebm-electronic-billing-machine).

## Organizational / legal (typical)

- [ ] Business registration certificate
- [ ] Valid RRA tax clearance certificate
- [ ] Valid RSSB clearance certificate (if applicable)
- [ ] Physical business address documented
- [ ] Software support SLA: supplier ↔ RRA (template from RRA)
- [ ] Software support SLA: supplier ↔ end users (template from RRA)
- [ ] Software documentation (architecture, deployment, security contacts)
- [x] Test cases document (happy path, offline/retry, refund, void, invalid TIN, etc.) — see [TEST-CASES-TEMPLATE.md](./TEST-CASES-TEMPLATE.md)
- [ ] Certification monitoring form (Excel) completed and maintained

## Templates in this folder

- [INTEGRATION.md](./INTEGRATION.md) — env vars and payload overview  
- [TEST-CASES-TEMPLATE.md](./TEST-CASES-TEMPLATE.md) — certification test matrix  
- [SLA-OUTLINE.md](./SLA-OUTLINE.md) — draft SLA sections for RRA and customers  

## Technical evidence (prepare before submission)

- [ ] Sandbox credentials received; all test cases executed in sandbox
- [ ] Evidence logs: sample requests/responses (redact secrets) for sale, refund, void
- [x] Description of retry and dead-letter behavior (`ebm_outbox`, max retries)
- [x] Data retention and audit trail (`ebm_transactions`, activity logs, auditor overview API)
- [x] Per-tenant TIN and device id/serial configuration process documented
- [x] Receipt/PDF shows RRA-mandated fields + official RRA logo (CIS §7.29)

## Implemented CIS / VSDC gaps (code complete)

- [x] All VSDC §3.2.1 API paths (including pharmacy `saveBrancheInsurances`)
- [x] Receipt labels NS/NR/CS/CR/TS/TR/PS
- [x] X/Z daily report fields: opening deposit, proforma, discounts, voids, incomplete sales
- [x] Auditor overview (CIS §7.26) — Fiscal Reports → Auditor tab
- [x] Last-receipt recovery reprint (CIS §7.28)
- [x] Official RRA logo on invoice HTML/JSON payload
- [x] Production & BOM sidebar entry

## Import declarations & B2B purchases (status 2026-10-22)

RRA application checklist rows **§66–§71** (+ related **§25 / §38 / §74**).  
Services: `rra-import.service.ts`, `purchase-sync.service.ts`. UI: sidebar **Purchases** (`/dashboard/purchases`); Fiscal Reports → Stock sync / Imports / Purchases report.

| # | Requirement | Status | Notes |
|---|-------------|--------|-------|
| **§66** | Pull import items (`/imports/selectImportItems`) | **Done** | Cache, list + Pull UI, nightly job, Bruno 07, unit tests. |
| **§67** | Import request-date must be later than previous | **Done** | Enforced in `syncRraImports` via stored cursor; empty pulls do not advance cursor. |
| **§68** | Update import status approve/reject (`imptItemSttsCd` 3/4) | **Done** | Approve/reject with classify; create-or-link product; `hsCd` required; stock booked on approve. |
| **§70** | Pull purchase-sales (`/trnsPurchase/selectTrnsPurchaseSales`) | **Done** | Cache + Pull UI + job; re-pull refreshes PENDING line items; empty pulls do not advance cursor. |
| **§71** | Save/confirm purchase (`pchsSttsCd` 02/04) | **Done** | Confirm/reject UI; `prcOrdCd` + reject remark wired through to VSDC. |
| **§74** | Realtime stock for approved import / confirmed purchase | **Done** | Purchases: local + `savePurchases` + immediate stock master. Imports: local book + immediate `/stock/saveStockItems` + stock master. |
| **§25** | Detailed purchases + importation reports | **Done** | Backend reports + Fiscal Reports → Purchases report tab; `/dashboard/purchases-report` routes there. |
| **§38** | Manage purchase code from purchases | **Done** | `prcOrdCd` persisted on pull, shown/editable on confirm, forwarded on save. |

## Excledge-specific test ideas

1. Sale with standard VAT lines; verify `EbmTransaction` = `SUCCESS` and PDF shows fiscal block.
2. Sale with zero-rated / exempt product mix; verify tax codes on lines.
3. B2B sale with customer TIN populated.
4. Network failure during submit; verify outbox entry and eventual success after retry job.
5. Full refund after successful EBM sale; verify refund API called with original EBM reference.
6. Cancel sale after successful EBM sale; verify void API called.
7. `EBM_USE_MOCK=true` local smoke test without RRA connectivity.
8. Pharmacy: create INSURANCE customer with `isrccCd`, sync, sell with insurance tender — verify line `isrccCd`/`isrcAmt`.
9. Generate X and Z PDFs — confirm opening deposit / proforma / discount / incomplete rows.

## Contacts

- Certification: **cis_sdc_certification@rra.gov.rw**
- General RRA: toll-free **3004** (verify on RRA website)
