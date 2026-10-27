/**
 * Rwanda monthly payroll: PAYE, RSSB pension, occupational hazards, maternity leave, and CBHI.
 * Rates live in one table so a law change is a new entry, and each run records the version it used.
 */
export const RWANDA_PAYROLL_RULES = {
  version: "RW-2025-01",
  /** Monthly PAYE bands: income up to `upTo` is taxed at `rate` (the last band has no ceiling). */
  payeBands: [
    { upTo: 60_000, rate: 0 },
    { upTo: 100_000, rate: 0.1 },
    { upTo: 200_000, rate: 0.2 },
    { upTo: Infinity, rate: 0.3 },
  ],
  employeePension: 0.06,
  employerPension: 0.06,
  occupationalHazard: 0.02,
  employeeMaternity: 0.003,
  employerMaternity: 0.003,
  /** Community-based health insurance, on net pay after PAYE and employee RSSB. */
  cbhi: 0.005,
} as const;

export type PayrollRules = typeof RWANDA_PAYROLL_RULES;

export type PayInput = {
  basicSalary: number;
  housingAllowance?: number;
  transportAllowance?: number;
  otherAllowance?: number;
};

export type PayslipFigures = {
  basicSalary: number;
  housingAllowance: number;
  transportAllowance: number;
  otherAllowance: number;
  grossPay: number;
  contributionBase: number;
  paye: number;
  employeePension: number;
  employerPension: number;
  occupationalHazard: number;
  employeeMaternity: number;
  employerMaternity: number;
  cbhi: number;
  netPay: number;
  employerCost: number;
};

const francs = (n: number) => Math.round(n);

export function monthlyPaye(taxable: number, rules: PayrollRules = RWANDA_PAYROLL_RULES): number {
  let tax = 0;
  let floor = 0;
  for (const band of rules.payeBands) {
    if (taxable <= floor) break;
    tax += (Math.min(taxable, band.upTo) - floor) * band.rate;
    floor = band.upTo;
  }
  return francs(tax);
}

/** RSSB contributions are charged on gross pay excluding the transport allowance. */
export function calculatePayslip(input: PayInput, rules: PayrollRules = RWANDA_PAYROLL_RULES): PayslipFigures {
  const basicSalary = francs(input.basicSalary);
  const housingAllowance = francs(input.housingAllowance ?? 0);
  const transportAllowance = francs(input.transportAllowance ?? 0);
  const otherAllowance = francs(input.otherAllowance ?? 0);
  if ([basicSalary, housingAllowance, transportAllowance, otherAllowance].some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error("Salary and allowances must be zero or more");
  }
  const grossPay = basicSalary + housingAllowance + transportAllowance + otherAllowance;
  const contributionBase = grossPay - transportAllowance;

  const paye = monthlyPaye(grossPay, rules);
  const employeePension = francs(contributionBase * rules.employeePension);
  const employerPension = francs(contributionBase * rules.employerPension);
  const occupationalHazard = francs(contributionBase * rules.occupationalHazard);
  const employeeMaternity = francs(contributionBase * rules.employeeMaternity);
  const employerMaternity = francs(contributionBase * rules.employerMaternity);
  const beforeCbhi = grossPay - paye - employeePension - employeeMaternity;
  const cbhi = francs(Math.max(0, beforeCbhi) * rules.cbhi);
  const netPay = beforeCbhi - cbhi;
  const employerCost = grossPay + employerPension + occupationalHazard + employerMaternity;

  return {
    basicSalary,
    housingAllowance,
    transportAllowance,
    otherAllowance,
    grossPay,
    contributionBase,
    paye,
    employeePension,
    employerPension,
    occupationalHazard,
    employeeMaternity,
    employerMaternity,
    cbhi,
    netPay,
    employerCost,
  };
}

export type PayrollTotals = {
  employeeCount: number;
  grossPay: number;
  paye: number;
  employeeRssb: number;
  employerRssb: number;
  cbhi: number;
  netPay: number;
  employerCost: number;
};

/** Run totals as Accounting posts them: RSSB groups pension, hazards and maternity by who pays. */
export function payrollTotals(slips: PayslipFigures[]): PayrollTotals {
  const sum = (pick: (s: PayslipFigures) => number) => slips.reduce((t, s) => t + pick(s), 0);
  return {
    employeeCount: slips.length,
    grossPay: sum((s) => s.grossPay),
    paye: sum((s) => s.paye),
    employeeRssb: sum((s) => s.employeePension + s.employeeMaternity),
    employerRssb: sum((s) => s.employerPension + s.occupationalHazard + s.employerMaternity),
    cbhi: sum((s) => s.cbhi),
    netPay: sum((s) => s.netPay),
    employerCost: sum((s) => s.employerCost),
  };
}
