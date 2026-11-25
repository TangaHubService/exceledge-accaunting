# Accounting system audit

## Architecture
React/Vite frontend; Express, Prisma and PostgreSQL backend; ERP-signed JWT sign-in; 34 migrations with no drift. All accounting flows call `createAndPostJournal` in `journals/journal.service.ts`, which checks activation, balance, period (row-locked), account rules, approvals and budget, then writes `gl_entries` in one transaction. Statements read `gl_entries`.

## How the main flows work
| Flow | Path | Finding |
|---|---|---|
| ERP sale | event, idempotency key, posting rule, journal, AR | Sound; UTC day (F-12) |
| ERP stock | event, stock ledger, COGS journal | Sound; negative stock silent (F-23) |
| App invoice | form, `/ar/invoices`, journal, AR ledger | Sound with lines; no stock effect by agreement |
| Credit note | form, `/ar/credit-notes` | API right, screen drops VAT (F-02) |
| Refund | form, `/banking/payments` | Does not clear a credit or reverse VAT (F-02) |
| Purchase | receipt, GRNI, bill, AP | Sound; GRNI nets to zero |
| Expense | `/expenses` | Control accounts accepted (F-05) |
| Bank | import, match, record, reconcile | Sound |
| Close | checklist, override, close, reopen | Sound; slow through trial balance (F-10) |
| Home dashboard | constants in `dashboard-dummy.ts` | Not connected (F-01) |

## Transactions that bypass or break the subledger
- No code path was found that writes `gl_entries` without a journal, or changes a ledger balance outside it, except account merge (`coa.service.ts:756`), which moves existing entries to another account. Any immutability trigger (F-17) must allow for it.
- Expenses can post to AR, AP and inventory control accounts; bank payments can post to inventory (E23b, E23c). Each leaves the subledger behind.
- Foreign-currency AR and AP subledgers hold document currency while the ledger holds RWF.
- `gl_entries` can be altered directly in SQL (E16). `audit_events` cannot.

## Disconnected
Home dashboard, notification badge, new budget editor, backup, workflows page, import hub, export data, attachments workspace, custom fields, form styles, and most settings switches. Their backends often exist: budgets, documents, workflows, notifications.

## Duplicated
- Two budget editors: the new one fakes, the classic one saves.
- Two journal entry screens (`/journals/new`, `/accounting/journal-entry/new`).
- Revenue recognition opens Journals; Prepaid expenses opens Expenses; My accountant opens Setup; Integration transactions opens Bank transactions.
- Three recurring systems: journals, expenses, templates.
- Opening balances by batch and by party, posting to different equity or suspense accounts.

## Hardcoded rules
Payroll account codes 2310, 2320, 6120; Retained Earnings fallback 3100; cash detection by 11xx code; GRNI journals fixed to RWF. All work with the default chart but not with a renumbered one.

## Modules
Status of every feature is in QUICKBOOKS_COMPARISON_MATRIX.md, with proof in FUNCTIONAL_TEST_RESULTS.md.
