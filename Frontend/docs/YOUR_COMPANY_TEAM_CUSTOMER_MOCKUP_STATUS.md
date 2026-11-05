# Mockup status — YOUR COMPANY / TEAM / CUSTOMER

**Rule:** Once marked `DONE`, do not reopen unless the user explicitly asks.

**Mockup roots:**
- `PRIMARY RIBBONS/YOUR COMPANY/`
- `PRIMARY RIBBONS/TEAM/`
- `PRIMARY RIBBONS/CUSTOMER/`

---

## YOUR COMPANY

| # | File | Screen | Status | Maps to |
|---|------|--------|--------|---------|
| 30 | `30. Company.png` | Company settings | DONE | `CompanySettings.tsx` |
| 31a | `31. Company 2.png` | Company settings (scroll) | DONE | same |
| 31b | `31. Usage.png` | Usage limits | DONE | `UsageSettings.tsx` |
| 32–33 | Report parts | Reports settings | DONE | `ReportsSettings.tsx` |
| 34–35 | Sales parts | Sales settings | DONE | `SalesSettings.tsx` |
| 36 | `36. Expenses.png` | Expenses settings | DONE | `ExpensesSettings.tsx` |
| 37 | `37. Time.png` | Time settings | DONE | `TimeSettings.tsx` |
| 38 | `38. Inbox.png` | Inbox settings | DONE | `InboxSettings.tsx` |
| 39 | `39. Wallet.png` | Wallet | DONE | `WalletSettings.tsx` |
| 40–43 | Advanced parts | Advanced settings | DONE | `AdvancedSettings.tsx` |
| 44 | `44. User.png` | Manage users | DONE | `ManageUsers.tsx` |
| 45–46 | Add user parts | Add user | DONE | `AddUser.tsx` |
| 47–48 | Roles parts | Roles | DONE | `ManageUsers` roles tab |
| 49–50 | Invite parts | Invite accounting firm | DONE | `InviteFirm.tsx` |
| 51–52 | Styles | Custom form styles | DONE | `CustomFormStyles.tsx` |
| 53–54 | Invoice style | Edit invoice style | DONE | `EditInvoiceStyle.tsx` |
| 55 | `55. Chat of Accounts.png` + CoA redesign assets | Chart of accounts + New account drawer | DONE | `Accounts.tsx`, `NewAccountDrawer`, `coa-taxonomy.ts` (predefined categories) |
| 56 | `56. Additional.png` | Company ID + shortcuts | DONE | `KeyboardShortcutsModal.tsx` |

---

## CUSTOMER

| # | File | Screen | Status | Maps to |
|---|------|--------|--------|---------|
| 101 | `101. Add customer.png` | Customers & leads empty | DONE | `Customers.tsx` + hero |
| 102–106 | Adding customer parts 1–5 | Add customer drawer tabs | DONE | `AddCustomerDrawer` + tab components |
| 107–109 | Create invoice parts 1–3 | Invoice (Edit / Email / PDF, Manage panel, tour) | BUILT | `SalesDocForm kind="invoice"` → `/sales/invoice/new` · posts `POST /ar/invoices` |
| 110 | `110. Receive payment.png` | Receive payment | BUILT | `ReceivePaymentForm` → `/sales/receive-payment/new` · `POST /ar/receipts` |
| 111 | `111. Statement.png` | Create statements | BUILT | `StatementForm` → `/sales/statement/new` · downloads statement PDFs |
| 112–114 | Estimate parts 1–3 | Estimate | BUILT (local) | `SalesDocForm kind="estimate"` → `/sales/estimate/new` |
| 115–120 | Sales order parts 1–6 | Sales order + Customisation / Design / Customer reports panel | BUILT (local) | `SalesDocForm kind="sales-order"` → `/sales/sales-order/new` |
| 121–122 | Credit note parts 1–2 | Credit note | BUILT | `CustomerLineForm` → `/sales/credit-note/new` · `POST /ar/credit-notes` |
| 123–124 | Sales receipt parts 1–2 | Sales receipt | BUILT | `CustomerLineForm` → `/sales/sales-receipt/new` · invoice + receipt |
| 125–126 | Refund receipt parts 1–2 | Refund receipt | BUILT | `CustomerLineForm` → `/sales/refund-receipt/new` · `POST /banking/payments` |
| 127–130 | Delayed credit / charge parts 1–4 | Delayed credit, delayed charge | BUILT (local) | `CustomerLineForm` → `/sales/delayed-credit/new`, `/sales/delayed-charge/new` |
| 131 | `131. Proposal.png` | Who's this proposal for? | BUILT (local) | `ProposalStart` → `/sales/proposal` → `/sales/proposal/new` |

