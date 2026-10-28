# Implementation gaps and plan

Audit of `exceledge-accaunting` against the functional specification (`docs/accounting-module-documentation-extracted.txt` in the repo root, Segments 1–45), done on 2026-10-13. The README marks phases 0–20 as complete; the code does not support that for most of phases 11–20 and for parts of 1–10.

Section numbers like "34.5" refer to the specification.

Effort: **S** up to a day, **M** two to four days, **L** a week or more.

---

## 1. Summary of findings

| Area | State |
|------|-------|
| Posting core (balanced journals, GL entries, AR/AP subledgers, banking, bank reconciliation, inventory valuation, expenses, fixed assets, tax) | Built and mostly sound |
| Period lifecycle | **Broken in production**: only period 1 of a year is ever `OPEN` |
| FX revaluation | **Posts wrong amounts** |
| Approvals, workflows, account posting flags, setup policies | Stored, not enforced |
| Phases 11–20 (`books` module) | Mostly one create/list endpoint per feature, many with no screen |
| API keys, signatures, automation jobs | Records only; they do not do what the screens imply |
| Segments 37, 42, 45 (executive/mobile, no-code builder, marketplace) | Not started |

### Critical defects (fix before any real company uses the service)

1. **Later periods never open.** `generateAccountingPeriods` (`packages/domain/src/index.ts:167`) opens period 1 only; every other period is `FUTURE`. Nothing outside `prisma/seed.ts:134` ever changes `FUTURE` to `OPEN`, and `assertOpenPeriod` (`journal.service.ts:47`) accepts only `OPEN`/`REOPENED`. After January, every ERP event and manual journal fails. Tests only post in January, so they pass.
2. **FX revaluation uses the wrong balance.** `revalueCurrency` (`books.service.ts:290`) treats `Account.currentBalance`, which is in RWF, as the foreign-currency balance, and assumes a previous rate of 1 on the first run. A USD bank account holding RWF 1.3m is revalued as if it held USD 1.3m. No foreign-currency amount is stored anywhere (`Journal.exchangeRate` exists but is never set).
3. **Consolidation can read another company's books.** `createGroup` accepts any `companyId` for a member and `consolidateGroup` reads its full ledger. Neither checks that the caller belongs to that organization.
4. **Consolidation figures are wrong.** `consolidateTrialBalances` scales every account by ownership percentage (proportional, not full consolidation), has no non-controlling interest, and eliminations reduce only the grand totals and are not required to balance.
5. **Issued API keys authenticate nothing.** `ApiCredential.tokenHash` is never read; revoking does nothing.
6. **Posting rights can be bypassed.** `POST /journals` with `postImmediately` needs `journal:create` only; `POST /expenses/:id/post` posts straight from `DRAFT`; the journal creator can post their own journal.
7. **Documents can be left without a GL entry.** AR invoices/receipts and AP bills are saved as `POSTED` before the journal posts; `createJournal` and `postJournal` run in separate transactions. A failure (e.g. closed period) leaves a "posted" document with no ledger entry.
8. **Concurrent posting races.** `nextJournalNumber` reads then updates outside the transaction (duplicate numbers possible) and uses the current year, not the journal date; `currentBalance` is a read-modify-write without a row lock.
9. **Approval decisions can be flipped.** `decideApproval` does not check the request is still `PENDING`.
10. **Recurring run is not atomic per template.** One failing template aborts the run after earlier templates already advanced `nextRunDate`.

---

## 2. Gaps by segment

### Core books (Segments 1–15)

| Seg | Missing or partial |
|-----|--------------------|
| 1 Integration | ERP emits only 6 event types; no events for POS refunds, customer debt payments, supplier payments, goods received. Customer payments and returns post to GL but skip the AR subledger. Split payments post entirely to the first method. Events arriving before activation are dead-lettered and dismissed. |
| 2 Setup | Setup screen has no forms; it submits hard-coded demo data. No API to edit default accounts, numbering or periods. Opening balances are never approved or posted. Stored but ignored: `transactionLockDate`, backdated/future-dated policies, amount limits, supporting-document rule, numbering formats, `fxGain/LossAccountId`. Functional currency and valuation method can change after activation. Several seed accounts have the wrong type for their code range; PAYE and payroll payable share 2300. |
| 3 Chart of accounts | `allowManualPost`, `allowAutoPost`, `requireApproval`, `allowNegativeBalance` never checked; manual journals can hit control accounts (AR, AP, inventory). Import has no screen. No Excel/PDF export. |
| 4 AR | No invoice lines, no invoice list endpoint, no period statements, no PDF/email. Debit notes and deposit allocate/refund have no screen. Customer ledger opening balance is hard-coded to 0. |
| 5 AP | No bill lines, no bill approval, no bill void. `supplierApprovalRequired` ignored. No WHT certificates, payment forecast. |
| 6 Banking | Receipts/payments can't be linked to a customer or supplier, so allocating to AR/AP control accounts moves GL without the subledger. No petty-cash float close. |
| 7 Bank reconciliation | No Excel import, returned cheques, reports (7.11, 7.18). |
| 8 Journals | No submit → review → approve flow (statuses exist, unused). No edit/cancel of drafts, auto-reversing journals, line-level dimensions or tax codes from the API. Automatic journals can be reversed manually. Reversals reuse the original date and fail once that period closes. |
| 9 GL | Ledger filters on posting date, not transaction date; running balances are in posting order, so backdated entries show wrong balances. No opening balance for a date range, export, drill-down. |
| 10 Trial balance | `TrialBalance.tsx` reads `/coa` balances, not `/books/trial-balance`; modes, dates and comparatives have no screen. `ADJUSTED` equals `STANDARD`. No opening/movement columns, filters, export. |
| 11 Inventory | Sale COGS comes from ERP metadata, not accounting valuation, so GL and subledger drift. A bill without `receivedAtCost` can double-count purchases. Adjustment/write-off rules bypass the subledger. Inventory approval settings ignored. |
| 12 Expenses | Single-level approval, no requester ≠ approver check. Allocations never reach the GL. Journal currency hard-coded to RWF. No attachments, export, scheduler. |
| 13 Fixed assets | No units-of-production or sum-of-years methods, no quarterly/annual depreciation, no impairment approval. A revaluation decrease always debits the reserve even when it is too small (IAS 16 requires the excess to go to profit or loss). |
| 14 Tax | No WHT certificates. Tax adjustments post with no approval. PAYE, excise and annual filings are placeholders. |
| 15 Financial statements | No statement of changes in equity, no notes, no comparative columns, no current/non-current split. P&L runs from inception, not the financial year. No date picker, export. |

