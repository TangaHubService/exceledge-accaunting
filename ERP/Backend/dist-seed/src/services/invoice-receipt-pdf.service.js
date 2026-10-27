"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateEbmReceiptPdf80mm = generateEbmReceiptPdf80mm;
const pdfkit_1 = __importDefault(require("pdfkit"));
const invoice_format_service_1 = require("./invoice-format.service");
const invoice_logo_service_1 = require("./invoice-logo.service");
const system_branding_service_1 = require("./system-branding.service");
const invoice_pdf_service_1 = require("./invoice-pdf.service");
/**
 * Narrow, continuous "thermal roll" layout for 80mm POS printers — the
 * classic CIS/VSDC receipt format shown in the technical spec's own worked
 * examples (§13–17), as an alternative to the A4 sheet from
 * invoice-pdf.service.ts. Both renderers consume the same RenderInvoicePayload,
 * so nothing about how a sale is composed changes between formats.
 */
// 80mm paper at 72pt/inch, with a small margin on each side for the printer's
// unprintable edge — matches what real thermal printers leave blank.
const PAGE_WIDTH = 226.77;
const MARGIN = 10;
const CONTENT_LEFT = MARGIN;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN;
const FONT = "Courier";
const FONT_BOLD = "Courier-Bold";
// Generous scratch height for the measuring pass; the real page is sized to
// the exact content height this pass reports.
const MEASURE_HEIGHT = 4000;
function dashedLine(doc, y) {
    doc.moveTo(CONTENT_LEFT, y).lineTo(CONTENT_RIGHT, y).dash(1.5, { space: 1.2 }).stroke().undash();
}
function centeredText(doc, text, y, bold = false, size = 6.4) {
    doc.font(bold ? FONT_BOLD : FONT).fontSize(size);
    doc.text(text, CONTENT_LEFT, y, { width: CONTENT_WIDTH, align: "center" });
    return y + doc.heightOfString(text, { width: CONTENT_WIDTH }) + 1;
}
/** Left-aligned label + right-aligned value on the same line, like a receipt column pair. */
function labelValueLine(doc, label, value, y, bold = false) {
    doc.font(bold ? FONT_BOLD : FONT).fontSize(6.2);
    doc.text(label, CONTENT_LEFT, y, { width: CONTENT_WIDTH * 0.55, align: "left" });
    doc.text(value, CONTENT_LEFT, y, { width: CONTENT_WIDTH, align: "right" });
    return y + Math.max(doc.heightOfString(label, { width: CONTENT_WIDTH * 0.55 }), 8) + 1;
}
function wrappedLine(doc, text, y, size = 6.2) {
    doc.font(FONT).fontSize(size);
    doc.text(text, CONTENT_LEFT, y, { width: CONTENT_WIDTH });
    return y + doc.heightOfString(text, { width: CONTENT_WIDTH }) + 1;
}
/**
 * Draws the whole receipt starting at `startY` and returns the final y
 * position. Called twice: once on a tall scratch page purely to learn the
 * total content height, then again on the real, exactly-sized page.
 */
