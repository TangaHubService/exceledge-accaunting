import type { AccountingCapability } from "@exceledge/accounting-domain";
import { money } from "../../lib/documents";
import { prisma } from "../../lib/prisma";
import { projectFinancials } from "../workspace/projects.service";

type Range = { from?: Date; to?: Date };
type Column = { key: string; label: string; kind?: "money" | "date" | "number" };
export type DetailReport = { columns: Column[]; rows: Array<Record<string, unknown>>; totals: string[]; notes: string[] };
type Definition = { needs: AccountingCapability; run: (companyId: string, range: Range) => Promise<DetailReport> };

const LIMIT = 5000;
const during = (r: Range) => (r.from || r.to ? { ...(r.from ? { gte: r.from } : {}), ...(r.to ? { lte: r.to } : {}) } : undefined);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;
const round = (n: number) => Math.round(n * 100) / 100;
const M = (key: string, label: string): Column => ({ key, label, kind: "money" });
const D = (key: string, label: string): Column => ({ key, label, kind: "date" });
const N = (key: string, label: string): Column => ({ key, label, kind: "number" });
const T = (key: string, label: string): Column => ({ key, label });

function group<R>(rows: R[], keyOf: (r: R) => string, start: (r: R) => Record<string, unknown>, add: (into: Record<string, unknown>, r: R) => void) {
  const out = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const key = keyOf(r);
    const into = out.get(key) ?? start(r);
    add(into, r);
    out.set(key, into);
  }
  return [...out.values()];
}
const plus = (into: Record<string, unknown>, key: string, value: number) => (into[key] = round(Number(into[key] ?? 0) + value));

const SALES_NOTE = "Invoices before credit notes and refunds, in the company's currency. Sales without product lines, such as totals from the ERP, show as \"No product detail\".";

async function saleLines(companyId: string, range: Range) {
  const invoices = await prisma.arInvoice.findMany({
    where: { companyId, status: "POSTED", invoiceDate: during(range), OR: [{ sourceDocumentType: null }, { sourceDocumentType: { not: "CustomerOpening" } }] },
    include: { lines: { orderBy: { lineNumber: "asc" } }, customer: { select: { name: true, customerType: true } } },
    orderBy: { invoiceDate: "desc" },
    take: LIMIT,
  });
  const ids = [...new Set(invoices.flatMap((i) => i.lines.map((l) => l.itemId)).filter((x): x is string => Boolean(x)))];
  const items = new Map((await prisma.inventoryItem.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, name: true, purchaseCost: true } })).map((i) => [i.id, i]));
  return invoices.flatMap((i) => {
    const rate = Number(i.exchangeRate);
    const head = { date: day(i.invoiceDate), invoice: i.invoiceNumber, customer: i.customer.name, customerType: i.customer.customerType };
    if (!i.lines.length) return [{ ...head, product: "No product detail", description: i.description ?? "", quantity: 0, net: round((money(i.net) - money(i.discount)) * rate), cost: null as number | null }];
    return i.lines.map((l) => {
      const item = l.itemId ? items.get(l.itemId) : undefined;
      const quantity = Number(l.quantity);
      return { ...head, product: item?.name ?? l.description, description: l.description, quantity, net: round(money(l.net) * rate), cost: item?.purchaseCost != null ? round(quantity * money(item.purchaseCost)) : null };
    });
  });
}

async function timeRows(companyId: string, range: Range, where: Record<string, unknown> = {}) {
  const rows = await prisma.timeActivity.findMany({ where: { companyId, activityDate: during(range), ...where }, orderBy: { activityDate: "desc" }, take: LIMIT });
  return rows.map((t) => ({
    date: day(t.activityDate), person: t.personName, customer: t.customerName ?? "", service: t.service || "No service", hours: hours(t.durationMinutes), billable: t.billable ? "Yes" : "No",
    rate: t.hourlyRate == null ? null : money(t.hourlyRate), amount: t.billable && t.hourlyRate != null ? round(hours(t.durationMinutes) * money(t.hourlyRate)) : 0, notes: t.notes ?? "", edited: day(t.updatedAt),
  }));
}

async function openOrders(companyId: string, range: Range) {
  return prisma.commercialDocument.findMany({
    where: { companyId, kind: "PURCHASE_ORDER", status: { in: ["OPEN", "PARTIALLY_RECEIVED"] }, docDate: during(range) },
    include: { lines: { include: { item: { select: { name: true, type: true } } }, orderBy: { lineNumber: "asc" } } },
    orderBy: { docDate: "desc" },
    take: LIMIT,
  });
}

