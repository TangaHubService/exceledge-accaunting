"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseVsdcStatusCode = parseVsdcStatusCode;
exports.buildVsdcEnvelope = buildVsdcEnvelope;
exports.listActiveVsdcDevices = listActiveVsdcDevices;
exports.validateVsdcEnvelope = validateVsdcEnvelope;
exports.vsdcRequestBody = vsdcRequestBody;
exports.parseVsdcResponse = parseVsdcResponse;
exports.saveInvc = saveInvc;
exports.toRraReqDt = toRraReqDt;
exports.selectCodes = selectCodes;
exports.selectItemsClass = selectItemsClass;
exports.selectCustomer = selectCustomer;
exports.selectItems = selectItems;
exports.selectNotices = selectNotices;
exports.saveItem = saveItem;
exports.saveItemComposition = saveItemComposition;
exports.selectMvmt = selectMvmt;
exports.savePurc = savePurc;
exports.saveStockItems = saveStockItems;
exports.selectStockItems = selectStockItems;
exports.saveStockMaster = saveStockMaster;
exports.selectPurchases = selectPurchases;
exports.savePurchase = savePurchase;
exports.selectBranches = selectBranches;
exports.saveBrancheCustomer = saveBrancheCustomer;
exports.saveBrancheUser = saveBrancheUser;
exports.saveBrancheInsurance = saveBrancheInsurance;
exports.selectInitInfo = selectInitInfo;
exports.selectImportItems = selectImportItems;
exports.updateImportItems = updateImportItems;
exports.selectImportInvc = selectImportInvc;
exports.vsdcHeartbeat = vsdcHeartbeat;
exports.toRptDeTimestampValue = toRptDeTimestampValue;
exports.saveZReport = saveZReport;
exports.checkZReport = checkZReport;
exports.saveAndVerifyZReport = saveAndVerifyZReport;
const prisma_1 = require("../lib/prisma");
const config_1 = require("../config");
const logger_1 = __importDefault(require("../utils/logger"));
/** RRA EBM API may require a security_key header for authentication. */
const RRA_SECURITY_KEY = config_1.config.ebm.securityKey || '';
/** Safe JSON stringify for RRA request/response logs (handles circular refs / BigInt). */
function stringifyRraLog(value) {
    try {
        return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    }
    catch {
        return String(value);
    }
}
// ──────────────────────────────────────────────
// VSDC result-code table (RRA VSDC API Documentation v1.0.5 §4.14)
// ──────────────────────────────────────────────
/** `resultCd` values documented by the spec; "000" is the only success code. */
const VSDC_RESULT_MESSAGES = {
    '000': 'It is succeeded',
    '001': 'There is no search result',
    '881': 'Purchase is mandatory',
    '882': 'Purchase code is invalid',
    '883': 'Purchase already used',
    '884': 'Invalid customer TIN was provided',
    '891': 'An error occurred while Request URL is created',
    '892': 'An error occurred while Request Header data is created',
    '893': 'An error occurred while Request Body data is created',
    '894': 'An error regarding server communication occurred',
    '895': 'An error regarding unallowed Request Method occurred',
    '896': 'An error regarding Request Status occurred',
    '899': 'An error regarding Client occurred',
    '900': 'There is no Header information',
    '901': 'It is not valid device',
    '902': 'This device is installed',
    '903': 'Only VSDC device can be verified',
    '910': 'Request parameter error',
    '911': 'There is no request full text',
    '912': 'There is a request Method error',
    '921': 'Sales or sales invoice data which is declared cannot be received',
    '922': 'Sales invoice data can be received after receiving the sales data',
    '990': 'The maximum number of views are exceeded',
    '991': 'There is an error during registration',
    '992': 'There is an error during modification',
    '993': 'There is an error during deletion',
    '994': 'There is an overlapped Data',
    '995': 'There is no downloaded file',
    '999': 'There is an unknown error. Please ask the administrator',
};
function parseVsdcStatusCode(raw) {
    if (!raw || typeof raw !== 'object') {
        return { code: '?', isError: true, isWarning: false, message: 'No response body' };
    }
    const o = raw;
    const code = String(o.resultCd ?? '?');
    const serverMessage = typeof o.resultMsg === 'string' && o.resultMsg.length > 0 ? o.resultMsg : undefined;
    const message = serverMessage ?? VSDC_RESULT_MESSAGES[code] ?? `Unknown VSDC result code ${code}`;
    return {
        code,
        isError: code !== '000' && code !== '?',
        isWarning: false,
        message,
    };
}
// ──────────────────────────────────────────────
// Envelope builder
// ──────────────────────────────────────────────
async function buildVsdcEnvelope(organizationId, branchId) {
    const org = await prisma_1.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
            TIN: true,
            ebmDeviceId: true,
            ebmSerialNo: true,
            name: true,
        },
    });
    if (!org) {
        throw new Error(`Organization ${organizationId} not found`);
    }
    // Prefer per-branch credentials (RRA issues device per branch).
    // Fall back to org-level credentials for single-branch setups not yet migrated.
    let bhfId = config_1.config.ebm.defaultBhfId;
    let sdcId = org.ebmDeviceId ?? '';
    let mrcNo = org.ebmSerialNo ?? '';
    let vsdcUrl;
    if (branchId != null) {
        const branch = await prisma_1.prisma.branch.findUnique({
            where: { id: branchId },
            select: { bhfId: true, ebmDeviceId: true, ebmSerialNo: true, vsdcUrl: true },
        });
        if (branch) {
            if (branch.bhfId)
                bhfId = branch.bhfId;
            if (branch.ebmDeviceId)
                sdcId = branch.ebmDeviceId;
            if (branch.ebmSerialNo)
                mrcNo = branch.ebmSerialNo;
            if (branch.vsdcUrl)
                vsdcUrl = branch.vsdcUrl.replace(/\/$/, '');
        }
    }
    return {
        tin: org.TIN ?? '',
        bhfId,
        sdcId,
        mrcNo,
        dvcSrlNo: mrcNo,
        env: config_1.config.ebm.environment,
        vsdcUrl,
    };
}
/**
 * Every VSDC device across every active taxpayer that the background jobs
 * (heartbeat, Z-report) must talk to.
 *
 * A device is per-branch: a target is emitted for each branch that carries
 * any RRA credential (`bhfId` / `ebmDeviceId` / `ebmSerialNo`). Only when an
 * org has NO configured branch but the org row itself has device credentials
 * is an org-level target emitted (legacy single-branch tenants). Orgs with no
 * credentials anywhere are skipped — there is nothing to be "offline" from.
 */
