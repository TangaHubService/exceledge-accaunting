/**
 * Demo seed for the Accounting module.
 *
 * API-driven (not raw SQL): every record goes through the real service layer,
 * so journals, GL entries, allocations, VAT and audit trails are all posted
 * exactly as the UI would create them.
 *
 * Usage (API server must be running):
 *   npm run prisma:seed
 *   SEED_ORG_ID=1 SEED_API_URL=http://localhost:4600 npm run prisma:seed
 *
 * Env:
 *   SEED_API_URL   Accounting API base (default http://localhost:4600)
 *   SEED_ORG_ID    ERP organization to seed (default 1)
 *   JWT_SECRET     Used to mint an ADMIN token (loaded from root .env)
 *   INTEGRATION_API_KEY  For ERP inventory webhooks (loaded from root .env)
 *
 * Idempotent: each section checks for its demo records first and skips when
 * they already exist, so re-running is safe.
 */
import { config as loadEnv } from "dotenv";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";

// Resolve .env relative to this file (not cwd — `npx` may run from anywhere).
// Precedence matches the API server (src/config/env.ts): monorepo root .env
// wins over apps/api/.env, so the minted token verifies against the server.
const here = path.dirname(fileURLToPath(import.meta.url)); // apps/api/prisma
loadEnv({ path: path.resolve(here, "../../.env") }); // apps/api/.env first…
loadEnv({ path: path.resolve(here, "../../../.env"), override: true }); // …root .env wins
if (!process.env.JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.warn("[seed] warning: JWT_SECRET not found in .env files; set it explicitly");
}

const API = (process.env.SEED_API_URL ?? "http://localhost:4600").replace(/\/+$/, "");
const ORG_ID = process.env.SEED_ORG_ID ?? "1";
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";
const INTEGRATION_KEY = process.env.INTEGRATION_API_KEY ?? "dev-integration-key";

const adminHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${jwt.sign(
    { userId: 1, email: "seed@demo.local", role: "ADMIN", activeOrganizationId: Number(ORG_ID), organizationIds: [Number(ORG_ID)] },
    JWT_SECRET,
    { expiresIn: "15m" },
  )}`,
};
const integrationHeaders = { "Content-Type": "application/json", "x-integration-key": INTEGRATION_KEY };

type Res = { status: number; body: any };

async function api(method: string, route: string, body?: unknown, headers: Record<string, string> = adminHeaders): Promise<Res> {
  const res = await fetch(`${API}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, body: data };
}

function expect(res: Res, ok: number[], what: string) {
  if (!ok.includes(res.status)) {
    throw new Error(`${what} → ${res.status}: ${JSON.stringify(res.body)?.slice(0, 400)}`);
  }
  return res.body?.data;
}

function log(section: string, msg: string) {
  // eslint-disable-next-line no-console
  console.log(`[seed:${section}] ${msg}`);
}

async function findAccount(code: string): Promise<string> {
  const res = await api("GET", `/api/v1/coa?q=${code}`);
  expect(res, [200], `find account ${code}`);
  const hit = (res.body.data as any[]).find((a) => a.code === code) ?? res.body.data[0];
  if (!hit) throw new Error(`GL account ${code} not found`);
  return hit.id as string;
}

/* ── Setup & activation ─────────────────────────────────────────── */

