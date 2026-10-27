"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAX_RATE_BY_SLOT = exports.RRA_TIN_PATTERN = exports.PurchaseCodeMissingError = void 0;
exports.gatewayErrorMessage = gatewayErrorMessage;
exports.isEbmEnabled = isEbmEnabled;
exports.parseGatewayResponse = parseGatewayResponse;
exports.consumeOrgPurchaseCode = consumeOrgPurchaseCode;
exports.consumeAnyOrgPurchaseCode = consumeAnyOrgPurchaseCode;
exports.toRraDate = toRraDate;
exports.toRraTime = toRraTime;
exports.toRraDateTime = toRraDateTime;
exports.fix2 = fix2;
exports.clampField = clampField;
exports.isValidRraTin = isValidRraTin;
exports.walkInCustTin = walkInCustTin;
exports.effectiveBuyerTin = effectiveBuyerTin;
exports.resolveCustTinForVsdc = resolveCustTinForVsdc;
exports.buildRraSendReceiptPayload = buildRraSendReceiptPayload;
exports.generateInvoiceNumber = generateInvoiceNumber;
exports.allocateLocalReceiptSequence = allocateLocalReceiptSequence;
const prisma_1 = require("../lib/prisma");
const config_1 = require("../config");
const purchase_code_checksum_1 = require("./purchase-code.checksum");
const item_code_service_1 = require("./item-code.service");
const customers_validation_1 = require("../validations/customers.validation");
const rra_code_service_1 = require("./rra-code.service");
let invoiceSequenceMode = 'unknown';
function gatewayErrorMessage(http, fallback) {
    if (http.json && typeof http.json === 'object') {
        const rec = http.json;
        if (rec.message != null && String(rec.message).length > 0) {
            return String(rec.message);
        }
    }
    return fallback;
}
function isEbmEnabled() {
    return config_1.config.ebm.enabled === true;
}
function parseGatewayResponse(raw) {
    if (!raw || typeof raw !== 'object') {
        return {};
    }
    const o = raw;
    // Handle RRA canonical structure: { RESPONSE: { MESSAGE: { ... }, QR_CODE, ... } }
    const responseBlock = o.RESPONSE && typeof o.RESPONSE === 'object'
        ? o.RESPONSE
        : null;
    const messageBlock = responseBlock?.MESSAGE && typeof responseBlock.MESSAGE === 'object'
        ? responseBlock.MESSAGE
        : null;
    // Also support existing gateway format: o.data
    const data = (o.data && typeof o.data === 'object' ? o.data : {});
    const pick = (...keys) => {
        for (const k of keys) {
            const v = o[k] ??
                data[k] ??
                (messageBlock ? messageBlock[k] : undefined) ??
                (responseBlock ? responseBlock[k] : undefined);
            if (v !== undefined && v !== null && String(v).length > 0) {
                return String(v);
            }
        }
        return undefined;
    };
    return {
        // RRA field: "num" in MESSAGE block holds the invoice number
        ebmInvoiceNumber: pick('ebmInvoiceNumber', 'ebm_invoice_number', 'num', 'receiptNumber', 'receipt_number', 'invoiceNumber', 'fiscalInvoiceNumber', 'sdcInvoiceNo'),
        // RRA field: "QR_CODE" in RESPONSE block holds the encrypted QR payload
        receiptQrPayload: pick('QR_CODE', 'qrCode', 'qr_code', 'qrPayload', 'qr_payload', 'qrData', 'receiptQr'),
        // RRA field: "ysdcregsig" in MESSAGE block holds the fiscal signature
        verificationCode: pick('ysdcregsig', 'verificationCode', 'verification_code', 'ysdcintdata', 'internalData', 'rcptSign'),
        // RRA fields: "ysdcmrctim" or "ysdctime" in MESSAGE block hold the SDC timestamp
        sdcDateTime: pick('ysdcmrctim', 'ysdctime', 'sdcDateTime', 'sdc_date_time', 'issuedAt', 'timestamp'),
    };
}
function isMissingDatabaseObjectError(error, objectName) {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const prismaError = error;
    if (prismaError.code !== 'P2010') {
        return false;
    }
    const postgresCode = prismaError.meta?.code;
    const message = prismaError.meta?.message ?? '';
    return ((postgresCode === '42P01' || postgresCode === '42704') &&
        message.includes(`"${objectName}"`));
}
async function nextInvoiceSequenceFromCounterTable(organizationId, branchId, client = prisma_1.prisma) {
    const rows = await client.$queryRaw `
    INSERT INTO "organization_invoice_counters" ("organizationId", "branchId", "nextSequence", "updatedAt")
    VALUES (${organizationId}, ${branchId}, 1, NOW())
    ON CONFLICT ("organizationId", "branchId") DO UPDATE
    SET "nextSequence" = "organization_invoice_counters"."nextSequence" + 1,
        "updatedAt" = NOW()
    RETURNING "nextSequence"
  `;
    return Number(rows[0]?.nextSequence ?? 0);
}
async function nextInvoiceSequenceFromLegacySequence(client = prisma_1.prisma) {
    const rows = await client.$queryRaw `
    SELECT nextval('invoice_seq')::bigint AS "nextSequence"
  `;
    return Number(rows[0]?.nextSequence ?? 0);
}
async function allocateNextInvoiceSequence(organizationId, branchId, client = prisma_1.prisma) {
    // VSDC `invcNo` must be unique per DEVICE (org + bhfId), not per branch —
    // several branches may share one VSDC device and would otherwise collide.
    const branch = await client.branch.findUnique({
        where: { id: branchId },
        select: { bhfId: true },
    });
    const deviceKey = branch?.bhfId ? `bhf:${branch.bhfId}` : `branch:${branchId}`;
    // Seed the first row past the highest number ever used by this org so we never
    // re-emit an invcNo the device has already accepted (avoids VSDC 924). The
    // atomic UPSERT below makes concurrent first-initializations safe.
    const maxRow = await client.sale.aggregate({
        where: { organizationId },
        _max: { vsdcInvcNo: true },
    });
    const seed = (maxRow._max.vsdcInvcNo ?? 0) + 1;
    const rows = await client.$queryRaw `
    INSERT INTO "vsdc_device_counters" ("organizationId", "deviceKey", "nextSequence", "updatedAt")
    VALUES (${organizationId}, ${deviceKey}, ${seed}, NOW())
    ON CONFLICT ("organizationId", "deviceKey") DO UPDATE
      SET "nextSequence" = "vsdc_device_counters"."nextSequence" + 1,
          "updatedAt"    = NOW()
    RETURNING "nextSequence"
  `;
    const allocated = Number(rows[0]?.nextSequence ?? 0);
    if (allocated > 0) {
        invoiceSequenceMode = 'per_device';
        return allocated;
    }
    // Fallbacks for DBs where vsdc_device_counters doesn't exist yet.
    if (invoiceSequenceMode === 'per_org') {
        return nextInvoiceSequenceFromCounterTable(organizationId, branchId, client);
    }
    if (invoiceSequenceMode === 'legacy_sequence') {
        return nextInvoiceSequenceFromLegacySequence(client);
    }
    try {
        const sequence = await nextInvoiceSequenceFromCounterTable(organizationId, branchId, client);
        invoiceSequenceMode = 'per_org';
        return sequence;
    }
    catch (error) {
        if (!isMissingDatabaseObjectError(error, 'organization_invoice_counters')) {
            throw error;
        }
    }
    try {
        const sequence = await nextInvoiceSequenceFromLegacySequence(client);
        invoiceSequenceMode = 'legacy_sequence';
        return sequence;
    }
    catch (error) {
        if (isMissingDatabaseObjectError(error, 'invoice_seq')) {
            throw new Error('Invoice numbering database objects are missing. Run `npm run prisma:deploy` in `Backend/` to apply the latest Prisma migrations.');
        }
        throw error;
    }
}
/**
 * Consume the next unused RRA purchase code from the organization's pool for a
 * given buyer TIN, atomically (within the sale transaction when `client` is a tx).
 * Only codes that pass the sandbox checksum for `buyerTin` are handed out — the
 * pool may still contain legacy invalid codes, and allocating one would be
 * rejected by the device with 882. Returns the code, or null when no valid
 * unconsumed code remains (caller falls back to the legacy per-customer
 * `prcOrdCd`).
 */
