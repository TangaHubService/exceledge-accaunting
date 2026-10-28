import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  changedKeys,
  findDuplicates,
  forecastVsActual,
  isRoundAmount,
  kpiPack,
  kpiTargetMet,
  monthRange,
  normalizeReference,
  outsideWorkingHours,
  periodFromQuestion,
  riskRating,
  riskScore,
  scenarioForecast,
  topicOfQuestion,
} from "./insights";

const base = {
  days: 365,
  revenue: 1_000_000,
  costOfSales: 600_000,
  grossProfit: 400_000,
  profit: 100_000,
  depreciation: 30_000,
  interest: 10_000,
  incomeTax: 20_000,
  totalAssets: 800_000,
  totalEquity: 500_000,
  currentAssets: 400_000,
  currentLiabilities: 200_000,
  inventory: 150_000,
  receivables: 100_000,
  payables: 60_000,
  cash: 120_000,
};

const kpi = (code: string, input = base) => kpiPack(input).find((k) => k.code === code)!;

describe("KPI pack", () => {
  it("computes EBITDA, returns, liquidity and working-capital days", () => {
    expect(kpi("EBITDA").value).toBe(160_000);
    expect(kpi("EBITDA_MARGIN").value).toBe(0.16);
    expect(kpi("ROA").value).toBe(0.125);
    expect(kpi("ROE").value).toBe(0.2);
    expect(kpi("CURRENT_RATIO").value).toBe(2);
    expect(kpi("QUICK_RATIO").value).toBe(1.25);
    expect(kpi("WORKING_CAPITAL").value).toBe(200_000);
    expect(kpi("DSO").value).toBe(36.5);
    expect(kpi("DPO").value).toBe(36.5);
    expect(kpi("INVENTORY_TURNOVER").value).toBe(4);
    expect(kpi("DAYS_INVENTORY").value).toBe(91.25);
    expect(kpi("CASH_CONVERSION_CYCLE").value).toBe(91.25);
  });

  it("returns null instead of dividing by zero, and no ROE on negative equity", () => {
    const empty = { ...base, revenue: 0, costOfSales: 0, currentLiabilities: 0, inventory: 0, totalEquity: -10 };
    for (const code of ["GROSS_MARGIN", "DSO", "DPO", "CURRENT_RATIO", "INVENTORY_TURNOVER", "ROE", "CASH_CONVERSION_CYCLE"]) {
      expect(kpi(code, empty).value, code).toBeNull();
    }
  });

  it("compares with targets in the right direction", () => {
    expect(kpiTargetMet(40, 45, false)).toBe(true);
    expect(kpiTargetMet(50, 45, false)).toBe(false);
    expect(kpiTargetMet(1.5, 2, true)).toBe(false);
    expect(kpiTargetMet(null, 2, true)).toBeNull();
  });
});