async function listActiveVsdcDevices(opts = {}) {
    const orgs = await prisma_1.prisma.organization.findMany({
        where: {
            isActive: true,
            TIN: { not: null },
            ...(opts.includeTrainingMode ? {} : { trainingMode: false }),
        },
        select: {
            id: true,
            name: true,
            TIN: true,
            ebmDeviceId: true,
            ebmSerialNo: true,
            branches: {
                where: {
                    status: 'ACTIVE',
                    OR: [
                        { bhfId: { not: null } },
                        { ebmDeviceId: { not: null } },
                        { ebmSerialNo: { not: null } },
                    ],
                },
                select: { id: true, name: true },
            },
        },
    });
    const targets = [];
    for (const org of orgs) {
        const tin = org.TIN ?? '';
        if (org.branches.length > 0) {
            for (const b of org.branches) {
                targets.push({ organizationId: org.id, branchId: b.id, tin, label: `${org.name} / ${b.name}` });
            }
        }
        else if (org.ebmDeviceId || org.ebmSerialNo) {
            targets.push({ organizationId: org.id, branchId: null, tin, label: org.name });
        }
    }
    return targets;
}
/**
 * RRA CIS/VSDC certification §22: the CIS must not issue a receipt of any type
 * unless it is connected to a functioning VSDC unit registered under the same
 * TIN. This guards the pre-conditions the CIS itself controls — a well-formed
 * 9-digit taxpayer TIN and a configured device serial (MRC) — so a checkout is
 * never completed against a device that can only ever be rejected. The
 * "same TIN" match itself is enforced server-side by VSDC (resultCd 901).
 *
 * Returns a human-readable error string when the device is not usable, or
 * `null` when the envelope is fit to submit.
 */