async function consumeOrgPurchaseCode(organizationId, buyerTin, saleId, client = prisma_1.prisma) {
    const org = await prisma_1.prisma.organization.findUnique({ where: { id: organizationId }, select: { TIN: true } });
    const sellerTin = org?.TIN?.trim() ?? '';
    const candidates = await client.organizationPurchaseCode.findMany({
        where: { organizationId, buyerTin, consumed: false },
        orderBy: { id: 'asc' },
        take: 100,
    });
    for (const next of candidates) {
        if (sellerTin && !(0, purchase_code_checksum_1.isValidPurchaseCode)(next.code, buyerTin, sellerTin)) {
            continue;
        }
        await client.organizationPurchaseCode.update({
            where: { id: next.id },
            data: { consumed: true, consumedSaleId: saleId, consumedAt: new Date() },
        });
        return next.code;
    }
    return null;
}
/**
 * Thrown when a fiscal payload cannot be built because no RRA purchase order
 * code is on record. Unlike malformed data (dead-letter immediately), a
 * missing code is TRANSIENT — the operator can top the pool up and the retry
 * will succeed — so the outbox worker backs this off with retries instead of
 * dead-lettering on the first miss.
 */
class PurchaseCodeMissingError extends Error {
    constructor(saleRef, custTin) {
        super(`Cannot build Sale ${saleRef} to RRA: no RRA purchase order code (prcOrdCd) on the sale, the customer, or the organization pool. ` +
            `Top up the pool for buyer TIN ${custTin} before retrying.`);
        this.name = 'PurchaseCodeMissingError';
    }
}
exports.PurchaseCodeMissingError = PurchaseCodeMissingError;
/**
 * Consume the next unused RRA purchase code from the organization's pool for
 * the given buyer TIN, atomically (within the sale transaction when `client`
 * is a tx). Strictly buyer-scoped: a code pooled for buyer A must never be
 * submitted for buyer B — the sandbox checksum binds each code to its buyer
 * TIN and rejects cross-buyer codes with 882 (verified live). Returns the
 * code, or null when no valid unconsumed code remains for this buyer (the
 * caller fails with an actionable top-up message instead of submitting a
 * placeholder the sandbox will reject).
 */