async function ensureSetup() {
  const dash = await api("GET", "/api/v1/setup/dashboard");
  expect(dash, [200], "setup dashboard");
  if (dash.body.data.activationStatus === "ACTIVATED") {
    log("setup", "books already activated, skipping setup");
    return;
  }
  log("setup", "activating books for demo company…");
  const put = async (route: string, body: unknown) => {
    const r = await api("PUT", route, body);
    if (r.status !== 200) log("setup", `note: PUT ${route} → ${r.status}`);
  };
  await put("/api/v1/setup/profile", { registeredName: "Demo Trading Co", taxIdentificationNumber: "100000001", country: "RW", tradingName: "Demo Trading" });
  await put("/api/v1/setup/business-info", { accountingBasis: "ACCRUAL", reportingFramework: "IFRS_SME" });
  const fy = await api("POST", "/api/v1/setup/financial-years", { name: "FY 2026", startDate: "2026-01-01", endDate: "2026-12-31", periodFrequency: "MONTHLY" });
  if (![200, 201, 400].includes(fy.status)) throw new Error(`FY create → ${fy.status}`);
  await put("/api/v1/setup/currency", { functionalCurrency: "RWF" });
  await put("/api/v1/setup/policies", { inventoryValuationMethod: "WEIGHTED_AVERAGE" });
  await put("/api/v1/setup/localization", { countryOfRegistration: "RW", localizationPackage: "RW", taxAuthority: "RRA" });
  await api("POST", "/api/v1/setup/default-accounts/ensure", {});
  await put("/api/v1/setup/inventory-settings", {});
  await put("/api/v1/setup/party-defaults", {});
  await put("/api/v1/setup/banking", {});
  await api("POST", "/api/v1/setup/numbering/ensure", {});
  await put("/api/v1/setup/approvals", { approvalLevels: 1 });
  for (const key of ["FINANCIAL_YEAR_PERIODS", "CURRENCY", "ACCOUNTING_POLICIES"]) {
    await api("POST", `/api/v1/setup/sections/${key}/approve`, {});
  }
  const act = await api("POST", "/api/v1/setup/activation/activate", {});
  expect(act, [200], "activate books");
  log("setup", "books activated");
}

/* ── Open past periods ────────────────────────────────────────────
   Activation opens only the first period, so backdated demo entries (July /
   August overdue bills & invoices) would be rejected. Open every period up
   to today via Prisma — demo convenience, clearly logged. */
async function openPeriods() {
  const prisma = new PrismaClient();
  try {
    const company = await prisma.company.findUniqueOrThrow({ where: { externalErpOrganizationId: ORG_ID } });
    const r = await prisma.accountingPeriod.updateMany({
      where: { financialYear: { companyId: company.id }, status: "FUTURE", startDate: { lte: new Date() } },
      data: { status: "OPEN" },
    });
    log("setup", `opened ${r.count} past period(s) up to today`);
  } finally {
    await prisma.$disconnect();
  }
}

/* ── Receivables ────────────────────────────────────────────────── */

async function seedReceivables() {
  const list = await api("GET", "/api/v1/ar/customers");
  expect(list, [200], "list customers");
  const existing = list.body.data as any[];
  const findCustomer = (name: string) => existing.find((c) => c.name === name)?.id as string | undefined;
  const mkCustomer = async (body: any) => {
    const hit = findCustomer(body.name);
    if (hit) return hit;
    return expect(await api("POST", "/api/v1/ar/customers", body), [201], "create customer").id as string;
  };
  const retail = await mkCustomer({ name: "Kigali Retail Demo", customerType: "CREDIT", creditLimit: 50_000_000, creditPeriodDays: 30, tin: "100111222" });
  const wholesale = await mkCustomer({ name: "Upcountry Wholesale Demo", customerType: "CREDIT", creditLimit: 20_000_000, creditPeriodDays: 14, tin: "100333444" });
  await mkCustomer({ name: "Walk-in Cash Demo", customerType: "CASH" });

  const ledger = await api("GET", `/api/v1/ar/customers/${retail}/ledger`);
  if (ledger.status === 200 && (ledger.body.data?.entries?.length ?? 0) > 0) {
    log("ar", "demo invoices exist, skipping transactions");
    return;
  }
  log("ar", "seeding invoices, receipt, deposit…");

  const mkInvoice = async (body: unknown) => expect(await api("POST", "/api/v1/ar/invoices", body), [201], "create invoice");
  // Overdue (14-day terms → due 2026-09-19)
  await mkInvoice({ customerId: wholesale, invoiceDate: "2026-09-05", net: 2_500_000, tax: 450_000, description: "Early September demo supply" });
  // Partially paid
  const inv2 = await mkInvoice({ customerId: retail, invoiceDate: "2026-09-20", net: 1_200_000, tax: 216_000, description: "September demo supply" });
  await api("POST", "/api/v1/ar/receipts", {
    customerId: retail, receiptDate: "2026-09-25", method: "BANK", amount: 1_000_000,
    allocations: [{ invoiceId: inv2.id, amount: 1_000_000 }],
  }).then((r) => expect(r, [201], "create receipt"));
  // Current
  await mkInvoice({ customerId: retail, invoiceDate: "2026-09-28", net: 800_000, tax: 144_000, description: "Late September demo supply" });
  // Deposit held
  await api("POST", "/api/v1/ar/deposits", { customerId: retail, depositDate: "2026-09-10", method: "CASH", amount: 300_000, reference: "DEMO-DEP-1" })
    .then((r) => expect(r, [201], "create deposit"));
  log("ar", "done: 3 customers, 3 invoices (overdue/partial/current), 1 receipt, 1 deposit");
}

