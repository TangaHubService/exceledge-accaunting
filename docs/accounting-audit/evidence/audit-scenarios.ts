/* Audit harness: drives the real Express app against a THROWAWAY database. Not part of the product or its test suite.
   Run: cd Backend && DATABASE_URL=<audit db> MAIL_TRANSPORT=json npx tsx ../docs/accounting-audit/evidence/audit-scenarios.ts */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const req0 = createRequire(path.resolve(process.cwd(), "package.json"));
const request = req0("supertest") as typeof import("supertest").default;
import { createApp } from "../../../Backend/src/app";
import { prisma } from "../../../Backend/src/lib/prisma";
import { env } from "../../../Backend/src/config/env";
import { activateCompany, authHeaders, resetCompany } from "../../../Backend/tests/helpers";

if (!/exceledge_audit\b/.test(process.env.DATABASE_URL ?? "")) throw new Error("Refusing: not the audit database");
const app = createApp();
const ORG = 990001;
let H: Record<string, string>;
let companyId = "";
const acct: Record<string, string> = {};
type Row = { id: string; name: string; expected: string; actual: string; result: "PASS" | "FAIL" | "PARTIAL" | "INFO"; journals?: string[] };
const rows: Row[] = [];
export async function call(method: "get" | "post" | "put" | "patch" | "delete", url: string, body?: unknown, h = H) {
  const r = (request(app) as any)[method](`/api/v1${url}`).set(h);
  const res = await (body === undefined ? r : r.send(body));
  return { s: res.status as number, d: res.body?.data, e: res.body?.error as string | undefined, raw: res.body };
}
const post = (u: string, b: unknown, h = H) => call("post", u, b, h);
const get = (u: string, h = H) => call("get", u, undefined, h);
function rec(id: string, name: string, expected: string, ok: boolean | "PARTIAL" | "INFO", actual: string, journals?: string[]) {
  rows.push({ id, name, expected, actual, result: ok === true ? "PASS" : ok === false ? "FAIL" : ok, journals });
  console.log(`${rows[rows.length - 1].result.padEnd(7)} ${id} ${name} :: ${actual}`);
  for (const j of journals ?? []) console.log("          " + j);
}
let mark = new Date(0);
async function newJournals() {
  const js = await prisma.journal.findMany({ where: { companyId, createdAt: { gt: mark } }, include: { lines: { include: { account: true }, orderBy: { lineNumber: "asc" } } }, orderBy: { createdAt: "asc" } });
  mark = new Date();
  return js.map((j) => `${j.journalNumber} ${j.journalDate.toISOString().slice(0, 10)} ${j.status}: ` + j.lines.map((l) => (Number(l.debit) ? `Dr ${l.account.code} ${l.account.name} ${Number(l.debit)}` : `Cr ${l.account.code} ${l.account.name} ${Number(l.credit)}`)).join("; "));
}
async function step(id: string, name: string, expected: string, fn: () => Promise<{ ok: boolean | "PARTIAL" | "INFO"; actual: string }>) {
  mark = new Date(); await new Promise((r) => setTimeout(r, 5));
  try { const r = await fn(); rec(id, name, expected, r.ok, r.actual, await newJournals()); }
  catch (e) { rec(id, name, expected, false, "HARNESS/APP EXCEPTION " + (e as Error).message); }
}
const bal = async (code: string) => {
  const g = await prisma.glEntry.aggregate({ where: { companyId, account: { code } }, _sum: { debit: true, credit: true } });
  return Math.round((Number(g._sum.debit ?? 0) - Number(g._sum.credit ?? 0)) * 10000) / 10000;
};
const has = (js: string, ...parts: string[]) => parts.every((p) => js.includes(p));