async function consumeAnyOrgPurchaseCode(organizationId, saleId, client = prisma_1.prisma, buyerTin) {
    const org = await prisma_1.prisma.organization.findUnique({ where: { id: organizationId }, select: { TIN: true } });
    const sellerTin = org?.TIN?.trim() ?? '';
    // Strictly buyer-scoped: only codes pooled for THIS buyer TIN are ever
    // handed out. A code generated for another buyer carries that buyer's
    // checksum and is rejected by the device with 882.
    const targetTin = buyerTin?.trim() || '';
    if (!targetTin)
        return null;
    let candidates = await client.organizationPurchaseCode.findMany({
        where: { organizationId, buyerTin: targetTin, consumed: false },
        orderBy: { id: 'asc' },
        take: 100,
    });
    // Sandbox/dev resilience: outside production there are no buyer devices to
    // issue real purchase codes, so mint buyer-scoped single-use codes on demand
    // (the same stand-ins scripts/topup-purchase-codes.ts creates manually).
    // Production NEVER mints codes: real B2B codes arrive through procurement
    // and a dry pool there must surface as an actionable top-up error instead.
    if (!candidates.length && sellerTin && (config_1.config.ebm.environment ?? 'sandbox') !== 'production') {
        const existing = await client.organizationPurchaseCode.findMany({
            where: { organizationId },
            select: { code: true },
            take: 20000,
        });
        const minted = (0, purchase_code_checksum_1.generateValidPurchaseCodes)(targetTin, sellerTin, 10, new Set(existing.map((r) => r.code)));
        if (minted.length) {
            await client.organizationPurchaseCode.createMany({
                data: minted.map((code) => ({ organizationId, code, buyerTin: targetTin })),
                skipDuplicates: true,
            });
            candidates = await client.organizationPurchaseCode.findMany({
                where: { organizationId, buyerTin: targetTin, consumed: false },
                orderBy: { id: 'asc' },
                take: 100,
            });
        }
    }
    for (const next of candidates) {
        if (sellerTin && !(0, purchase_code_checksum_1.isValidPurchaseCode)(next.code, targetTin, sellerTin)) {
            continue;
        }
        await client.organizationPurchaseCode.update({
            where: { id: next.id },
            data: { consumed: true, consumedSaleId: saleId, consumedAt: new Date() },
        });
        return next.code;
    }
    return null;
}
// ──────────────────────────────────────────────
// C4: RRA-canonical date/amount helpers (CIS/VSDC spec §3.2)
// ──────────────────────────────────────────────
function toRraDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
}
function toRraTime(d) {
    return [
        String(d.getHours()).padStart(2, '0'),
        String(d.getMinutes()).padStart(2, '0'),
        String(d.getSeconds()).padStart(2, '0'),
    ].join('');
}
function toRraDateTime(d) {
    return `${toRraDate(d)}${toRraTime(d)}`;
}
function fix2(n) {
    return Math.round(n * 100) / 100;
}
/** Clamp a free-text field to the max length the RRA reference WAR accepts. */
function clampField(value, maxLength) {
    if (!value)
        return '';
    return value.trim().slice(0, maxLength);
}
/**
 * VSDC §4.9 Sales Receipt Type only has two values: 'S' (Sale) and 'R' (Refund
 * after Sale). The CIS-level NS/NR/CS/CR/TS/TR/PS distinction (rcptLabel) is
 * used for the printed A/B/RT counter, not for this field — every label ends
 * in 'S' or 'R', which is exactly the axis VSDC cares about here.
 */
