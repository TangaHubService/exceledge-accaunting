# QuickBooks comparison matrix

Baseline: commit 6438570, 24 November 2026.

**(A)** = stated on Intuit's US pricing page, read 24 November 2026: https://quickbooks.intuit.com/pricing/. **(A2)** = Intuit help: Multicurrency is not in Simple Start: https://quickbooks.intuit.com/learn-support/en-us/help-article/multicurrency/learn-multicurrency-quickbooks-online/L5krkKQi8_US_en_US. **Std** = generally available in QuickBooks Online from the auditor's knowledge, not confirmed on an official page in this audit. "Not verified" and "plan not verified" mean exactly that. Limits on the page: Simple Start 1 user, Essentials 3, Plus 5, Advanced 25. The non-US editions were not checked.

IDs such as S08 or E17 are in FUNCTIONAL_TEST_RESULTS.md. "suite" = existing automated tests, all passing. Paths are under `Backend/src/modules` or `Frontend/src`.

Totals: 52 fully implemented and tested, 31 implemented but partially functional, 17 implemented but financially incorrect, 10 missing, 3 implemented but not tested, 2 not applicable, 1 unable to verify, 1 duplicated (117 rows).


## Core accounting

| Feature | QuickBooks Online | Existing system | Status | Test | Accuracy | Gap | Evidence | Business impact | Recommendation | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| Double-entry | Std (A) | Balanced-journal check, transactional posting | Fully implemented and tested | A01 PASS | Correct | - | journals/journal.service.ts; results A01 | - | Keep; add DB guard (F-08) | - |
| Chart of accounts, subaccounts, merge | Std (A) | CRUD, tree, import, merge | Fully implemented and tested | S02a PASS; coa suites | Correct | - | coa/; tests/coa*.test.ts | - | - | - |
| General ledger | Std (A) | Paged ledger with running balance | Fully implemented and tested | S18 PASS | Correct | - | gl/gl.service.ts | - | - | - |
| Journal entries | Std (A) | Draft, submit, post, reverse | Fully implemented and tested | E24, E07 PASS | Correct | - | journals/; tests/wave-b-controls | - | - | - |
| Opening balances | Std (A) | Batch with second-person approval; per-party | Implemented but financially incorrect | S02b FAIL | GL right, ageing wrong | Batch customer balance has no open item; direct balances go to 1900 Suspense, not 3020 | setup.service.ts:840; ar.service.ts:251 | Opening debt cannot be collected against or aged | Create open items; use 3020 | P0 |
| Trial balance | Std (A) | 5 modes plus columns | Implemented but partially functional | A02 PASS; E22 FAIL | Correct | 19.1 s at 100,000 rows; loads every row | books.service.ts:34 | Unusable at volume, slows close | Aggregate in SQL | P1 |
| Fiscal years and periods | Std (A) | Monthly/quarterly/etc, auto-open | Fully implemented and tested | S01, E09, E29 PASS | Correct | - | domain/index.ts | - | - | - |
| Cash and accrual reporting | Std (A): report basis switch | Policy stored, not applied | Implemented but financially incorrect | E17 FAIL | Incorrect label | CASH policy prints "Cash basis" on accrual figures | reports.service.ts:249 | Misleading statements | Block CASH now; build later | P0 |
| Retained earnings, year end | Std (A) | Closing journal, unclosed-profit lines | Fully implemented and tested | suite wave-c-closing PASS; A04 PASS | Correct | - | close.service.ts | - | - | - |
| Period close and lock | Std (A) | Checklist, overrides, approval, row lock | Fully implemented and tested | S19, S20 PASS | Correct | - | close.service.ts | - | - | - |
| Reversals and adjustments | Std (A) | Original-rate reversals | Implemented but partially functional | E14 PASS; S20b PARTIAL | Right in total, wrong month possible | Invoice void and deposit refund/allocation always dated today | ar.service.ts:1874,1104,1035 | February sale voided in November stays in February | Accept a date; default to original if open | P1 |
| Multi-currency and FX | Essentials+ (A2) | Rates, realised FX, revaluation | Implemented but financially incorrect | suite document-fx PASS; E27, A17 FAIL | GL correct; ageing and subledger totals wrong | USD 1,000 added as RWF 1,000; integrity raises false error | ar.service.ts:1324; integrity.service.ts:89 | Receivables understated | Store functional amounts on subledger | P0 |

## Sales and receivables