---

## SUPPLIER

| # | File | Screen | Status | Maps to |
|---|------|--------|--------|---------|
| 141–145 | Supplier hero + Add supplier parts 1–4 | Suppliers hero, Add supplier drawer | DONE (existing) | `SuppliersHero`, `AddSupplierDrawer` |
| 146 | `146. Import supplier.png` | Import suppliers | DONE (existing) | `ImportSuppliersWizard` |
| 147 | `147. Cheque.png` | Cheque | BUILT | `CategoryTxnForm kind="cheque"` → `/expenses/cheque/new` · `POST /banking/payments` |
| 148 | `148. Create bill.png` | Bill + autofill panel | BUILT | `CategoryTxnForm kind="bill"` → `/expenses/bill/new` · `POST /ap/bills` (+ approval request) |
| 149 | `149. Pay bill.png` | Pay bills | BUILT | `PayBillsForm` → `/expenses/pay-bills` · `POST /ap/payments` per supplier |
| 150 | `150. Purchase order.png` | Purchase order | BUILT (local) | `CategoryTxnForm kind="purchase-order"` |
| 151 | `151. Item receipt.png` | Item receipt | BUILT (local) | `ItemReceiptForm` → `/expenses/item-receipt/new` |
| 152 | `152. Supplier credit.png` | Supplier credit | BUILT | `CategoryTxnForm` → `/expenses/supplier-credit/new` · `POST /ap/credit-notes` |
| 153 | `153. Credit card.png` | Credit card credit | BUILT | `CategoryTxnForm` → `/expenses/credit-card-credit/new` · `POST /banking/receipts` |

---

## PROJECT

| # | File | Screen | Status | Maps to |
|---|------|--------|--------|---------|
| 154 | `154. Project.png` | Projects empty state / list | BUILT (local) | `ProjectsPage` → `/projects` |
| 155 | `155. Project part 2.png` | New project + Project Management Agent panel | BUILT (local) | `ProjectForm` → `/projects/new`, `/projects/:id/edit` |
| 156–162 | Project parts 3–9 | Project detail: Summary, Transactions, Time Activity, Reports, Details, Attachments, tour | BUILT (local) | `ProjectDetail` → `/projects/:id` |

---

## OTHER

| # | File | Screen | Status | Maps to |
|---|------|--------|--------|---------|
| 163–164 | Task parts 1–2 | Add task drawer | BUILT (local) | `AddTaskDrawer` (`?task=new`), listed in Needs attention |
| 165 | `165. Bank deposit.png` | Bank deposit | BUILT | `BankDepositForm` → `/banking/deposit/new` · `POST /banking/receipts` (+ transfer for cash back) |
| 166 | `166. Transfer.png` | Transfer | BUILT | `TransferForm` → `/banking/transfer/new` · `POST /banking/transfers` |
| 167–168 | Journal entry parts 1–2 | Journal entry | BUILT | `JournalEntryForm` → `/accounting/journal-entry/new` · `POST /journals` |
| 169–170 | Inventory adjustment parts 1–2 | Inventory adjustment | BUILT (local) | `InventoryAdjustmentForm` → `/inventory/adjustment/new` |
| 171 | `171. Credit card.png` | Pay down credit card | BUILT | `PayDownCreditCardForm` → `/banking/pay-down-credit-card/new` · `POST /banking/payments` |
| 172 | `172. New chat.png` | AI Assistant panel | BUILT | `AIAssistantPanel` (`?assistant=1`) — rule-based answers, no AI model connected |

