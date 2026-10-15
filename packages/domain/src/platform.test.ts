import { describe, expect, it } from "vitest";
import {
  aggregateTrialBalance,
  anomalyScore,
  answerFromBooks,
  budgetVariance,
  buildFinancialStatements,
  consolidateTrialBalances,
  convertJournalLines,
  esgIntensity,
  linearForecast,
  nextCronTime,
  parseCron,
  periodCanClose,
  revaluationDelta,
  trialBalanceTotals,
  unrealizedFxAdjustment,
  yearEndClosingLines,
} from "./platform";

const lines = [
  { accountId: "cash", code: "1100", name: "Cash", type: "ASSET" as const, debit: 80, credit: 0 },
  { accountId: "sales", code: "4100", name: "Sales", type: "INCOME" as const, debit: 0, credit: 80 },
  { accountId: "dep", code: "6300", name: "Depreciation", type: "EXPENSE" as const, debit: 20, credit: 0, journalType: "ADJUSTMENT" },
  { accountId: "accum", code: "1510", name: "Accumulated depreciation", type: "ASSET" as const, debit: 0, credit: 20, journalType: "ADJUSTMENT" },
];

describe("phases 11-20 books", () => {
  it("builds a balanced trial balance and drops adjustments when unadjusted", () => {
    const full = aggregateTrialBalance(lines, "STANDARD");
    expect(trialBalanceTotals(full).balanced).toBe(true);
    const unadjusted = aggregateTrialBalance(lines, "UNADJUSTED");
    expect(unadjusted.find((r) => r.code === "6300")).toBeUndefined();
    expect(aggregateTrialBalance(lines, "POST_CLOSING").every((r) => r.type === "ASSET" || r.type === "LIABILITY" || r.type === "EQUITY")).toBe(true);
  });

  it("states profit and plugs unclosed earnings", () => {
    const statements = buildFinancialStatements(aggregateTrialBalance(lines));
    expect(statements.income.profit).toBe(60);
    expect(statements.position.balanced).toBe(true);
    expect(statements.cashFlow.depreciation).toBe(20);
    expect(statements.cashFlow.netChange).toBe(statements.cashFlow.cashChange);
    expect(statements.cashFlow.cashChange).toBe(80);
  });

  it("closes the year into retained earnings", () => {
    const closing = yearEndClosingLines(aggregateTrialBalance(lines), "re");
    const debit = closing.reduce((s, l) => s + l.debit, 0);
    const credit = closing.reduce((s, l) => s + l.credit, 0);
    expect(debit).toBe(credit);
    expect(closing.find((l) => l.accountId === "re")?.credit).toBe(60);
  });

  it("blocks a close when drafts remain", () => {
    expect(periodCanClose({ drafts: 1, openExceptions: 0, difference: 0, pendingApprovals: 0 }).canClose).toBe(false);
    expect(periodCanClose({ drafts: 0, openExceptions: 0, difference: 0, pendingApprovals: 0 }).canClose).toBe(true);
  });

  it("revalues a foreign asset and flags budget variance", () => {
    const fx = unrealizedFxAdjustment({ foreignBalance: 100, bookFunctional: 100, closingRate: 1.2, debitNormal: true });
    expect(fx.gain).toBe(20);
    const variance = budgetVariance([{ key: "Rent", budget: 50, actual: 40, income: false }]);
    expect(variance[0].favorable).toBe(true);
  });

  it("consolidates subsidiaries in full and reports the non-controlling share", () => {
    const pack = consolidateTrialBalances(
      [
        { name: "Parent", ownershipPercent: 100, rows: aggregateTrialBalance(lines) },
        {
          name: "Sub",
          ownershipPercent: 60,
          rows: aggregateTrialBalance([
            { accountId: "cash", code: "1100", name: "Cash", type: "ASSET", debit: 40, credit: 0 },
            { accountId: "eq", code: "3100", name: "Retained earnings", type: "EQUITY", debit: 0, credit: 30 },
            { accountId: "sales", code: "4100", name: "Sales", type: "INCOME", debit: 0, credit: 10 },
          ]),
        },
      ],
      [{ description: "Intercompany sale", lines: [{ code: "4100", debit: 5, credit: 0 }, { code: "1100", debit: 0, credit: 5 }] }],
    );
    expect(pack.rows.find((r) => r.code === "1100")?.debit).toBe(115);
    expect(pack.rows.find((r) => r.code === "4100")?.credit).toBe(85);
    expect(pack.totals.difference).toBe(0);
    expect(pack.nonControllingInterest[0]).toMatchObject({ netAssets: 40, equity: 16, profit: 4 });
    expect(pack.attribution.profit).toBe(65);
    expect(pack.attribution.profitToOwners).toBe(61);
    expect(() =>
      consolidateTrialBalances([], [{ description: "Bad", lines: [{ code: "1100", debit: 5, credit: 0 }, { code: "4100", debit: 0, credit: 4 }] }]),
    ).toThrow(/does not balance/);
  });

  it("converts foreign lines and measures revaluation", () => {
    const converted = convertJournalLines(
      [
        { accountId: "bank", debit: 1000, credit: 0 },
        { accountId: "sales", debit: 0, credit: 1000 },
      ],
      1300,
    );
    expect(converted[0]).toMatchObject({ debit: 1_300_000, amountForeign: 1000 });
    expect(converted[1]).toMatchObject({ credit: 1_300_000, amountForeign: -1000 });
    expect(revaluationDelta({ foreignBalance: 1000, bookFunctional: 1_300_000, closingRate: 1350 })).toBe(50_000);
    expect(revaluationDelta({ foreignBalance: -1000, bookFunctional: -1_300_000, closingRate: 1350 })).toBe(-50_000);
  });

  it("finds the next run of a cron schedule", () => {
    expect(nextCronTime("0 2 * * *", new Date("2026-03-10T01:30:00Z"))?.toISOString()).toBe("2026-03-10T02:00:00.000Z");
    expect(nextCronTime("0 2 * * *", new Date("2026-03-10T02:00:00Z"))?.toISOString()).toBe("2026-03-11T02:00:00.000Z");
    expect(nextCronTime("*/15 * * * *", new Date("2026-03-10T01:31:00Z"))?.toISOString()).toBe("2026-03-10T01:45:00.000Z");
    expect(nextCronTime("0 6 1 * *", new Date("2026-01-31T12:00:00Z"))?.toISOString()).toBe("2026-02-01T06:00:00.000Z");
    expect(nextCronTime("30 8 * * 1", new Date("2026-10-14T00:00:00Z"))?.toISOString()).toBe("2026-10-19T08:30:00.000Z");
    expect(() => parseCron("61 * * * *")).toThrow();
    expect(() => parseCron("daily")).toThrow();
  });

  it("forecasts, scores anomalies, and answers from books", () => {
    expect(linearForecast([10, 20, 30], 2)).toEqual([40, 50]);
    expect(anomalyScore(100, [10, 11, 9, 10]).flag).toBe(true);
    expect(esgIntensity(5, 100)).toBe(0.05);
    expect(answerFromBooks("what is profit?", { profit: 60, cash: 10, receivables: 0, payables: 0, currency: "RWF" })).toContain("60");
  });
});
