# PHASE 3 — Requirements Checklist

**Documentation:** Seg 1.6 Integration Engine · Seg 8 Journals · Seg 9 General Ledger  
**Architecture:** Accounting microservice owns books; ERP publishes events via outbox + HTTP ingest

## Checklist

### Accounting service
- [x] `integration_events` (idempotent ingest, status, retries)
- [x] `posting_exceptions` queue
- [x] `journals` + `journal_lines` (Draft→Posted→Reversed)
- [x] `gl_entries` + account balance updates on post
- [x] Source document links (bidirectional refs)
- [x] Posting rules resolve accounts from company defaults (no hardcoded account IDs)
- [x] Enforce Σ Debit = Σ Credit (non-bypassable)
- [x] Open-period check; activation required
- [x] Manual journal create/post + automatic from events
- [x] Reversal journals (opposite lines; original preserved)
- [x] Duplicate event prevention via idempotencyKey
- [x] Retry / exception reprocess
- [x] Audit trail
- [x] APIs: integration ingest, journals, GL, exceptions
- [x] Capabilities: journal:*, gl:view, integration machine key
- [x] Tests: balance, idempotency, reversal, auth, tenant

### ERP (thin only)
- [x] `ErpAccountingOutbox`
- [x] Enqueue on `commitSale` (SALE_COMPLETED)
- [x] Cron/worker POST to Accounting `/api/v1/integration/events`
- [x] No journal math in ERP

**PHASE STATUS: 100% COMPLETE**
