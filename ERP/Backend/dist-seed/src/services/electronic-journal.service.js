"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildElectronicJournal = buildElectronicJournal;
const rra_ebm_service_1 = require("./rra-ebm.service");
/**
 * C8: Build the EJ_DATA text block sent to VSDC after every fiscal sale.
 * Format follows RRA CIS/VSDC spec §5 (Electronic Journal).
 */
function buildElectronicJournal(sale, rcptLabel, sdc) {
    const now = sdc.sdcDateTime;
    const lines = [];
    lines.push(`EJ_DATA`);
    lines.push(`DATE:${(0, rra_ebm_service_1.toRraDate)(now)} TIME:${(0, rra_ebm_service_1.toRraTime)(now)}`);
    lines.push(`SDC_ID:${sdc.sdcId} MRC:${sdc.mrcNo}`);
    lines.push(`RCPT_NO:${sdc.sdcRcptNo} TYPE:${rcptLabel}`);
    lines.push(`INVC:${sale.invoiceNumber ?? sale.saleNumber}`);
    lines.push(`CUST_TIN:${sale.customer.TIN ?? ''} PHONE:${sale.customer.phone ?? ''}`);
    lines.push(`---ITEMS---`);
    for (const si of sale.saleItems) {
        const name = si.product?.name ?? 'Item';
        const qty = si.quantity;
        const price = (0, rra_ebm_service_1.fix2)(si.unitPrice.toNumber());
        const total = (0, rra_ebm_service_1.fix2)(si.totalPrice.toNumber());
        const tax = (0, rra_ebm_service_1.fix2)(si.taxAmount.toNumber());
        const code = (si.taxCode ?? 'A').toUpperCase();
        lines.push(`${name} x${qty} @${price} =${total} [${code}] TAX:${tax}`);
    }
    lines.push(`---TOTALS---`);
    lines.push(`TOTAL:${(0, rra_ebm_service_1.fix2)(sale.totalAmount.toNumber())}`);
    lines.push(`INT_DATA:${sdc.internalData}`);
    lines.push(`SIGNATURE:${sdc.receiptSignature}`);
    lines.push(`EJ_END`);
    return lines.join('\n');
}
