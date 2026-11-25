# Functional test results

**90 checks: 55 pass, 22 fail, 3 partial, 10 information only.** Run on a throwaway PostgreSQL database through the real API. Raw log `evidence/run.txt`; script `evidence/audit-scenarios.ts`; rerun with `sh ../docs/accounting-audit/evidence/run.sh` from `Backend`.

Existing tests: 321 of 321 backend tests pass on a separate clean database, 109 of 109 domain tests pass, both projects type-check, all migrations apply with no schema drift. There are no frontend tests.

## Reading the results
- A01–A14 were taken after the normal scenarios; A15–A17 and E-rows include deliberate attempts to break the books.
- Every row lists the journals it created. Audit events per entity are in A13. Balances for inventory, customers and suppliers are in A06–A10.
- E04b, E08, E12b and E20–E22 are design or scale findings rather than crashes.
- A10: the ERP payment in S04 carried no bill reference, so it is unallocated. The ageing should still show it as a credit.
- E11 to E14 that pass mean the attack was refused.

## Business scenarios

### S01 Register business and configure accounting: PASS
- Expected: Company activates with periods, currency, default accounts
- Actual: activated; 91 accounts; 12 periods

### S02a Create a chart of accounts entry (with parent): PASS
- Expected: 201 and account saved
- Actual: 201 6155

### S01b Default tax codes available: PASS
- Expected: VAT18, VAT0, VATEX, VATIN
- Actual: ["VAT18","VATIN","VAT0","VATEX","WHT15","WHT3"]

### S02b Opening balances batch incl. customer balance: FAIL
- Expected: Posted once; equity balances; customer balance appears in AR ageing
- Actual: create 201 approve 200 post 200 (ok); re-post 400; AR control 1200=200000; in ageing=false; open invoices for customer={"rows":[],"total":0,"page":1,"pageSize":50,"totals":{"gross":0,"outstanding":0}}
  - `JOU-2026-000001 2026-01-01 POSTED: Dr 1110 Bank Account 1000000; Dr 1200 Accounts Receivable 200000; Cr 3020 Opening Balance Equity 1200000`

### S02c Customer created with opening balance: PASS
- Expected: Appears in GL, customer balance and ageing
- Actual: 201 in ageing=true
  - `JOU-2026-000002 2026-01-01 POSTED: Dr 1200 Accounts Receivable 50000; Cr 1900 Suspense Account 50000`

### S03 Owner capital into bank 5,000,000: PASS
- Expected: Dr Bank, Cr Equity
- Actual: 201 3000=-5000000 1110=6000000
  - `JOU-2026-000003 2026-01-02 POSTED: Dr 1110 Bank Account 5000000; Cr 3000 Share capital 5000000`

### S03b Owner cash into till 1,000,000: PASS
- Expected: Dr Cash, Cr Equity
- Actual: 201 1100=1000000
  - `JOU-2026-000004 2026-01-02 POSTED: Dr 1100 Cash on Hand 1000000; Cr 3000 Share capital 1000000`

### S04 Buy inventory for cash (ERP stock in + cash bill + payment) 50 x 20,000: PASS
- Expected: Inventory +1,000,000, cash out, AP nil
- Actual: 201 / 201 / 201 / 201 1300=1000000 GRNI=0 AP=0 inputVAT=180000
  - `JOU-2026-000005 2026-01-05 POSTED: Dr 1300 Inventory Asset 1000000; Cr 2130 Goods Received Not Invoiced 1000000`
  - `JOU-2026-000006 2026-01-05 POSTED: Dr 2130 Goods Received Not Invoiced 1000000; Dr 1400 Input Tax Receivable 180000; Cr 2100 Accounts Payable 1180000`
  - `JOU-2026-000007 2026-01-05 POSTED: Dr 2100 Accounts Payable 1180000; Cr 1110 Bank Account 1180000`

### S05 Buy inventory on credit in the app (item receipt then bill) 20 x 22,000 + VAT: PASS
- Expected: Dr Inventory / Cr GRNI, then Dr GRNI + VAT / Cr AP
- Actual: receipt 201 bill 200 gross=519200 1300=1440000 GRNI=0 AP=-519200
  - `JOU-2026-000008 2026-01-06 POSTED: Dr 1300 Inventory Asset 440000; Cr 2130 Goods Received Not Invoiced 440000`
  - `JOU-2026-000009 2026-01-06 POSTED: Dr 2130 Goods Received Not Invoiced 440000; Dr 1400 Input Tax Receivable 79200; Cr 2100 Accounts Payable 519200`