function validateVsdcEnvelope(env) {
    const tin = (env.tin ?? '').trim();
    if (!/^\d{9}$/.test(tin)) {
        return 'Organization TIN is missing or not a valid 9-digit RRA TIN — configure it in Organization Settings before issuing fiscal receipts.';
    }
    if (!(env.mrcNo ?? '').trim() && !(env.dvcSrlNo ?? '').trim()) {
        return 'No RRA EBM/VSDC device serial (MRC) is configured for this organization/branch — configure it before issuing fiscal receipts.';
    }
    return null;
}
// ──────────────────────────────────────────────
// HTTP transport
// ──────────────────────────────────────────────
function authHeader() {
    const { apiKey, apiSecret } = config_1.config.ebm;
    if (apiKey && apiSecret) {
        const token = Buffer.from(`${apiKey}:${apiSecret}`, 'utf8').toString('base64');
        return `Basic ${token}`;
    }
    if (apiKey) {
        return `Bearer ${apiKey}`;
    }
    return undefined;
}
/**
 * VSDC write/lookup bodies carry only `tin` + `bhfId` from the device envelope
 * (RRA VSDC API v1.0.5 JSON samples). `sdcId` / `mrcNo` / `dvcSrlNo` / `env`
 * are CIS-local credentials — spreading them into the body risks resultCd 910.
 */
function vsdcRequestBody(envelope, payload = {}) {
    return { tin: envelope.tin, bhfId: envelope.bhfId, ...payload };
}
async function postToEndpoint(path, body, baseUrl, options = {}) {
    // C3: prefer per-branch URL, fall back to global config
    const base = (baseUrl ?? config_1.config.ebm.apiUrl ?? '').replace(/\/$/, '');
    if (!base) {
        return { success: false, error: 'EBM_API_URL is not configured', rawStatus: 0, rawBody: null };
    }
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    logger_1.default.info(`[RRA][REQ] POST ${url} payload=${stringifyRraLog(body)}`);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), config_1.config.ebm.requestTimeoutMs);
    try {
        const headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
        };
        const auth = authHeader();
        if (auth) {
            headers.Authorization = auth;
        }
        if (RRA_SECURITY_KEY) {
            headers['security_key'] = RRA_SECURITY_KEY;
        }
        const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        const rawText = await res.text();
        let json = null;
        try {
            json = rawText ? JSON.parse(rawText) : null;
        }
        catch {
            json = rawText;
        }
        logger_1.default.info(`[RRA][RES] POST ${url} http=${res.status} body=${stringifyRraLog(json)?.slice(0, 4000)}`);
        if (!res.ok) {
            const detail = json && typeof json === 'object'
                ? String(json.resultMsg ?? json.message ?? '')
                : '';
            return {
                success: false,
                error: `Gateway HTTP ${res.status}${detail ? `: ${detail}` : ''}`,
                rawStatus: res.status,
                rawBody: json,
            };
        }
        // C2: check VSDC business-level status code (STATUS != "0" is a rejection even on HTTP 200)
        const vsdcStatus = parseVsdcStatusCode(json);
        if (vsdcStatus.isError) {
            return {
                success: false,
                error: `VSDC error ${vsdcStatus.code}: ${vsdcStatus.message}`,
                rawStatus: res.status,
                rawBody: json,
            };
        }
        const parsed = parseVsdcResponse(json);
        // Only a sale submission is expected to issue a receipt counter. Product,
        // stock, and lookup endpoints can return a successful `000` response with
        // `data: null`, which must not be treated as a fiscalisation failure.
        if (options.requiresReceiptNumber && !parsed.rcptNo) {
            return { success: false, error: 'Gateway response missing rcptNo', rawStatus: res.status, rawBody: json };
        }
        return { success: true, data: parsed, rawStatus: res.status, rawBody: json };
    }
    catch (e) {
        const message = e instanceof Error ? e.message : 'VSDC request failed';
        logger_1.default.error(`[RRA][ERR] POST ${url} error=${message} payload=${stringifyRraLog(body)}`);
        return { success: false, error: message, rawStatus: 0, rawBody: null };
    }
    finally {
        clearTimeout(t);
    }
}
// ──────────────────────────────────────────────
// Response parser (RRA canonical fields)
// ──────────────────────────────────────────────
/** Parse VSDC's compact `yyyyMMddhhmmss` timestamp into an ISO string `new Date()` can read. */
function parseRraCompactDateTime(s) {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(s);
    if (!m)
        return s;
    const [, y, mo, d, h, mi, se] = m;
    return `${y}-${mo}-${d}T${h}:${mi}:${se}`;
}
/**
 * Parse the response to `/trnsSales/saveSales`:
 * `{ resultCd, resultMsg, resultDt, data: { rcptNo, intrlData, rcptSign, totRcptNo, vsdcRcptPbctDate, sdcId, mrcNo } }`
 * (RRA VSDC API Documentation v1.0.5 §3.3.6.1). There is no QR payload in this
 * response — the CIS builds the QR string itself from these fields.
 */