describe("Scenario forecast", () => {
  const history = {
    months: ["2026-01", "2026-02", "2026-03"],
    revenue: [100, 110, 120],
    expenses: [80, 85, 90],
    cashMovement: [10, 20, 30],
    closingCash: 500,
  };

  it("extends each trend and scales it per scenario, carrying cash forward", () => {
    const f = scenarioForecast(history, 2);
    expect(f.BASE.map((m) => m.month)).toEqual(["2026-04", "2026-05"]);
    expect(f.BASE[0]).toMatchObject({ revenue: 130, expenses: 95, profit: 35, cashMovement: 40, closingCash: 540 });
    expect(f.BASE[1].closingCash).toBe(590);
    expect(f.BEST[0].revenue).toBe(143);
    expect(f.WORST[0].expenses).toBe(99.75);
    // Worst profit is 110.5 - 99.75 = 10.75, 24.25 below base, so cash moves 40 - 24.25.
    expect(f.WORST[0].cashMovement).toBe(15.75);
  });

  it("never forecasts negative revenue or expenses", () => {
    const falling = { ...history, revenue: [300, 200, 100] };
    expect(scenarioForecast(falling, 3).BASE.every((m) => m.revenue >= 0)).toBe(true);
  });

  it("compares completed months with actuals and leaves later months open", () => {
    const f = scenarioForecast(history, 2).BASE;
    const rows = forecastVsActual(f, new Map([["2026-04", { revenue: 140, expenses: 100 }]]), "2026-04");
    expect(rows[0]).toMatchObject({ actualProfit: 40, profitVariance: 5, profitVariancePercent: 0.1429 });
    expect(rows[1].actualProfit).toBeNull();
  });

  it("lists months across a year end", () => {
    expect(monthRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("Anomaly rules", () => {
  it("treats large whole multiples as round amounts", () => {
    expect(isRoundAmount(500_000)).toBe(true);
    expect(isRoundAmount(-1_200_000)).toBe(true);
    expect(isRoundAmount(50_000)).toBe(false);
    expect(isRoundAmount(512_345)).toBe(false);
  });

  it("flags weekends and late or early hours in the company's time zone", () => {
    expect(outsideWorkingHours(new Date("2026-03-07T10:00:00Z"), "Africa/Kigali")).toBe("on a Saturday");
    expect(outsideWorkingHours(new Date("2026-03-05T19:30:00Z"), "Africa/Kigali")).toBe("at 21:00 local time");
    expect(outsideWorkingHours(new Date("2026-03-05T08:00:00Z"), "Africa/Kigali")).toBeNull();
  });

  it("matches references that differ only in formatting", () => {
    expect(normalizeReference("INV-0042")).toBe(normalizeReference("inv 42"));
    expect(normalizeReference("INV-0042")).not.toBe(normalizeReference("INV-420"));
  });

  it("reports each later duplicate once, per party", () => {
    const d = (id: string, partyId: string, amount: number, day: number, reference?: string) => ({ id, partyId, amount, date: new Date(Date.UTC(2026, 0, day)), reference });
    const found = findDuplicates(
      [d("a", "s1", 1000, 1, "A-1"), d("b", "s1", 1000, 5, "B-7"), d("c", "s1", 1000, 30, "C-9"), d("e", "s1", 50, 40, "a 1"), d("f", "s2", 1000, 2)],
      7,
    );
    expect(found).toEqual([
      { id: "b", duplicateOf: "a", reason: "has the same amount within 7 days as" },
      { id: "e", duplicateOf: "a", reason: "has the same reference as" },
    ]);
  });
});

describe("Assistant periods and topics", () => {
  const today = new Date("2026-10-15T12:00:00Z");
  const fy = { start: new Date("2026-07-01T00:00:00Z"), end: new Date("2027-06-30T23:59:59.999Z") };
  const day = (d: Date) => d.toISOString().slice(0, 10);

  it("reads relative and named periods", () => {
    const last = periodFromQuestion("profit last month?", today)!;
    expect([day(last.from), day(last.to), last.label]).toEqual(["2026-09-01", "2026-09-30", "September 2026"]);
    const ytd = periodFromQuestion("revenue this year", today, fy)!;
    expect(day(ytd.from)).toBe("2026-07-01");
    const prior = periodFromQuestion("profit last financial year", today, fy)!;
    expect([day(prior.from), day(prior.to)]).toEqual(["2025-07-01", "2026-06-30"]);
    const q = periodFromQuestion("sales in Q2 2026", today)!;
    expect([day(q.from), day(q.to)]).toEqual(["2026-04-01", "2026-06-30"]);
    const nov = periodFromQuestion("expenses in November", today)!;
    expect(day(nov.from)).toBe("2025-11-01");
    expect(day(periodFromQuestion("cash at end of 2025", today)!.to)).toBe("2025-12-31");
    expect(periodFromQuestion("how much cash do we have", today)).toBeNull();
    expect(periodFromQuestion("may I see profit", today)).toBeNull();
  });

  it("finds the topic", () => {
    expect(topicOfQuestion("How much cash do we have?")).toBe("CASH");
    expect(topicOfQuestion("Which customers are overdue?")).toBe("OVERDUE");
    expect(topicOfQuestion("What is our gross margin")).toBe("MARGIN");
    expect(topicOfQuestion("what are our biggest expenses")).toBe("TOP_EXPENSES");
    expect(topicOfQuestion("how much do we owe suppliers")).toBe("PAYABLES");
    expect(topicOfQuestion("hello")).toBe("SUMMARY");
  });
});

describe("Signatures and risks", () => {
  it("produces the same canonical text whatever the key order", () => {
    expect(canonicalJson({ b: 1, a: { d: new Date("2026-01-01T00:00:00Z"), c: undefined } })).toBe('{"a":{"d":"2026-01-01T00:00:00.000Z"},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(changedKeys({ a: 1, b: [1, 2] }, { a: 1, b: [1, 3], c: 0 })).toEqual(["b", "c"]);
  });

  it("scores and rates risks", () => {
    expect(riskRating(riskScore(5, 5))).toBe("CRITICAL");
    expect(riskRating(riskScore(3, 4))).toBe("HIGH");
    expect(riskRating(riskScore(1, 4))).toBe("LOW");
    expect(() => riskScore(0, 3)).toThrow(/likelihood/);
  });
});