| Feature | QuickBooks Online | Existing system | Status | Test | Accuracy | Gap | Evidence | Business impact | Recommendation | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| Customers | Std | Profile, contacts, notes, tags, merge, import | Fully implemented and tested | suite customer-* PASS | - | - | ar/customers.service.ts | - | - | - |
| Estimates, proposals, sales orders | Estimates Std; sales orders plan not verified | Convert to invoice once | Fully implemented and tested | suite design-screens PASS | Correct | - | commercial.service.ts | - | - | - |
| Sales invoices | Std | Lines, tax, credit limit, PDF, email | Implemented but partially functional | S08, E19 PASS; E02b, E15 FAIL/PARTIAL | Correct with lines | Header form accepts any VAT amount; no edit of posted invoice | ar.service.ts:463 | Wrong VAT possible via API | Require tax code; guarded edit | P1 |
| Sales receipts | Std | Screen makes invoice then receipt in two calls | Implemented but partially functional | code review | Correct if both succeed | Not atomic: failure leaves unpaid invoice | CustomerTxnForms.tsx:601 | Cash sale shown as debt | One endpoint | P1 |
| POS cash/credit sale from ERP | n/a (ERP) | Event posting, idempotent | Fully implemented and tested | S07, S08b PASS | Correct | - | integration.service.ts | - | - | - |
| Recurring invoices | Plan not verified | Templates run daily | Implemented but partially functional | suite recurring-bank-rules PASS | Correct | UI save of a template not exercised | recurring-templates.service.ts | - | UI test | P2 |
| Payments, partial payments | Std | Allocation, overpayment guard, row lock | Fully implemented and tested | S09, E05, E06 PASS | Correct | - | ar.service.ts:603 | - | - | - |
| Advances (deposits) | Std | Deposit, allocate, refund | Implemented but partially functional | S09b, S13b PASS | Correct amounts | Allocation and refund dated today | ar.service.ts:1035,1104 | Wrong month | Accept date | P1 |
| Credit notes | Std | API supports net and tax | Implemented but financially incorrect | S13a API PASS; screen FAIL | VAT overstated | Screen has no tax and no invoice link; whole total sent as net | CustomerTxnForms.tsx:594 | VAT overpaid to RRA; revenue understated | Send lines and tax code | P0 |
| Refund receipts | Std | Bank payment to income account | Implemented but financially incorrect | S13c, S13d FAIL | VAT never reversed; credit remains | Cannot refund an open credit; workaround deducts revenue twice | banking.service.ts:419; CustomerTxnForms.tsx:627 | Revenue and AR wrong | Refund document clearing credit | P0 |
| Discounts | Std | Line discounts | Fully implemented and tested | suite ar PASS | Correct | - | ar.service.ts | - | - | - |
| Statements | Std | Period and outstanding, PDF, email | Implemented but partially functional | S18 PASS | Correct | Email delivery not tested live | print.service.ts | - | - | P2 |
| AR ageing | Std | Open invoices by due date | Implemented but financially incorrect | A09, E26, E27 FAIL | Incorrect | Not historical; ignores unapplied credits, batch openings, currency | ar.service.ts:1324 | Report does not equal control account | Rebuild from ledger at a date | P0 |
| Bad debt write-off | Std | None | Missing | E21 FAIL | - | Only workaround hits Sales Returns | - | Misstated revenue | Write-off action | P1 |
| Online payment / Pay now | Regional (QuickBooks Payments) | None | Missing | - | - | No provider | WalletSettings.tsx | Slower collection | Mobile money | P2 |
| Late fees, scheduled reminders | Advanced automates reminders (A) | Reminder email by hand | Missing | - | - | Not scheduled | customer-email.service.ts | Slower collection | Scheduler job | P2 |

## Purchases and payables