function parseVsdcResponse(raw) {
    const fallback = {
        rcptNo: '',
        intrlData: '',
        vsdcSignature: '',
        totRcptNo: '',
        sdcId: '',
        sdcDateTime: '',
        mrcNo: '',
    };
    if (!raw || typeof raw !== 'object') {
        return fallback;
    }
    const o = raw;
    const data = (o.data && typeof o.data === 'object' ? o.data : {});
    const pick = (...keys) => {
        for (const k of keys) {
            const v = data[k] ?? o[k];
            if (v !== undefined && v !== null && String(v).length > 0) {
                return String(v);
            }
        }
        return '';
    };
    const rawDateTime = pick('vsdcRcptPbctDate', 'sdcDateTime');
    return {
        rcptNo: pick('rcptNo'),
        intrlData: pick('intrlData'),
        vsdcSignature: pick('rcptSign', 'vsdcSignature'),
        totRcptNo: pick('totRcptNo'),
        sdcId: pick('sdcId'),
        sdcDateTime: rawDateTime ? parseRraCompactDateTime(rawDateTime) : '',
        mrcNo: pick('mrcNo'),
    };
}
// ──────────────────────────────────────────────
// Endpoint-specific API methods
// ──────────────────────────────────────────────
/**
 * POST /saveInvc — Primary invoice, refund, and void fiscalization.
 * operation: "SALE" | "REFUND" | "VOID"
 */
async function saveInvc(envelope, payload) {
    if (config_1.config.ebm.useMock) {
        return mockResult('INVC', envelope.sdcId);
    }
    return postToEndpoint(config_1.config.ebm.salePath || '/trnsSales/saveSales', vsdcRequestBody(envelope, payload), envelope.vsdcUrl, { requiresReceiptNumber: true });
}
/** yyyyMMddHHmmss — the `lastReqDt` format every incremental lookup expects. */
function toRraReqDt(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
async function postLookup(path, envelope, body) {
    const base = (envelope.vsdcUrl ?? config_1.config.ebm.apiUrl ?? '').replace(/\/$/, '');
    if (!base) {
        return { success: false, resultCd: '?', resultMsg: 'EBM_API_URL is not configured', data: null, raw: null };
    }
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    logger_1.default.info(`[RRA][REQ] POST ${url} payload=${stringifyRraLog(body)}`);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), config_1.config.ebm.requestTimeoutMs);
    try {
        const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
        const auth = authHeader();
        if (auth)
            headers.Authorization = auth;
        if (RRA_SECURITY_KEY)
            headers['security_key'] = RRA_SECURITY_KEY;
        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
        const text = await res.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        }
        catch {
            json = text;
        }
        logger_1.default.info(`[RRA][RES] POST ${url} http=${res.status} body=${stringifyRraLog(json)?.slice(0, 4000)}`);
        if (!res.ok) {
            return { success: false, resultCd: String(res.status), resultMsg: `Gateway HTTP ${res.status}`, data: null, raw: json };
        }
        const status = parseVsdcStatusCode(json);
        // resultCd "001" ("There is no search result") is a benign empty result for
        // a lookup, not a failure.
        const ok = status.code === '000' || status.code === '001';
        return {
            success: ok,
            resultCd: status.code,
            resultMsg: status.message,
            data: (json && typeof json === 'object' ? json.data ?? null : null),
            raw: json,
        };
    }
    catch (e) {
        const message = e instanceof Error ? e.message : 'VSDC lookup failed';
        logger_1.default.error(`[RRA][ERR] POST ${url} error=${message} payload=${stringifyRraLog(body)}`);
        return { success: false, resultCd: '?', resultMsg: message, data: null, raw: null };
    }
    finally {
        clearTimeout(t);
    }
}
/** POST /code/selectCodes — the authoritative VSDC code lists, by class (§59). */
function selectCodes(envelope, lastReqDt) {
    if (config_1.config.ebm.useMock) {
        return Promise.resolve({
            success: true, resultCd: '000', resultMsg: 'It is succeeded', raw: null,
            data: { clsList: [{ cdCls: '07', cdClsNm: 'Payment Type', dtlList: [{ cd: '01', cdNm: 'CASH' }, { cd: '06', cdNm: 'MOBILE MONEY' }] }] },
        });
    }
    return postLookup('/code/selectCodes', envelope, { tin: envelope.tin, bhfId: envelope.bhfId, lastReqDt });
}
/** POST /itemClass/selectItemsClass — item classification / UNSPSC list (§61). */
function selectItemsClass(envelope, lastReqDt) {
    if (config_1.config.ebm.useMock) {
        return Promise.resolve({
            success: true, resultCd: '000', resultMsg: 'It is succeeded', raw: null,
            data: { itemClsList: [{ itemClsCd: '5059690800', itemClsNm: 'Generic goods', itemClsLvl: 5, taxTyCd: 'B', useYn: 'Y' }] },
        });
    }
    return postLookup('/itemClass/selectItemsClass', envelope, { tin: envelope.tin, bhfId: envelope.bhfId, lastReqDt });
}
/** POST /customers/selectCustomer — verify a customer TIN against RRA (§62). */
function selectCustomer(envelope, custmTin) {
    if (config_1.config.ebm.useMock) {
        return Promise.resolve({
            success: true, resultCd: '000', resultMsg: 'It is succeeded', raw: null,
            data: { custList: [{ tin: custmTin, taxprNm: 'MOCK TAXPAYER LTD', taxprSttsCd: 'A' }] },
        });
    }
    return postLookup('/customers/selectCustomer', envelope, { tin: envelope.tin, bhfId: envelope.bhfId, custmTin });
}
/** POST /items/selectItems — the taxpayer's item list as held by RRA (§64). */
function selectItems(envelope, lastReqDt) {
    if (config_1.config.ebm.useMock) {
        return Promise.resolve({
            success: true, resultCd: '000', resultMsg: 'It is succeeded', raw: null, data: { itemList: [] },
        });
    }
    return postLookup('/items/selectItems', envelope, { tin: envelope.tin, bhfId: envelope.bhfId, lastReqDt });
}
/** POST /notices/selectNotices — RRA notices for the taxpayer (§65). */
function selectNotices(envelope, lastReqDt) {
    if (config_1.config.ebm.useMock) {
        return Promise.resolve({
            success: true, resultCd: '000', resultMsg: 'It is succeeded', raw: null, data: { noticeList: [] },
        });
    }
    return postLookup('/notices/selectNotices', envelope, { tin: envelope.tin, bhfId: envelope.bhfId, lastReqDt });
}
/**
 * POST /items/saveItems — Product catalog item registration/updates
 * (VSDC API Documentation v1.0.5 §3.2.1 "ItemSaveReq").
 */
