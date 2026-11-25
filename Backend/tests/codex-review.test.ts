import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { inTransaction, prisma } from "../src/lib/prisma";
import * as ap from "../src/modules/ap/ap.service";
import * as ar from "../src/modules/ar/ar.service";
import { clearAccessCache } from "../src/modules/users/access.service";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 96921;
let h: Record<string, string>;
let companyId: string;
let bank: string;
const acct: Record<string, string> = {};
const post = (url: string, body: unknown = {}, headers = h) => request(app).post(`/api/v1${url}`).set(headers).send(body as object);
const get = (url: string) => request(app).get(`/api/v1${url}`).set(h);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const customer = async (name: string) => (await post("/ar/customers", { name, customerType: "CREDIT", creditLimit: 1e9 })).body.data.id as string;

/** Runs `first` in a transaction left open while `second` starts, so `second` waits on its row lock. */
async function overlap(first: () => Promise<unknown>, second: () => Promise<unknown>) {
  let entered!: () => void;
  const started = new Promise<void>((r) => (entered = r));
  const a = inTransaction(async () => {
    await first();
    entered();
    await pause(700);
  });
  await started;
  const b = second().then(() => "ok", (e: Error) => e.message);
  await a;
  return b;
}

beforeAll(async () => {
  await prisma.$connect();
  await resetCompany(orgId);
  h = await activateCompany(app, orgId, { name: "Codex Co", tin: "555444888" });
  companyId = (await prisma.company.findUniqueOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
  for (const a of await prisma.account.findMany({ where: { companyId } })) acct[a.code] = a.id;
  bank = (await post("/banking/accounts", { kind: "BANK", name: "BK", glAccountId: acct["1110"], dateOpened: "2026-01-01" })).body.data.id;
});

describe("Reversals racing other uses of the same money", () => {
  it("won't reverse a receipt whose money is being refunded", async () => {
    const c = await customer("Race refund");
    const r = (await post("/ar/receipts", { customerId: c, receiptDate: "2026-01-05", method: "BANK", amount: 100, financialAccountId: bank })).body.data;
    const result = await overlap(
      () => ar.createRefund(companyId, { customerId: c, refundDate: "2026-01-06", financialAccountId: bank, sources: [{ source: "PAYMENT", sourceId: r.id, amount: 100 }] }),
      () => ar.reverseReceipt(companyId, r.id),
    );
    expect(result).toMatch(/refunded/);
    expect(Number((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).balance)).toBe(0);
    expect((await prisma.arReceipt.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("POSTED");
  });

  it("takes a receipt applied at the same moment back off its invoice", async () => {
    const c = await customer("Race apply");
    const inv = (await post("/ar/invoices", { customerId: c, invoiceDate: "2026-01-04", net: 100 })).body.data;
    const r = (await post("/ar/receipts", { customerId: c, receiptDate: "2026-01-05", method: "BANK", amount: 100, financialAccountId: bank })).body.data;
    expect(await overlap(() => ar.applyCustomerCredits(companyId, c, { applications: [{ source: "PAYMENT", sourceId: r.id, invoiceId: inv.id, amount: 100 }] }), () => ar.reverseReceipt(companyId, r.id))).toBe("ok");
    expect(Number((await prisma.arInvoice.findUniqueOrThrow({ where: { id: inv.id } })).amountPaid)).toBe(0);
  });

  it("takes a supplier payment applied at the same moment back off its bill", async () => {
    const s = (await post("/ap/suppliers", { name: "Race supplier" })).body.data.id;
    const bill = (await post("/ap/bills", { supplierId: s, billDate: "2026-01-04", net: 100 })).body.data;
    const p = (await post("/ap/payments", { supplierId: s, paymentDate: "2026-01-05", method: "BANK", amount: 100, financialAccountId: bank, allowUnallocated: true })).body.data;
    expect(await overlap(() => ap.applySupplierCredits(companyId, s, { applications: [{ source: "PAYMENT", sourceId: p.id, billId: bill.id, amount: 100 }] }), () => ap.reversePayment(companyId, p.id))).toBe("ok");
    expect(Number((await prisma.apBill.findUniqueOrThrow({ where: { id: bill.id } })).amountPaid)).toBe(0);
  });
});

describe("Un-applying while reversing", () => {
  it("takes a receipt off its invoice only once", async () => {
    const c = await customer("Race unapply");
    const inv = (await post("/ar/invoices", { customerId: c, invoiceDate: "2026-01-04", net: 100 })).body.data;
    const r = (await post("/ar/receipts", { customerId: c, receiptDate: "2026-01-05", method: "BANK", amount: 100, financialAccountId: bank, allocations: [{ invoiceId: inv.id, amount: 100 }] })).body.data;
    const result = await overlap(() => ar.reverseReceipt(companyId, r.id), () => inTransaction(() => ar.unapplyFromInvoice(companyId, "PAYMENT", r.allocations[0].id)));
    expect(result).toMatch(/no longer applied/);
    expect(Number((await prisma.arInvoice.findUniqueOrThrow({ where: { id: inv.id } })).amountPaid)).toBe(0);
  });
});

describe("Ageing for a date before a reversal", () => {
  const lines = async (day: string, c: string) => (await get(`/ar/ageing?asOf=${day}`)).body.data.lines.filter((l: { customerId: string }) => l.customerId === c);

  it("shows a receipt as it stood, then the invoice again after its reversal", async () => {
    const c = await customer("Reversed receipt");
    const inv = (await post("/ar/invoices", { customerId: c, invoiceDate: "2026-01-04", net: 100 })).body.data;
    const r = (await post("/ar/receipts", { customerId: c, receiptDate: "2026-01-10", method: "BANK", amount: 100, financialAccountId: bank, allocations: [{ invoiceId: inv.id, amount: 100 }] })).body.data;
    await ar.reverseReceipt(companyId, r.id, {}, { reversalDate: new Date("2026-02-01T00:00:00Z") });
    expect((await lines("2026-01-08", c)).map((l: { outstanding: number }) => l.outstanding)).toEqual([100]);
    expect(await lines("2026-01-31", c)).toEqual([]);
    expect((await lines("2026-02-28", c)).map((l: { outstanding: number }) => l.outstanding)).toEqual([100]);
  });

  it("does the same for a write-off and for a supplier payment", async () => {
    const c = await customer("Reversed write-off");
    const inv = (await post("/ar/invoices", { customerId: c, invoiceDate: "2026-01-04", net: 100 })).body.data;
    const w = (await post(`/ar/invoices/${inv.id}/write-off`, { reason: "test", date: "2026-01-10" })).body.data;
    await post(`/ar/write-offs/${w.id}/reverse`, { date: "2026-02-01" });
    expect(await lines("2026-01-31", c)).toEqual([]);
    expect((await lines("2026-02-28", c)).length).toBe(1);

    const s = (await post("/ap/suppliers", { name: "Reversed payment" })).body.data.id;
    const bill = (await post("/ap/bills", { supplierId: s, billDate: "2026-01-04", net: 100 })).body.data;
    const p = (await post("/ap/payments", { supplierId: s, paymentDate: "2026-01-10", method: "BANK", amount: 100, financialAccountId: bank, allocations: [{ billId: bill.id, amount: 100 }] })).body.data;
    await ap.reversePayment(companyId, p.id, { reversalDate: "2026-02-01" });
    const mine = async (day: string) => (await get(`/ap/ageing?asOf=${day}`)).body.data.lines.filter((l: { supplierId: string }) => l.supplierId === s);
    expect(await mine("2026-01-31")).toEqual([]);
    expect((await mine("2026-02-28")).length).toBe(1);
  });
});

describe("Saved answers", () => {
  it("aren't replayed once the person's access has changed", async () => {
    const userId = 3131;
    const role = await prisma.customRole.create({ data: { companyId, name: `R${userId}`, capabilities: ["ar:view", "ar:manage"], createdByErpUserId: 1 } as never });
    await prisma.userRoleAssignment.create({ data: { companyId, erpUserId: userId, customRoleId: role.id, assignedByErpUserId: 1 } as never });
    clearAccessCache();
    const user = { ...authHeaders(orgId, "SELLER", userId), "Idempotency-Key": randomUUID() };
    const body = { name: "Private customer", customerType: "CASH" };
    expect((await post("/ar/customers", body, user)).status).toBe(201);
    expect((await post("/ar/customers", body, user)).status).toBe(201);
    await prisma.userRoleAssignment.deleteMany({ where: { companyId, erpUserId: userId } });
    clearAccessCache();
    const after = await post("/ar/customers", body, user);
    expect(after.status).toBe(403);
    expect(JSON.stringify(after.body)).not.toContain("Private customer");
  });

  it("never include secrets that are shown only once", async () => {
    for (const [url, body] of [["/integration/key", {}], ["/books/api-keys", { name: "k", scopes: ["report:view"] }], ["/books/webhooks", { url: "https://example.com/hook", events: ["journal.posted"] }]] as const) {
      const r = await post(url, body, { ...h, "Idempotency-Key": randomUUID() });
      const secret = r.body.data?.token ?? r.body.data?.secret;
      if (!secret) continue;
      const rows = await prisma.idempotencyRecord.findMany({ where: { scope: { startsWith: `${orgId}:` } } });
      expect(JSON.stringify(rows), url).not.toContain(secret);
    }
    expect((await prisma.integrationKey.count({ where: { companyId } }))).toBe(1);
  });
});
