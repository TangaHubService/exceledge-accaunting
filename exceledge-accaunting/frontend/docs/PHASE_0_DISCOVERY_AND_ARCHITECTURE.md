# PHASE 0 — Discovery & Architecture

**Status:** COMPLETE (architecture decisions documented; awaiting review before Phase 1)  
**Date:** 2026-09-17  
**Revised:** 2026-09-17 — standalone microservice + **ERP-owned auth** + full Seg 1–45 map  
**Primary specification:** ACCOUNTING MODULE DOCUMENTATION.pdf (Segments 1–45)  
**Full segment overview:** [`SEGMENTS_1_45_OVERVIEW.md`](./SEGMENTS_1_45_OVERVIEW.md)  
**Extracted text:** `/Users/apple/Desktop/Excledge/docs/accounting-module-documentation-extracted.txt`  
**Existing ERP (operational + identity):** `/Users/apple/Desktop/Excledge` (`Backend` + `Frontend`)  
**Accounting microservice:** `/Users/apple/Desktop/Excledge/exceledge-accaunting`

---

## Executive summary

Excel Edge ERP is a multi-tenant **operational + identity** system (POS, inventory, purchases, RRA/EBM, expenses, debtors, **users/login**) with **no double-entry General Ledger**.

**Accounting is a microservice**: separate deployable API + DB + UI. It must **not duplicate** what ERP already owns (users, passwords, org membership, POS, stock, fiscal EBM).

| Concern | Decision |
|---------|----------|
| Runtime | **Own backend service** in `exceledge-accaunting` |
| Database | **Own PostgreSQL** (books only — no ERP user/org master copies as system of record) |
| UI | **Own Accounting frontend** (calls Accounting API with **ERP JWT**) |
| AuthN | **ERP only** — Accounting validates ERP access JWT (shared secret / JWKS). No login, refresh, or password APIs in Accounting |
| AuthZ | Accounting permission checks using ERP token claims (`userId`, `activeOrganizationId`, `role`, branches). Optional capability matrix keyed by ERP role — **no local user tables** |
| ERP link | HTTP event ingest + thin ERP outbox publisher |
| Domain ownership | ERP = ops + identity; Accounting = financial books |

| Area | Verdict vs ERP |
|------|----------------|
| Operational ERP (POS, stock, PO, RRA) | Mature — **do not rebuild**; **integrate via events** |
| Tenancy / org model | ERP has it — Accounting keeps **its own company/branch model** with `externalErp*` IDs |
| Chart of Accounts / Journals / GL | **Missing** — build entirely in Accounting service |
| AR/AP / Banking / FA / Periods | **Missing** — build in Accounting service |

---

## 1. Existing ERP Architecture Map (integration source)

### 1.1 Stack (ERP — unchanged, remains separate)

| Layer | Technology |
|-------|------------|
| Backend | Node ≥20, Express 4, TypeScript, Zod, Prisma 5, PostgreSQL |
| Auth | JWT; `Organization` + `Branch` tenancy |
| Jobs | `node-cron` (EBM outbox, stock sync, …) |
| Frontend | React 19 + Vite 7 |

### 1.2 Operational flows today (no GL)

```
POS commitSale → Sale + InventoryLedger + Customer.balance + EbmOutbox
PO receive     → InventoryLedger (+ SupplierInvoice / SupplierPayment)
Expenses       → expenses table
DebtPayment    → Customer.balance
```

**No path to journals/GL.** ERP will only gain a **thin integration publisher** that forwards approved transactions to the Accounting service.

### 1.3 Pattern to mirror (conceptually): EBM Outbox

ERP already uses durable outbox for EBM. For Accounting:

1. ERP writes operational row + **`ErpAccountingOutbox`** row (ERP DB) in one transaction.
2. ERP worker POSTs event to **Accounting Integration API**.
3. Accounting persists event + posts journals in **Accounting DB**.
4. Idempotency keys prevent duplicates across retries.

Accounting does **not** share ERP tables or run inside ERP Express.

### 1.4 Key ERP hooks (publisher-only touchpoints)

| Concern | Path |
|---------|------|
| Sale commit | `Backend/src/services/sale-commit.service.ts` |
| Inventory | `Backend/src/services/inventory-ledger.service.ts` |
| Purchases / supplier invoices / payments | purchase + supplier controllers |
| Debt payments / expenses | respective controllers |
| EBM outbox pattern | `ebm-outbox.service.ts` (reference for ERP-side outbox) |

