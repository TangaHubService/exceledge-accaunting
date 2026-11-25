# Implementation roadmap

Nothing here has been started; this audit changed no product code. Complexity: S up to 2 days, M up to 1 week, L 2 to 3 weeks, XL longer. These are rough estimates.

## P0: critical
| ID | Finding | Affected files | Technical approach | Dependencies | Database changes | Complexity | Acceptance criteria |
|---|---|---|---|---|---|---|---|
| F-01 | Screens that invent data or fake success | Overview.tsx, Shell.tsx:724, BudgetEditor.tsx:89, BackupRestore.tsx, Workflows.tsx:104, ImportData.tsx:145, AuditLog.tsx | Feed the dashboard, badge, budget editor and audit log from existing endpoints; hide the rest until they work | Existing APIs | None | L | No page imports sample data; an empty company shows zeros or an empty state; every success message follows a successful API response |
| F-02 | Credit note and refund screens drop VAT | pages/txn/CustomerTxnForms.tsx:591-640; ar.routes.ts credit-notes | Accept priced lines with tax codes and an invoice link on credit notes; new AR refund that clears an open credit | Tax codes | Credit note lines; AR refund table | L | Crediting 100,000 + 18% reduces 2200 by 18,000; refunding it leaves customer balance 0 and revenue reduced once |
| F-03 | Foreign currency added as RWF | ar.service.ts:1324; ap.service.ts:1435; integrity.service.ts:89; customer and supplier balances | Keep a functional amount on subledger rows and documents; report in RWF with document currency shown | F-04 | functionalAmount on AR/AP ledger entries, backfilled from journals | L | USD 1,000 at 1,400 adds 1,400,000; integrity scan shows no error |
| F-04 | AR and AP ageing do not equal the control accounts | ar.service.ts:1324; ap.service.ts:1435; setup.service.ts:840 | Build ageing from the ledger as at a date, with unapplied credits; give batch opening balances an open item; post direct opening balances to 3020 | None | Dated allocations | L | For any date, ageing total = control account within 0.01, including openings, credits and later payments |
| F-05 | Expenses and bank payments can post to control accounts | expense.service.ts:560; banking.service.ts:408 | One shared guard refusing AR, AP and inventory (and tax, unless tax payment) for every module except its owner | None | None | S | E23b and E23c return 400; existing asset and on-account expenses still work |
| F-06 | Duplicate user submissions post twice | All POST document routes; Frontend/src/lib/session.tsx | Idempotency-Key header stored with the response, same transaction; client sends one key per form | None | idempotency_keys table, unique (company, key) | M | Two identical concurrent posts with one key give one document and one journal |
| F-07 | Cash basis label on accrual figures | reports.service.ts:249; setup.routes.ts policies | Refuse CASH until cash reports exist and always print "Accrual" | None | None | S | Setting CASH returns 400; notes say Accrual |
| F-08 | No EBM receipt for sales made in this app | tax.service.ts:1182; ar.service.ts:463 | Confirm with the ERP team and RRA: issue through the ERP's EBM, or a certified VSDC integration with queue, retry and reconciliation | RRA certification or ERP work | Fiscal status on invoice and credit note | XL | In the RRA sandbox each taxable invoice and credit note gets a receipt; failures queue and retry; daily differences are listed |
| F-09 | No verified backup and restore | BackupRestore.tsx; deployment | Managed database backups with point-in-time recovery and a rehearsed restore; remove the fake page | Hosting | None | M | A restore to a clean server is timed, documented, and its trial balance matches |

## P1: essential
| ID | Finding | Affected files | Technical approach | Dependencies | Database changes | Complexity | Acceptance criteria |
|---|---|---|---|---|---|---|---|
| F-10 | Trial balance loads every row (19.1 s at 100,000) | books.service.ts:34 | Aggregate in SQL as statements do | None | Index review | M | Under 2 s at 100,000 rows; same totals |
| F-11 | Voids, deposit refunds and allocations dated today | ar.service.ts:1035,1104,1874 | Optional date; default to the original date if its period is open | None | None | S | February void dates in February when open |
| F-12 | ERP sales dated in UTC | integration.service.ts, inventory.service.ts | Convert to the company time zone before choosing the accounting day | None | Time zone on company | M | 22:30 UTC on 28 Feb posts 1 March |
| F-13 | Cash flow: disposal gain in operating | reports.service.ts:120 | Remove gains and losses from operating and show proceeds in investing; same check for non-cash purchases | None | None | M | E18 gives investing 1,300,000, operating 0 |
| F-14 | No bad-debt write-off | ar.service.ts | Write-off document to 6200 with approval and optional VAT treatment | Tax advice | Write-off table | M | AR clears, 6200 debited, invoice closed |
| F-15 | No VAT-inclusive prices | ArInvoiceLine, ApBillLine | Inclusive flag and back-calculation | None | Column on lines | M | 118 inclusive gives 100 + 18 |
| F-16 | Any VAT amount accepted on header-only invoices | ar.routes.ts, ap.routes.ts | Require a tax code and check the amount | None | None | S | E02b refused |
| F-17 | Ledger can be changed in SQL | prisma/migrations | Triggers blocking update/delete on gl_entries and posted journals; CHECK debit/credit >= 0 and one-sided | None | Trigger migration | M | Direct UPDATE fails; suite passes |
| F-18 | One integration key for every business | integration.routes.ts:22 | Key per company, or signed requests; rotation | ERP change | Credential table | M | Key for A refused for B |
| F-19 | Raw errors leak file paths | ar/ap/books routes | Map Prisma and Zod errors centrally | None | None | S | E30 passes |
| F-20 | Missing audit events; UI sample events | ar.service.ts; AuditLog.tsx | Audit AR receipts, deposits, credit notes; drop samples | F-01 | None | S | A14 passes |
| F-21 | Bill approval requested after posting | SupplierTxnForms.tsx:476 | Create the bill held, post on approval | None | None | M | No journal until approved |
| F-22 | Sales receipt and deposit cash-back save in two calls | CustomerTxnForms.tsx:601; OtherTxnForms.tsx:119 | Single transactional endpoint | F-06 | None | M | Failure leaves nothing |
| F-23 | Negative stock from ERP is silent | inventory.service.ts:400 | Raise a posting exception and an integrity check | None | None | S | Oversell appears in Exceptions |
| F-24 | No CI, no frontend tests | repository | GitHub Actions: build, tests, audit; Playwright for the main forms | None | None | M | Failing test blocks merge |
| F-25 | 6 dependency advisories (4 high) | Backend/package.json | Upgrade, test | F-24 | None | M | npm audit has no high |
| F-26 | No rate limiting on user and integration routes | app.ts | Limit by user and IP | None | None | S | 429 after the limit |
| F-27 | Branch staff see all branches; pay data unencrypted | auth.ts; team.service.ts | Branch scoping and field encryption | Policy decision | Encrypted columns | L | Branch user sees own branch; database holds ciphertext |
| F-28 | Stub attachments, export, settings | see matrix | Connect or hide | F-01 | None | M | Uploaded file is retrievable; each shown switch changes behaviour |
| F-29 | QuickBooks migration kit | new | Import open invoices, bills, credits, balances; reconcile to a QBO trial balance | F-03, F-04 | None | L | Trial balance and ageing match the QBO exports |