async function saveItem(envelope, payload) {
    if (config_1.config.ebm.useMock) {
        return mockResult('ITEM');
    }
    return postToEndpoint(config_1.config.ebm.itemPath || '/items/saveItems', vsdcRequestBody(envelope, payload), envelope.vsdcUrl);
}
/**
 * POST /items/saveItemComposition — BOM / item composition (ItemCpstSaveReq §3.3.4.2).
 * Used for client restore; not selectable back from the server.
 */
async function saveItemComposition(envelope, payload) {
    if (config_1.config.ebm.useMock)
        return mockResult('ITEMCPST');
    return postToEndpoint('/items/saveItemComposition', vsdcRequestBody(envelope, payload), envelope.vsdcUrl);
}
/**
 * @deprecated Not a real VSDC route. Use saveStockItems / saveStockMaster.
 */
async function selectMvmt(_envelope, _payload) {
    return {
        success: false,
        error: 'Deprecated non-spec path /selectMvmt — use /stock/saveStockItems and /stockMaster/saveStockMaster',
        rawStatus: 0,
        rawBody: null,
    };
}
/**
 * @deprecated Wrong path. Use savePurchase (/trnsPurchase/savePurchases).
 */
async function savePurc(_envelope, _payload) {
    return {
        success: false,
        error: 'Deprecated non-spec path /savePurc — use /trnsPurchase/savePurchases',
        rawStatus: 0,
        rawBody: null,
    };
}
// ──────────────────────────────────────────────
// Stock In/Out + Stock Master (RRA checklist §23, §72, §73)
// ──────────────────────────────────────────────
/** POST /stock/saveStockItems — record one stock IN or OUT movement (StockIoSaveReq). */
async function saveStockItems(envelope, payload) {
    if (config_1.config.ebm.useMock)
        return mockResult('STOCKIO');
    return postToEndpoint('/stock/saveStockItems', vsdcRequestBody(envelope, payload), envelope.vsdcUrl);
}
/** POST /stock/selectStockItems — HQ↔branch stock movements (StockMoveReq §3.3.8.1). */
function selectStockItems(envelope, lastReqDt) {
    if (config_1.config.ebm.useMock) {
        return Promise.resolve({
            success: true, resultCd: '000', resultMsg: 'It is succeeded', raw: null, data: { stockList: [] },
        });
    }
    return postLookup('/stock/selectStockItems', envelope, { tin: envelope.tin, bhfId: envelope.bhfId, lastReqDt });
}
/** POST /stockMaster/saveStockMaster — set the remaining on-hand quantity for one item (StockMasterSaveReq). */
async function saveStockMaster(envelope, itemCd, rsdQty, registrant) {
    if (config_1.config.ebm.useMock)
        return mockResult('STOCKMASTER');
    const { vsdcUrl, tin, bhfId } = envelope;
    return postToEndpoint('/stockMaster/saveStockMaster', { tin, bhfId, itemCd, rsdQty, regrId: registrant.id, regrNm: registrant.name, modrId: registrant.id, modrNm: registrant.name }, vsdcUrl);
}
/** POST /trnsPurchase/selectTrnsPurchaseSales — B2B sales issued to this taxpayer (i.e. its purchases). */
function selectPurchases(envelope, lastReqDt) {
    if (config_1.config.ebm.useMock) {
        return Promise.resolve({
            success: true, resultCd: '000', resultMsg: 'It is succeeded', raw: null, data: { saleList: [] },
        });
    }
    return postLookup('/trnsPurchase/selectTrnsPurchaseSales', envelope, { tin: envelope.tin, bhfId: envelope.bhfId, lastReqDt });
}
/** POST /trnsPurchase/savePurchases — record/confirm a received B2B purchase (TrnsPurchaseSaveReq). */
async function savePurchase(envelope, payload) {
    if (config_1.config.ebm.useMock)
        return mockResult('PURCHASE');
    return postToEndpoint('/trnsPurchase/savePurchases', vsdcRequestBody(envelope, payload), envelope.vsdcUrl);
}
/** POST /branches/selectBranches — taxpayer branch list (§3.3.2.4). */
function selectBranches(envelope, lastReqDt) {
    if (config_1.config.ebm.useMock) {
        return Promise.resolve({
            success: true, resultCd: '000', resultMsg: 'It is succeeded', raw: null,
            data: { bhfList: [{ tin: envelope.tin, bhfId: envelope.bhfId, bhfNm: 'HQ', hqYn: 'Y', bhfSttsCd: '01' }] },
        });
    }
    return postLookup('/branches/selectBranches', envelope, { tin: envelope.tin, bhfId: envelope.bhfId, lastReqDt });
}
/** POST /branches/saveBrancheCustomers — push CIS customer master (BhfCustSaveReq §3.3.3.1). */
async function saveBrancheCustomer(envelope, payload) {
    if (config_1.config.ebm.useMock)
        return mockResult('BHFCUST');
    return postToEndpoint('/branches/saveBrancheCustomers', vsdcRequestBody(envelope, payload), envelope.vsdcUrl);
}
/** POST /branches/saveBrancheUsers — push branch user accounts (BhfUserSaveReq §3.3.3.2). */
async function saveBrancheUser(envelope, payload) {
    if (config_1.config.ebm.useMock)
        return mockResult('BHFUSER');
    return postToEndpoint('/branches/saveBrancheUsers', vsdcRequestBody(envelope, payload), envelope.vsdcUrl);
}
/**
 * POST /branches/saveBrancheInsurances — pharmacy insurance companies (BhfInsuranceSaveReq §3.3.3.3).
 * Optional for non-pharmacy CIS tenants.
 */
