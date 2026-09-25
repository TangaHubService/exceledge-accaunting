# Documentation Overview — Segments 1–45

**Source:** ACCOUNTING MODULE DOCUMENTATION.pdf  
**Extract:** `/Users/apple/Desktop/Excledge/docs/accounting-module-documentation-extracted.txt`  
**System boundary:** Accounting microservice (`exceledge-accaunting`) + ERP integration.  
**Identity:** Users/auth live **only in ERP** (not duplicated in Accounting).

This file is the complete functional map of the specification. Implementation phases map to these segments below.

---

## Core accounting & books (Segments 1–15)

| Seg | Title | What it covers | Phase |
|-----|--------|----------------|-------|
| **1** | Accounting Module Overview, Architecture & System Integration | Double-entry principles; Automation First; Integration Engine; POS event flow; module independence; exception queue | 0 (done) + 3 |
| **2** | Company Accounting Setup | 14 setup sections; FY/periods; currency; policies; localization; default accounts; numbering; approvals; opening balances; activation gate | **1** |
| **3** | Chart of Accounts | Account types/ranges; hierarchy; control flags; import/export; protected accounts; tax mapping | **2** |
| **4** | Customers & Accounts Receivable | Customer financials; credit control; invoices/receipts; deposits; CR/DR notes; AR ledger; ageing; statements | **4** |
| **5** | Suppliers & Accounts Payable | Supplier bills; P2P (PR→PO→GRN→Bill→Pay); advances; WHT; AP ageing; statements | **5** |
| **6** | Banking & Cash Management | Bank/cash/MoMo accounts; receipts/payments; transfers; petty cash; cashbook; charges/interest | **7** |
| **7** | Bank Reconciliation | Statement import; auto/manual match; outstanding items; approval of recon | **7** |
| **8** | Journal Entries | Double-entry engine; draft→posted workflow; auto rules; reversals; attachments; audit | **3** / **11** |
| **9** | General Ledger | Central posted repository; account inquiry; drill-down to source docs; export | **3** |
| **10** | Trial Balance | Standard/comparative/adjusted/post-closing; branch/CC/project; balance verification | **12** |
| **11** | Inventory Accounting | Valuation (FIFO/WAC/specific); COGS; adj/write-off/transfer journals; GRNI; recon | **6** |
| **12** | Expense Management | Categories; claims; recurring; allocation; approval → GL | **9** |
| **13** | Fixed Assets Management | Register; capitalize; depreciation; transfer; reval; impairment; disposal | **10** |
| **14** | Tax Management | Tax codes; VAT in/out; WHT; PAYE link; Excise; RRA EBM linkage; tax ledgers; filings; recon | **8** |
| **15** | Financial Statements | P&L; SOFP; Cash Flow; equity changes; notes; comparative; IFRS-oriented reports | **13** |

---

## Management, control & platform foundations (Segments 16–30)

| Seg | Title | What it covers | Phase |
|-----|--------|----------------|-------|
| **16** | Management Reports & Business Analytics | Management packs; profitability; trends; ratios from live accounting data | **13** |
| **17** | Budget Management | Budget create/approve/revise; variance; controls by dept/branch/project/CC | **15** |
| **18** | Projects & Cost Centres | Dimensions on postings; project/CC performance | **15** |
| **19** | Multi-Currency Accounting | Functional vs txn currency; rates; reval; realized/unrealized FX | **14** |
| **20** | Month-End & Year-End Closing | Close checklists; locks; reopen with reason; year-end | **12** |
| **21** | Audit Trail & System Activity Log | Who/when/what/before/after/source module/document; immutable history | **1** (setup) → **16** (harden) |
| **22** | Approval Workflow Management | Multi-level approvals; amount limits; Draft→Posted paths; SoD | **1** (basic) → **16** |
| **23** | Users & Permissions Management | Spec describes ERP-style IAM. **In this architecture: owned by ERP only.** Accounting enforces capabilities from ERP JWT/roles — no local user/password store | **ERP + Accounting AuthZ adapter** |
| **24** | Notifications & Alerts | Period lock, posting failures, approvals due, recon mismatches, etc. | **17** |
| **25** | Recurring Transactions | Templates for JE, bills, invoices, receipts on schedule | **11** |
| **26** | Document Management | Attachments on journals, bills, assets, recon packs | **17** |
| **27** | Data Import, Export & System Integration | Bulk import/export; ERP↔Accounting contracts; external systems | **3** (ERP ingest) + **17** |
| **28** | Business Intelligence, KPI & Executive Analytics | Scorecards; KPIs; executive dashboards | **13** / later BI |
| **29** | Accounting Control & Data Integrity | Balance checks; period integrity; incomplete setup blockers; continuous validation | **3** + **12** + ongoing |
| **30** | Multi-Company & Consolidated Financial Management | Multiple legal entities; separate books; consolidation prep | **19** |

