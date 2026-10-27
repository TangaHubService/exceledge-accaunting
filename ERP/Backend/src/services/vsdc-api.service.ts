import { prisma } from '../lib/prisma';
import { config } from '../config';
import logger from '../utils/logger';
import { kigaliWallParts } from './invoice-format.service';

/** RRA EBM API may require a security_key header for authentication. */
const RRA_SECURITY_KEY: string = config.ebm.securityKey || '';

/** Safe JSON stringify for RRA request/response logs (handles circular refs / BigInt). */
function stringifyRraLog(value: unknown, indent?: number): string {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), indent);
  } catch {
    return String(value);
  }
}

// ──────────────────────────────────────────────
// VSDC result-code table (RRA VSDC API Documentation v1.0.5 §4.14)
// ──────────────────────────────────────────────

/** `resultCd` values documented by the spec; "000" is the only success code. */
const VSDC_RESULT_MESSAGES: Record<string, string> = {
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

/**
 * VSDC §4.14 codes are 3-digit strings ("000", "001", …). Some WAR builds
 * JSON-encode them as numbers (`0`, `1`) which would otherwise miss the
 * success / benign-empty checks below.
 */
export function normalizeVsdcResultCd(raw: unknown): string {
  if (raw == null) return '?';
  const s = String(raw).trim();
  if (!s || s === '?') return '?';
  if (/^\d+$/.test(s)) return s.padStart(3, '0');
  return s;
}

export function parseVsdcStatusCode(raw: unknown): {
  code: string;
  isError: boolean;
  isWarning: boolean;
  message: string;
} {
  if (!raw || typeof raw !== 'object') {
    return { code: '?', isError: true, isWarning: false, message: 'No response body' };
  }
  const o = raw as Record<string, unknown>;
  const code = normalizeVsdcResultCd(o.resultCd);
  const serverMessage = typeof o.resultMsg === 'string' && o.resultMsg.length > 0 ? o.resultMsg : undefined;
  const message = serverMessage ?? VSDC_RESULT_MESSAGES[code] ?? `Unknown VSDC result code ${code}`;
  return {
    code,
    // "001" is a benign empty lookup for select* endpoints (handled in postLookup);
    // write endpoints still treat it as a non-success business result.
    isError: code !== '000' && code !== '?',
    isWarning: false,
    message,
  };
}

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface VsdcEnvelope {
  tin: string;
  bhfId: string;
  sdcId: string;
  /** Configured CIS Machine Registration Code of the device (CIS spec Art. 3.2.1). */
  mrcNo: string;
  /** VSDC device serial registered with RRA, sent to /initializer/selectInitInfo. */
  dvcSrlNo: string;
  env: string;
  /** C3: per-branch VSDC endpoint; falls back to config.ebm.apiUrl if absent */
  vsdcUrl?: string;
  /** The organization TIN was reset (CIS §7.2) after this device was last initialized. */
  reinitRequired?: boolean;
}

export interface VsdcResponse {
  /** VSDC's per-receipt-type counter — the "A" half of the required A/B RT counter. */
  rcptNo: string;
  intrlData: string;
  vsdcSignature: string;
  /** All-receipts counter — the "B" half of the required A/B RT counter. Not a QR payload. */
  totRcptNo: string;
  /** VSDC device id — needed client-side to build the printed QR string (CIS spec §7.24.7). */
  sdcId: string;
  sdcDateTime: string;
  /** Device serial (MRC) echoed back by the VSDC on saveSales. */
  mrcNo: string;
}

export interface VsdcApiResult {
  success: boolean;
  data?: VsdcResponse;
  error?: string;
  rawStatus: number;
  rawBody: unknown;
}

// ──────────────────────────────────────────────
// Envelope builder
// ──────────────────────────────────────────────

export async function buildVsdcEnvelope(
  organizationId: number,
  branchId?: number | null,
): Promise<VsdcEnvelope> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      TIN: true,
      ebmDeviceId: true,
      ebmSerialNo: true,
      mrcNo: true,
      name: true,
      ebmTinResetAt: true,
      ebmInitializedAt: true,
    },
  });

  if (!org) {
    throw new Error(`Organization ${organizationId} not found`);
  }
  const initializedSinceReset = (initializedAt: Date | null | undefined) =>
    !org.ebmTinResetAt || (!!initializedAt && initializedAt > org.ebmTinResetAt);
  let reinitRequired = !initializedSinceReset(org.ebmInitializedAt);

  // Prefer per-branch credentials (RRA issues device per branch).
  // Fall back to org-level credentials for single-branch setups not yet migrated.
  let bhfId = config.ebm.defaultBhfId;
  let sdcId = org.ebmDeviceId ?? '';
  let dvcSrlNo = org.ebmSerialNo ?? '';
  let mrcNo = org.mrcNo ?? '';

  let vsdcUrl: string | undefined;

  if (branchId != null) {
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { bhfId: true, ebmDeviceId: true, ebmSerialNo: true, mrcNo: true, vsdcUrl: true, ebmInitializedAt: true },
    });
    if (branch) {
      reinitRequired = !initializedSinceReset(branch.ebmInitializedAt);
      if (branch.bhfId) bhfId = branch.bhfId;
      if (branch.ebmDeviceId) sdcId = branch.ebmDeviceId;
      if (branch.ebmSerialNo) dvcSrlNo = branch.ebmSerialNo;
      if (branch.mrcNo) mrcNo = branch.mrcNo;
      if (branch.vsdcUrl) vsdcUrl = branch.vsdcUrl.replace(/\/$/, '');
    }
  }

  return {
    tin: org.TIN ?? '',
    bhfId,
    sdcId,
    mrcNo,
    dvcSrlNo,
    env: config.ebm.environment,
    vsdcUrl,
    reinitRequired,
  };
}

