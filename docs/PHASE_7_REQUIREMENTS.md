# PHASE 7 — Requirements Checklist

**Documentation:** Segment 6 — Banking & Cash Management; Segment 7 — Bank Reconciliation  
**Builds on:** Phase 3 journals and GL; Phase 4/5 receipts and payments; setup default cash, bank, petty cash, mobile money, bank charges and interest accounts

## Design

- A **financial account** (bank, cash, petty cash, mobile money) is a register entry linked to exactly one asset GL account. Its balance and cashbook are read from the GL, so money posted by any module (Excel Edge sales and payments, customer receipts, supplier payments, banking transactions, manual journals) appears in it automatically.
- Banking transactions (money received, payments, transfers, deposits, withdrawals, bank charges, interest, cash counts) post balanced journals through the journal service and can be reversed, never deleted.
- Customer receipts and supplier payments can name the financial account the money went into or came out of. Without one they keep using the default account for the payment method.
- Reconciliation compares GL entries on the linked account with imported statement lines. A match groups statement lines and GL entries whose totals agree.

## Checklist

- [x] Financial account register: name, kind, account number, bank, branch, SWIFT, provider (MTN MoMo, Airtel Money, other), currency, GL account, opening balance, date opened, status, overdraft allowed, custodian — 6.5, 6.6, 6.7
- [x] New GL account created for a financial account when none is chosen; an existing asset account can be linked once — 6.5
- [x] Opening balance posted against the opening balance (suspense) account — 6.5
- [x] Receive money from non-customer sources with one or more credit lines — 6.8
- [x] Make payment to any payee with one or more debit lines (expense, tax, other accounts chosen by the user) — 6.9
- [x] Deposits (cash to bank), withdrawals (bank to cash), and transfers between any two financial accounts, with an optional fee — 6.10, 6.11, 6.12
- [x] Petty cash: float account, replenishment (transfer), expenses (payment), cash count with over/short posting — 6.13
- [x] Cashbook per account: opening, receipts, payments, running and closing balance, drill-down to the journal — 6.14
- [x] Bank charges and interest recorded to the default accounts — 6.15
- [x] Validation: account exists and is active, funds available when overdraft is not allowed, period open, reference unique per account, amounts positive — 6.16
- [x] Reversal with reason and date; audit on every action — 6.17
- [x] Banking dashboard: available cash by kind, received and paid today, pending deposits (undeposited funds), 30-day cash flow, accounts, recent transactions, quick actions — 6.4
- [x] Statement import: CSV, OFX, QIF, CAMT.053; validation and duplicate detection — 7.5
- [x] Automatic matching on amount, date and references (journal, document, cheque numbers) — 7.6
- [x] Manual matching with difference shown and suggested matches — 7.7
- [x] Outstanding payments (including cheques) and deposits in transit with days outstanding, carried forward — 7.8, 7.9
- [x] Record charges, interest and other bank-only items from a statement line — 7.10
- [x] Reversed receipts and payments can be matched against their originals — 7.11
- [x] Reconciliation summary; completion only at zero difference with every statement line accounted for — 7.12
- [x] Draft → Reviewed → Approved → Completed, following the company approval workflow setting — 7.13
- [x] History and printable reconciliation report — 7.14, 7.18
- [x] Capabilities: `bank:view`, `bank:manage`, `bank:approve`
- [x] Web: banking dashboard, account and cashbook, transactions, reconciliation list and workspace, cash position report
- [x] Automated tests (domain parsing, matching, lines; API end to end)

**PHASE STATUS: COMPLETE for the Segment 6 and 7 books core**

Customer invoice receipts and supplier bill payments stay in Receivables and Payables; they can name the financial account the money went into or came out of. Native Excel (`.xlsx`) files are not parsed — export as CSV from Excel. Statement attachments and a formal petty-cash close pack stay with document delivery (Phase 17).
