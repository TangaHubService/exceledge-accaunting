import { prisma } from '../lib/prisma';
import { config } from '../config';
import logger from '../utils/logger';
import {
  buildRraSendReceiptPayload,
  toRraDateTime,
  withBranchSellerAddress,
  type SaleWithRelations,
} from './rra-ebm.service';
import { getRraPaymentCode } from './rra-code.service';

/**
 * RRA EBM 2.1 / OSDC (Online Sales Data Controller) integration.
 *
 * EBM 2.1 uses a two-phase signed protocol. The RRA-certified way to call it is
 * through the **OSDC WAR** RRA issues to the software vendor: the WAR holds the
 * device comms key and performs the SKMM signing, and the app talks to it
 * locally over HTTP(S). That is the recommended path (`OSDC_API_URL` points at
 * the deployed WAR and `OSDC_AUTH_TOKEN` is its configured auth token).
 *
 * Flow:
 *   1. initOsdc()        → POST /selectInitInfo → returns the comms key (cmcKey)
 *   2. saveSalesToOsdc() → POST /saveTrnsSalesOsdc with the signed request
 *
 * Endpoint paths follow the official OSDC spec (RRA OSDC Doc v1.0.1).
 */

export interface OsdcDeviceCreds {
  tin: string;
  bhfId: string;
  dvcSrlNo: string;
}

export interface NormalizedOsdcResult {
  ebmInvoiceNumber?: string;
  receiptQrPayload?: string;
  verificationCode?: string;
  sdcDateTime?: string;
}

const OSDC_ENDPOINTS = {
  init: '/selectInitOsdcInfo',
  saveSales: '/saveTrnsSalesOsdc',
};

/** Device identity is per-branch with an org-level fallback (mirrors VSDC). */
export async function getOsdcCreds(
  organizationId: number,
  branchId?: number | null,
): Promise<OsdcDeviceCreds> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { TIN: true, ebmSerialNo: true },
  });

  let bhfId = config.ebm.defaultBhfId;
  let dvcSrlNo = org?.ebmSerialNo ?? '';

  if (branchId != null) {
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { bhfId: true, ebmSerialNo: true },
    });
    if (branch) {
      if (branch.bhfId) bhfId = branch.bhfId;
      if (branch.ebmSerialNo) dvcSrlNo = branch.ebmSerialNo;
    }
  }

  return {
    tin: org?.TIN ?? '',
    bhfId,
    dvcSrlNo,
  };
}

function baseUrl(): string {
  return (config.ebm.osdcApiUrl || config.ebm.apiUrl || '').replace(/\/$/, '');
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  // WAR install auth token (recommended path). Without it we fall back to the
  // raw RRA request without SKMM signing — which the sandbox rejects.
  if (config.ebm.osdcAuthToken) {
    headers.Authorization = `token ${config.ebm.osdcAuthToken}`;
  }
  return headers;
}

async function osdcPost(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; jsonBody: any | null; rawText: string }> {
  const url = `${baseUrl()}${path}`;
  logger.info(`[RRA][OSDC][REQ] POST ${url} payload=${JSON.stringify(body)}`);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), config.ebm.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const rawText = await res.text();
    let json: any = null;
    try {
      json = rawText ? JSON.parse(rawText) : null;
    } catch {
      json = null;
    }
    logger.info(
      `[RRA][OSDC][RES] POST ${url} http=${res.status} body=${(rawText || JSON.stringify(json) || '').slice(0, 4000)}`,
    );
    return { ok: res.ok, status: res.status, jsonBody: json, rawText };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'OSDC request failed';
    logger.error(`[RRA][OSDC][ERR] POST ${url} error=${message} payload=${JSON.stringify(body)}`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Locally persisted comms key, kept on the device's branch metadata. Returned
 * when the OSDC WAR manages the key internally, some integretions skip it.
 */
async function getStoredCmcKey(
  organizationId: number,
  branchId?: number | null,
): Promise<string | undefined> {
  if (branchId == null) return undefined;
  const b = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { metadata: true },
  });
  const md = (b?.metadata as any) ?? {};
  // New installations store the key under `osdc`. Keep the old `ebm` lookup
  // as a migration fallback so an already-initialised device does not need to
  // be enrolled again after this change.
  return md?.osdc?.cmcKey ?? md?.ebm?.cmcKey;
}

async function storeCmcKey(
  organizationId: number,
  branchId: number | undefined | null,
  cmcKey: string,
): Promise<void> {
  if (branchId == null || !cmcKey) return;
  const b = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { metadata: true },
  });
  const md: any = (b?.metadata as any) ?? {};
  await prisma.branch.update({
    where: { id: branchId },
    data: { metadata: { ...md, osdc: { ...(md.osdc ?? {}), cmcKey } } },
  });
}

/**
 * One-time device initialization. Returns the comms key (cmcKey) RRA uses to
 * authenticate this device. Persist it for subsequent calls.
 */
export async function initOsdc(
  organizationId: number,
  branchId?: number | null,
): Promise<{ success: boolean; cmcKey?: string; error?: string }> {
  if (config.ebm.useMock) {
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
async function ensureCmcKey(
  organizationId: number,
  branchId?: number | null,
): Promise<{ cmcKey?: string; error?: string }> {
  const stored = await getStoredCmcKey(organizationId, branchId);
  if (stored) return { cmcKey: stored };
  const init = await initOsdc(organizationId, branchId);
  if (!init.success) return { error: init.error };
  return { cmcKey: init.cmcKey };
}

export function parseOsdcResponse(json: any): NormalizedOsdcResult {
  const info = json?.data?.info ?? json?.data ?? {};
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = info[k] ?? json[k];
      if (v != null && String(v).length > 0) return String(v);
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
export async function submitSalesToOsdc(params: {
  organizationId: number;
  branchId?: number | null;
  sale: SaleWithRelations;
}): Promise<{ success: boolean; ebmInvoiceNumber?: string; error?: string; response?: any }> {
  if (config.ebm.useMock) {
    return {
      success: true,
      ebmInvoiceNumber: `OSDC-MOCK-${Math.floor(Date.now() / 1000)}`,
    };
  }

  const orgRow = await prisma.organization.findUnique({
    where: { id: params.organizationId },
    select: { TIN: true, name: true, address: true, phone: true },
  });
  if (!orgRow) {
    return { success: false, error: 'Organization not found' };
  }
  const org = await withBranchSellerAddress(orgRow, params.sale.branchId ?? params.branchId);

  const { cmcKey, error } = await ensureCmcKey(params.organizationId, params.branchId);
  if (error && !cmcKey) {
    return { success: false, error };
  }

  let rraPaymentCode: string;
  try {
    rraPaymentCode = await getRraPaymentCode(params.organizationId, params.sale.paymentType);
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : 'Invalid payment method mapping' };
  }

  // Reuse the VSDC payload builder (fields are largely shared) and adjust the
  // EBM 2.1 specifics: body carries device identity, receipt gets a publish
  // date, and each line carries its own tax total.
  let payload: Record<string, any>;
  try {
    payload = buildRraSendReceiptPayload(params.sale, org, rraPaymentCode) as any;
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : 'Invalid sales payload' };
  }
  const creds = await getOsdcCreds(params.organizationId, params.branchId);
  payload.tin = creds.tin;
  payload.bhfId = creds.bhfId;
  payload.dvcSrlNo = creds.dvcSrlNo;
  payload.receipt = {
    ...(payload.receipt ?? {}),
    rcptPbctDt: toRraDateTime(new Date()),
  };
  if (Array.isArray(payload.itemList)) {
    payload.itemList = payload.itemList.map((item: any) => ({
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
