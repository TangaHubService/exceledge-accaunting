# PHASE 2 — Requirements Checklist

**Documentation:** Segment 3 — Chart of Accounts  
**Builds on:** Phase 1 Account seed + company tenancy + ERP JWT

## Checklist

- [x] Extend Account model (Seg 3.6 fields + control flags)
- [x] Account type / numbering ranges 1000–8999
- [x] Unlimited hierarchy (parent/sub); parent type must match
- [x] Dashboard stats + search/filters
- [x] Create / edit / deactivate / reactivate
- [x] Code immutable after posted activity; no hard delete if history
- [x] Protected system accounts cannot be modified improperly
- [x] Unique code; unique name within category
- [x] Import (CSV/JSON) + export + template + duplicate detection
- [x] Audit trail on COA changes
- [x] Capabilities: coa:view/create/edit/deactivate/import/export
- [x] Web COA tree + filters
- [x] Automated tests (validation, hierarchy, auth, tenant, protected)

**PHASE STATUS: 100% COMPLETE**