---

## 2. Documentation → Existing ERP Gap Analysis

Classification: **AS** Already Supported (in ERP ops) · **PS** Partial · **M** Missing · **RI** Requires Integration · **Build** = implement in Accounting service

| Doc area | ERP | Accounting service |
|----------|-----|--------------------|
| Company profile / FY / periods / activation | PS (org TIN/currency only) | **Build** (Seg 2) |
| Chart of Accounts | M | **Build** |
| Journals / Rules / GL | M | **Build** |
| POS / Sales | AS | **RI** — ingest `SALE_COMPLETED` |
| Customers | PS (master + debt) | **Build** AR + **RI** party sync |
| Suppliers / AP | PS | **Build** AP + **RI** |
| Inventory valuation journals | PS (stock only) | **Build** + **RI** |
| Banking / recon / FA / payroll / budget | M | **Build** |
| RRA / EBM | AS (fiscal) | **RI** tax ledger / recon (fiscal stays ERP) |
| Users / login / invitations (Seg 23) | AS in ERP | **Do not rebuild** — validate ERP JWT |
| Accounting action permissions | PS (ACCOUNTANT role) | **AuthZ adapter** in Accounting (role→capability); no user store |
| Audit | PS | **Build** accounting audit trail (actions), not identity audit |

---

## 3. Proposed Accounting Architecture (standalone system)

### 3.1 Placement decision (revised)

| Option | Decision |
|--------|----------|
| Where does code live? | **`exceledge-accaunting` only** for Accounting backend + Accounting UI |
| ERP Backend | **No accounting domain.** Only optional thin `accounting-integration` publisher/outbox |
| Database | **Dedicated Accounting PostgreSQL** |
| Deploy | Separate process, port, env, migrations, CI |
| UI | **Own Accounting SPA** (can later deep-link from ERP; not required to live inside ERP `Frontend`) |

### 3.2 System context

```
┌─────────────────────────────────────┐     ┌──────────────────────────────────────────┐
│  Excel Edge ERP                     │     │  Accounting microservice                 │
│  Identity + Ops + ERP DB            │     │  api + web + Accounting DB (books only)  │
│                                     │     │                                          │
│  Login / JWT / Users / Roles        │────►│  Validate ERP JWT (no local users)       │
│  POS, Inventory, Purchases, EBM …   │     │  Setup, COA, Journals, GL, AR/AP, …      │
│                                     │     │                                          │
│  ErpAccountingOutbox ──HTTP─────────┼────►│  Integration Ingest (API key)            │
│                                     │◄────┼──  Posting status webhooks / poll        │
└─────────────────────────────────────┘     └──────────────────────────────────────────┘
```

### 3.3 Logical layers (inside Accounting service only)

```
accounting-web (UI)
        │
accounting-api
  controllers  →  application services  →  domain
                                              ├─ CompanySetup / Activation
                                              ├─ ChartOfAccounts
                                              ├─ PostingRulesEngine
                                              ├─ JournalEngine (ΣD = ΣC)
                                              ├─ GeneralLedger
                                              ├─ SubsidiaryLedgers
                                              └─ PeriodControl
                                         →  repositories (Accounting DB)
                                         →  integration adapters (ERP ingest, webhooks)
                                         →  workers (event processor, retries)
                                         →  audit + authz
```

**Rule:** No accounting posting math in ERP. No ERP Prisma models imported into Accounting.

### 3.4 Stack (Accounting service — compatible with ERP tech)

| Layer | Choice |
|-------|--------|
| Language | TypeScript |
| API | Express (or Fastify) — same ecosystem as ERP for team familiarity |
| ORM | Prisma + **own** schema |
| DB | PostgreSQL (**own** instance/database) |
| Validation | Zod |
| Jobs | In-process cron or worker process for event retries |
| UI | React + Vite + Tailwind (visual language can align with ERP; separate app) |
| AuthN (humans) | **ERP JWT validation only** (same `JWT_SECRET` or ERP JWKS). No Accounting login |
| AuthZ (humans) | Capability checks from ERP claims (`role`, org, branch); optional static role→permission map in Accounting config |
| AuthN (ERP→Accounting) | Service API key / HMAC for integration ingest (machine identity, not end-user accounts) |

