# PHASE 4 — Completion Report

**Phase:** 4 — Customers & Accounts Receivable  
**Date:** 2026-09-24  
**Documentation:** Segment 4

## Requirements implemented

- Customer profiles with credit control fields
- Posted invoices, receipts, credit notes, debit notes, and deposits
- Allocations, receipt reversal, deposit apply/refund
- Subsidiary ledger, statements, ageing, dashboard
- POS sale events written to the AR subledger after the existing GL journal
- ERP-role capabilities and audit entries

## Backend completed

| Area | Path |
|------|------|
| Domain rules | `packages/domain` ageing, credit limit, allocations, AR journal lines |
| AR service/routes | `apps/api/src/modules/ar/*` |
| POS subledger hook | `integration.service.ts` → `syncSaleToSubledger` |
| Migration | `20260924190000_phase4_accounts_receivable` |

## Frontend completed

- Customers & Receivables tab: dashboard, ageing buckets, create customer, customer list

## Known limits

1. Statement delivery is JSON only (no PDF or email in this phase).
2. Credit-note inventory and VAT inventory relief remain on the ERP `SALES_RETURN_COMPLETED` journal, not a second stock movement inside Accounting.
3. Only the first financial period is open by default, so AR dates must fall in an open period.