/* ── Payables ───────────────────────────────────────────────────── */

async function seedPayables() {
  const list = await api("GET", "/api/v1/ap/suppliers");
  expect(list, [200], "list suppliers");
  const existing = list.body.data as any[];
  const mkSupplier = async (body: any) => {
    const hit = existing.find((s) => s.name === body.name)?.id as string | undefined;
    if (hit) return hit;
    return expect(await api("POST", "/api/v1/ap/suppliers", body), [201], "create supplier").id as string;
  };
  const foods = await mkSupplier({ name: "Nyarugenge Foods Demo", category: "INVENTORY", tin: "200111222", creditPeriodDays: 30 });
  const logistics = await mkSupplier({ name: "Musanze Logistics Demo", category: "SERVICES", tin: "200333444", creditPeriodDays: 14, whtRate: 15 });
  const utilities = await mkSupplier({ name: "Kigali Utilities Demo", category: "OVERHEADS", tin: "200555666", creditPeriodDays: 30 });

  const billsRes = await api("GET", "/api/v1/ap/bills?status=ALL");
  expect(billsRes, [200], "list bills");
  const billsByNo = new Map((billsRes.body.data as any[]).map((b) => [b.supplierInvoiceNumber, b]));
  log("ap", "seeding bills, payment with WHT, advance…");

  const mkBill = async (body: any) => {
    const hit = billsByNo.get(body.supplierInvoiceNumber);
    if (hit) return hit;
    const created = expect(await api("POST", "/api/v1/ap/bills", body), [201], "create bill");
    billsByNo.set(body.supplierInvoiceNumber, created);
    return created;
  };
  // Overdue (30-day terms → due 2026-08-14)
  const bill1 = await mkBill({ supplierId: foods, supplierInvoiceNumber: "DEMO-778", billDate: "2026-07-15", net: 3_000_000, tax: 540_000 });
  // Paid with 5% withholding: 855,000 cash + 45,000 WHT = 900,000
  const bill2 = await mkBill({ supplierId: logistics, supplierInvoiceNumber: "DEMO-779", billDate: "2026-09-08", net: 900_000 });
  const payments = expect(await api("GET", "/api/v1/ap/payments"), [200], "list payments") as any[];
  if (!payments.some((p) => p.reference === "DEMO-EFT-1") && Number(bill2.outstanding ?? bill2.gross ?? 0) > 0) {
    await api("POST", "/api/v1/ap/payments", {
      supplierId: logistics, paymentDate: "2026-09-18", method: "EFT", amount: 855_000,
      withholdingTax: 45_000, reference: "DEMO-EFT-1", allocations: [{ billId: bill2.id, amount: 900_000 }],
    }).then((r) => expect(r, [201], "create payment"));
  }
  // Due soon
  await mkBill({ supplierId: utilities, supplierInvoiceNumber: "DEMO-780", billDate: "2026-09-22", net: 450_000, tax: 81_000 });
  // Advance applied to the overdue bill (same supplier as the bill)
  const advances = expect(await api("GET", "/api/v1/ap/advances"), [200], "list advances") as any[];
  if (!advances.some((a) => a.supplierId === logistics && Number(a.amount ?? a.gross ?? 0) === 500_000)) {
    const adv = await api("POST", "/api/v1/ap/advances", { supplierId: logistics, advanceDate: "2026-09-01", method: "BANK", amount: 500_000 })
      .then((r) => expect(r, [201], "create advance"));
    await api("POST", `/api/v1/ap/advances/${adv.id}/allocate`, { billId: bill1.id, amount: 500_000, allocationDate: "2026-09-02" })
      .then((r) => expect(r, [200], "allocate advance"));
  }
  log("ap", "done: 3 suppliers, 3 bills (overdue/paid/due-soon), 1 payment, 1 advance");
}