| Feature | QuickBooks Online | Existing system | Status | Test | Accuracy | Gap | Evidence | Business impact | Recommendation | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| Suppliers | Std | Profile, import, WHT settings | Fully implemented and tested | suites PASS | - | - | ap/suppliers.service.ts | - | - | - |
| Purchase orders | Plan not verified | PO to receipt to bill | Implemented but partially functional | suite design-screens PASS | Correct | Screen has account lines only; stock lines API-only | DESIGN_SCREENS_BACKEND.md | Stock orders need ERP | Item picker | P2 |
| Supplier bills | Std | Lines, duplicate guard, void | Implemented but partially functional | S05, E01c PASS | Correct | "Submit for approval" requests approval after the bill has posted | SupplierTxnForms.tsx:476 | Control not effective | Hold then post | P1 |
| Direct expenses, cheques | Std | Bank payments | Implemented but partially functional | S10, E23b | Correct to expense | Can be coded to 1300 and 2200 | banking.service.ts:408 | Subledger breaks | Extend guard | P0 |
| Payments, partial, WHT | Std; WHT regional | Allocation, credits, WHT certificate | Fully implemented and tested | S06 PASS; suite | Correct | WHT on foreign payments refused | ap.service.ts:608 | - | - | - |
| Supplier advances | Std | Advance, allocate, refund | Fully implemented and tested | suite ap PASS | Correct | - | ap.service.ts:1098 | - | - | - |
| Supplier credits and returns | Std | Credit note with stock return | Fully implemented and tested | S12b PASS | Correct | - | ap.service.ts:864 | - | - | - |
| AP ageing | Std | Open bills by due date | Implemented but financially incorrect | A10 FAIL | Incorrect | Payments with no allocation and other credits ignored; not historical | ap.service.ts:1435 | 1,447,280 shown vs 267,280 owed in test | Rebuild from ledger | P0 |
| Supplier statements, outstanding bills | Std | Period statement PDF | Fully implemented and tested | S18 PASS | Correct | - | ap.service.ts:1292 | - | - | - |

## Banking

| Feature | QuickBooks Online | Existing system | Status | Test | Accuracy | Gap | Evidence | Business impact | Recommendation | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| Bank, cash, petty cash, mobile money accounts | Std | Account kinds, overdraft guard | Fully implemented and tested | S03 PASS; suite | Correct | - | banking.service.ts | - | - | - |
| Statement import | Std | CSV, OFX, QIF, CAMT.053 | Fully implemented and tested | S17 PASS | - | Excel not read | reconciliation.service.ts | - | - | - |
| Live bank feeds | Simple Start connects 1 bank (A); regional | None | Missing | - | - | No provider | CashFlow.tsx:213 | Manual work | Provider needed | P3 |
| Matching, categorising, rules | Std | Auto-match, rules with splits | Fully implemented and tested | suite PASS; S17 | Correct | - | rules.service.ts | - | - | - |
| Reconciliation | Std | Review, approve, complete, reopen | Fully implemented and tested | S17 PASS | Correct | - | reconciliation.service.ts | - | - | - |
| Transfers, deposits, charges | Std | With fee | Fully implemented and tested | S14 PASS | Correct | Deposit with cash back is two calls | OtherTxnForms.tsx:119 | Partial save possible | One endpoint | P2 |
| Duplicate statement detection | Std | Re-import refused | Fully implemented and tested | S17 PASS | Correct | - | reconciliation.service.ts | - | - | - |
| Cash count, over/short | Not standard QBO | Cash count posts over/short | Fully implemented and tested | suite banking PASS | Correct | - | banking.service.ts | - | - | - |
| Cashier shift / daily close | Not standard QBO | None here (ERP POS) | Unable to verify | - | - | ERP not in this repository | - | - | Confirm with ERP | P2 |

## Inventory

| Feature | QuickBooks Online | Existing system | Status | Test | Accuracy | Gap | Evidence | Business impact | Recommendation | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| Products, services, categories | Plus for inventory (A) | Items, import, categories | Fully implemented and tested | suite products-services PASS | - | - | items.service.ts | - | - | - |
| Stock in/out from ERP | Plus (A) | Events, idempotent | Fully implemented and tested | S04, S07 PASS | Correct | - | inventory.service.ts:400 | - | - | - |
| Adjustments and write-offs | Plus (A) | Quantity and value, approval | Fully implemented and tested | S15, E04 PASS | Correct | - | stock-documents.service.ts | - | - | - |
| Valuation equals GL | Plus (A) | Weighted average, FIFO layers | Fully implemented and tested | A06: 1,172,571.4287 both | Correct | - | inventory.service.ts:788 | - | - | - |
| COGS | Plus (A) uses FIFO | From stock ledger | Fully implemented and tested | S07 PASS | Correct 205,714.29 | - | - | - | - | - |
| Returns | Plus (A) | Customer and supplier | Fully implemented and tested | S12a, S12b PASS | Correct | - | - | - | - | - |
| Low-stock alerts | Plus (A); detail not verified | Reorder point and filter only | Implemented but partially functional | code | - | No notification | items.service.ts | Stock-outs | Daily alert | P2 |
| Negative stock | QBO behaviour not verified | App refuses; ERP event allowed silently | Implemented but partially functional | E04 PASS; E04b INFO | Cost estimated | ERP oversell gave -3 units, -61,714 asset, no alert | results E04b | Hidden error | Raise exception | P1 |
| App invoice moves stock | Plus (A) | By design no | Not applicable | S08 | - | ERP owns stock (agreed) | - | - | - | - |