/**
 * VSDC §4.9 Sales Receipt Type only has two values: 'S' (Sale) and 'R' (Refund
 * after Sale). The CIS-level NS/NR/CS/CR/TS/TR/PS distinction (rcptLabel) is
 * used for the printed A/B/RT counter, not for this field — every label ends
 * in 'S' or 'R', which is exactly the axis VSDC cares about here.
 */
function rcptTyCdFromLabel(label) {
    return label?.endsWith('R') ? 'R' : 'S';
}
/** RRA TIN shape accepted by the VSDC (`receipt.custTin` + `custTin` must both
 * pass it — verified live: the sandbox rejects 7-prefix, all-zero and short
 * values with resultCd 910, and rejects empty with 910). */
exports.RRA_TIN_PATTERN = /^[19]\d{8}$/;
function isValidRraTin(tin) {
    return exports.RRA_TIN_PATTERN.test((tin ?? '').trim());
}
/**
 * Walk-in (no-TIN individual) buyer TIN for VSDC submission.
 *
 * The sandbox mandates a valid-format `custTin` on every receipt (resultCd
 * 881/910/884 otherwise), so a retail sale to a customer without a registered
 * TIN cannot be submitted at all without one. This derives a deterministic,
 * per-customer value in the RRA individual range — it is a submission
 * placeholder, NOT the customer's real TIN: it is never written back to the
 * customer record and never printed on the customer-facing receipt (which
 * shows the customer's actual TIN, blank for walk-ins).
 *
 * PRODUCTION RISK (see final report §H): confirm with RRA whether B2C
 * receipts require the buyer's real TIN, a designated walk-in TIN, or another
 * marker. Business (CORPORATE/INSURANCE) buyers without a valid TIN are
 * always rejected below instead of receiving a placeholder.
 */
function walkInCustTin(customerId) {
    return `1${String(customerId).padStart(8, '0')}`.slice(0, 9);
}
/**
 * The buyer TIN under which purchase codes are pooled/allocated for a sale:
 * the stored customer TIN when it is valid, otherwise the same resolved
 * value submitted as custTin (walk-in placeholder for individuals). Falls
 * back to the stored value when nothing resolves, so callers always get a
 * string and the payload builder still raises the precise error.
 */
function effectiveBuyerTin(sale) {
    const stored = sale.customer?.TIN?.trim() ?? '';
    if (isValidRraTin(stored))
        return stored;
    try {
        return resolveCustTinForVsdc(sale);
    }
    catch {
        return stored;
    }
}
/**
 * Resolve the `custTin` to submit for a sale. Throws a descriptive error when
 * no submittable TIN exists (business buyers without a valid TIN, or a sale
 * with no customer at all) so the outbox dead-letters with an actionable
 * message instead of sending a fake value.
 */
