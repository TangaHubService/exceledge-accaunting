import { roundMoney } from "@exceledge/accounting-domain";
import type { BankRule, Prisma } from "@prisma/client";
import { z } from "zod";
import { withJobLock } from "../../lib/job-lock";
import { inTransaction, prisma } from "../../lib/prisma";
import { audit, isoDay, type Actor } from "./banking.service";
import * as recon from "./reconciliation.service";

const condition = z
  .object({
    field: z.enum(["DESCRIPTION", "REFERENCE", "AMOUNT"]),
    op: z.enum(["CONTAINS", "NOT_CONTAINS", "EQUALS", "GREATER", "LESS"]),
    value: z.string().trim().min(1, "Enter a value").max(200),
  })
  .superRefine((c, ctx) => {
    const text = c.op === "CONTAINS" || c.op === "NOT_CONTAINS";
    if (c.field === "AMOUNT" && text) ctx.addIssue({ code: "custom", message: "Amounts use equals, greater than or less than" });
    if (c.field !== "AMOUNT" && (c.op === "GREATER" || c.op === "LESS")) ctx.addIssue({ code: "custom", message: "Text uses contains, doesn't contain or is exactly" });
    if (c.field === "AMOUNT" && !(Number.isFinite(Number(c.value)) && Number(c.value) >= 0)) ctx.addIssue({ code: "custom", message: "Enter the amount as a number" });
  });