### 3.5 Hard invariants

1. `Σ debit = Σ credit` on every posted journal.
2. Posted journals never deleted — reverse only.
3. Accounting inactive until mandatory setup complete.
4. Idempotent ingest: same `idempotencyKey` never double-posts.
5. Tenant isolation inside Accounting DB via Accounting `companyId` / `branchId`.
6. **Process isolation:** Accounting API never opens ERP database connections.

---

## 4. Database Design

### 4.1 ERP database

- **Unchanged** for accounting books.
- Optional addition only: `erp_accounting_outbox` (or similar) for reliable delivery to Accounting.
- Optional status columns on source docs: `accountingSyncStatus`, `accountingExternalJournalId` (strings — no FK to Accounting DB).

### 4.2 Accounting database (own)

Accounting holds **its own** masters and books. ERP entities are referenced by **external IDs**, not shared tables.

**Company link / tenancy (Accounting books — not ERP identity clone)**

- `companies` — accounting company profile; **required** `externalErpOrganizationId` (link to ERP org). No passwords.
- `branches` — optional accounting branch dimension; `externalErpBranchId`
- **No** `users` / `passwords` / `refresh_tokens` / `invitations` tables
- `role_capability_policies` (optional) — maps ERP role names → accounting permissions
- `audit_events` — records `erpUserId` from JWT, never local user FKs

**Setup (Phase 1)**

- `company_accounting_profiles`
- `financial_years`, `accounting_periods`
- `currency_settings`, `exchange_rates`
- `accounting_policies`
- `localization_settings`
- `default_posting_accounts`
- `inventory_accounting_settings`
- `party_defaults`
- `banking_payment_settings`
- `number_sequences`
- `approval_posting_controls`
- `opening_balance_batches` / `lines`
- `accounting_activations`
- `setup_section_statuses`

**COA / GL (Phase 2–3)**

- `accounts`, `journals`, `journal_lines`
- `posting_rules`, `posting_rule_lines`
- `integration_events`, `posting_exceptions`
- `source_document_links` (stores ERP type + external id + journal id)

**Party mirrors (for AR/AP — synced or manually maintained)**

- `customers` (`externalErpCustomerId` nullable — Accounting can run standalone)
- `suppliers` (`externalErpSupplierId` nullable)

Accounting can operate **without** ERP (manual journals, manual parties). ERP integration is additive.

### 4.3 Conventions

- Accounting DB: no requirement for `accounting_` table prefix (entire DB is accounting); use clear domain names.
- Money: `Decimal(18, 4)` with policy-driven display precision.
- All business rows: `companyId` required; `branchId` optional.

---

## 5. Integration Contract

### 5.1 Transport

| Path | Purpose |
|------|---------|
| `POST /api/v1/integration/events` | ERP → Accounting event ingest (API key / HMAC) |
| `POST /api/v1/integration/master-data/*` | Optional sync: company, branch, customer, supplier |
| `GET /api/v1/integration/events/:idempotencyKey` | ERP polls posting status |
| `POST /api/v1/integration/webhooks/posting-status` | Accounting → ERP callback (optional) |

ERP never writes Accounting tables directly.

### 5.2 Event envelope

```ts
interface AccountingEventEnvelope {
  eventId: string;
  idempotencyKey: string;          // unique per business fact
  externalOrganizationId: string;  // ERP organization id
  externalBranchId?: string | null;
  eventType: AccountingEventType;
  occurredAt: string;
  sourceModule: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  sourceDocumentNumber?: string;
  currencyCode: string;
  amountTotals: { gross: string; net: string; tax: string; discount?: string };
  parties?: {
    externalCustomerId?: string;
    externalSupplierId?: string;
  };
  lines: AccountingEventLine[];
  paymentSplits?: PaymentSplit[];
  taxSummary?: TaxLine[];
  metadata?: Record<string, unknown>;
  correlationId?: string;
}
```

Accounting maps `externalOrganizationId` → internal `companyId` (must be linked during company setup / connection).

### 5.3 Event catalog

