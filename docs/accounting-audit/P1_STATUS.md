# P1 status, 24 November 2026

Harness after the fixes: 79 pass, 0 fail, 1 partial (no edit of a posted invoice), 10 informational (`evidence/run-after-p1.txt`). E12b, E16, E20, E21 and S20b were rewritten to test the new behaviour.

| ID | Status | What changed |
|---|---|---|
| F-10 Trial balance | Done | Summed in SQL: 110 ms at 100,000 rows, was 18 to 39 s |
| F-11 Dates | Done | Voids use the invoice date while its period is open; voids, deposit applications and refunds accept a date |
| F-12 Time zone | Done | ERP events book on the company's local day (default Africa/Kigali) |
| F-13 Cash flow | Done for disposals and impairment | Buying an asset on credit still shows as an investing outflow |
| F-14 Write-off | Done | `POST /ar/invoices/:id/write-off`, reversal, and a button on the invoice. VAT stays payable |
| F-15 Inclusive VAT | Done for invoices, receipts, credits and refunds | Not for estimates and orders. Documents still print prices before tax |
| F-16 Typed VAT | Done | Refused above the highest rate in force |
| F-17 Ledger | Done | Database triggers block changing or deleting ledger rows and posted journals; account merge is the one exception |
| F-18 Integration key | Done, opt-in | A company with its own key refuses the shared one. No screen yet: `POST /integration/key` |
| F-19 Errors | Done | One filter on every route |
| F-20 Audit events | Done | Receipts, deposits, credit notes, refunds, write-offs |
| F-21 Bill approval | Done | "Submit for approval" holds the bill; nothing posts until approved |
| F-22 One-step saves | Done | Sales receipt, and deposit with cash back |
| F-23 Negative stock | Done | Notification and integrity check; the sale still posts |
| F-24 CI | Written, not run | `.github/workflows/ci.yml` runs once pushed. Still no frontend tests |
| F-25 Dependencies | Done for high severity | Zod 4, nodemailer and others upgraded; 2 moderate (uuid through exceljs) remain |
| F-26 Rate limits | Done | 900 a minute per caller, 6,000 for events, per API instance |
| F-27 Branch access, pay encryption | Not started | Needs a decision on who sees which branch, and where the encryption key lives |
| F-28 Settings switches | Not started | Export and attachments were connected with P0 |
| F-29 QuickBooks migration | Not started | Needs a sample QuickBooks export |
