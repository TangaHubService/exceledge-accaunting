"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.safe = safe;
exports.getEbmInvoiceFilename = getEbmInvoiceFilename;
exports.dataUrlBuffer = dataUrlBuffer;
exports.documentIndicator = documentIndicator;
exports.isRefundTransaction = isRefundTransaction;
exports.isFormalNoticeIndicator = isFormalNoticeIndicator;
exports.taxGroups = taxGroups;
exports.generateEbmInvoicePdf = generateEbmInvoicePdf;
const pdfkit_1 = __importDefault(require("pdfkit"));
const invoice_format_service_1 = require("./invoice-format.service");
const invoice_logo_service_1 = require("./invoice-logo.service");
const system_branding_service_1 = require("./system-branding.service");
const rra_ebm_service_1 = require("./rra-ebm.service");
// The layout below is authored in A4 coordinate space. A5 output renders the
// exact same layout scaled down to fit an A5 sheet (RRA checklist §18: the CIS
// may print the invoice on different formats as long as every required field
// is present).
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const A5_WIDTH = 419.53;
const A5_HEIGHT = 595.28;
/** Scale factor that fits the A4 layout onto an A5 page (by width). */
const A5_SCALE = A5_WIDTH / PAGE_WIDTH;
const LEFT = 25;
const RIGHT = 570;
const TABLE_TOP = 152;
const TABLE_HEADER_HEIGHT = 22;
const FINAL_TABLE_BOTTOM = 622;
const FULL_TABLE_BOTTOM = 808;
const FONT = "Courier";
const FONT_BOLD = "Courier-Bold";
function safe(value, fallback = "") {
    const text = String(value ?? "").trim();
    return text || fallback;
}
function filenamePart(value) {
    return value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
function getEbmInvoiceFilename(data, format = "A4") {
    const number = filenamePart(data.invoice.invoiceNumber || data.invoice.saleNumber || "invoice") || "invoice";
    const suffix = format === "80mm" ? "-80mm" : format === "A5" ? "-A5" : "";
    return `EBM-Invoice-${number}${suffix}.pdf`;
}
function dataUrlBuffer(value) {
    if (!value)
        return null;
    const match = value.match(/^data:image\/(?:png|jpe?g);base64,(.+)$/i);
    if (!match)
        return null;
    try {
        return Buffer.from(match[1], "base64");
    }
    catch {
        return null;
    }
}
/**
 * The watermark title printed on the receipt. PROFORMA and TRAINING MODE take
 * priority over COPY — reprinting a training/proforma receipt must never lose
 * that designation and start looking like an ordinary copied transaction.
 * COPY (§15) only applies to reprints of a NORMAL receipt in the first place.
 */
function documentIndicator(data) {
    const label = safe(data.invoice.rcptLabel).toUpperCase();
    if (data.invoice.isProforma || label === "PS")
        return "PROFORMA";
    if (label === "TS" || label === "TR")
        return system_branding_service_1.TRAINING_MODE_LABEL;
    if (data.invoice.isCopy || label === "CS" || label === "CR")
        return "COPY";
    // A real sale downloaded before VSDC confirmed it: the title makes clear the
    // document is provisional. Ranks below COPY/TRAINING/PROFORMA (which can't be
    // pending anyway) and above the plain refund/blank case.
    if (data.invoice.notFiscalized)
        return system_branding_service_1.NOT_FISCALIZED_TITLE;
    if (label === "NR" || (!label && data.invoice.status === "REFUNDED"))
        return system_branding_service_1.REFUND_DOCUMENT_LABEL;
    return "";
}
/**
 * Whether the refund-specific content (REF. NORMAL RECEIPT# + refund notice)
 * should print — independent of the watermark title above. A *copied* refund
 * (NR reprinted, watermark title "COPY") is still a refund and must keep
 * showing its reference to the original sale, per spec §15's own CR example.
 */
function isRefundTransaction(data) {
    const label = safe(data.invoice.rcptLabel).toUpperCase();
    return label === "NR" || (!label && data.invoice.status === "REFUNDED");
}
/**
 * CIS/VSDC spec §11: COPY, TRAINING MODE, and PROFORMA must carry the "not an
 * official receipt" notice and repeat their title above SDC INFORMATION — a
 * genuine NORMAL sale/refund (label "" or REFUND) must not.
 */
function isFormalNoticeIndicator(indicator) {
    return indicator !== "" && indicator !== system_branding_service_1.REFUND_DOCUMENT_LABEL;
}
function drawImageFit(doc, image, x, y, width, height) {
    if (!image)
        return;
    try {
        doc.image(image, x, y, { fit: [width, height], align: "center", valign: "center" });
    }
    catch (error) {
        console.warn("[INVOICE-PDF] Image could not be rendered:", error instanceof Error ? error.message : error);
    }
}
function drawHeader(doc, data, companyLogo, certificationLogo, pageNumber, pageCount) {
    doc.fillColor("#000000").strokeColor("#000000").lineWidth(0.55);
    drawImageFit(doc, companyLogo, LEFT, 20, 64, 64);
    drawImageFit(doc, certificationLogo, 507, 19, 62, 62);
    const companyLines = [
        safe(data.company.name),
        safe(data.company.address),
        data.company.phone ? `TEL: ${safe(data.company.phone)}` : "",
        data.company.tin ? `TIN: ${safe(data.company.tin)}` : "",
    ].filter(Boolean);
    let companyY = 29;
    for (let index = 0; index < companyLines.length; index += 1) {
        doc
            .font(index === 0 ? FONT_BOLD : FONT)
            .fontSize(index === 0 ? 7.2 : 6.3)
            .text(companyLines[index], 122, companyY, { width: 350, align: "center", lineBreak: false });
        companyY += index === 0 ? 10 : 8;
    }
    const indicator = documentIndicator(data);
    const isRefundDoc = isRefundTransaction(data);
    if (indicator) {
        doc.font(FONT_BOLD).fontSize(9.5).text(indicator, 225, isRefundDoc ? 76 : 91, {
            width: 145,
            align: "center",
            characterSpacing: 1.7,
        });
    }
    if (isRefundDoc) {
        const originalReceiptNumber = safe(data.invoice.originalReceiptNumber);
        if (originalReceiptNumber) {
            doc.font(FONT).fontSize(5.6).text(`REF. NORMAL RECEIPT#: ${originalReceiptNumber}`, LEFT, 89, {
                width: RIGHT - LEFT,
                align: "center",
            });
        }
        doc.font(FONT_BOLD).fontSize(5.8).text(system_branding_service_1.REFUND_NOTICE, LEFT, 97, { width: RIGHT - LEFT, align: "center" });
    }
    doc.moveTo(LEFT, 104).lineTo(RIGHT, 104).dash(2, { space: 1.5 }).stroke().undash();
    doc.font(FONT_BOLD).fontSize(5.7).text("INVOICE TO", LEFT, 109, { width: 150 });
    doc.rect(LEFT, 118, 151, 29).stroke();
    doc.font(FONT).fontSize(5.5);
    doc.text(`TIN   : ${safe(data.customer.tin)}`, LEFT + 5, 121, { width: 141, height: 7, ellipsis: true });
    doc.text(`Name  : ${safe(data.customer.name)}`, LEFT + 5, 129, { width: 141, height: 7, ellipsis: true });
    doc.text(`Phone : ${safe(data.customer.phone)}`, LEFT + 5, 137, { width: 141, height: 8, ellipsis: true });
    doc.rect(447, 118, 123, 29).stroke();
    doc.font(FONT_BOLD).fontSize(5.4).text(`INVOICE NO : ${safe(data.invoice.invoiceNumber, "-")}`, 452, 123, {
        width: 113,
        height: 9,
        ellipsis: true,
    });
    const invoiceDate = (0, invoice_format_service_1.formatInvoiceDateTime)(data.invoice.invoiceDate);
    doc.font(FONT).fontSize(5.6).text(`Date : ${invoiceDate.date}`, 452, 135, { width: 113, height: 8, ellipsis: true });
    if (pageCount > 1) {
        doc.font(FONT).fontSize(5).text(`Page ${pageNumber}/${pageCount}`, 390, 109, { width: 180, align: "right" });
    }
}
const COLUMN_WIDTHS = [22, 92, 132, 43, 43, 90, 123];
const COLUMN_HEADERS = ["#", "Item Code", "Item Description", "Qty", "Tax", "Unit Price", "Total Price"];
function columnPositions() {
    const positions = [LEFT];
    for (const width of COLUMN_WIDTHS)
        positions.push(positions[positions.length - 1] + width);
    return positions;
}
function measureLines(doc, items) {
    doc.font(FONT).fontSize(6.2);
    return items.map((item) => {
        const codeHeight = doc.heightOfString(safe(item.code, "-"), { width: COLUMN_WIDTHS[1] - 7 });
        const descriptionHeight = doc.heightOfString(safe(item.description, "-"), { width: COLUMN_WIDTHS[2] - 7 });
        return {
            item,
            height: Math.min(120, Math.max(18, Math.ceil(Math.max(codeHeight, descriptionHeight)) + 7)),
        };
    });
}
function paginateLines(lines) {
    if (!lines.length)
        return [[]];
    const finalCapacity = FINAL_TABLE_BOTTOM - TABLE_TOP - TABLE_HEADER_HEIGHT;
    const fullCapacity = FULL_TABLE_BOTTOM - TABLE_TOP - TABLE_HEADER_HEIGHT;
    const totalHeight = lines.reduce((sum, line) => sum + line.height, 0);
    if (totalHeight <= finalCapacity)
        return [lines];
    let finalStart = lines.length;
    let finalHeight = 0;
    while (finalStart > 0 && finalHeight + lines[finalStart - 1].height <= finalCapacity) {
        finalStart -= 1;
        finalHeight += lines[finalStart].height;
    }
    if (finalStart === lines.length)
        finalStart = lines.length - 1;
    const pages = [];
    let page = [];
    let height = 0;
    for (const line of lines.slice(0, finalStart)) {
        if (page.length && height + line.height > fullCapacity) {
            pages.push(page);
            page = [];
            height = 0;
        }
        page.push(line);
        height += line.height;
    }
    if (page.length)
        pages.push(page);
    pages.push(lines.slice(finalStart));
    return pages;
}
function drawTable(doc, lines, isFinalPage) {
    const positions = columnPositions();
    const naturalBottom = TABLE_TOP + TABLE_HEADER_HEIGHT + lines.reduce((sum, line) => sum + line.height, 0);
    const tableBottom = isFinalPage ? Math.max(FINAL_TABLE_BOTTOM, naturalBottom) : FULL_TABLE_BOTTOM;
    doc.strokeColor("#000000").fillColor("#000000").lineWidth(0.65);
    doc.rect(LEFT, TABLE_TOP, RIGHT - LEFT, tableBottom - TABLE_TOP).stroke();
    doc.moveTo(LEFT, TABLE_TOP + TABLE_HEADER_HEIGHT).lineTo(RIGHT, TABLE_TOP + TABLE_HEADER_HEIGHT).stroke();
    for (const x of positions.slice(1, -1))
        doc.moveTo(x, TABLE_TOP).lineTo(x, tableBottom).stroke();
    doc.font(FONT_BOLD).fontSize(6.3);
    COLUMN_HEADERS.forEach((header, index) => {
        doc.text(header, positions[index] + 3, TABLE_TOP + 7, {
            width: COLUMN_WIDTHS[index] - 6,
            height: 9,
            align: index === 0 || index >= 3 ? "center" : "left",
            ellipsis: true,
            lineBreak: false,
        });
    });
    let y = TABLE_TOP + TABLE_HEADER_HEIGHT;
    doc.font(FONT).fontSize(6.1);
    for (const { item, height } of lines) {
        const tax = safe(item.taxCode) || (Number(item.vatPct) ? `${(0, invoice_format_service_1.formatInvoiceQuantity)(item.vatPct)}%` : "-");
        const values = [
            (0, invoice_format_service_1.formatInvoiceQuantity)(item.line),
            safe(item.code, "-"),
            safe(item.description, "-"),
            (0, invoice_format_service_1.formatInvoiceQuantity)(item.quantity),
            tax,
            (0, invoice_format_service_1.formatInvoiceAmount)(item.unitPrice),
            (0, invoice_format_service_1.formatInvoiceAmount)(item.total),
        ];
        values.forEach((value, index) => {
            doc.text(value, positions[index] + 3, y + 5, {
                width: COLUMN_WIDTHS[index] - 6,
                height: height - 7,
                align: index === 0 || index === 3 || index === 4 ? "center" : index >= 5 ? "right" : "left",
                ellipsis: true,
            });
        });
        y += height;
    }
}
function taxGroups(data) {
    const grouped = new Map();
    // RRA checklist §48: tax code B (the only statutory rate >0%, currently
    // 18%) must print on every receipt even when no line item used it — seeded
    // here at zero so it survives even for an all-exempt sale. A/C/D (§49) stay
    // unseeded and only appear when a line item actually carries that code.
    grouped.set("B", { code: "B", rate: rra_ebm_service_1.TAX_RATE_BY_SLOT[1], total: 0, tax: 0 });
    for (const item of data.items) {
        const actualCode = safe(item.taxCode).toUpperCase();
        const key = actualCode || `TAX-${(0, invoice_format_service_1.formatInvoiceQuantity)(item.vatPct)}%`;
        const existing = grouped.get(key) ?? { code: key, rate: Number(item.vatPct) || 0, total: 0, tax: 0 };
        existing.total += Number(item.total) || 0;
        existing.tax += Number(item.taxAmount) || 0;
        grouped.set(key, existing);
    }
    const order = ["A", "B", "C", "D"];
    return [...grouped.values()].sort((a, b) => {
        const ai = order.indexOf(a.code);
        const bi = order.indexOf(b.code);
        if (ai >= 0 || bi >= 0)
            return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
        return a.code.localeCompare(b.code);
    });
}
function drawSummary(doc, data) {
    const currency = safe(data.invoice.currency || data.company.currency, "RWF");
    const currencyLabel = currency.toUpperCase() === "RWF" ? "Rwf" : currency.toUpperCase();
    const groups = taxGroups(data);
    const totalTax = groups.reduce((sum, group) => sum + group.tax, 0);
    // One authoritative invoice total. Per-tax-slot SALES totals ("Total A …",
    // "Total B …") are deliberately not printed: they duplicate the grand total
    // sliced by tax band and were mistaken for the amount due. The per-band TAX
    // rows below carry the RRA-required tax breakdown instead.
    const rows = [[`Total ${currencyLabel}`, data.totals.grandTotal]];
    for (const group of groups) {
        rows.push([`Total Tax ${group.code} ${currencyLabel}`, group.tax]);
    }
    rows.push([`Total Tax ${currencyLabel}`, totalTax]);
    rows.push(["Items Number", data.items.length]);
    rows.push(["Payment Mode", safe(data.invoice.paymentMethod, "-")]);
    const x = 341;
    const y = 649;
    const width = 229;
    const labelWidth = 136;
    const rowHeight = Math.min(14, 105 / Math.max(rows.length, 1));
    const height = rowHeight * rows.length;
    doc.lineWidth(0.6).rect(x, y, width, height).stroke();
    doc.moveTo(x + labelWidth, y).lineTo(x + labelWidth, y + height).stroke();
    rows.forEach(([label, value], index) => {
        const rowY = y + index * rowHeight;
        if (index)
            doc.moveTo(x, rowY).lineTo(x + width, rowY).stroke();
        doc.font(FONT).fontSize(5.5).text(label, x + 6, rowY + 4, { width: labelWidth - 10, height: rowHeight - 4, ellipsis: true });
        doc.text(typeof value === "number" ? (0, invoice_format_service_1.formatInvoiceAmount)(value) : safe(value), x + labelWidth + 6, rowY + 4, {
            width: width - labelWidth - 11,
            height: rowHeight - 4,
            align: "right",
            ellipsis: true,
        });
    });
}
function drawFiscalInformation(doc, data) {
    const sdc = data.sdcInformation;
    // Proforma and training-mode slips carry no VSDC signature, but the printout
    // must still show the transaction's date/time and receipt number under SDC
    // INFORMATION (spec §16/§17 worked examples) — fall back to the invoice-level
    // values whenever the fiscal-specific fields are absent.
    const sdcDate = (0, invoice_format_service_1.formatInvoiceDateTime)(sdc.sdcDateTime || sdc.date || data.invoice.invoiceDate);
    const sdcReceiptNo = safe(sdc.receiptNumber) || safe(data.invoice.receiptNumber);
    const invoiceDate = (0, invoice_format_service_1.formatInvoiceDateTime)(data.invoice.invoiceDate);
    const indicator = documentIndicator(data);
    const isTraining = indicator === system_branding_service_1.TRAINING_MODE_LABEL;
    const isProforma = indicator === "PROFORMA";
    const lines = [
        sdcDate.date || sdcDate.time ? `Date: ${sdcDate.date}${sdcDate.time ? ` Time: ${sdcDate.time}` : ""}` : "",
        sdc.sdcId ? `SDC ID: ${safe(sdc.sdcId)}` : "",
        sdcReceiptNo ? `RECEIPT NUMBER: ${sdcReceiptNo}` : "",
        sdc.internalData ? `Internal Data: ${(0, invoice_format_service_1.groupFiscalValue)(sdc.internalData)}` : "",
        sdc.receiptSignature ? `Receipt Signature: ${(0, invoice_format_service_1.groupFiscalValue)(sdc.receiptSignature)}` : "",
    ].filter(Boolean);
    doc.fillColor("#000000").font(FONT).fontSize(5.2);
    // §11/§15-17: COPY repeats its title once more directly above SDC
    // INFORMATION. TRAINING MODE and PROFORMA already print once at the top of
    // the receipt (Warranted Function 5/18) — repeating either here is redundant.
    let sdcTop = 650;
    if (isFormalNoticeIndicator(indicator) && !isTraining && !isProforma) {
        doc.moveTo(LEFT, sdcTop).lineTo(176, sdcTop).dash(2, { space: 1.5 }).stroke().undash();
        doc.font(FONT_BOLD).fontSize(5.6).text(indicator, LEFT, sdcTop + 3, { width: 151, align: "center", characterSpacing: 0.5 });
        sdcTop += 12;
        doc.font(FONT).fontSize(5.2);
    }
    doc.text("SDC INFORMATION", LEFT, sdcTop, { width: 226 });
    doc.moveTo(LEFT, sdcTop + 9).lineTo(176, sdcTop + 9).dash(2, { space: 1.5 }).stroke().undash();
    let y = sdcTop + 14;
    for (const line of lines) {
        const lineHeight = Math.max(8, doc.heightOfString(line, { width: 230 }));
        doc.text(line, LEFT, y, { width: 230, height: lineHeight, ellipsis: true });
        y += lineHeight + 2;
    }
    // No repeated "RECEIPT NUMBER" here — it already shows once above (SDC
    // block) and the invoice number already shows once in the header ("INVOICE
    // NO"). Repeating either here just prints a duplicate value under a
    // different label — most confusing for proforma/training, which have no
    // real VSDC number sitting between the two to visually break the pattern.
    const extraLines = [
        invoiceDate.date ? `Date: ${invoiceDate.date}${data.invoice.time ? ` Time: ${safe(data.invoice.time)}` : ""}` : "",
        sdc.mrcNo ? `MRC: ${safe(sdc.mrcNo)}` : "",
        // Proforma and training-mode slips share the same non-fiscal SDC
        // INFORMATION block: they repeat the SDC ID here instead of the software
        // version. §21 still requires the software version on every other (real)
        // receipt type.
        isProforma || isTraining
            ? (sdc.sdcId ? `SDC ID: ${safe(sdc.sdcId)}` : "")
            : (sdc.softwareVersion ? safe(sdc.softwareVersion) : ""),
    ].filter(Boolean);
    if (extraLines.length) {
        doc.moveTo(LEFT, y + 1).lineTo(176, y + 1).dash(2, { space: 1.5 }).stroke().undash();
        y += 6;
        for (const line of extraLines) {
            doc.text(line, LEFT, y, { width: 230, height: 8, ellipsis: true });
            y += 9;
        }
    }
}
function drawFinalFooter(doc, data) {
    // §11: COPY/TRAINING MODE/PROFORMA always carry this notice; an uncertified
    // NORMAL sale/refund falls back to it too since it isn't official yet either.
    if (isFormalNoticeIndicator(documentIndicator(data)) || !data.certification.isCertified) {
        doc.moveTo(LEFT, 625).lineTo(RIGHT, 625).dash(2, { space: 1.5 }).stroke().undash();
        // CIS §11: "THIS IS NOT AN OFFICIAL RECEIPT" must be at least twice the
        // amount text size (amount lines use ~6–7.5 pt → notice ≥ 14–15 pt).
        doc.font(FONT_BOLD).fontSize(15).text(system_branding_service_1.NOT_OFFICIAL_RECEIPT_NOTICE, LEFT, 628, {
            width: RIGHT - LEFT,
            align: "center",
            characterSpacing: 0.3,
        });
        if (data.invoice.notFiscalized) {
            doc.font(FONT_BOLD).fontSize(6).text(system_branding_service_1.NOT_FISCALIZED_NOTICE, LEFT, 644, {
                width: RIGHT - LEFT,
                align: "center",
                characterSpacing: 0.2,
            });
        }
        doc.moveTo(LEFT, 652).lineTo(RIGHT, 652).dash(2, { space: 1.5 }).stroke().undash();
    }
    drawFiscalInformation(doc, data);
    const qr = dataUrlBuffer(data.verification.qrCodeImage);
    drawImageFit(doc, qr, 267, 655, 62, 62);
    drawSummary(doc, data);
    doc
        .font(FONT)
        .fontSize(5.1)
        .text(safe(data.sdcInformation.poweredBy, system_branding_service_1.SYSTEM_FOOTER), LEFT, 771, {
        width: 300,
        height: 10,
        ellipsis: true,
    });
}
/**
 * Big translucent diagonal stamp — kept as a thin wrapper for callers/tests
 * that still reference the older name.
 */
function drawNotFiscalizedWatermark(doc) {
    drawDiagonalWatermark(doc, system_branding_service_1.NOT_FISCALIZED_TITLE, PAGE_WIDTH, PAGE_HEIGHT, "#D32F2F");
}
/**
 * Generate the authoritative portrait EBM invoice entirely on the backend.
 * `paper` is "A4" (default) or "A5" — A5 renders the identical layout scaled to
 * fit the smaller sheet.
 */
async function generateEbmInvoicePdf(data, paper = "A4") {
    const isA5 = paper === "A5";
    const sheetW = isA5 ? A5_WIDTH : PAGE_WIDTH;
    const sheetH = isA5 ? A5_HEIGHT : PAGE_HEIGHT;
    const applyScale = (doc) => { if (isA5)
        doc.scale(A5_SCALE, A5_SCALE, { origin: [0, 0] }); };
    const [companyLogo, certificationLogo] = await Promise.all([
        (0, invoice_logo_service_1.getOrganizationLogo)(),
        (0, invoice_logo_service_1.getRraCertificationLogo)(),
    ]);
    const invoiceTimestamp = new Date(data.invoice.invoiceDate);
    const stableTimestamp = Number.isNaN(invoiceTimestamp.getTime()) ? new Date(0) : invoiceTimestamp;
    const doc = new pdfkit_1.default({
        autoFirstPage: false,
        size: [sheetW, sheetH],
        margin: 0,
        compress: true,
        info: {
            Title: `EBM Invoice ${data.invoice.invoiceNumber}`,
            Author: data.company.name,
            Subject: `RRA VSDC EBM 2.1 fiscal invoice (${paper})`,
            Creator: "Excel Edge backend invoice service",
            Producer: "PDFKit",
            CreationDate: stableTimestamp,
            ModDate: stableTimestamp,
        },
    });
    const output = new Promise((resolve, reject) => {
        const chunks = [];
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
    });
    // A page is required for PDFKit text measurement. It becomes page one.
    doc.addPage({ size: [sheetW, sheetH], margin: 0 });
    const pages = paginateLines(measureLines(doc, data.items));
    pages.forEach((lines, index) => {
        if (index > 0)
            doc.addPage({ size: [sheetW, sheetH], margin: 0 });
        const finalPage = index === pages.length - 1;
        // A5: draw the A4-space layout under a scale transform so every field is
        // reproduced exactly, just smaller.
        doc.save();
        applyScale(doc);
        drawHeader(doc, data, companyLogo, certificationLogo, index + 1, pages.length);
        drawTable(doc, lines, finalPage);
        if (finalPage)
            drawFinalFooter(doc, data);
        doc.restore();
        // Watermarks drawn AFTER restore so they span the physical page.
        const indicator = documentIndicator(data);
        if (data.invoice.notFiscalized)
            drawDiagonalWatermark(doc, system_branding_service_1.NOT_FISCALIZED_TITLE, sheetW, sheetH, "#D32F2F");
        else if (indicator === "COPY" || indicator === system_branding_service_1.TRAINING_MODE_LABEL || indicator === "PROFORMA") {
            drawDiagonalWatermark(doc, indicator, sheetW, sheetH, "#424242");
        }
    });
    doc.end();
    return output;
}
/**
 * CIS §11 / §15–17: large diagonal watermark for COPY, TRAINING, PROFORMA
 * (and NOT FISCALISED). Drawn across the physical page so it cannot be missed.
 */
function drawDiagonalWatermark(doc, text, pageW, pageH, color) {
    doc.save();
    doc.rotate(-33, { origin: [pageW / 2, pageH / 2] });
    doc
        .font(FONT_BOLD)
        .fontSize(Math.max(36, Math.min(56, pageW * 0.09)))
        .fillColor(color)
        .opacity(0.14)
        .text(text, pageW / 2 - pageW * 0.55, pageH / 2 - 34, {
        width: pageW * 1.1,
        align: "center",
        characterSpacing: 2,
    });
    doc.opacity(1).fillColor("#000000").restore();
}