---

## Advanced / enterprise / AI platform (Segments 31–45)

| Seg | Title | What it covers | Phase |
|-----|--------|----------------|-------|
| **31** | AI Accounting Assistant | Q&A, explanations, guided posting help | **20** backlog |
| **32** | Financial Planning & Forecasting | Projections, scenarios, forecasts from history | **20** / after budgets |
| **33** | Group Accounting & Consolidated Financial Management | Group consolidations; eliminations; IFRS 10 / IAS 21 oriented | **19** |
| **34** | Internal Controls, Risk Management & Compliance | Control library; risk register; compliance tracking | **16** / **20** |
| **35** | AI Fraud Detection & Financial Anomaly Monitoring | Anomaly scoring on journals, payments, user behavior | **20** backlog |
| **36** | ESG & Sustainability Accounting | Non-financial ESG measures alongside books | **20** backlog |
| **37** | Executive Command Center & Mobile ERP | Exec mobile dashboards/approvals | **20** backlog |
| **38** | Enterprise Workflow Automation & Business Process Designer | Visual process designer beyond fixed approval flows | **20** backlog |
| **39** | API Management, Developer Portal & Enterprise Integration Hub | Public APIs, keys, partner integrations (includes RRA/MoMo examples) | **3** (internal APIs) → **20** (portal) |
| **40** | Digital Signatures, Electronic Approvals & Legal Document Authentication | e-sign approvals on accounting docs | **20** backlog |
| **41** | AI Business Copilot & Enterprise Intelligence Assistant | Broader NLP copilot across ERP/Accounting | **20** backlog |
| **42** | No-Code Application Builder & ERP Studio | Custom tables/forms without core forks | **20** backlog |
| **43** | Enterprise Automation Center & Intelligent Task Orchestrator | Cross-module scheduled/event automation | **20** backlog |
| **44** | AI Document Intelligence, OCR & Automated Accounting Capture | Invoice/OCR → accounting capture (ERP already has supplier OCR — integrate later) | **20** / reuse ERP OCR events |
| **45** | ERP Marketplace, Extension Platform & Ecosystem Management | Extensions marketplace for Accounting/ERP | **20** backlog |

---

## Ownership split (microservice rules)

| Concern | Owner |
|---------|--------|
| Login, passwords, refresh tokens, user invitations | **ERP only** |
| Organization / branch membership | **ERP only** (Accounting maps `externalOrganizationId`) |
| POS, stock, PO, EBM fiscalization | **ERP only** |
| COA, journals, GL, AR/AP books, banking books, FA, budgets, statements | **Accounting service** |
| AuthN for Accounting UI/API | **Validate ERP JWT** (same issuer/secret or JWKS) |
| AuthZ for accounting actions | **Accounting permission matrix keyed by ERP `userId` + org role claims** — no duplicate credentials |

---

## Recommended build waves

1. **Foundation:** Seg 1–3, 8–9, 21–22 (basic), 29 (integrity basics) → Phases 0–3  
2. **Operational finance:** Seg 4–7, 11–14 → Phases 4–9  
3. **Close & report:** Seg 10, 15–16, 20, 28 → Phases 12–13  
4. **Dimensions & FX:** Seg 17–19 → Phases 14–15  
5. **Controls & collab:** Seg 23 (ERP), 24–27, 34 → Phases 16–17  
6. **Enterprise / AI platform:** Seg 30–45 → Phases 19–20  

Nothing in Segments 1–45 is ignored; later segments are explicitly backlog phases after core books are complete and verified.
