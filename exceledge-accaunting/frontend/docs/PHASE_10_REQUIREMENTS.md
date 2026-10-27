# PHASE 10 — Requirements Checklist

**Documentation:** Segment 13 — Fixed Assets Management  
**Builds on:** Phase 3 journals/GL; Phase 7 banking (settlement accounts); Phase 9 expenses (optional maintenance posting)

## Design

- Fixed assets are **capital items** on a company register. Registration is metadata-only until capitalization posts Dr Fixed Asset / Cr Bank (or AP).
- Categories carry editable useful life, residual %, method (straight-line or reducing-balance) and GL defaults. Seed categories are company starting points — **not** statutory depreciation tables.
- Monthly depreciation runs are idempotent per `yyyy-mm`. Charges use domain math (`roundMoney` 4 dp) and post aggregated Dr Depreciation Expense / Cr Accumulated Depreciation.
- Transfers update location/custodian dimensions only (no intercompany GL in this phase). Maintenance can optionally post a repairs expense. Revaluation updates cost vs revaluation reserve; impairment increases accumulated depreciation; disposal clears cost/accum and records proceeds + gain/loss.
- ERP `ASSET_ACQUIRED` events register and capitalize idempotently on source document.

## Checklist

- [x] Asset categories with dep defaults; seed set — 13.5
- [x] Asset registration (number, cost, location, custodian, serial, etc.) — 13.6
- [x] Capitalization with FA / bank|AP journal — 13.7
- [x] Straight-line and reducing-balance depreciation; monthly run — 13.8, 13.9
- [x] Maintenance history (+ optional expense post) — 13.10
- [x] Transfers between branch/location/employee — 13.11
- [x] Revaluation and impairment with GL — 13.12, 13.13
- [x] Disposal (sale/scrap/donation/theft/destruction/retirement) — 13.14
- [x] Asset register + depreciation schedule — 13.15, 13.19
- [x] Validation: residual ≤ cost, open period via journals, accounts mapped — 13.16
- [x] Audit on register/capitalize/depreciate/transfer/maintain/revalue/impair/dispose — 13.17
- [x] Capabilities: `fa:view`, `fa:manage`, `fa:post`
- [x] Web: overview, register, asset detail, depreciation, categories
- [x] Automated tests (domain helpers; API roles, lifecycle, ERP sync)

**PHASE STATUS: COMPLETE for Segment 13 fixed assets core**

Units-of-production and sum-of-years-digits methods deferred. Intercompany transfer GL waits on multi-entity. Attachments wait on Phase 17. Budget links wait on Phase 15.