## Expenses and income

| Feature | QuickBooks Online | Existing system | Status | Test | Accuracy | Gap | Evidence | Business impact | Recommendation | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| Expenses, categories, approval | Std; approvals Advanced (A) | Full workflow | Implemented but partially functional | S10 PASS; E23c FAIL | Correct for normal accounts | Accepts 1200, 2100, 1300 as expense account | expense.service.ts:560 | AR/AP subledger out of balance | Reject control accounts | P0 |
| Other income | Std | Bank receipt | Fully implemented and tested | S11 PASS | Correct | - | - | - | - | - |
| Recurring expenses | Plan not verified | Daily scheduler | Fully implemented and tested | suite expense PASS | Correct | - | scheduler.ts | - | - | - |
| Attachments | Std | Stored per document, local or S3 | Implemented but partially functional | suite wave-c-documents PASS | - | Attachments workspace page is a stub | AttachmentsWorkspace.tsx | Files "attached" there are lost | Connect page | P1 |
| Receipt capture / inbox | Std; detail not verified | None | Missing | - | - | - | - | Manual entry | - | P3 |
| Reimbursements | Add-on/plan not verified | Employee payee fields, no settlement flow | Implemented but partially functional | code | - | No reimbursement document | expense.routes.ts | - | Build | P2 |
| Prepaid and accrued expenses | Not verified | Manual journals; menu opens plain Expenses | Missing | code | - | No schedules | App.tsx /accounting/prepaid-expenses | Manual work | Amortisation schedule | P2 |

## Reporting

| Feature | QuickBooks Online | Existing system | Status | Test | Accuracy | Gap | Evidence | Business impact | Recommendation | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| Profit and loss | Std | Range, comparatives | Fully implemented and tested | A04 PASS; UI read | Correct | - | reports.service.ts | - | - | - |
| Balance sheet | Std | Current/non-current | Fully implemented and tested | A03, A16 PASS | Correct | 0.05 tolerance in "balanced" flag | reports.service.ts | - | Tighten | P3 |
| Cash flow statement | Std | Indirect | Implemented but financially incorrect | A05 PASS; E18 FAIL | Total right, sections wrong | Disposal gain left in operating: 120,000 operating, 1,180,000 investing; should be 0 and 1,300,000 | reports.service.ts:120 | Misclassified cash flow | Deduct gain; add proceeds | P1 |
| Ledger, journal, trial balance reports | Std | Yes, exports | Fully implemented and tested | S18 PASS | Correct | - | - | - | - | - |
| Sales and purchase reports | Std | Customer/supplier yes; product none | Implemented but partially functional | code | - | About 14 of 72 listed reports have no data | ReportViewer.tsx:364 | Missing analysis | Build | P2 |
| Inventory valuation | Plus (A) | As-of date | Fully implemented and tested | S18 PASS | Correct | - | - | - | - | - |
| Budget vs actual | Plus (A) | Backend complete | Implemented but financially incorrect | suite wave-c-budgets PASS; UI FAIL | New editor saves nothing | Says saved, calls no API, sample rows | BudgetEditor.tsx:89 | User loses budget | Connect | P0 |
| Comparative, filters, drill-down, export | Std | CSV, XLSX, PDF | Fully implemented and tested | S18 PASS | - | - | - | - | - | - |
| Home dashboard | Std | Sample data only | Implemented but financially incorrect | UI FAIL: 12,850,000 vs 2,360,854 income | False | All KPIs, banks, invoices, bills, activity fake | Overview.tsx; dashboard-dummy.ts | Wrong business decisions | Connect to API | P0 |
| KPIs, forecasts, custom reports | Advanced custom KPIs (A) | Yes | Implemented but not tested | S18 (KPI endpoint only) | - | - | reports/ | - | Test | P2 |

## Tax and compliance

