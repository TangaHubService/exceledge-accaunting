# PHASE 4 — Requirements Checklist

**Documentation:** Segment 4 — Customers & Accounts Receivable  
**Builds on:** Phase 3 journals, GL, and default posting accounts

## Checklist

- [x] Customer master (commercial + financial profile, types, credit limit/period/status)
- [x] Sales invoices posted to AR, revenue, and output VAT
- [x] Receipts with allocation, partial payment, and reversal
- [x] Credit notes and debit notes
- [x] Customer deposits: record, allocate, refund
- [x] Customer subsidiary ledger and outstanding/full statement
- [x] Receivables ageing (current through over 120 days)
- [x] Credit-limit block on credit customers
- [x] POS `SALE_COMPLETED` mirrored onto the AR subledger without a second journal
- [x] Dashboard counts, outstanding, deposits, overdue, ageing
- [x] Capabilities: `ar:view`, `ar:manage`, `ar:credit-override`
- [x] Audit on customer create/update and invoice post
- [x] Web receivables tab
- [x] Automated tests

**PHASE STATUS: COMPLETE for the Segment 4 books core**

Statements are JSON (print/PDF/email stay with later document delivery). Inventory relief on credit notes stays with the ERP sales-return event already posted in Phase 3.
