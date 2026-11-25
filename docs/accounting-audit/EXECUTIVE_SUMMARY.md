# Executive summary

**Verdict: not ready to replace QuickBooks Online for a live business.** The posting engine is sound. The risk is in what sits on top of it: some screens show invented figures, two sales screens get VAT wrong, and the ageing reports do not agree with the ledger.

Audited 24 November 2026 at commit 6438570, on throwaway databases. No product code or live service was touched.

## Evidence
- Existing tests: 321 backend and 109 domain tests, all pass.
- New audit harness: 90 checks, 55 pass, 22 fail, 3 partial, 10 informational.
- Five main screens checked in a browser; the rest read in code.

## Scores
| Area | Score | Features scored | Fully tested |
|---|---|---|---|
| Core accounting | **73** | 12 | 7 |
| Sales and receivables | **52** | 16 | 5 |
| Purchases and payables | **75** | 9 | 5 |
| Inventory management | **88** | 8 | 6 |
| Banking and reconciliation | **88** | 8 | 7 |
| Financial reporting | **66** | 10 | 5 |
| Tax and regulatory compliance | **62** | 10 | 5 |
| Security and internal controls | **58** | 10 | 3 |
| User experience | **38** | 5 | 0 |
| System reliability | **69** | 8 | 4 |
| Production readiness | **33** | 12 gates | 4 met |
| QuickBooks functional coverage | **66** | 94 | 46 |

Score = average weight of the matrix rows in the area: fully tested 100, partial or duplicated 50, untested 40, incorrect 25, missing 0. Not-applicable and unverifiable rows are left out. The weights are an auditor's choice, the row statuses are the evidence; rerun `evidence/build.py` to recompute. Small areas move a lot per row, so read them as rough. Production readiness is the share of 12 pass/fail gates met.

## Works well
- Every journal balanced, including under 30 concurrent posts. Balance sheet, profit in equity, and total cash movement all reconciled.
- 20 simultaneous payments of one invoice: exactly one succeeded.
- Closed periods refused all eight attempts, and a late ERP event became an exception.
- Another business's 13 reads and 5 writes were all refused.
- Inventory value equalled its ledger account to four decimals.
- Bank import, matching and reconciliation; fixed assets; close checklist; approvals.

## Must be fixed first (P0)
- **F-01** Screens that invent data or fake success.
- **F-02** Credit note and refund screens drop VAT.
- **F-03** Foreign currency added as RWF.
- **F-04** AR and AP ageing do not equal the control accounts.
- **F-05** Expenses and bank payments can post to control accounts.
- **F-06** Duplicate user submissions post twice.
- **F-07** Cash basis label on accrual figures.
- **F-08** No EBM receipt for sales made in this app.
- **F-09** No verified backup and restore.

## Direct answers
- **Can it safely manage real transactions?** Not yet. The ledger can, but VAT on credit notes, ageing, duplicates and backups must be fixed first.
- **Can a business migrate from QuickBooks?** Lists and an opening trial balance can be imported. Open invoices, bills and history cannot, and batch opening customer balances are missing from ageing.
- **Accounting errors that can produce wrong statements:** credit notes and refunds with VAT (F-02), expenses posted to control accounts (F-05), duplicates (F-06), cash basis label (F-07), voids and ERP sales in the wrong month (F-11, F-12), cash flow sections (F-13).

## Earlier statement corrected
I previously said payroll had "nothing behind it". The app does accept and post payroll journals from the ERP; what it lacks is its own calculation and payslips.

## Limits
EBM, email delivery, mobile money, object storage, the ERP, and restores were not exercised. Newer work on `main` could not be fetched. RRA's EBM pages returned 404, so EBM duties need checking with RRA.