## P2: operational
| ID | Item | Affected area | Approach | Dependencies | Database changes | Complexity | Acceptance criteria |
|---|---|---|---|---|---|---|---|
| F-30 | Missing reports (about 14) | ReportViewer.tsx | Design first, reuse existing services | P0 and P1 done | To be set in design | L | Agreed in design; posts through the journal engine where money moves; tests added |
| F-31 | True cash-basis reports | reports.service.ts | Design first, reuse existing services | P0 and P1 done | To be set in design | XL | Agreed in design; posts through the journal engine where money moves; tests added |
| F-32 | Mobile money collection | new; provider account | Design first, reuse existing services | P0 and P1 done | To be set in design | XL | Agreed in design; posts through the journal engine where money moves; tests added |
| F-33 | Late fees and scheduled reminders | scheduler.ts | Design first, reuse existing services | P0 and P1 done | To be set in design | M | Agreed in design; posts through the journal engine where money moves; tests added |
| F-34 | Prepaid, accrual and reimbursement documents | new | Design first, reuse existing services | P0 and P1 done | To be set in design | L | Agreed in design; posts through the journal engine where money moves; tests added |
| F-35 | Stock lines on purchase orders | SupplierTxnForms.tsx | Design first, reuse existing services | P0 and P1 done | To be set in design | M | Agreed in design; posts through the journal engine where money moves; tests added |
| F-36 | Custom fields, form styles, workflows | stub pages | Design first, reuse existing services | P0 and P1 done | To be set in design | L | Agreed in design; posts through the journal engine where money moves; tests added |
| F-37 | Navigation clean-up | App.tsx, menus | Design first, reuse existing services | P0 and P1 done | To be set in design | M | Agreed in design; posts through the journal engine where money moves; tests added |
| F-38 | Low-stock alerts, RWF rounding rule | items, documents | Design first, reuse existing services | P0 and P1 done | To be set in design | M | Agreed in design; posts through the journal engine where money moves; tests added |
| F-39 | Payroll screens over ERP payroll | confirm ERP scope | Design first, reuse existing services | P0 and P1 done | To be set in design | L | Agreed in design; posts through the journal engine where money moves; tests added |

## P3: advanced
| ID | Item | Affected area | Approach | Dependencies | Database changes | Complexity | Acceptance criteria |
|---|---|---|---|---|---|---|---|
| F-40 | Live bank feeds | provider | Only after P0 to P2 and a provider or product decision | P0 and P1 done | To be set in design | XL | Agreed in design; posts through the journal engine where money moves; tests added |
| F-41 | Receipt capture and inbox | provider | Only after P0 to P2 and a provider or product decision | P0 and P1 done | To be set in design | L | Agreed in design; posts through the journal engine where money moves; tests added |
| F-42 | Customer portal | new | Only after P0 to P2 and a provider or product decision | P0 and P1 done | To be set in design | XL | Agreed in design; posts through the journal engine where money moves; tests added |
| F-43 | Bulk reclassify | journals | Only after P0 to P2 and a provider or product decision | P0 and P1 done | To be set in design | M | Agreed in design; posts through the journal engine where money moves; tests added |
| F-44 | Spreadsheet sync, app marketplace, mobile app | new | Only after P0 to P2 and a provider or product decision | P0 and P1 done | To be set in design | XL | Agreed in design; posts through the journal engine where money moves; tests added |

## Suggested order
1. F-01, F-05, F-07: quick, and stop misleading people.
2. F-02, then F-04 with F-03, then F-06.
3. F-09 and F-08, started in parallel because they need outside parties.
4. P1, with F-24 first so later fixes are protected.
