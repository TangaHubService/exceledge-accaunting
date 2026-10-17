import { describe, expect, it } from "vitest";
import {
  buildCustomerReceiptLines,
  buildSaleRefundLines,
  buildSaleSettlementLines,
  buildSupplierPaymentSettlementLines,
  buildSupplierReturnLines,
  creditPortion,
  normalizePaymentMethod,
  readPaymentSplits,
} from "./integration";

const defaults = {
  accountsReceivableId: "ar",
  accountsPayableId: "ap",
  salesRevenueId: "rev",
  salesReturnsId: "ret",
  outputTaxPayableId: "vat",
  defaultCashAccountId: "cash",
  defaultBankAccountId: "bank",
  mobileMoneyClearingId: "momo",
};

describe("ERP payment settlement", () => {
  it("normalizes ERP payment methods", () => {
    expect(normalizePaymentMethod("BANK_TRANSFER")).toBe("BANK");
    expect(normalizePaymentMethod("card")).toBe("BANK");
    expect(normalizePaymentMethod("MTN MoMo")).toBe("MOBILE_MONEY");
    expect(normalizePaymentMethod("DEBT")).toBe("CREDIT");
    expect(normalizePaymentMethod("INSURANCE")).toBe("CREDIT");
    expect(normalizePaymentMethod(undefined)).toBe("CASH");
    expect(normalizePaymentMethod("CREDIT_CARD")).toBe("BANK");
    expect(normalizePaymentMethod("PAYPACK")).toBe("MOBILE_MONEY");
    expect(normalizePaymentMethod("STORE_CREDIT")).toBe("CREDIT");
    expect(normalizePaymentMethod("OTHER")).toBe("CASH");
    expect(() => normalizePaymentMethod("MIXED")).toThrow(/needs its payment splits/);
    expect(() => normalizePaymentMethod("BARTER")).toThrow(/Unknown payment method/);
    expect(() => readPaymentSplits(undefined, 100, "MIXED")).toThrow(/needs its payment splits/);
  });

  it("returns stock to a supplier at cost with the gap to purchase returns", () => {
    const accounts = { ...defaults, inventoryAssetId: "inv", purchaseReturnsId: "pret", inputTaxReceivableId: "vin" };
    const above = buildSupplierReturnLines(accounts, { net: 250, tax: 45, cost: 200 });
    expect(above).toEqual([
      { accountId: "ap", description: "Accounts payable", debit: 295, credit: 0 },
      { accountId: "inv", description: "Stock returned to supplier", debit: 0, credit: 200 },
      { accountId: "pret", description: "Purchase returns", debit: 0, credit: 50 },
      { accountId: "vin", description: "Input VAT reversed", debit: 0, credit: 45 },
    ]);
    const below = buildSupplierReturnLines(accounts, { net: 150, tax: 0, cost: 200 });
    expect(below.find((l) => l.accountId === "pret")).toMatchObject({ debit: 50, credit: 0 });
    const free = buildSupplierReturnLines(accounts, { net: 100, tax: 0, cost: 0 });
    expect(free.map((l) => l.accountId)).toEqual(["ap", "pret"]);
    expect(() => buildSupplierReturnLines(accounts, { net: 0, tax: 0, cost: 10 })).toThrow(/positive/);
    expect(() => buildSupplierReturnLines({ ...accounts, inventoryAssetId: null }, { net: 10, tax: 0, cost: 10 })).toThrow(/Inventory asset/);
  });

  it("merges splits per method, absorbs rounding and rejects splits that do not add up", () => {
    const splits = readPaymentSplits(
      [
        { paymentMethod: "CASH", amount: 300 },
        { paymentMethod: "MOMO", amount: 500 },
        { paymentMethod: "MOBILE_MONEY", amount: 379.6 },
      ],
      1180,
      "CASH",
    );
    expect(splits).toEqual([
      { method: "CASH", amount: 300 },
      { method: "MOBILE_MONEY", amount: 880 },
    ]);
    expect(() => readPaymentSplits([{ paymentMethod: "CASH", amount: 1000 }], 1180, "CASH")).toThrow(/do not add up/);
    expect(() => readPaymentSplits([{ paymentMethod: "CASH", amount: -5 }], 1180, "CASH")).toThrow(/negative/);
    expect(readPaymentSplits([], 1180, "DEBT")).toEqual([{ method: "CREDIT", amount: 1180 }]);
  });

  it("posts a split sale with one debit per method and no cost of sales", () => {
    const splits = readPaymentSplits([{ paymentMethod: "CASH", amount: 180 }, { paymentMethod: "DEBT", amount: 1000 }], 1180, "SPLIT");
    expect(creditPortion(splits)).toBe(1000);
    const lines = buildSaleSettlementLines(defaults, { net: 1000, tax: 180, splits });
    expect(lines).toEqual([
      { accountId: "cash", description: "Sale receipt (cash)", debit: 180, credit: 0 },
      { accountId: "ar", description: "Sale on credit", debit: 1000, credit: 0 },
      { accountId: "rev", description: "Sales revenue", debit: 0, credit: 1000 },
      { accountId: "vat", description: "Output VAT", debit: 0, credit: 180 },
    ]);
  });

  it("refunds through sales returns and the original settlement", () => {
    const lines = buildSaleRefundLines(defaults, { net: 100, tax: 18, splits: [{ method: "BANK", amount: 118 }] });
    expect(lines).toEqual([
      { accountId: "ret", description: "Sales returns", debit: 100, credit: 0 },
      { accountId: "vat", description: "Output VAT reversed", debit: 18, credit: 0 },
      { accountId: "bank", description: "Refund paid (bank)", debit: 0, credit: 118 },
    ]);
    expect(() => buildSaleRefundLines(defaults, { net: 0, tax: 0, splits: [] })).toThrow(/positive/);
  });

  it("refuses credit as a way to pay a customer or supplier balance", () => {
    expect(() => buildCustomerReceiptLines(defaults, [{ method: "CREDIT", amount: 10 }])).toThrow(/cannot be settled on credit/);
    expect(() => buildSupplierPaymentSettlementLines(defaults, [{ method: "CREDIT", amount: 10 }])).toThrow(/cannot be settled on credit/);
    expect(() => buildSupplierPaymentSettlementLines({ ...defaults, defaultBankAccountId: null }, [{ method: "BANK", amount: 10 }])).toThrow(/bank account/);
    const lines = buildCustomerReceiptLines(defaults, [{ method: "CASH", amount: 40 }, { method: "BANK", amount: 60 }]);
    expect(lines.at(-1)).toEqual({ accountId: "ar", description: "Accounts receivable", debit: 0, credit: 100 });
  });
});
