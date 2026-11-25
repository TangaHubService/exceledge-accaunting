# Production readiness report

**Not ready.** 4 of 12 gates met.

| Gate | Met |
|---|---|
| All P0 findings closed | No |
| Statements balance and reconcile (A01–A05, A16) | Yes |
| AR/AP/ageing reconcile in all tested cases | No |
| No page shows invented data | No |
| Duplicate submission safe | No |
| Closed periods protected | Yes |
| Tenant isolation tested | Yes |
| Rollback and concurrency tested | Yes |
| Verified backup and restore | No |
| CI and frontend tests | No |
| EBM compliance evidenced | No |
| Volume target met | No |

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