function resolveCustTinForVsdc(sale) {
    const customerTin = sale.customer?.TIN?.trim() ?? '';
    if (isValidRraTin(customerTin))
        return customerTin;
    const customerType = (sale.customer?.customerType ?? 'INDIVIDUAL').toUpperCase();
    if (customerType !== 'INDIVIDUAL') {
        throw new Error(`Cannot fiscalize Sale ${sale.saleNumber ?? sale.id}: ${customerType} customer "${sale.customer?.name ?? '?'}" has no valid 9-digit RRA TIN. ` +
            `Register the customer's real TIN (verify via /rra/customers/:tin) before submitting.`);
    }
    if (!sale.customer) {
        throw new Error(`Cannot fiscalize Sale ${sale.saleNumber ?? sale.id}: no customer on record and no valid TIN to submit.`);
    }
    return walkInCustTin(sale.customer.id);
}
/** VSDC §4.1 Tax Type rates — static, RRA-defined: A 0%, B 18%, C 0%, D 0%. */
exports.TAX_RATE_BY_SLOT = [0, 18, 0, 0];
/**
 * Build the RRA VSDC API v1.0.5 `/trnsSales/saveSales` payload
 * (`TrnsSalesSaveWrReq`, §3.3.6.1). `tin`/`bhfId` are added by the caller from
 * the VSDC envelope, not here.
 *
 * `opts` lets the same builder produce a refund submission: a refund is not a
 * separate endpoint, it's another sales-transaction record referencing the
 * original invoice via `orgInvcNo` with `rfdDt`/`rfdRsnCd` set.
 */