### S06 Partial supplier payment 200,000: PASS
- Expected: Dr AP, Cr Bank; bill outstanding falls
- Actual: 201 paid=200000/519200 AP=-319200
  - `JOU-2026-000010 2026-01-10 POSTED: Dr 2100 Accounts Payable 200000; Cr 1110 Bank Account 200000`

### S07 Cash POS sale 10 bags @30,000 + VAT with COGS: PASS
- Expected: Dr Cash 354,000; Cr Sales 300,000; Cr VAT 54,000; COGS at weighted average 205,714.29
- Actual: sale 201 replay duplicate=true; stock 201 replay duplicate=true; COGS=205714.2857 Sales=-300000 VAT=-54000
  - `JOU-2026-000011 2026-01-12 POSTED: Dr 1100 Cash on Hand 354000; Cr 4100 Sales Revenue 300000; Cr 2200 Output Tax Payable 54000`
  - `JOU-2026-000012 2026-01-12 POSTED: Dr 5100 Cost of Sales 205714.2857; Cr 1300 Inventory Asset 205714.2857`

### S08 Credit sale invoice in the app with lines 500,000 + VAT18: PASS
- Expected: Dr AR 590,000; Cr Sales 500,000; Cr VAT 90,000
- Actual: 201 gross=590000 inventory after=1234285.7143 (app invoices do not move stock: by design, ERP owns stock)
  - `JOU-2026-000013 2026-01-15 POSTED: Dr 1200 Accounts Receivable 590000; Cr 4100 Sales Revenue 500000; Cr 2200 Output Tax Payable 90000`

### S08b Credit POS sale from ERP: PASS
- Expected: Creates AR invoice and AR ledger
- Actual: 201 invoice=S2 gross=118000 AR=958000
  - `JOU-2026-000014 2026-01-16 POSTED: Dr 1200 Accounts Receivable 118000; Cr 4100 Sales Revenue 100000; Cr 2200 Output Tax Payable 18000`

### S09 Partial customer payment 300,000: PASS
- Expected: Dr Bank, Cr AR; invoice outstanding 290,000
- Actual: 201 paid=300000
  - `JOU-2026-000015 2026-01-20 POSTED: Dr 1110 Bank Account 300000; Cr 1200 Accounts Receivable 300000`

### S09b Customer advance (deposit) 100,000, allocated 60,000: PASS
- Expected: Dr Cash Cr Customer Deposits; allocation Dr Deposits Cr AR
- Actual: 201 alloc 200 deposits=-40000
  - `JOU-2026-000016 2026-01-20 POSTED: Dr 1100 Cash on Hand 100000; Cr 2120 Customer Deposits 100000`
  - `JOU-2026-000017 2026-11-24 POSTED: Dr 2120 Customer Deposits 60000; Cr 1200 Accounts Receivable 60000`

### S10 Operating expense: rent 250,000 from bank: PASS
- Expected: Dr Rent Cr Bank
- Actual: 201 status=POSTED 6150=250000
  - `JOU-2026-000018 2026-01-21 POSTED: Dr 6150 Rent or Lease of Buildings 250000; Cr 1110 Bank Account 250000`

### S11 Other income: interest 15,000: PASS
- Expected: Dr Bank Cr Interest Income
- Actual: 201
  - `JOU-2026-000019 2026-01-22 POSTED: Dr 1110 Bank Account 15000; Cr 4200 Interest Income 15000`

### S12a POS sales return 1 bag for cash: PASS
- Expected: Reverses revenue, VAT, cash; stock back and COGS reduced
- Actual: 201 ; stock 201 ; COGS 205714.2857 -> 185142.8571
  - `JOU-2026-000020 2026-01-23 POSTED: Dr 4410 Sales Returns 30000; Dr 2200 Output Tax Payable 5400; Cr 1100 Cash on Hand 35400`
  - `JOU-2026-000021 2026-01-23 POSTED: Dr 1300 Inventory Asset 20571.4286; Cr 5100 Cost of Sales 20571.4286`

### S12b Purchase return 2 bags via supplier credit note: PASS
- Expected: Dr AP; Cr inventory and VAT; stock down
- Actual: 201 inventory 1254857.1429 -> 1213714.2858 AP=-267280
  - `JOU-2026-000022 2026-01-24 POSTED: Dr 2100 Accounts Payable 51920; Cr 1300 Inventory Asset 41142.8571; Cr 5200 Purchases 2857.1429; Cr 1400 Input Tax Receivable 7920`

