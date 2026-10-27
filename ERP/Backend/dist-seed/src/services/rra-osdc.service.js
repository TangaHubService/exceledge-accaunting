"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOsdcCreds = getOsdcCreds;
exports.initOsdc = initOsdc;
exports.parseOsdcResponse = parseOsdcResponse;
exports.submitSalesToOsdc = submitSalesToOsdc;
const prisma_1 = require("../lib/prisma");
const config_1 = require("../config");
const logger_1 = __importDefault(require("../utils/logger"));
const rra_ebm_service_1 = require("./rra-ebm.service");
const rra_code_service_1 = require("./rra-code.service");
const OSDC_ENDPOINTS = {
    init: '/selectInitOsdcInfo',
    saveSales: '/saveTrnsSalesOsdc',
};
/** Device identity is per-branch with an org-level fallback (mirrors VSDC). */
async function getOsdcCreds(organizationId, branchId) {
    const org = await prisma_1.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { TIN: true, ebmSerialNo: true },
    });
    let bhfId = config_1.config.ebm.defaultBhfId;
    let dvcSrlNo = org?.ebmSerialNo ?? '';
    if (branchId != null) {
        const branch = await prisma_1.prisma.branch.findUnique({
            where: { id: branchId },
            select: { bhfId: true, ebmSerialNo: true },
        });
        if (branch) {
            if (branch.bhfId)
                bhfId = branch.bhfId;
            if (branch.ebmSerialNo)
                dvcSrlNo = branch.ebmSerialNo;
        }
    }
    return {
        tin: org?.TIN ?? '',
        bhfId,
        dvcSrlNo,
    };
}
function baseUrl() {
    return (config_1.config.ebm.osdcApiUrl || config_1.config.ebm.apiUrl || '').replace(/\/$/, '');
}
function buildHeaders() {
    const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
    };
    // WAR install auth token (recommended path). Without it we fall back to the
    // raw RRA request without SKMM signing — which the sandbox rejects.
    if (config_1.config.ebm.osdcAuthToken) {
        headers.Authorization = `token ${config_1.config.ebm.osdcAuthToken}`;
    }
    return headers;
}
async function osdcPost(path, body) {
    const url = `${baseUrl()}${path}`;
    logger_1.default.info(`[RRA][OSDC][REQ] POST ${url} payload=${JSON.stringify(body)}`);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), config_1.config.ebm.requestTimeoutMs);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        const rawText = await res.text();
        let json = null;
        try {
            json = rawText ? JSON.parse(rawText) : null;
        }
        catch {
            json = null;
        }
        logger_1.default.info(`[RRA][OSDC][RES] POST ${url} http=${res.status} body=${(rawText || JSON.stringify(json) || '').slice(0, 4000)}`);
        return { ok: res.ok, status: res.status, jsonBody: json, rawText };
    }
    catch (e) {
        const message = e instanceof Error ? e.message : 'OSDC request failed';
        logger_1.default.error(`[RRA][OSDC][ERR] POST ${url} error=${message} payload=${JSON.stringify(body)}`);
        throw e;
    }
    finally {
        clearTimeout(t);
    }
}
/**
 * Locally persisted comms key, kept on the device's branch metadata. Returned
 * when the OSDC WAR manages the key internally, some integretions skip it.
 */
async function getStoredCmcKey(organizationId, branchId) {
    if (branchId == null)
        return undefined;
    const b = await prisma_1.prisma.branch.findUnique({
        where: { id: branchId },
        select: { metadata: true },
    });
    const md = b?.metadata ?? {};
    // New installations store the key under `osdc`. Keep the old `ebm` lookup
    // as a migration fallback so an already-initialised device does not need to
    // be enrolled again after this change.
    return md?.osdc?.cmcKey ?? md?.ebm?.cmcKey;
}
async function storeCmcKey(organizationId, branchId, cmcKey) {
    if (branchId == null || !cmcKey)
        return;
    const b = await prisma_1.prisma.branch.findUnique({
        where: { id: branchId },
        select: { metadata: true },
    });
    const md = b?.metadata ?? {};
    await prisma_1.prisma.branch.update({
        where: { id: branchId },
        data: { metadata: { ...md, osdc: { ...(md.osdc ?? {}), cmcKey } } },
    });
}
/**
 * One-time device initialization. Returns the comms key (cmcKey) RRA uses to
 * authenticate this device. Persist it for subsequent calls.
 */