/* ── Banking ────────────────────────────────────────────────────── */

async function seedBanking() {
  const list = await api("GET", "/api/v1/banking/accounts");
  expect(list, [200], "list bank accounts");
  if ((list.body.data as any[]).some((a) => a.name === "Demo Main Bank")) {
    log("bank", "demo accounts exist, skipping");
    return;
  }
  log("bank", "seeding bank/cash/petty accounts and transactions…");
  const mkAccount = async (body: unknown) => expect(await api("POST", "/api/v1/banking/accounts", body), [201], "create financial account");
  const bank = await mkAccount({ kind: "BANK", name: "Demo Main Bank", bankName: "Bank of Kigali", accountNumber: "100-001-002", openingBalance: 10_000_000, dateOpened: "2026-01-01" });
  const cash = await mkAccount({ kind: "CASH", name: "Demo Till", glAccountId: await findAccount("1100"), dateOpened: "2026-01-01", custodian: "Demo Cashier" });
  await mkAccount({ kind: "PETTY_CASH", name: "Demo Petty Float", dateOpened: "2026-01-01" });

  const suspense = await findAccount("6600");
  const salaries = await findAccount("6100");
  const post = async (route: string, body: unknown) => expect(await api("POST", `/api/v1/banking${route}`, body), [201], `bank ${route}`);
  await post("/receipts", { financialAccountId: bank.id, transactionDate: "2026-09-26", reference: "DEMO-RC-1", partyType: "CUSTOMER", partyName: "Demo customer", lines: [{ accountId: suspense, amount: 250_000 }] });
  await post("/payments", { financialAccountId: bank.id, transactionDate: "2026-09-27", partyName: "Demo landlord", method: "EFT", lines: [{ accountId: salaries, amount: 600_000, description: "September rent" }] });
  await post("/transfers", { fromAccountId: bank.id, toAccountId: cash.id, transactionDate: "2026-09-28", amount: 1_000_000 });
  log("bank", "done: 3 accounts, receipt, payment, withdrawal");
}

/* ── Expenses ───────────────────────────────────────────────────── */

async function seedExpenses() {
  const list = await api("GET", "/api/v1/expenses?from=2026-01-01&to=2026-12-31");
  if (list.status === 200 && (list.body.data?.rows ?? list.body.data ?? []).length > 0) {
    const rows = (list.body.data?.rows ?? list.body.data) as any[];
    if (rows.some((e) => (e.description ?? "").includes("demo") || (e.payeeName ?? "").includes("Demo"))) {
      log("exp", "demo expenses exist, skipping");
      return;
    }
  }
  log("exp", "seeding expenses…");
  const cats = expect(await api("GET", "/api/v1/expenses/categories"), [200], "expense categories") as any[];
  const fuel = cats.find((c) => c.code === "FUEL") ?? cats[0];
  const rent = cats.find((c) => c.code === "RENT") ?? cats[1] ?? cats[0];
  const bankGl = await findAccount("1110");
  const base = "/api/v1/expenses";
  const post = async (route: string, body: unknown, status = 201) => expect(await api("POST", `${base}${route}`, body), [status], `expense ${route}`);

  const immediate = await post("/", {
    expenseDate: "2026-09-15", categoryId: fuel.id, paymentMode: "IMMEDIATE", payeeName: "Demo Fuel Station",
    description: "Demo delivery van fuel", net: 120_000, tax: 21_600, creditAccountId: bankGl,
    allocations: [{ department: "Logistics", amount: 100_000 }, { department: "Sales", amount: 41_600 }],
  });
  await post(`/${immediate.id}/submit`, {}, 200);
  await post(`/${immediate.id}/approve`, {}, 200);

  const claim = await post("/", {
    expenseDate: "2026-09-16", categoryId: fuel.id, paymentMode: "REIMBURSEMENT", employeeName: "Demo Employee",
    description: "Demo client visit taxi", net: 45_000, submit: true,
  });
  await post(`/${claim.id}/approve`, {}, 200);

  const recurring = await post("/recurring", {
    name: "Demo office rent", categoryId: rent.id, frequency: "MONTHLY", amount: 350_000,
    payeeName: "Demo Landlord", startDate: "2026-09-01", autoPost: true, creditAccountId: bankGl,
  });
  await post(`/recurring/${recurring.id}/run`, {}, 200);
  log("exp", "done: posted fuel expense, reimbursement claim, monthly rent + run");
}