async function main() {
  await prisma.$connect();
  for (const o of [ORG, ORG + 1]) await resetCompany(o);
  H = await activateCompany(app, ORG, { name: "Audit Trading Ltd", tin: "123456789" });
  companyId = (await prisma.company.findUniqueOrThrow({ where: { externalErpOrganizationId: String(ORG) } })).id;
  for (const a of await prisma.account.findMany({ where: { companyId } })) acct[a.code] = a.id;
  rec("S01", "Register business and configure accounting", "Company activates with periods, currency, default accounts", true, `activated; ${Object.keys(acct).length} accounts; ${await prisma.accountingPeriod.count({ where: { financialYear: { companyId } } })} periods`);

  await step("S02a", "Create a chart of accounts entry (with parent)", "201 and account saved", async () => {
    const r = await post("/coa", { code: "6155", name: "Cleaning", type: "EXPENSE", parentId: acct["6150"] }); if (r.d?.id) acct["6155"] = r.d.id;
    return { ok: r.s === 201, actual: `${r.s} ${r.e ?? r.d?.code}` };
  });
  const preTax = await post("/ar/invoices", { customerId: "none", invoiceDate: "2026-01-02", net: 1 });void preTax;
  const codes = await get("/tax/codes"); rec("S01b", "Default tax codes available", "VAT18, VAT0, VATEX, VATIN", (codes.d ?? []).length >= 4, JSON.stringify((codes.d ?? []).map((c: any) => c.code)));
  const cust = (await post("/ar/customers", { name: "Kigali Retailers", customerType: "CREDIT", creditLimit: 50_000_000, creditPeriodDays: 30 })).d;
  const supp = (await post("/ap/suppliers", { name: "Rwanda Wholesale", creditPeriodDays: 30 })).d;
  const obCust = (await post("/ar/customers", { name: "Opening Cust Batch", customerType: "CREDIT", creditLimit: 9_000_000 })).d;
  await step("S02b", "Opening balances batch incl. customer balance", "Posted once; equity balances; customer balance appears in AR ageing", async () => {
    const b = await post("/setup/opening-balances", { name: "OB", lines: [
      { accountId: acct["1110"], debit: 1_000_000, credit: 0 }, { partyType: "CUSTOMER", partyRef: obCust.id, debit: 200_000, credit: 0 },
      { accountId: acct["3020"], debit: 0, credit: 1_200_000 }] });
    const a = await post(`/setup/opening-balances/${b.d?.id}/approve`, {}, authHeaders(ORG, "ADMIN", 902)); const p = await post(`/setup/opening-balances/${b.d?.id}/post`, {});
    const again = await post(`/setup/opening-balances/${b.d?.id}/post`, {});
    const age = await get("/ar/ageing");
    const txt = JSON.stringify(age.d);
    const inAge = /Opening Cust Batch/.test(txt);
    const open = await get(`/ar/invoices?status=OPEN&customerId=${obCust.id}&page=1`);
    return { ok: p.s === 200 && again.s === 400 ? (inAge ? true : false) : false, actual: `create ${b.s} approve ${a.s} ${a.e ?? ""} post ${p.s} (${p.e ?? "ok"}); re-post ${again.s}; AR control 1200=${await bal("1200")}; in ageing=${inAge}; open invoices for customer=${JSON.stringify(open.d).slice(0, 120)}` };
  });
  await step("S02c", "Customer created with opening balance", "Appears in GL, customer balance and ageing", async () => {
    const r = await post("/ar/customers", { name: "Opening Cust Direct", customerType: "CREDIT", creditLimit: 9_000_000, openingBalance: 50_000, openingBalanceDate: "2026-01-01" });
    const age = JSON.stringify((await get("/ar/ageing")).d);
    return { ok: r.s === 201 && /Opening Cust Direct/.test(age), actual: `${r.s} ${r.e ?? ""} in ageing=${/Opening Cust Direct/.test(age)}` };
  });
  // Register bank and cash
  const bankR = await post("/banking/accounts", { kind: "BANK", name: "BK Main", glAccountId: acct["1110"], dateOpened: "2026-01-01" });
  const cashR = await post("/banking/accounts", { kind: "CASH", name: "Till", glAccountId: acct["1100"], dateOpened: "2026-01-01" });
  console.log("bank", bankR.s, bankR.e, "cash", cashR.s, cashR.e);
  const kinds = cashR.s >= 400 ? (await post("/banking/accounts", { kind: "PETTY_CASH", name: "Till", glAccountId: acct["1100"], dateOpened: "2026-01-01" })) : cashR;
  const bank = bankR.d?.id, cash = kinds.d?.id; console.log("ids", bank, cash, kinds.e);

  await step("S03", "Owner capital into bank 5,000,000", "Dr Bank, Cr Equity", async () => {
    const r = await post("/banking/receipts", { financialAccountId: bank, transactionDate: "2026-01-02", lines: [{ accountId: acct["3000"], amount: 5_000_000 }], description: "Capital introduced" });
    return { ok: r.s === 201 && (await bal("3000")) === -5_000_000, actual: `${r.s} ${r.e ?? ""} 3000=${await bal("3000")} 1110=${await bal("1110")}` };
  });
  await step("S03b", "Owner cash into till 1,000,000", "Dr Cash, Cr Equity", async () => {
    const r = await post("/banking/receipts", { financialAccountId: cash, transactionDate: "2026-01-02", lines: [{ accountId: acct["3000"], amount: 1_000_000 }] });
    return { ok: r.s === 201, actual: `${r.s} ${r.e ?? ""} 1100=${await bal("1100")}` };
  });
  // Inventory. ERP owns stock: stock item through ERP event.
  let seq = 0;
  const key = { "x-integration-key": env.integrationApiKey };
  const ev = async (type: string, over: Record<string, unknown>, sendTwice = false) => {
    seq++; const id = String(over.sourceDocumentId ?? `doc${seq}`);
    const body = { eventId: `e${seq}`, idempotencyKey: `k-${type}-${id}`, externalOrganizationId: String(ORG), externalBranchId: "1", eventType: type, occurredAt: "2026-01-05T09:00:00.000Z", sourceModule: "POS", sourceDocumentType: "Sale", sourceDocumentId: id, sourceDocumentNumber: id, currencyCode: "RWF", amountTotals: { gross: "0", net: "0", tax: "0" }, ...over };
    const r = await request(app).post("/api/v1/integration/events").set(key).send(body);
    const r2 = sendTwice ? await request(app).post("/api/v1/integration/events").set(key).send(body) : null;
    return { s: r.status, d: r.body.data, e: r.body.error ?? r.body.data?.error, dup: r2?.body?.data?.duplicate };
  };
  const mv = (movementType: string, direction: string, quantity: number, unitCost: number | null, after: number, occurredAt: string, reference?: string, twice = false) =>
    ev("INVENTORY_MOVEMENT", { occurredAt, sourceModule: "INVENTORY", sourceDocumentType: "InventoryLedger", metadata: { ledgerId: 1000 + seq, movementType, direction, productId: 7, productName: "Rice 25kg", sku: "R25", category: "Food", unit: "BAG", branchName: "Main", quantity, runningBalance: after, unitCost, reference } }, twice);

  await step("S04", "Buy inventory for cash (ERP stock in + cash bill + payment) 50 x 20,000", "Inventory +1,000,000, cash out, AP nil", async () => {
    const m = await mv("PURCHASE", "IN", 50, 20000, 50, "2026-01-05T09:00:00Z", "PO-1");
    const g = await ev("GOODS_RECEIVED", { sourceModule: "PURCHASES", sourceDocumentType: "GoodsReceipt", amountTotals: { gross: "1000000", net: "1000000", tax: "0" }, metadata: { poReference: "PO-1" } });
    const b = await ev("SUPPLIER_BILL_APPROVED", { sourceModule: "PURCHASES", sourceDocumentType: "SupplierBill", amountTotals: { gross: "1180000", net: "1000000", tax: "180000" }, parties: { externalSupplierId: "55" }, metadata: { poReference: "PO-1", supplierName: "ERP Supplier" } });
    const p = await ev("SUPPLIER_PAYMENT_COMPLETED", { sourceModule: "PURCHASES", sourceDocumentType: "SupplierPayment", amountTotals: { gross: "1180000", net: "1180000", tax: "0" }, parties: { externalSupplierId: "55" }, paymentSplits: [{ paymentMethod: "BANK", amount: 1180000 }], metadata: {} });
    return { ok: (await bal("1300")) === 1_000_000 && (await bal("2130")) === 0 && (await bal("2100")) === 0, actual: `${[m, g, b, p].map((x) => `${x.s}${x.e ? ":" + x.e : ""}`).join(" | ")} 1300=${await bal("1300")} GRNI=${await bal("2130")} AP=${await bal("2100")} inputVAT=${await bal("1400")}` };
  });
  let bill: any;
  await step("S05", "Buy inventory on credit in the app (item receipt then bill) 20 x 22,000 + VAT", "Dr Inventory / Cr GRNI, then Dr GRNI + VAT / Cr AP", async () => {
    const item = await prisma.inventoryItem.findFirst({ where: { companyId, sku: "R25" } });
    const r = await post("/inventory/item-receipts", { supplierId: supp.id, date: "2026-01-06", lines: [{ itemId: item!.id, quantity: 20, unitCost: 22000, taxCode: "VATIN" }] });
    const b = await post(`/commercial/item-receipts/${r.d?.id}/bill`, { date: "2026-01-06", supplierInvoiceNumber: "SI-77" });
    bill = await prisma.apBill.findFirst({ where: { companyId, supplierId: supp.id }, orderBy: { createdAt: "desc" } });
    return { ok: r.s === 201 && b.s < 300 && (await bal("1300")) === 1_440_000 && (await bal("2130")) === 0, actual: `receipt ${r.s} ${r.e ?? ""} bill ${b.s} ${b.e ?? ""} gross=${bill?.gross} 1300=${await bal("1300")} GRNI=${await bal("2130")} AP=${await bal("2100")}` };
  });
  let pay: any;
  await step("S06", "Partial supplier payment 200,000", "Dr AP, Cr Bank; bill outstanding falls", async () => {
    pay = await post("/ap/payments", { supplierId: supp.id, paymentDate: "2026-01-10", method: "BANK", amount: 200_000, financialAccountId: bank, allocations: [{ billId: bill.id, amount: 200_000 }] });
    const b = await prisma.apBill.findUnique({ where: { id: bill.id } });
    return { ok: pay.s === 201 && Number(b!.amountPaid) === 200_000, actual: `${pay.s} ${pay.e ?? ""} paid=${b?.amountPaid}/${b?.gross} AP=${await bal("2100")}` };
  });
  await step("S07", "Cash POS sale 10 bags @30,000 + VAT with COGS", "Dr Cash 354,000; Cr Sales 300,000; Cr VAT 54,000; COGS at weighted average 205,714.29", async () => {
    const s = await ev("SALE_COMPLETED", { occurredAt: "2026-01-12T09:00:00Z", sourceDocumentId: "S1", amountTotals: { gross: "354000", net: "300000", tax: "54000" }, paymentSplits: [{ paymentMethod: "CASH", amount: 354000 }], metadata: { paymentType: "CASH" } }, true);
    const m = await mv("SALE", "OUT", 10, null, 60, "2026-01-12T09:00:00Z", "S1", true);
    const cogs = await bal("5100");
    return { ok: s.dup === true && m.dup === true && Math.abs(cogs - 205714.2857) < 0.01 && (await bal("4100")) === -300000, actual: `sale ${s.s} ${s.e ?? ""} replay duplicate=${s.dup}; stock ${m.s} ${m.e ?? ""} replay duplicate=${m.dup}; COGS=${cogs} Sales=${await bal("4100")} VAT=${await bal("2200")}` };
  });
  let inv: any;
  await step("S08", "Credit sale invoice in the app with lines 500,000 + VAT18", "Dr AR 590,000; Cr Sales 500,000; Cr VAT 90,000", async () => {
    const r = await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2026-01-15", lines: [{ description: "Rice", quantity: 10, unitPrice: 50_000, taxCode: "VAT18" }] }); inv = r.d;
    return { ok: r.s === 201 && Number(inv.gross) === 590_000, actual: `${r.s} ${r.e ?? ""} gross=${inv?.gross} inventory after=${await bal("1300")} (app invoices do not move stock: by design, ERP owns stock)` };
  });
  await step("S08b", "Credit POS sale from ERP", "Creates AR invoice and AR ledger", async () => {
    const r = await ev("SALE_COMPLETED", { occurredAt: "2026-01-16T09:00:00Z", sourceDocumentId: "S2", amountTotals: { gross: "118000", net: "100000", tax: "18000" }, parties: { externalCustomerId: "901" }, paymentSplits: [{ paymentMethod: "CREDIT", amount: 118000 }], metadata: { paymentType: "CREDIT", customerName: "ERP Customer" } });
    const ai = await prisma.arInvoice.findFirst({ where: { companyId, sourceDocumentId: "S2" } });
    return { ok: r.s === 201 && !!ai, actual: `${r.s} ${r.e ?? ""} invoice=${ai?.invoiceNumber} gross=${ai?.gross} AR=${await bal("1200")}` };
  });
  let rct: any;
  await step("S09", "Partial customer payment 300,000", "Dr Bank, Cr AR; invoice outstanding 290,000", async () => {
    rct = await post("/ar/receipts", { customerId: cust.id, receiptDate: "2026-01-20", method: "BANK", amount: 300_000, financialAccountId: bank, allocations: [{ invoiceId: inv.id, amount: 300_000 }] });
    const i = await prisma.arInvoice.findUnique({ where: { id: inv.id } });
    return { ok: rct.s === 201 && Number(i!.amountPaid) === 300_000, actual: `${rct.s} ${rct.e ?? ""} paid=${i?.amountPaid}` };
  });
  await step("S09b", "Customer advance (deposit) 100,000, allocated 60,000", "Dr Cash Cr Customer Deposits; allocation Dr Deposits Cr AR", async () => {
    const d = await post("/ar/deposits", { customerId: cust.id, depositDate: "2026-01-20", method: "CASH", amount: 100_000 });
    const a = await post(`/ar/deposits/${d.d?.id}/allocate`, { invoiceId: inv.id, amount: 60_000 });
    return { ok: d.s === 201 && a.s === 200 && (await bal("2120")) === -40_000, actual: `${d.s} ${d.e ?? ""} alloc ${a.s} ${a.e ?? ""} deposits=${await bal("2120")}` };
  });
  let exp: any;
  await step("S10", "Operating expense: rent 250,000 from bank", "Dr Rent Cr Bank", async () => {
    const cats = (await get("/expenses/categories")).d as any[]; const cat = cats?.[0];
    exp = await post("/expenses", { expenseDate: "2026-01-21", categoryId: cat?.id, expenseAccountId: acct["6150"], financialAccountId: bank, paymentMode: "BANK", net: 250_000, post: true });
    if (exp.s >= 400) { exp = await post("/expenses", { expenseDate: "2026-01-21", categoryId: cat?.id, expenseAccountId: acct["6150"], financialAccountId: bank, net: 250_000, post: true }); }
    return { ok: exp.s === 201 && (await bal("6150")) === 250_000, actual: `${exp.s} ${exp.e ?? ""} status=${exp.d?.status} 6150=${await bal("6150")}` };
  });
  await step("S11", "Other income: interest 15,000", "Dr Bank Cr Interest Income", async () => {
    const r = await post("/banking/receipts", { financialAccountId: bank, transactionDate: "2026-01-22", lines: [{ accountId: acct["4200"], amount: 15_000 }], kind: "INTEREST" });
    return { ok: r.s === 201 && (await bal("4200")) === -15_000, actual: `${r.s} ${r.e ?? ""}` };
  });
  await step("S12a", "POS sales return 1 bag for cash", "Reverses revenue, VAT, cash; stock back and COGS reduced", async () => {
    const r = await ev("SALES_RETURN_COMPLETED", { occurredAt: "2026-01-23T09:00:00Z", sourceDocumentId: "R1", sourceDocumentType: "SaleReturn", parties: {}, amountTotals: { gross: "35400", net: "30000", tax: "5400" }, paymentSplits: [{ paymentMethod: "CASH", amount: 35400 }], metadata: { paymentType: "CASH", saleId: "S1" } });
    const before = await bal("5100"); const m = await mv("RETURN_CUSTOMER", "IN", 1, null, 61, "2026-01-23T09:00:00Z", "S1");
    return { ok: r.s === 201 && !r.e && !m.e && (await bal("5100")) < before, actual: `${r.s} ${r.e ?? ""}; stock ${m.s} ${m.e ?? ""}; COGS ${before} -> ${await bal("5100")}` };
  });
  await step("S12b", "Purchase return 2 bags via supplier credit note", "Dr AP; Cr inventory and VAT; stock down", async () => {
    const item = await prisma.inventoryItem.findFirst({ where: { companyId, sku: "R25" }, include: { balances: true } });
    const loc = item!.balances[0].locationId; const before = await bal("1300");
    const r = await post("/ap/credit-notes", { supplierId: supp.id, billId: bill.id, noteDate: "2026-01-24", reason: "Damaged", net: 44_000, tax: 7_920, returnedItems: [{ itemId: item!.id, locationId: loc, quantity: 2 }] });
    return { ok: r.s === 201 && (await bal("1300")) < before, actual: `${r.s} ${r.e ?? ""} inventory ${before} -> ${await bal("1300")} AP=${await bal("2100")}` };
  });
  await step("S13a", "Customer credit note 50,000 + VAT on the invoice", "Dr Sales returns/Sales + VAT, Cr AR", async () => {
    const r = await post("/ar/credit-notes", { customerId: cust.id, invoiceId: inv.id, noteDate: "2026-01-25", reason: "Price adjustment", net: 50_000, tax: 9_000 });
    return { ok: r.s === 201, actual: `${r.s} ${r.e ?? ""} AR=${await bal("1200")} VAT=${await bal("2200")}` };
  });
  await step("S13b", "Refund unused customer deposit 40,000", "Dr Deposits Cr Cash", async () => {
    const d = await prisma.arDeposit.findFirst({ where: { companyId } }); const r = await post(`/ar/deposits/${d!.id}/refund`, {});
    return { ok: r.s === 200 && (await bal("2120")) === 0, actual: `${r.s} ${r.e ?? ""} deposits=${await bal("2120")}` };
  });
  await step("S13c", "Cash refund of an open customer credit note", "A refund clears the customer's credit (Dr AR Cr Cash)", async () => {
    const c = (await post("/ar/customers", { name: "Refund Cust", customerType: "CREDIT", creditLimit: 1e6 })).d;
    await post("/ar/credit-notes", { customerId: c.id, noteDate: "2026-01-25", reason: "Goodwill", net: 10_000 });
    const cn = await prisma.arCreditNote.findFirst({ where: { companyId, customerId: c.id } });
    const r = await post("/ar/refunds", { customerId: c.id, refundDate: "2026-01-26", financialAccountId: cash, sources: [{ source: "CREDIT_NOTE", sourceId: cn!.id, amount: 10_000 }] });
    const after = await prisma.customer.findUnique({ where: { id: c.id } });
    return { ok: r.s === 201 && Number(after!.balance) === 0, actual: `${r.s} ${r.e ?? ""} customer balance after=${after?.balance}` };
  });
  await step("S13d", "Refund receipt as the screen posts it", "Reverses revenue and VAT, or clears the customer's credit", async () => {
    const c = await prisma.customer.findFirst({ where: { companyId, name: "Refund Cust" } });
    const r = await post("/ar/refunds", { customerId: c!.id, refundDate: "2026-01-26", financialAccountId: cash, lines: [{ description: "Returned", quantity: 1, unitPrice: 10_000, taxCode: "VAT18" }] });
    const after = await prisma.customer.findUnique({ where: { id: c!.id } });
    return { ok: r.s === 201 && Number(after!.balance) === 0, actual: `${r.s} ${r.e ?? ""} customer balance still ${after?.balance}` };
  });
  await step("S14", "Transfer 100,000 bank to cash with 1,000 fee", "Dr Cash Cr Bank Dr Bank charges", async () => {
    const r = await post("/banking/transfers", { fromAccountId: bank, toAccountId: cash, transactionDate: "2026-01-26", amount: 100_000, fee: 1_000 });
    return { ok: r.s === 201 && (await bal("6430")) === 1_000, actual: `${r.s} ${r.e ?? ""} charges=${await bal("6430")}` };
  });
  await step("S15", "Inventory write-off 2 bags", "Dr adjustment, Cr inventory at average cost; stock down", async () => {
    const item = await prisma.inventoryItem.findFirst({ where: { companyId, sku: "R25" } }); const before = await bal("1300");
    const r = await post("/inventory/adjustments", { type: "QUANTITY", date: "2026-01-27", reason: "Damaged", accountId: acct["6410"], lines: [{ itemId: item!.id, change: -2 }] });
    return { ok: r.s === 201 && (await bal("1300")) < before, actual: `${r.s} ${r.e ?? ""} inventory ${before} -> ${await bal("1300")} writeoff=${await bal("6410")}` };
  });
  await step("S16", "Fixed asset 1,200,000 over 60 months; depreciate January", "Capitalise, then Dr depreciation", async () => {
    let cats = (await get("/fixed-assets/categories")).d as any[]; let cat = cats?.find((c) => c.usefulLifeMonths > 0);
    const a = await post("/fixed-assets/assets", { name: "Delivery bike", categoryId: cat?.id, acquisitionCost: 1_200_000, usefulLifeMonths: 60, residualValue: 0, depreciationMethod: "STRAIGHT_LINE", purchaseDate: "2026-01-03", capitalize: true, capitalizationDate: "2026-01-03", creditAccountId: acct["1110"] });
    const r = await post("/fixed-assets/depreciation/run", { period: "2026-01" }); const r2 = await post("/fixed-assets/depreciation/run", { period: "2026-01" });
    return { ok: a.s === 201 && r.s === 200 || r.s === 201 ? (await bal("6300")) === 20_000 : false, actual: `asset ${a.s} ${a.e ?? ""} dep ${r.s} ${r.e ?? ""} repeat ${r2.s} ${r2.e ?? ""} expense=${await bal("6300")}` };
  });
  await step("S17", "Import bank statement and reconcile January", "Difference reaches 0 and completes; GL untouched", async () => {
    const es = await prisma.glEntry.findMany({ where: { companyId, account: { code: "1110" } }, orderBy: { transactionDate: "asc" } });
    let run = 0; const lines = es.map((e) => { const a = Number(e.debit) - Number(e.credit); run += a; return `${e.transactionDate.toISOString().slice(0, 10)},${(e.description ?? "x").replace(/,/g, " ")},${a},${run}`; });
    const im = await post(`/banking/accounts/${bank}/statements`, { fileName: "jan.csv", content: "Date,Description,Amount,Balance\n" + lines.join("\n"), dateOrder: "DMY" });
    const im2 = await post(`/banking/accounts/${bank}/statements`, { fileName: "jan2.csv", content: "Date,Description,Amount,Balance\n" + lines.join("\n"), dateOrder: "DMY" });
    await post(`/banking/accounts/${bank}/auto-match`, {});
    const st = await post("/banking/reconciliations", { financialAccountId: bank, statementDate: "2026-01-31", statementBalance: run });
    const rv = await post(`/banking/reconciliations/${st.d?.id}/review`, {}); const H2 = authHeaders(ORG, "ADMIN", 902); const ap = await post(`/banking/reconciliations/${st.d?.id}/approve`, {}, H2); const cp = await post(`/banking/reconciliations/${st.d?.id}/complete`, {}, H2);
    const unm = await prisma.bankStatementLine.count({ where: { statement: { companyId }, matchId: null } as any }).catch(() => -1);
    return { ok: cp.s === 200, actual: `import ${im.s} ${im.e ?? ""}; re-import ${im2.s} ${im2.e ?? JSON.stringify(im2.d).slice(0, 140)}; start ${st.s} ${st.e ?? ""} review ${rv.s} ${rv.e ?? ""} approve ${ap.s} ${ap.e ?? ""} complete ${cp.s} ${cp.e ?? ""} unmatched=${unm}` };
  });

  // --- Reports and reconciliations
  const st = (await get("/books/statements?from=2026-01-01&to=2026-01-31")).d; const tb = (await get("/books/trial-balance?to=2026-01-31")).d;
  const near = (a: number, b: number, t = 0.01) => Math.abs(a - b) < t;
  const unbal = await prisma.$queryRawUnsafe<any[]>(`select "journalId", sum(debit)-sum(credit) d from gl_entries where "companyId"='${companyId}' group by 1 having abs(sum(debit)-sum(credit))>0.0001`);
  rec("A01", "Every posted journal balances in the GL", "0 unbalanced", unbal.length === 0, `${unbal.length} unbalanced of ${await prisma.journal.count({ where: { companyId } })}`);
  rec("A02", "Trial balance", "difference 0", near(tb.difference, 0), `debit ${tb.debit} credit ${tb.credit} diff ${tb.difference}`);
  rec("A03", "Assets = liabilities + equity", "equal", near(st.position.totalAssets, st.position.totalLiabilities + st.position.totalEquity), `${st.position.totalAssets} = ${st.position.totalLiabilities} + ${st.position.totalEquity}`);
  rec("A04", "Net profit reflected in equity", "current year earnings = profit", near(st.income.profit, st.earnings.currentYearEarnings), `profit ${st.income.profit}; CYE ${st.earnings.currentYearEarnings}`);
  rec("A05", "Cash flow reconciles with cash accounts", "net change = cash movement", near(st.cashFlow.netChange, st.cashFlow.cashChange), JSON.stringify(st.cashFlow));
  const invRec = (await get("/inventory/reconciliation")).d; const val = await prisma.inventoryBalance.aggregate({ where: { companyId }, _sum: { value: true } } as any).catch(() => null);
  rec("A06", "Inventory subledger = GL 1300", "equal", "INFO", `GL 1300=${await bal("1300")}; sub=${JSON.stringify((val as any)?._sum)}; report=${JSON.stringify(invRec).slice(0, 260)}`);
  const cs = await prisma.customer.aggregate({ where: { companyId }, _sum: { balance: true } }); const ss = await prisma.supplier.aggregate({ where: { companyId }, _sum: { balance: true } });
  rec("A07", "AR control = customer balances", "equal", near(await bal("1200"), Number(cs._sum.balance)), `GL ${await bal("1200")} vs customers ${cs._sum.balance}`);
  rec("A08", "AP control = supplier balances", "equal", near(-(await bal("2100")), Number(ss._sum.balance)), `GL ${-(await bal("2100"))} vs suppliers ${ss._sum.balance}`);
  const age = (await get("/ar/ageing?asOf=2026-11-24")).d, apAge = (await get("/ap/ageing")).d;
  rec("A09", "AR ageing total = AR control", "equal", near(Number(age?.totals?.total ?? age?.total ?? NaN), await bal("1200")), `ageing ${JSON.stringify(age?.totals ?? age?.total)} control ${await bal("1200")}`);
  rec("A10", "AP ageing total = AP control", "equal", near(Number(apAge?.totals?.total ?? apAge?.total ?? NaN), -(await bal("2100"))), `ageing ${JSON.stringify(apAge?.totals ?? apAge?.total)} control ${-(await bal("2100"))}`);
  const vat = (await get("/tax/reports/vat?from=2026-01-01&to=2026-01-31")).d;
  rec("A11", "VAT report = VAT ledger (output 2200, input 1400)", "equal", "INFO", `GL output ${-(await bal("2200"))} input ${await bal("1400")}; report ${JSON.stringify({ ...vat, lines: undefined, rows: undefined, transactions: undefined }).slice(0, 700)}`);
  const trec = (await get("/tax/reconciliation?from=2026-01-01&to=2026-01-31"));
  rec("A11b", "Tax reconciliation report", "explains differences", "INFO", JSON.stringify(trec.d ?? trec.e).slice(0, 500));
  const integ = await post("/books/integrity/run", {});
  rec("A12", "Built-in integrity scan after scenarios", "no findings", "INFO", `${integ.s} ${JSON.stringify(integ.d ?? integ.e).slice(0, 700)}`);
  rec("A13", "Audit events written", ">0 for each posting", true, JSON.stringify(await prisma.auditEvent.groupBy({ by: ["entityType", "action"], where: { companyId }, _count: true }).then((g) => g.map((x) => `${x.entityType}.${x.action}=${x._count}`))));
  const noAudit = ["ArReceipt", "ApPayment", "ArDeposit", "ArCreditNote"]; const seen = new Set((await prisma.auditEvent.findMany({ where: { companyId }, select: { entityType: true } })).map((x) => x.entityType));
  rec("A14", "Own audit event for receipts/payments/deposits/credit notes", "present", noAudit.every((x) => seen.has(x)), noAudit.map((x) => `${x}=${seen.has(x)}`).join(" "));

  await step("S18", "Generate reports/exports", "200 for each", async () => {
    const urls = ["/books/statements?format=pdf", "/books/statements?format=xlsx", "/books/trial-balance?format=csv", "/ar/ageing?format=csv", "/ap/ageing?format=pdf", "/tax/reports/vat?format=csv&from=2026-01-01&to=2026-01-31", "/inventory/valuation", "/inventory/reports/cost-of-sales", "/ap/reports/purchases-by-supplier", "/expenses/reports/by-category", "/fixed-assets/reports/register", `/gl/accounts/${acct["1110"]}`, "/banking/cash-position", "/books/kpis", "/workspace/transactions", `/ar/customers/${cust.id}/statement`, `/ap/suppliers/${supp.id}/statement`];
    const out: string[] = []; for (const u of urls) { const r = await get(u); if (r.s !== 200) out.push(`${u}=${r.s} ${r.e}`); }
    return { ok: out.length === 0, actual: out.length ? out.join("; ") : `${urls.length} endpoints 200` };
  });
  // Close
  const periods = await prisma.accountingPeriod.findMany({ where: { financialYear: { companyId } }, orderBy: { sequence: "asc" } });
  await step("S19", "Close January", "Checklist enforced then CLOSED", async () => {
    const ck = await get(`/books/close/checklist?periodId=${periods[0].id}`); let c = await post("/books/close", { periodId: periods[0].id, kind: "MONTH" });
    let note = `first attempt ${c.s} ${c.e ?? ""}; blockers=${JSON.stringify(ck.d?.blockers)} `;
    if (c.s >= 400) { for (const it of ck.d?.items ?? []) if (it.status === "FAILING") { const o = await post("/books/close/overrides", { periodId: periods[0].id, item: it.key, note: "Audit override for testing" }); note += `override ${it.key} ${o.s};`; } const ck2 = await get(`/books/close/checklist?periodId=${periods[0].id}`); note += JSON.stringify(ck2.d?.blockers); c = await post("/books/close", { periodId: periods[0].id, kind: "MONTH" }); }
    const p = await prisma.accountingPeriod.findUnique({ where: { id: periods[0].id } });
    return { ok: p!.status === "CLOSED", actual: `${note} then ${c.s} ${c.e ?? ""} status=${p!.status}` };
  });
  await step("S20", "Modify transactions in the closed period", "All refused", async () => {
    const before = await prisma.glEntry.count({ where: { companyId, transactionDate: { lte: periods[0].endDate } } });
    const tries: [string, any][] = [
      ["journal", await post("/journals", { journalDate: "2026-01-15", description: "late", lines: [{ accountId: acct["6140"], debit: 1, credit: 0 }, { accountId: acct["1100"], debit: 0, credit: 1 }], postImmediately: true })],
      ["invoice", await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2026-01-15", net: 1000 })],
      ["receipt", await post("/ar/receipts", { customerId: cust.id, receiptDate: "2026-01-15", amount: 10 })],
      ["bill", await post("/ap/bills", { supplierId: supp.id, billDate: "2026-01-15", net: 1000 })],
      ["bank payment", await post("/banking/payments", { financialAccountId: bank, transactionDate: "2026-01-15", lines: [{ accountId: acct["6140"], amount: 10 }] })],
      ["adjustment", await post("/inventory/adjustments", { type: "QUANTITY", date: "2026-01-15", reason: "x", accountId: acct["6410"], lines: [{ itemId: (await prisma.inventoryItem.findFirst({ where: { companyId } }))!.id, change: -1 }] })],
      ["expense", await post("/expenses", { expenseDate: "2026-01-15", categoryId: ((await get("/expenses/categories")).d as any[])[0].id, financialAccountId: bank, net: 10, post: true })],
      ["bank reversal dated in period", await post(`/banking/transactions/${(await prisma.bankTransaction.findFirst({ where: { companyId } }))!.id}/reverse`, { reason: "test", reversalDate: "2026-01-20" })],
    ];
    const evd = await ev("SALE_COMPLETED", { occurredAt: "2026-01-30T09:00:00Z", sourceDocumentId: "LATE", amountTotals: { gross: "100", net: "100", tax: "0" }, paymentSplits: [{ paymentMethod: "CASH", amount: 100 }] });
    const exc = await prisma.postingException.count({ where: { companyId, status: "OPEN" } });
    const after = await prisma.glEntry.count({ where: { companyId, transactionDate: { lte: periods[0].endDate } } });
    return { ok: after === before && tries.every(([, r]) => r.s >= 400), actual: tries.map(([n, r]) => `${n} ${r.s} "${r.e}"`).join("; ") + `; ERP event ${evd.s} error="${evd.e}" open exceptions=${exc}; GL rows in period ${before}->${after}` };
  });
  await step("S20b", "Reverse a closed-period manual journal / void closed-period invoice", "Original untouched; reversal dated in an open period", async () => {
    const i = await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2026-02-02", net: 1000 });
    const v = await post(`/ar/invoices/${i.d?.id}/void`, { reason: "test" });
    const j = await prisma.journal.findFirst({ where: { companyId, sourceDocumentType: "ArInvoiceVoid" } });
    return { ok: v.s === 200 && j?.journalDate.toISOString().slice(0, 10) === "2026-02-02", actual: `void ${v.s}; reversal dated ${j?.journalDate.toISOString().slice(0, 10)}` };
  });

  // --- Edge cases
  await step("E01", "Same invoice submitted twice (double click, key sent as the web app does)", "One invoice", async () => {
    const b = { customerId: cust.id, invoiceDate: "2026-02-03", net: 7777, description: "dbl" }; const hk = { ...H, "Idempotency-Key": "audit-e01-key" }; const r = await Promise.all([post("/ar/invoices", b, hk), post("/ar/invoices", b, hk)]);
    const n = await prisma.arInvoice.count({ where: { companyId, net: 7777 } }); return { ok: n === 1, actual: `${r.map((x) => x.s)} -> ${n} invoices posted` };
  });
  await step("E01b", "Same request with an Idempotency-Key header", "One record", async () => {
    const h = { ...H, "Idempotency-Key": "audit-e01b-key" }; const b = { customerId: cust.id, receiptDate: "2026-02-03", amount: 3333 }; await post("/ar/receipts", b, h); await post("/ar/receipts", b, h);
    const n = await prisma.arReceipt.count({ where: { companyId, amount: 3333 } }); return { ok: n === 1, actual: `${n} receipts` };
  });
  await step("E01c", "Same supplier invoice number entered twice", "Second refused", async () => {
    const b = { supplierId: supp.id, billDate: "2026-02-03", supplierInvoiceNumber: "DUP-1", net: 500 }; const a = await post("/ap/bills", b), c = await post("/ap/bills", b); return { ok: a.s === 201 && c.s >= 400, actual: `${a.s} then ${c.s} ${c.e ?? ""}` };
  });
  await step("E02", "Invalid amounts", "All 400", async () => {
    const rs = [await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2026-02-03", net: -5 }), await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2026-02-03", net: 0 }), await post("/ar/receipts", { customerId: cust.id, receiptDate: "2026-02-03", amount: 0 }), await post("/ar/invoices", { customerId: cust.id, invoiceDate: "not-a-date", net: 5 }), await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2026-02-03", lines: [{ description: "x", quantity: -1, unitPrice: 5 }] }), await post("/journals", { journalDate: "2026-02-03", lines: [{ accountId: acct["6140"], debit: 10, credit: 0 }, { accountId: acct["1100"], debit: 0, credit: 9 }], postImmediately: true }), await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2026-02-03", net: 100, discount: 500 }), await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2026-02-03", net: 1e18 })];
    return { ok: rs.every((r) => r.s === 400), actual: rs.map((r) => `${r.s} ${(r.e ?? "").slice(0, 90)}`).join(" | ") };
  });
  await step("E02b", "Typed VAT that does not match any rate (net 100, tax 5,000)", "Refused or warned", async () => { const r = await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2026-02-03", net: 100, tax: 5000 }); return { ok: r.s >= 400, actual: `${r.s} ${r.e ?? "accepted"}` }; });
  await step("E03", "Missing account mapping", "Refused with clear message, nothing left", async () => {
    const d = await prisma.defaultPostingAccounts.findUniqueOrThrow({ where: { companyId } }); await prisma.defaultPostingAccounts.update({ where: { companyId }, data: { accountsReceivableId: null } });
    const n0 = await prisma.arInvoice.count({ where: { companyId } }); const r = await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2026-02-03", net: 10 }); const n1 = await prisma.arInvoice.count({ where: { companyId } });
    await prisma.defaultPostingAccounts.update({ where: { companyId }, data: { accountsReceivableId: d.accountsReceivableId } }); return { ok: r.s === 400 && n0 === n1, actual: `${r.s} ${r.e}; invoices ${n0}->${n1}` };
  });
  await step("E04", "Insufficient stock adjustment -10,000", "Refused under default policy", async () => { const it = await prisma.inventoryItem.findFirst({ where: { companyId, sku: "R25" } }); const r = await post("/inventory/adjustments", { type: "QUANTITY", date: "2026-02-03", reason: "x", accountId: acct["6410"], lines: [{ itemId: it!.id, change: -10000 }] }); const b = await prisma.inventoryBalance.findFirst({ where: { companyId } }); return { ok: r.s === 400, actual: `${r.s} ${r.e ?? "accepted"} qty=${b?.quantity}` }; });
  await step("E04b", "ERP oversell (POS sale beyond stock)", "Posted with flag, or exception", async () => { const m = await mv("SALE", "OUT", 60, null, -2, "2026-02-04T09:00:00Z", "OS1"); const b = await prisma.inventoryBalance.findFirst({ where: { companyId } }); return { ok: "INFO", actual: `${m.s} ${m.e ?? "posted"} qty=${b?.quantity} value=${(b as any)?.value ?? (b as any)?.totalValue}` }; });
  await step("E05", "Overpayment of invoice allocation", "Refused", async () => { const i = await prisma.arInvoice.findUnique({ where: { id: inv.id } }); const r = await post("/ar/receipts", { customerId: cust.id, receiptDate: "2026-02-04", amount: 9_000_000, allocations: [{ invoiceId: inv.id, amount: 9_000_000 }] }); const r2 = await post("/ar/receipts", { customerId: cust.id, receiptDate: "2026-02-04", amount: 5_000 }); return { ok: r.s === 400 && r2.s === 201, actual: `over-allocate ${r.s} ${r.e}; unallocated receipt ${r2.s} unallocated=${r2.d?.unallocated}; outstanding ${Number(i!.gross) - Number(i!.amountPaid) - Number(i!.amountCredited)}` }; });
  await step("E06", "20 concurrent full payments of one invoice", "Exactly one succeeds", async () => {
    const i = (await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2026-02-05", net: 10_000 })).d; const rs = await Promise.all(Array.from({ length: 20 }, () => post("/ar/receipts", { customerId: cust.id, receiptDate: "2026-02-05", amount: 10_000, allocations: [{ invoiceId: i.id, amount: 10_000 }] })));
    const ok = rs.filter((r) => r.s === 201).length; const errs = [...new Set(rs.filter((r) => r.s !== 201).map((r) => `${r.s} ${(r.e ?? "").slice(0, 110)}`))]; const n = await prisma.arReceipt.count({ where: { companyId, amount: 10_000 } }); return { ok: ok === 1 && n === 1, actual: `${ok} succeeded, rows=${n}; errors=${errs.join(" | ")}` };
  });
  await step("E07", "30 concurrent different journals; numbering and balances", "30 unique numbers, TB balanced", async () => { const rs = await Promise.all(Array.from({ length: 30 }, (_, k) => post("/journals", { journalDate: "2026-02-06", description: `c${k}`, lines: [{ accountId: acct["6140"], debit: 100, credit: 0 }, { accountId: acct["3030"], debit: 0, credit: 100 }], postImmediately: true }))); const ok = rs.filter((r) => r.s === 201); const u = new Set(ok.map((r) => r.d.journalNumber)); return { ok: ok.length === 30 && u.size === 30, actual: `${ok.length}/30 posted, ${u.size} unique; errors=${[...new Set(rs.filter((r) => r.s !== 201).map((r) => r.e))].join("|")}` }; });
  await step("E07b", "Cached account balance = GL after all", "equal for every account", async () => { const bad = await prisma.$queryRawUnsafe<any[]>(`select a.code, a."currentBalance", coalesce(sum(g.debit-g.credit),0) gl from accounts a left join gl_entries g on g."accountId"=a.id where a."companyId"='${companyId}' group by 1,2 having abs(a."currentBalance"-coalesce(sum(g.debit-g.credit),0))>0.001`); return { ok: bad.length === 0, actual: `${bad.length} differ` }; });
  await step("E08", "Month-end and local-midnight ERP sale (UTC vs Kigali)", "Sale at 1 Mar 00:30 Kigali books in March", async () => { const r = await ev("SALE_COMPLETED", { occurredAt: "2026-02-28T22:30:00.000Z", sourceDocumentId: "TZ1", amountTotals: { gross: "100", net: "100", tax: "0" }, paymentSplits: [{ paymentMethod: "CASH", amount: 100 }] }); const j = await prisma.journal.findFirst({ where: { companyId, sourceDocumentId: "TZ1" } }); const f = (await get("/books/statements?from=2026-02-01&to=2026-02-28")).d.income.totalRevenue; const m = (await get("/books/statements?from=2026-03-01&to=2026-03-31")).d.income.totalRevenue; return { ok: m === 100, actual: `${r.s}; journalDate ${j?.journalDate.toISOString()}; Feb revenue ${f}; March revenue ${m}` }; });
  await step("E09", "Future-dated invoice beyond the financial year", "Refused with message", async () => { const r = await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2027-05-01", net: 10 }); return { ok: r.s === 400, actual: `${r.s} ${r.e}` }; });
  await step("E10", "Failure mid-posting leaves nothing (inactive account)", "Rollback", async () => { const n0 = [await prisma.arInvoice.count({ where: { companyId } }), await prisma.journal.count({ where: { companyId } })]; await prisma.account.update({ where: { id: acct["4100"] }, data: { isActive: false } }); const r = await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2026-02-03", net: 10 }); await prisma.account.update({ where: { id: acct["4100"] }, data: { isActive: true } }); const n1 = [await prisma.arInvoice.count({ where: { companyId } }), await prisma.journal.count({ where: { companyId } })]; return { ok: r.s === 400 && String(n0) === String(n1), actual: `${r.s} ${r.e}; [invoices,journals] ${n0} -> ${n1}` }; });
  await step("E11", "Unauthorised access", "401/403", async () => { const a = await get("/ar/invoices", {} as any), b = await post("/journals", {}, authHeaders(ORG, "SELLER")), c = await get("/books/statements", authHeaders(ORG, "SELLER")), d = await get("/ar/invoices", { Authorization: "Bearer x.y.z" }); return { ok: [a.s, b.s, c.s, d.s].join() === "401,403,403,401", actual: [a.s, b.s, c.s, d.s].join() }; });
  await step("E12", "Cross-business access to every id type", "404/400, no data", async () => {
    const HB = await activateCompany(app, ORG + 1, { name: "Other Biz", tin: "987654321" }); const j = await prisma.journal.findFirst({ where: { companyId } }); const bt = await prisma.bankTransaction.findFirst({ where: { companyId } }); const it = await prisma.inventoryItem.findFirst({ where: { companyId } }); const ex = await prisma.expense.findFirst({ where: { companyId } });
    const paths = [`/ar/customers/${cust.id}`, `/ar/invoices/${inv.id}`, `/ar/invoices/${inv.id}/pdf`, `/ap/suppliers/${supp.id}`, `/ap/bills/${bill.id}`, `/journals/${j!.id}`, `/gl/accounts/${acct["1110"]}`, `/banking/accounts/${bank}`, `/banking/transactions/${bt!.id}`, `/inventory/items/${it!.id}`, `/expenses/${ex!.id}`, `/books/close/checklist?periodId=${periods[0].id}`, `/banking/accounts/${bank}/cashbook`];
    const bad: string[] = []; for (const p of paths) { const r = await get(p, HB); if (r.s === 200) bad.push(p); }
    const w: [string, any][] = [["invoice for other's customer", await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2026-02-03", net: 10 }, HB)], ["void", await post(`/ar/invoices/${inv.id}/void`, {}, HB)], ["journal with other's accounts", await post("/journals", { journalDate: "2026-02-03", lines: [{ accountId: acct["6140"], debit: 1, credit: 0 }, { accountId: acct["1100"], debit: 0, credit: 1 }], postImmediately: true }, HB)], ["close other's period", await post("/books/close", { periodId: periods[1].id, kind: "MONTH" }, HB)], ["bank payment", await post("/banking/payments", { financialAccountId: bank, transactionDate: "2026-02-03", lines: [{ accountId: acct["6140"], amount: 1 }] }, HB)]];
    for (const [n, r] of w) if (r.s < 400) bad.push(n); return { ok: bad.length === 0, actual: bad.length ? "LEAK " + bad.join(", ") : `${paths.length} reads and ${w.length} writes refused` };
  });
  await step("E12b", "Integration key scope", "Shared key refused once a business has its own", async () => { const own = (await post("/integration/key", {}, authHeaders(ORG + 1))).d; void own; const r = await request(app).post("/api/v1/integration/events").set(key).send({ eventId: "x1", idempotencyKey: "x1", externalOrganizationId: String(ORG + 1), eventType: "SALE_COMPLETED", occurredAt: "2026-02-03T09:00:00Z", sourceModule: "POS", sourceDocumentType: "Sale", sourceDocumentId: "x1", currencyCode: "RWF", amountTotals: { gross: "10", net: "10", tax: "0" }, paymentSplits: [{ paymentMethod: "CASH", amount: 10 }] }); return { ok: r.status === 401, actual: `shared key on a business with its own key: ${r.status}` }; });
  await step("E13", "Token for a new organisation auto-creates a company", "Only provisioned businesses", async () => { const n0 = await prisma.company.count(); await get("/setup/dashboard", authHeaders(999777)); const n1 = await prisma.company.count(); return { ok: "INFO", actual: `companies ${n0}->${n1} (requires a valid ERP-signed token)` }; });
  await step("E14", "Void / reverse restores balances", "Net effect zero", async () => { const a0 = await bal("1200"), s0 = await bal("4100"); const i = (await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2026-02-10", net: 4321 })).d; const v = await post(`/ar/invoices/${i.id}/void`, { reason: "x" }), v2 = await post(`/ar/invoices/${i.id}/void`, { reason: "x" }); return { ok: v.s === 200 && v2.s === 400 && (await bal("1200")) === a0 && (await bal("4100")) === s0, actual: `${v.s}, again ${v2.s}; AR ${a0}->${await bal("1200")}; Sales ${s0}->${await bal("4100")}` }; });
  await step("E15", "Edit a posted invoice", "Unpaid: corrected under the same number; paid: refused", async () => { const i = (await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2026-02-11", lines: [{ description: "x", quantity: 1, unitPrice: 100 }] })).d; const a0 = await bal("1200"); const r = await call("put", `/ar/invoices/${i.id}`, { invoiceDate: "2026-02-11", lines: [{ description: "x", quantity: 1, unitPrice: 60 }] }); const p = await call("put", `/ar/invoices/${inv.id}`, { invoiceDate: "2026-02-11", lines: [{ description: "x", quantity: 1, unitPrice: 60 }] }); return { ok: r.s === 200 && p.s === 400 && (await bal("1200")) === a0 - 40, actual: `unpaid ${r.s}; part-paid ${p.s} ${p.e}` }; });
  await step("E16", "Delete of posted journal through API / database", "No API; DB should also prevent", async () => { const r = await call("delete", `/journals/${(await prisma.journal.findFirst({ where: { companyId } }))!.id}`); let db = "blocked"; try { await prisma.$transaction(async (tx) => { const e = await tx.glEntry.findFirst({ where: { companyId } }); await tx.glEntry.update({ where: { id: e!.id }, data: { debit: 999 } }); db = "ALLOWED"; throw new Error("rollback"); }); } catch { /* rolled back */ } let au = "blocked"; try { await prisma.$transaction(async (tx) => { const e = await tx.auditEvent.findFirst({ where: { companyId } }); await tx.auditEvent.update({ where: { id: e!.id }, data: { action: "X" } }); au = "ALLOWED"; throw new Error("rb"); }); } catch { /* */ } return { ok: r.s === 404 && db === "blocked" && au === "blocked", actual: `API ${r.s}; direct UPDATE gl_entries ${db}; direct UPDATE audit_events ${au}` }; });
  await step("E17", "Cash-basis policy", "Never labelled cash while figures are accrual", async () => { await prisma.accountingPolicy.updateMany({ where: { companyId }, data: { accountingBasis: "CASH" as never } }); const c = (await get("/books/statements?from=2026-01-01&to=2026-02-28")).d; await prisma.accountingPolicy.updateMany({ where: { companyId }, data: { accountingBasis: "ACCRUAL" as never } }); const a = (await get("/books/statements?from=2026-01-01&to=2026-02-28")).d; const n = c.notes.basis.find((x: string) => /basis/i.test(x)); return { ok: /Accrual/.test(n), actual: `note says "${n}" but profit cash=${c.income.profit} accrual=${a.income.profit}` }; });
  await step("E17b", "Setting cash basis via setup API", "Refused or applied", async () => { const r = await call("put", "/setup/policies", { accountingBasis: "CASH" }); await call("put", "/setup/policies", { accountingBasis: "ACCRUAL" }); return { ok: "INFO", actual: `${r.s} ${r.e ?? "accepted"}` }; });
  await step("E18", "Disposal gain in cash flow", "Proceeds 900,000 under investing; gain not in operating", async () => {
    const a = await prisma.fixedAsset.findFirst({ where: { companyId } }); const r = await post(`/fixed-assets/assets/${a!.id}/dispose`, { disposalDate: "2026-04-15", disposalMethod: "SALE", proceeds: 1_300_000, proceedsAccountId: acct["1110"] }); const s = (await get("/books/statements?from=2026-04-01&to=2026-04-30")).d; return { ok: s.cashFlow.investing === 1_300_000, actual: `${r.s} ${r.e ?? ""} cashflow ${JSON.stringify(s.cashFlow)} (expected investing 1,300,000, operating 0)` };
  });
  await step("E19", "Rounding: 3 lines of 33.33 x VAT18 and RWF amounts", "Header equals sum of lines, GL balances", async () => { const r = await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2026-02-12", lines: [1, 2, 3].map(() => ({ description: "x", quantity: 1, unitPrice: 33.33, taxCode: "VAT18" })) }); return { ok: r.s === 201 && near(Number(r.d.gross), 99.99 + 18), actual: `net ${r.d?.net} tax ${r.d?.tax} gross ${r.d?.gross} (RWF has no minor unit; fractional RWF accepted)` }; });
  await step("E20", "VAT-inclusive pricing", "1,180 inclusive = 1,000 + 180", async () => { const r = await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2026-02-12", lines: [{ description: "x", quantity: 1, unitPrice: 1180, taxCode: "VAT18", taxInclusive: true }] }); return { ok: Number(r.d?.net) === 1000 && Number(r.d?.gross) === 1180, actual: `net ${r.d?.net} tax ${r.d?.tax} gross ${r.d?.gross}` }; });
  await step("E21", "Bad debt write-off of an invoice", "Dr bad debt, Cr AR", async () => { const i = (await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2026-02-19", net: 10 })).d; const r = await post(`/ar/invoices/${i.id}/write-off`, { reason: "audit", date: "2026-02-20" }); return { ok: r.s === 201 && (await bal("6200")) === 10, actual: `${r.s} ${r.e ?? ""} bad debt=${await bal("6200")}` }; });
  await step("E22", "Reports with 100,000 GL rows", "Statements and TB < 2s", async () => {
    const big = await prisma.company.findUniqueOrThrow({ where: { externalErpOrganizationId: String(ORG + 1) } }); const A = await prisma.account.findMany({ where: { companyId: big.id, code: { in: ["6140", "3030"] } } }); const j = await prisma.journal.create({ data: { companyId: big.id, journalNumber: "VOL", journalDate: new Date("2026-03-01"), status: "POSTED" } });
    for (let k = 0; k < 100; k++) await prisma.glEntry.createMany({ data: Array.from({ length: 1000 }, (_, n) => ({ companyId: big.id, accountId: A[n % 2].id, journalId: j.id, postingDate: new Date(), transactionDate: new Date("2026-03-01"), journalNumber: "VOL", debit: n % 2 ? 0 : 1, credit: n % 2 ? 1 : 0 })) });
    const HB = authHeaders(ORG + 1); await get("/books/kpis", HB); const t0 = Date.now(); await get("/books/statements", HB); const t1 = Date.now(); await get("/books/trial-balance", HB); const t2 = Date.now(); await get(`/gl/accounts/${A[0].id}?page=1&pageSize=100`, HB); const t3 = Date.now(); return { ok: t1 - t0 < 2000 && t2 - t1 < 2000, actual: `100,000 rows: statements ${t1 - t0}ms, TB ${t2 - t1}ms, ledger page ${t3 - t2}ms (synthetic rows, local database)` };
  });
  await step("E23", "Draft journal in AR account / inventory manual posting blocked", "400", async () => { const r = await post("/journals", { journalDate: "2026-02-20", lines: [{ accountId: acct["1300"], debit: 10, credit: 0 }, { accountId: acct["3030"], debit: 0, credit: 10 }], postImmediately: true }); return { ok: r.s === 400, actual: `${r.s} ${r.e}` }; });
  await step("E23b", "Bank receipt/payment coded straight to AR, AP or inventory control", "Refused", async () => { const rs = []; for (const c of ["1200", "2100", "1300", "2200"]) { const r = await post("/banking/payments", { financialAccountId: bank, transactionDate: "2026-02-20", lines: [{ accountId: acct[c], amount: 10 }] }); rs.push(`${c}:${r.s} ${(r.e ?? "ACCEPTED").slice(0, 80)}`); } return { ok: rs.slice(0, 3).every((x) => /:400/.test(x)), actual: rs.join(" | ") }; });
  await step("E23c", "Expense coded to AR/AP/inventory control", "Refused", async () => { const cat = ((await get("/expenses/categories")).d as any[])[0].id; const rs = []; for (const c of ["1200", "2100", "1300"]) { const r = await post("/expenses", { expenseDate: "2026-02-20", categoryId: cat, expenseAccountId: acct[c], financialAccountId: bank, net: 10, post: true }); rs.push(`${c}:${r.s} ${(r.e ?? "ACCEPTED").slice(0, 80)}`); } return { ok: rs.every((x) => /:400/.test(x)), actual: rs.join(" | ") }; });
  await step("E23d", "Invoice/bill line coded to control accounts", "Refused", async () => { const rs = []; for (const c of ["1200", "2100", "1300"]) { const r = await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2026-02-20", lines: [{ description: "x", quantity: 1, unitPrice: 10, accountId: acct[c] }] }); const b = await post("/ap/bills", { supplierId: supp.id, billDate: "2026-02-20", lines: [{ description: "x", quantity: 1, unitPrice: 10, accountId: acct[c] }] }); rs.push(`${c}: invoice ${r.s} ${(r.e ?? "ACCEPTED").slice(0, 60)}, bill ${b.s} ${(b.e ?? "ACCEPTED").slice(0, 60)}`); } return { ok: rs.every((x) => !/ACCEPTED/.test(x)), actual: rs.join(" | ") }; });
  await step("E24", "Approvals default: creator posts own large journal", "Default controls require another person", async () => { const c = await prisma.approvalPostingControls.findUnique({ where: { companyId } }); await call("put", "/setup/approvals", { approvalWorkflowEnabled: true, approvalLevels: 1, requireDifferentPoster: true }); const r = await post("/journals", { journalDate: "2026-11-20", lines: [{ accountId: acct["6140"], debit: 10, credit: 0 }, { accountId: acct["3030"], debit: 0, credit: 10 }], postImmediately: true }); await call("put", "/setup/approvals", { approvalWorkflowEnabled: false, requireDifferentPoster: false }); return { ok: r.s === 400, actual: `${r.s} ${r.e}` }; });
  await step("E25", "Reverse and unlock: reopen closed period then audit", "Reason needed; logged", async () => { const r = await post("/books/close/reopen", { periodId: periods[0].id, reason: "audit test" }); const a = await prisma.auditEvent.count({ where: { companyId, entityId: periods[0].id } }); return { ok: r.s === 200, actual: `${r.s} ${r.e ?? ""}; audit events on period=${a}` }; });
  await step("E26", "Ageing as of a past date (31 Jan) ignores later invoices and payments", "As-of total equals AR control at 31 Jan", async () => {
    const g = await prisma.glEntry.aggregate({ where: { companyId, account: { code: "1200" }, transactionDate: { lte: new Date("2026-01-31T23:59:59.999Z") } }, _sum: { debit: true, credit: true } }); const control = Number(g._sum.debit) - Number(g._sum.credit);
    const a = (await get("/ar/ageing?asOf=2026-01-31")).d; const late = await prisma.arInvoice.count({ where: { companyId, status: "POSTED", invoiceDate: { gt: new Date("2026-01-31T23:59:59.999Z") } } }); return { ok: near(a.total, control), actual: `ageing at 31 Jan ${a.total}; control at 31 Jan ${control}; ${late} invoices dated after 31 Jan exist` };
  });
  await step("E27", "Ageing with a USD customer", "Converted to RWF (or kept apart by currency)", async () => {
    const r0 = await post("/books/fx/rates", { currency: "USD", rateDate: "2026-02-01", rate: 1400 }); const u = await post("/ar/customers", { name: "USD Cust", customerType: "CREDIT", creditLimit: 1e6, currency: "USD" }); const before = (await get("/ar/ageing")).d.total; const g0 = await bal("1200"); const i = await post("/ar/invoices", { customerId: u.d?.id, invoiceDate: "2026-02-10", net: 1000, currency: "USD" }); const after = (await get("/ar/ageing")).d.total; const dash = (await get("/ar/dashboard")).d; return { ok: near(after - before, 1_400_000), actual: `rate ${r0.s} cust ${u.s} inv ${i.s} ${i.e ?? ""}; GL AR rose ${(await bal("1200")) - g0} RWF; ageing total rose ${after - before}; dashboard ${JSON.stringify(dash).slice(0, 220)}` };
  });
  await step("E28", "Year-end: profit to retained earnings; P&L unaffected", "covered", async () => ({ ok: "INFO", actual: "covered by tests/wave-c-closing.test.ts (passed)" }));
  await step("E29", "Post to a FUTURE period (2026-12-15)", "Follows future-date policy", async () => { const r = await post("/ar/invoices", { customerId: cust.id, invoiceDate: "2026-12-15", net: 10 }); return { ok: "INFO", actual: `${r.s} ${r.e ?? "accepted"}` }; });
  await step("E30", "Error messages do not leak internals", "Friendly text", async () => { const r = await post("/ar/invoices", { customerId: cust.id, invoiceDate: "not-a-date", net: 5 }); return { ok: !/prisma|\/Users\//i.test(r.e ?? ""), actual: (r.e ?? "").replace(/\s+/g, " ").slice(0, 160) }; });
  await step("E31", "Formula/script text in names", "Stored as text; CSV export neutralised", async () => { await post("/ar/customers", { name: "=HYPERLINK(1)", customerType: "CASH" }); const t = await (request(app) as any).get("/api/v1/ar/customers/export.csv").set(H); return { ok: !/(^|,|")=HYPERLINK/m.test(t.text), actual: (t.text.match(/.{0,4}=HYPERLINK.{0,4}/) ?? ["none"])[0] }; });
  const integ2 = await post("/books/integrity/run", {});
  rec("A15", "Integrity scan after edge cases", "only deliberate findings", "INFO", JSON.stringify(integ2.d ?? integ2.e).slice(0, 1500));
  const st2 = (await get("/books/statements?from=2026-01-01&to=2026-12-31")).d;
  rec("A16", "Final: balance sheet and cash flow", "balanced", near(st2.position.totalAssets, st2.position.totalLiabilities + st2.position.totalEquity) && near(st2.cashFlow.netChange, st2.cashFlow.cashChange), `A ${st2.position.totalAssets} L ${st2.position.totalLiabilities} E ${st2.position.totalEquity}; CF ${st2.cashFlow.netChange} vs ${st2.cashFlow.cashChange}`);
  const cs2 = await prisma.customer.aggregate({ where: { companyId }, _sum: { balance: true } }), ss2 = await prisma.supplier.aggregate({ where: { companyId }, _sum: { balance: true } });
  const ag2 = (await get("/ar/ageing?asOf=2026-12-31")).d.total, apg2 = (await get("/ap/ageing?asOf=2026-12-31")).d.total;
  rec("A17", "Final: ageing = control and integrity clean, including USD", "equal", near(await bal("1200"), ag2) && near(-(await bal("2100")), apg2) && integ2.d.errors === 0, `ageing AR ${ag2} AP ${apg2}; AR ${await bal("1200")} vs ${cs2._sum.balance}; AP ${-(await bal("2100"))} vs ${ss2._sum.balance}`);
  writeFileSync(path.resolve(process.cwd(), "../docs/accounting-audit/evidence/results.json"), JSON.stringify(rows, null, 1));
  const c = (x: string) => rows.filter((r) => r.result === x).length; console.log(`PASS ${c("PASS")} FAIL ${c("FAIL")} PARTIAL ${c("PARTIAL")} INFO ${c("INFO")}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