const REPORTS: Record<string, Definition> = {
  "estimates-by-customer": {
    needs: "ar:view",
    run: async (companyId, range) => {
      const rows = await prisma.commercialDocument.findMany({ where: { companyId, kind: { in: ["ESTIMATE", "PROPOSAL"] }, docDate: during(range) }, orderBy: [{ partyName: "asc" }, { docDate: "desc" }], take: LIMIT });
      return {
        columns: [T("customer", "Customer"), D("date", "Date"), T("number", "No."), T("status", "Status"), D("expires", "Expires"), T("currency", "Currency"), M("total", "Amount")],
        rows: rows.map((d) => ({ customer: d.partyName, date: day(d.docDate), number: d.number, status: d.status, expires: day(d.expirationDate), currency: d.currency, total: money(d.total) })),
        totals: [], notes: [],
      };
    },
  },
  "open-purchase-order-list": {
    needs: "ap:view",
    run: async (companyId, range) => ({
      columns: [D("date", "Date"), T("number", "No."), T("supplier", "Supplier"), D("due", "Expected"), T("status", "Status"), T("currency", "Currency"), M("total", "Amount")],
      rows: (await openOrders(companyId, range)).map((d) => ({ date: day(d.docDate), number: d.number, supplier: d.partyName, due: day(d.dueDate), status: d.status, currency: d.currency, total: money(d.total) })),
      totals: [], notes: [],
    }),
  },
  "open-purchase-order-detail": {
    needs: "ap:view",
    run: async (companyId, range) => ({
      columns: [D("date", "Date"), T("number", "No."), T("supplier", "Supplier"), T("product", "Product or category"), N("ordered", "Ordered"), N("received", "Received"), N("left", "Still to come"), T("currency", "Currency"), M("value", "Open value")],
      rows: (await openOrders(companyId, range)).flatMap((d) =>
        d.lines.map((l) => {
          const ordered = Number(l.quantity);
          // Only stock is received; anything else is open until billed.
          const done = l.item?.type === "INVENTORY" ? Number(l.receivedQuantity) : Number(l.billedQuantity);
          const left = Math.max(0, ordered - done);
          return { date: day(d.docDate), number: d.number, supplier: d.partyName, product: l.item?.name ?? l.description, ordered, received: done, left, currency: d.currency, value: ordered ? round((money(l.net) * left) / ordered) : 0 };
        }),
      ).filter((r) => r.left > 0),
      totals: [], notes: ["Lines that aren't stock count as received when they are billed."],
    }),
  },
  "sales-by-product-service-detail": {
    needs: "ar:view",
    run: async (companyId, range) => ({
      columns: [T("product", "Product or service"), D("date", "Date"), T("invoice", "Invoice"), T("customer", "Customer"), T("description", "Description"), N("quantity", "Qty"), M("net", "Amount")],
      rows: (await saleLines(companyId, range)).sort((a, b) => a.product.localeCompare(b.product) || b.date.localeCompare(a.date)),
      totals: ["net"], notes: [SALES_NOTE],
    }),
  },
  "sales-by-product-service-summary": {
    needs: "ar:view",
    run: async (companyId, range) => {
      const rows = group(await saleLines(companyId, range), (l) => l.product, (l) => ({ product: l.product }), (into, l) => (plus(into, "quantity", l.quantity), plus(into, "net", l.net)));
      const total = rows.reduce((s, r) => s + Number(r.net), 0);
      return {
        columns: [T("product", "Product or service"), N("quantity", "Qty"), M("net", "Amount"), N("share", "% of sales")],
        rows: rows.map((r) => ({ ...r, share: total ? round((Number(r.net) / total) * 100) : 0 })).sort((a, b) => Number((b as { net?: unknown }).net) - Number((a as { net?: unknown }).net)),
        totals: ["net"], notes: [SALES_NOTE],
      };
    },
  },
  "sales-by-customer-type-detail": {
    needs: "ar:view",
    run: async (companyId, range) => ({
      columns: [T("customerType", "Customer type"), T("customer", "Customer"), D("date", "Date"), T("invoice", "Invoice"), T("product", "Product or service"), M("net", "Amount")],
      rows: (await saleLines(companyId, range)).sort((a, b) => a.customerType.localeCompare(b.customerType) || a.customer.localeCompare(b.customer)),
      totals: ["net"], notes: [SALES_NOTE],
    }),
  },
  "product-item-profitability-by-customer": {
    needs: "ar:view",
    run: async (companyId, range) => {
      const lines = await saleLines(companyId, range);
      const rows = group(lines, (l) => `${l.customer}\n${l.product}`, (l) => ({ customer: l.customer, product: l.product, known: true }), (into, l) => {
        plus(into, "quantity", l.quantity);
        plus(into, "net", l.net);
        if (l.cost === null) into.known = false;
        else plus(into, "cost", l.cost);
      });
      return {
        columns: [T("customer", "Customer"), T("product", "Product or service"), N("quantity", "Qty"), M("net", "Sales"), M("cost", "Estimated cost"), M("margin", "Estimated margin")],
        rows: rows.map(({ known, ...r }) => ({ ...r, cost: known ? r.cost : "", margin: known ? round(Number(r.net) - Number(r.cost)) : "" })).sort((a, b) => String((a as { customer?: string }).customer).localeCompare(String((b as { customer?: string }).customer))),
        totals: ["net"],
        notes: [SALES_NOTE, "Estimated cost is quantity times the item's current purchase cost, not cost of sales from the ledger. Blank when no purchase cost is set."],
      };
    },
  },
  "project-profitability-summary": {
    needs: "project:view",
    run: async (companyId) => {
      const projects = await prisma.project.findMany({ where: { companyId }, select: { id: true, name: true, code: true, status: true }, orderBy: { name: "asc" }, take: 300 });
      const rows = [];
      for (const p of projects) {
        const f = (await projectFinancials(companyId, p.id)) as Record<string, unknown>;
        const income = Number(f.income ?? 0);
        const costs = Number(f.costs ?? 0);
        rows.push({ project: p.name, status: String(p.status), income, costs, profit: round(income - costs), margin: income ? round(((income - costs) / income) * 100) : "" });
      }
      return { columns: [T("project", "Project"), T("status", "Status"), M("income", "Income"), M("costs", "Costs"), M("profit", "Profit"), N("margin", "Margin %")], rows, totals: ["income", "costs", "profit"], notes: ["All posted entries tagged to the project, whatever the dates."] };
    },
  },
  "time-activities-by-employee-detail": {
    needs: "team:view",
    run: async (companyId, range) => ({
      columns: [T("person", "Employee"), D("date", "Date"), T("customer", "Customer"), T("service", "Service"), N("hours", "Hours"), T("billable", "Billable"), M("rate", "Rate"), M("amount", "Amount"), T("notes", "Notes")],
      rows: (await timeRows(companyId, range)).sort((a, b) => a.person.localeCompare(b.person) || b.date.localeCompare(a.date)),
      totals: ["hours", "amount"], notes: [],
    }),
  },
  "recent-edited-time-activities": {
    needs: "team:view",
    run: async (companyId, range) => ({
      columns: [D("edited", "Last changed"), T("person", "Employee"), D("date", "Date"), T("customer", "Customer"), T("service", "Service"), N("hours", "Hours"), T("billable", "Billable")],
      rows: (await timeRows(companyId, range)).sort((a, b) => b.edited.localeCompare(a.edited)),
      totals: ["hours"], notes: [],
    }),
  },
  "time-summary-by-pay-type": {
    needs: "team:view",
    run: async (companyId, range) => ({
      columns: [T("service", "Service"), T("billable", "Billable"), N("entries", "Entries"), N("hours", "Hours"), M("amount", "Billable amount")],
      rows: group(await timeRows(companyId, range), (t) => `${t.service}\n${t.billable}`, (t) => ({ service: t.service, billable: t.billable }), (into, t) => (plus(into, "entries", 1), plus(into, "hours", t.hours), plus(into, "amount", t.amount))),
      totals: ["hours", "amount"], notes: ["Time here is recorded by service, not by pay type, so it is summed by service."],
    }),
  },
  "unbilled-time": {
    needs: "team:view",
    run: async (companyId, range) => ({
      columns: [T("customer", "Customer"), D("date", "Date"), T("person", "Employee"), T("service", "Service"), N("hours", "Hours"), M("rate", "Rate"), M("amount", "Amount")],
      rows: (await timeRows(companyId, range, { billable: true })).sort((a, b) => a.customer.localeCompare(b.customer)),
      totals: ["hours", "amount"], notes: ["Billable time. Time isn't linked to invoices here, so entries stay listed after they are billed."],
    }),
  },
  "unbilled-charges": {
    needs: "ar:view",
    run: async (companyId, range) => {
      const rows = await prisma.commercialDocument.findMany({ where: { companyId, kind: "DELAYED_CHARGE", status: "OPEN", docDate: during(range) }, orderBy: [{ partyName: "asc" }, { docDate: "asc" }], take: LIMIT });
      return { columns: [T("customer", "Customer"), D("date", "Date"), T("number", "No."), T("memo", "Memo"), T("currency", "Currency"), M("total", "Amount")], rows: rows.map((d) => ({ customer: d.partyName, date: day(d.docDate), number: d.number, memo: d.memo ?? "", currency: d.currency, total: money(d.total) })), totals: [], notes: [] };
    },
  },
  "statement-list": {
    needs: "ar:view",
    run: async (companyId, range) => {
      const events = await prisma.auditEvent.findMany({ where: { companyId, action: "EMAIL", entityType: "Customer", createdAt: during(range) }, orderBy: { createdAt: "desc" }, take: LIMIT });
      const sent = events.filter((e) => (e.afterJson as { kind?: string } | null)?.kind === "STATEMENT");
      const names = new Map((await prisma.customer.findMany({ where: { companyId, id: { in: sent.map((e) => e.entityId ?? "") } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
      return { columns: [D("date", "Sent"), T("customer", "Customer"), T("to", "To")], rows: sent.map((e) => ({ date: day(e.createdAt), customer: names.get(e.entityId ?? "") ?? "", to: (e.afterJson as { to?: string }).to ?? "" })), totals: [], notes: ["Statements emailed from this app."] };
    },
  },
};

export const detailReport = (slug: string) => (Object.prototype.hasOwnProperty.call(REPORTS, slug) ? REPORTS[slug] : undefined);