/* ── Tax ────────────────────────────────────────────────────────── */

async function seedTax() {
  const filings = await api("GET", "/api/v1/tax/filings");
  if (filings.status === 200 && (filings.body.data as any[]).some((f) => (f.filingReference ?? "").startsWith("DEMO-"))) {
    log("tax", "demo filing exists, skipping");
    return;
  }
  log("tax", "seeding VAT payment and filing…");
  const bankGl = await findAccount("1110");
  const base = "/api/v1/tax";
  const payment = expect(
    await api("POST", `${base}/payments`, {
      paymentDate: "2026-09-28", taxType: "OUTPUT_VAT", bankAccountId: bankGl, amount: 200_000,
      periodFrom: "2026-09-01", periodTo: "2026-09-30", reference: "DEMO-RRA-SEP",
    }),
    [201], "tax payment",
  );
  log("tax", `payment ${payment.number}`);
  const filing = expect(
    await api("POST", `${base}/filings`, { kind: "VAT", periodFrom: "2026-09-01", periodTo: "2026-09-30", dueDate: "2026-10-15" }),
    [201], "tax filing",
  );
  expect(await api("POST", `${base}/filings/${filing.id}/file`, { filingReference: "DEMO-RRA-FILE-09" }), [200], "file return");
  log("tax", "done: payment DEMO-RRA-SEP, September VAT filed");
}

/* ── Fixed assets ───────────────────────────────────────────────── */

async function seedFixedAssets() {
  const list = await api("GET", "/api/v1/fixed-assets/assets");
  if (list.status === 200 && (list.body.data as any[]).some((a) => (a.name ?? "").includes("Demo"))) {
    log("fa", "demo assets exist, skipping");
    return;
  }
  log("fa", "seeding assets, capitalization, depreciation…");
  const cats = expect(await api("GET", "/api/v1/fixed-assets/categories"), [200], "fa categories") as any[];
  const it = cats.find((c) => c.code === "IT") ?? cats[0];
  const vehicle = cats.find((c) => c.code === "VEHICLE") ?? cats[1] ?? cats[0];
  const bankGl = await findAccount("1110");
  const base = "/api/v1/fixed-assets";
  const post = async (route: string, body: unknown, status = 201) => expect(await api("POST", `${base}${route}`, body), [status], `fa ${route}`);

  const laptop = await post("/assets", {
    name: "Demo HP Laptop", categoryId: it.id, acquisitionCost: 1_500_000, purchaseDate: "2026-06-10",
    serialNumber: "DEMO-IT-01", branch: "Kigali HQ", location: "Finance office",
  });
  await post(`/assets/${laptop.id}/capitalize`, { capitalizationDate: "2026-06-10", creditAccountId: bankGl }, 200);
  await post("/assets", {
    name: "Demo Toyota Hiace", categoryId: vehicle.id, acquisitionCost: 28_000_000, residualValue: 2_800_000,
    purchaseDate: "2026-02-01", capitalize: true, creditAccountId: bankGl, capitalizationDate: "2026-02-01",
    branch: "Kigali HQ", location: "Demo Yard",
  });
  await post("/depreciation/run", { period: "2026-09" });
  log("fa", "done: laptop + van capitalized, September depreciation posted");
}

/* ── Manual journal ─────────────────────────────────────────────── */

async function seedJournal() {
  const list = await api("GET", "/api/v1/journals");
  if (list.status === 200 && (list.body.data as any[]).some((j) => (j.description ?? "").includes("Demo"))) {
    log("gl", "demo journal exists, skipping");
    return;
  }
  log("gl", "posting demo adjustment journal…");
  const salaries = await findAccount("6100");
  const suspense = await findAccount("6600");
  const draft = expect(
    await api("POST", "/api/v1/journals", {
      journalDate: "2026-09-30", description: "Demo accrual adjustment",
      lines: [
        { accountId: salaries, debit: 100_000, credit: 0 },
        { accountId: suspense, debit: 0, credit: 100_000 },
      ],
    }),
    [201], "draft journal",
  );
  expect(await api("POST", `/api/v1/journals/${draft.id}/post`, {}), [200], "post journal");
  log("gl", `done: ${draft.journalNumber} posted`);
}