export interface VsdcDeviceTarget {
  organizationId: number;
  /** null → the org-level fallback device (single-branch setups). */
  branchId: number | null;
  tin: string;
  label: string;
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
export async function listActiveVsdcDevices(
  opts: { includeTrainingMode?: boolean } = {},
): Promise<VsdcDeviceTarget[]> {
  const orgs = await prisma.organization.findMany({
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

  const targets: VsdcDeviceTarget[] = [];
  for (const org of orgs) {
    const tin = org.TIN ?? '';
    if (org.branches.length > 0) {
      for (const b of org.branches) {
        targets.push({ organizationId: org.id, branchId: b.id, tin, label: `${org.name} / ${b.name}` });
      }
    } else if (org.ebmDeviceId || org.ebmSerialNo) {
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
export function validateVsdcEnvelope(env: VsdcEnvelope): string | null {
  const tin = (env.tin ?? '').trim();
  if (!/^\d{9}$/.test(tin)) {
    return 'Organization TIN is missing or not a valid 9-digit RRA TIN — configure it in Organization Settings before issuing fiscal receipts.';
  }
  if (!(env.mrcNo ?? '').trim() && !(env.dvcSrlNo ?? '').trim()) {
    return 'No RRA EBM/VSDC device serial (MRC) is configured for this organization/branch — configure it before issuing fiscal receipts.';
  }
  if (env.reinitRequired) {
    return 'The organization TIN was changed: this VSDC device must be re-initialized under the new TIN before issuing fiscal receipts.';
  }
  return null;
}

// ──────────────────────────────────────────────
// HTTP transport
// ──────────────────────────────────────────────

function authHeader(): string | undefined {
  const { apiKey, apiSecret } = config.ebm;
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
export function vsdcRequestBody(
  envelope: Pick<VsdcEnvelope, 'tin' | 'bhfId'>,
  payload: Record<string, unknown> = {},
): Record<string, unknown> {
  return { tin: envelope.tin, bhfId: envelope.bhfId, ...payload };
}

async function postToEndpoint(
  path: string,
  body: Record<string, unknown>,
  baseUrl?: string,
  options: { requiresReceiptNumber?: boolean } = {},
): Promise<VsdcApiResult> {
  // C3: prefer per-branch URL, fall back to global config
  const base = (baseUrl ?? config.ebm.apiUrl ?? '').replace(/\/$/, '');
  if (!base) {
    return { success: false, error: 'EBM_API_URL is not configured', rawStatus: 0, rawBody: null };
  }

  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const reqTin = typeof body.tin === 'string' ? body.tin : '';
  logger.info(`[RRA][REQ] tin=${reqTin || '—'} POST ${url}`);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), config.ebm.requestTimeoutMs);

  try {
    const headers: Record<string, string> = {
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
    let json: unknown = null;
    try {
      json = rawText ? JSON.parse(rawText) : null;
    } catch {
      json = rawText;
    }

    logger.info(`[RRA][RES] tin=${reqTin || '—'} POST ${url} http=${res.status}`);

    if (!res.ok) {
      const detail = json && typeof json === 'object'
        ? String((json as Record<string, unknown>).resultMsg ?? (json as Record<string, unknown>).message ?? '')
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
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'VSDC request failed';
    logger.error(`[RRA][ERR] POST ${url} error=${message} payload=${stringifyRraLog(body)}`);
    return { success: false, error: message, rawStatus: 0, rawBody: null };
  } finally {
    clearTimeout(t);
  }
}

// ──────────────────────────────────────────────
// Response parser (RRA canonical fields)
// ──────────────────────────────────────────────

/**
 * Parse VSDC's compact `yyyyMMddHHmmss` timestamp into an ISO string `new Date()` can read.
 * VSDC stamps Kigali wall time (UTC+02:00, no DST); the offset is explicit so the
 * stored instant does not depend on the server's timezone.
 */
function parseRraCompactDateTime(s: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) return s;
  const [, y, mo, d, h, mi, se] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${se}+02:00`;
}

/**
 * Parse the response to `/trnsSales/saveSales`:
 * `{ resultCd, resultMsg, resultDt, data: { rcptNo, intrlData, rcptSign, totRcptNo, vsdcRcptPbctDate, sdcId, mrcNo } }`
 * (RRA VSDC API Documentation v1.0.5 §3.3.6.1). There is no QR payload in this
 * response — the CIS builds the QR string itself from these fields.
 */
export function parseVsdcResponse(raw: unknown): VsdcResponse {
  const fallback: VsdcResponse = {
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

  const o = raw as Record<string, unknown>;
  const data = (o.data && typeof o.data === 'object' ? o.data : {}) as Record<string, unknown>;

  const pick = (...keys: string[]): string => {
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

function receiptDataBlock(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const data = o.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>;
  return o;
}

/**
 * Fields a `/trnsSales/saveSales` success body must carry before an NR (or any
 * receipt) may be treated as fiscally confirmed. Missing any of them is not a
 * receipt — counters and signatures are never filled in locally.
 *
 * `training`: a TS/TR (`salesTyCd: "T"`) is confirmed by the same block minus
 * `intrlData`/`rcptSign`, which VSDC leaves empty for training (CIS §6).
 */
export function vsdcReceiptFieldErrors(raw: unknown, opts: { training?: boolean } = {}): string[] {
  const parsed = parseVsdcResponse(raw);
  const missing: string[] = [];
  if (!/^\d+$/.test(parsed.rcptNo) || Number(parsed.rcptNo) <= 0) missing.push('data.rcptNo');
  if (!opts.training && !parsed.intrlData.trim()) missing.push('data.intrlData');
  if (!opts.training && !parsed.vsdcSignature.trim()) missing.push('data.rcptSign');
  if (!/^\d+$/.test(parsed.totRcptNo) || Number(parsed.totRcptNo) <= 0) missing.push('data.totRcptNo');
  if (!parsed.sdcId.trim()) missing.push('data.sdcId');
  if (!parsed.mrcNo.trim()) missing.push('data.mrcNo');
  const rawDt = String(receiptDataBlock(raw).vsdcRcptPbctDate ?? '');
  if (!/^\d{14}$/.test(rawDt)) missing.push('data.vsdcRcptPbctDate');
  else if (!isRealKigaliTimestamp(rawDt, parsed.sdcDateTime)) {
    missing.push('data.vsdcRcptPbctDate');
  }
  return missing;
}

/** True when `iso` parses and lands on exactly the Kigali wall time spelled by `compact` (no calendar rollover). */
function isRealKigaliTimestamp(compact: string, iso: string): boolean {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return false;
  const k = kigaliWallParts(d);
  return `${k.year}${k.month}${k.day}${k.hour}${k.minute}${k.second}` === compact;
}

/** `resultCd` 000 plus a complete receipt block. Anything else is not a confirmation. */
export function assessVsdcReceiptConfirmation(
  raw: unknown,
  opts: { training?: boolean } = {},
): { ok: true; data: VsdcResponse } | { ok: false; error: string } {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'VSDC response is not a JSON object' };
  }
  const status = parseVsdcStatusCode(raw);
  if (status.code !== '000') {
    return { ok: false, error: `VSDC error ${status.code}: ${status.message}` };
  }
  const missing = vsdcReceiptFieldErrors(raw, opts);
  if (missing.length) {
    return {
      ok: false,
      error: `VSDC resultCd 000 but required receipt fields are missing or malformed: ${missing.join(', ')}`,
    };
  }
  return { ok: true, data: parseVsdcResponse(raw) };
}

export type NrFiscalDecision =
  | { confirmed: true; data: VsdcResponse }
  | { confirmed: false; retryable: boolean; error: string };

/**
 * Decide whether a `/trnsSales/saveSales` submission (NS, NR, TS/TR, PS or a
 * cancellation) produced a printable receipt.
 * Timeouts, non-2xx HTTP replies, malformed bodies, business rejections, and
 * resultCd 924 without the original receipt block are not confirmations. 924
 * with a complete block is the only accepted replay — the signature still
 * comes from VSDC.
 *
 * `training`: the same decision for TS/TR/PS documents, which VSDC confirms
 * without intrlData/rcptSign (see `vsdcReceiptFieldErrors`).
 */
export function decideVsdcReceiptResult(result: {
  success: boolean;
  error?: string;
  rawStatus?: number;
  rawBody: unknown;
}, opts: { training?: boolean; docLabel?: string } = {}): NrFiscalDecision {
  const err = result.error ?? '';
  const raw = result.rawBody;
  const noBody = raw == null || raw === '';
  const docLabel = opts.docLabel ?? (opts.training ? 'training receipt' : 'NR receipt');
  const timedOut =
    result.rawStatus === 0 &&
    (noBody || /abort|timeout|timed out|ECONN|ENOTFOUND|fetch failed|network|socket/i.test(err));
  if (timedOut) {
    return {
      confirmed: false,
      retryable: true,
      error: err || `VSDC request timed out — ${docLabel} not confirmed`,
    };
  }
  if (typeof result.rawStatus === 'number' && result.rawStatus !== 0 && (result.rawStatus < 200 || result.rawStatus >= 300)) {
    return {
      confirmed: false,
      retryable: true,
      error: err || `Gateway HTTP ${result.rawStatus} — ${docLabel} not confirmed`,
    };
  }
  if (typeof raw !== 'object' || raw == null || Array.isArray(raw)) {
    return {
      confirmed: false,
      retryable: true,
      error: err || `Malformed VSDC response — ${docLabel} not confirmed`,
    };
  }
  const code = String((raw as Record<string, unknown>).resultCd ?? '');
  if (code === '924') {
    const missing = vsdcReceiptFieldErrors(raw, opts);
    if (!missing.length) return { confirmed: true, data: parseVsdcResponse(raw) };
    return {
      confirmed: false,
      retryable: false,
      error:
        `VSDC resultCd 924 (invoice number already exists) without the complete receipt block (missing ${missing.join(', ')}). ` +
        `The ${docLabel} was not issued and will not be resent under a new invoice number.`,
    };
  }
  const assessed = assessVsdcReceiptConfirmation(raw, opts);
  if (assessed.ok && opts.training && (assessed.data.intrlData.trim() || assessed.data.vsdcSignature.trim())) {
    return {
      confirmed: false,
      retryable: false,
      error:
        `VSDC returned intrlData/rcptSign for a ${docLabel} (rcptNo ${assessed.data.rcptNo}): it was recorded as a signed ` +
        `normal receipt, not training/proforma (CIS §6.3.6). It will not be printed or resent.`,
    };
  }
  if (assessed.ok) return { confirmed: true, data: assessed.data };
  const permanent = code === '910' || code === '884' || code === '921' || code === '922';
  return { confirmed: false, retryable: !permanent, error: err || assessed.error };
}

export const decideNrFiscalResult = decideVsdcReceiptResult;

// ──────────────────────────────────────────────
// Endpoint-specific API methods
// ──────────────────────────────────────────────

/**
 * POST /saveInvc — Primary invoice, refund, and void fiscalization.
 * operation: "SALE" | "REFUND" | "VOID"
 */
export async function saveInvc(
  envelope: VsdcEnvelope,
  payload: Record<string, unknown>,
): Promise<VsdcApiResult> {
  if (config.ebm.useMock) {
    return mockResult('INVC', envelope.sdcId);
  }
  // idempotencyKey is the outbox's own dedupe key, not a TrnsSalesSaveWrReq field.
  const { idempotencyKey: _idempotencyKey, ...wirePayload } = payload;
  return postToEndpoint(
    config.ebm.salePath || '/trnsSales/saveSales',
    vsdcRequestBody(envelope, wirePayload),
    envelope.vsdcUrl,
    { requiresReceiptNumber: true },
  );
}

/**
 * POST the Electronic Journal text after a fiscalized sale (2018 spec Art. 6.5
 * EJ_DATA). The 2023 VSDC API defines no EJ endpoint, so this is used only when
 * EBM_EJ_SYNC_PATH is configured; otherwise the journal stays stored locally
 * (EbmTransaction.journalText) for inspector comparison. Best-effort: a failed
 * POST never fails the fiscalization — the journal text is retained and the
 * caller keeps ejSent=false so a later retry/inspection can resend it.
 */
export async function saveElectronicJournal(
  envelope: VsdcEnvelope,
  payload: { saleId: number; invcNo: number; rcptLabel: string; journalText: string },
): Promise<VsdcApiResult> {
  if (config.ebm.useMock) {
    return mockResult('EJ', envelope.sdcId);
  }
  const path = config.ebm.ejSyncPath || '/ej/saveEj';
  return postToEndpoint(path, vsdcRequestBody(envelope, payload as unknown as Record<string, unknown>), envelope.vsdcUrl);
}

// ──────────────────────────────────────────────
// RRA master-data lookups (RRA VSDC API — Codes / Item Classification /
// Customer / Select Item / Notices). Each returns the parsed `data` block or a
// typed error; the response shapes differ per endpoint so they are not forced
// through parseVsdcResponse.
// ──────────────────────────────────────────────

export interface VsdcLookupResult<T = unknown> {
  success: boolean
  resultCd: string
  resultMsg: string
  data: T | null
  raw: unknown
}

/** yyyyMMddHHmmss — the `lastReqDt` format every incremental lookup expects (Africa/Kigali). */
export function toRraReqDt(d: Date): string {
  const { year, month, day, hour, minute, second } = kigaliWallParts(d)
  return `${year}${month}${day}${hour}${minute}${second}`
}

/** Advance a yyyyMMddHHmmss cursor by one second (string arithmetic, no Date parse). */
export function bumpRraReqDt(lastReqDt: string): string {
  const digits = lastReqDt.replace(/\D/g, '').padEnd(14, '0').slice(0, 14)
  const y = Number(digits.slice(0, 4))
  const mo = Number(digits.slice(4, 6))
  const d = Number(digits.slice(6, 8))
  const h = Number(digits.slice(8, 10))
  const mi = Number(digits.slice(10, 12))
  const s = Number(digits.slice(12, 14))
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, s + 1))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}${p(dt.getUTCHours())}${p(dt.getUTCMinutes())}${p(dt.getUTCSeconds())}`
}

async function postLookup<T = unknown>(
  path: string,
  envelope: VsdcEnvelope,
  body: Record<string, unknown>,
): Promise<VsdcLookupResult<T>> {
  const base = (envelope.vsdcUrl ?? config.ebm.apiUrl ?? '').replace(/\/$/, '')
  if (!base) {
    return { success: false, resultCd: '?', resultMsg: 'EBM_API_URL is not configured', data: null, raw: null }
  }
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
  const reqTin = typeof body.tin === 'string' ? body.tin : ''
  logger.info(`[RRA][REQ] tin=${reqTin || '—'} POST ${url}`)
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), config.ebm.requestTimeoutMs)
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
    const auth = authHeader()
    if (auth) headers.Authorization = auth
    if (RRA_SECURITY_KEY) headers['security_key'] = RRA_SECURITY_KEY

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal })
    const text = await res.text()
    let json: any = null
    try { json = text ? JSON.parse(text) : null } catch { json = text }

    logger.info(`[RRA][RES] tin=${reqTin || '—'} POST ${url} http=${res.status}`)

    if (!res.ok) {
      return { success: false, resultCd: String(res.status), resultMsg: `Gateway HTTP ${res.status}`, data: null, raw: json }
    }
    const status = parseVsdcStatusCode(json)
    // resultCd "001" ("There is no search result") is a benign empty result for
    // a lookup, not a failure.
    const ok = status.code === '000' || status.code === '001'
    return {
      success: ok,
      resultCd: status.code,
      resultMsg: status.message,
      data: (json && typeof json === 'object' ? (json as any).data ?? null : null) as T | null,
      raw: json,
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'VSDC lookup failed'
    logger.error(`[RRA][ERR] POST ${url} error=${message} payload=${stringifyRraLog(body)}`)
    return { success: false, resultCd: '?', resultMsg: message, data: null, raw: null }
  } finally {
    clearTimeout(t)
  }
}

export interface RraCodeClass {
  cdCls: string; cdClsNm?: string; cdClsDesc?: string; useYn?: string
  dtlList?: Array<{ cd: string; cdNm?: string; cdDesc?: string; useYn?: string; srtOrd?: number; userDfnCd1?: string; userDfnCd2?: string; userDfnCd3?: string }>
}
export interface RraItemClassLVO {
  itemClsCd: string; itemClsNm?: string; itemClsLvl?: number; taxTyCd?: string; mjrTgYn?: string; useYn?: string
}
export interface RraCustomerLVO {
  tin: string; taxprNm?: string; taxprSttsCd?: string; prvncNm?: string; dstrtNm?: string; sctrNm?: string; locDesc?: string
}
export interface RraItemLVO {
  tin?: string; itemCd: string; itemClsCd?: string; itemTyCd?: string; itemNm?: string; itemStdNm?: string
  orgnNatCd?: string; pkgUnitCd?: string; qtyUnitCd?: string; taxTyCd?: string; bcd?: string
  dftPrc?: number; useYn?: string; rraModYn?: string
}
export interface RraNoticeLVO {
  noticeNo: number; title?: string; cont?: string; dtlUrl?: string; regrNm?: string; regDt?: string
}

/** POST /code/selectCodes — the authoritative VSDC code lists, by class (§59). */
export function selectCodes(envelope: VsdcEnvelope, lastReqDt: string) {
  if (config.ebm.useMock) {
    return Promise.resolve<VsdcLookupResult<{ clsList: RraCodeClass[] }>>({
      success: true, resultCd: '000', resultMsg: 'It is succeeded', raw: null,
      data: { clsList: [
        { cdCls: '02', cdClsNm: 'Property Type', dtlList: [{ cd: '01', cdNm: 'Hotel', useYn: 'Y', srtOrd: 1 }] },
        { cdCls: '03', cdClsNm: 'Tourism Tax', dtlList: [{ cd: 'TT', cdNm: 'TT-3%', userDfnCd1: '3', useYn: 'Y', srtOrd: 1 }] },
        { cdCls: '04', cdClsNm: 'Taxation Type', dtlList: [
          { cd: 'A', cdNm: 'A-EX', userDfnCd1: '0', useYn: 'Y', srtOrd: 1 },
          { cd: 'B', cdNm: 'B-18.00%', userDfnCd1: '18', useYn: 'Y', srtOrd: 2 },
          { cd: 'C', cdNm: 'C', userDfnCd1: '0', useYn: 'Y', srtOrd: 3 },
          { cd: 'D', cdNm: 'D', userDfnCd1: '0', useYn: 'Y', srtOrd: 4 },
        ] },
        { cdCls: '05', cdClsNm: 'Country', dtlList: [
          { cd: 'KE', cdNm: 'KENYA', useYn: 'Y', srtOrd: 80 },
          { cd: 'RW', cdNm: 'RWANDA', useYn: 'Y', srtOrd: 193 },
        ] },
        { cdCls: '07', cdClsNm: 'Payment Type', dtlList: [
          { cd: '01', cdNm: 'CASH', useYn: 'Y', srtOrd: 1 },
          { cd: '06', cdNm: 'MOBILE MONEY', useYn: 'Y', srtOrd: 6 },
        ] },
        { cdCls: '08', cdClsNm: 'Tourism Tax Type', dtlList: [{ cd: '1', cdNm: 'TT', useYn: 'Y', srtOrd: 1 }] },
        { cdCls: '10', cdClsNm: 'Quantity Unit', dtlList: [
          { cd: 'U', cdNm: 'Pieces / Item', useYn: 'Y' },
          { cd: 'KG', cdNm: 'Kilogram', useYn: 'Y' },
        ] },
        { cdCls: '17', cdClsNm: 'Packing Unit', dtlList: [{ cd: 'CT', cdNm: 'Carton', useYn: 'Y' }] },
        { cdCls: '32', cdClsNm: 'Refund Reason', dtlList: [
          { cd: '06', cdNm: 'Refund', useYn: 'Y', srtOrd: 6 },
          { cd: '13', cdNm: 'Other reason', useYn: 'Y', srtOrd: 13 },
        ] },
      ] },
    })
  }
  return postLookup<{ clsList: RraCodeClass[] }>('/code/selectCodes', envelope, { tin: envelope.tin, bhfId: envelope.bhfId, lastReqDt })
}

/** POST /itemClass/selectItemsClass — item classification / UNSPSC list (§61). */
export function selectItemsClass(envelope: VsdcEnvelope, lastReqDt: string) {
  if (config.ebm.useMock) {
    return Promise.resolve<VsdcLookupResult<{ itemClsList: RraItemClassLVO[] }>>({
      success: true, resultCd: '000', resultMsg: 'It is succeeded', raw: null,
      data: { itemClsList: [{ itemClsCd: '5059690800', itemClsNm: 'Generic goods', itemClsLvl: 5, taxTyCd: 'B', useYn: 'Y' }] },
    })
  }
  return postLookup<{ itemClsList: RraItemClassLVO[] }>('/itemClass/selectItemsClass', envelope, { tin: envelope.tin, bhfId: envelope.bhfId, lastReqDt })
}

/** POST /customers/selectCustomer — verify a customer TIN against RRA (§62). */
export function selectCustomer(envelope: VsdcEnvelope, custmTin: string) {
  if (config.ebm.useMock) {
    return Promise.resolve<VsdcLookupResult<{ custList: RraCustomerLVO[] }>>({
      success: true, resultCd: '000', resultMsg: 'It is succeeded', raw: null,
      data: { custList: [{ tin: custmTin, taxprNm: 'MOCK TAXPAYER LTD', taxprSttsCd: 'A' }] },
    })
  }
  return postLookup<{ custList: RraCustomerLVO[] }>('/customers/selectCustomer', envelope, { tin: envelope.tin, bhfId: envelope.bhfId, custmTin })
}

/** POST /items/selectItems — the taxpayer's item list as held by RRA (§64). */
export function selectItems(envelope: VsdcEnvelope, lastReqDt: string) {
  if (config.ebm.useMock) {
    return Promise.resolve<VsdcLookupResult<{ itemList: RraItemLVO[] }>>({
      success: true, resultCd: '000', resultMsg: 'It is succeeded', raw: null, data: { itemList: [] },
    })
  }
  return postLookup<{ itemList: RraItemLVO[] }>('/items/selectItems', envelope, { tin: envelope.tin, bhfId: envelope.bhfId, lastReqDt })
}

/** POST /notices/selectNotices — RRA notices for the taxpayer (§65). */
export function selectNotices(envelope: VsdcEnvelope, lastReqDt: string) {
  if (config.ebm.useMock) {
    return Promise.resolve<VsdcLookupResult<{ noticeList: RraNoticeLVO[] }>>({
      success: true, resultCd: '000', resultMsg: 'It is succeeded', raw: null, data: { noticeList: [] },
    })
  }
  return postLookup<{ noticeList: RraNoticeLVO[] }>('/notices/selectNotices', envelope, { tin: envelope.tin, bhfId: envelope.bhfId, lastReqDt })
}

/**
 * POST /items/saveItems — Product catalog item registration/updates
 * (VSDC API Documentation v1.0.5 §3.2.1 "ItemSaveReq").
 */
export async function saveItem(
  envelope: VsdcEnvelope,
  payload: Record<string, unknown>,
): Promise<VsdcApiResult> {
  if (config.ebm.useMock) {
    return mockResult('ITEM');
  }
  return postToEndpoint(
    config.ebm.itemPath || '/items/saveItems',
    vsdcRequestBody(envelope, payload),
    envelope.vsdcUrl,
  );
}

/**
 * POST /items/saveItemComposition — BOM / item composition (ItemCpstSaveReq §3.3.4.2).
 * Used for client restore; not selectable back from the server.
 */
export async function saveItemComposition(
  envelope: VsdcEnvelope,
  payload: {
    itemCd: string;
    cpstItemCd: string;
    cpstQty: number;
    regrId: string;
    regrNm: string;
    modrId: string;
    modrNm: string;
  },
): Promise<VsdcApiResult> {
  if (config.ebm.useMock) return mockResult('ITEMCPST');
  return postToEndpoint('/items/saveItemComposition', vsdcRequestBody(envelope, payload), envelope.vsdcUrl);
}

/**
 * @deprecated Not a real VSDC route. Use saveStockItems / saveStockMaster.
 */
export async function selectMvmt(
  _envelope: VsdcEnvelope,
  _payload: Record<string, unknown>,
): Promise<VsdcApiResult> {
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
export async function savePurc(
  _envelope: VsdcEnvelope,
  _payload: Record<string, unknown>,
): Promise<VsdcApiResult> {
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
export async function saveStockItems(envelope: VsdcEnvelope, payload: Record<string, unknown>): Promise<VsdcApiResult> {
  if (config.ebm.useMock) return mockResult('STOCKIO');
  return postToEndpoint('/stock/saveStockItems', vsdcRequestBody(envelope, payload), envelope.vsdcUrl);
}

export interface RraStockMoveLVO {
  custTin?: string | null;
  custBhfId?: string | null;
  sarNo: number;
  ocrnDt?: string;
  totItemCnt?: number;
  totTaxblAmt?: number;
  totTaxAmt?: number;
  totAmt?: number;
  remark?: string | null;
  itemList?: Array<{
    itemSeq: number;
    itemCd?: string;
    itemClsCd?: string;
    itemNm?: string;
    bcd?: string | null;
    pkgUnitCd?: string;
    pkg?: number;
    qtyUnitCd?: string;
    qty: number;
    itemExprDt?: string | null;
    prc?: number;
    splyAmt?: number;
    totDcAmt?: number;
    taxblAmt?: number;
    taxTyCd?: string;
    taxAmt?: number;
    totAmt?: number;
  }>;
}

/** POST /stock/selectStockItems — HQ↔branch stock movements (StockMoveReq §3.3.8.1). */
export function selectStockItems(envelope: VsdcEnvelope, lastReqDt: string) {
  if (config.ebm.useMock) {
    return Promise.resolve<VsdcLookupResult<{ stockList: RraStockMoveLVO[] }>>({
      success: true, resultCd: '000', resultMsg: 'It is succeeded', raw: null, data: { stockList: [] },
    });
  }
  return postLookup<{ stockList: RraStockMoveLVO[] }>(
    '/stock/selectStockItems',
    envelope,
    { tin: envelope.tin, bhfId: envelope.bhfId, lastReqDt },
  );
}

/** POST /stockMaster/saveStockMaster — set the remaining on-hand quantity for one item (StockMasterSaveReq). */
export async function saveStockMaster(
  envelope: VsdcEnvelope,
  itemCd: string,
  rsdQty: number,
  registrant: { id: string; name: string },
): Promise<VsdcApiResult> {
  if (config.ebm.useMock) return mockResult('STOCKMASTER');
  const { vsdcUrl, tin, bhfId } = envelope;
  return postToEndpoint(
    '/stockMaster/saveStockMaster',
    { tin, bhfId, itemCd, rsdQty, regrId: registrant.id, regrNm: registrant.name, modrId: registrant.id, modrNm: registrant.name },
    vsdcUrl,
  );
}

// ──────────────────────────────────────────────
// B2B purchases (RRA checklist §70, §71)
// ──────────────────────────────────────────────

export interface RraPurchaseSalesLVO {
  spplrTin: string; spplrNm?: string; spplrBhfId?: string; spplrInvcNo: number
  rcptTyCd?: string; pmtTyCd?: string; salesDt?: string; totItemCnt?: number
  totTaxblAmt?: number; totTaxAmt?: number; totAmt?: number; remark?: string
  itemList?: Array<{
    itemSeq: number; itemCd?: string; itemClsCd?: string; itemNm?: string; bcd?: string
    pkgUnitCd?: string; pkg?: number; qtyUnitCd?: string; qty: number; prc: number; splyAmt: number
    dcRt?: number; dcAmt?: number; taxTyCd?: string; taxblAmt?: number; taxAmt?: number; totAmt?: number
  }>
}

/** POST /trnsPurchase/selectTrnsPurchaseSales — B2B sales issued to this taxpayer (i.e. its purchases). */
export function selectPurchases(envelope: VsdcEnvelope, lastReqDt: string) {
  if (config.ebm.useMock) {
    return Promise.resolve<VsdcLookupResult<{ saleList: RraPurchaseSalesLVO[] }>>({
      success: true, resultCd: '000', resultMsg: 'It is succeeded', raw: null, data: { saleList: [] },
    });
  }
  return postLookup<{ saleList: RraPurchaseSalesLVO[] }>(
    '/trnsPurchase/selectTrnsPurchaseSales',
    envelope,
    { tin: envelope.tin, bhfId: envelope.bhfId, lastReqDt },
  );
}

/** POST /trnsPurchase/savePurchases — record/confirm a received B2B purchase (TrnsPurchaseSaveReq). */
export async function savePurchase(envelope: VsdcEnvelope, payload: Record<string, unknown>): Promise<VsdcApiResult> {
  if (config.ebm.useMock) return mockResult('PURCHASE');
  return postToEndpoint('/trnsPurchase/savePurchases', vsdcRequestBody(envelope, payload), envelope.vsdcUrl);
}

export interface RraBranchLVO {
  tin?: string;
  bhfId: string;
  bhfNm?: string;
  bhfSttsCd?: string;
  prvncNm?: string;
  dstrtNm?: string;
  sctrNm?: string;
  locDesc?: string | null;
  mgrNm?: string;
  mgrTelNo?: string;
  mgrEmail?: string;
  hqYn?: string;
}

/** POST /branches/selectBranches — taxpayer branch list (§3.3.2.4). */
export function selectBranches(envelope: VsdcEnvelope, lastReqDt: string) {
  if (config.ebm.useMock) {
    return Promise.resolve<VsdcLookupResult<{ bhfList: RraBranchLVO[] }>>({
      success: true, resultCd: '000', resultMsg: 'It is succeeded', raw: null,
      data: { bhfList: [{ tin: envelope.tin, bhfId: envelope.bhfId, bhfNm: 'HQ', hqYn: 'Y', bhfSttsCd: '01' }] },
    });
  }
  return postLookup<{ bhfList: RraBranchLVO[] }>(
    '/branches/selectBranches',
    envelope,
    { tin: envelope.tin, bhfId: envelope.bhfId, lastReqDt },
  );
}

/** POST /branches/saveBrancheCustomers — push CIS customer master (BhfCustSaveReq §3.3.3.1). */
export async function saveBrancheCustomer(
  envelope: VsdcEnvelope,
  payload: Record<string, unknown>,
): Promise<VsdcApiResult> {
  if (config.ebm.useMock) return mockResult('BHFCUST');
  return postToEndpoint('/branches/saveBrancheCustomers', vsdcRequestBody(envelope, payload), envelope.vsdcUrl);
}

/** POST /branches/saveBrancheUsers — push branch user accounts (BhfUserSaveReq §3.3.3.2). */
export async function saveBrancheUser(
  envelope: VsdcEnvelope,
  payload: Record<string, unknown>,
): Promise<VsdcApiResult> {
  if (config.ebm.useMock) return mockResult('BHFUSER');
  return postToEndpoint('/branches/saveBrancheUsers', vsdcRequestBody(envelope, payload), envelope.vsdcUrl);
}

/**
 * POST /branches/saveBrancheInsurances — pharmacy insurance companies (BhfInsuranceSaveReq §3.3.3.3).
 * Optional for non-pharmacy CIS tenants.
 */
export async function saveBrancheInsurance(
  envelope: VsdcEnvelope,
  payload: Record<string, unknown>,
): Promise<VsdcApiResult> {
  if (config.ebm.useMock) return mockResult('BHFINS');
  return postToEndpoint('/branches/saveBrancheInsurances', vsdcRequestBody(envelope, payload), envelope.vsdcUrl);
}

// ──────────────────────────────────────────────
// Import declarations (RRA checklist §66, §67, §68)
// ──────────────────────────────────────────────

export interface RraImportLVO {
  taskCd: string; dclDe: string; itemSeq: number; dclNo?: string; hsCd?: string; itemNm?: string
  imptItemsttsCd?: string; orgnNatCd?: string; exptNatCd?: string
  pkg?: number; pkgUnitCd?: string; qty?: number; qtyUnitCd?: string; totWt?: number; netWt?: number
  spplrNm?: string; agntNm?: string; invcFcurAmt?: number; invcFcurCd?: string; invcFcurExcrt?: number
  itemCd?: string; itemClsCd?: string
}

// ──────────────────────────────────────────────
// VSDC device initialization (RRA checklist §58)
// ──────────────────────────────────────────────

export interface RraInitInfo {
  tin?: string; taxprNm?: string; bsnsActv?: string
  bhfId?: string; bhfNm?: string; bhfOpenDt?: string; hqYn?: string
  prvncNm?: string; dstrtNm?: string; sctrNm?: string; locDesc?: string
  mgrNm?: string; mgrTelNo?: string; mgrEmail?: string
  sdcId?: string; mrcNo?: string; dvcId?: string
  intrlKey?: string; signKey?: string; cmcKey?: string
  lastPchsInvcNo?: number; lastSaleRcptNo?: number; lastInvcNo?: number
  lastSaleInvcNo?: number; lastTrainInvcNo?: number; lastProfrmInvcNo?: number; lastCopyInvcNo?: number
  vatTyCd?: number; ttTyCd?: string
}

/**
 * POST /initializer/selectInitInfo — one-time device initialization.
 * Confirms the device (TIN + bhfId + serial) is registered with RRA and returns
 * its SDC id, MRC number, and the last invoice/receipt numbers RRA has on record
 * so the CIS can seed its own sequences without colliding.
 */
export function selectInitInfo(envelope: VsdcEnvelope) {
  if (config.ebm.useMock) {
    return Promise.resolve<VsdcLookupResult<{ info: RraInitInfo }>>({
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
  return postLookup<{ info: RraInitInfo }>(
    '/initializer/selectInitInfo',
    envelope,
    { tin, bhfId, dvcSrlNo },
  ).then((r) => {
    // Some sandbox builds nest the VO one level deeper under `data.data.info`.
    if (r.success && r.data && !(r.data as any).info && (r.raw as any)?.data?.info) {
      return { ...r, data: { info: (r.raw as any).data.info as RraInitInfo } };
    }
    return r;
  });
}

/** POST /imports/selectImportItems — pending import declaration lines for this taxpayer (§66). */
export function selectImportItems(envelope: VsdcEnvelope, lastReqDt: string) {
  if (config.ebm.useMock) {
    return Promise.resolve<VsdcLookupResult<{ itemList: RraImportLVO[] }>>({
      success: true, resultCd: '000', resultMsg: 'It is succeeded', raw: null, data: { itemList: [] },
    });
  }
  return postLookup<{ itemList: RraImportLVO[] }>(
    '/imports/selectImportItems',
    envelope,
    { tin: envelope.tin, bhfId: envelope.bhfId, lastReqDt },
  );
}

/** POST /imports/updateImportItems — approve/reject one import declaration line (§68). */
export async function updateImportItems(envelope: VsdcEnvelope, payload: Record<string, unknown>): Promise<VsdcApiResult> {
  if (config.ebm.useMock) return mockResult('IMPORTUPD');
  return postToEndpoint('/imports/updateImportItems', vsdcRequestBody(envelope, payload), envelope.vsdcUrl);
}

/**
 * POST /selectImportInvc — Import declaration validation hooks.
 */
export async function selectImportInvc(
  envelope: VsdcEnvelope,
  payload: Record<string, unknown>,
): Promise<VsdcApiResult> {
  if (config.ebm.useMock) {
    return mockResult('IMPORT');
  }
  const { vsdcUrl, ...envelopeFields } = envelope;
  return postToEndpoint('/selectImportInvc', { ...envelopeFields, ...payload }, vsdcUrl);
}

/**
 * POST to a configurable status/sync endpoint for heartbeat checks.
 */
export async function vsdcHeartbeat(
  envelope: VsdcEnvelope,
): Promise<VsdcApiResult> {
  const statusPath = config.ebm.statusCheckPath || '/code/selectCodes';
  if (config.ebm.useMock) {
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
export function toRptDeTimestampValue(rptDe: string): string {
  const digits = (rptDe ?? '').replace(/\D/g, '');
  if (/^\d{8}$/.test(digits)) return `${digits}000000`;
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
export async function saveZReport(
  envelope: VsdcEnvelope,
  rptDe: string,
): Promise<VsdcApiResult> {
  if (config.ebm.useMock) {
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
export async function checkZReport(
  envelope: VsdcEnvelope,
  rptDe: string,
): Promise<VsdcApiResult> {
  if (config.ebm.useMock) {
    return mockResult('ZREPORT-CHECK', envelope.sdcId);
  }
  return postToEndpoint('/reports/checkZReport', { tin: envelope.tin, bhfId: envelope.bhfId, rptDe: toRptDeTimestampValue(rptDe) }, envelope.vsdcUrl);
}

export interface ZReportOutcome {
  /** VSDC accepted the /reports/saveZReports request. */
  saved: boolean;
  /** /reports/checkZReport confirms RRA has the day's Z report on record. */
  verified: boolean;
  /** 14-digit generation timestamp sent to saveZReports (and checkZReport). */
  rptDeTimestamp: string;
  /** 8-digit report date (yyyyMMdd) derived from the timestamp, for display. */
  rptDeDate: string;
  saveError?: string;
  verifyError?: string;
  raw: { save: unknown; check: unknown };
}

/**
 * Close a day at the VSDC and prove it stuck: POST `/reports/saveZReports`,
 * then immediately confirm with `/reports/checkZReport` using the same
 * 14-digit generation timestamp. A Z close is only trustworthy for
 * certification evidence once `verified` is true; `saved && !verified` means
 * RRA took the request but has not yet surfaced the report and it should be
 * re-checked (via `GET /:org/z-report`).
 */
export async function saveAndVerifyZReport(
  envelope: VsdcEnvelope,
  now: Date = new Date(),
): Promise<ZReportOutcome> {
  const p = (n: number) => String(n).padStart(2, '0');
  const ymd = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const rptDeTimestamp = `${ymd}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;

  const save = await saveZReport(envelope, rptDeTimestamp);
  // The local VSDC WAR validates a 14-digit timestamp. The RRA server behind
  // some sandbox builds requires an 8-digit day. Verify with the timestamp
  // first, then with the day if RRA rejects the length.
  let check = await checkZReport(envelope, rptDeTimestamp);
  if (!check.success && /length must be between 8 and 8/i.test(check.error ?? '')) {
    check = await checkZReport(envelope, ymd);
  }

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

function mockResult(prefix: string, sdcId?: string): VsdcApiResult {
  const ref = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  // rcptNo/totRcptNo must be numeric strings (parsed with parseInt downstream into
  // EbmTransaction.sdcRcptNo/totalRcptNo), so this mirrors the real /trnsSales/saveSales
  // response shape rather than the old free-text ref.
  const rcptNo = String(Math.floor(Date.now() / 1000) % 100000);
  const totRcptNo = String(Math.floor(Date.now() / 1000) % 1000000);
  const k = kigaliWallParts(new Date());
  const published = `${k.year}${k.month}${k.day}${k.hour}${k.minute}${k.second}`;
  const block = {
    rcptNo: Number(rcptNo),
    intrlData: `MOCK-INTERNAL-${ref}`,
    rcptSign: `MOCK-SIG-${ref}`,
    totRcptNo: Number(totRcptNo),
    vsdcRcptPbctDate: published,
    sdcId: sdcId || 'SDC000000000',
    mrcNo: 'MOCKMRC0001',
  };
  const rawBody = { resultCd: '000', resultMsg: 'It is succeeded', resultDt: published, mock: true, data: block };
  return {
    success: true,
    data: parseVsdcResponse(rawBody),
    rawStatus: 200,
    rawBody,
  };
}