async function saveBrancheInsurance(envelope, payload) {
    if (config_1.config.ebm.useMock)
        return mockResult('BHFINS');
    return postToEndpoint('/branches/saveBrancheInsurances', vsdcRequestBody(envelope, payload), envelope.vsdcUrl);
}
/**
 * POST /initializer/selectInitInfo — one-time device initialization.
 * Confirms the device (TIN + bhfId + serial) is registered with RRA and returns
 * its SDC id, MRC number, and the last invoice/receipt numbers RRA has on record
 * so the CIS can seed its own sequences without colliding.
 */
function selectInitInfo(envelope) {
    if (config_1.config.ebm.useMock) {
        return Promise.resolve({
            success: true, resultCd: '000', resultMsg: 'It is succeeded', raw: null,
            data: {
                info: {
                    tin: envelope.tin, taxprNm: 'MOCK TAXPAYER LTD', bhfId: envelope.bhfId, bhfNm: 'HQ',
                    sdcId: envelope.sdcId || 'SDC010000001', mrcNo: envelope.mrcNo || 'MRC010000001', dvcId: 'DVC001',
                    lastSaleInvcNo: 0, lastSaleRcptNo: 0, lastInvcNo: 0,
                },
            },
        });
    }
    const { vsdcUrl, tin, bhfId, dvcSrlNo } = envelope;
    return postLookup('/initializer/selectInitInfo', envelope, { tin, bhfId, dvcSrlNo }).then((r) => {
        // Some sandbox builds nest the VO one level deeper under `data.data.info`.
        if (r.success && r.data && !r.data.info && r.raw?.data?.info) {
            return { ...r, data: { info: r.raw.data.info } };
        }
        return r;
    });
}
/** POST /imports/selectImportItems — pending import declaration lines for this taxpayer (§66). */
function selectImportItems(envelope, lastReqDt) {
    if (config_1.config.ebm.useMock) {
        return Promise.resolve({
            success: true, resultCd: '000', resultMsg: 'It is succeeded', raw: null, data: { itemList: [] },
        });
    }
    return postLookup('/imports/selectImportItems', envelope, { tin: envelope.tin, bhfId: envelope.bhfId, lastReqDt });
}
/** POST /imports/updateImportItems — approve/reject one import declaration line (§68). */
async function updateImportItems(envelope, payload) {
    if (config_1.config.ebm.useMock)
        return mockResult('IMPORTUPD');
    return postToEndpoint('/imports/updateImportItems', vsdcRequestBody(envelope, payload), envelope.vsdcUrl);
}
/**
 * POST /selectImportInvc — Import declaration validation hooks.
 */
