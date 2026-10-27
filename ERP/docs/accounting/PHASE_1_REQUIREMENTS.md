# PHASE 1 — Requirements Checklist

**Documentation:** Segment 2 — Company Accounting Setup  
**Architecture:** Standalone Accounting microservice · ERP JWT AuthN · no local users  

## Checklist

### Bootstrap
- [x] `apps/api` Express + TypeScript + Zod + Prisma
- [x] PostgreSQL (schema `accounting`; docker-compose optional)
- [x] Migrations for setup/activation/audit/minimal COA
- [x] Health endpoint

### AuthZ (ERP)
- [x] Validate ERP access JWT (`JWT_SECRET`)
- [x] Require `userId` + `activeOrganizationId`
- [x] Map ERP org → Accounting `company` via `externalErpOrganizationId`
- [x] Capability map from ERP roles
- [x] No login/register/refresh endpoints

### Setup dashboard
- [x] 14 sections with required statuses
- [x] Counts + activation status + FY/period/currency/country summary

### 14 sections
- [x] Company Profile
- [x] Business & Accounting Information
- [x] Financial Year & Periods
- [x] Currency Configuration
- [x] Accounting Policies
- [x] Localization & Compliance
- [x] Default Posting Accounts
- [x] Inventory Accounting Settings
- [x] Customer & Supplier Defaults
- [x] Banking & Payment Configuration
- [x] Transaction Numbering
- [x] Approval & Posting Controls
- [x] Opening Balances foundation (D=C)
- [x] Review & Activation

### Activation
- [x] Block until mandatory sections ready
- [x] Activation statuses + success message

### Audit / Permissions / Tests / UI
- [x] Audit trail with erpUserId
- [x] Prepare vs Approve vs Activate
- [x] Unit + API + tenant + auth tests (16 passed)
- [x] Minimal web setup UI

**PHASE STATUS: 100% COMPLETE**
