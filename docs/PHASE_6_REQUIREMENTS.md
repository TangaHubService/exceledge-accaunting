# PHASE 6 — Requirements Checklist

**Documentation:** Segment 11 — Inventory Accounting  
**Builds on:** Phase 3 journals and integration outbox; Phase 4/5 subledger pattern

## Split of responsibility

Excel Edge (the ERP) owns physical stock: quantities, batches, branches, approvals for adjustments, and its own operational costing. Accounting keeps an inventory **valuation subledger** that is fed only by ERP events and is the source of the inventory figures in the general ledger.

## Checklist

- [x] Every ERP inventory ledger row published through the transactional outbox as `INVENTORY_MOVEMENT` (purchases, sales, returns, adjustments, damage, expiry, transfers) — 11.1, 11.16
- [x] Opening stock loaded from an ERP snapshot (`INVENTORY_OPENING`), requested from Accounting by a user with `inventory:manage` — 11.4
- [x] Valuation methods: FIFO (cost layers), weighted average, specific identification (requires a supplied cost); method taken from inventory settings, then accounting policy — 11.5
- [x] ERP-supplied unit cost is used when present; otherwise the company method values the issue — 11.5, 11.7
- [x] Purchase receipt: Dr Inventory, Cr Goods received not invoiced — 11.6
- [x] Sale: cost of goods sold stays with the `SALE_COMPLETED` journal (no second journal); the movement reduces the subledger — 11.7
- [x] Customer return: Dr Inventory, Cr Cost of goods sold — 11.8
- [x] Adjustments in and out: gain / loss (or the inventory adjustment account) — 11.9
- [x] Damage and expiry write-offs: Dr Inventory write-off, Cr Inventory — 11.10
- [x] Transfers between branches through Goods in transit, receipt valued at the dispatched cost — 11.11
- [x] Reconciliation: GL inventory against the subledger with explained differences, quantities against ERP, negative stock, value without stock, failed events — 11.12
- [x] Inventory journal: each movement links to the journal that posted it — 11.13
- [x] Validation: item and branch created from the event, inventory accounts mapped and postable, period open, costing method known, unsupported movement types refused into posting exceptions — 11.14
- [x] Movements are stored once (unique per event line) and never edited; value and quantity after each movement are kept — 11.15
- [x] Dashboard: stock value, units, cost of goods sold this month, losses and write-offs, turnover, value by branch and category, month-end trend, attention list — 11.4
- [x] Reports: inventory valuation (as at any date, by branch and category), cost of goods sold with turnover, stock movements (filter by kind: adjustments, write-offs, transfers), reconciliation, slow-moving and dead stock — 11.17
- [x] Capabilities: `inventory:view`, `inventory:manage`
- [x] Web: inventory dashboard, stock movements, reconciliation, three reports, sidebar entries
- [x] Automated tests (domain costing rules, API end-to-end with GL reconciliation, ERP stock tests)

**PHASE STATUS: COMPLETE for the Segment 11 books core**

Not in this phase: value-only adjustments raised inside Accounting (adjustments are approved in the ERP), an inventory ageing-by-receipt-date report, and enforcing a "no negative stock" policy (the ERP already blocks physical overdraws). User, device and IP details for stock changes are held on the ERP inventory ledger; Accounting records the ERP ledger ID on every movement.
