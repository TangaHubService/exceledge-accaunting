# PHASE 6 — Completion Report

**Phase:** 6 — Inventory Accounting  
**Date:** 2026-09-25  
**Documentation:** Segment 11

## Requirements implemented

- Inventory valuation subledger (items, branches, balances, movements, FIFO cost layers) fed by ERP events
- ERP publishes every inventory ledger row through the accounting outbox, with the sale cost price or branch batch-average cost
- Opening stock snapshot requested from Accounting and applied once per item and branch ("set to" the snapshot, posting only the difference)
- Costing: ERP cost first; otherwise FIFO layers or weighted average; transfers received at the dispatched cost; movements without any cost are recorded as uncosted and flagged
- Journals per movement kind, netted into one journal per event:

| Movement | Debit | Credit |
|----------|-------|--------|
| Purchase | Inventory | Goods received not invoiced (2130) |
| Opening | Inventory | Opening balance suspense (6600) |
| Customer return | Inventory | Cost of goods sold (5100) |
| Adjustment in | Inventory | Inventory gain (6900) |
| Adjustment out | Inventory loss (6420) | Inventory |
| Damage / expiry | Inventory write-off (6410) | Inventory |
| Transfer out | Goods in transit (1600) | Inventory |
| Transfer in | Inventory | Goods in transit (1600) |
| Sale | none (posted by `SALE_COMPLETED`) | |

- Accounts mapped in inventory settings override these defaults
- Reconciliation, dashboard and reports; `inventory:view` / `inventory:manage` capabilities

## Backend completed

| Area | Path |
|------|------|
| Domain rules | `packages/domain` movement kinds, issue and receipt costing, opening delta, journal lines, turnover |
| Inventory service/routes | `apps/api/src/modules/inventory/*` (`/api/v1/inventory/...`) |
| Integration hook | `integration.service.ts` routes `INVENTORY_MOVEMENT` and `INVENTORY_OPENING` to the inventory service |
| ERP publishing | `Backend/src/services/accounting-outbox.service.ts`, `inventory-ledger.service.ts`, `batch.service.ts`, `sale-commit.service.ts` |
| ERP snapshot endpoint | `Backend/src/routes/accounting-integration.routes.ts` (`POST /api/accounting-integration/:organizationId/inventory-opening`) |
| Configuration | `ERP_API_URL` in the accounting `.env` |
| Migration | `20260925100000_phase6_inventory_accounting` (creates only) |
| Tests | `packages/domain` inventory rules (8), `apps/api/tests/inventory.test.ts` (roles, costing and GL, opening snapshot and as-at valuation, reports) |

## Frontend completed

- Inventory navigation: Stock value, Stock movements, Reconciliation
- Reports: Inventory valuation, Cost of goods sold, Slow-moving stock
- Load opening stock action for users with `inventory:manage`

## Verification

- Domain 38/38, accounting API 26/26 tests pass; web type-check, ESLint and production build clean
- ERP: type-check clean, stock-related tests pass; the full ERP suite has 6 failures in invoice PDF, login and TIN tests whose source files are unchanged by this phase
- Browser check on test data: ledger and stock records agree at 1,513, cost of goods sold 770, turnover 1.02×

## Known limits and points to review

1. The ERP costs sales by FIFO batches, while the accounting default is weighted average. Because an ERP-supplied cost always wins, the accounting method only applies when the ERP sends no cost. The two settings should be aligned.
2. Stock purchases post Goods received not invoiced. The `SUPPLIER_BILL_APPROVED` rule posts to Purchases, so bills for stock items should clear Goods received not invoiced instead; the ERP does not yet publish supplier bills.
3. The `SALES_RETURN_COMPLETED` rule reverses cost of goods sold. When the ERP starts publishing return stock movements, that event must send a zero cost, or the return will be counted twice. The ERP does not publish returns today.
4. Production movements have no posting rule and go to posting exceptions.
5. The negative inventory policy setting is stored but not enforced by Accounting.
6. Only the first financial period is open until period management (Phase 12); movements dated in a closed period fail and can be retried from posting exceptions.
