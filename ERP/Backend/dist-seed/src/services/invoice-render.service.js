"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderSalesInvoiceHtml = renderSalesInvoiceHtml;
const invoice_format_service_1 = require("./invoice-format.service");
const system_branding_service_1 = require("./system-branding.service");
// invoice-pdf.service only imports RenderInvoicePayload/RenderInvoiceLineItem
// as types (`import type`, erased at build time), so importing its runtime
// helpers here does not create a circular module dependency at runtime.
const invoice_pdf_service_1 = require("./invoice-pdf.service");
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function safeText(value, fallback = "—") {
    const text = value == null ? "" : String(value).trim();
    return text ? text : fallback;
}
function isPresent(value) {
    return safeText(value) !== "—";
}
function formatAmount(value) {
    return (0, invoice_format_service_1.formatInvoiceAmount)(value);
}
function formatInteger(value) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n))
        return "0";
    return Math.round(n).toLocaleString("en-US");
}
function formatDateShort(iso) {
    if (!iso)
        return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return safeText(iso);
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    return `${dd}-${mm}-${date.getFullYear()}`;
}
function formatTime(value) {
    if (!value)
        return "—";
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime()) && /T/.test(value)) {
        return `${String(asDate.getHours()).padStart(2, "0")}:${String(asDate.getMinutes()).padStart(2, "0")}:${String(asDate.getSeconds()).padStart(2, "0")}`;
    }
    return safeText(value);
}
function dashEvery4(str) {
    if (!str)
        return "";
    const clean = str.replace(/[-\s]/g, "");
    const parts = [];
    for (let i = 0; i < clean.length; i += 4) {
        parts.push(clean.substring(i, i + 4));
    }
    return parts.join("-");
}
function row(label, value, opts = {}) {
    if (!isPresent(value))
        return "";
    return `
    <div class="kv-row">
      <div class="kv-label">${escapeHtml(label)}</div>
      <div class="kv-sep">:</div>
      <div class="kv-value ${opts.mono ? "mono" : ""}">${escapeHtml(value)}</div>
    </div>
  `;
}
/** Like `row`, but always prints the label — an empty value renders blank rather than dropping the whole line. */
function rowAlways(label, value, opts = {}) {
    const text = isPresent(value) ? escapeHtml(value) : "";
    return `
    <div class="kv-row">
      <div class="kv-label">${escapeHtml(label)}</div>
      <div class="kv-sep">:</div>
      <div class="kv-value ${opts.mono ? "mono" : ""}">${text}</div>
    </div>
  `;
}
function iconSvg(paths, viewBox = "0 0 24 24") {
    return `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
function companyIcon(kind) {
    const common = "class=\"icon\"";
    switch (kind) {
        case "map":
            return `<svg ${common} viewBox="0 0 24 24"><path d="M12 21s7-5.5 7-12a7 7 0 1 0-14 0c0 6.5 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>`;
        case "phone":
            return `<svg ${common} viewBox="0 0 24 24"><path d="M22 16.9v2a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 3.2 2 2 0 0 1 4.1 1h2a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L7.1 8.7a16 16 0 0 0 6.2 6.2l1.3-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6A2 2 0 0 1 22 16.9Z"/></svg>`;
        case "mail":
            return `<svg ${common} viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`;
        case "doc":
            return `<svg ${common} viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h6"/></svg>`;
        case "user":
            return `<svg ${common} viewBox="0 0 24 24"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="8" r="4"/></svg>`;
        case "calendar":
            return `<svg ${common} viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>`;
        case "clock":
            return `<svg ${common} viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
        case "card":
            return `<svg ${common} viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/></svg>`;
        case "qr":
            return `<svg ${common} viewBox="0 0 24 24"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3zM18 14h3v3h-3zM14 18h3v3h-3z"/></svg>`;
        case "cart":
            return `<svg ${common} viewBox="0 0 24 24"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>`;
    }
}
function invoiceInfoRow(iconName, label, value) {
    if (!isPresent(value))
        return "";
    return `
    <div class="info-row">
      <span class="icon-wrap">${companyIcon(iconName)}</span>
      <div class="kv-label">${escapeHtml(label)}</div>
      <div class="kv-sep">:</div>
      <div class="kv-value">${escapeHtml(value)}</div>
    </div>
  `;
}
function rraLogoSvg() {
    return `
    <svg viewBox="0 0 180 160" aria-hidden="true" class="rra-logo">
      <defs>
        <linearGradient id="rra-blue" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1D4ED8" />
          <stop offset="100%" stop-color="#2563EB" />
        </linearGradient>
        <linearGradient id="rra-orange" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#F59E0B" />
          <stop offset="100%" stop-color="#FB923C" />
        </linearGradient>
        <linearGradient id="rra-green" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#16A34A" />
          <stop offset="100%" stop-color="#4ADE80" />
        </linearGradient>
      </defs>
      <g transform="translate(12 8)">
        <ellipse cx="36" cy="28" rx="11" ry="28" fill="url(#rra-blue)" transform="rotate(-36 36 28)" opacity="0.98" />
        <ellipse cx="70" cy="18" rx="11" ry="28" fill="url(#rra-green)" transform="rotate(24 70 18)" opacity="0.98" />
        <ellipse cx="20" cy="70" rx="11" ry="28" fill="url(#rra-orange)" transform="rotate(-28 20 70)" opacity="0.98" />
        <ellipse cx="52" cy="58" rx="11" ry="28" fill="url(#rra-blue)" transform="rotate(20 52 58)" opacity="0.92" />
        <ellipse cx="72" cy="52" rx="11" ry="28" fill="url(#rra-orange)" transform="rotate(54 72 52)" opacity="0.96" />
        <ellipse cx="48" cy="88" rx="11" ry="28" fill="url(#rra-green)" transform="rotate(16 48 88)" opacity="0.96" />
        <circle cx="51" cy="60" r="7" fill="#1D4ED8" />
        <circle cx="51" cy="60" r="3.4" fill="#FFFFFF" opacity="0.95" />
        <path d="M51 59c6 11 13 19 24 28" fill="none" stroke="#1D4ED8" stroke-width="2.2" stroke-linecap="round" opacity="0.7" />
      </g>
      <text x="95" y="114" text-anchor="start" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="30" fill="#F97316" letter-spacing="0.5">RRA</text>
    </svg>
  `;
}
function ebmSealSvg(certified) {
    const blue = certified ? "#1848B3" : "#94A3B8";
    const green = certified ? "#16A34A" : "#CBD5E1";
    return `
    <svg viewBox="0 0 132 132" aria-hidden="true" class="ebm-seal">
      <circle cx="66" cy="66" r="58" fill="#fff" stroke="${blue}" stroke-width="4" />
      <circle cx="66" cy="66" r="50" fill="none" stroke="${green}" stroke-width="4" stroke-dasharray="8 5" stroke-linecap="round" />
      <path d="M48 65.5 60 78l26-30" fill="none" stroke="${green}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
      <text x="66" y="98" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="28" fill="${blue}">EBM</text>
    </svg>
  `;
}
function tableRow(item) {
    return `
    <tr>
      <td class="center">${formatInteger(item.line)}</td>
      <td>${escapeHtml(safeText(item.code))}</td>
      <td>${escapeHtml(item.description)}</td>
      <td class="center">${formatInteger(item.quantity)}</td>
      <td class="center">${escapeHtml(item.unit)}</td>
      <td class="center">${formatAmount(item.unitPrice)}</td>
      <td class="center">${formatAmount(item.discountAmt)}</td>
      <td class="center">${formatInteger(item.vatPct)}%</td>
      <td class="center">${formatAmount(item.taxAmount)}</td>
      <td class="center">${formatAmount(item.total)}</td>
    </tr>
  `;
}
function renderSalesInvoiceHtml(data) {
    const companyName = escapeHtml(data.company.name || "");
    const companyAddress = safeText(data.company.address);
    const companyPhone = safeText(data.company.phone);
    const companyEmail = safeText(data.company.email);
    const companyTin = safeText(data.company.tin);
    const customerName = safeText(data.customer.name);
    const customerTin = safeText(data.customer.tin);
    const customerAddress = safeText(data.customer.address);
    const customerPhone = safeText(data.customer.phone);
    const invoiceNo = safeText(data.invoice.invoiceNumber);
    const receiptNo = safeText(data.invoice.receiptNumber);
    const invoiceDate = formatDateShort(data.invoice.invoiceDate);
    const invoiceTime = formatTime(data.invoice.time);
    const paymentMethod = safeText(data.invoice.paymentMethod).toUpperCase();
    const cashier = safeText(data.invoice.cashier);
    const poweredBy = safeText(data.branding.poweredBy, system_branding_service_1.SYSTEM_POWERED_BY);
    const footerMessage = safeText(data.footer?.message, "THANK YOU FOR YOUR BUSINESS!");
    const qrCodeImage = data.verification.qrCodeImage ?? "";
    const supplyNote = (Number(data.totals.vat) > 0 || Number(data.totals.tax) > 0 || data.items.some((item) => Number(item.vatPct) > 0 || Number(item.taxAmount) > 0))
        ? "Taxable Supplies"
        : "Exempt Supplies";
    const logoHtml = data.company.logo
        ? `<img src="${escapeHtml(data.company.logo)}" alt="${companyName} logo" class="company-logo" />`
        : "";
    const isEbmLinked = Boolean(data.company.ebmLinked);
    const customerRows = [
        rowAlways("Client Name", customerName),
        rowAlways("TIN", customerTin),
        rowAlways("Phone", customerPhone),
        row("Address", customerAddress),
    ].join("");
    const invoiceRows = [
        invoiceInfoRow("doc", "Invoice No", invoiceNo),
        invoiceInfoRow("doc", "Receipt No", receiptNo),
        invoiceInfoRow("calendar", "Date", invoiceDate),
        invoiceInfoRow("clock", "Time", invoiceTime),
        invoiceInfoRow("card", "Payment Method", paymentMethod),
        invoiceInfoRow("user", "Cashier", cashier),
    ].join("");
    // RRA checklist §46: print the tax value under each A/B/C/D label actually
    // in play (taxGroups already force-includes B at zero per §48), alongside
    // — not instead of — the aggregate VAT/TAX rows above. Only the TAX rows
    // print: per-band SALES totals ("TOTAL A …") duplicate the grand total and
    // are not shown on the customer-facing invoice.
    const taxBreakdownRows = (0, invoice_pdf_service_1.taxGroups)(data).map((group) => [`TOTAL TAX ${group.code}`, group.tax, false]);
    const summaryRows = [
        ["SUBTOTAL (VAT INCL.)", data.totals.grandTotal, true],
        ["DISCOUNT", data.totals.discount, false],
        ["VAT", data.totals.vat, false],
        ["TAX", data.totals.tax, false],
        ...taxBreakdownRows,
        ["SHIPPING", data.totals.shipping, false],
        ["PAID", data.totals.paid, false],
        ["BALANCE", data.totals.balance, false],
    ];
    const summaryHtml = summaryRows.map(([label, value, emphasized]) => `
    <div class="summary-row ${emphasized ? "emph" : ""}">
      <span class="summary-label">${escapeHtml(label)}</span>
      <span class="summary-sep">:</span>
      <span class="summary-value">${formatAmount(value)}</span>
    </div>
  `).join("");
    const itemsHtml = data.items.map(tableRow).join("");
    const sdc = data.sdcInformation;
    const internalDataDisplay = sdc.internalData ? dashEvery4(sdc.internalData) : "—";
    const receiptSignatureDisplay = sdc.receiptSignature ? dashEvery4(sdc.receiptSignature) : "—";
    return `
    <style>
      .rra-invoice {
        font-family: Arial, Helvetica, sans-serif;
        color: #0f172a;
        background: #fff;
        width: 100%;
        box-sizing: border-box;
      }
      .rra-invoice * { box-sizing: border-box; }
      .rra-invoice .sheet {
        width: 100%;
        max-width: 1024px;
        margin: 0 auto;
        padding: 24px;
        border: 1px solid #cbd5e1;
        border-radius: 18px;
        box-shadow: 0 16px 60px rgba(15, 23, 42, 0.08);
        background: #fff;
      }
      .rra-invoice .top-grid {
        display: grid;
        grid-template-columns: 180px minmax(0,1fr) 180px;
        gap: 24px;
        align-items: start;
      }
      .rra-invoice .brand, .rra-invoice .cert {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        gap: 8px;
      }
      .rra-invoice .brand-name {
        text-transform: uppercase;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: .05em;
        color: #1848b3;
        text-align: center;
      }
      .rra-invoice .brand-tag {
        text-transform: uppercase;
        font-size: 8px;
        font-weight: 600;
        letter-spacing: .05em;
        color: #1848b3;
        text-align: center;
      }
      .rra-invoice .company-logo {
        max-height: 48px;
        max-width: 120px;
        object-fit: contain;
        border-radius: 4px;
        flex-shrink: 0;
      }
      .rra-invoice .company-title-wrap {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }
      .rra-invoice .company-name {
        font-size: 24px;
        font-weight: 800;
        line-height: 1;
        text-transform: uppercase;
        letter-spacing: -0.02em;
        color: #1e293b;
        margin: 0;
      }
      .rra-invoice .company-lines {
        margin-top: 12px;
        font-size: 14px;
        line-height: 1.4;
      }
      .rra-invoice .line {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #334155;
        margin-bottom: 6px;
      }
      .rra-invoice .line span {
        font-weight: 500;
      }
      .rra-invoice .icon {
        width: 14px;
        height: 14px;
        flex: 0 0 auto;
        stroke: #475569;
      }
      .rra-invoice .divider {
        margin-top: 16px;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .rra-invoice .divider-bar {
        display: flex;
        height: 4px;
        width: 180px;
        overflow: hidden;
        border-radius: 999px;
      }
      .rra-invoice .divider-bar span { flex: 1; }
      .rra-invoice .divider-bar .b1 { background: #00A1DE; }
      .rra-invoice .divider-bar .b2 { background: #FACB0E; }
      .rra-invoice .divider-bar .b3 { background: #3BB13B; }
      .rra-invoice .title {
        margin: 12px 0 0;
        text-align: center;
        color: #0045c7;
        font-size: 36px;
        line-height: 1;
        letter-spacing: .08em;
        font-weight: 900;
        text-transform: uppercase;
      }
      .rra-invoice .panel {
        margin-top: 24px;
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        padding: 20px;
        background: #fff;
      }
      .rra-invoice .not-official-notice {
        margin: 20px 0;
        padding: 10px 0;
        border-top: 1px dashed #94a3b8;
        border-bottom: 1px dashed #94a3b8;
        text-align: center;
        font-weight: 800;
        font-size: 12px;
        letter-spacing: .04em;
        text-transform: uppercase;
        color: #0f172a;
      }
      .rra-invoice .panel-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
      }
      .rra-invoice .panel-left {
        border-right: 1px solid #e2e8f0;
        padding-right: 24px;
      }
      .rra-invoice .panel-right {
        padding-left: 24px;
      }
      .rra-invoice .spacer-align {
        height: 36px;
        margin-bottom: 16px;
      }
      .rra-invoice .panel-title {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 0;
      }
      .rra-invoice .panel-title .badge {
        width: 36px;
        height: 36px;
        border-radius: 999px;
        background: #eff6ff;
        color: #1a4dc9;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .rra-invoice .panel-title .badge svg {
        width: 18px;
        height: 18px;
        stroke: #1a4dc9;
      }
      .rra-invoice .panel-title h3 {
        margin: 0;
        font-size: 14px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: .05em;
        color: #1a4dc9;
      }
      .rra-invoice .kv-row {
        display: grid;
        grid-template-columns: 100px 16px minmax(0,1fr);
        gap: 4px;
        align-items: start;
        padding: 5px 0;
      }
      .rra-invoice .info-row {
        display: grid;
        grid-template-columns: 24px 120px 16px minmax(0,1fr);
        gap: 4px;
        align-items: center;
        padding: 5px 0;
      }
      .rra-invoice .info-row .icon-wrap {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .rra-invoice .info-row .icon-wrap svg {
        width: 16px;
        height: 16px;
        stroke: #1a4dc9;
      }
      .rra-invoice .kv-label {
        font-size: 14px;
        font-weight: 500;
        color: #475569;
      }
      .rra-invoice .kv-sep {
        font-size: 14px;
        font-weight: 700;
        color: #94a3b8;
        text-align: center;
      }
      .rra-invoice .kv-value {
        font-size: 14px;
        font-weight: 600;
        color: #1e293b;
        word-break: break-all;
      }
      .rra-invoice .kv-value.mono {
        font-family: "Courier New", Courier, monospace;
        font-size: 13px;
      }
      .rra-invoice .items-wrap {
        margin-top: 16px;
        border: 1px solid #cbd5e1;
        border-radius: 12px;
        overflow: hidden;
      }
      .rra-invoice .items-scroll { overflow-x: auto; }
      .rra-invoice table {
        width: 100%;
        border-collapse: collapse;
        min-width: 900px;
      }
      .rra-invoice thead th {
        background: #0045c7;
        color: #fff;
        border-right: 1px solid rgba(255,255,255,.1);
        padding: 12px 10px;
        font-size: 11px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: .05em;
      }
      .rra-invoice thead th:last-child { border-right: 0; }
      .rra-invoice tbody td {
        padding: 12px 10px;
        border-bottom: 1px solid #e2e8f0;
        font-size: 14px;
        color: #334155;
      }
      .rra-invoice tbody tr:last-child td { border-bottom: 0; }
      .rra-invoice tbody tr:nth-child(even) td { background: #f8fafc; }
      .rra-invoice thead { display: table-header-group; }
      .rra-invoice tr { break-inside: avoid; page-break-inside: avoid; }
      .rra-invoice .center { text-align: center; }
      .rra-invoice .right { text-align: right; }
      .rra-invoice .totals {
        margin-top: 16px;
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        align-items: start;
        gap: 24px;
      }
      .rra-invoice .totals-note {
        font-size: 14px;
        font-weight: 700;
        color: #1e293b;
        padding-top: 8px;
      }
      .rra-invoice .summary {
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        overflow: hidden;
        background: #fff;
        width: 380px;
        flex-shrink: 0;
      }
      .rra-invoice .summary-row {
        display: grid;
        grid-template-columns: 180px 16px minmax(0,1fr);
        gap: 4px;
        align-items: center;
        padding: 6px 16px;
      }
      .rra-invoice .summary-label {
        font-size: 13px;
        font-weight: 750;
        color: #475569;
        text-transform: uppercase;
        letter-spacing: .03em;
      }
      .rra-invoice .summary-sep {
        font-size: 13px;
        font-weight: 700;
        color: #94a3b8;
        text-align: center;
      }
      .rra-invoice .summary-value {
        text-align: right;
        font-size: 13px;
        font-weight: 600;
        color: #1e293b;
        font-variant-numeric: tabular-nums;
      }
      .rra-invoice .grand {
        display: grid;
        grid-template-columns: 180px 16px minmax(0,1fr);
        gap: 4px;
        align-items: center;
        background: #0045c7;
        color: #fff;
        padding: 12px 16px;
      }
      .rra-invoice .grand .label {
        font-size: 14px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: .05em;
      }
      .rra-invoice .grand .sep {
        text-align: center;
        font-weight: 800;
      }
      .rra-invoice .grand .value {
        font-size: 20px;
        font-weight: 800;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .rra-invoice .verification {
        margin-top: 24px;
        border: 1px solid #16a34a;
        border-radius: 16px;
        padding: 20px;
        background: #fff;
      }
      .rra-invoice .verification-grid {
        display: grid;
        grid-template-columns: 240px minmax(0,1fr);
        gap: 24px;
      }
      .rra-invoice .verification-left {
        border-right: 1px solid #e2e8f0;
        padding-right: 24px;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      }
      .rra-invoice .verification-left h3,
      .rra-invoice .verification-right h3 {
        margin: 0;
        font-size: 14px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: .05em;
        color: #15803d;
      }
      .rra-invoice .qr-box {
        margin: 12px auto;
        width: 120px;
        height: 120px;
        border: 1px solid #16a34a;
        border-radius: 12px;
        padding: 4px;
        background: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .rra-invoice .qr-box img { width: 100%; height: 100%; object-fit: contain; }
      .rra-invoice .qr-note {
        font-size: 11px;
        line-height: 1.35;
        color: #64748b;
        max-width: 200px;
      }
      .rra-invoice .verification-right {
        padding-left: 24px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .rra-invoice .sdc-columns {
        display: grid;
        grid-template-columns: 1.05fr .95fr;
        gap: 24px;
        margin-top: 12px;
      }
      .rra-invoice .sdc-col {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .rra-invoice .verification-right .cell {
        display: grid;
        grid-template-columns: 120px 16px minmax(0, 1fr);
        gap: 4px;
        align-items: start;
      }
      .rra-invoice .sdc-col:last-child .cell {
        grid-template-columns: 140px 16px minmax(0, 1fr);
      }
      .rra-invoice .verification-right .label {
        font-size: 13px;
        font-weight: 750;
        color: #475569;
        text-transform: uppercase;
        letter-spacing: .03em;
      }
      .rra-invoice .verification-right .sep {
        font-size: 13px;
        font-weight: 700;
        color: #94a3b8;
        text-align: center;
      }
      .rra-invoice .verification-right .value {
        font-size: 13px;
        font-weight: 600;
        color: #1e293b;
      }
      .rra-invoice .verification-right .value.mono {
        font-family: "Courier New", Courier, monospace;
        word-break: break-all;
      }
      .rra-invoice .verification-right .powered {
        margin-top: 16px;
        border-top: 1px solid #e2e8f0;
        padding-top: 12px;
        text-align: center;
        font-size: 12px;
        color: #64748b;
      }
      .rra-invoice .verification-right .powered strong {
        color: #0045c7;
        font-weight: 700;
        text-transform: uppercase;
      }
      .rra-invoice .footer {
        margin-top: 24px;
        padding-top: 20px;
        border-top: 1px solid #cbd5e1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        background: transparent;
      }
      .rra-invoice .footer-cart {
        width: 44px;
        height: 44px;
        border-radius: 999px;
        border: 2px solid #0045c7;
        color: #0045c7;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #fff;
        flex-shrink: 0;
      }
      .rra-invoice .footer-cart svg {
        width: 20px;
        height: 20px;
        stroke: #0045c7;
      }
      .rra-invoice .footer-content {
        text-align: left;
      }
      .rra-invoice .footer-title {
        margin: 0;
        font-size: 14px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: .05em;
        color: #0045c7;
        line-height: 1.2;
      }
      .rra-invoice .footer-powered {
        margin-top: 6px;
        font-size: 11px;
        color: #64748b;
        line-height: 1.2;
      }
      .rra-invoice .footer-powered strong {
        color: #0045c7;
        font-weight: 700;
        text-transform: uppercase;
      }
      .rra-invoice .cert-label {
        font-size: 13px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: .05em;
        color: #1848b3;
        text-align: center;
        line-height: 1.1;
      }
      .rra-invoice .ebm-seal {
        width: 84px;
        height: 84px;
      }
      .rra-invoice .rra-logo {
        width: 140px;
        height: 120px;
      }
      @media print {
        .rra-invoice .sheet {
          max-width: none;
          border: 0;
          border-radius: 0;
          box-shadow: none;
          padding: 0;
        }
        .rra-invoice .panel,
        .rra-invoice .items-wrap,
        .rra-invoice .totals,
        .rra-invoice .verification,
        .rra-invoice .footer {
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .rra-invoice thead { display: table-header-group; }
      }
      @media (max-width: 1100px) {
        .rra-invoice .top-grid,
        .rra-invoice .panel-grid,
        .rra-invoice .totals,
        .rra-invoice .verification-grid,
        .rra-invoice .sdc-columns {
          grid-template-columns: 1fr !important;
        }
        .rra-invoice .brand,
        .rra-invoice .panel-left,
        .rra-invoice .cert,
        .rra-invoice .verification-left,
        .rra-invoice .verification-right,
        .rra-invoice .spacer-align {
          border: 0 !important;
          padding: 0 !important;
        }
        .rra-invoice .spacer-align {
          display: none !important;
        }
        .rra-invoice .summary {
          width: 100% !important;
        }
      }
    </style>

    <div class="rra-invoice">
      <div class="sheet">
        <div class="top-grid">
          <div class="brand">
            ${data.branding?.rraLogo
        ? `<img src="${escapeHtml(data.branding.rraLogo)}" alt="Rwanda Revenue Authority" width="120" height="48" style="object-fit:contain" />`
        : rraLogoSvg()}
            <div class="brand-name">Rwanda Revenue Authority</div>
            <div class="brand-tag">Taxes for Growth and Development</div>
          </div>

          <div class="company">
            <div class="company-title-wrap">
              ${logoHtml}
              <h1 class="company-name">${companyName}</h1>
            </div>
            <div class="company-lines">
              <div class="line">${companyIcon("map")}<span>${escapeHtml(companyAddress)}</span></div>
              <div class="line">${companyIcon("phone")}<span>${escapeHtml(companyPhone)}</span></div>
              <div class="line">${companyIcon("mail")}<span>${escapeHtml(companyEmail)}</span></div>
              <div class="line">${companyIcon("doc")}<span>TIN: ${escapeHtml(companyTin)}</span></div>
            </div>
          </div>

          <div class="cert">
            ${isEbmLinked ? `${ebmSealSvg(Boolean(data.certification.isCertified))}
            <div class="cert-label">RRA | EBM</div>
            <div class="cert-label">CERTIFIED</div>` : ""}
          </div>
        </div>

        <div class="divider">
          <div class="divider-bar"><span class="b1"></span><span class="b2"></span><span class="b3"></span></div>
        </div>
        <h2 class="title">${escapeHtml((0, invoice_pdf_service_1.documentIndicator)(data) || "INVOICE")}</h2>

        <div class="panel">
          <div class="panel-grid">
            <div class="panel-left">
              <div class="panel-title">
                <div class="badge">${companyIcon("user")}</div>
                <h3>Client Information</h3>
              </div>
              <div style="margin-top: 12px;">${customerRows}</div>
            </div>

            <div class="panel-right">
              <div class="spacer-align"></div>
              ${invoiceRows}
            </div>
          </div>
        </div>

        <div class="items-wrap">
          <div class="items-scroll">
            <table>
              <thead>
                <tr>
                  <th style="width:56px">#</th>
                  <th style="width:110px">Item Code</th>
                  <th>Description</th>
                  <th style="width:70px">Qty</th>
                  <th style="width:80px">Unit</th>
                  <th style="width:120px">Unit Price</th>
                  <th style="width:100px">Discount</th>
                  <th style="width:80px">VAT %</th>
                  <th style="width:90px">Tax</th>
                  <th style="width:120px">Subtotal</th>
                </tr>
              </thead>
              <tbody>${itemsHtml}</tbody>
            </table>
          </div>
        </div>

        <div class="totals">
          <div class="totals-note">${escapeHtml(supplyNote)}</div>
          <div class="summary">
            ${summaryHtml}
            <div class="grand">
              <div class="label">Grand Total</div>
              <div class="sep">:</div>
              <div class="value">${formatAmount(data.totals.grandTotal)}</div>
            </div>
          </div>
        </div>

        ${data.invoice.notFiscalized
        ? `<div class="not-official-notice">${escapeHtml(system_branding_service_1.NOT_FISCALIZED_TITLE)} — ${escapeHtml(system_branding_service_1.NOT_FISCALIZED_NOTICE)}</div>`
        : ""}

        ${(0, invoice_pdf_service_1.isFormalNoticeIndicator)((0, invoice_pdf_service_1.documentIndicator)(data)) || !data.certification.isCertified
        ? `<div class="not-official-notice">${escapeHtml(system_branding_service_1.NOT_OFFICIAL_RECEIPT_NOTICE)}</div>`
        : ""}

        <div class="verification">
          <div class="verification-grid">
            <div class="verification-left">
              <h3>Verify Invoice</h3>
              <div class="qr-box">
                ${isPresent(qrCodeImage)
        ? `<img src="${escapeHtml(qrCodeImage)}" alt="Invoice verification QR code" />`
        : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#94a3b8;font-size:10px;font-weight:700;">${companyIcon("qr")}<span>Not certified</span></div>`}
              </div>
              <div class="qr-note">Scan the QR code using RRA EBMVerify app to verify the authenticity of this invoice.</div>
            </div>

            <div class="verification-right">
              <h3>SDC Information</h3>
              <div class="sdc-columns">
                <div class="sdc-col">
                  <div class="cell"><span class="label">SDC ID</span><span class="sep">:</span><span class="value mono">${escapeHtml(safeText(sdc.sdcId))}</span></div>
                  <div class="cell"><span class="label">Receipt Number</span><span class="sep">:</span><span class="value mono">${escapeHtml(safeText(sdc.receiptNumber ?? data.invoice.receiptNumber))}</span></div>
                  <div class="cell"><span class="label">MRC</span><span class="sep">:</span><span class="value mono">${escapeHtml(safeText(sdc.mrcNo))}</span></div>
                  <div class="cell"><span class="label">Internal Data</span><span class="sep">:</span><span class="value mono">${escapeHtml(internalDataDisplay)}</span></div>
                </div>
                <div class="sdc-col">
                  <div class="cell"><span class="label">Receipt Signature</span><span class="sep">:</span><span class="value mono">${escapeHtml(receiptSignatureDisplay)}</span></div>
                  <div class="cell"><span class="label">Date</span><span class="sep">:</span><span class="value">${escapeHtml(formatDateShort(sdc.date ?? data.invoice.invoiceDate))}</span></div>
                  <div class="cell"><span class="label">Time</span><span class="sep">:</span><span class="value">${escapeHtml(safeText(sdc.time ?? data.invoice.time))}</span></div>
                  <div class="cell"><span class="label">Software Version</span><span class="sep">:</span><span class="value">${escapeHtml(safeText(sdc.softwareVersion))}</span></div>
                </div>
              </div>
              <div class="powered">Powered by <strong>${escapeHtml(poweredBy)}</strong></div>
            </div>
          </div>
        </div>

        <div class="footer">
          <div class="footer-cart">${companyIcon("cart")}</div>
          <div class="footer-content">
            <p class="footer-title">${escapeHtml(footerMessage)}</p>
            <p class="footer-powered">Powered by <strong>${escapeHtml(poweredBy)}</strong></p>
          </div>
        </div>
      </div>
    </div>
  `;
}