function buildRraSendReceiptPayload(sale, org, rraPaymentCode, opts = {}) {
    const rcptTyCd = rcptTyCdFromLabel(sale.rcptLabel);
    const isRefund = rcptTyCd === 'R';
    const isVoid = !!opts.cnclDt;
    // Per-tax-code accumulators: slot 0=A(exempt), 1=B(VAT18%), 2=C(zero-rated), 3=D(non-taxable)
    const taxblAmt = [0, 0, 0, 0];
    const taxAmt = [0, 0, 0, 0];
    const codeToSlot = { A: 0, B: 1, C: 2, D: 3 };
    // Pharmacy insurance line fields (TrnsSalesSaveWrItem isrcc*/isrc*). Only
    // populate when the buyer is a registered insurer (CustomerType.INSURANCE +
    // isrccCd previously pushed via /branches/saveBrancheInsurances). RRA rejects
    // unknown isrccCd with resultCd 913 — never invent codes.
    const insurerCd = (sale.customer?.isrccCd ?? '').trim();
    const insuranceAmtTotal = Math.abs(Number(sale.insuranceAmount ?? 0));
    const insuranceActive = insuranceAmtTotal > 0
        && sale.customer?.customerType === 'INSURANCE'
        && !!insurerCd;
    const insurerNm = insuranceActive ? (sale.customer?.name ?? null) : null;
    const insurerRt = insuranceActive && sale.customer?.isrcRt != null
        ? Number(sale.customer.isrcRt)
        : null;
    // Prefer products flagged useInsurance; if none are flagged, spread across all lines.
    const anyFlagged = sale.saleItems.some((si) => si.product?.useInsurance === true);
    const insuranceBaseTotal = sale.saleItems.reduce((s, si) => {
        if (!insuranceActive)
            return s;
        if (anyFlagged && si.product?.useInsurance !== true)
            return s;
        return s + Math.abs(Number(si.totalPrice));
    }, 0);
    const itemList = sale.saleItems.map((si, idx) => {
        const rawCode = (si.taxCode ?? 'A').toUpperCase();
        const slot = codeToSlot[rawCode];
        if (slot === undefined) {
            throw new Error(`Cannot build Sale ${sale.saleNumber ?? sale.id} to RRA: sale item ${idx + 1} has an invalid tax code "${rawCode}". Only A, B, C, D are valid for line items.`);
        }
        // VSDC (RRA reference implementation) uses tax-inclusive quantities: the
        // supply/taxable amount is the gross unit price × quantity, and the VAT is
        // extracted from it (taxAmt = grossAmount × rate/(100+rate)).
        //
        // Refunds store negative amounts (the controller mirrors the original sale
        // with negated totals), but the RRA sandbox validates each line as
        // `dcAmt <= splyAmt` etc. against POSITIVE amounts and rejects negative
        // supply amounts with resultCd 910. A refund document is a fresh positive
        // sales-transaction record marked `salesSttsCd=05` (see §4.11/§4.16), so
        // abs() every amount and quantity when building a refund payload.
        const qty = Math.abs(Number(si.quantity));
        const prc = Math.abs(si.unitPrice.toNumber());
        const splyAmt = fix2(qty * prc);
        const tAmt = Math.abs(fix2(si.taxAmount.toNumber()));
        taxblAmt[slot] = fix2(taxblAmt[slot] + splyAmt);
        taxAmt[slot] = fix2(taxAmt[slot] + tAmt);
        // Sales are always rung up per individual unit (qty), never per whole
        // package. `pkg` is RRA's package count for the line, so when the product
        // declares how many units make up one package, convert; a partial package
        // still rounds up to 1, since RRA has no concept of a fractional package.
        // Products without packagingQty (most of the catalog today) fall back to
        // the historical 1 pkg == 1 unit behavior.
        const packagingQty = si.product?.packagingQty ?? null;
        const pkg = packagingQty && packagingQty > 0 ? Math.ceil(qty / packagingQty) : qty;
        // Catalog products/services without an RRA itemCd can never be sold
        // fiscally. Ad-hoc service lines (no productId) use a synthetic SVC-n
        // code, but still require itemClsCd below — VSDC rejects empty class.
        const itemCd = si.product?.itemCd ?? (si.productId != null ? null : `SVC-${idx + 1}`);
        if (!itemCd) {
            throw new Error(`Cannot build Sale ${sale.saleNumber ?? sale.id} to RRA: product #${si.productId} has no RRA item code (itemCd). ` +
                `Open the product and save it so an itemCd is allocated, then sync it via POST /rra/items/:productId/sync.`);
        }
        // RRA code classes 10/17: the sandbox rejects unknown unit codes with
        // resultCd 913, so stored codes are accepted only when they are real RRA
        // codes — otherwise fall back to the measurement-unit derivation / 'CT'.
        const pkgUnitCd = (0, rra_code_service_1.resolvePkgUnitCd)(si.product?.pkgUnitCd);
        const qtyUnitCd = (0, rra_code_service_1.resolveQtyUnitCd)(si.product?.qtyUnitCd, si.measurementUnit ?? null, item_code_service_1.deriveQtyUnitCd);
        // Prefer RRA classification from the product — never invent a UNSPSC code.
        // Required for SERVICE as well as PRODUCT (VSDC ItemSaveReq / TrnsSalesSaveWrReq).
        const itemClsCd = si.product?.itemClsCd?.trim() || null;
        if (!itemClsCd) {
            const label = si.productId != null
                ? `product #${si.productId}`
                : `service line ${idx + 1}${si.serviceName ? ` (${si.serviceName})` : ''}`;
            throw new Error(`Cannot build Sale ${sale.saleNumber ?? sale.id} to RRA: ${label} has no RRA item classification (itemClsCd). ` +
                `Select a classification on the catalog item (services included), re-sync to RRA, then retry the outbox row.`);
        }
        return {
            itemSeq: idx + 1,
            itemCd,
            itemClsCd,
            itemNm: si.product?.name ?? si.serviceName ?? 'Item',
            bcd: si.product?.barcode ?? null,
            pkg,
            pkgUnitCd,
            qty,
            qtyUnitCd,
            prc,
            splyAmt: fix2(splyAmt),
            dcRt: fix2(Math.abs(si.dcRate.toNumber())),
            dcAmt: fix2(Math.abs(si.dcAmt.toNumber())),
            // Insurance line fields — populated only for registered pharmacy insurers.
            ...(() => {
                if (!insuranceActive || insuranceBaseTotal <= 0) {
                    return { isrccCd: null, isrccNm: null, isrcRt: null, isrcAmt: null };
                }
                if (anyFlagged && si.product?.useInsurance !== true) {
                    return { isrccCd: null, isrccNm: null, isrcRt: null, isrcAmt: null };
                }
                const share = Math.abs(Number(si.totalPrice)) / insuranceBaseTotal;
                return {
                    isrccCd: insurerCd,
                    isrccNm: insurerNm,
                    isrcRt: insurerRt,
                    isrcAmt: fix2(insuranceAmtTotal * share),
                };
            })(),
            taxTyCd: rawCode,
            taxblAmt: fix2(splyAmt),
            taxAmt: fix2(tAmt),
            totAmt: fix2(splyAmt),
        };
    });
    const totTaxAmt = fix2(taxAmt.reduce((s, v) => s + v, 0));
    const totTaxblAmt = fix2(taxblAmt.reduce((s, v) => s + v, 0));
    const totAmt = fix2(Math.abs(sale.totalAmount.toNumber()));
    const now = sale.createdAt;
    // RRA requires a customer TIN on every fiscal receipt — verified live: the
    // sandbox rejects a missing/invalid receipt.custTin with resultCd 910 and a
    // missing prcOrdCd with 881. Business buyers without a real TIN are rejected
    // (resolveCustTinForVsdc throws); walk-in individuals get the documented
    // per-customer placeholder (see walkInCustTin — production validity of B2C
    // placeholders must be confirmed with RRA). We never fall back to the
    // seller's own TIN — that would silently convert the sale into a B2B
    // transaction.
    const custTin = resolveCustTinForVsdc(sale);
    const custNm = sale.customer?.name ?? org.name;
    // §4.6 custMblNo: only send a real, correctly-shaped phone number — never a
    // raw unvalidated value, and never the TIN (a pre-fix swapped/duplicate
    // record could otherwise leak the TIN into the mobile-number field).
    const customerPhone = sale.customer?.phone?.trim() ?? '';
    const custMblNo = customerPhone && (0, customers_validation_1.isValidCustomerPhone)(customerPhone) && customerPhone !== custTin
        ? customerPhone
        : '';
    const invcNo = opts.invcNoOverride ?? sale.vsdcInvcNo ?? (() => {
        throw new Error(`Cannot build Sale ${sale.saleNumber ?? sale.id} to RRA: no VSDC invoice number (vsdcInvcNo) allocated. ` +
            `A fiscal document must always carry a fresh number from the per-device sequence.`);
    })();
    const regrNm = sale.user?.name ?? 'System';
    const regrId = sale.user ? String(sale.user.id) : 'system';
    return {
        invcNo,
        orgInvcNo: opts.orgInvcNo ?? 0,
        custTin,
        // RRA purchase order code: verified live, the sandbox rejects a missing
        // code with 881 and a fake one such as '000000' with 882 — so there is no
        // placeholder fallback. The outbox processor auto-allocates an unconsumed
        // org-pool code onto the sale before building this payload; when none is
        // on record we fail with an actionable message instead of submitting a
        // value RRA will reject.
        prcOrdCd: (() => {
            const code = (sale.prcOrdCd ?? sale.customer?.prcOrdCd ?? '').trim();
            if (!code) {
                throw new PurchaseCodeMissingError(sale.saleNumber ?? sale.id, custTin);
            }
            return code;
        })(),
        custNm: custNm ?? '',
        salesTyCd: 'N', // spec: "Send only 'N' type"
        rcptTyCd,
        pmtTyCd: rraPaymentCode,
        salesSttsCd: isVoid ? '04' : isRefund ? '05' : '02', // §4.11: 04 Canceled, 05 Refunded, 02 Approved
        cfmDt: toRraDateTime(now),
        salesDt: toRraDate(now),
        stockRlsDt: toRraDateTime(now),
        cnclReqDt: opts.cnclDt ? toRraDateTime(opts.cnclDt) : null,
        cnclDt: opts.cnclDt ? toRraDateTime(opts.cnclDt) : null,
        rfdDt: opts.rfdDt ? toRraDateTime(opts.rfdDt) : null,
        rfdRsnCd: opts.rfdRsnCd ?? null,
        totItemCnt: itemList.length,
        taxblAmtA: taxblAmt[0],
        taxblAmtB: taxblAmt[1],
        taxblAmtC: taxblAmt[2],
        taxblAmtD: taxblAmt[3],
        taxRtA: exports.TAX_RATE_BY_SLOT[0],
        taxRtB: exports.TAX_RATE_BY_SLOT[1],
        taxRtC: exports.TAX_RATE_BY_SLOT[2],
        taxRtD: exports.TAX_RATE_BY_SLOT[3],
        // Mandatory combined fields required by the RRA reference implementation
        // (validated as taxRtF / taxRtTt in the sandbox WAR).
        taxRtF: exports.TAX_RATE_BY_SLOT[1],
        taxRtTt: 3,
        taxAmtA: taxAmt[0],
        taxAmtB: taxAmt[1],
        taxAmtC: taxAmt[2],
        taxAmtD: taxAmt[3],
        totTaxblAmt,
        totTaxAmt,
        totAmt,
        prchrAcptcYn: 'N',
        remark: '',
        regrNm,
        regrId,
        modrNm: regrNm,
        modrId: regrId,
        receipt: {
            custTin,
            custMblNo,
            rptNo: invcNo,
            // RRA WAR rejects `trdeNm` longer than 20 chars with resultCd 910
            // ("length must be between 0 and 20") — clamp the trade name.
            trdeNm: clampField(org.name, 20),
            adrs: clampField(org.address, 200),
            topMsg: '',
            // The VSDC request contract limits this to 20 characters. Sending the
            // longer friendly message caused valid sales to be rejected with 910 by
            // the local RRA sandbox before fiscalisation could complete.
            btmMsg: clampField('Thank you for your business', 20),
            prchrAcptcYn: 'N',
        },
        itemList,
    };
}
/**
 * Atomically allocate next invoice sequence for a branch (PostgreSQL upsert).
 * RRA requires per-branch (per-device) sequences, not per-organization.
 *
 * Returns both the human-readable, CIS-side invoice number (printed on the
 * receipt, purely cosmetic) and the raw numeric sequence — VSDC's `invcNo` /
 * `orgInvcNo` fields are typed NUMBER and must never receive the formatted
 * string.
 */
