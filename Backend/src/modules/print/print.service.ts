import { prisma } from "../../lib/prisma";
import { pdfDate, pdfMoney, renderPdf, type PdfBlock } from "../../lib/pdf";
import { money } from "../../lib/documents";
import * as ar from "../ar/ar.service";
import * as ap from "../ap/ap.service";

export type PrintedDocument = { filename: string; pdf: Buffer };

/** The issuing company's name and identifiers for a document header. */
export async function companyHeader(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, include: { profile: true } });
  const p = company?.profile;
  const name = p?.registeredName || p?.tradingName || company?.name || "Company";
  const details = [
    p?.taxIdentificationNumber ? `TIN ${p.taxIdentificationNumber}` : "",
    p?.operatingAddress || p?.registeredAddress || "",
    p?.telephone || "",
    p?.businessEmail || "",
  ].filter(Boolean);
  return { name, subtitle: details.join("  |  ") };
}

const safeName = (text: string) => text.replace(/[^A-Za-z0-9._-]+/g, "-");

export async function invoicePdf(companyId: string, invoiceId: string): Promise<PrintedDocument> {
  const [header, invoice] = await Promise.all([companyHeader(companyId), ar.getInvoice(companyId, invoiceId)]);
  const c = invoice.customer;
  const blocks: PdfBlock[] = [
    { kind: "heading", text: `${invoice.status === "REVERSED" ? "VOID " : ""}Tax invoice ${invoice.invoiceNumber}` },
    {
      kind: "pairs",
      rows: [
        ["Invoice date", pdfDate(invoice.invoiceDate)],
        ["Due date", pdfDate(invoice.dueDate)],
        ["Customer", `${c.name} (${c.code})`],
        ...(c.tin ? ([["Customer TIN", c.tin]] as Array<[string, string]>) : []),
        ...(c.physicalAddress ? ([["Address", c.physicalAddress]] as Array<[string, string]>) : []),
      ],
    },
  ];
  if (invoice.lines.length) {
    blocks.push({
      kind: "table",
      columns: [
        { header: "#", width: 20 },
        { header: "Description", width: 180 },
        { header: "Qty", width: 45, align: "right" },
        { header: "Unit price", width: 70, align: "right" },
        { header: "Discount", width: 60, align: "right" },
        { header: "Tax", width: 50 },
        { header: "Net", width: 75, align: "right" },
      ],
      rows: invoice.lines.map((l) => [
        String(l.lineNumber),
        l.description,
        String(Number(l.quantity)),
        pdfMoney(l.unitPrice),
        pdfMoney(l.discount),
        l.taxCode ? `${l.taxCode} ${Number(l.taxRate)}%` : "-",
        pdfMoney(l.net),
      ]),
    });
  } else if (invoice.description) {
    blocks.push({ kind: "text", text: invoice.description });
  }
  blocks.push({
    kind: "pairs",
    rows: [
      ["Net", pdfMoney(invoice.net)],
      ...(money(invoice.discount) ? ([["Discount", pdfMoney(invoice.discount)]] as Array<[string, string]>) : []),
      ["Tax", pdfMoney(invoice.tax)],
      [`Total (${invoice.currency})`, pdfMoney(invoice.gross)],
      ["Paid and credited", pdfMoney(money(invoice.amountPaid) + money(invoice.amountCredited))],
      ["Balance due", pdfMoney(invoice.outstanding)],
    ],
  });
  const pdf = renderPdf({ title: header.name, subtitle: header.subtitle, blocks, footer: `Invoice ${invoice.invoiceNumber}` });
  return { filename: `${safeName(invoice.invoiceNumber)}.pdf`, pdf };
}