### S13a Customer credit note 50,000 + VAT on the invoice: PASS
- Expected: Dr Sales returns/Sales + VAT, Cr AR
- Actual: 201 AR=539000 VAT=-147600
  - `JOU-2026-000023 2026-01-25 POSTED: Dr 4410 Sales Returns 50000; Dr 2200 Output Tax Payable 9000; Cr 1200 Accounts Receivable 59000`

### S13b Refund unused customer deposit 40,000: PASS
- Expected: Dr Deposits Cr Cash
- Actual: 200 deposits=0
  - `JOU-2026-000024 2026-11-24 POSTED: Dr 2120 Customer Deposits 40000; Cr 1100 Cash on Hand 40000`

### S13c Cash refund of an open customer credit note: FAIL
- Expected: A refund clears the customer's credit (Dr AR Cr Cash)
- Actual: 400 A customer can only be chosen on money received customer balance after=-10000
  - `JOU-2026-000025 2026-01-25 POSTED: Dr 4410 Sales Returns 10000; Cr 1200 Accounts Receivable 10000`

### S13d Refund receipt as the screen posts it (relatedCustomerId): FAIL
- Expected: Reverses revenue and VAT, or clears the customer's credit
- Actual: 201 customer balance still -10000
  - `JOU-2026-000026 2026-01-26 POSTED: Dr 4410 Sales Returns 10000; Cr 1100 Cash on Hand 10000`

### S14 Transfer 100,000 bank to cash with 1,000 fee: PASS
- Expected: Dr Cash Cr Bank Dr Bank charges
- Actual: 201 charges=1000
  - `JOU-2026-000027 2026-01-26 POSTED: Dr 1100 Cash on Hand 100000; Cr 1110 Bank Account 100000; Dr 6430 Bank Charges 1000; Cr 1110 Bank Account 1000`

### S15 Inventory write-off 2 bags: PASS
- Expected: Dr adjustment, Cr inventory at average cost; stock down
- Actual: 201 inventory 1213714.2858 -> 1172571.4287 writeoff=41142.8571
  - `JOU-2026-000028 2026-01-27 POSTED: Dr 6410 Inventory Write-Off 41142.8571; Cr 1300 Inventory Asset 41142.8571`

### S16 Fixed asset 1,200,000 over 60 months; depreciate January: PASS
- Expected: Capitalise, then Dr depreciation
- Actual: asset 201 dep 201 repeat 400 Depreciation for 2026-01 is already posted expense=20000
  - `JOU-2026-000029 2026-01-03 POSTED: Dr 1500 Fixed Asset Cost 1200000; Cr 1110 Bank Account 1200000`
  - `JOU-2026-000030 2026-01-31 POSTED: Dr 6300 Depreciation Expense 20000; Cr 1510 Accumulated Depreciation 20000`

### S17 Import bank statement and reconcile January: PASS
- Expected: Difference reaches 0 and completes; GL untouched
- Actual: import 201 ; re-import 400 Every line in this file is already imported or falls in a reconciled period; start 201 review 200 approve 200 complete 200 unmatched=0

### S18 Generate reports/exports: PASS
- Expected: 200 for each
- Actual: 17 endpoints 200

### S19 Close January: PASS
- Expected: Checklist enforced then CLOSED
- Actual: first attempt 400 VAT return prepared: No VAT return prepared for the period ending 2026-01-31; blockers=["VAT return prepared: No VAT return prepared for the period ending 2026-01-31"] override TAX_FILING 201;[] then 200 status=CLOSED

### S20 Modify transactions in the closed period: PASS
- Expected: All refused
- Actual: journal 400 "Accounting period P1 is closed"; invoice 400 "Accounting period P1 is closed"; receipt 400 "Accounting period P1 is closed"; bill 400 "Accounting period P1 is closed"; bank payment 400 "Accounting period P1 is closed"; adjustment 400 "Accounting period P1 is closed"; expense 400 "Accounting period P1 is closed"; bank reversal dated in period 400 "A reversal can't be dated before the transaction"; ERP event 201 error="Accounting period P1 is closed" open exceptions=1; GL rows in period 68->68