async function generateInvoiceNumber(organizationId, branchId, client = prisma_1.prisma) {
    const vsdcInvcNo = await allocateNextInvoiceSequence(organizationId, branchId, client);
    const sequence = vsdcInvcNo.toString().padStart(6, '0');
    const organization = await client.organization.findUnique({
        where: { id: organizationId },
        select: { TIN: true },
    });
    // TIN-derived code is cosmetic only — it is NOT guaranteed unique across
    // organizations (many orgs have no TIN yet and all fall back to the same
    // literal), and the sequence above resets per (organizationId, branchId).
    // branchId is a global PK, so folding it in makes the whole string globally
    // unique by construction, independent of TIN state or branch count per org.
    const orgCode = organization?.TIN?.replace(/\D/g, '').slice(-4) || 'ORG';
    const year = new Date().getFullYear();
    return { invoiceNumber: `INV-${orgCode}-B${branchId}-${year}-${sequence}`, vsdcInvcNo };
}
/**
 * Allocate a local, non-fiscal receipt number pair for PROFORMA (and future
 * local-only types), which per the CIS spec (§6.3.6) must never be assigned a
 * VSDC-signed invoice number — they never draw from the real gapless RRA
 * sequence (allocateNextInvoiceSequence). Mirrors the spec's own "A/B RT"
 * counter shape (§7.25) with two independent, atomically-incremented values:
 *  - typeSeq: this branch's count of this specific receipt type only
 *    (BranchReceiptCounter, keyed by rcptLabel)
 *  - totalSeq: this branch's running count across EVERY locally-numbered
 *    receipt type combined (Branch.localReceiptTotalSeq)
 * Both increment together so the pair is never `<n>/<n>` by construction.
 */
async function allocateLocalReceiptSequence(branchId, rcptLabel, client = prisma_1.prisma) {
    const [typeRows, totalRows] = await Promise.all([
        client.$queryRaw `
      INSERT INTO "branch_receipt_counters" ("branchId", "rcptLabel", "nextSeq", "updatedAt")
      VALUES (${branchId}, ${rcptLabel}::"RcptLabel", 1, NOW())
      ON CONFLICT ("branchId", "rcptLabel") DO UPDATE
        SET "nextSeq" = "branch_receipt_counters"."nextSeq" + 1,
            "updatedAt" = NOW()
      RETURNING "nextSeq"
    `,
        client.$queryRaw `
      UPDATE "branches"
      SET "local_receipt_total_seq" = "local_receipt_total_seq" + 1
      WHERE "id" = ${branchId}
      RETURNING "local_receipt_total_seq"
    `,
    ]);
    return {
        typeSeq: Number(typeRows[0]?.nextSeq ?? 1),
        totalSeq: Number(totalRows[0]?.local_receipt_total_seq ?? 1),
    };
}