**Status key:** BUILT = UI and validation done and visually checked in the browser without a backend running; not yet tested against a live API. "(local)" = no backend endpoint yet, so saved in the browser (`src/lib/txn.ts`). Every saved document is also indexed locally so projects can show tagged transactions.

---

## TEAM

| # | File | Screen | Status | Maps to |
|---|------|--------|--------|---------|
| 181 | `181. Add employee.png` | Employees empty / hero | DONE | `Employees.tsx` + `EmployeesHero` + `AllAppsSidebar` Team |
| 182–185 | Adding employee parts 1–4 | Add employee wizard | DONE | `AddEmployeeDrawer` + Personal/Employment/Payroll/Documents steps |
| 186 | `186. Single time activity.png` | Single time activity | DONE | `SingleTimeActivity.tsx` → `/time/single` |
| 187–188 | Weekly timesheet parts | Weekly timesheet | DONE | `WeeklyTimesheet.tsx` → `/time/weekly` |

### Visual verification (2026-10-19)
- `/employees` hero: Team dock expanded, breadcrumb, copy, bullets, Add/Import CTAs, tips card — matched.
- Add employee wizard steps 1–4: stepper, fields, Cancel/Back/Save draft/Next/Save employee — matched; walked full flow and saved local employee (empty → list).
- `/time/single` and `/time/weekly`: full-page chrome, two-column form / weekly grid, footer actions — matched.
- Regression: `/customers` and `/settings/company` load.

### Remaining minor differences
- Hero illustration is CSS/SVG (not the mock PNG art).
- Primary rail is the existing branded rail (not the thin icon-only mock rail).
- Weekly week label uses “18 Oct – 24 Oct 2026” wording (mock: “18 – 24 Oct 2026”).

---

## REPORTS (mockups 173–195) — DONE

Routes sit under `/reports/*` plus `/budgets`, inside the Shell with the Reports & analytics sidebar (`src/components/reports/kit.tsx`).

| Mock | Screen | Route | Data |
|------|--------|-------|------|
| 173–178 | Standard reports | `/reports/standard` | Links to existing report pages or `/reports/view/:slug`; favourites in local storage |
| 179–180, 185 | Custom reports, report type dialog | `/reports/custom` | Local storage; rows read from the API |
| 181 | Management reports | `/reports/management` | `books/statements`, AR, AP, expenses; custom reports in local storage |
| 182 | KPI scorecard, Create KPI | `/reports/kpis` | `books/kpis`, targets via API; custom KPIs in local storage |
| 183 | Dashboards | `/reports/dashboards` | `books/statements`, `books/kpis`, AR, AP |
| 184 | Spreadsheet sync | `/reports/spreadsheet-sync` | Downloads through report endpoints |
| 186–187 | Performance centre | `/reports/performance` | Monthly figures from the API; layout in local storage |
| 188–189 | Cash flow overview | `/reports/cash-flow` | Banking, AR, AP, statements |
| 190–191 | Cash flow planner | `/reports/cash-flow-planner` | Open documents from the API; planned items in local storage |
| 192 | Budgets | `/budgets` | Existing budgets page |
| 193–195 | Forecasts | `/reports/forecasts` | Actuals from the API; forecasts in local storage; Make this a budget posts to `books/budgets` |

### Known gaps
- 14 catalogue reports show "isn't connected to data yet" in `/reports/view/:slug` because no endpoint supplies them.
- Live Excel, Google Sheets and bank feeds are not connected; Spreadsheet sync downloads files instead.
- Cash-basis KPIs are not available because the ledger reports on an accrual basis.
- The heading of the section holding Purchase List was cut off between mocks 175 and 176 and is labelled "What you owe"; rows may also be missing there.

---

## Last updated
2026-11-05 — REPORTS 173–195 built (`src/pages/reports`)
2026-11-03 — CUSTOMER 107–131, SUPPLIER 147–153, PROJECT 154–162, OTHER 163–172 built (full-page transaction forms in `src/pages/txn`, projects in `src/pages/projects`)
2026-10-19 — TEAM marked DONE after browser visual testing
