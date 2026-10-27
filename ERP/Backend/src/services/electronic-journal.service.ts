import { toRraDate, toRraTime, fix2 } from './rra-ebm.service';
import type { SaleWithRelations } from './rra-ebm.service';
import { isTrainingLabel } from './training-mode.service';

export interface SdcData {
  sdcId: string;
  mrcNo: string;
  sdcRcptNo: number;
  internalData: string;
  receiptSignature: string;
  sdcDateTime: Date;
  /** Original NS invcNo (VSDC orgInvcNo) — refunds only. */
  orgInvcNo?: number | null;
  rfdRsnCd?: string | null;
  refundReason?: string | null;
}

/**
 * C8: Build the EJ_DATA text block for every fiscal sale.
 * Format follows RRA CIS/VSDC spec §5 (Electronic Journal). The text is always
 * stored on the fiscal record (EbmTransaction.journalText); it is additionally
 * transmitted to the VSDC when EBM_EJ_SYNC_PATH is configured (2018 Art. 6.5),
 * and EbmTransaction.ejSent tracks transmission (not storage).
 */
export function buildElectronicJournal(
  sale: SaleWithRelations,
  rcptLabel: string,
  sdc: SdcData,
): string {
  const now = sdc.sdcDateTime;
  const lines: string[] = [];

  lines.push(`EJ_DATA`);
  lines.push(`DATE:${toRraDate(now)} TIME:${toRraTime(now)}`);
  lines.push(`SDC_ID:${sdc.sdcId} MRC:${sdc.mrcNo}`);
  lines.push(`RCPT_NO:${sdc.sdcRcptNo} TYPE:${rcptLabel}`);
  lines.push(`INVC:${sale.invoiceNumber ?? sale.saleNumber}`);
  if (rcptLabel.endsWith('R')) {
    if (sdc.orgInvcNo) lines.push(`ORG_INVC:${sdc.orgInvcNo}`);
    if (sdc.rfdRsnCd) lines.push(`RFD_RSN:${sdc.rfdRsnCd}`);
    if (sdc.refundReason) lines.push(`RFD_NOTE:${sdc.refundReason}`);
  }
  lines.push(`CUST_TIN:${sale.customer.TIN ?? ''} PHONE:${sale.customer.phone ?? ''}`);
  lines.push(`---ITEMS---`);

  for (const si of sale.saleItems) {
    const name = si.product?.name ?? 'Item';
    const qty = si.quantity;
    const price = fix2(si.unitPrice.toNumber());
    const total = fix2(si.totalPrice.toNumber());
    const tax = fix2(si.taxAmount.toNumber());
    const code = (si.taxCode ?? 'A').toUpperCase();
    lines.push(`${name} x${qty} @${price} =${total} [${code}] TAX:${tax}`);
  }

  lines.push(`---TOTALS---`);
  lines.push(`TOTAL:${fix2(sale.totalAmount.toNumber())}`);
  if (isTrainingLabel(rcptLabel)) {
    // CIS §6: VSDC issues no internal data / signature for training receipts.
    lines.push(`TRAINING MODE - THIS IS NOT AN OFFICIAL RECEIPT`);
  } else if (rcptLabel === 'PS') {
    lines.push(`PROFORMA - THIS IS NOT AN OFFICIAL RECEIPT`);
  } else {
    lines.push(`INT_DATA:${sdc.internalData}`);
    lines.push(`SIGNATURE:${sdc.receiptSignature}`);
  }
  lines.push(`EJ_END`);

  return lines.join('\n');
}
