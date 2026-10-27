# RRA EBM / VSDC integration — Excledge CIS

This document describes how Excledge integrates with the Rwanda Revenue Authority
(RRA) Electronic Billing Machine (EBM) via the **VSDC** HTTP API. It reflects the
integration as actually implemented (contracts verified against the RRA reference
sandbox `rraVsdcSandbox3.0.2.war`). Confirm the current wire format with RRA
during certification (`cis_sdc_certification@rra.gov.rw`).

## Deployment shape

- The CIS is a cloud multi-tenant ERP/POS. Each **Organization** holds one TIN.
- Each **Branch** carries its own RRA device credentials — `bhfId`, device serial
  (MRC), SDC id, and an optional per-branch `vsdcUrl`. Org-level `ebmDeviceId` /
  `ebmSerialNo` are a fallback for single-branch tenants.
- Requests go to `EBM_API_URL` (or the branch's `vsdcUrl`), which points at the
  RRA-issued VSDC edge (locally the sandbox WAR, in production the RRA gateway).

## Environment variables

| Variable | Description |
|---|---|
| `ENABLE_EBM` | Master switch. When `false`, all fiscal calls short-circuit as success. |
| `EBM_API_URL` | Base URL, no trailing slash. |
| `EBM_API_KEY` / `EBM_API_SECRET` | Sent as `Authorization: Basic base64(key:secret)`, or `Bearer key` if only the key is set. |
| `EBM_SECURITY_KEY` | Sent as the `security_key` header when set. |
| `EBM_ENVIRONMENT` | `sandbox` \| `production`. |
| `EBM_REQUEST_TIMEOUT_MS` | HTTP timeout (default 1000 in dev; raise for production). |
| `EBM_USE_MOCK` | `true` → no HTTP; every call returns a synthetic success. Dev only. |
| `EBM_MAX_QUEUE_RETRIES` | Outbox retry ceiling before DEAD_LETTER (default 10). |
| `EBM_PROTOCOL` | `vsdc` (default, this document) or `osdc` (EBM 2.1 via the OSDC WAR). |
| `OSDC_API_URL` / `OSDC_AUTH_TOKEN` | Only for the OSDC path. |
| `VSDC_OFFLINE_BLOCK_MS` | Block new sales after this long without a successful VSDC contact (default 2 h). |

## Endpoints used

| Purpose | Method + path | Service |
|---|---|---|
| Device initialization | `POST /initializer/selectInitInfo` | `vsdc-init.service.ts` |
| Sale / refund / void | `POST /trnsSales/saveSales` | `rra-ebm.service.ts`, `ebm-outbox.service.ts` |
| Save item | `POST /items/saveItems` | `product-sync.service.ts` |
| Save item composition (BOM) | `POST /items/saveItemComposition` | `rra-branch-sync.service.ts` |
| Select items (reconcile) | `POST /items/selectItems` | `rra-master-data.service.ts` |
| Codes | `POST /code/selectCodes` | `rra-master-data.service.ts` |
| Item classification (UNSPSC) | `POST /itemClass/selectItemsClass` | `rra-master-data.service.ts` |
| Customer lookup | `POST /customers/selectCustomer` | `rra-master-data.service.ts` |
| Branch list | `POST /branches/selectBranches` | `rra-branch-sync.service.ts` |
| Save branch customers | `POST /branches/saveBrancheCustomers` | `rra-branch-sync.service.ts` |
| Save branch users | `POST /branches/saveBrancheUsers` | `rra-branch-sync.service.ts` |
| Save branch insurances (pharmacy) | `POST /branches/saveBrancheInsurances` | `rra-branch-sync.service.ts` |
| Notices | `POST /notices/selectNotices` | `rra-master-data.service.ts` |
| Stock in/out | `POST /stock/saveStockItems` | `stock-movement-sync.service.ts` |
| Stock movements (pull) | `POST /stock/selectStockItems` | `rra-branch-sync.service.ts` |
| Stock master (on-hand) | `POST /stockMaster/saveStockMaster` | `stock-movement-sync.service.ts` |
| Received purchases | `POST /trnsPurchase/selectTrnsPurchaseSales` | `purchase-sync.service.ts` |
| Confirm purchase | `POST /trnsPurchase/savePurchases` | `purchase-sync.service.ts` |
| Import declarations | `POST /imports/selectImportItems` | `rra-import.service.ts` |
| Update import status | `POST /imports/updateImportItems` | `rra-import.service.ts` |
| Z report | `POST /reports/saveZReports` / `POST /reports/checkZReport` | `ebm-outbox.controller.ts`, `z-report.job.ts` |
| Auditor overview (CIS) | `GET /organizations/:id/rra/audit-overview` | `ebm-master-data.controller.ts` |
| Last receipt recovery (CIS) | `GET /sales/:id/last-receipt` | `sales.controller.ts` |

Every **write** body is `{ tin, bhfId, ...businessPayload }` via `vsdcRequestBody()` —
device fields (`sdcId`, `mrcNo`, `dvcSrlNo`, `env`) stay off the wire. Lookups also
send an incremental `lastReqDt` (`yyyyMMddHHmmss`).

## Flows

### Device initialization (§58)

`POST /organizations/:org/ebm/initialize` → `initializeVsdcDevice()` calls
`/initializer/selectInitInfo` with `{ tin, bhfId, dvcSrlNo }`. On success it
stores the returned `sdcId` / `mrcNo` / full payload on the branch, checks the
device TIN matches the organization TIN, and seeds the local invoice counter
past `lastSaleInvcNo` so no number is ever re-emitted.

### Sale (POS checkout)

1. The sale commits in one DB transaction together with an **`ebm_outbox`** row
   (transactional outbox, idempotency key `ebm-SALE-<org>-<saleId>`). Inventory
   deduction and the outbox write are ACID.
2. A bounded inline wait (~5 s) runs the outbox worker so the caller learns the
   fiscal status before the receipt is offered.
3. The worker builds `TrnsSalesSaveWrReq` (`buildRraSendReceiptPayload`) —
   `invcNo`, `custTin`, `prcOrdCd`, per-A/B/C/D-band `taxblAmt`/`taxAmt`,
   `itemList`, `receipt` block — and POSTs `/trnsSales/saveSales`.
4. On success the SDC fields (`rcptNo`, `intrlData`, `rcptSign`, `totRcptNo`,
   `sdcId`, `vsdcRcptPbctDate`) are persisted to `ebm_transactions`, the
   electronic journal text is stored, and the receipt becomes printable.
5. On failure the outbox row backs off exponentially and retries; after
   `EBM_MAX_QUEUE_RETRIES` it is DEAD_LETTER. `resultCd 924` (already
   fiscalised) is treated as success.

**The printable receipt is withheld until the outbox row is SUCCEEDED**
(`FiscalizationPendingError` → HTTP 425).

### Refund / void

Both are fresh sales-transaction documents on `/trnsSales/saveSales`:
- Refund — new `invcNo`, `salesSttsCd=05`, `rfdRsnCd`, `orgInvcNo` = original;
  every line mirrors the original with its tax code/amount, amounts negated for
  the printed slip.
- Void — new `invcNo`, `cnclDt`/`cnclReqDt`, `salesSttsCd=04`, `orgInvcNo=0`.

### Stock (§23, §72, §73)

Every non-SALE `inventory_ledger` row is queued (`ebmSyncStatus=PENDING`). A
5-minute batch submits `/stock/saveStockItems` with a real `sarTyCd` (01 import,
02 purchase, 03 return, 04/13 transfer, 06/16 adjustment, 15 discarding) then
`/stockMaster/saveStockMaster` with the item's new on-hand quantity. SALE rows
are never queued — RRA derives stock-out from `saveSales`.

### Purchases (§70, §71, §38)

`/trnsPurchase/selectTrnsPurchaseSales` pulls B2B sales issued to the taxpayer
into `rra_purchases` (including `prcOrdCd`). The operator confirms each:
`confirmRraPurchase()` builds `TrnsPurchaseSaveReq` (per-band tax, `itemList`,
`prcOrdCd`) and POSTs `/trnsPurchase/savePurchases` with `pchsSttsCd=02`, which
records the purchase and its stock-in; reject uses `04` and optional `remark`.
Local stock is booked with `skipEbmSync` (RRA already counted it) and stock
master is pushed immediately (§74). UI: sidebar **Purchases**
(`/dashboard/purchases`). Import declarations stay on Fiscal Reports → Imports.

### Import declarations (§66, §67, §68, §74)

`/imports/selectImportItems` pulls declaration lines into `rra_import_items`.
Each pull's request date must be strictly later than the previous one (§67 —
managed via the stored sync cursor). The operator classifies + approves/rejects
each line: `/imports/updateImportItems` with `imptItemSttsCd` 3 (Approved) /
4 (Cancelled) per VSDC §4.18. Approve requires `hsCd` and a receiving product
(link existing or create from the declaration); approval books local stock and
immediately submits `/stock/saveStockItems` (sarTyCd 01) + `/stockMaster`.

