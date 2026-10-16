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

## Dokploy deploy

This repo is an **npm workspaces monorepo**. Deploy **two Dokploy applications** from the **same Git repo**. Both must use **Root Directory = empty** (repo root) so `packages/domain` resolves. Do **not** set Root Directory to `apps/web` or `apps/api`.

| App | Role | Config file |
|-----|------|-------------|
| Accounting **API** | Node server | [`nixpacks.toml`](./nixpacks.toml) (default) |
| Accounting **WEB** | Static SPA | [`nixpacks.web.toml`](./nixpacks.web.toml) via env |

### 1) Accounting API (you already have this)

- Build Type: **Nixpacks**
- Root Directory: **empty**
- Leave Install / Build / Start empty (honours `nixpacks.toml`)
- Attach API domain, e.g. `https://api.exceledgecpa.com` (port from the API, usually `4600`)

### 2) Accounting WEB (separate Dokploy app, same repo)

- Build Type: **Nixpacks**
- Root Directory: **empty** (same as API — required)
- **Publish Directory:** `apps/web/dist`
- Environment variables:

```env
NIXPACKS_CONFIG_FILE=nixpacks.web.toml
VITE_ERP_URL=https://erp.exceledgecpa.com
VITE_ERP_API_URL=https://erpapi.exceledgecpa.com/api
VITE_ACCOUNTING_API_URL=https://api.exceledgecpa.com
```

(`VITE_ACCOUNTING_API_URL` = your **API** Dokploy domain. Required when web and API are on different hosts.)

- Domains → Generate / add a **web** domain, e.g. `https://accounting.exceledgecpa.com`
- Port for the static Nginx image is usually **80**

### How you access them

| What | URL |
|------|-----|
| Web UI | `https://<web-app-domain>` (the WEB Dokploy app) |
| API | `https://<api-app-domain>` (the API Dokploy app) |

Open the **web** domain in the browser. The SPA calls the API using `VITE_ACCOUNTING_API_URL` baked in at build time — redeploy web after changing those `VITE_*` values.

Optional Dockerfile fallback: `apps/web/Dockerfile` (context `.`) if you prefer Docker over Nixpacks.

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
