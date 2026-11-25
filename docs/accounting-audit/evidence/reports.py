import json
s=json.load(open('evidence/scores.json'))
def w(n,t): open(n,'w').write(t.strip()+'\n')
P0=[
('F-01','Screens that invent data or fake success','Overview.tsx, Shell.tsx:724, BudgetEditor.tsx:89, BackupRestore.tsx, Workflows.tsx:104, ImportData.tsx:145, AuditLog.tsx','Feed the dashboard, badge, budget editor and audit log from existing endpoints; hide the rest until they work','Existing APIs','None','L','No page imports sample data; an empty company shows zeros or an empty state; every success message follows a successful API response'),
('F-02','Credit note and refund screens drop VAT','pages/txn/CustomerTxnForms.tsx:591-640; ar.routes.ts credit-notes','Accept priced lines with tax codes and an invoice link on credit notes; new AR refund that clears an open credit','Tax codes','Credit note lines; AR refund table','L','Crediting 100,000 + 18% reduces 2200 by 18,000; refunding it leaves customer balance 0 and revenue reduced once'),
('F-03','Foreign currency added as RWF','ar.service.ts:1324; ap.service.ts:1435; integrity.service.ts:89; customer and supplier balances','Keep a functional amount on subledger rows and documents; report in RWF with document currency shown','F-04','functionalAmount on AR/AP ledger entries, backfilled from journals','L','USD 1,000 at 1,400 adds 1,400,000; integrity scan shows no error'),
('F-04','AR and AP ageing do not equal the control accounts','ar.service.ts:1324; ap.service.ts:1435; setup.service.ts:840','Build ageing from the ledger as at a date, with unapplied credits; give batch opening balances an open item; post direct opening balances to 3020','None','Dated allocations','L','For any date, ageing total = control account within 0.01, including openings, credits and later payments'),
('F-05','Expenses and bank payments can post to control accounts','expense.service.ts:560; banking.service.ts:408','One shared guard refusing AR, AP and inventory (and tax, unless tax payment) for every module except its owner','None','None','S','E23b and E23c return 400; existing asset and on-account expenses still work'),
('F-06','Duplicate user submissions post twice','All POST document routes; Frontend/src/lib/session.tsx','Idempotency-Key header stored with the response, same transaction; client sends one key per form','None','idempotency_keys table, unique (company, key)','M','Two identical concurrent posts with one key give one document and one journal'),
('F-07','Cash basis label on accrual figures','reports.service.ts:249; setup.routes.ts policies','Refuse CASH until cash reports exist and always print "Accrual"','None','None','S','Setting CASH returns 400; notes say Accrual'),
('F-08','No EBM receipt for sales made in this app','tax.service.ts:1182; ar.service.ts:463','Confirm with the ERP team and RRA: issue through the ERP\'s EBM, or a certified VSDC integration with queue, retry and reconciliation','RRA certification or ERP work','Fiscal status on invoice and credit note','XL','In the RRA sandbox each taxable invoice and credit note gets a receipt; failures queue and retry; daily differences are listed'),
('F-09','No verified backup and restore','BackupRestore.tsx; deployment','Managed database backups with point-in-time recovery and a rehearsed restore; remove the fake page','Hosting','None','M','A restore to a clean server is timed, documented, and its trial balance matches'),
]
P1=[
('F-10','Trial balance loads every row (19.1 s at 100,000)','books.service.ts:34','Aggregate in SQL as statements do','None','Index review','M','Under 2 s at 100,000 rows; same totals'),
('F-11','Voids, deposit refunds and allocations dated today','ar.service.ts:1035,1104,1874','Optional date; default to the original date if its period is open','None','None','S','February void dates in February when open'),
('F-12','ERP sales dated in UTC','integration.service.ts, inventory.service.ts','Convert to the company time zone before choosing the accounting day','None','Time zone on company','M','22:30 UTC on 28 Feb posts 1 March'),
('F-13','Cash flow: disposal gain in operating','reports.service.ts:120','Remove gains and losses from operating and show proceeds in investing; same check for non-cash purchases','None','None','M','E18 gives investing 1,300,000, operating 0'),
('F-14','No bad-debt write-off','ar.service.ts','Write-off document to 6200 with approval and optional VAT treatment','Tax advice','Write-off table','M','AR clears, 6200 debited, invoice closed'),
('F-15','No VAT-inclusive prices','ArInvoiceLine, ApBillLine','Inclusive flag and back-calculation','None','Column on lines','M','118 inclusive gives 100 + 18'),
('F-16','Any VAT amount accepted on header-only invoices','ar.routes.ts, ap.routes.ts','Require a tax code and check the amount','None','None','S','E02b refused'),
('F-17','Ledger can be changed in SQL','prisma/migrations','Triggers blocking update/delete on gl_entries and posted journals; CHECK debit/credit >= 0 and one-sided','None','Trigger migration','M','Direct UPDATE fails; suite passes'),
('F-18','One integration key for every business','integration.routes.ts:22','Key per company, or signed requests; rotation','ERP change','Credential table','M','Key for A refused for B'),
('F-19','Raw errors leak file paths','ar/ap/books routes','Map Prisma and Zod errors centrally','None','None','S','E30 passes'),
('F-20','Missing audit events; UI sample events','ar.service.ts; AuditLog.tsx','Audit AR receipts, deposits, credit notes; drop samples','F-01','None','S','A14 passes'),
('F-21','Bill approval requested after posting','SupplierTxnForms.tsx:476','Create the bill held, post on approval','None','None','M','No journal until approved'),
('F-22','Sales receipt and deposit cash-back save in two calls','CustomerTxnForms.tsx:601; OtherTxnForms.tsx:119','Single transactional endpoint','F-06','None','M','Failure leaves nothing'),
('F-23','Negative stock from ERP is silent','inventory.service.ts:400','Raise a posting exception and an integrity check','None','None','S','Oversell appears in Exceptions'),
('F-24','No CI, no frontend tests','repository','GitHub Actions: build, tests, audit; Playwright for the main forms','None','None','M','Failing test blocks merge'),
('F-25','6 dependency advisories (4 high)','Backend/package.json','Upgrade, test','F-24','None','M','npm audit has no high'),
('F-26','No rate limiting on user and integration routes','app.ts','Limit by user and IP','None','None','S','429 after the limit'),
('F-27','Branch staff see all branches; pay data unencrypted','auth.ts; team.service.ts','Branch scoping and field encryption','Policy decision','Encrypted columns','L','Branch user sees own branch; database holds ciphertext'),
('F-28','Stub attachments, export, settings','see matrix','Connect or hide','F-01','None','M','Uploaded file is retrievable; each shown switch changes behaviour'),
('F-29','QuickBooks migration kit','new','Import open invoices, bills, credits, balances; reconcile to a QBO trial balance','F-03, F-04','None','L','Trial balance and ageing match the QBO exports'),
]
P2=[('F-30','Missing reports (about 14)','ReportViewer.tsx','L'),('F-31','True cash-basis reports','reports.service.ts','XL'),('F-32','Mobile money collection','new; provider account','XL'),('F-33','Late fees and scheduled reminders','scheduler.ts','M'),('F-34','Prepaid, accrual and reimbursement documents','new','L'),('F-35','Stock lines on purchase orders','SupplierTxnForms.tsx','M'),('F-36','Custom fields, form styles, workflows','stub pages','L'),('F-37','Navigation clean-up','App.tsx, menus','M'),('F-38','Low-stock alerts, RWF rounding rule','items, documents','M'),('F-39','Payroll screens over ERP payroll','confirm ERP scope','L')]
P3=[('F-40','Live bank feeds','provider','XL'),('F-41','Receipt capture and inbox','provider','L'),('F-42','Customer portal','new','XL'),('F-43','Bulk reclassify','journals','M'),('F-44','Spreadsheet sync, app marketplace, mobile app','new','XL')]
def tab(items): return '| ID | Finding | Affected files | Technical approach | Dependencies | Database changes | Complexity | Acceptance criteria |\n|'+'---|'*8+'\n'+'\n'.join('| '+' | '.join(i)+' |' for i in items)+'\n'
def small(items,why): return '| ID | Item | Affected area | Approach | Dependencies | Database changes | Complexity | Acceptance criteria |\n|'+'---|'*8+'\n'+'\n'.join(f'| {a} | {b} | {c} | {why} | P0 and P1 done | To be set in design | {d} | Agreed in design; posts through the journal engine where money moves; tests added |' for a,b,c,d in items)+'\n'
w('IMPLEMENTATION_ROADMAP.md',f'''
# Implementation roadmap

Nothing here has been started; this audit changed no product code. Complexity: S up to 2 days, M up to 1 week, L 2 to 3 weeks, XL longer. These are rough estimates.

## P0: critical
{tab(P0)}
## P1: essential
{tab(P1)}
## P2: operational
{small(P2,"Design first, reuse existing services")}
## P3: advanced
{small(P3,"Only after P0 to P2 and a provider or product decision")}
## Suggested order
1. F-01, F-05, F-07: quick, and stop misleading people.
2. F-02, then F-04 with F-03, then F-06.
3. F-09 and F-08, started in parallel because they need outside parties.
4. P1, with F-24 first so later fixes are protected.
''')
p0list='\n'.join(f'- **{a}** {b}.' for a,b,*_ in P0)
w('EXECUTIVE_SUMMARY.md',f'''
# Executive summary

**Verdict: not ready to replace QuickBooks Online for a live business.** The posting engine is sound. The risk is in what sits on top of it: some screens show invented figures, two sales screens get VAT wrong, and the ageing reports do not agree with the ledger.

Audited 24 November 2026 at commit 6438570, on throwaway databases. No product code or live service was touched.

## Evidence
- Existing tests: 321 backend and 109 domain tests, all pass.
- New audit harness: 90 checks, 55 pass, 22 fail, 3 partial, 10 informational.
- Five main screens checked in a browser; the rest read in code.

## Scores
{s['t']}
{s['meth']}
## Works well
- Every journal balanced, including under 30 concurrent posts. Balance sheet, profit in equity, and total cash movement all reconciled.
- 20 simultaneous payments of one invoice: exactly one succeeded.
- Closed periods refused all eight attempts, and a late ERP event became an exception.
- Another business's 13 reads and 5 writes were all refused.
- Inventory value equalled its ledger account to four decimals.
- Bank import, matching and reconciliation; fixed assets; close checklist; approvals.

## Must be fixed first (P0)
{p0list}

## Direct answers
- **Can it safely manage real transactions?** Not yet. The ledger can, but VAT on credit notes, ageing, duplicates and backups must be fixed first.
- **Can a business migrate from QuickBooks?** Lists and an opening trial balance can be imported. Open invoices, bills and history cannot, and batch opening customer balances are missing from ageing.
- **Accounting errors that can produce wrong statements:** credit notes and refunds with VAT (F-02), expenses posted to control accounts (F-05), duplicates (F-06), cash basis label (F-07), voids and ERP sales in the wrong month (F-11, F-12), cash flow sections (F-13).

## Earlier statement corrected
I previously said payroll had "nothing behind it". The app does accept and post payroll journals from the ERP; what it lacks is its own calculation and payslips.

## Limits
EBM, email delivery, mobile money, object storage, the ERP, and restores were not exercised. Newer work on `main` could not be fetched. RRA's EBM pages returned 404, so EBM duties need checking with RRA.
''')
w('ACCOUNTING_SYSTEM_AUDIT.md','''
# Accounting system audit

## Architecture
React/Vite frontend; Express, Prisma and PostgreSQL backend; ERP-signed JWT sign-in; 34 migrations with no drift. All accounting flows call `createAndPostJournal` in `journals/journal.service.ts`, which checks activation, balance, period (row-locked), account rules, approvals and budget, then writes `gl_entries` in one transaction. Statements read `gl_entries`.

## How the main flows work
| Flow | Path | Finding |
|---|---|---|
| ERP sale | event, idempotency key, posting rule, journal, AR | Sound; UTC day (F-12) |
| ERP stock | event, stock ledger, COGS journal | Sound; negative stock silent (F-23) |
| App invoice | form, `/ar/invoices`, journal, AR ledger | Sound with lines; no stock effect by agreement |
| Credit note | form, `/ar/credit-notes` | API right, screen drops VAT (F-02) |
| Refund | form, `/banking/payments` | Does not clear a credit or reverse VAT (F-02) |
| Purchase | receipt, GRNI, bill, AP | Sound; GRNI nets to zero |
| Expense | `/expenses` | Control accounts accepted (F-05) |
| Bank | import, match, record, reconcile | Sound |
| Close | checklist, override, close, reopen | Sound; slow through trial balance (F-10) |
| Home dashboard | constants in `dashboard-dummy.ts` | Not connected (F-01) |

## Transactions that bypass or break the subledger
- No code path was found that writes `gl_entries` without a journal, or changes a ledger balance outside it, except account merge (`coa.service.ts:756`), which moves existing entries to another account. Any immutability trigger (F-17) must allow for it.
- Expenses can post to AR, AP and inventory control accounts; bank payments can post to inventory (E23b, E23c). Each leaves the subledger behind.
- Foreign-currency AR and AP subledgers hold document currency while the ledger holds RWF.
- `gl_entries` can be altered directly in SQL (E16). `audit_events` cannot.

## Disconnected
Home dashboard, notification badge, new budget editor, backup, workflows page, import hub, export data, attachments workspace, custom fields, form styles, and most settings switches. Their backends often exist: budgets, documents, workflows, notifications.

## Duplicated
- Two budget editors: the new one fakes, the classic one saves.
- Two journal entry screens (`/journals/new`, `/accounting/journal-entry/new`).
- Revenue recognition opens Journals; Prepaid expenses opens Expenses; My accountant opens Setup; Integration transactions opens Bank transactions.
- Three recurring systems: journals, expenses, templates.
- Opening balances by batch and by party, posting to different equity or suspense accounts.

## Hardcoded rules
Payroll account codes 2310, 2320, 6120; Retained Earnings fallback 3100; cash detection by 11xx code; GRNI journals fixed to RWF. All work with the default chart but not with a renumbered one.

## Modules
Status of every feature is in QUICKBOOKS_COMPARISON_MATRIX.md, with proof in FUNCTIONAL_TEST_RESULTS.md.
''')
w('ACCOUNTING_ACCURACY_REPORT.md','''
# Accounting accuracy report

| Requirement | Result | Evidence |
|---|---|---|
| Journals balance | Yes: 0 unbalanced of 30 in normal scenarios | A01 |
| Assets = liabilities + equity | Yes: 8,035,451.4287 = 514,880 + 7,520,571.4287 | A03, A16 |
| Trial balance | Yes: 8,702,737.1429 both sides | A02 |
| Profit in equity | Yes: 320,571.4287 | A04 |
| Cash flow equals cash movement | Yes in total: 4,892,600. Sections can be wrong | A05, E18 |
| Inventory = GL | Yes: 1,172,571.4287 | A06 |
| AR control = customer balances | Yes in RWF: 529,000. **No** with USD (1,938,115.99 vs 539,105.99, of which 10 is E23c) | A07, A17, E27 |
| AP control = supplier balances | Yes: 267,280. **No** after an expense coded to AP | A08, A17 |
| AR ageing = control | **No**: 339,000 vs 529,000 | A09 |
| AP ageing = control | **No**: 1,447,280 vs 267,280 | A10 |
| VAT report = VAT accounts | Yes: 147,600 and 251,280. But what is posted is wrong when a credit note is entered on screen | A11, F-02 |
| Void and reversal restore balances | Yes in total; month can be wrong | E14, S20b |
| Duplicate requests | ERP events safe; **user requests post twice** | S07, E01, E01b |
| Failed transactions leave nothing | Yes | E03, E10 |
| Rounding | Balanced; 4 decimals stored, fractional RWF allowed | E19 |

## Explained differences
- AR 190,000 gap = batch opening customer balance 200,000 missing from ageing, less the 10,000 unapplied credit ignored.
- AP 1,180,000 gap = one ERP payment without a bill reference. It was unallocated by the test; the ageing should still net it as a credit.
- AR control vs subledger with USD: 1,399,000 is 1,000 x (1,400 - 1), plus 10 from E23c.

## Errors that misstate financial statements
1. **Credit notes and refunds on screen.** A credit of 118,000 for a VAT-inclusive sale posts 118,000 to Sales Returns and nothing to VAT. Revenue is understated by 18,000 and VAT payable overstated by 18,000. Found in code and on screen; the API with explicit tax is correct (S13a).
2. **Refunding a customer credit.** Credit note 10,000 plus refund 10,000 reduces revenue by 20,000 and leaves the customer at -10,000 (S13d).
3. **Wrong period.** Voids, deposit allocations and refunds date today; ERP sales after midnight in Kigali date the day before (S20b, E08).
4. **Cash basis.** The note says "Cash basis" while profit is the accrual figure, -886,139.2857 both ways in that test (E17).
5. **Cash flow.** Sale of an asset for 1,300,000 shows 120,000 operating and 1,180,000 investing; it should be 0 and 1,300,000 (E18).
6. **Duplicates.** Two identical invoices or receipts post twice (E01).

Period amounts other than these reconciled.
''')
w('MISSING_FEATURES.md','''
# Missing features compared with QuickBooks Online

Plans marked (A) come from Intuit's US pricing page on 24 November 2026. Others are not confirmed.

| Feature | QuickBooks plan | Here | Priority |
|---|---|---|---|
| Refund that clears a customer credit | Not verified | Missing | P0 |
| EBM receipts for app sales | Regional, not QuickBooks | Missing | P0 |
| Cash-basis reports | Not verified | Missing, mislabelled | P0 label, P2 feature |
| Bad-debt write-off | Not verified | Missing | P1 |
| VAT-inclusive prices | Regional | Missing | P1 |
| Edit of a posted invoice | Not verified | Void and re-enter only | P1 |
| Open-transaction migration from QuickBooks | n/a | Missing | P1 |
| Online payments | QuickBooks Payments, regional | Missing | P2 |
| Reminders and late fees | Automated reminders Advanced (A) | Manual email only | P2 |
| Sales by product, customer type, open PO, time reports | Not verified | No data behind about 14 of 72 | P2 |
| Prepaid, accrual, revenue recognition schedules | Not verified | Menu only | P2 |
| Reimbursements | Not verified | Partial | P2 |
| Custom fields, form styles | Not verified | Screens only | P2 |
| Live bank feeds | Simple Start, 1 bank (A); regional | Missing | P3 |
| Receipt capture, portal, reclassify, sheet sync, mobile app | Not verified | Missing | P3 |

## Better suited than QuickBooks here
Period-close checklist with overrides, GRNI, cash counts, withholding certificates, integrity scan, ERP stock and sales events, and Rwanda tax codes. These are standard in the app; QuickBooks equivalents were not checked.

## Not applicable
Stock movement from app invoices: the ERP owns stock by agreement. Offline use: not a stated requirement.
''')
w('SECURITY_AND_INTERNAL_CONTROLS.md','''
# Security and internal controls

| Control | Result | Evidence |
|---|---|---|
| Sign-in | HS256 ERP token; bad or missing token 401 | E11 |
| Permissions | Capability per route; unprivileged role 403 | E11 |
| Tenant isolation | 13 reads and 5 writes refused; not every route was tried | E12 |
| Separation of duties | Creator cannot post own journal when controls are on | E24 |
| Period lock | 8 of 8 attempts refused; row-locked against races | S20 |
| Reopen | Needs a reason; audited | E25 |
| Audit trail | Append-only in the database; some entities lack their own event (the journal event exists) | A13, A14, E16 |
| System vs user changes | System uses user 0 / role SYSTEM | scheduler.ts |
| CSV formula injection | Neutralised | E31 |
| Production start-up checks | Refuses default secrets and wildcard CORS | config/env.ts |

## Weaknesses
| Finding | Severity | Ref |
|---|---|---|
| One integration key posts to any business | High | E12b, F-18 |
| Ledger rows can be changed in SQL | High | E16, F-17 |
| No verified backup; page claims there is one | High | F-09 |
| 6 dependency advisories, 4 high | High | npm audit, F-25 |
| No rate limit on user or integration routes | Medium | F-26 |
| Errors reveal file paths | Medium | E30, F-19 |
| Token kept in browser storage, exposed if script is injected | Medium | lib/session.tsx |
| Pay and bank details in plain text in the database | Medium | F-27 |
| No branch-level data restriction found | Medium | F-27 |
| Audit page shows invented events when empty | Medium | F-01 |
| Bill approval after posting | Medium | F-21 |
| A valid ERP token for a new organisation creates a company | Low, by design | E13 |

Not done: penetration test, secret-history scan, infrastructure and network review.
''')
w('RECOMMENDED_NAVIGATION.md','''
# Recommended navigation

## Observed
About 120 routes, reached through a pinned sidebar, All apps, Create, Settings and flyouts. The same page appears in several places: Banking rules in three flyouts, and Sales Overview, Sales transactions and Sales orders all open Invoices. Some labels promise a feature but open another page: Prepaid expenses, Revenue recognition, My accountant, Integration transactions, Contracts, Reviews, Payroll. The Home cards take the first screen but show sample data.

## Proposed: eight groups, two levels
| Group | Items |
|---|---|
| Home | Real figures, tasks, alerts |
| Sales | Invoices, Estimates and orders, Payments received, Credit notes and refunds, Customers, Products and services |
| Purchases | Bills, Expenses, Purchase orders, Pay bills, Suppliers |
| Banking | Accounts, Transactions, Rules, Reconcile, Transfers and cash counts |
| Inventory | Stock, Movements, Receipts, Adjustments |
| Accounting | Chart of accounts, Journals, Ledger, Recurring, Fixed assets, Budgets, Close, Exceptions |
| Tax | VAT return, Withholding, Payments, EBM records |
| Reports | Statements, Ageing, All reports, Dashboards |

Settings holds company, users and roles, branches, approvals, numbering, import and export, audit log. Team and Projects stay as optional groups.

## Rules
- One home per page; search and Create may link to it.
- Remove a menu item until its page exists.
- One recurring page with type tabs; one journal form; one budget editor.
- Show only the groups a role can use.

| Role | Sees | Daily actions in two clicks |
|---|---|---|
| Owner | Home, Sales, Purchases, Reports | See cash, who owes, approve |
| Cashier | Sales, Banking cash | Receive payment, count cash |
| Accountant | All but user admin | Match bank, post bill, close |
| Administrator | Settings, users | Invite, set role |

No essential capability is removed. This is a recommendation from code and a short browser check, not user testing.
''')
w('PRODUCTION_READINESS_REPORT.md',f'''
# Production readiness report

**Not ready.** {s['gates'].count('| Yes |')} of 12 gates met.

{s['gates']}
## Scores
{s['t']}
{s['meth']}
Verified = tested in this audit or by the passing suite. Features marked "not tested" score 40 and are named in the matrix. Nothing was scored from the interface alone.

## Operations
| Topic | State |
|---|---|
| Health and readiness checks | Present; `/ready` correctly failed when the database was unreachable |
| Graceful shutdown, job locks | Present |
| Migrations | Apply cleanly, run at container start; no drift. Production migration not run by this audit |
| CI | None |
| Runtime versions | Dockerfile Node 24, Nixpacks Node 20: align them |
| Monitoring, alerting, log retention | None found |
| Backups | None found in the repository |
| Performance | Statements 0.33 s, ledger page 0.11 s, trial balance 19.1 s at 100,000 rows on a laptop with synthetic rows |
| Email | Needs SMTP settings |
| Documents | Local disk by default: use object storage or a persistent volume |

## Regulatory check
| Topic | Finding | Source |
|---|---|---|
| VAT 18%, return by the 15th, quarterly at RWF 200m or less | The app has 18%, zero and exempt codes and monthly, quarterly and yearly filing | PwC, reviewed 23 Sep 2026: https://taxsummaries.pwc.com/rwanda/corporate/other-taxes |
| Withholding 15%, and 3% on public tenders | Codes WHT15 and WHT3 exist; applicability is left to the user | https://taxsummaries.pwc.com/rwanda/corporate/withholding-taxes |
| PAYE bands, RSSB 6%+6% to 2026, 7%+7% from January 2027 | Not calculated here; check the ERP is ready for January 2027 | https://taxsummaries.pwc.com/rwanda/individual/taxes-on-personal-income |
| EBM and VSDC duties | **Unable to verify**: RRA pages returned 404; RRA's specification was found but not read | https://www.rra.gov.rw/fileadmin/user_upload/vsdc_specification_document_v1.0.4__2022.pdf |

PwC is a secondary source. Confirm with RRA before building.

## Conditions to go live
1. Every P0 in IMPLEMENTATION_ROADMAP.md closed and the audit harness rerun with no unexplained failure.
2. F-10, F-12, F-17, F-18, F-21 and F-24 closed.
3. A restore rehearsed.
4. One month run in parallel with QuickBooks, comparing trial balance, ageing and VAT.
''')