async function selectImportInvc(envelope, payload) {
    if (config_1.config.ebm.useMock) {
        return mockResult('IMPORT');
    }
    const { vsdcUrl, ...envelopeFields } = envelope;
    return postToEndpoint('/selectImportInvc', { ...envelopeFields, ...payload }, vsdcUrl);
}
/**
 * POST to a configurable status/sync endpoint for heartbeat checks.
 */
async function vsdcHeartbeat(envelope) {
    const statusPath = config_1.config.ebm.statusCheckPath || '/code/selectCodes';
    if (config_1.config.ebm.useMock) {
        return {
            success: true,
            data: {
                rcptNo: 'HEARTBEAT-ACK',
                intrlData: '',
                vsdcSignature: '',
                totRcptNo: '',
                sdcId: '',
                sdcDateTime: new Date().toISOString(),
                mrcNo: '',
            },
            rawStatus: 200,
            rawBody: null,
        };
    }
    const { vsdcUrl, tin, bhfId } = envelope;
    // §3.3.2.1 CodeReq shape — a real, side-effect-free lookup used purely as a
    // liveness probe. `lastReqDt` far in the past just means "give me everything",
    // which is fine since the response itself (not its contents) is what we check.
    return postToEndpoint(statusPath, { tin, bhfId, lastReqDt: '20200101000000' }, vsdcUrl);
}
/**
 * Normalize `rptDe` to the 14-digit `yyyyMMddHHmmss` (`yyyyMMddHH24MISS`)
 * timestamp the VSDC validates against. An 8-digit report date (`yyyyMMdd`,
 * e.g. from `?date=` query params or daily-report code) is expanded to
 * start-of-day (`yyyyMMdd000000`); a 14-digit timestamp passes through
 * unchanged. This fixes VSDC error 910:
 * "Must be a valid date in yyyyMMddHH24MISS format. rejected value: '20260915'".
 */