| Feature | QuickBooks Online | Existing system | Status | Test | Accuracy | Gap | Evidence | Business impact | Recommendation | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| Tax codes and rates | Regional | VAT18, VATIN, VAT0, VATEX, WHT | Fully implemented and tested | S01b PASS; suite tax | Correct | - | tax.service.ts:138 | - | - | - |
| Tax exclusive prices | Std | Yes | Fully implemented and tested | S08 PASS | Correct | - | - | - | - | - |
| Tax inclusive prices | Regional; not verified | None | Missing | E20 FAIL | - | No field in schema | ArInvoiceLine | Retail prices are VAT-inclusive | Add flag | P1 |
| VAT input/output and report | Regional | Ledger-based | Fully implemented and tested | A11: report equals GL | Correct for posted data | - | tax.service.ts | - | - | - |
| Exemptions | Regional | Customer and code | Fully implemented and tested | suite PASS | Correct | - | - | - | - | - |
| Payments, filings, WHT certificate | Regional | Yes; nothing sent to RRA | Fully implemented and tested | suite PASS | Correct | Filing is manual | - | - | - | - |
| EBM fiscal invoice for app sales | Not in QBO (regional) | None; ERP metadata recorded only | Missing | code | - | App invoices and credit notes have no EBM receipt | tax.service.ts:1182 | Compliance exposure | Via ERP or certified VSDC | P0 |
| EBM retry and reconciliation | n/a | Reconciliation compares recorded documents | Implemented but not tested | A11b: 0 documents | - | No live EBM available | tax.service.ts:1146 | - | Sandbox test | P1 |
| RWF handling | n/a | 4-decimal storage | Implemented but partially functional | E19 PASS | - | Fractional RWF accepted on documents | - | Odd amounts | Currency rounding rule | P2 |
| Time zone of ERP postings | n/a | UTC dates | Implemented but financially incorrect | E08 FAIL | Wrong day | Sales from 00:00 to 02:00 Kigali post the previous day | integration.service.ts | Month-end VAT cut-off | Convert to Africa/Kigali | P1 |

## Additional

| Feature | QuickBooks Online | Existing system | Status | Test | Accuracy | Gap | Evidence | Business impact | Recommendation | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| Fixed assets | Not verified | Depreciation, revalue, impair, dispose | Fully implemented and tested | S16 PASS; suite | Correct | - | fa.service.ts | - | - | - |
| Payroll calculation | Add-on, regional | None here; ERP payroll journals accepted | Implemented but partially functional | suite payroll PASS | Correct for received events | No calculation or payslips here | posting-rules.service.ts | Depends on ERP | Confirm ERP scope | P2 |
| Projects | Plus (A) | Dimension with GL profit | Fully implemented and tested | suite design-screens PASS | Correct | - | projects.service.ts | - | - | - |
| Classes/cost centres, branches | Plus, 40 (A) | Dimensions and branches | Fully implemented and tested | suite PASS | Correct | - | books.service.ts | - | - | - |
| Notifications | Std | Backend real; header badge fake | Implemented but partially functional | code, UI | - | Badge always 3 | Shell.tsx:724 | Misleading | Connect | P1 |
| Import | Std | Customers, suppliers, items, accounts real | Implemented but partially functional | suites PASS | - | Import hub reports success without importing | ImportData.tsx:145 | Data loss | Connect | P0 |
| Export | Std | Report exports real; Export data page stub | Implemented but partially functional | code | - | "Export complete" without backend | ExportData.tsx:67 | Misleading | Connect | P1 |
| QuickBooks migration | n/a | CSV lists and journal import | Implemented but partially functional | code | - | No open invoices, bills or history import | - | Manual migration | Migration kit | P1 |
| Workflow automation | Advanced (A) | Backend exists; page stub | Implemented but financially incorrect | code | - | "Running... Sent successfully" does nothing | Workflows.tsx:104 | False assurance | Connect | P0 |
| Custom fields, form styles | Plan not verified | Stub pages | Missing | code | - | "Saved" without API | CustomFields.tsx:67 | Loss of input | Build | P2 |
| Settings switches | Std | Stored; mostly unused | Implemented but partially functional | code | - | Forms ignore most switches | lib/preferences.ts | Confusing | Wire or hide | P1 |

## Security