function statementBlocks(
  party: { name: string; code: string; tin?: string | null },
  s: {
    from: string;
    to: string;
    openingBalance: number;
    closingBalance: number;
    entries: Array<{ entryDate: Date; docType: string; docNumber: string | null; description: string | null; debit: number; credit: number; balance: number }>;
  },
  label: string,
): PdfBlock[] {
  return [
    { kind: "heading", text: `${label} ${s.from} to ${s.to}` },
    {
      kind: "pairs",
      rows: [
        [label.startsWith("Customer") ? "Customer" : "Supplier", `${party.name} (${party.code})`],
        ...(party.tin ? ([["TIN", party.tin]] as Array<[string, string]>) : []),
        ["Balance brought forward", pdfMoney(s.openingBalance)],
      ],
    },
    {
      kind: "table",
      columns: [
        { header: "Date", width: 60 },
        { header: "Type", width: 70 },
        { header: "Number", width: 80 },
        { header: "Description", width: 140 },
        { header: "Debit", width: 70, align: "right" },
        { header: "Credit", width: 70, align: "right" },
        { header: "Balance", width: 75, align: "right" },
      ],
      rows: s.entries.map((e) => [
        pdfDate(e.entryDate),
        e.docType.replace(/_/g, " ").toLowerCase(),
        e.docNumber ?? "",
        e.description ?? "",
        e.debit ? pdfMoney(e.debit) : "",
        e.credit ? pdfMoney(e.credit) : "",
        pdfMoney(e.balance),
      ]),
      totals: ["", "", "", "Closing balance", "", "", pdfMoney(s.closingBalance)],
    },
  ];
}

export async function customerStatementPdf(companyId: string, customerId: string, from?: string, to?: string): Promise<PrintedDocument> {
  const [header, s] = await Promise.all([companyHeader(companyId), ar.customerPeriodStatement(companyId, customerId, from, to)]);
  const pdf = renderPdf({
    title: header.name,
    subtitle: header.subtitle,
    blocks: statementBlocks(s.customer, s, "Customer statement"),
    footer: `Statement for ${s.customer.name}`,
  });
  return { filename: `statement-${safeName(s.customer.code)}-${s.from}-${s.to}.pdf`, pdf };
}

export async function supplierStatementPdf(companyId: string, supplierId: string, from?: string, to?: string): Promise<PrintedDocument> {
  const [header, s] = await Promise.all([companyHeader(companyId), ap.supplierPeriodStatement(companyId, supplierId, from, to)]);
  const pdf = renderPdf({
    title: header.name,
    subtitle: header.subtitle,
    blocks: statementBlocks(s.supplier, s, "Supplier statement"),
    footer: `Statement for ${s.supplier.name}`,
  });
  return { filename: `supplier-statement-${safeName(s.supplier.code)}-${s.from}-${s.to}.pdf`, pdf };
}

/** Remittance advice: what a supplier payment settles, for sending to the supplier. */
export async function remittancePdf(companyId: string, paymentId: string): Promise<PrintedDocument> {
  const [header, payment] = await Promise.all([
    companyHeader(companyId),
    prisma.apPayment.findFirst({
      where: { id: paymentId, companyId },
      include: {
        supplier: true,
        allocations: { include: { bill: { select: { billNumber: true, supplierInvoiceNumber: true, billDate: true, gross: true } } } },
      },
    }),
  ]);
  if (!payment) throw new Error("Payment does not exist");
  const allocated = payment.allocations.reduce((s, a) => s + money(a.amount), 0);
  const blocks: PdfBlock[] = [
    { kind: "heading", text: `${payment.status === "REVERSED" ? "REVERSED " : ""}Remittance advice ${payment.paymentNumber}` },
    {
      kind: "pairs",
      rows: [
        ["Supplier", `${payment.supplier.name} (${payment.supplier.code})`],
        ["Payment date", pdfDate(payment.paymentDate)],
        ["Method", payment.method.replace(/_/g, " ").toLowerCase()],
        ...(payment.reference ? ([["Reference", payment.reference]] as Array<[string, string]>) : []),
        ["Amount paid", pdfMoney(payment.amount)],
        ...(money(payment.withholdingTax) ? ([["Withholding tax deducted", pdfMoney(payment.withholdingTax)]] as Array<[string, string]>) : []),
      ],
    },
    {
      kind: "table",
      columns: [
        { header: "Your invoice", width: 110 },
        { header: "Our reference", width: 100 },
        { header: "Invoice date", width: 80 },
        { header: "Invoice total", width: 90, align: "right" },
        { header: "Settled", width: 90, align: "right" },
      ],
      rows: payment.allocations.map((a) => [
        a.bill.supplierInvoiceNumber ?? "",
        a.bill.billNumber,
        pdfDate(a.bill.billDate),
        pdfMoney(a.bill.gross),
        pdfMoney(a.amount),
      ]),
      totals: ["", "", "", "Total settled", pdfMoney(allocated)],
    },
  ];
  const unallocated = money(payment.unallocated);
  if (unallocated > 0) blocks.push({ kind: "text", text: `${pdfMoney(unallocated)} is held on account against future invoices.` });
  const pdf = renderPdf({ title: header.name, subtitle: header.subtitle, blocks, footer: `Remittance ${payment.paymentNumber}` });
  return { filename: `remittance-${safeName(payment.paymentNumber)}.pdf`, pdf };
}

