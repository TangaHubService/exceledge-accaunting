import { describe, expect, it } from "vitest";
import { calculatePayslip, monthlyPaye, payrollTotals } from "../src/services/payroll-calc.service";

describe("Rwanda payroll calculator", () => {
  it("applies the monthly PAYE bands", () => {
    expect(monthlyPaye(50_000)).toBe(0);
    expect(monthlyPaye(60_000)).toBe(0);
    expect(monthlyPaye(100_000)).toBe(4_000);
    expect(monthlyPaye(200_000)).toBe(24_000);
    expect(monthlyPaye(300_000)).toBe(54_000);
  });

  it("works out a payslip on basic salary only", () => {
    const slip = calculatePayslip({ basicSalary: 300_000 });
    expect(slip).toMatchObject({
      grossPay: 300_000,
      contributionBase: 300_000,
      paye: 54_000,
      employeePension: 18_000,
      employerPension: 18_000,
      occupationalHazard: 6_000,
      employeeMaternity: 900,
      employerMaternity: 900,
      cbhi: 1_136,
      netPay: 225_964,
      employerCost: 324_900,
    });
  });

  it("leaves the transport allowance out of RSSB but taxes it", () => {
    const slip = calculatePayslip({ basicSalary: 250_000, transportAllowance: 50_000 });
    expect(slip.grossPay).toBe(300_000);
    expect(slip.contributionBase).toBe(250_000);
    expect(slip.paye).toBe(54_000);
    expect(slip.employeePension).toBe(15_000);
    expect(slip.netPay).toBe(300_000 - 54_000 - 15_000 - 750 - 1_151);
  });

  it("rejects negative pay", () => {
    expect(() => calculatePayslip({ basicSalary: -1 })).toThrow();
  });

  it("totals balance the way Accounting posts them", () => {
    const slips = [calculatePayslip({ basicSalary: 300_000 }), calculatePayslip({ basicSalary: 80_000, housingAllowance: 20_000 })];
    const t = payrollTotals(slips);
    expect(t.employeeCount).toBe(2);
    expect(t.grossPay + t.employerRssb).toBe(t.paye + t.employeeRssb + t.employerRssb + t.cbhi + t.netPay);
    expect(t.employerCost).toBe(t.grossPay + t.employerRssb);
  });
});
