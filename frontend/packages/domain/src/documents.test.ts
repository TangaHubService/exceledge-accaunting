import { describe, expect, it } from "vitest";
import { buildLinedBillJournal, buildLinedInvoiceJournal, computeDocumentLines, periodStatement, type DefaultAccountMap } from "./index";

const defaults = {
  accountsReceivableId: "ar",
  accountsPayableId: "ap",
  salesRevenueId: "sales",
  purchasesId: "purchases",
  outputTaxPayableId: "vat-out",
  inputTaxReceivableId: "vat-in",
} as unknown as DefaultAccountMap;

const vat = { code: "VAT18", ratePercent: 18, isActive: true, effectiveFrom: new Date("2020-01-01"), glAccountId: null };
const day = new Date("2026-10-15");

describe("computeDocumentLines", () => {
  it("prices lines with discounts and rounds tax per line", () => {
    const out = computeDocumentLines(
      [
        { description: "Widget", quantity: 3, unitPrice: 33.33, discount: 0.99, taxCode: "vat18" },
        { description: "Exempt service", quantity: 1, unitPrice: 50 },
      ],
      [vat],
      day,
    );
    expect(out.lines[0].net).toBe(99);
    expect(out.lines[0].tax).toBe(17.82);
    expect(out.lines[1].tax).toBe(0);
    expect(out).toMatchObject({ net: 149, tax: 17.82, gross: 166.82 });
  });

  it("rejects unknown, inactive and out-of-date tax codes", () => {
    expect(() => computeDocumentLines([{ description: "x", quantity: 1, unitPrice: 1, taxCode: "NOPE" }], [vat], day)).toThrow(/does not exist/);
    expect(() => computeDocumentLines([{ description: "x", quantity: 1, unitPrice: 1, taxCode: "VAT18" }], [{ ...vat, isActive: false }], day)).toThrow(/inactive/);
    expect(() =>
      computeDocumentLines([{ description: "x", quantity: 1, unitPrice: 1, taxCode: "VAT18" }], [{ ...vat, effectiveTo: new Date("2025-12-31") }], day),
    ).toThrow(/not in force/);
  });

  it("rejects bad quantities, prices, discounts and empty documents", () => {
    expect(() => computeDocumentLines([], [], day)).toThrow(/at least one line/);
    expect(() => computeDocumentLines([{ description: "", quantity: 1, unitPrice: 1 }], [], day)).toThrow(/description/);
    expect(() => computeDocumentLines([{ description: "x", quantity: 0, unitPrice: 1 }], [], day)).toThrow(/quantity/);
    expect(() => computeDocumentLines([{ description: "x", quantity: 1, unitPrice: -1 }], [], day)).toThrow(/unit price/);
    expect(() => computeDocumentLines([{ description: "x", quantity: 1, unitPrice: 10, discount: 11 }], [], day)).toThrow(/discount is more/);
    expect(() => computeDocumentLines([{ description: "x", quantity: 1, unitPrice: 10, discount: 10 }], [], day)).toThrow(/total must be positive/);
  });
});

describe("lined journals", () => {
  const priced = computeDocumentLines(
    [
      { description: "A", quantity: 1, unitPrice: 100, taxCode: "VAT18", accountId: "consulting" },
      { description: "B", quantity: 2, unitPrice: 50, taxCode: "VAT18" },
    ],
    [{ ...vat, glAccountId: "vat-special" }],
    day,
  );

  it("credits revenue per line account and VAT per tax account", () => {
    const lines = buildLinedInvoiceJournal(defaults, { lines: priced.lines });
    expect(lines).toEqual([
      expect.objectContaining({ accountId: "ar", debit: 236, credit: 0 }),
      expect.objectContaining({ accountId: "consulting", credit: 100 }),
      expect.objectContaining({ accountId: "sales", credit: 100 }),
      expect.objectContaining({ accountId: "vat-special", credit: 36 }),
    ]);
  });

  it("debits expense per line account and credits the supplier's payables", () => {
    const lines = buildLinedBillJournal(defaults, { lines: priced.lines, apAccountId: "ap-local", expenseAccountId: "rent" });
    expect(lines).toEqual([
      expect.objectContaining({ accountId: "consulting", debit: 100 }),
      expect.objectContaining({ accountId: "rent", debit: 100 }),
      expect.objectContaining({ accountId: "vat-special", debit: 36 }),
      expect.objectContaining({ accountId: "ap-local", credit: 236 }),
    ]);
  });
});

describe("periodStatement", () => {
  const entries = [
    { entryDate: new Date("2026-08-20"), debit: 500, credit: 0 },
    { entryDate: new Date("2026-09-05"), debit: 0, credit: 200 },
    { entryDate: new Date("2026-09-10"), debit: 100, credit: 0 },
    { entryDate: new Date("2026-10-01"), debit: 999, credit: 0 },
  ];

  it("brings the balance forward and runs it through the period", () => {
    const s = periodStatement(entries, new Date("2026-09-01"), new Date("2026-09-30T23:59:59Z"), 1);
    expect(s.opening).toBe(500);
    expect(s.entries.map((e) => e.balance)).toEqual([300, 400]);
    expect(s).toMatchObject({ totalDebit: 100, totalCredit: 200, closing: 400 });
  });

  it("uses credits as increases for suppliers and keeps the opening when nothing moved", () => {
    const s = periodStatement(entries, new Date("2026-09-15"), new Date("2026-09-20"), -1);
    expect(s.opening).toBe(-400);
    expect(s.entries).toHaveLength(0);
    expect(s.closing).toBe(-400);
  });

  it("rejects a reversed range", () => {
    expect(() => periodStatement(entries, new Date("2026-10-01"), new Date("2026-09-01"), 1)).toThrow(/after the end/);
  });
});
