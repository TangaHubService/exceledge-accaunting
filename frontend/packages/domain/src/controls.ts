/** Wave B: approval levels, posting-date policies, document numbering formats. */

export interface ApprovalTier {
  minAmount: number;
  levels: number;
  roles?: string[];
}

export interface ApprovalPlan {
  levels: number;
  roles: string[];
}

export const MAX_APPROVAL_LEVELS = 5;

/** Validates `amountBasedApprovalLimits` as stored in setup; null or empty means "no tiers". */
export function parseApprovalTiers(value: unknown): ApprovalTier[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Amount-based approval limits must be a list of tiers");
  const tiers = value.map((raw, i) => {
    const t = raw as Partial<ApprovalTier>;
    const minAmount = Number(t?.minAmount);
    const levels = Number(t?.levels);
    if (!Number.isFinite(minAmount) || minAmount < 0) throw new Error(`Tier ${i + 1}: minAmount must be zero or more`);
    if (!Number.isInteger(levels) || levels < 0 || levels > MAX_APPROVAL_LEVELS) {
      throw new Error(`Tier ${i + 1}: levels must be a whole number from 0 to ${MAX_APPROVAL_LEVELS}`);
    }
    const roles = (t.roles ?? []).map((r) => String(r).trim().toUpperCase());
    if (roles.length > levels) throw new Error(`Tier ${i + 1}: ${roles.length} roles given for ${levels} level(s)`);
    if (roles.some((r) => !r)) throw new Error(`Tier ${i + 1}: roles cannot be blank`);
    return { minAmount, levels, roles };
  });
  if (new Set(tiers.map((t) => t.minAmount)).size !== tiers.length) throw new Error("Two approval tiers have the same minAmount");
  return tiers.sort((a, b) => a.minAmount - b.minAmount);
}

/**
 * How many approvals an amount needs and which role decides each level. Tiers win when present:
 * the tier with the highest minAmount at or below the amount applies, and amounts below every
 * tier need none. Without tiers, `approvalLevels` applies to everything.
 */
export function approvalPlan(input: {
  amount: number;
  enabled: boolean;
  approvalLevels: number;
  tiers: ApprovalTier[];
  /** Raises the plan to at least one level, e.g. a backdated journal under a REQUIRE_APPROVAL policy. */
  forceApproval?: boolean;
}): ApprovalPlan {
  let plan: ApprovalPlan = { levels: 0, roles: [] };
  if (input.enabled) {
    if (input.tiers.length) {
      const tier = [...input.tiers].reverse().find((t) => input.amount >= t.minAmount);
      if (tier) plan = { levels: tier.levels, roles: tier.roles ?? [] };
    } else {
      plan = { levels: Math.min(Math.max(Math.trunc(input.approvalLevels), 0), MAX_APPROVAL_LEVELS), roles: [] };
    }
  }
  if (input.forceApproval && plan.levels < 1) plan = { levels: 1, roles: plan.roles };
  return plan;
}

/** Role required at a 1-based level, or null when any approver may decide it. */
export function roleForLevel(roles: string[], level: number): string | null {
  return roles[level - 1] || null;
}

export type DatePolicy = "ALLOW" | "REQUIRE_APPROVAL" | "BLOCK";
export const DATE_POLICIES: DatePolicy[] = ["ALLOW", "REQUIRE_APPROVAL", "BLOCK"];

export function asDatePolicy(value: string | null | undefined, fallback: DatePolicy): DatePolicy {
  const v = (value ?? "").toUpperCase();
  return (DATE_POLICIES as string[]).includes(v) ? (v as DatePolicy) : fallback;
}

const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * BACKDATED: before the start of the period that contains today (or before today when no period
 * covers it). FUTURE: after today. Days are compared in UTC.
 */
export function transactionTiming(date: Date, today: Date, currentPeriodStart?: Date | null): "BACKDATED" | "CURRENT" | "FUTURE" {
  const day = utcDay(date);
  if (day > utcDay(today)) return "FUTURE";
  if (day < utcDay(currentPeriodStart ?? today)) return "BACKDATED";
  return "CURRENT";
}

export type ResetFrequency = "NEVER" | "YEARLY" | "MONTHLY";
export const RESET_FREQUENCIES: ResetFrequency[] = ["NEVER", "YEARLY", "MONTHLY"];

export interface NumberFormat {
  prefix: string;
  includeYear: boolean;
  includeMonth: boolean;
  includeBranch: boolean;
  sequenceLength: number;
  resetFrequency: string;
}

/** A counter that resets must have its period in the number, or numbers would repeat. */
export function assertNumberFormat(format: NumberFormat) {
  if (!format.prefix.trim()) throw new Error("A numbering prefix is required");
  if (!/^[A-Za-z0-9_/]+$/.test(format.prefix)) throw new Error("A numbering prefix may only contain letters, digits, _ and /");
  if (!Number.isInteger(format.sequenceLength) || format.sequenceLength < 3 || format.sequenceLength > 10) {
    throw new Error("The sequence length must be between 3 and 10 digits");
  }
  if (!(RESET_FREQUENCIES as string[]).includes(format.resetFrequency)) throw new Error("Reset frequency must be NEVER, YEARLY or MONTHLY");
  if (format.includeMonth && !format.includeYear) throw new Error("Include the year when the number includes the month");
  if (format.resetFrequency === "YEARLY" && !format.includeYear) throw new Error("A yearly reset needs the year in the number");
  if (format.resetFrequency === "MONTHLY" && !(format.includeYear && format.includeMonth)) {
    throw new Error("A monthly reset needs the year and month in the number");
  }
}

export function numberPeriodKey(resetFrequency: string, date: Date): string {
  const year = String(date.getUTCFullYear());
  if (resetFrequency === "YEARLY") return year;
  if (resetFrequency === "MONTHLY") return `${year}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  return "ALL";
}

/** e.g. JE-2026-03-HQ-000042 */
export function formatDocumentNumber(format: NumberFormat, n: number, date: Date, branchCode?: string | null): string {
  const parts = [format.prefix];
  if (format.includeYear) parts.push(String(date.getUTCFullYear()));
  if (format.includeYear && format.includeMonth) parts.push(String(date.getUTCMonth() + 1).padStart(2, "0"));
  if (format.includeBranch && branchCode) parts.push(branchCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase());
  parts.push(String(n).padStart(format.sequenceLength, "0"));
  return parts.join("-");
}

export interface DimensionMovement {
  key: string;
  type: string;
  debit: number;
  credit: number;
}

const INCOME = new Set(["INCOME", "OTHER_INCOME"]);
const EXPENSES = new Set(["COST_OF_SALES", "EXPENSE", "OTHER_EXPENSE"]);
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Profit and loss per dimension value; balance-sheet movements only count in debit/credit. */
export function dimensionProfitAndLoss(rows: DimensionMovement[]) {
  const groups = new Map<string, { key: string; income: number; expenses: number; profit: number; debit: number; credit: number }>();
  for (const row of rows) {
    const g = groups.get(row.key) ?? { key: row.key, income: 0, expenses: 0, profit: 0, debit: 0, credit: 0 };
    g.debit = round4(g.debit + row.debit);
    g.credit = round4(g.credit + row.credit);
    if (INCOME.has(row.type)) g.income = round4(g.income + row.credit - row.debit);
    if (EXPENSES.has(row.type)) g.expenses = round4(g.expenses + row.debit - row.credit);
    g.profit = round4(g.income - g.expenses);
    groups.set(row.key, g);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}