function toRptDeTimestampValue(rptDe) {
    const digits = (rptDe ?? '').replace(/\D/g, '');
    if (/^\d{8}$/.test(digits))
        return `${digits}000000`;
    return rptDe;
}
/**
 * POST /reports/saveZReports — daily Z (closing) report.
 *
 * Endpoint path and request shape confirmed against the RRA reference sandbox
 * (`ReportExcute.saveReportZ`, `@RequestMapping("/reports")` +
 * `@PostMapping("/saveZReports")`): the client only sends `{tin, bhfId,
 * rptDe}` — the device/edge software computes and stores the day's receipt
 * counts and totals itself from what it already recorded via
 * `/trnsSales/saveSales`, it does not take them as input.
 *
 * `rptDe` here is the **report generation timestamp**, `yyyyMMddHHmmss` (14
 * digits, Oracle `yyyyMMddHH24MISS`). 8-digit dates are normalized to
 * start-of-day via `toRptDeTimestampValue` for robustness.
 *
 * `/reports/saveZReports` has been seen to accept a request without returning a
 * conclusive success body, so callers should not treat a bare `saveZReport`
 * result as proof the day was closed — use `saveAndVerifyZReport`, which
 * confirms the close with `/reports/checkZReport` before recording it.
 */
async function saveZReport(envelope, rptDe) {
    if (config_1.config.ebm.useMock) {
        return mockResult('ZREPORT', envelope.sdcId);
    }
    return postToEndpoint('/reports/saveZReports', { tin: envelope.tin, bhfId: envelope.bhfId, rptDe: toRptDeTimestampValue(rptDe) }, envelope.vsdcUrl);
}
/**
 * POST /reports/checkZReport — look up a previously saved Z report.
 *
 * `rptDe` must be a 14-digit report timestamp (`yyyyMMddHHmmss` /
 * `yyyyMMddHH24MISS`) — the VSDC rejects an 8-digit `yyyyMMdd` date with
 * error 910 ("Must be a valid date in yyyyMMddHH24MISS format"). 8-digit
 * input is therefore normalized to `yyyyMMdd000000` via
 * `toRptDeTimestampValue` so date-only callers (`?date=yyyyMMdd`,
 * daily-report cross-checks) keep working.
 */
async function checkZReport(envelope, rptDe) {
    if (config_1.config.ebm.useMock) {
        return mockResult('ZREPORT-CHECK', envelope.sdcId);
    }
    return postToEndpoint('/reports/checkZReport', { tin: envelope.tin, bhfId: envelope.bhfId, rptDe: toRptDeTimestampValue(rptDe) }, envelope.vsdcUrl);
}
/**
 * Close a day at the VSDC and prove it stuck: POST `/reports/saveZReports`,
 * then immediately confirm with `/reports/checkZReport` using the same
 * 14-digit generation timestamp. A Z close is only trustworthy for
 * certification evidence once `verified` is true; `saved && !verified` means
 * RRA took the request but has not yet surfaced the report and it should be
 * re-checked (via `GET /:org/z-report`).
 */
async function saveAndVerifyZReport(envelope, now = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    const ymd = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
    const rptDeTimestamp = `${ymd}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
    const save = await saveZReport(envelope, rptDeTimestamp);
    // Verify with the exact timestamp just saved: its date part matches the
    // report day (so date-truncating servers verify), and exact-match servers
    // also verify — whereas a midnight-expanded date would fail exact match.
    const check = await checkZReport(envelope, rptDeTimestamp);
    return {
        saved: save.success,
        verified: check.success,
        rptDeTimestamp,
        rptDeDate: ymd,
        saveError: save.success ? undefined : save.error,
        verifyError: check.success ? undefined : check.error,
        raw: { save: save.rawBody, check: check.rawBody },
    };
}
// ──────────────────────────────────────────────
// Mock helper
// ──────────────────────────────────────────────
function mockResult(prefix, sdcId) {
    const ref = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    // rcptNo/totRcptNo must be numeric strings (parsed with parseInt downstream into
    // EbmTransaction.sdcRcptNo/totalRcptNo), so this mirrors the real /trnsSales/saveSales
    // response shape rather than the old free-text ref.
    const rcptNo = String(Math.floor(Date.now() / 1000) % 100000);
    const totRcptNo = String(Math.floor(Date.now() / 1000) % 1000000);
    return {
        success: true,
        data: {
            rcptNo,
            intrlData: `MOCK-INTERNAL-${ref}`,
            vsdcSignature: `MOCK-SIG-${ref}`,
            totRcptNo,
            sdcId: sdcId || 'SDC000000000',
            sdcDateTime: new Date().toISOString(),
            mrcNo: 'MOCKMRC0001',
        },
        rawStatus: 200,
        rawBody: { resultCd: '000', resultMsg: 'It is succeeded', mock: true, data: { rcptNo, totRcptNo } },
    };
}
