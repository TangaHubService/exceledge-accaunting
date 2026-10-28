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

## Last updated
2026-10-19 — TEAM marked DONE after browser visual testing