### Management and control (Segments 16–30)

| Seg | Missing or partial |
|-----|--------------------|
| 16 Management reports | Only four ratios. No revenue/profitability by product, customer or branch; no trends. |
| 17 Budgets | Statuses are only `DRAFT`/`APPROVED`; no revisions, no budget control, no budget by period (stored, ignored). Self-approval allowed, not audited. Form can't enter period or dimension lines. |
| 18 Projects and cost centres | Journal line dimensions exist in the schema but are never written; the journal route doesn't accept them. Values aren't checked against the `Dimension` register. No screen. Everything reports as "Unassigned". |
| 19 Multi-currency | See critical defect 2. No transaction amount/rate on invoices, bills, receipts, payments; no realized FX; open AR/AP not revalued; settings for gain/loss accounts ignored. Still open: AR/AP documents in a non-functional currency are rejected until this is built. |
| 20 Closing | Checklist lacks bank, inventory, depreciation, payroll, tax, FX items. Exception and approval counts are company-wide, not per period. No closing approval steps. `TEMPORARILY_LOCKED` unused. |
| 21 Audit trail | The `books` module audits only close/reopen. No server-side filters or export. Table is writable (no immutability). |
| 22 Approvals | Nothing checks an approval before posting. `approvalLevels` and `amountBasedApprovalLimits` are never read. No queue, delegation, escalation, return-for-correction. Target entity not validated. |
| 23 Permissions | Owned by ERP by design. Gaps on our side: branch restriction (`branchIds` never read), no Auditor/read-only role, export/print not separated from view. |
| 24 Notifications | Only two triggers (period closed, approval waiting). Notifications are company-wide; one user marking read marks it for everyone. No email/SMS. |
| 25 Recurring | Journals and expenses only; no invoices, bills, receipts, payments. No scheduler, no end date, pause, history. Recurring journals have no screen. |
| 26 Documents | Metadata only; no file upload, storage, download. No screen. |
| 27 Import/export | Only the chart of accounts exports (CSV). Reports print through the browser only. Journal import has no screen, splits naively on commas, and leaves a `READY` batch when the journal is unbalanced. |
| 28 KPIs | No EBITDA, ROA/ROE, quick ratio, working capital, turnover, collection days, targets. |
| 29 Data integrity | No integrity scans (ledger vs subledger, sequence gaps), no backdating or negative-balance detection. |
| 30 Multi-company | "New group" screen creates one hard-coded member. No intercompany accounts or reconciliation. |

### Platform (Segments 31–45)

| Seg | State |
|-----|-------|
| 31 Assistant | Keyword matching over four totals. |
| 32 Forecasting | Straight-line profit only; no revenue/expense/cash, scenarios, forecast vs actual; saved forecasts can't be listed. |
| 33 Group consolidation | See critical defects 3–4. No currency translation, no account mapping, no as-of date, no consolidated statements. |
| 34 Controls and risk | Control register only. No risk register, control testing, compliance calendar. |
| 35 Anomalies | Z-score on journal totals; identical amounts are excluded (so duplicates are never flagged); repeated scans duplicate flags. No screen. |
| 36 ESG | Free-form measures; intensity uses all-time revenue. No screen. |
| 37 Executive / mobile | Not started. |
| 38 Workflows | Step names and a counter; no actor, no roles per step, gates nothing. No screen. |
| 39 API management | See critical defect 5. No scopes, expiry, rate limits, usage log, OpenAPI docs. |
| 40 Signatures | A row with free text; no content hash, no verification, no list endpoint. |
| 41 Copilot | Same as 31. |
| 42 No-code builder | Not started. |
| 43 Automation | Three job types, manual run only; `schedule` never parsed. |
| 44 Document OCR | Lives in the ERP; accounting stores the file path as text. |
| 45 Marketplace | Not started. |

---

## Progress

**2026-10-14 — Wave A, first part (A1, A2, A3, A9 partly, A11 partly)**
- Periods: a `FUTURE` period opens the first time something is dated in it once it has started; activation and new financial years open every started period. Periods can be locked/unlocked (`POST /books/periods/:id/lock|unlock`) and a year can have a lock date (`PUT /books/financial-years/:id/lock-date`).
- Atomic posting: `lib/prisma.ts` `inTransaction` routes every `prisma` call inside it to one transaction. Journals are created and posted together (`createAndPostJournal`); AR, AP, banking, expense, fixed-asset and tax writes, period close, journal import and each recurring template run in one transaction. Journal numbers and account balances are updated atomically; numbers take the year from the journal date.
- Rights: posting immediately needs `journal:post`; posting an unapproved expense needs `expense:approve`; automatic, opening, reversal and year-end journals can't be reversed by hand; a reversal of a journal in a closed period is dated today.
- Recurring run: one failing template no longer stops the others; failures are returned and raise a notification.
- Async route errors reach the error handler (`express-async-errors`); README status corrected.
- Tests: `tests/posting-integrity.test.ts`.

Still open from these tasks: creator-cannot-post (moved to B1).