| Feature | QuickBooks Online | Existing system | Status | Test | Accuracy | Gap | Evidence | Business impact | Recommendation | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| Tenant isolation | Std | companyId on every query | Fully implemented and tested | E12 PASS (13 reads, 5 writes) | - | - | middleware/auth.ts | - | Automate for all routes | P2 |
| Roles and permissions | Advanced customises (A) | Roles, custom roles, capabilities | Fully implemented and tested | E11 PASS; suite custom-roles | - | No branch-level data restriction found | auth.ts; users/ | Branch staff see all branches | Branch scope | P1 |
| Approvals, separation of duties | Advanced (A) | Journal, bill, expense, close | Fully implemented and tested | E24 PASS; suite approval-gates | - | See bill note | approval.service.ts | - | - | - |
| Audit trail | Std | Append-only by DB trigger | Implemented but partially functional | A13 PASS; A14 FAIL; E16 | - | No own event for AR receipt, deposit, credit note; page shows invented rows when empty | AuditLog.tsx; tools-dummy.ts | Weak evidence | Add events; remove samples | P1 |
| Ledger immutability | Vendor controlled | API only | Implemented but partially functional | E16 PARTIAL | - | gl_entries can be updated in SQL; no CHECK constraints | migrations | Tampering | Trigger and constraints | P1 |
| Integration key | n/a | One shared secret for all companies | Implemented but partially functional | E12b FAIL | - | Leak allows posting to any business | integration.routes.ts:22 | High | Per-company keys | P1 |
| Error messages | Vendor | Raw Prisma text with file paths | Implemented but not functioning correctly | E30 FAIL | - | Information disclosure | ar.routes.ts | Medium | Map errors | P1 |
| Rate limiting | Vendor | API keys only | Missing | code | - | None on user or integration routes | app.ts | Abuse | Add | P1 |
| Pay data at rest | Vendor | Access controlled, plain text | Implemented but partially functional | code | - | Not encrypted | team.service.ts | Privacy | Encrypt | P1 |
| Dependencies | Vendor | 6 production advisories (4 high) | Implemented but partially functional | npm audit | - | zod, exceljs/uuid and others | Backend/package.json | Medium | Upgrade | P1 |

## Reliability

| Feature | QuickBooks Online | Existing system | Status | Test | Accuracy | Gap | Evidence | Business impact | Recommendation | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| Posting rollback | Vendor | Transactions | Fully implemented and tested | E03, E10 PASS | Correct | - | lib/prisma.ts | - | - | - |
| Concurrent postings | Vendor | Row locks, counters | Fully implemented and tested | E06, E07, E07b PASS | Correct | - | - | - | - | - |
| Duplicate ERP events | n/a | Idempotency key | Fully implemented and tested | S07 PASS | Correct | - | - | - | - | - |
| Duplicate user submissions | Vendor | Button disabled only | Implemented but not functioning correctly | E01, E01b FAIL | Double posting | No idempotency on POST | all document routes | Double revenue or payment | Idempotency-Key | P0 |
| Failed integrations | Vendor | Exceptions and retry | Fully implemented and tested | S20; suite integration-gl | Correct | - | - | - | - | - |
| Backup and restore | Not found on pricing page | Page is fabricated | Implemented but not functioning correctly | UI FAIL | - | Lists "Success" backups that do not exist | BackupRestore.tsx | Data loss risk | Real backups; remove page | P0 |
| Automated tests, CI | Vendor | 430 backend/domain tests; 0 frontend; no CI | Implemented but partially functional | 321+109 PASS | - | Nothing runs on push | - | Regressions | CI | P1 |
| Large volume | Vendor | Statements fast, TB slow | Implemented but partially functional | E22 | - | TB 19.1 s vs statements 0.3 s | books.service.ts:34 | - | SQL aggregate | P1 |
| Offline use | Not evaluated | None | Not applicable | - | - | Web app | - | - | - | - |

## User experience

| Feature | QuickBooks Online | Existing system | Status | Test | Accuracy | Gap | Evidence | Business impact | Recommendation | Priority |
|---|---|---|---|---|---|---|---|---|---|---|
| Navigation | Std | All apps, create menu, settings | Duplicated | UI | - | Banking rules, recurring, reports reachable by 3+ paths; several menu items open the same page | App.tsx; settings-dummy.ts | Confusing | RECOMMENDED_NAVIGATION | P2 |
| Validation messages | Std | Good on forms | Implemented but partially functional | E02 | - | Some API errors are raw JSON | - | - | Map errors | P2 |
| Report to source drill-down | Std | Ledger and documents link | Implemented but not tested | not clicked | - | - | - | - | UI test | P2 |
| Screens that fake success | Std | 7 pages | Implemented but not functioning correctly | code, UI | - | Budget, backup, workflows, import, export, attachments, custom fields | see F-01 | Trust | Connect or hide | P0 |
| Text defects | Std | "{cfg.detailLabel}" printed on ageing | Implemented but not functioning correctly | UI FAIL | - | Literal template | Ageing.tsx:21 | Cosmetic | Fix | P2 |
