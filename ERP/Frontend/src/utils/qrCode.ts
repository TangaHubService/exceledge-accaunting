import QRCode from 'qrcode';

/**
 * D1: RRA QR code utilities (CIS/VSDC spec §4.2)
 *
 * QR string format:
 *   ddmmyyyy#hhmmss#sdcnumber#sdc_receipt_number#internal_data#receipt_signature
 *
 * internalData and receiptSignature are displayed on the receipt with a dash every 4 chars.
 */

export function buildRraQrString(params: {
  sdcDateTime: string | Date;
  sdcId: string;
  sdcRcptNo: number | string;
  internalData: string;
  receiptSignature: string;
}): string {
  const dt = params.sdcDateTime instanceof Date ? params.sdcDateTime : new Date(params.sdcDateTime);
  const dd   = String(dt.getDate()).padStart(2, '0');
  const mm   = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = String(dt.getFullYear());
  const hh   = String(dt.getHours()).padStart(2, '0');
  const min  = String(dt.getMinutes()).padStart(2, '0');
  const ss   = String(dt.getSeconds()).padStart(2, '0');

  return [
    `${dd}${mm}${yyyy}`,
    `${hh}${min}${ss}`,
    params.sdcId,
    String(params.sdcRcptNo),
    params.internalData,
    params.receiptSignature,
  ].join('#');
}

/** Insert a dash every 4 characters for human-readable display on receipts. */
export function dashEvery4(str: string): string {
  return str.replace(/(.{4})(?!$)/g, '$1-');
}

/** Generate a QR code as a base64 PNG data URL from a raw string. */
export async function qrToDataUrl(qrString: string): Promise<string> {
  return QRCode.toDataURL(qrString, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 150,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
}

/**
 * Build the printable QR data URL for a fiscalized sale in one call — composes
 * buildRraQrString() + qrToDataUrl(). Returns null when any required field is
 * missing (not yet fiscalized, or an older row predating one of these columns),
 * so callers can render the "not yet fiscalized" state instead of a broken image.
 */
export async function buildInvoiceQrDataUrl(fiscal: {
  sdcDateTime?: string | null;
  sdcId?: string | null;
  sdcRcptNo?: number | null;
  internalData?: string | null;
  receiptSignature?: string | null;
}): Promise<string | null> {
  if (!fiscal.sdcDateTime || !fiscal.sdcId || fiscal.sdcRcptNo == null || !fiscal.internalData || !fiscal.receiptSignature) {
    return null;
  }
  const qrString = buildRraQrString({
    sdcDateTime: fiscal.sdcDateTime,
    sdcId: fiscal.sdcId,
    sdcRcptNo: fiscal.sdcRcptNo,
    internalData: fiscal.internalData,
    receiptSignature: fiscal.receiptSignature,
  });
  try {
    return await qrToDataUrl(qrString);
  } catch {
    return null;
  }
}