function drawReceipt(doc, data, companyLogo, certificationLogo, startY) {
    let y = startY;
    // Same two logos as the A4 layout (invoice-pdf.service.ts drawHeader):
    // the RRA logo on the left, the EBM certification seal on the right —
    // just stacked side by side instead of flanking the full-width company
    // block, since 80mm paper has no room for that.
    const logoSize = 28;
    let usedLogoRow = false;
    if (companyLogo) {
        try {
            doc.image(companyLogo, CONTENT_LEFT, y, { fit: [logoSize, logoSize] });
            usedLogoRow = true;
        }
        catch {
            // Logo is best-effort on the compact layout; text content always prints.
        }
    }
    if (certificationLogo) {
        try {
            doc.image(certificationLogo, CONTENT_RIGHT - logoSize, y, { fit: [logoSize, logoSize] });
            usedLogoRow = true;
        }
        catch {
            // Logo is best-effort on the compact layout; text content always prints.
        }
    }
    if (usedLogoRow)
        y += logoSize + 4;
    y = centeredText(doc, (0, invoice_pdf_service_1.safe)(data.company.name, "—"), y, true, 7.5);
    if (data.company.address)
        y = centeredText(doc, (0, invoice_pdf_service_1.safe)(data.company.address), y);
    if (data.company.phone)
        y = centeredText(doc, `TEL: ${(0, invoice_pdf_service_1.safe)(data.company.phone)}`, y);
    y = centeredText(doc, `TIN: ${(0, invoice_pdf_service_1.safe)(data.company.tin, "-")}`, y);
    const indicator = (0, invoice_pdf_service_1.documentIndicator)(data);
    const isTraining = indicator === system_branding_service_1.TRAINING_MODE_LABEL;
    const isProforma = indicator === "PROFORMA";
    if (indicator) {
        y += 2;
        // CIS §11: designation COPY/TRAINING/PROFORMA must dominate amount text.
        y = centeredText(doc, indicator, y, true, 12);
    }
    // Real sale printed before VSDC confirmed it — spell out that the slip is
    // provisional right under the NOT FISCALISED title.
    if (data.invoice.notFiscalized) {
        y = centeredText(doc, system_branding_service_1.NOT_FISCALIZED_NOTICE, y, true, 6);
    }
    // A copied refund (watermark title "COPY") is still a refund and keeps its
    // reference to the original sale, independent of which title printed above.
    if ((0, invoice_pdf_service_1.isRefundTransaction)(data)) {
        if (data.invoice.originalReceiptNumber) {
            y = centeredText(doc, `REF. NORMAL RECEIPT#: ${(0, invoice_pdf_service_1.safe)(data.invoice.originalReceiptNumber)}`, y);
        }
        y = centeredText(doc, system_branding_service_1.REFUND_NOTICE, y, true);
    }
    y += 2;
    dashedLine(doc, y);
    y += 5;
    // RRA checklist §35: TIN, name, and mobile contact must always be shown,
    // labels included even when a field is blank — never drop the whole line.
    y = centeredText(doc, `Client: ${(0, invoice_pdf_service_1.safe)(data.customer.name)}`, y);
    y = centeredText(doc, `Client TIN: ${(0, invoice_pdf_service_1.safe)(data.customer.tin)}`, y);
    y = centeredText(doc, `Client Tel: ${(0, invoice_pdf_service_1.safe)(data.customer.phone)}`, y);
    y += 2;
    dashedLine(doc, y);
    y += 6;
    for (const item of data.items) {
        y = wrappedLine(doc, (0, invoice_pdf_service_1.safe)(item.description, "-"), y, 6.3);
        const taxSuffix = (0, invoice_pdf_service_1.safe)(item.taxCode);
        const priceLine = `${(0, invoice_format_service_1.formatInvoiceAmount)(item.unitPrice)}x ${(0, invoice_format_service_1.formatInvoiceQuantity)(item.quantity)}`;
        const totalLine = `${(0, invoice_format_service_1.formatInvoiceAmount)(item.subtotal)}${taxSuffix}`;
        y = labelValueLine(doc, priceLine, totalLine, y);
        if (item.discountPct > 0) {
            y = labelValueLine(doc, `discount -${(0, invoice_format_service_1.formatInvoiceQuantity)(item.discountPct)}%`, (0, invoice_format_service_1.formatInvoiceAmount)(item.total), y);
        }
    }
    y += 2;
    dashedLine(doc, y);
    y += 5;
    const currency = (0, invoice_pdf_service_1.safe)(data.invoice.currency || data.company.currency, "RWF");
    const currencyLabel = currency.toUpperCase() === "RWF" ? "" : ` ${currency.toUpperCase()}`;
    const groups = (0, invoice_pdf_service_1.taxGroups)(data);
    const totalTax = groups.reduce((sum, group) => sum + group.tax, 0);
    y = labelValueLine(doc, `TOTAL${currencyLabel}`, (0, invoice_format_service_1.formatInvoiceAmount)(data.totals.grandTotal), y, true);
    // One authoritative total: per-band SALES totals ("TOTAL A …") are not
    // printed (they duplicate the grand total sliced by band); per-band TAX
    // rows carry the RRA-required breakdown.
    for (const group of groups) {
        y = labelValueLine(doc, `TOTAL TAX ${group.code}`, (0, invoice_format_service_1.formatInvoiceAmount)(group.tax), y);
    }
    y = labelValueLine(doc, "TOTAL TAX", (0, invoice_format_service_1.formatInvoiceAmount)(totalTax), y);
    y += 2;
    dashedLine(doc, y);
    y += 5;
    y = labelValueLine(doc, (0, invoice_pdf_service_1.safe)(data.invoice.paymentMethod, "CASH").toUpperCase(), (0, invoice_format_service_1.formatInvoiceAmount)(data.totals.grandTotal), y);
    y = labelValueLine(doc, "ITEMS NUMBER", String(data.items.length), y);
    y += 2;
    dashedLine(doc, y);
    y += 6;
    const requiresNotice = (0, invoice_pdf_service_1.isFormalNoticeIndicator)(indicator) || !data.certification.isCertified;
    if (requiresNotice) {
        // CIS §11: at least twice the amount-line size (~6.2 pt → ≥ 12.4 pt).
        y = centeredText(doc, system_branding_service_1.NOT_OFFICIAL_RECEIPT_NOTICE, y, true, 12.4);
        y += 3;
    }
    const sdc = data.sdcInformation;
    // §11/§15-17: COPY repeats its title once more directly above SDC
    // INFORMATION. TRAINING MODE and PROFORMA already print once at the top of
    // the receipt — repeating either here is redundant.
    if ((0, invoice_pdf_service_1.isFormalNoticeIndicator)(indicator) && !isTraining && !isProforma) {
        dashedLine(doc, y);
        y += 3;
        y = centeredText(doc, indicator, y, true);
        y += 1;
    }
    y = centeredText(doc, "SDC INFORMATION", y, true);
    y += 1;
    // Proforma / training slips have no VSDC signature but must still print the
    // transaction date/time and receipt number here — fall back to the
    // invoice-level values when the fiscal-specific fields are absent.
    const sdcDate = (0, invoice_format_service_1.formatInvoiceDateTime)(sdc.sdcDateTime || sdc.date || data.invoice.invoiceDate);
    const sdcReceiptNo = (0, invoice_pdf_service_1.safe)(sdc.receiptNumber) || (0, invoice_pdf_service_1.safe)(data.invoice.receiptNumber);
    if (sdcDate.date || sdcDate.time) {
        y = wrappedLine(doc, `Date: ${sdcDate.date}  Time: ${sdcDate.time}`, y);
    }
    if (sdc.sdcId)
        y = wrappedLine(doc, `SDC ID: ${(0, invoice_pdf_service_1.safe)(sdc.sdcId)}`, y);
    if (sdcReceiptNo)
        y = wrappedLine(doc, `RECEIPT NUMBER: ${sdcReceiptNo}`, y);
    if (sdc.internalData) {
        y = wrappedLine(doc, "Internal Data:", y);
        y = centeredText(doc, (0, invoice_format_service_1.groupFiscalValue)(sdc.internalData), y, false, 5.8);
    }
    if (sdc.receiptSignature) {
        y = wrappedLine(doc, "Receipt Signature:", y);
        y = centeredText(doc, (0, invoice_format_service_1.groupFiscalValue)(sdc.receiptSignature), y, false, 5.8);
    }
    const qr = (0, invoice_pdf_service_1.dataUrlBuffer)(data.verification.qrCodeImage);
    if (qr) {
        y += 3;
        try {
            doc.image(qr, PAGE_WIDTH / 2 - 27, y, { fit: [54, 54] });
            y += 58;
        }
        catch {
            // QR is best-effort — the printed fiscal text above is the fallback.
        }
    }
    y += 2;
    dashedLine(doc, y);
    y += 5;
    // No repeated "RECEIPT NUMBER" here — it already prints once above (SDC
    // INFORMATION block) and the invoice number already shows once at the top
    // of the receipt; showing either again here is just a duplicate value under
    // a new label, most confusing for proforma/training receipts.
    const invoiceDate = (0, invoice_format_service_1.formatInvoiceDateTime)(data.invoice.invoiceDate);
    y = wrappedLine(doc, `DATE: ${invoiceDate.date}  TIME: ${invoiceDate.time}`, y);
    if (data.company.mrc)
        y = wrappedLine(doc, `MRC: ${(0, invoice_pdf_service_1.safe)(data.company.mrc)}`, y);
    // Proforma and training-mode slips share the same non-fiscal SDC
    // INFORMATION block: they repeat the SDC ID here instead of the software
    // version. §21 still requires the software version on every other (real)
    // receipt type.
    if (isProforma || isTraining) {
        if (sdc.sdcId)
            y = wrappedLine(doc, `SDC ID: ${(0, invoice_pdf_service_1.safe)(sdc.sdcId)}`, y);
    }
    else if (sdc.softwareVersion) {
        y = wrappedLine(doc, (0, invoice_pdf_service_1.safe)(sdc.softwareVersion), y);
    }
    y += 3;
    dashedLine(doc, y);
    y += 6;
    y = centeredText(doc, "THANK YOU", y, true);
    if (data.footer?.message)
        y = centeredText(doc, (0, invoice_pdf_service_1.safe)(data.footer.message), y);
    y += 4;
    y = centeredText(doc, (0, invoice_pdf_service_1.safe)(sdc.poweredBy, system_branding_service_1.SYSTEM_FOOTER), y, false, 4.6);
    return y;
}
/** Generate the alternative 80mm thermal-roll EBM invoice/receipt. */
async function generateEbmReceiptPdf80mm(data) {
    const [companyLogo, certificationLogo] = await Promise.all([
        (0, invoice_logo_service_1.getOrganizationLogo)(),
        (0, invoice_logo_service_1.getRraCertificationLogo)(),
    ]);
    const invoiceTimestamp = new Date(data.invoice.invoiceDate);
    const stableTimestamp = Number.isNaN(invoiceTimestamp.getTime()) ? new Date(0) : invoiceTimestamp;
    const documentInfo = {
        Title: `EBM Invoice ${data.invoice.invoiceNumber}`,
        Author: data.company.name,
        Subject: "RRA VSDC EBM 2.1 fiscal invoice (80mm)",
        Creator: "Excel Edge backend invoice service",
        Producer: "PDFKit",
        CreationDate: stableTimestamp,
        ModDate: stableTimestamp,
    };
    // Pass 1: measure on a generously tall scratch page — its output is discarded.
    const scratch = new pdfkit_1.default({ autoFirstPage: false, size: [PAGE_WIDTH, MEASURE_HEIGHT], margin: 0 });
    scratch.on("data", () => { });
    scratch.addPage({ size: [PAGE_WIDTH, MEASURE_HEIGHT], margin: 0 });
    const measuredHeight = drawReceipt(scratch, data, companyLogo, certificationLogo, MARGIN);
    scratch.end();
    // Pass 2: the real page, sized to exactly what was measured (+ bottom margin).
    const pageHeight = Math.ceil(measuredHeight) + MARGIN;
    const doc = new pdfkit_1.default({
        autoFirstPage: false,
        size: [PAGE_WIDTH, pageHeight],
        margin: 0,
        compress: true,
        info: documentInfo,
    });
    const output = new Promise((resolve, reject) => {
        const chunks = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
    });
    doc.addPage({ size: [PAGE_WIDTH, pageHeight], margin: 0 });
    drawReceipt(doc, data, companyLogo, certificationLogo, MARGIN);
    doc.end();
    return output;
}
