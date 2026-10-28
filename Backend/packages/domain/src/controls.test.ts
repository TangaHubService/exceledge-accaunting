import { describe, expect, it } from "vitest";
import {
  approvalPlan,
  assertNumberFormat,
  dimensionProfitAndLoss,
  formatDocumentNumber,
  numberPeriodKey,
  parseApprovalTiers,
  roleForLevel,
  transactionTiming,
} from "./controls";

describe("approval plan", () => {
  const tiers = parseApprovalTiers([
    { minAmount: 1_000_000, levels: 2, roles: ["accountant", "ADMIN"] },
    { minAmount: 100_000, levels: 1 },
  ]);

  it("picks the highest tier at or below the amount", () => {
    expect(approvalPlan({ amount: 50_000, enabled: true, approvalLevels: 1, tiers })).toEqual({ levels: 0, roles: [] });
    expect(approvalPlan({ amount: 100_000, enabled: true, approvalLevels: 1, tiers })).toEqual({ levels: 1, roles: [] });
    expect(approvalPlan({ amount: 2_000_000, enabled: true, approvalLevels: 1, tiers })).toEqual({ levels: 2, roles: ["ACCOUNTANT", "ADMIN"] });
  });

  it("uses approvalLevels without tiers and nothing when disabled", () => {
    expect(approvalPlan({ amount: 10, enabled: true, approvalLevels: 3, tiers: [] }).levels).toBe(3);
    expect(approvalPlan({ amount: 10, enabled: false, approvalLevels: 3, tiers: [] }).levels).toBe(0);
    expect(approvalPlan({ amount: 10, enabled: false, approvalLevels: 3, tiers: [], forceApproval: true }).levels).toBe(1);
  });

  it("rejects malformed tiers", () => {
    expect(() => parseApprovalTiers({ minAmount: 1 })).toThrow(/list of tiers/);
    expect(() => parseApprovalTiers([{ minAmount: -1, levels: 1 }])).toThrow(/minAmount/);
    expect(() => parseApprovalTiers([{ minAmount: 0, levels: 6 }])).toThrow(/levels/);
    expect(() => parseApprovalTiers([{ minAmount: 0, levels: 1, roles: ["A", "B"] }])).toThrow(/roles/);
    expect(() => parseApprovalTiers([{ minAmount: 5, levels: 1 }, { minAmount: 5, levels: 2 }])).toThrow(/same minAmount/);
    expect(parseApprovalTiers(null)).toEqual([]);
  });

  it("names the role per level", () => {
    expect(roleForLevel(["ACCOUNTANT"], 1)).toBe("ACCOUNTANT");
    expect(roleForLevel(["ACCOUNTANT"], 2)).toBeNull();
  });
});

describe("transaction timing", () => {
  const today = new Date("2026-10-15T09:00:00Z");
  const periodStart = new Date("2026-10-01T00:00:00Z");
  it("classifies backdated, current and future dates", () => {
    expect(transactionTiming(new Date("2026-09-30T23:00:00Z"), today, periodStart)).toBe("BACKDATED");
    expect(transactionTiming(new Date("2026-10-02"), today, periodStart)).toBe("CURRENT");
    expect(transactionTiming(new Date("2026-10-15T23:59:00Z"), today, periodStart)).toBe("CURRENT");
    expect(transactionTiming(new Date("2026-10-16"), today, periodStart)).toBe("FUTURE");
    expect(transactionTiming(new Date("2026-10-14"), today, null)).toBe("BACKDATED");
  });
});

describe("document numbering", () => {
  const base = { prefix: "JE", includeYear: true, includeMonth: false, includeBranch: false, sequenceLength: 6, resetFrequency: "YEARLY" };

  it("formats year, month and branch segments", () => {
    const date = new Date("2026-03-09T00:00:00Z");
    expect(formatDocumentNumber(base, 42, date)).toBe("JE-2026-000042");
    expect(formatDocumentNumber({ ...base, includeMonth: true, includeBranch: true }, 7, date, "hq-1")).toBe("JE-2026-03-HQ1-000007");
    expect(formatDocumentNumber({ ...base, includeYear: false, resetFrequency: "NEVER" }, 1, date)).toBe("JE-000001");
  });

  it("keys counters by reset period", () => {
    const date = new Date("2026-03-09T00:00:00Z");
    expect(numberPeriodKey("YEARLY", date)).toBe("2026");
    expect(numberPeriodKey("MONTHLY", date)).toBe("2026-03");
    expect(numberPeriodKey("NEVER", date)).toBe("ALL");
  });

  it("refuses formats whose numbers would repeat after a reset", () => {
    expect(() => assertNumberFormat({ ...base, includeYear: false })).toThrow(/yearly reset/);
    expect(() => assertNumberFormat({ ...base, resetFrequency: "MONTHLY" })).toThrow(/monthly reset/);
    expect(() => assertNumberFormat({ ...base, includeYear: false, includeMonth: true, resetFrequency: "NEVER" })).toThrow(/year/);
    expect(() => assertNumberFormat({ ...base, prefix: "J E" })).toThrow(/prefix/);
    expect(() => assertNumberFormat(base)).not.toThrow();
  });
});

describe("dimension profit and loss", () => {
  it("splits income and expenses per dimension value", () => {
    const rows = dimensionProfitAndLoss([
      { key: "CC1", type: "INCOME", debit: 0, credit: 500 },
      { key: "CC1", type: "EXPENSE", debit: 200, credit: 0 },
      { key: "CC1", type: "ASSET", debit: 500, credit: 0 },
      { key: "CC2", type: "COST_OF_SALES", debit: 80, credit: 0 },
    ]);
    expect(rows).toEqual([
      { key: "CC1", income: 500, expenses: 200, profit: 300, debit: 700, credit: 500 },
      { key: "CC2", income: 0, expenses: 80, profit: -80, debit: 80, credit: 0 },
    ]);
  });
});