/* ── Inventory (ERP webhooks) ───────────────────────────────────── */

async function seedInventory() {
  const moves = await api("GET", "/api/v1/inventory/movements?from=2026-01-01&to=2026-12-31");
  if (moves.status === 200 && (moves.body.data?.rows ?? []).some((r: any) => (r.reference ?? "").startsWith("DEMO-"))) {
    log("inv", "demo movements exist, skipping");
    return;
  }
  log("inv", "ingesting demo ERP stock movements…");
  let n = 0;
  const ingest = async (body: unknown, what: string) => {
    n += 1;
    const res = await api("POST", "/api/v1/integration/events", body, integrationHeaders);
    if (![200, 201].includes(res.status)) throw new Error(`${what} → ${res.status}: ${JSON.stringify(res.body)?.slice(0, 300)}`);
  };
  const movement = (ledgerId: number, extra: Record<string, unknown>, meta: Record<string, unknown>) => ({
    eventId: `evt-demo-inv-${ledgerId}`,
    idempotencyKey: `${ORG_ID}|INVENTORY|InventoryLedger|DEMO-${ledgerId}|INVENTORY_MOVEMENT|1`,
    externalOrganizationId: String(ORG_ID),
    externalBranchId: "1",
    eventType: "INVENTORY_MOVEMENT",
    occurredAt: "2026-09-10T09:00:00.000Z",
    sourceModule: "INVENTORY",
    sourceDocumentType: "InventoryLedger",
    sourceDocumentId: `DEMO-${ledgerId}`,
    currencyCode: "RWF",
    amountTotals: { gross: "0", net: "0", tax: "0" },
    ...extra,
    metadata: { ledgerId: `DEMO-${ledgerId}`, branchName: "Kigali Main", unit: "PCS", ...meta },
  });
  await ingest(movement(1, { sourceDocumentNumber: "DEMO-PO-1" }, {
    movementType: "PURCHASE", direction: "IN", productId: 901, productName: "Demo Rice 5kg", sku: "DEMO-901",
    category: "Groceries", quantity: 100, runningBalance: 100, unitCost: 2000, reference: "DEMO-PO-1",
  }), "purchase 1");
  await ingest(movement(2, { sourceDocumentNumber: "DEMO-PO-2" }, {
    movementType: "PURCHASE", direction: "IN", productId: 901, productName: "Demo Rice 5kg", sku: "DEMO-901",
    category: "Groceries", quantity: 50, runningBalance: 150, unitCost: 2200, reference: "DEMO-PO-2",
  }), "purchase 2");
  await ingest({
    eventId: "evt-demo-sale-1",
    idempotencyKey: `${ORG_ID}|POS|Sale|DEMO-S-1|SALE_COMPLETED|1`,
    externalOrganizationId: String(ORG_ID),
    externalBranchId: "1",
    eventType: "SALE_COMPLETED",
    occurredAt: "2026-09-12T10:00:00.000Z",
    sourceModule: "POS",
    sourceDocumentType: "Sale",
    sourceDocumentId: "DEMO-S-1",
    sourceDocumentNumber: "DEMO-S-1",
    currencyCode: "RWF",
    amountTotals: { gross: "1180000", net: "1000000", tax: "180000" },
    paymentSplits: [{ paymentMethod: "CASH", amount: 1180000 }],
    metadata: { paymentType: "CASH", cogs: 150000 },
  }, "demo sale");
  log("inv", "done: 2 purchases + 1 POS sale with COGS");
}

/* ── Main ───────────────────────────────────────────────────────── */

async function main() {
  log("main", `seeding org ${ORG_ID} via ${API}`);
  await ensureSetup();
  await openPeriods();
  await seedReceivables();
  await seedPayables();
  await seedBanking();
  await seedExpenses();
  await seedTax();
  await seedFixedAssets();
  await seedJournal();
  await seedInventory();
  log("main", "demo seed complete");
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(`[seed] FAILED: ${(e as Error).message}`);
  process.exit(1);
});