**2026-10-14 — Wave A, second part (A4–A11)**
- Account flags (A4): manual, imported and recurring journals respect `allowManualPost` and cannot touch the receivables, payables or inventory control accounts; module postings respect `allowAutoPost`; `allowNegativeBalance: false` rejects a posting that takes the account below zero. System accounts were seeded closed to manual journals; the seed and existing rows now close only 1200, 2100, 1300 and 3200.
- FX (A5): a journal in a non-functional currency takes its rate from the request or the latest rate on or before its date, posts functional amounts and keeps the foreign amount per line (`JournalLine.amountForeign`). An account kept in a foreign currency only accepts journals in that currency (revaluations excepted), and its currency cannot change once it has postings. Revaluation compares foreign balance × closing rate with the functional balance, uses the configured FX gain/loss accounts, accepts `asOf`, and skips the functional currency. Module helpers no longer hard-code RWF, and module reversals post back at the original rate.
- Consolidation (A6): members must be companies in the caller's token, checked again on every consolidation. Members are added at 100%; the non-controlling share of net assets and profit is reported separately; eliminations are balanced line sets applied per account code; `asOf` is supported. Old single-total eliminations are kept but ignored and listed as `ignoredEliminations`.
- API keys (A7): keys carry read-only scopes (`report:view`, `gl:view`, `ar:view`, `ap:view`) and an optional expiry. `X-Api-Key` or `Authorization: ApiKey …` works on GET routes under `/books`, `/gl`, `/ar`, `/ap`; revoked or expired keys get 401 and every use sets `lastUsedAt`. The integration key is compared in constant time.
- Approvals and workflows (A8): approvals are limited to Journal, Expense, ApBill, Budget, TaxAdjustment and FixedAssetImpairment records that exist, one pending request per record, decided once, audited. Workflow steps record who completed them (`workflow_step_logs`); the same person cannot complete two steps in a row.
- Scheduler (A9, A10): `job_locks` leases stop two runs of a company's recurring journals and two scheduler ticks running at once. A 60-second tick (`modules/books/scheduler.ts`) once per UTC day opens started periods and runs due recurring journals (catching up missed occurrences) and recurring expenses; on every tick it runs automation jobs whose cron schedule (five fields, UTC, validated on save) is due. Failures become notifications.
- Seed (A11): 2300 is PAYE payable; payroll payable maps to 2320 for new and existing companies.
- Tests: `tests/wave-a-controls.test.ts`, domain tests for conversion, consolidation and cron.