### S20b Reverse a closed-period manual journal / void closed-period invoice: PARTIAL
- Expected: Original untouched; reversal dated in an open period
- Actual: invoice dated 2026-02-02 (open period), void 200; reversal dated 2026-11-24 (today, no choice of date) so February still shows the sale
  - `JOU-2026-000031 2026-02-02 POSTED: Dr 1200 Accounts Receivable 1000; Cr 4100 Sales Revenue 1000`
  - `JOU-2026-000032 2026-11-24 POSTED: Cr 1200 Accounts Receivable 1000; Dr 4100 Sales Revenue 1000`

## Accuracy checks

### A01 Every posted journal balances in the GL: PASS
- Expected: 0 unbalanced
- Actual: 0 unbalanced of 30

### A02 Trial balance: PASS
- Expected: difference 0
- Actual: debit 8702737.1429 credit 8702737.1429 diff 0

### A03 Assets = liabilities + equity: PASS
- Expected: equal
- Actual: 8035451.4287 = 514880 + 7520571.4287

### A04 Net profit reflected in equity: PASS
- Expected: current year earnings = profit
- Actual: profit 320571.4287; CYE 320571.4287

### A05 Cash flow reconciles with cash accounts: PASS
- Expected: net change = cash movement
- Actual: {"operating":-1107400,"investing":-1200000,"financing":7200000,"netChange":4892600,"cashChange":4892600,"depreciation":20000,"profit":320571.4287}

