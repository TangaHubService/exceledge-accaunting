import { describe, expect, it } from "vitest";

describe("Dashboard Date Range (#6)", () => {
  it("presets are supported by parseDateRange", async () => {
    const { parseDateRange } = await import("../../src/controllers/dashboard.controller");
    const presets = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "this_year"];
    for (const preset of presets) {
      const result = parseDateRange({ preset } as any);
      expect(result.startDate).toBeInstanceOf(Date);
      expect(result.endDate).toBeInstanceOf(Date);
      expect(result.startDate.getTime()).toBeLessThanOrEqual(result.endDate.getTime());
    }
  });

  it("handles startDate/endDate params", async () => {
    const { parseDateRange } = await import("../../src/controllers/dashboard.controller");
    const result = parseDateRange({ startDate: "2026-07-01", endDate: "2026-07-15" } as any);
    expect(result.startDate).toBeInstanceOf(Date);
    expect(result.endDate).toBeInstanceOf(Date);
    expect(result.startDate.getTime()).toBeLessThan(result.endDate.getTime());
  });

  it("returns valid dates for empty query", async () => {
    const { parseDateRange } = await import("../../src/controllers/dashboard.controller");
    const result = parseDateRange({} as any);
    expect(result.startDate).toBeInstanceOf(Date);
    expect(result.endDate).toBeInstanceOf(Date);
    expect(result.startDate.getTime()).toBeLessThan(result.endDate.getTime());
  });
});
