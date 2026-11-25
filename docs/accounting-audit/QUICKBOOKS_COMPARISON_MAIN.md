# QuickBooks comparison on feat/quickbooks-gaps, 25 November 2026

Same features and weights as the audit: tested 100, partial or duplicated 50, untested 40, missing 0, incorrect 25. The weights are a judgement and every feature counts equally. Rerun `python3 evidence/rescore.py` from this folder.

| Area | Audit (6438570) | Main now | Tested | Missing |
|---|---|---|---|---|
| Core accounting | 73% | **92%** | 10 of 12 | 0 |
| Sales and receivables | 52% | **88%** | 13 of 16 | 1 |
| Purchases and payables | 75% | **100%** | 9 of 9 | 0 |
| Banking | 88% | **88%** | 7 of 8 | 1 |
| Inventory | 88% | **94%** | 7 of 8 | 0 |
| Expenses and income | 50% | **79%** | 4 of 7 | 0 |
| Reporting | 66% | **84%** | 7 of 10 | 0 |
| Tax and compliance | 62% | **79%** | 7 of 10 | 1 |
| Additional | 57% | **68%** | 4 of 11 | 0 |
| Security | 58% | **85%** | 7 of 10 | 0 |
| Reliability | 69% | **94%** | 7 of 8 | 0 |
| User experience | 38% | **58%** | 1 of 5 | 0 |
| **QuickBooks-type features** | 66% | **86%** | 71 of 94 | 2 |
| **Daily accounting only** | 68% | **89%** | 55 of 68 | 2 |

## Not yet complete
| Area | Feature | Status |
|---|---|---|
| Core accounting | Cash and accrual reporting | Partial |
| Core accounting | Multi-currency and FX | Partial |
| Sales and receivables | Recurring invoices | Partial |
| Sales and receivables | Statements | Partial |
| Sales and receivables | Online payment / Pay now | Missing |
| Banking | Live bank feeds | Missing |
| Inventory | Negative stock | Partial |
| Expenses and income | Attachments | Partial |
| Expenses and income | Receipt capture / inbox | Partial |
| Expenses and income | Reimbursements | Partial |
| Reporting | Cash flow statement | Partial |
| Reporting | Budget vs actual | Partial |
| Reporting | KPIs, forecasts, custom reports | Not tested |
| Tax and compliance | EBM fiscal invoice for app sales | Missing |
| Tax and compliance | EBM retry and reconciliation | Not tested |
| Tax and compliance | RWF handling | Partial |
| Additional | Payroll calculation | Partial |
| Additional | Import | Partial |
| Additional | Export | Partial |
| Additional | QuickBooks migration | Partial |
| Additional | Workflow automation | Partial |
| Additional | Custom fields, form styles | Partial |
| Additional | Settings switches | Partial |
| Security | Integration key | Partial |
| Security | Pay data at rest | Partial |
| Security | Dependencies | Partial |
| Reliability | Automated tests, CI | Partial |
| User experience | Navigation | Duplicated |
| User experience | Validation messages | Partial |
| User experience | Report to source drill-down | Not tested |
| User experience | Screens that fake success | Partial |