| Event | ERP trigger | Accounting effect (rules-driven) |
|-------|-------------|----------------------------------|
| `SALE_COMPLETED` | `commitSale` | Dr Cash/Bank/AR · Cr Sales · Cr VAT · Dr COGS · Cr Inventory |
| `SALES_RETURN_COMPLETED` | refund/return | Return / reversal journals |
| `CUSTOMER_PAYMENT_RECEIVED` | DebtPayment | Dr Cash/Bank · Cr AR |
| `SUPPLIER_BILL_APPROVED` | Supplier invoice approved | Dr Expense/Inventory/VAT · Cr AP |
| `GOODS_RECEIVED` | PO receive | Dr Inventory · Cr GRNI |
| `SUPPLIER_PAYMENT_COMPLETED` | SupplierPayment | Dr AP · Cr Cash/Bank · WHT |
| `INVENTORY_ADJUSTED` | adjustStock | Inventory vs adj accounts |
| `INVENTORY_WRITTEN_OFF` | write-off | Write-off · Inventory |
| `EXPENSE_APPROVED` | Expense approved | Expense · Cash/AP |
| `BANK_TRANSACTION_POSTED` | (Accounting banking or ERP later) | Bank + GL |
| `PAYROLL_APPROVED` | future | Payroll journals |
| `ASSET_ACQUIRED` / `DEPRECIATION_POSTED` | future | FA journals |

### 5.4 Idempotency

- Unique on `idempotencyKey` in Accounting `integration_events`.
- ERP outbox retries safely.
- Status: `RECEIVED` → `PROCESSING` → `POSTED` | `FAILED` | `REJECTED`.

### 5.5 ERP publisher (minimal change to ERP)

| Location | Action |
|----------|--------|
| `sale-commit.service.ts` | Enqueue outbox row after successful commit |
| Debt / PO / supplier invoice / payment / expense / inventory adj | Same pattern |
| New ERP job | Deliver outbox → Accounting ingest URL |

No journal logic in ERP.

---

## 6. Full Implementation Roadmap

**All 45 documentation segments are in scope** — see [`SEGMENTS_1_45_OVERVIEW.md`](./SEGMENTS_1_45_OVERVIEW.md).  
Code lives in `exceledge-accaunting`, except ERP identity (Seg 23) and thin ERP publishers.

| Phase | Name | Doc segments | Where |
|-------|------|--------------|--------|
| **0** | Discovery & Architecture | 1 | Docs |
| **1** | Foundation & Company Setup | 2, 21 (setup audit), 22 (basic) | Accounting |
| **2** | Chart of Accounts | 3 | Accounting |
| **3** | Integration Engine & GL | 1.6, 8, 9, 27 (ingest), 29, 39 (APIs) | Accounting + ERP outbox |
| **4** | Customers & AR | 4 | Accounting |
| **5** | Suppliers & AP | 5 | Accounting |
| **6** | Inventory Accounting | 11 | Accounting + ERP events |
| **7** | Banking & Reconciliation | 6, 7 | Accounting |
| **8** | Tax & Rwanda localization | 14 | Accounting |
| **9** | Expense accounting | 12 | Accounting |
| **10** | Fixed Assets | 13 | Accounting |
| **11** | Manual & Recurring Journals | 8 (UI), 25 | Accounting |
| **12** | Closing & Trial Balance | 10, 20, 29 | Accounting |
| **13** | Financial & management reporting | 15, 16, 28 | Accounting |
| **14** | Multi-Currency | 19 | Accounting |
| **15** | Budgets, Projects, Cost Centres | 17, 18 | Accounting |
| **16** | Approvals, controls, audit harden | 21, 22, 34 (Seg 23 = ERP) | Accounting AuthZ + ERP roles |
| **17** | Notifications, documents, I/E | 24, 26, 27 | Accounting |
| **18** | Payroll accounting hooks | 14 payroll accounts | When ERP payroll exists |
| **19** | Multi-company / group consolidation | 30, 33 | Accounting |
| **20** | Advanced platform (AI, ESG, marketplace, …) | **31–45** | Backlog after core books |

---

## 7. Phase 1 preview (not started)

Phase 1 builds **only inside `exceledge-accaunting`**:

- Service bootstrap (API, DB, migrations)
- **ERP JWT middleware** (validate token; require `activeOrganizationId`; map to accounting `company`)
- Company Accounting Setup (Seg 2): 14 sections, statuses, activation gate
- Role→capability checks from ERP roles (no local users)
- Audit trail for setup changes (`erpUserId`)
- Minimal system COA seed only if needed for default-account pickers (full COA = Phase 2)
- **No** login/register/refresh in Accounting
- **No** embedding accounting domain into ERP Backend
- ERP event publisher still waits until Phase 3

---

## 8. Repository layout (`exceledge-accaunting`)

```
exceledge-accaunting/
  docs/
    PHASE_0_DISCOVERY_AND_ARCHITECTURE.md
    adr/
  apps/
    api/                 # Accounting backend microservice
      prisma/
      src/
        modules/
          setup/
          chart-of-accounts/
          journals/
          gl/
          integration/   # ERP event ingest
          authz/         # ERP JWT verify + capability map (NO user CRUD)
          audit/
        ...
    web/                 # Accounting frontend (own system UI)
  packages/
    domain/              # pure domain (balance rules, etc.)
    contracts/           # shared event Zod types (publishable to ERP later)
  docker-compose.yml     # Accounting Postgres (+ api/web for local)
  README.md
```

ERP repo stays independent. Optional later: publish `@exceledge/accounting-contracts` for ERP publisher typing.

---

## 9. Architecture Decision Records (ADR)

### ADR-001 — Standalone Accounting service (REVISED)
**Decision:** Accounting is a **separate backend service and system** in `exceledge-accaunting`, with its **own database and UI**.  
**Why:** Clear isolation, independent deploy/scale, no risk of coupling accounting logic into ERP controllers, matches “own system” product boundary.  
**Rejected:** Embedding Accounting modules/tables inside current ERP Backend/DB.

### ADR-002 — Durable integration, not shared DB transactions
**Decision:** ERP uses an **ERP-side outbox** + HTTPS ingest into Accounting. Accounting stores `integration_events` and processes asynchronously.  
**Why:** No distributed DB transactions; retries and idempotency across service boundary.  
**Note:** Exactly-once delivery is approximated by at-least-once + idempotency keys.

### ADR-003 — ERP remains source of operational truth
**Decision:** POS/Inventory/Procurement stay in ERP. Accounting owns financial postings only.  
**Why:** Spec Automation First / Single Source of Truth for ops entry.

### ADR-004 — ERP owns authentication (REVISED)
**Decision:** End-user AuthN is **only** in ERP. Accounting microservice validates the ERP access JWT and never stores credentials, refresh tokens, or user masters. Spec Segment 23 (Users & Permissions) is implemented/extended in **ERP**, not cloned in Accounting.  
**AuthZ:** Accounting enforces accounting capabilities from JWT claims (`userId`, `activeOrganizationId`, org `role`, `branchIds`) plus an optional role→capability map. Audit rows store `erpUserId`.  
**Machine auth:** ERP→Accounting ingest uses API key/HMAC (service identity).  
**Why:** “What is in ERP must not be in Accounting” — no duplicate identity microservice.

### ADR-005 — Rwanda localization as package
**Decision:** Universal core + `RW` localization package.  
**Why:** Spec §2.2.

### ADR-006 — Books microservice with ERP-linked companies
**Decision:** Accounting DB holds financial configuration and books for companies linked by `externalErpOrganizationId`. Manual journals are allowed inside Accounting after activation; identity and operational masters still come from ERP.  
**Why:** Microservice books + single identity provider (ERP).

---

## 10. Phase 0 deliverables checklist

- [x] Read Accounting Module documentation
- [x] Inspect ERP Backend / Frontend
- [x] Architecture map
- [x] Gap analysis
- [x] Proposed **standalone** Accounting architecture
- [x] Database design (separate Acc DB + optional ERP outbox)
- [x] Integration contract
- [x] Roadmap
- [x] ADRs (standalone service + ERP auth)
- [x] Full Segments 1–45 overview mapped to phases
- [ ] **Human review / approval** before Phase 1 coding

---

## PHASE STATUS: 100% COMPLETE (Discovery & Architecture)

**Locked:** Accounting = microservice (own API/DB/UI) · Auth = ERP JWT only · Spec Segs 1–45 all inventoried.  
Await confirmation to begin **Phase 1** inside `exceledge-accaunting`.
