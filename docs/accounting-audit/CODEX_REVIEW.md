# Codex review, round 1, 25 November 2026

Codex 0.172.0, gpt-6-luna, read-only, on 680bb3c against main. It ran no tests. Every finding was reproduced with a failing test before the fix (`Backend/tests/codex-review.test.ts`), except the un-apply race, whose test was added with its fix.

| Finding | From | Rated | Outcome |
|---|---|---|---|
| Reversing a receipt while it is being refunded posts cash out twice | Codex P0 | P0 | Fixed: the receipt is locked, then read |
| Saved answers replayed after access is revoked | Codex P0 | P1: only the sender's own earlier answer | Fixed: 403 when access changed |
| Ageing before a reversal uses the wrong bucket (totals were right) | Codex P1 | P1 | Fixed for receipts, write-offs and supplier payments |
| New API keys and webhook secrets kept in plain text in saved answers | Claude, while checking | P0 | Fixed: those answers are never saved, and existing ones are deleted by the migration |
| Applying a payment while it is being reversed leaves the invoice or bill paid | Claude | P0 | Fixed on both sides |
| Un-applying while reversing could reduce the invoice twice | Claude | P0 | Fixed on both sides; tested for receipts |

# Review of feat/quickbooks-gaps, 25 November 2026

| Finding | Outcome |
|---|---|
| P1: an ERP credit sale returned before payment makes cash-basis income negative | Rejected with a test: it nets to zero. Checking it found that refunding a paid ERP sale moved the sale into the refund month, in cash basis and in past ageing; fixed |
| P2: a reminder interrupted by a crash is never sent | Part accepted: a send that failed is retried. One interrupted half-way is not, because it may have gone out |

# Review of the second batch, 25 November 2026

Codex gpt-6-luna, read-only, one round.

| Finding | Outcome |
|---|---|
| Importing the same open invoices twice at once doubles the receivable | Fixed: the number is locked first. Test failed before (150 instead of 50) |
| Workflow amounts ignored the exchange rate | Fixed: compared in the company's currency. Test failed before |
| Claude: backup errors with server paths were shown to every company's administrators | Fixed: kept in the server log. Test failed before |
| Claude: dump files were readable by other users of the server | Fixed: owner only |

# Review of foreign-currency documents, 25 November 2026

Codex gpt-6-luna, read-only, one round.

| Finding | Outcome |
|---|---|
| P1: reversing a foreign payment paid at another rate reversed only the foreign number (in main before this) | Fixed for supplier payments and customer receipts: the settlement's own journal is reversed. Test failed before |
| P2: debit notes accepted more tax than any rate | Fixed on both sides. Test failed before |
| Claude: reversing a functional journal that carries foreign amounts used the foreign amounts | Fixed in `linesInJournalCurrency`. Test failed before |
| Claude, in the browser: a foreign customer's page and forms showed the company currency, and Pay Bills added currencies together | Fixed |
| Claude, in the browser: category lines on bills, supplier credits and purchase orders had no tax | Fixed: a Tax column, with prices including tax |
