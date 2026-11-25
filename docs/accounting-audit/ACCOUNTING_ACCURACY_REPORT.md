# Accounting accuracy report

| Requirement | Result | Evidence |
|---|---|---|
| Journals balance | Yes: 0 unbalanced of 30 in normal scenarios | A01 |
| Assets = liabilities + equity | Yes: 8,035,451.4287 = 514,880 + 7,520,571.4287 | A03, A16 |
| Trial balance | Yes: 8,702,737.1429 both sides | A02 |
| Profit in equity | Yes: 320,571.4287 | A04 |
| Cash flow equals cash movement | Yes in total: 4,892,600. Sections can be wrong | A05, E18 |
| Inventory = GL | Yes: 1,172,571.4287 | A06 |
| AR control = customer balances | Yes in RWF: 529,000. **No** with USD (1,938,115.99 vs 539,105.99, of which 10 is E23c) | A07, A17, E27 |
| AP control = supplier balances | Yes: 267,280. **No** after an expense coded to AP | A08, A17 |
| AR ageing = control | **No**: 339,000 vs 529,000 | A09 |
| AP ageing = control | **No**: 1,447,280 vs 267,280 | A10 |
| VAT report = VAT accounts | Yes: 147,600 and 251,280. But what is posted is wrong when a credit note is entered on screen | A11, F-02 |
| Void and reversal restore balances | Yes in total; month can be wrong | E14, S20b |
| Duplicate requests | ERP events safe; **user requests post twice** | S07, E01, E01b |
| Failed transactions leave nothing | Yes | E03, E10 |
| Rounding | Balanced; 4 decimals stored, fractional RWF allowed | E19 |

## Explained differences
- AR 190,000 gap = batch opening customer balance 200,000 missing from ageing, less the 10,000 unapplied credit ignored.
- AP 1,180,000 gap = one ERP payment without a bill reference. It was unallocated by the test; the ageing should still net it as a credit.
- AR control vs subledger with USD: 1,399,000 is 1,000 x (1,400 - 1), plus 10 from E23c.

## Errors that misstate financial statements
1. **Credit notes and refunds on screen.** A credit of 118,000 for a VAT-inclusive sale posts 118,000 to Sales Returns and nothing to VAT. Revenue is understated by 18,000 and VAT payable overstated by 18,000. Found in code and on screen; the API with explicit tax is correct (S13a).
2. **Refunding a customer credit.** Credit note 10,000 plus refund 10,000 reduces revenue by 20,000 and leaves the customer at -10,000 (S13d).
3. **Wrong period.** Voids, deposit allocations and refunds date today; ERP sales after midnight in Kigali date the day before (S20b, E08).
4. **Cash basis.** The note says "Cash basis" while profit is the accrual figure, -886,139.2857 both ways in that test (E17).
5. **Cash flow.** Sale of an asset for 1,300,000 shows 120,000 operating and 1,180,000 investing; it should be 0 and 1,300,000 (E18).
6. **Duplicates.** Two identical invoices or receipts post twice (E01).

Period amounts other than these reconciled.