### Master data (§59, §61, §62, §64, §65)

Codes, item classifications and notices are pulled incrementally by
`rraMasterDataJob` (nightly) and on demand, cached in `rra_codes` /
`rra_item_classes` / `rra_notices`. Customer TIN verification and item
reconciliation are on-demand lookups.

## Response handling

`parseVsdcStatusCode()` carries the full `resultCd` table (`§4.14`); `000` is
success, `001` ("no search result") is a benign empty lookup, everything else is
a typed error surfaced on the row (`lastError` / `errorMessage`) and on the EBM
Outbox screen. `parseVsdcResponse()` maps the `/trnsSales/saveSales` `data`
block; the QR string is composed by the CIS itself
(`ddmmyyyy#hhmmss#sdcId#rcptNo#intrlData#rcptSign`).

## Numbering

`invcNo` is a per-device gapless sequence (`vsdc_device_counters`, keyed by
org + `bhfId`), seeded past the highest number ever accepted (and past RRA's
`lastSaleInvcNo` at initialization). The printed `INV-…` string is cosmetic.
Local-only receipt types (proforma) draw a separate non-fiscal counter pair.

## Jobs (`RUN_JOBS != false`)

| Job | Schedule | Purpose |
|---|---|---|
| `ebmOutboxJob` | every 2 min | drain the sales/refund/void outbox |
| `stockSyncJob` | every 5 min | drain queued stock movements |
| `rraMasterDataJob` | 04:20 daily | pull codes / classes / notices / purchases / imports |
| `zReportJob` | 23:55 daily | submit the daily Z report per device |
| `vsdcHeartbeatJob` | periodic | probe `/code/selectCodes` to update `lastSuccessfulVdsContact` |