/** Certificate of tax withheld from one supplier payment, for the supplier to claim the credit. */
export async function whtCertificatePdf(companyId: string, paymentId: string): Promise<PrintedDocument> {
  const [header, payment, company] = await Promise.all([
    companyHeader(companyId),
    prisma.apPayment.findFirst({ where: { id: paymentId, companyId }, include: { supplier: true } }),
    prisma.company.findUnique({ where: { id: companyId }, include: { profile: true, taxSettings: true } }),
  ]);
  if (!payment) throw new Error("Payment does not exist");
  const withheld = money(payment.withholdingTax);
  if (!(withheld > 0)) throw new Error(`Payment ${payment.paymentNumber} has no withholding tax`);
  if (payment.status !== "POSTED") throw new Error(`Payment ${payment.paymentNumber} was reversed; no withholding certificate is issued`);
  const gross = money(payment.amount) + withheld;
  // Prefer the effective rate on this payment so a later change to the supplier's rate cannot rewrite history.
  const rate = gross > 0 ? Math.round((withheld / gross) * 10_000) / 100 : money(payment.supplier.whtRate);
  const payerTin = company?.taxSettings?.tin || company?.profile?.taxIdentificationNumber || "";
  const day = payment.paymentDate.toISOString().slice(0, 10);
  const monthStart = `${day.slice(0, 7)}-01`;
  const monthEnd = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const blocks: PdfBlock[] = [
    { kind: "heading", text: `Withholding tax certificate ${payment.paymentNumber}` },
    {
      kind: "pairs",
      rows: [
        ["Withholding agent (payer)", header.name],
        ["Payer TIN", payerTin || "Not recorded"],
        ["Supplier (payee)", `${payment.supplier.name} (${payment.supplier.code})`],
        ["Supplier TIN", payment.supplier.tin || "Not recorded"],
        ...(payment.supplier.whtCategory ? ([["Category", payment.supplier.whtCategory]] as Array<[string, string]>) : []),
        ["Tax period", `${pdfDate(monthStart)} to ${pdfDate(monthEnd)}`],
        ["Payment date", pdfDate(payment.paymentDate)],
        ...(payment.reference ? ([["Payment reference", payment.reference]] as Array<[string, string]>) : []),
      ],
    },
    {
      kind: "table",
      columns: [
        { header: "Gross amount", width: 130, align: "right" },
        { header: "Rate", width: 80, align: "right" },
        { header: "Tax withheld", width: 130, align: "right" },
        { header: "Net paid", width: 130, align: "right" },
      ],
      rows: [[pdfMoney(gross), `${rate}%`, pdfMoney(withheld), pdfMoney(payment.amount)]],
    },
    {
      kind: "text",
      text: `We certify that ${pdfMoney(withheld)} was withheld from the payment above and is declared and paid to the tax authority${company?.taxSettings?.taxAuthority ? ` (${company.taxSettings.taxAuthority})` : ""} by the payer.`,
    },
  ];
  const pdf = renderPdf({ title: header.name, subtitle: header.subtitle, blocks, footer: `WHT certificate ${payment.paymentNumber}` });
  return { filename: `wht-certificate-${safeName(payment.paymentNumber)}.pdf`, pdf };
}
