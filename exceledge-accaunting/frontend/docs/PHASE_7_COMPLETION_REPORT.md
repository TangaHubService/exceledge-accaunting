# PHASE 7 — Completion Report

**Phase:** 7 — Banking & Cash Management, Bank Reconciliation  
**Date:** 2026-09-25  
**Documentation:** Segments 6 and 7

## Requirements implemented

- Financial account register for bank, cash, petty cash and mobile money. Each account is linked to one asset GL account; its balance and cashbook are read from the ledger, so receipts and payments posted by any module appear automatically.
- A new GL account is created when none is chosen; an existing asset account can be linked only once. Opening balances post against opening-balance suspense.
- Banking transactions post balanced journals and can be reversed, never deleted:
  - Money received (non-customer sources) with one or more credit lines
  - Payments with one or more debit lines
  - Transfers, including deposits (cash to bank), withdrawals (bank to cash) and petty-cash replenishment, with an optional fee
  - Bank charges and interest
  - Cash counts that post over/short
- Customer receipts and supplier payments can name the financial account. Without one they keep using the default account for the payment method.
- Statement import (CSV, OFX/QFX, QIF, CAMT.053) with duplicate detection. Auto-match on amount, date and references; manual match; record charges/interest from a statement line.
- Reconciliation: Draft → Reviewed → Approved → Completed. Completes only at a zero difference with every statement line accounted for. The preparer cannot approve their own reconciliation. Matches lock once completed.
- Dashboard, cashbook, transaction list, reconciliation workspace and printable cash-position report.
- Capabilities: `bank:view`, `bank:manage`, `bank:approve`. Branch managers can view; accountants can manage; only Admin / System Owner can approve.

## Backend completed

| Area | Path |
|------|------|
| Domain rules | `packages/domain` journal lines, statement parsers, matching, reconciliation summary |
| Banking service/routes | `apps/api/src/modules/banking/*` (`/api/v1/banking/...`) |
| Settlement override | `documents.ts` `settlementDefaults`; AR receipts and AP payments accept `financialAccountId` |
| Migration | `20260925120000_phase7_banking_reconciliation` (creates only; adds `financialAccountId` on receipts and payments) |
| Tests | Domain banking block; `apps/api/tests/banking.test.ts` (roles, GL posting, statement import and zero-difference recon, dashboard) |

## Frontend completed

- Banking navigation: Bank & cash, Bank transactions, Bank reconciliation
- Report: Cash position
- Drawers: receive money, make payment, transfer, add/edit account, import statement, start reconciliation, record a statement line, reverse
- Settlement-account field on customer receipts and supplier payments when Banking is set up

## Verification

- Domain 44/44, accounting API 31/31 tests pass; web type-check and production build clean
- Browser check on Phase 7 test data (org 97071): available cash 1,524,300; BK Main books 1,336,800 against statement 1,341,800; completed reconciliation REC-2026-000001 difference 0; cash position on 31 Jan 2026 matches the API test

## Known limits

1. Native Excel (`.xlsx`) is not imported. Export the statement as CSV from Excel or download OFX/QIF/CAMT.053 from the bank.
2. Customer invoice receipts and supplier bill payments are still recorded in Receivables and Payables. Banking "Receive money" / "Make payment" is for other sources (loans, expenses, investors, utilities).
3. Returned cheques and failed transfers are recorded by reversing the original transaction; there is no separate returned-cheque document.
4. A formal petty-cash closing pack and statement-file attachments stay with document delivery (Phase 17).
5. Only the first financial period is open until period management (Phase 12). Banking dates must fall in an open period.
6. The Overview "Cash and bank" figure still sums the default cash/bank accounts from setup, not every financial account. Use Bank & cash or Cash position for the full picture.
