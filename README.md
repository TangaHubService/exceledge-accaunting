# Excel Edge Accounting Microservice

Standalone Accounting service (API + DB + UI). Uses **ERP JWT** for AuthN — no local users.

## Quick start

```bash
# From exceledge-accaunting/
cp .env.example .env   # set JWT_SECRET to match ERP
docker compose up -d
npm install
cd apps/api && npx prisma migrate dev --name phase1_foundation
cd ../..
npm run test
npm run dev:api    # :4600
npm run dev:web    # :5174
```

## Phase status

Measured against the specification in [IMPLEMENTATION_GAPS_PLAN.md](./docs/IMPLEMENTATION_GAPS_PLAN.md), which lists what is missing per segment and the plan to close it.

| Phase | Status |
|-------|--------|
| 0 Discovery | Done |
| 1 Company Setup | Partial: setup screen has no forms; opening balances never post; most policies stored but not enforced |
| 2 Chart of Accounts | Mostly done: posting flags on accounts not enforced; import has no screen |
| 3 Integration Engine & GL | Mostly done: refunds, customer/supplier payments and goods received not sent by the ERP |
| 4 Customers & AR | Mostly done: no invoice lines, no PDF statements |
| 5 Suppliers & AP | Mostly done: no bill lines, approval or void |
| 6 Inventory accounting | Mostly done: sale cost of goods comes from the ERP, not accounting valuation |
| 7 Banking & reconciliation | Done for the core flow |
| 8 Tax | Mostly done: PAYE, excise and annual filings are placeholders |
| 9 Expenses | Mostly done: single-level approval; allocations don't reach the GL |
| 10 Fixed assets | Mostly done |
| 11 Recurring journals | Partial: manual run only, journals only, no screen |
| 12 Trial balance & close | Partial: trial balance screen ignores modes and dates; checklist is short |
| 13 Financial statements | Partial: no changes in equity, comparatives or export |
| 14 Multi-currency | Not usable: no foreign amounts stored; revaluation posts wrong amounts |
| 15 Budgets & dimensions | Partial: dimensions never written to journals |
| 16 Controls & approvals | Partial: approvals don't block posting |
| 17 Documents, alerts, import | Partial: no file storage; two alert triggers |
| 18 Payroll accounting (ERP payroll, PAYE/RSSB, scanned supplier bills) | Done |
| 19 Consolidation | Not usable: no access check on member companies; figures are proportional |
| 20 Platform (forecast, anomalies, ESG, workflows, API keys, signatures, assistant) | Prototype: API keys don't authenticate; workflows and signatures are records only |

## Docs

- [Phase 0](./docs/PHASE_0_DISCOVERY_AND_ARCHITECTURE.md)
- [Segments 1–45](./docs/SEGMENTS_1_45_OVERVIEW.md)
- [Phase 1 requirements](./docs/PHASE_1_REQUIREMENTS.md)