**2026-10-15 — Wave A follow-ups (review)**
- Posting the same draft twice at once, or reversing a journal twice at once, now posts or reverses it once. Journal rates are rounded to the stored 8 decimals, so reversals at the stored rate cancel exactly.
- Revaluation refuses accounts that have postings without a foreign amount (posted before FX support, or before the account's currency was set) instead of writing their balance off.
- Recurring journals and expenses advance only from the occurrence they read, so a manual run and the scheduler cannot both generate it. Job locks no longer rely on catching a unique violation, which would abort an enclosing transaction.
- Trial balance and statements `asOf` include the whole day. Cron follows standard cron when day or weekday starts with `*` (both must match).
- AR and AP documents (invoices, receipts, credit and debit notes, deposits, bills, payments, advances) are rejected when the document or party currency is not the functional currency, and post in the functional currency. A party or bank account currency of `RWF` is the schema default and is treated as functional. Foreign bank accounts still post converted.
- Tests: `tests/wave-a-controls.test.ts`, `platform.test.ts` (cron).

Not done in Wave A: (FX AR/AP, API key limits, and seed renumbering were completed later — see Wave D / Wave C leftover entries above).

**2026-10-15 — Wave B (B1–B7)**
- Migration `20261015120000_wave_b_approvals`: approval levels and decisions (`approval_decisions`, `RETURNED` status), per-user notification reads and targeting, `requireDifferentPoster`, per-period number counters (`number_sequence_counters`, `legacyFloor`), opening-balance approval/posting fields, GL entry dimensions (backfilled from journals and lines), and an append-only trigger on `audit_events`.
- Approval engine (B1, `modules/approvals`): journals keyed on screen or imported go DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → POSTED. The number of levels comes from `amountBasedApprovalLimits` tiers (`[{ minAmount, levels, roles? }]`, validated on save) or else `approvalLevels`; each level may name a role. A decider needs the record type's capability (new `journal:approve` for ADMIN, SYSTEM_OWNER, ACCOUNTANT), cannot be the requester or the record's creator, and cannot take two levels of one round. Reject (journal → CANCELLED) and return (journal → DRAFT, editable, resubmit reuses the request) need a note. Posting a controlled journal requires final approval when a rule applies, and the creator cannot post it when `requireDifferentPoster` is on (default). `GET /books/approvals/queue` lists what the caller can decide; web screen `/approvals`.
- Policies (B3): backdated (before the current period) and future-dated journals follow `ALLOW | REQUIRE_APPROVAL | BLOCK`; `supportingDocumentRequired` blocks submit/post without an attached document. Numbering formats (prefix, year, month, branch code, length 3–10, reset NEVER/YEARLY/MONTHLY) are validated and used for every document number; counters reset per period, and existing companies continue from their current number.
- Dimensions (B5): cost centre and project (header or per line) must be active dimensions; manual-journal branches must be company branches. GL entries carry cost centre, project and branch; `GET /books/dimensions/report?kind=COST_CENTRE|PROJECT|BRANCH` gives profit per value; expense allocations split the expense line by cost centre/project. `PATCH /books/dimensions/:id` renames or deactivates.
- Audit (B7): `/audit` filters by user, record type/ID, action and dates server-side; `GET /audit/export.csv` (up to 50 000 rows, formula-safe). Rates, dimensions, controls, groups, eliminations, forecasts, anomaly scans, ESG, workflows, automations, documents, sign-offs, imports and budget approval now write audit events. The table rejects UPDATE, DELETE and TRUNCATE at the database (except the company-delete SET NULL).
- Notifications (B6): addressed to everyone, a role, or a user; read state is per user (`notification_reads`, unread count, mark all read). Triggers: approval needed (next level's role), approval decided (requester), posting exception, reconciliation refused for a difference, period closed, recurring failures, and a daily scheduler summary of overdue invoices and bills and periods ending within 3 days.
- Setup (B2): `PUT /setup/default-accounts`, `GET|PUT /setup/numbering[/:documentType]`, `PUT /setup/financial-years/:id`; functional currency and inventory valuation method cannot change after activation. Opening balances record who entered them, accept customer/supplier lines, are approved by someone else (`POST …/:id/approve`) and post as one OPENING_BALANCE journal on the first day of the earliest financial year, opening the AR/AP subledger for party lines (`POST …/:id/post`).
- Web (B4): forms for every setup section; approvals queue; journal detail with approval progress, submit/resubmit/post/cancel and edit of drafts; notifications page with bell; audit filters and CSV export; trial balance modes; recurring journals; CSV journal import; dimensions with profit report; assurance (anomalies, workflows, scheduled jobs, documents and sign-off, ESG).
- Behaviour change: approval controls default to on (workflow enabled, one level, backdated needs approval, different poster), so a manual journal can no longer be posted immediately by its creator unless setup turns these off. Existing suites switch them off in `tests/helpers.ts` (`LEGACY_CONTROLS`).
- Tests: `tests/wave-b-controls.test.ts`, `packages/domain/src/controls.test.ts`.

Not done in Wave B: email/SMS delivery of notifications (in-app only); recurring and module journals are exempt from approvals and the different-poster rule; AP bill, tax adjustment and impairment approvals record a decision but do not gate posting; the expense module's own approve endpoint is not routed through the engine; budget-exceeded alerts (C6); branches have no management screen.

**2026-10-15 — Approval gates and race fixes (Wave B follow-ups)**
- Migration `20261015150000_approval_gates`: `approvalRequiredFor` on approval controls, `PENDING_APPROVAL`/`REJECTED` on AP bills, a status on tax adjustments and fixed-asset impairments, and a partial unique index allowing one open (PENDING or RETURNED) approval request per record. Existing duplicate open requests are closed as REJECTED, keeping the oldest.
- Gated documents: setup lists which of supplier bills, tax adjustments and fixed-asset impairments wait for approval (`approvalRequiredFor`, default empty, so existing companies are unaffected; checkboxes on the approvals setup form). A listed document is held when the workflow is on and its amount needs at least one approval under the levels/tiers; it is saved as PENDING_APPROVAL without a journal and posts when the last level approves, under the same engine rules (requester and creator cannot approve, one level per person, role per level). Rejection marks it REJECTED. Held bills are left out of bill lists, payments, ageing and reports; held tax adjustments are left out of VAT returns; a held impairment is measured again against the carrying amount when it posts, and an asset can have only one held impairment.
- Expenses: submit raises an engine approval (resubmitting a returned one); approve and reject from the expense screens decide that request, so expenses have one approval path with the same rules and audit. The submitter or creator can no longer approve their own expense. Expenses submitted earlier get a request on the submitter's behalf when first decided.
- Exempt by design: recurring journals and recurring expenses, module-generated journals (AR, AP payments, banking, depreciation, tax payments, payroll) and documents synced from the ERP (bills, expenses, assets). They already passed the ERP's own controls or come from an approved template.
- Races: two concurrent approval requests for one record yield one request and a clear "already has a pending approval" error. AR receipt, AP payment and bank transaction reversals claim the record inside the reversal transaction, so a concurrent second reversal fails with "already reversed". Manual revaluation takes a lock per company and currency (shared with automation) and refuses with "already running" when busy.
- Banking: a receipt, payment, transfer, cash count or reversal runs in one transaction; a failed posting rolls back the transaction row and its original error is returned.
- Job leases are written outside the work's transaction so other instances see them at once; the scheduler (5-minute lease), recurring runs and revaluation renew their lease every third of its length while they run.
- Tests: `tests/approval-gates.test.ts`; `tests/expense.test.ts` now approves with a different user.

**2026-10-15 — Wave C (C1–C10)**
- Migrations: `20261015160000_wave_c_documents`, `20261015160100_wave_c_grni_backfill`, `20261015174000_wave_c_integrity_scan`, `20261015175000_wave_c_document_storage`, `20261015180000_wave_c_budgets`, `20261015181000_wave_c_closing`, `20261015182000_wave_c_fixed_assets_tax`. New API dependencies: `multer`, `exceljs`.
- ERP events (C1): the ERP sends `SALE_REFUNDED`, `CUSTOMER_PAYMENT_RECEIVED`, `SUPPLIER_PAYMENT_MADE` and `GOODS_RECEIVED`; sales carry their payment split and post one line per method (`OTHER` posts to cash). Customer payments and refunds update the AR subledger, supplier payments the AP subledger, in the posting transaction. Each event is claimed before processing (a stale claim is taken over after 5 minutes), so concurrent ingest, worker and retry post it once. Deleting an ERP supplier payment withdraws its queued event or is refused once it may have been sent; partial refunds subtract earlier refunds before splitting debt and cash.
- Inventory (C2): sale cost posts from the valuation layers; the ERP cost is kept and shown in the inventory reconciliation. Adjustments and write-offs go through the subledger. Goods receipts are recorded and matched by supplier bills (either order) so goods received not invoiced is cleared once. Supplier returns are AP credit notes with returned items. Stock balance rows are locked while a movement is valued, and stock journals commit with their movement links.
- AR and AP documents (C3): invoice and bill line items with tax code, rounded to the cent (excise needs its own account); `GET /ar/invoices` (status incl. overdue, dates, paging) and invoice detail; bill void (`POST /ap/bills/:id/void`, refused when paid, credited, matched to goods or a debit note); customer and supplier period statements; PDFs for invoices, statements and remittances. Deposit and advance allocation/refund and invoice paid amounts use conditional updates. Web: invoice list, line-item forms, PDF downloads, customer deposits/statement/debit note, supplier void/statement/remittance.
- Banking (C4): a bank receipt from a customer creates an AR receipt and a payment to a supplier an AP payment, with optional allocations, as one journal posted by AR/AP; reversing from either side reverses both. Receivables and payables control accounts are refused on bank lines without a party, including statement lines. Customers on credit hold can still pay.
- Reports (C5): statements for a date range (default from the financial-year start) with comparative columns, current/non-current split, cash flow from movements, statement of changes in equity and notes; year-end close entries are not counted twice. Ledger by transaction date with opening and running balance across pages; trial balance opening/movement/closing columns and dimension filters. CSV, XLSX and PDF export (`format=`) for trial balance, statements, ledger, ageing, WHT and VAT return.
- Budgets (C6): Draft → Submitted (approval engine) → Approved → Active → Revised versions, one active per financial year; lines by month and cost centre/project/branch; variance by month. `budgetControl` OFF (default) / WARN / BLOCK checks expense postings in the posting transaction; BLOCK applies to manual, imported and recurring journals, expenses, bills and banking, ERP events and other module postings only warn; WARN notifies once per budget line.
- Closing (C7): per-period checklist (bank reconciliations, depreciation, FX revaluation, VAT return, payroll) and counts; blockers (earlier open periods, unposted journals, pending approvals, exceptions, trial balance difference) cannot be overridden, other items can with a note. Optional close approval (`closeApprovalRequired`, default off) through the engine; closing history with checklist snapshots and reopen reasons. Postings take a share lock on the period so a close waits for them.
- Fixed assets and tax (C8): sum-of-years-digits and units-of-production (usage per month); monthly, quarterly or annual posting with catch-up; no charge before the in-service month. IAS 16 revaluation split between surplus and P&L (default loss account 7130); impairment uses the surplus first and restarts depreciation; disposal moves the remaining surplus to retained earnings. WHT certificate PDF per supplier payment.
- Documents (C9): multipart upload to local disk behind a storage interface (`DOCUMENT_STORAGE_DIR`, `DOCUMENT_MAX_BYTES`, default 10 MB; type allow-list checked on extension, declared type and content), download and delete with module permission checks and audit; attach panel on journals, bills, invoices, expenses, assets and reconciliations. Documents cannot be removed from submitted journals, approved expenses, completed reconciliations or closed periods.
- Integrity scan (C10): daily and on demand (`GET /books/integrity`, `POST /books/integrity/run`): GL vs AR/AP/inventory subledgers, posted documents without a posted journal, unbalanced journals, journal number gaps per counter, negative cash. Notifies admins and accountants when the findings change; card on the overview page.
- Tests: `tests/wave-c-events.test.ts`, `wave-c-documents.test.ts`, `wave-c-banking.test.ts`, `wave-c-reports.test.ts`, `wave-c-budgets.test.ts`, `wave-c-closing.test.ts`, `wave-c-fixed-assets.test.ts`, `wave-c-documents-storage.test.ts`, `wave-c-integrity.test.ts`; ERP `tests/accounting-outbox-events.test.ts`.
- Deploy: drain the ERP outbox and Accounting's pending and failed events before migrating, or a sale queued across the cut-over can have its cost posted twice or not at all.

Not done in Wave C: account sub-type field (current/non-current is inferred from reporting group and code); expenses/FA on account still do not write AP ledger rows (integrity now explains the difference as a warning).

**2026-10-16 — Wave C leftovers and seed renumbering**
- Budgets: branch column on the budget line editor; journal create/post and the journals list show `budgetWarnings` from WARN mode.
- Closing: requesting an approved close sets the period to `TEMPORARILY_LOCKED` so postings stop until the close is approved (→ CLOSED) or rejected (→ OPEN again). Year-end closing journals may still post while locked.
- Documents: S3-compatible driver (`DOCUMENT_STORAGE=s3`, bucket/region/keys/optional endpoint and path-style); local disk remains the default.
- VAT return: zero-rated and exempt memo sections from posted invoice/bill lines (net totals by sales/purchases); included in export.
- Seed codes remapped into Seg 3.7 ranges (migration `20261016140000_seed_account_renumber` + idempotent remap on chart ensure): 2400→6430 Bank Charges, 6600→1900 Suspense, 6800→4400 Sales Discounts, 6810→4410 Sales Returns, 6900→7200 Inventory Gain, 7100→1590 Asset Disposal, 7110→7300 Gain on Disposal, 7120→8100 Loss on Disposal. Skipped when the target code already exists for that company.
- Fixed assets: revaluation eliminates accumulated depreciation against cost then restates cost to fair value (IAS 16); asset cost becomes fair value and accum resets to zero.
- Integrity: AP control vs ledger differences explained by expenses/FA posted to payables without a bill are WARNING when fully explained.
- WHT certificate PDF uses the effective rate from the payment amounts, not the supplier's current rate.
- ERP refunds now reduce the original sale's `debtAmount` by the on-account portion (debt-first, same as the accounting outbox); migration `20261016150000_heal_sale_debt_on_prior_refunds` aligns existing partially refunded sales.

**2026-10-16 — Wave D (D1–D7) and open items (API key limits, branches, email)**
- Migration `20261016090000_wave_d_platform`: risk register, control tests, KPI targets, notification settings and email outbox, anomaly notes and unique flags (existing flags backfilled to their journal, duplicates removed keeping the oldest, a dismissal kept), API key usage and per-key limit, webhook endpoints and deliveries, signature hashes and snapshots, `CompanyBranch.isActive`, `ControlItem.lastTestedAt`. Domain helpers in `packages/domain/src/insights.ts`.
- KPIs (D5): `GET /books/kpis?from&to` gives revenue, gross/net/EBITDA margin, EBITDA, ROA, ROE, current and quick ratio, working capital, cash, DSO, DPO, inventory turnover, days inventory and cash conversion cycle, with the prior period and a target per KPI (`PUT /books/kpis/targets/:code`, `budget:manage`). Interest and income tax for EBITDA are found by account name.
- Forecasting (D1): `POST /books/forecast` projects revenue, expenses, profit, cash movement and closing cash from up to 24 completed months (year-end close entries excluded) with BEST/BASE/WORST multipliers (0.1–3); `GET /books/forecasts`, `GET /books/forecasts/:id/vs-actual?scenario=` compares completed months with what was posted. Forecasts made before this have no scenarios and cannot be compared.
- Anomalies (D2): the scan checks manual journals of the last 90 days for unusual amounts (against the previous 30), round amounts (multiples of 10 000 from 100 000) and entry outside 07:00–20:00 or at weekends in the company time zone, and posted supplier bills (7 days) and payments (3 days) to the same supplier for the same amount or reference. One flag per record and rule. Cases go OPEN → INVESTIGATING (on the first note) → CONFIRMED or DISMISSED, with a required reason (`POST /books/anomalies/:id/notes|resolve`; `…/dismiss` now needs a reason). New flags notify accountants.
- Signatures (D3): a signature stores the SHA-256 of a canonical JSON snapshot of the record (approval and posting timestamps and running balances left out) and a hash over the signature itself. `GET /books/signatures?entityType&entityId`, `GET /books/signatures/:id/verify` reports whether the signature row and the record are unchanged and which fields changed. Only real records of the signable types can be signed. Each approval of a signable record also records a signature.
- Risk register (D4): `GET|POST /books/risks`, `PATCH /books/risks/:id` — likelihood × impact (1–5) inherent and residual scores and ratings, owner, review date (overdue flagged), linked controls. `GET|POST /books/controls/:id/tests`: a failed test (needs notes) makes the control DEFICIENT, a pass EFFECTIVE, unless a later-dated test exists; evidence is uploaded as documents on the `ControlTest`.
- Assistant (D6): understands periods (“last month”, “Q2”, “March 2026”, “this year”, “YTD”) and topics (profit, revenue, expenses, top expenses, cash, receivables, overdue, payables, margin, EBITDA, liquidity); answers come from the statements and subledgers and link to the report or ledger behind them.
- OpenAPI and webhooks (D7): `GET /api/v1/openapi.json` (public) is generated from the routes an API key can call. Webhooks (`/books/webhooks`, `platform:manage`) for `posting.failed`, `period.closed` and `period.reopened`, signed `X-Exceledge-Signature: t=…,v1=HMAC-SHA256(secret, "t.body")`, queued with the change and delivered by the scheduler with backoff (6 attempts over about a day); test ping and delivery log. In production a webhook URL must be https on a public host name or address.
- API keys: per-key limit (default 120 a minute, 1–6000), 429 with `Retry-After` when exceeded, every call logged with path, status and IP (`GET /books/api-keys/:id/usage`), calls in the last 24 h on the list, usage purged after 90 days.
- Branches: `GET|POST /setup/branches`, `PATCH /setup/branches/:id`, `POST /setup/branches/sync` (pulls the organization's branches from the ERP with the user's token; adds and renames, never removes). An inactive branch cannot be used on new journals. Web screen `/branches`.
- Email: `PUT /books/notifications/settings` turns email on with a minimum severity (default off). Matching notifications get an outbox row; the scheduler posts them to the ERP (`POST /api/accounting-integration/notifications/email`, integration key), which emails the targeted user or role, otherwise owners, admins and accountants of the organization, through its mailer. Retries back off over 6 attempts; no recipients is recorded as SKIPPED. `ACCOUNTING_WEB_URL` sets the link in the email.
- Web: Platform page has the assistant with links, KPI table with targets, scenario forecasts with actuals, email alerts, API keys (scopes, limit, usage) and webhooks; Controls page has the risk register and control tests with evidence; Assurance has anomaly cases and signature verification.
- Tests: `tests/wave-d-platform.test.ts`, `packages/domain/src/insights.test.ts`.

Not done in Wave D: SMS delivery; webhook hosts are checked by name and literal address only (a public name that resolves to a private address is not caught); API key limits are counted in the database per minute, not a token bucket; the assistant does not use an LLM.

**2026-10-16 — Wave D polish and foreign-currency AR/AP (Segment 19)**
- Overview shows headline KPIs (revenue, margins, current ratio, DSO, cash) with a link to the full pack. Listing automation creates a daily anomaly scan job when missing; activation does the same. Branch sync deactivates branches removed or inactive in Excel Edge (never deletes them).
- Migration `20261016120000_document_fx`: `exchangeRate` on invoices, bills, receipts, payments, credit/debit notes, deposits and advances; currency on settlement documents that lacked it.
- AR invoices and AP bills accept the party's currency (or an explicit document currency that matches the party) and post journals converted at the rate on or before the document date (or a supplied rate). Amounts on the document stay in document currency; the GL is functional.
- Receipts and payments in that currency clear the control account at each document's rate and the bank at the settlement rate; the difference is realized FX gain or loss (accounts from currency settings / defaults 4300 and 6500). Withholding tax on a foreign payment is still refused. Open AR/AP period-end revaluation is not done yet.
- Tests: `tests/document-fx.test.ts`; Wave A functional-currency check updated; banking foreign-party message accepts the missing-rate error.

## 3. Plan

Four waves. Each wave is shippable on its own. Wave A blocks production use; B makes existing features honest; C completes the books; D is platform scope that needs a product decision.

### Wave A — correctness and security (about 2 weeks)

**A1. Period lifecycle (S)**
- Add `openPeriodsUpTo(companyId, date)` in `setup.service.ts` that sets `FUTURE` periods with `startDate <= date` to `OPEN`. Call it on activation, on financial-year creation, and from a daily job (A10).
- Add `POST /books/periods/:id/open` and `/lock` (`TEMPORARILY_LOCKED`) under `close:manage`, with audit.
- Enforce `transactionLockDate` in `assertOpenPeriod`.
- Tests: post in month 2 and 12 after activation; locked period rejects posts; closed month then post next month.

**A2. Atomic posting (M)**
- Add `createAndPostJournal(tx, …)` that runs number allocation, journal create, GL entries, balance updates and source link inside one `prisma.$transaction`. Make `assertOpenPeriod`, `writeAudit` accept the transaction client.
- Allocate numbers with `UPDATE number_sequences SET next_number = next_number + 1 … RETURNING` inside the transaction; take the year from `journalDate`.
- Update balances with `increment` instead of read-modify-write.
- Move AR (`ar.service.ts` invoice, receipt, notes, deposits), AP (`ap.service.ts` bill, payment, notes, advances), banking and expense posting into the same transaction as their document, so the document is `POSTED` only when the journal is.
- Tests: closed-period invoice leaves no invoice row; 20 parallel posts get unique numbers and correct balance.

**A3. Posting rights (S)**
- `postImmediately` requires `journal:post`. `POST /expenses/:id/post` requires `APPROVED` status and `expense:post`.
- Optional setting `requireDifferentPoster` (default on): creator cannot post own manual journal.
- `reverseJournal`: reject manual reversal of journals with `sourceModule` other than manual/import (those must be reversed through their source document); date the reversal in the first open period when the original period is closed.

**A4. Account posting flags (S)**
- `assertAccountsPostable(companyId, ids, { manual })`: enforce `allowManualPost` for manual/import/recurring journals, `allowAutoPost` for integration, and block manual posting to AR, AP and inventory control accounts.

**A5. FX foundations and revaluation fix (M)**
- Schema: add `amountForeign Decimal?`, `exchangeRate Decimal?` to `JournalLine`; `currency`, `exchangeRate`, `amountForeign` to `ArInvoice`, `ApBill`, receipts, payments, bank transactions.
- `createJournal`: when `currencyCode` differs from functional, require a rate (explicit or latest `ExchangeRate` on or before the date), store foreign amounts, post functional amounts.
- Rewrite `revalueCurrency`: foreign balance = sum of `amountForeign` on the account; book value = functional balance; adjustment = foreign × closing rate − book value. Use `CurrencySettings.fxGainAccountId/fxLossAccountId`, falling back to 4300/6500. Skip the functional currency instead of throwing.
- Tests with real numbers (USD 1,000 at 1,300 then 1,350 → gain RWF 50,000).

**A6. Consolidation safety and maths (M)**
- `createGroup`/`addMember`: a member `companyId` must be a company whose `externalErpOrganizationId` is in the caller's JWT `organizationIds`; re-check on `consolidateGroup`. Drop the "no companyId means own books" fallback.
- Replace proportional scaling with full consolidation: sum 100% of subsidiaries, add a non-controlling interest line for `(100 − ownership)%` of subsidiary equity and profit.
- Eliminations become balanced line sets (account code, debit, credit) applied per account; reject unbalanced sets.
- Add `asOf` to consolidation.

**A7. API keys that work, or hide them (S)**
- Add `authenticateApiKey` middleware: look up by `prefix`, compare SHA-256 with `timingSafeEqual`, reject revoked/expired, set `lastUsedAt`, resolve company. Add `scopes String[]` and `expiresAt` to `ApiCredential`, mapped to capabilities.
- Accept it on read-only report routes first (`/books/trial-balance`, `/books/statements`, `/gl`, ageing).
- Replace the `!==` comparison in `requireIntegrationKey` with `timingSafeEqual`.

**A8. Approval and workflow integrity (S)**
- `decideApproval`: only from `PENDING`; validate that `entityType`/`entityId` exists for supported types; audit.
- `advanceWorkflow`: record actor per step (`WorkflowStepLog` table), audit, reject the same user approving consecutive steps.

**A9. Recurring and automation robustness (S)**
- `runRecurring`: one transaction per template; on failure keep `nextRunDate`, write `RecurringRunLog`, create a notification; continue with the rest. Use an advisory lock per company to prevent double runs.

**A10. Scheduler (S)**
- Add `node-cron` (or a 60-second tick like `startIntegrationWorker`) that each day: opens due periods (A1), runs due recurring journals and expenses, runs enabled `AutomationJob`s whose `schedule` (cron string, validated on save) is due. Guard with a Postgres advisory lock so only one API instance runs jobs.

**A11. Housekeeping (S)**
- Wrap every async route in an error handler (`books.routes.ts` GETs hang on DB errors).
- Correct seed account types that break their code range; give payroll payable its own account.
- Correct the README phase table to match this document.

### Wave B — enforce what is already configured, and give it screens (about 3 weeks)

**B1. Approval engine (L)**
- One `approval.service.ts` used by journals, AP bills, expenses, tax adjustments, FA impairment, budgets.
- Reads `ApprovalPostingControls.approvalLevels` and `amountBasedApprovalLimits` to decide how many levels and which role per level.
- Statuses: `PENDING` → `APPROVED`/`REJECTED`/`RETURNED`; resubmit after `RETURNED`.
- Journals use the existing `SUBMITTED`/`UNDER_REVIEW`/`APPROVED` statuses; posting requires final approval when the rule applies.
- Screen: approval queue ("Waiting for me"), with approve, reject, return.

**B2. Setup screen with real forms (M)**
- Replace the demo quick-setup in `Setup.tsx` with forms per section; add APIs to edit default accounts, numbering and periods.
- Lock functional currency and valuation method after activation.
- Opening balances: approve → post as one `OPENING` journal; include customer and supplier lines feeding subledgers.

**B3. Enforce setup policies (S)**
- Backdated/future-dated policies, supporting-document rule (needs D-documents, else warn), numbering formats (`includeMonth`, `includeBranch`, `resetFrequency`).

**B4. Screens for API-only features (M)**
- Trial balance page uses `/books/trial-balance` with mode, as-of and compare dates.
- Recurring journals, journal CSV import, dimensions, anomalies, workflows, automation, signatures, ESG, document list per record.

**B5. Dimensions end to end (M)**
- Journal API accepts `costCentre`, `project`, `branchId` per line; validate against `Dimension` (active).
- Expense allocations become journal lines with dimensions.
- `dimensionReport` by kind, with P&L per cost centre/project.

**B6. Notifications per user, with triggers (M)**
- `NotificationRead(notificationId, erpUserId)`; optional `targetRole`.
- Triggers: posting exception created, recurring run failed, reconciliation difference on completion attempt, approval assigned to role, invoice/bill overdue (daily job), budget exceeded (C6), period nearing close.
- Email through the ERP's mailer via an outbox event (keep identity in ERP).

**B7. Audit coverage (S)**
- Audit every create/update/decide in `books.service.ts`. Server-side filters (user, entity, action, date) and CSV export on `/audit`. Revoke `UPDATE`/`DELETE` on `audit_events` for the app's DB role.

### Wave C — complete the books (about 4–5 weeks)

**C1. ERP events (M)** — Add `SALE_REFUNDED`, `CUSTOMER_PAYMENT_RECEIVED`, `SUPPLIER_PAYMENT_MADE`, `GOODS_RECEIVED` to `Backend/src/services/accounting-outbox.service.ts` and posting rules; customer payments and returns update the AR subledger; split payments post one line per method.

**C2. Inventory consistency (M)** — Sale COGS from accounting valuation (cost layers), with the ERP figure kept for reconciliation; route adjustment/write-off rules through the subledger; fix the bill-without-`receivedAtCost` double count; supplier returns.

**C3. AR and AP documents (L)** — Invoice and bill line items with tax code; invoice list endpoint; bill void; period statements; PDF output for invoices, statements and remittances; screens for debit notes and deposit/advance allocation.

**C4. Banking links (S)** — Receive/pay against a customer or supplier updates the subledger; reject allocation to control accounts without a party.

**C5. Statements and reports (L)**
- Statements for a period range (from financial-year start, not inception), comparative columns, current/non-current split by account sub-type, statement of changes in equity, basic notes.
- GL by transaction date with opening balance and correct running balance computed at query time.
- Trial balance with opening, movement, closing columns and dimension filters.
- Export: CSV and XLSX (`exceljs`) and PDF for trial balance, statements, ledger, ageing, tax reports.

**C6. Budgets (M)** — Statuses Draft → Submitted → Approved → Active → Revised (versions); budget by period and dimension; variance by month; optional block or warn when a posting would exceed budget.

**C7. Closing (M)** — Checklist items for bank reconciliation done, depreciation run, FX revaluation, tax filing prepared, payroll posted; per-period counts; close approval step; closing history report.

**C8. Fixed assets and tax (M)** — Units-of-production and sum-of-years methods; quarterly/annual depreciation; IAS 16 revaluation decrease split between reserve and P&L; impairment and tax-adjustment approval through B1; WHT certificates (PDF).

**C9. Documents (M)** — Real upload (multipart, size/type limits) to S3-compatible storage or local disk behind an interface; download with permission check; attach panel on journals, bills, invoices, expenses, assets, reconciliations.

**C10. Data integrity scan (S)** — Daily job: GL vs AR/AP/inventory subledgers, journal number gaps, unbalanced journals, negative cash; results as notifications and a dashboard card.

### Wave D — platform (needs a product decision on scope)

Recommended to build, small and useful:
- **D1 Forecasting (M):** revenue, expense and cash forecasts from history; best/base/worst scenario multipliers; forecast vs actual; list saved forecasts.
- **D2 Anomalies (M):** duplicate supplier invoice and payment detection, round-amount and weekend/after-hours manual journals, unique flag per journal and rule; case notes and dismiss reason.
- **D3 Signatures (S):** store SHA-256 of a canonical JSON snapshot of the signed record; verify endpoint that recomputes it; list endpoint; signing through B1 approvals.
- **D4 Risk register (M):** risks with likelihood × impact, owner, linked controls, control tests with evidence (uses C9).
- **D5 KPI pack (S):** EBITDA, quick ratio, working capital, DSO/DPO, inventory turnover on the overview.
- **D6 Assistant (M):** keep answers grounded in posted figures; add period-aware questions and drill links. An LLM is optional and should only phrase answers computed from the books.
- **D7 OpenAPI and webhooks (M):** publish OpenAPI for the key-authenticated routes; webhooks for posting failures and period close.

Recommended to defer or drop: **37** executive mobile app (a responsive overview covers most of it), **38** visual workflow designer (B1 covers approvals), **42** no-code builder, **45** marketplace, **36** full ESG beyond the current measures. These are large products of their own and do not affect the correctness of the books.

---

## 4. Order of work and testing

1. A1, A2, A3, A11 first — they unblock posting after January and stop orphan documents.
2. A5, A6, A7 — the three features that currently give wrong or misleading results.
3. A8–A10, then Wave B.
4. Every task adds API tests in `apps/api/tests/` that cover a failure path, not only the happy path. Add a test suite that posts across a full financial year, closes each month, and runs the year-end close.
