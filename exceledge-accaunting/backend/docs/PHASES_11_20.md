# Phases 11–20

Books features after fixed assets. API prefix: `/api/v1/books`.

| Phase | What shipped |
|-------|----------------|
| 11 | Recurring journal templates and a run that posts due templates |
| 12 | Trial balance modes (standard, unadjusted, adjusted, post-closing, comparative), month close checklist, reopen with a reason, year-end close into account 3100 |
| 13 | Income statement, statement of financial position, indirect cash flow, ratios |
| 14 | Exchange rates and unrealized FX revaluation for accounts tagged with a foreign currency |
| 15 | Budgets, approval, variance, cost centre / project register and a dimension report |
| 16 | Control register and approval requests (requester cannot approve their own item) |
| 17 | Alerts, document notes, CSV journal import |
| 18 | Payroll in the ERP (employees, monthly runs, payslips) posting to Accounting on approval and payment; scanned supplier invoices posted as supplier bills |
| 19 | Company groups, ownership share, intercompany eliminations, consolidated trial balance |
| 20 | Profit forecast, posting anomaly flags, ESG intensity, workflow templates, API keys (shown once), electronic signature records, automation jobs, books assistant |

A reopened period accepts new journals. The assistant answers from posted totals; it does not call an external model.

Rules worth knowing:

- Reports, budget actuals and close checks use the journal date, not the date it was posted.
- Periods close in order. The last period of a year can only be closed with a year-end close, which moves profit to 3100.
- The cash flow runs from the start of the financial year and must agree with the movement on cash and bank accounts (codes 11xx); the screen flags any difference.
- Budget actuals cover the budget's financial year only.
- The profit forecast uses completed months, counting months with no postings as zero.
- Payroll runs live in the ERP (Finance → Payroll, `/api/payroll/:organizationId`). Accounting receives `PAYROLL_APPROVED` and `PAYROLL_PAID` events, never payslips.
- ERP access tokens last 15 minutes. The web app stores the ERP refresh token at sign-in and renews once on a 401 before signing the user out. The ERP keeps one refresh token per user, so renewing here ends the ERP tab's renewal chain (as signing in here already did).

## Phase 18: payroll

Rules version `RW-2025-01`, monthly, whole francs. Have an accountant confirm the rates before relying on them; they live in `Backend/src/services/payroll-calc.service.ts`.

- PAYE on gross pay: 0% up to 60,000, 10% to 100,000, 20% to 200,000, 30% above.
- RSSB is charged on gross pay without the transport allowance: pension 6% staff and 6% employer, occupational hazards 2% employer, maternity 0.3% staff and 0.3% employer.
- CBHI is 0.5% of gross pay less PAYE, staff pension and staff maternity.

A run is prepared for one month (one live run per month), can be recalculated or cancelled while it is a draft, and is approved by an administrator. Approval posts:

| Account | Debit | Credit |
|---------|-------|--------|
| 6100 Salaries and wages | gross pay | |
| 6120 Employer social security | employer RSSB | |
| 2300 PAYE payable | | PAYE |
| 2310 RSSB contributions payable | | staff RSSB + employer RSSB + CBHI |
| 2320 Net salaries payable | | net pay |

Recording payment debits 2320 and credits the bank, mobile money clearing or cash account. Accounting rejects an approval whose totals do not add up.

## Scanned supplier invoices

Importing a scanned invoice in the ERP (Scan Invoice) adds the stock, which already posts Dr Inventory / Cr GRNI at cost, and then sends a `SUPPLIER_BILL_APPROVED` event. The bill debits GRNI for the cost of the stock received, purchases for any rest of the net amount, input VAT for the tax, and credits the supplier. It also opens the supplier bill and attaches the scan's file path as a document note on it.