async function initOsdc(organizationId, branchId) {
    if (config_1.config.ebm.useMock) {
        return { success: true, cmcKey: 'MOCK-CMC-KEY' };
    }
    const creds = await getOsdcCreds(organizationId, branchId);
    const { status, jsonBody } = await osdcPost(OSDC_ENDPOINTS.init, {
        tin: creds.tin,
        bhfId: creds.bhfId,
        dvcSrlNo: creds.dvcSrlNo,
    });
    const resultCd = jsonBody?.resultCd;
    if (resultCd && resultCd !== '000') {
        return { success: false, error: `OSDC init error ${resultCd}: ${jsonBody?.resultMsg ?? ''}` };
    }
    if (status < 200 || status >= 300) {
        return { success: false, error: `OSDC init HTTP ${status}` };
    }
    const info = jsonBody?.data?.info ?? jsonBody?.data ?? {};
    const cmcKey = info?.cmcKey ?? jsonBody?.cmcKey;
    if (cmcKey) {
        await storeCmcKey(organizationId, branchId, cmcKey);
    }
    return { success: true, cmcKey };
}
/** Resolve a valid comms key: stored, else initialize. */
async function ensureCmcKey(organizationId, branchId) {
    const stored = await getStoredCmcKey(organizationId, branchId);
    if (stored)
        return { cmcKey: stored };
    const init = await initOsdc(organizationId, branchId);
    if (!init.success)
        return { error: init.error };
    return { cmcKey: init.cmcKey };
}
function parseOsdcResponse(json) {
    const info = json?.data?.info ?? json?.data ?? {};
    const pick = (...keys) => {
        for (const k of keys) {
            const v = info[k] ?? json[k];
            if (v != null && String(v).length > 0)
                return String(v);
        }
        return undefined;
    };
    return {
        ebmInvoiceNumber: pick('rcptNo', 'ebmInvoiceNumber', 'sdcInvcNo', 'num'),
        receiptQrPayload: pick('QR_CODE', 'qrCode'),
        verificationCode: pick('ysdcregsig', 'verificationCode', 'sdcIntrlData'),
        sdcDateTime: pick('vsdcRcptPbctDate', 'sdcTime'),
    };
}
/**
 * Submit a sale to the OSDC device (`/saveTrnsSalesOsdc`).
 * Returns a normalised EBM invoice reference on success.
 */
async function submitSalesToOsdc(params) {
    if (config_1.config.ebm.useMock) {
        return {
            success: true,
            ebmInvoiceNumber: `OSDC-MOCK-${Math.floor(Date.now() / 1000)}`,
        };
    }
    const org = await prisma_1.prisma.organization.findUnique({
        where: { id: params.organizationId },
        select: { TIN: true, name: true, address: true },
    });
    if (!org) {
        return { success: false, error: 'Organization not found' };
    }
    const { cmcKey, error } = await ensureCmcKey(params.organizationId, params.branchId);
    if (error && !cmcKey) {
        return { success: false, error };
    }
    let rraPaymentCode;
    try {
        rraPaymentCode = await (0, rra_code_service_1.getRraPaymentCode)(params.organizationId, params.sale.paymentType);
    }
    catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'Invalid payment method mapping' };
    }
    // Reuse the VSDC payload builder (fields are largely shared) and adjust the
    // EBM 2.1 specifics: body carries device identity, receipt gets a publish
    // date, and each line carries its own tax total.
    let payload;
    try {
        payload = (0, rra_ebm_service_1.buildRraSendReceiptPayload)(params.sale, org, rraPaymentCode);
    }
    catch (e) {
        return { success: false, error: e instanceof Error ? e.message : 'Invalid sales payload' };
    }
    const creds = await getOsdcCreds(params.organizationId, params.branchId);
    payload.tin = creds.tin;
    payload.bhfId = creds.bhfId;
    payload.dvcSrlNo = creds.dvcSrlNo;
    payload.receipt = {
        ...(payload.receipt ?? {}),
        rcptPbctDt: (0, rra_ebm_service_1.toRraDateTime)(new Date()),
    };
    if (Array.isArray(payload.itemList)) {
        payload.itemList = payload.itemList.map((item) => ({
            ...item,
            totTaxAmt: item.taxAmt,
        }));
    }
    const { status, jsonBody, rawText } = await osdcPost(OSDC_ENDPOINTS.saveSales, payload);
    const resultCd = jsonBody?.resultCd;
    if (status >= 200 && status < 300 && (!resultCd || resultCd === '000')) {
        const normalized = parseOsdcResponse(jsonBody);
        return {
            success: true,
            ebmInvoiceNumber: normalized.ebmInvoiceNumber,
            response: jsonBody,
        };
    }
    return {
        success: false,
        error: `OSDC save error ${resultCd ?? status}: ${jsonBody?.resultMsg ?? rawText}`,
        response: jsonBody,
    };
}
