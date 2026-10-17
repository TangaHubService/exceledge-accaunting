import { aggregateTrialBalance, yearEndClosingLines } from "@exceledge/accounting-domain";
import ExcelJS from "exceljs";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { csvCell, renderCsv, renderXlsx } from "../src/lib/report-export";
import { movements } from "../src/modules/books/books.service";
import { createAndPostJournal } from "../src/modules/journals/journal.service";
import { activateCompany, authHeaders, resetCompany } from "./helpers";

const app = createApp();
const orgId = 98551;
const otherOrgId = 98552;
const base = "/api/v1/books";

let admin: Record<string, string>;
let companyId = "";
const ids: Record<string, string> = {};

type Line = { accountId?: string; code: string; name: string; amount: number; comparative: number; classification?: string };
type EquityRow = { key: string; amounts: Record<string, number>; total: number };

async function accountId(code: string) {
  return (await prisma.account.findFirstOrThrow({ where: { companyId, code } })).id;
}

async function call(method: "get" | "post", path: string, body?: unknown, headers = admin, status = 200) {
  const res = method === "get" ? await request(app).get(`/api/v1${path}`).set(headers) : await request(app).post(`/api/v1${path}`).set(headers).send(body);
  if (res.status !== status) throw new Error(`${path} → ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

async function journal(journalDate: string, lines: Array<[string, number, number, string?]>) {
  return call("post", "/journals", {
    journalDate,
    description: `Test ${journalDate}`,
    postImmediately: true,
    lines: lines.map(([id, debit, credit, costCentre]) => ({ accountId: id, debit, credit, ...(costCentre ? { costCentre } : {}) })),
  }, admin, 201);
}

const binary = (res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

const line = (rows: Line[], code: string) => rows.find((r) => r.code === code);

describe("Wave C statements and reports", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await resetCompany(orgId);
    await resetCompany(otherOrgId);
    admin = await activateCompany(app, orgId, { name: "Reports Co", tin: "985510001" });
    await activateCompany(app, otherOrgId, { name: "Other Reports Co", tin: "985520001" });
    companyId = (await prisma.company.findFirstOrThrow({ where: { externalErpOrganizationId: String(orgId) } })).id;
    await prisma.financialYear.create({
      data: {
        companyId,
        name: "FY 2025",
        startDate: new Date("2025-01-01T00:00:00Z"),
        endDate: new Date("2025-12-31T00:00:00Z"),
        isCurrent: false,
        periods: {
          create: Array.from({ length: 12 }, (_, m) => ({
            name: `2025-${String(m + 1).padStart(2, "0")}`,
            sequence: m + 1,
            startDate: new Date(Date.UTC(2025, m, 1)),
            endDate: new Date(Date.UTC(2025, m + 1, 0)),
            status: "OPEN" as const,
          })),
        },
      },
    });
    for (const [code, name, type] of [
      ["3010", "Share capital", "EQUITY"],
      ["3400", "Dividends declared", "EQUITY"],
      ["2500", "Long-term bank loan", "LIABILITY"],
    ] as const) {
      ids[code] = (await prisma.account.create({ data: { companyId, code, name, type } })).id;
    }
    for (const code of ["1100", "1500", "2300", "3100", "3300", "4100", "6100"]) ids[code] = await accountId(code);
    await call("post", "/books/dimensions", { kind: "COST_CENTRE", code: "CC-A", name: "Retail" }, admin, 201);

    // FY 2025: capital 100,000; sales 50,000; salaries 20,000 → profit 30,000
    await journal("2025-01-10", [[ids["1100"], 100_000, 0], [ids["3010"], 0, 100_000]]);
    await journal("2025-03-15", [[ids["1100"], 50_000, 0], [ids["4100"], 0, 50_000]]);
    await journal("2025-06-30", [[ids["6100"], 20_000, 0], [ids["1100"], 0, 20_000]]);
    // FY 2026 to June: sales 70,000 (CC-A); salaries 25,000 accrued → profit 45,000
    await journal("2026-02-10", [[ids["1100"], 70_000, 0, "CC-A"], [ids["4100"], 0, 70_000, "CC-A"]]);
    await journal("2026-03-05", [[ids["6100"], 25_000, 0], [ids["2300"], 0, 25_000]]);
    await journal("2026-04-01", [[ids["1500"], 60_000, 0], [ids["2500"], 0, 60_000]]);
    await journal("2026-05-20", [[ids["1500"], 10_000, 0], [ids["3300"], 0, 10_000]]);
    await journal("2026-06-15", [[ids["3400"], 5_000, 0], [ids["1100"], 0, 5_000]]);
  });

  it("reports profit for the range only, with comparatives, the current/non-current split and unclosed earnings", async () => {
    const s = await call("get", "/books/statements?from=2026-01-01&to=2026-06-30");
    expect(s.income.totalRevenue).toBe(70_000);
    expect(s.income.totalExpenses).toBe(25_000);
    expect(s.income.profit).toBe(45_000);
    expect(s.comparative.income).toMatchObject({ totalRevenue: 50_000, totalExpenses: 20_000, profit: 30_000 });
    expect(line(s.income.revenue, "4100")).toMatchObject({ amount: 70_000, comparative: 50_000 });

    const p = s.position;
    expect(p.totals).toEqual({ currentAssets: 195_000, nonCurrentAssets: 70_000, currentLiabilities: 25_000, nonCurrentLiabilities: 60_000 });
    expect(line(p.nonCurrentAssets, "1500")?.amount).toBe(70_000);
    expect(line(p.nonCurrentLiabilities, "2500")?.classification).toBe("NON_CURRENT");
    expect(line(p.currentLiabilities, "2300")?.amount).toBe(25_000);
    expect(line(p.equity, "RE-UNCLOSED")?.amount).toBe(30_000);
    expect(line(p.equity, "CYE")).toMatchObject({ amount: 45_000, comparative: 30_000 });
    expect(p).toMatchObject({ totalAssets: 265_000, totalLiabilities: 85_000, totalEquity: 180_000, balanced: true });
    expect(s.earnings).toMatchObject({ retainedEarnings: 30_000, currentYearEarnings: 45_000 });
    expect(s.comparative.position).toMatchObject({ totalAssets: 130_000, totalEquity: 130_000, balanced: true });
    expect(s.ratios.currentRatio).toBe(7.8);
    // Loan-funded and revalued plant: the loan is financing, the revaluation is non-cash.
    expect(s.cashFlow).toMatchObject({ profit: 45_000, operating: 70_000, investing: -60_000, financing: 55_000, netChange: 65_000, cashChange: 65_000 });
    expect(s.comparative.cashFlow).toMatchObject({ operating: 30_000, investing: 0, financing: 100_000, netChange: 130_000, cashChange: 130_000 });

    const byDefault = await call("get", "/books/statements?to=2026-06-30");
    expect(byDefault.from.slice(0, 10)).toBe("2026-01-01");
    expect(byDefault.income.profit).toBe(45_000);
    const explicit = await call("get", "/books/statements?from=2026-01-01&to=2026-06-30&compareFrom=2025-01-01&compareTo=2025-12-31");
    expect(explicit.comparative.income.profit).toBe(30_000);
    expect(explicit.comparative.position.totalEquity).toBe(130_000);

    const notes = s.notes;
    expect(notes.basis[0]).toContain("2026-01-01 to 2026-06-30");
    expect(notes.items.find((n: { title: string }) => n.title === "Non-current assets").total).toBe(70_000);
    expect(notes.policies.find((n: { title: string }) => n.title === "Inventories")).toBeTruthy();

    expect((await request(app).get(`${base}/statements?from=2026-07-01&to=2026-06-30`).set(admin)).status).toBe(400);
    expect((await request(app).get(`${base}/statements?to=not-a-date`).set(admin)).status).toBe(400);
  });

  it("reconciles the statement of changes in equity with the balance sheet", async () => {
    const s = await call("get", "/books/statements?from=2026-01-01&to=2026-06-30");
    const e = s.equityStatement;
    const row = (key: string) => e.rows.find((r: EquityRow) => r.key === key) as EquityRow;
    expect(row("OPENING").total).toBe(130_000);
    expect(row("OPENING").amounts[ids["3010"]]).toBe(100_000);
    expect(row("OPENING").amounts.PNL).toBe(30_000);
    expect(row("PROFIT").total).toBe(45_000);
    expect(row("OCI").amounts[ids["3300"]]).toBe(10_000);
    expect(row("DIVIDENDS").amounts[ids["3400"]]).toBe(-5_000);
    expect(row("CLOSING").total).toBe(180_000);
    const movementTotal = e.rows.filter((r: EquityRow) => !["OPENING", "CLOSING"].includes(r.key)).reduce((t: number, r: EquityRow) => t + r.total, 0);
    expect(row("OPENING").total + movementTotal).toBe(row("CLOSING").total);
    expect(row("CLOSING").total).toBe(s.position.totalEquity);
    expect(e.reconciles).toBe(true);
  });

  it("gives a trial balance with opening, movement and closing columns, filtered by dimension", async () => {
    const tb = await call("get", "/books/trial-balance?mode=COLUMNS&from=2026-01-01&to=2026-06-30");
    const cash = tb.rows.find((r: { code: string }) => r.code === "1100");
    expect(cash).toMatchObject({ openingDebit: 130_000, movementDebit: 70_000, movementCredit: 5_000, debit: 195_000, credit: 0 });
    expect(tb.rows.find((r: { code: string }) => r.code === "4100")).toMatchObject({ openingCredit: 50_000, movementCredit: 70_000, credit: 120_000 });
    for (const r of tb.rows) {
      expect(Math.round((r.openingDebit - r.openingCredit + r.movementDebit - r.movementCredit - (r.debit - r.credit)) * 100)).toBe(0);
    }
    expect(tb.totals.openingDebit).toBe(tb.totals.openingCredit);
    expect(tb.totals.movementDebit).toBe(170_000);
    expect(tb.totals.movementCredit).toBe(170_000);
    expect(tb.difference).toBe(0);

    const cc = await call("get", "/books/trial-balance?mode=COLUMNS&from=2026-01-01&to=2026-06-30&costCentre=CC-A");
    expect(cc.rows.map((r: { code: string }) => r.code)).toEqual(["1100", "4100"]);
    expect(cc.rows[0]).toMatchObject({ openingDebit: 0, movementDebit: 70_000, debit: 70_000 });
    expect(cc.difference).toBe(0);
    const standardCc = await call("get", "/books/trial-balance?asOf=2026-06-30&costCentre=CC-A");
    expect(standardCc.debit).toBe(70_000);

    expect((await request(app).get(`${base}/trial-balance?mode=SIDEWAYS`).set(admin)).status).toBe(400);
  });

  it("exports reports as CSV, XLSX and PDF with formula-safe CSV", async () => {
    const odd = await prisma.account.create({ data: { companyId, code: "1199", name: "=HYPERLINK(\"http://x\",\"y\")", type: "ASSET" } });
    await journal("2026-09-01", [[odd.id, 1, 0], [ids["2300"], 0, 1]]);

    const csv = await request(app).get(`${base}/trial-balance?format=csv&asOf=2026-09-30`).set(admin);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/^text\/csv/);
    expect(csv.headers["content-disposition"]).toMatch(/attachment; filename="trial-balance-2026-09-30\.csv"/);
    expect(csv.text).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csv.text).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(csv.text).toMatch(/1100,Cash on Hand,195000,/);

    const xlsx = await request(app).get(`${base}/statements?format=xlsx&from=2026-01-01&to=2026-06-30`).set(admin).buffer(true).parse(binary);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(xlsx.body);
    expect(book.worksheets.map((w) => w.name)).toEqual(["Income statement", "Statement of financial position", "Statement of changes in equity", "Cash flow (indirect)", "Notes"]);
    const income = book.getWorksheet("Income statement")!;
    const cells: ExcelJS.Cell[] = [];
    income.eachRow((r) => r.eachCell((c) => cells.push(c)));
    const profit = cells.find((c) => c.value === 45_000);
    expect(profit?.numFmt).toContain("#,##0.00");
    expect(cells.some((c) => c.value === 30_000)).toBe(true);

    const pdf = await request(app).get(`/api/v1/gl/accounts/${ids["1100"]}?format=pdf&from=2026-01-01&to=2026-06-30`).set(admin).buffer(true).parse(binary);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.body.subarray(0, 4).toString()).toBe("%PDF");

    const tbPdf = await request(app).get(`${base}/trial-balance?format=pdf&mode=COLUMNS&from=2026-01-01&to=2026-06-30`).set(admin).buffer(true).parse(binary);
    expect(tbPdf.body.subarray(0, 4).toString()).toBe("%PDF");
    expect(tbPdf.body.toString("latin1")).toContain("/MediaBox [0 0 842 595]");

    const arCsv = await request(app).get("/api/v1/ar/ageing?format=csv&asOf=2026-06-30").set(admin);
    expect(arCsv.status).toBe(200);
    expect(arCsv.text).toContain("Bucket,Outstanding");
    const apXlsx = await request(app).get("/api/v1/ap/ageing?format=xlsx").set(admin).buffer(true).parse(binary);
    expect(apXlsx.status).toBe(200);
    await new ExcelJS.Workbook().xlsx.load(apXlsx.body);
    const vat = await request(app).get("/api/v1/tax/reports/vat?format=pdf&from=2026-01-01&to=2026-06-30").set(admin).buffer(true).parse(binary);
    expect(vat.status).toBe(200);
    expect(vat.body.subarray(0, 4).toString()).toBe("%PDF");
    const wht = await request(app).get("/api/v1/ap/reports/withholding?format=csv&from=2026-01-01&to=2026-06-30").set(admin);
    expect(wht.status).toBe(200);
    expect(wht.headers["content-disposition"]).toContain("withholding-tax-2026-01-01-2026-06-30.csv");

    expect((await request(app).get(`${base}/trial-balance?format=docx`).set(admin)).status).toBe(400);
  });

  it("keeps retained earnings right after a year-end close without double counting", async () => {
    const rows = aggregateTrialBalance(await movements(companyId, { from: new Date("2025-01-01T00:00:00Z"), to: new Date("2025-12-31T23:59:59.999Z") }), "STANDARD");
    await createAndPostJournal(
      companyId,
      {
        journalDate: new Date("2025-12-31T00:00:00Z"),
        journalType: "ADJUSTMENT",
        description: "Year-end close FY 2025",
        sourceModule: "CLOSE",
        sourceDocumentType: "YEAR_END_CLOSE",
        sourceDocumentId: "fy2025",
        lines: yearEndClosingLines(rows, ids["3100"]),
      } as never,
      { erpUserId: 441 },
    );

    const s = await call("get", "/books/statements?from=2026-01-01&to=2026-06-30");
    expect(s.income.profit).toBe(45_000);
    expect(line(s.position.equity, "3100")?.amount).toBe(30_000);
    expect(line(s.position.equity, "RE-UNCLOSED")).toBeUndefined();
    expect(line(s.position.equity, "CYE")?.amount).toBe(45_000);
    expect(s.position.totalEquity).toBe(180_000);
    expect(s.earnings).toMatchObject({ retainedEarnings: 30_000, currentYearEarnings: 45_000 });
    expect(s.equityStatement.rows.find((r: EquityRow) => r.key === "OPENING").amounts[ids["3100"]]).toBe(30_000);
    expect(s.equityStatement.reconciles).toBe(true);

    const year = await call("get", "/books/statements?from=2025-01-01&to=2025-12-31");
    expect(year.income.profit).toBe(30_000);
    expect(line(year.position.equity, "CYE")).toBeUndefined();
    expect(line(year.position.equity, "3100")?.amount).toBe(30_000);
    expect(year.position.totalEquity).toBe(130_000);
    const transfer = year.equityStatement.rows.find((r: EquityRow) => r.key === "TRANSFER");
    expect(transfer.amounts[ids["3100"]]).toBe(30_000);
    expect(transfer.amounts.PNL).toBe(-30_000);
    expect(transfer.total).toBe(0);
    expect(year.equityStatement.rows.find((r: EquityRow) => r.key === "CLOSING").total).toBe(130_000);
    expect(year.equityStatement.reconciles).toBe(true);
  });

  it("lists the ledger by transaction date with an opening balance and running balance across pages", async () => {
    await journal("2026-01-05", [[ids["1100"], 1_000, 0], [ids["2300"], 0, 1_000]]);
    const all = await call("get", `/gl/accounts/${ids["1100"]}?from=2026-01-01&to=2026-06-30`);
    expect(all.openingBalance).toBe(130_000);
    expect(all.entries.map((e: { runningBalance: number }) => e.runningBalance)).toEqual([131_000, 201_000, 196_000]);
    expect(all.closingBalance).toBe(196_000);
    expect(all.totals).toEqual({ debit: 71_000, credit: 5_000 });

    const page2 = await call("get", `/gl/accounts/${ids["1100"]}?from=2026-01-01&to=2026-06-30&page=2&pageSize=2`);
    expect(page2.total).toBe(3);
    expect(page2.pageOpeningBalance).toBe(201_000);
    expect(page2.entries).toHaveLength(1);
    expect(page2.entries[0]).toMatchObject({ credit: 5_000, runningBalance: 196_000 });

    const cc = await call("get", `/gl/accounts/${ids["1100"]}?from=2026-01-01&costCentre=CC-A`);
    expect(cc.openingBalance).toBe(0);
    expect(cc.entries.map((e: { runningBalance: number }) => e.runningBalance)).toEqual([70_000]);
  });

  it("rejects roles without report access, honours API keys and keeps companies apart", async () => {
    const seller = authHeaders(orgId, "SELLER", 990);
    expect((await request(app).get(`${base}/statements?format=pdf`).set(seller)).status).toBe(403);
    expect((await request(app).get(`${base}/trial-balance?format=csv`).set(seller)).status).toBe(403);
    expect((await request(app).get(`/api/v1/gl/accounts/${ids["1100"]}?format=csv`).set(seller)).status).toBe(403);
    expect((await request(app).get("/api/v1/tax/reports/vat?format=csv").set(seller)).status).toBe(403);

    const key = await call("post", "/books/api-keys", { name: "Reports", scopes: ["report:view", "gl:view"] }, admin, 201);
    const keyed = { "x-api-key": key.token };
    const tb = await request(app).get(`${base}/trial-balance?format=csv&asOf=2026-06-30`).set(keyed);
    expect(tb.status).toBe(200);
    expect(tb.headers["content-type"]).toMatch(/^text\/csv/);
    const ledger = await request(app).get(`/api/v1/gl/accounts/${ids["1100"]}?format=xlsx`).set(keyed).buffer(true).parse(binary);
    expect(ledger.status).toBe(200);
    expect((await request(app).get("/api/v1/ar/ageing?format=csv").set(keyed)).status).toBe(403);

    const other = authHeaders(otherOrgId);
    expect((await request(app).get(`/api/v1/gl/accounts/${ids["1100"]}`).set(other)).status).toBe(404);
    expect((await request(app).get(`/api/v1/gl/accounts/${ids["1100"]}?format=pdf`).set(other)).status).toBe(404);
    const theirs = await call("get", "/books/statements?from=2026-01-01&to=2026-06-30", undefined, other);
    expect(theirs.income.totalRevenue).toBe(0);
    expect(theirs.position.totalAssets).toBe(0);
  });

  it("neutralises formula prefixes in CSV text but keeps negative numbers numeric, and never writes NaN cells", async () => {
    for (const s of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) expect(csvCell(s).replace(/^"/, "")).toMatch(/^'/);
    expect(csvCell(-1250.5)).toBe("-1250.5");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell("a,\"b\"")).toBe('"a,""b"""');

    const doc = {
      title: "T",
      filename: "t",
      sections: [{ columns: [{ key: "name", header: "Name" }, { key: "amount", header: "Amount", type: "money" as const }, { key: "on", header: "On", type: "date" as const }], rows: [{ name: "-Loss", amount: -12.3449, on: "2026-01-02" }, { name: "x", amount: "n/a", on: "bad" }] }],
    };
    const csv = renderCsv(doc).toString("utf8");
    expect(csv).toContain("'-Loss,-12.34,2026-01-02");
    expect(csv).toContain("x,,\r\n");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await renderXlsx(doc));
    const values: unknown[] = [];
    book.worksheets[0].eachRow((r) => r.eachCell((c) => values.push(c.value)));
    expect(values).toContain(-12.34);
    expect(values.some((v) => typeof v === "number" && Number.isNaN(v))).toBe(false);
  });
});
