import { config } from '../config';

/**
 * CIS spec Art. 3.2.1 MRC: BBBCCNNNNNN (POS: developer id + certificate + serial)
 * or AAABBNNNNNN (cash register: manufacturer id + certificate + serial).
 */
export const MRC_PATTERN = /^[A-Z0-9]{3}[A-Z0-9]{2}[0-9]{6}$/;

/** Exactly 11 characters in every environment — never fewer, never more. */
export const MRC_LENGTH = 11;
const MRC_LENGTH_PATTERN = /^[A-Z0-9]{11}$/;

export const MRC_FORMAT_ERROR =
  'Invalid MRC number format. Must be exactly 11 characters: BBBCCNNNNNN (3 developer + 2 certificate + 6 serial digits).';
export const MRC_FORMAT_ERROR_CODE = 'INVALID_MRC_FORMAT';

export class MrcFormatError extends Error {
  readonly statusCode = 400;
  readonly code = MRC_FORMAT_ERROR_CODE;
  constructor() {
    super(MRC_FORMAT_ERROR);
    this.name = 'MrcFormatError';
  }
}

/** RRA test-issued codes don't follow the production BBBCCNNNNNN layout (the 11-character length still applies). */
export function isMrcValidationRelaxed(): boolean {
  return config.ebm.environment === 'sandbox' || config.ebm.useMock;
}

export type MrcCheckResult =
  | { ok: true; value: string | null | undefined }
  | { ok: false; error: string; code: typeof MRC_FORMAT_ERROR_CODE };

export interface MrcCheckOptions {
  /** Defaults to `isMrcValidationRelaxed()`. */
  relaxed?: boolean;
  /**
   * Values already stored (e.g. written by VSDC init). Clients resubmit the
   * whole form, so an unchanged stored value must not block unrelated edits
   * on the BBBCCNNNNNN layout — the 11-character length is never waived.
   */
  current?: Array<string | null | undefined>;
}

/** Whether a value is an acceptable MRC length/charset (11 letters or digits). */
export function hasMrcLength(value: string | null | undefined): boolean {
  return MRC_LENGTH_PATTERN.test((value ?? '').trim().toUpperCase());
}

/**
 * Normalizes (trim + uppercase) and format-checks a configured MRC.
 * `undefined` = field not supplied; `null`/blank = clear the MRC.
 */
export function checkMrc(value: unknown, opts: MrcCheckOptions = {}): MrcCheckResult {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: null };
  const normalized = String(value).trim().toUpperCase();
  if (normalized === '') return { ok: true, value: null };
  if (!MRC_LENGTH_PATTERN.test(normalized)) {
    return { ok: false, error: MRC_FORMAT_ERROR, code: MRC_FORMAT_ERROR_CODE };
  }
  const relaxed = opts.relaxed ?? isMrcValidationRelaxed();
  const unchanged = (opts.current ?? []).some((c) => c != null && c.trim().toUpperCase() === normalized);
  if (!relaxed && !unchanged && !MRC_PATTERN.test(normalized)) {
    return { ok: false, error: MRC_FORMAT_ERROR, code: MRC_FORMAT_ERROR_CODE };
  }
  return { ok: true, value: normalized };
}

/** Same as `checkMrc` but throws `MrcFormatError` (statusCode 400) on bad input. */
export function normalizeMrcOrThrow(value: unknown, opts?: MrcCheckOptions): string | null | undefined {
  const result = checkMrc(value, opts);
  if (!result.ok) throw new MrcFormatError();
  return result.value;
}

function initInfoMrc(ebmInitInfo: unknown): string | null {
  if (!ebmInitInfo || typeof ebmInitInfo !== 'object' || Array.isArray(ebmInitInfo)) return null;
  const mrc = (ebmInitInfo as Record<string, unknown>).mrcNo;
  return typeof mrc === 'string' && mrc.trim() ? mrc.trim() : null;
}

const blankToNull = (v?: string | null): string | null => (v && v.trim() ? v.trim() : null);

/** The MRC configured for a device (CIS spec Art. 3.2.1): branch first, then the org-level fallback. */
export function configuredMrc(
  branch?: { mrcNo?: string | null } | null,
  org?: { mrcNo?: string | null } | null,
): string | null {
  return blankToNull(branch?.mrcNo) || blankToNull(org?.mrcNo);
}

/**
 * MRC to print on fiscal reports and unsigned receipts: the configured device
 * MRC, then the value VSDC reported at device init, then the legacy device
 * serials for setups configured before MRC had its own field.
 */
export function resolveReportMrc(
  branch?: { mrcNo?: string | null; ebmInitInfo?: unknown; ebmSerialNo?: string | null } | null,
  org?: { mrcNo?: string | null; ebmSerialNo?: string | null } | null,
): string | null {
  return (
    blankToNull(branch?.mrcNo) ||
    initInfoMrc(branch?.ebmInitInfo) ||
    blankToNull(org?.mrcNo) ||
    blankToNull(branch?.ebmSerialNo) ||
    blankToNull(org?.ebmSerialNo) ||
    null
  );
}

/** Configured MRC that disagrees with the one VSDC reports for the device, or null when they agree. */
export function mrcMismatch(configured: string | null | undefined, reported: string | null | undefined): string | null {
  const c = blankToNull(configured);
  const r = blankToNull(reported);
  if (!c || !r || c.toUpperCase() === r.toUpperCase()) return null;
  return `Configured MRC ${c} differs from the MRC ${r} VSDC reports for this device — correct the device MRC to match the RRA registration.`;
}
