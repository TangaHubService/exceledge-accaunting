# P0 status, 24 November 2026

The other reports describe the code as audited (6438570). This page says what changed since. Results after the fixes: `evidence/run-after-p0.txt` (68 pass, 9 fail, 3 partial, 10 informational; the 9 failures are P1). The harness now tests refunds through the new endpoint, sends idempotency keys as the web app does, and expects "Accrual" in E17 and integrity-clean ageing in A17. Audit-time results are kept in FUNCTIONAL_TEST_RESULTS.md.

| ID | Status | What changed |
|---|---|---|
| F-01 | Done for the audited screens | Dashboard, badge, search, audit log, export, attachments and tasks read real data. Import opens the six real importers and disables the rest. Budgets use the editor that saves. Workflows, custom fields, form styles and backup say "Not available yet" |
| F-02 | Done | Credit notes carry tax lines and can go on an invoice; `POST /ar/refunds` clears a credit once, or credits and refunds goods together |
| F-03 | Done | Ageing, dashboards and the integrity scan convert to RWF. Foreign deposits, debit notes, advances and supplier credits are refused instead of posted as RWF |
| F-04 | Done | Ageing equals the control account on any date; opening batches create open items; party openings use Opening Balance Equity |
| F-05 | Done | Expenses and bank payments refuse receivables, payables and inventory control accounts |
| F-06 | Done for the web app | `Idempotency-Key` on POST; the web app sends one per submission. API callers must send their own |
| F-07 | Done | Cash basis is refused; statements say accrual |
| F-08 | Not started | EBM needs a decision with the ERP team and RRA |
| F-09 | Not started | Real backups and a rehearsed restore need the hosting; only the false page was removed |

Existing data: old opening batches get no open item but still show in ageing as "Other balance". Old openings against 1900 Suspense, old credit notes without VAT and old duplicates are not corrected.
A company already set to cash basis keeps the stored value; statements print accrual, and the setting can only be saved as accrual.