### A06 Inventory subledger = GL 1300: INFO
- Expected: equal
- Actual: GL 1300=1172571.4287; sub={"value":"1172571.4287"}; report={"accounts":[{"id":"cmwv43on50059sr87x1a6cedg","code":"1300","name":"Inventory Asset"}],"accountsDiffer":false,"glValue":1172571.4287,"subledgerValue":1172571.4287,"difference":0,"explained":{"unpostedMovements":{"count":0,"value":0},"saleCostDifference":0},"c

### A07 AR control = customer balances: PASS
- Expected: equal
- Actual: GL 529000 vs customers 529000

### A08 AP control = supplier balances: PASS
- Expected: equal
- Actual: GL 267280 vs suppliers 267280

### A09 AR ageing total = AR control: FAIL
- Expected: equal
- Actual: ageing 339000 control 529000

### A10 AP ageing total = AP control: FAIL
- Expected: equal
- Actual: ageing 1447280 control 267280

### A11 VAT report = VAT ledger (output 2200, input 1400): INFO
- Expected: equal
- Actual: GL output 147600 input 251280; report {"from":"2026-01-01T00:00:00.000Z","to":"2026-01-31T23:59:59.999Z","outputAccount":{"id":"cmwv43on70061sr873dglqgjk","code":"2200","name":"Output Tax Payable"},"inputAccount":{"id":"cmwv43on5005asr87p76uuizd","code":"1400","name":"Input Tax Receivable"},"totals":{"output":147600,"input":251280,"adjustments":0,"paid":0,"net":-103680,"outstanding":-103680,"zeroRatedSales":0,"zeroRatedPurchases":0,"exemptSales":0,"exemptPurchases":0},"outputLines":[{"id":"cmwv43q9e00zwsr876otb1pqd","date":"2026-01-12T09:00:00.000Z","journalId":"cmwv43q8w00zksr87bcploop7","journalNumber":"JOU-2026-000011","description":"Output VAT","sourceModule":"POS","sourceDocumentNumber"

### A11b Tax reconciliation report: INFO
- Expected: explains differences
- Actual: {"from":"2026-01-01T00:00:00.000Z","to":"2026-01-31T23:59:59.999Z","vat":{"ledger":-103680,"gl":-103680,"ledgerVsGl":0,"filed":null,"ledgerVsFiled":null,"ebm":null,"ledgerVsEbm":null},"withholding":{"ledger":0,"gl":0,"difference":0},"fiscalDocuments":0}

### A12 Built-in integrity scan after scenarios: INFO
- Expected: no findings
- Actual: 200 {"id":"cmwv43sc20213sr8766n980qr","trigger":"MANUAL","runByErpUserId":441,"ranAt":"2026-11-24T19:53:11.474Z","findingCount":0,"errors":0,"checks":[{"check":"AR_SUBLEDGER","label":"Receivables ledger vs GL","count":0},{"check":"AP_SUBLEDGER","label":"Payables ledger vs GL","count":0},{"check":"INVENTORY_SUBLEDGER","label":"Inventory valuation vs GL","count":0},{"check":"DOCUMENT_WITHOUT_GL","label":"Documents without a posted journal","count":0},{"check":"UNBALANCED_JOURNAL","label":"Unbalanced or mismatched journals","count":0},{"check":"JOURNAL_NUMBER_GAP","label":"Journal number gaps","count":0},{"check":"NEGATIVE_CASH","label":"Negative cash and bank balances","count":0}],"findings":[

### A13 Audit events written: PASS
- Expected: >0 for each posting
- Actual: ["Account.CREATE=1","AccountingActivation.ACTIVATE=1","AccountingPolicy.CREATE=1","ApBill.POST=1","ApCreditNote.POST=1","ApPayment.POST=1","ApprovalPostingControls.CREATE=1","ArInvoice.POST=1","BankingPaymentSettings.CREATE=1","BankReconciliation.APPROVE=1","BankReconciliation.COMPLETE=1","BankReconciliation.CREATE=1","BankReconciliation.REVIEW=1","BankStatement.IMPORT=1","BankTransaction.POST=5","BusinessAccountingInfo.CREATE=1","CompanyProfile.CREATE=1","CurrencySettings.CREATE=1","Customer.CREATE=4","DefaultPostingAccounts.UPDATE=1","Expense.CREATE=1","Expense.POST=1","FinancialAccount.AUTO_MATCH=1","FinancialAccount.CREATE=2","FinancialYear.CREATE=1","FixedAsset.CAPITALIZE=1","FixedAsset

### A14 Own audit event for receipts/payments/deposits/credit notes: FAIL
- Expected: present
- Actual: ArReceipt=false ApPayment=true ArDeposit=false ArCreditNote=false

### A15 Integrity scan after edge cases: INFO
- Expected: only deliberate findings
- Actual: {"id":"cmwv44p752b1rsr87inssilz1","trigger":"MANUAL","runByErpUserId":441,"ranAt":"2026-11-24T19:53:54.066Z","findingCount":3,"errors":2,"checks":[{"check":"AR_SUBLEDGER","label":"Receivables ledger vs GL","count":1},{"check":"AP_SUBLEDGER","label":"Payables ledger vs GL","count":1},{"check":"INVENTORY_SUBLEDGER","label":"Inventory valuation vs GL","count":1},{"check":"DOCUMENT_WITHOUT_GL","label":"Documents without a posted journal","count":0},{"check":"UNBALANCED_JOURNAL","label":"Unbalanced or mismatched journals","count":0},{"check":"JOURNAL_NUMBER_GAP","label":"Journal number gaps","count":0},{"check":"NEGATIVE_CASH","label":"Negative cash and bank balances","count":0}],"findings":[{"ch

### A16 Final: balance sheet and cash flow: PASS
- Expected: balanced
- Actual: A 8252017.7043 L 420378 E 7831639.7043; CF 6174316 vs 6174316

### A17 Final: AR and AP control vs subledger: FAIL
- Expected: equal
- Actual: AR 1938115.99 vs 539105.99; AP 267770 vs 267780

## Reliability, security and edge cases

### E01 Same invoice submitted twice (double click): FAIL
- Expected: One invoice
- Actual: 201,201 -> 2 invoices posted
  - `JOU-2026-000033 2026-02-03 POSTED: Dr 1200 Accounts Receivable 7777; Cr 4100 Sales Revenue 7777`
  - `JOU-2026-000034 2026-02-03 POSTED: Dr 1200 Accounts Receivable 7777; Cr 4100 Sales Revenue 7777`

### E01b Same request with an Idempotency-Key header: FAIL
- Expected: One record
- Actual: 2 receipts
  - `JOU-2026-000035 2026-02-03 POSTED: Dr 1100 Cash on Hand 3333; Cr 1200 Accounts Receivable 3333`
  - `JOU-2026-000036 2026-02-03 POSTED: Dr 1100 Cash on Hand 3333; Cr 1200 Accounts Receivable 3333`

### E01c Same supplier invoice number entered twice: PASS
- Expected: Second refused
- Actual: 201 then 400 Supplier invoice DUP-1 is already recorded as BILL-2026-000003
  - `JOU-2026-000037 2026-02-03 POSTED: Dr 5200 Purchases 500; Cr 2100 Accounts Payable 500`

### E02 Invalid amounts: PASS
- Expected: All 400
- Actual: 400 [ { "code": "too_small", "minimum": 0, "type": "number", "inclusive": fa / 400 [ { "code": "too_small", "minimum": 0, "type": "number", "inclusive": fa / 400 [ { "code": "too_small", "minimum": 0, "type": "number", "inclusive": fa / 400 Invalid `prisma.arInvoice.create()` invocation in /Users/apple/Desktop/exceledge-accaunti / 400 [ { "code": "too_small", "minimum": 0, "type": "number", "inclusive": fa / 400 Unbalanced journal: debit=10 credit=9 / 400 Invoice total must be positive / 400 Credit limit exceeded

### E02b Typed VAT that does not match any rate (net 100, tax 5,000): FAIL
- Expected: Refused or warned
- Actual: 201 accepted
  - `JOU-2026-000038 2026-02-03 POSTED: Dr 1200 Accounts Receivable 5100; Cr 4100 Sales Revenue 100; Cr 2200 Output Tax Payable 5000`

### E03 Missing account mapping: PASS
- Expected: Refused with clear message, nothing left
- Actual: 400 Accounts receivable account is not configured; invoices 8->8

### E04 Insufficient stock adjustment -10,000: PASS
- Expected: Refused under default policy
- Actual: 400 Only 57 of Rice 25kg is in stock at that location qty=57

### E04b ERP oversell (POS sale beyond stock): INFO
- Expected: Posted with flag, or exception
- Actual: 201 posted qty=-3 value=-61714.2857
  - `JOU-2026-000039 2026-02-04 POSTED: Dr 5100 Cost of Sales 1234285.7144; Cr 1300 Inventory Asset 1234285.7144`

### E05 Overpayment of invoice allocation: PASS
- Expected: Refused
- Actual: over-allocate 400 Allocation exceeds invoice outstanding balance; unallocated receipt 201 unallocated=5000; outstanding 171000
  - `JOU-2026-000040 2026-02-04 POSTED: Dr 1100 Cash on Hand 5000; Cr 1200 Accounts Receivable 5000`

### E06 20 concurrent full payments of one invoice: PASS
- Expected: Exactly one succeeds
- Actual: 1 succeeded, rows=1; errors=400 Invoice INV-2026-000007 was settled by another transaction at the same time; refresh and try again / 400 Allocation exceeds invoice outstanding balance
  - `JOU-2026-000041 2026-02-05 POSTED: Dr 1200 Accounts Receivable 10000; Cr 4100 Sales Revenue 10000`
  - `JOU-2026-000042 2026-02-05 POSTED: Dr 1100 Cash on Hand 10000; Cr 1200 Accounts Receivable 10000`

### E07 30 concurrent different journals; numbering and balances: PASS
- Expected: 30 unique numbers, TB balanced
- Actual: 30/30 posted, 30 unique; errors=
  - `JOU-2026-000043 2026-02-06 POSTED: Dr 6140 Office/General Administrative Expenses 100; Cr 3030 Owner's Equity 100`
  - `JOU-2026-000044 2026-02-06 POSTED: Dr 6140 Office/General Administrative Expenses 100; Cr 3030 Owner's Equity 100`
  - `JOU-2026-000045 2026-02-06 POSTED: Dr 6140 Office/General Administrative Expenses 100; Cr 3030 Owner's Equity 100`
  - `JOU-2026-000046 2026-02-06 POSTED: Dr 6140 Office/General Administrative Expenses 100; Cr 3030 Owner's Equity 100`
  - `JOU-2026-000047 2026-02-06 POSTED: Dr 6140 Office/General Administrative Expenses 100; Cr 3030 Owner's Equity 100`
  - `JOU-2026-000048 2026-02-06 POSTED: Dr 6140 Office/General Administrative Expenses 100; Cr 3030 Owner's Equity 100`
  - `JOU-2026-000049 2026-02-06 POSTED: Dr 6140 Office/General Administrative Expenses 100; Cr 3030 Owner's Equity 100`
  - `JOU-2026-000050 2026-02-06 POSTED: Dr 6140 Office/General Administrative Expenses 100; Cr 3030 Owner's Equity 100`
  - and 22 more

### E07b Cached account balance = GL after all: PASS
- Expected: equal for every account
- Actual: 0 differ

### E08 Month-end and local-midnight ERP sale (UTC vs Kigali): FAIL
- Expected: Sale at 1 Mar 00:30 Kigali books in March
- Actual: 201; journalDate 2026-02-28T22:30:00.000Z; Feb revenue 26754; March revenue 0
  - `JOU-2026-000073 2026-02-28 POSTED: Dr 1100 Cash on Hand 100; Cr 4100 Sales Revenue 100`

### E09 Future-dated invoice beyond the financial year: PASS
- Expected: Refused with message
- Actual: 400 No accounting period covers the journal date

### E10 Failure mid-posting leaves nothing (inactive account): PASS
- Expected: Rollback
- Actual: 400 Account 4100 is inactive; [invoices,journals] 10,73 -> 10,73

### E11 Unauthorised access: PASS
- Expected: 401/403
- Actual: 401,403,403,401

### E12 Cross-business access to every id type: PASS
- Expected: 404/400, no data
- Actual: 13 reads and 5 writes refused

### E12b Integration key scope: FAIL
- Expected: Key bound to one business
- Actual: the one shared key posted into a second business: 201 status=POSTED

### E13 Token for a new organisation auto-creates a company: INFO
- Expected: Only provisioned businesses
- Actual: companies 2->3 (requires a valid ERP-signed token)

### E14 Void / reverse restores balances: PASS
- Expected: Net effect zero
- Actual: 200, again 400; AR 537988->537988; Sales -925754->-925754
  - `JOU-2026-000074 2026-02-10 POSTED: Dr 1200 Accounts Receivable 4321; Cr 4100 Sales Revenue 4321`
  - `JOU-2026-000075 2026-11-24 POSTED: Cr 1200 Accounts Receivable 4321; Dr 4100 Sales Revenue 4321`

### E15 Edit a posted invoice: PARTIAL
- Expected: Controlled edit (QBO allows edit with audit)
- Actual: PUT 404 PATCH 404: no edit endpoint; void and re-enter only

### E16 Delete of posted journal through API / database: PARTIAL
- Expected: No API; DB should also prevent
- Actual: API 404; direct UPDATE gl_entries ALLOWED; direct UPDATE audit_events blocked

### E17 Cash-basis policy: FAIL
- Expected: Reports recomputed on cash basis
- Actual: note says "Cash basis, IFRS SME framework. Amounts are in RWF." but profit cash=-886139.2857 accrual=-886139.2857

### E17b Setting cash basis via setup API: INFO
- Expected: Refused or applied
- Actual: 200 accepted

### E18 Disposal gain in cash flow: FAIL
- Expected: Proceeds 900,000 under investing; gain not in operating
- Actual: 200 cashflow {"operating":120000,"investing":1180000,"financing":0,"netChange":1300000,"cashChange":1300000,"depreciation":0,"profit":120000} (expected investing 1,300,000, operating 0)
  - `JOU-2026-000076 2026-04-15 POSTED: Dr 1510 Accumulated Depreciation 20000; Cr 1500 Fixed Asset Cost 1200000; Dr 1110 Bank Account 1300000; Cr 7300 Gain on Disposal 120000`

### E19 Rounding: 3 lines of 33.33 x VAT18 and RWF amounts: PASS
- Expected: Header equals sum of lines, GL balances
- Actual: net 99.99 tax 18 gross 117.99 (RWF has no minor unit; fractional RWF accepted)
  - `JOU-2026-000077 2026-02-12 POSTED: Dr 1200 Accounts Receivable 117.99; Cr 4100 Sales Revenue 99.99; Cr 2200 Output Tax Payable 18`

### E20 VAT-inclusive pricing: FAIL
- Expected: Supported
- Actual: line fields: id,invoiceId,lineNumber,description,quantity,unitPrice,discount,net,taxCode,taxRate,tax,accountId; no inclusive flag in the API or schema

### E21 Bad debt write-off of an invoice: FAIL
- Expected: Dr bad debt, Cr AR
- Actual: write-off endpoint 404; manual journal to AR 400 "Account 1200 is the receivables control account; post through the receivables module so its subledger stays in step"; only workaround is a credit note (posts to sales returns, not bad debt)

### E22 Reports with 100,000 GL rows: FAIL
- Expected: Statements and TB < 2s
- Actual: 100,000 rows: statements 326ms, TB 19128ms, ledger page 111ms (synthetic rows, local database)

### E23 Draft journal in AR account / inventory manual posting blocked: PASS
- Expected: 400
- Actual: 400 Account 1300 is the inventory control account; post through the inventory module so its subledger stays in step

### E23b Bank receipt/payment coded straight to AR, AP or inventory control: FAIL
- Expected: Refused
- Actual: 1200:400 1200 Accounts Receivable is a receivables control account; choose the customer s / 2100:400 2100 Accounts Payable is a payables control account; choose the supplier so thei / 1300:201 ACCEPTED / 2200:201 ACCEPTED
  - `JOU-2026-000078 2026-02-20 POSTED: Dr 1300 Inventory Asset 10; Cr 1110 Bank Account 10`
  - `JOU-2026-000079 2026-02-20 POSTED: Dr 2200 Output Tax Payable 10; Cr 1110 Bank Account 10`

### E23c Expense coded to AR/AP/inventory control: FAIL
- Expected: Refused
- Actual: 1200:201 ACCEPTED / 2100:201 ACCEPTED / 1300:201 ACCEPTED
  - `JOU-2026-000080 2026-02-20 POSTED: Dr 1200 Accounts Receivable 10; Cr 1110 Bank Account 10`
  - `JOU-2026-000081 2026-02-20 POSTED: Dr 2100 Accounts Payable 10; Cr 1110 Bank Account 10`
  - `JOU-2026-000082 2026-02-20 POSTED: Dr 1300 Inventory Asset 10; Cr 1110 Bank Account 10`

### E23d Invoice/bill line coded to control accounts: PASS
- Expected: Refused
- Actual: 1200: invoice 400 Account 1200 is the receivables control account and can't be, bill 400 Account 1200 is the receivables control account and can't be / 2100: invoice 400 Account 2100 is the payables control account and can't be us, bill 400 Account 2100 is the payables control account and can't be us / 1300: invoice 400 Account 1300 is the inventory control account and can't be u, bill 400 Account 1300 is the inventory control account and can't be u

### E24 Approvals default: creator posts own large journal: PASS
- Expected: Default controls require another person
- Actual: 400 Journal JOU-2026-000083 needs approval before posting (1 approval level(s) for 10); submit it for approval

### E25 Reverse and unlock: reopen closed period then audit: PASS
- Expected: Reason needed; logged
- Actual: 200 ; audit events on period=3

### E26 Ageing as of a past date (31 Jan) ignores later invoices and payments: FAIL
- Expected: As-of total equals AR control at 31 Jan
- Actual: ageing at 31 Jan 359771.99; control at 31 Jan 589000; 6 invoices dated after 31 Jan exist

### E27 Ageing with a USD customer: FAIL
- Expected: Converted to RWF (or kept apart by currency)
- Actual: rate 201 cust 201 inv 201 ; GL AR rose 1400000 RWF; ageing total rose 1000; dashboard {"totalCustomers":7,"activeCustomers":7,"cashCustomers":1,"creditCustomers":6,"totalOutstanding":360771.99,"totalDeposits":0,"overdueInvoices":8,"creditUtilization":0.0078,"ageing":[{"key":"CURRENT","label":"Current","am
  - `JOU-2026-000083 2026-02-10 POSTED: Dr 1200 Accounts Receivable 1400000; Cr 4100 Sales Revenue 1400000`

### E28 Year-end: profit to retained earnings; P&L unaffected: INFO
- Expected: covered
- Actual: covered by tests/wave-c-closing.test.ts (passed)

### E29 Post to a FUTURE period (2026-12-15): INFO
- Expected: Follows future-date policy
- Actual: 400 Accounting period P12 is future

### E30 Error messages do not leak internals: FAIL
- Expected: Friendly text
- Actual: Invalid `prisma.arInvoice.create()` invocation in /Users/apple/Desktop/exceledge-accaunting/.claude/worktrees/quickbooks-integration-approach-c6580c/Backend/sr

### E31 Formula/script text in names: PASS
- Expected: Stored as text; CSV export neutralised
- Actual: 06,'=HYPERLINK(1),

## Screens checked in the browser (audit database)
| Screen | Result |
|---|---|
| Home dashboard | FAIL: income 12,850,000, customers "Alpha Ltd", dated 2024; the books held 2,360,854 revenue. Only the activity table says "Sample data" |
| Backup and restore | FAIL: lists four "Success" backups; code creates none |
| Credit note | FAIL: no tax column, no invoice link |
| Receivables ageing | FAIL: USD 1,000 shown as RWF 1,000; "{cfg.detailLabel}" printed |
| Financial statements | PASS: agree with the API |
| Budgets landing | Loads; the new editor was read in code, not saved in the browser |

Other screens were reviewed in code, not clicked.

## Not tested
Killing the database or network mid-request (only refusals inside a transaction); live email, EBM, mobile money, object storage and ERP; restore of a real backup; sustained load; screen-reader and mobile use; year-end close in the new harness (covered by the existing suite); a full UI pass per role.