export const ruleBody = z.object({
  name: z.string().trim().min(1, "Name the rule").max(80),
  priority: z.number().int().min(1).max(999),
  direction: z.enum(["IN", "OUT"]),
  financialAccountId: z.string().min(1).nullish(),
  matchAll: z.boolean().default(true),
  conditions: z.array(condition).min(1, "Add at least one condition").max(5, "Use up to 5 conditions"),
  splits: z
    .array(z.object({ accountId: z.string().min(1, "Choose a category"), percent: z.number().positive().max(100) }))
    .min(1, "Choose a category")
    .max(10)
    .refine((s) => Math.abs(s.reduce((t, x) => t + x.percent, 0) - 100) < 0.001, "Splits must add up to 100%"),
  payee: z.string().trim().max(200).nullish(),
  memo: z.string().trim().max(300).nullish(),
  keepMemo: z.boolean().default(false),
  autoPost: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type RuleInput = z.infer<typeof ruleBody>;
type Condition = RuleInput["conditions"][number];
type Line = { description: string; reference: string | null; amount: unknown; financialAccountId: string };
type Matcher = Pick<RuleInput, "direction" | "financialAccountId" | "matchAll" | "conditions">;

function meets(c: Condition, line: Line) {
  if (c.field === "AMOUNT") {
    const amount = roundMoney(Math.abs(Number(line.amount)));
    const value = roundMoney(Number(c.value));
    return c.op === "EQUALS" ? amount === value : c.op === "GREATER" ? amount > value : amount < value;
  }
  const text = ((c.field === "REFERENCE" ? line.reference : line.description) ?? "").toLowerCase();
  const value = c.value.toLowerCase();
  if (c.op === "EQUALS") return text.trim() === value;
  return text.includes(value) === (c.op === "CONTAINS");
}

export function ruleMatches(rule: Matcher, line: Line) {
  const amount = Number(line.amount);
  if (rule.direction === "IN" ? amount <= 0 : amount >= 0) return false;
  if (rule.financialAccountId && rule.financialAccountId !== line.financialAccountId) return false;
  if (!rule.conditions.length) return false;
  return rule.matchAll ? rule.conditions.every((c) => meets(c, line)) : rule.conditions.some((c) => meets(c, line));
}

const matcher = (r: BankRule): Matcher => ({ direction: r.direction as "IN" | "OUT", financialAccountId: r.financialAccountId, matchAll: r.matchAll, conditions: r.conditions as Condition[] });

async function assertReferences(companyId: string, input: RuleInput) {
  if (input.financialAccountId && !(await prisma.financialAccount.count({ where: { id: input.financialAccountId, companyId } }))) throw new Error("Choose a bank account of this company");
  const ids = [...new Set(input.splits.map((s) => s.accountId))];
  if ((await prisma.account.count({ where: { companyId, id: { in: ids } } })) !== ids.length) throw new Error("Choose categories from this company's chart of accounts");
}

const dataOf = (input: RuleInput) => ({
  ...input,
  financialAccountId: input.financialAccountId ?? null,
  payee: input.payee || null,
  memo: input.memo || null,
  conditions: input.conditions as Prisma.InputJsonValue,
  splits: input.splits as Prisma.InputJsonValue,
});

export async function listRules(companyId: string) {
  return prisma.bankRule.findMany({ where: { companyId }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
}

async function load(companyId: string, id: string) {
  const rule = await prisma.bankRule.findFirst({ where: { id, companyId } });
  if (!rule) throw new Error("Rule does not exist");
  return rule;
}

export async function createRule(companyId: string, input: RuleInput, actor: Actor = {}) {
  await assertReferences(companyId, input);
  const rule = await prisma.bankRule.create({ data: { ...dataOf(input), companyId, createdByErpUserId: actor.erpUserId } });
  await audit(companyId, actor, "CREATE", "BankRule", rule.id, input);
  return rule;
}

export async function updateRule(companyId: string, id: string, input: RuleInput, actor: Actor = {}) {
  const before = await load(companyId, id);
  await assertReferences(companyId, input);
  const rule = await prisma.bankRule.update({ where: { id }, data: dataOf(input) });
  await audit(companyId, actor, "UPDATE", "BankRule", id, input, before);
  return rule;
}

export async function deleteRule(companyId: string, id: string, actor: Actor = {}) {
  const before = await load(companyId, id);
  await prisma.bankRule.delete({ where: { id } });
  await audit(companyId, actor, "DELETE", "BankRule", id, null, before);
  return { deleted: true };
}

const openLines = (companyId: string, financialAccountId?: string | null) =>
  prisma.bankStatementLine.findMany({
    where: { companyId, matchId: null, ...(financialAccountId ? { financialAccountId } : {}) },
    orderBy: [{ transactionDate: "asc" }, { lineNumber: "asc" }],
    take: 2000,
  });

/** Unmatched statement lines a rule would categorise. Changes nothing. */
export async function previewRule(companyId: string, input: RuleInput) {
  const matches = (await openLines(companyId, input.financialAccountId)).filter((l) => ruleMatches(input, l));
  return {
    count: matches.length,
    lines: matches.slice(0, 50).map((l) => ({ id: l.id, date: isoDay(l.transactionDate), description: l.description, reference: l.reference, amount: Number(l.amount) })),
  };
}

/**
 * Posts the lines that rules match. A line whose amount is already in the books within a week is left for
 * matching instead, so a rule never records the same money twice.
 */
export async function applyRules(companyId: string, scope: { ruleId?: string; financialAccountId?: string }, actor: Actor = {}) {
  const result = await withJobLock(
    `bank-rules:${companyId}`,
    5 * 60_000,
    async () => {
      const all = (await listRules(companyId)).filter((r) => r.isActive);
      if (scope.ruleId && !all.some((r) => r.id === scope.ruleId)) {
        await load(companyId, scope.ruleId);
        throw new Error("This rule is turned off");
      }
      const out = { posted: 0, alreadyInBooks: 0, failed: [] as Array<{ lineId: string; description: string; error: string }> };
      for (const line of await openLines(companyId, scope.financialAccountId)) {
        // The highest-priority match decides, even when another rule was asked for.
        const rule = all.find((r) => ruleMatches(matcher(r), line));
        if (!rule || (scope.ruleId ? rule.id !== scope.ruleId : !rule.autoPost)) continue;
        try {
          const suggestions = await recon.suggestionsForLine(companyId, line.id);
          if (suggestions.some((s) => s.difference === 0 && Math.abs(s.days) <= 7)) {
            out.alreadyInBooks += 1;
            continue;
          }
          const description = rule.memo ? (rule.keepMemo ? `${rule.memo} — ${line.description}`.slice(0, 500) : rule.memo) : undefined;
          await inTransaction(() =>
            recon.recordStatementLine(companyId, line.id, { kind: "OTHER", splits: rule.splits as RuleInput["splits"], description, partyName: rule.payee ?? undefined }, actor),
          );
          out.posted += 1;
        } catch (e) {
          out.failed.push({ lineId: line.id, description: line.description, error: (e as Error).message });
        }
      }
      if (out.posted) await audit(companyId, actor, "APPLY_RULES", "BankRule", scope.ruleId ?? companyId, { posted: out.posted, failed: out.failed.length });
      return out;
    },
    { renew: true },
  );
  if (!result) throw new Error("Bank rules are already running for this company; try again shortly");
  return result;
}

export async function autoPostAfterImport(companyId: string, financialAccountId: string, actor: Actor = {}) {
  if (!(await prisma.bankRule.count({ where: { companyId, isActive: true, autoPost: true, OR: [{ financialAccountId: null }, { financialAccountId }] } }))) return null;
  return applyRules(companyId, { financialAccountId }, actor);
}
