import { roundMoney } from "@exceledge/accounting-domain";
import { z } from "zod";
import { controlAccounts, money } from "../../lib/documents";
import { HttpError, notFound } from "../../lib/http";
import { inTransaction, lockForTransaction, prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { createAndPostJournal } from "../journals/journal.service";
import { notify } from "../notifications/notification.service";

type Actor = { erpUserId?: number; erpRole?: string };
const SYSTEM: Actor = { erpUserId: 0, erpRole: "SYSTEM" };

export const spreadBody = z.object({
  kind: z.enum(["PREPAID", "DEFERRED", "ACCRUAL"]),
  name: z.string().trim().min(1, "Give it a name").max(120),
  debitAccountId: z.string().min(1),
  creditAccountId: z.string().min(1),
  total: z.number().positive().max(1e13),
  months: z.number().int().min(1, "At least one month").max(120, "At most 120 months"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a yyyy-mm-dd date"),
  costCentre: z.string().trim().max(80).optional(),
  project: z.string().trim().max(80).optional(),
});

/** What each side must be, so a schedule can't quietly move the wrong thing. */
const SIDES: Record<z.infer<typeof spreadBody>["kind"], { debit: string[]; credit: string[]; debitName: string; creditName: string }> = {
  PREPAID: { debit: ["EXPENSE", "COST_OF_SALES", "OTHER_EXPENSE"], credit: ["ASSET"], debitName: "an expense account", creditName: "a prepaid asset account" },
  DEFERRED: { debit: ["LIABILITY"], credit: ["INCOME", "OTHER_INCOME"], debitName: "a deferred income liability account", creditName: "an income account" },
  ACCRUAL: { debit: ["EXPENSE", "COST_OF_SALES", "OTHER_EXPENSE"], credit: ["LIABILITY"], debitName: "an expense account", creditName: "an accrued liability account" },
};

/** Equal months to the cent, with the remainder in the last one, so it always adds up to the total. */
export function portion(total: number, months: number, sequence: number) {
  const each = Math.floor((total / months) * 100) / 100;
  return sequence < months ? each : roundMoney(total - each * (months - 1));
}

/** The last day of the schedule's nth month. */
export const monthEnd = (start: Date, sequence: number) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + sequence, 0));

export async function createSpread(companyId: string, input: z.infer<typeof spreadBody>, actor: Actor) {
  const accounts = await prisma.account.findMany({ where: { companyId, id: { in: [input.debitAccountId, input.creditAccountId] }, isActive: true } });
  const debit = accounts.find((a) => a.id === input.debitAccountId);
  const credit = accounts.find((a) => a.id === input.creditAccountId);
  if (!debit || !credit) throw new Error("Choose active accounts");
  const side = SIDES[input.kind];
  if (!side.debit.includes(debit.type)) throw new Error(`The account charged each month must be ${side.debitName}`);
  if (!side.credit.includes(credit.type)) throw new Error(`The other account must be ${side.creditName}`);
  const controls = await controlAccounts(companyId);
  for (const a of [debit, credit]) {
    if (controls.has(a.id) || a.isCashAccount) throw new Error(`${a.code} ${a.name} can't be used here`);
    if (a.isTaxAccount) throw new Error(`${a.code} ${a.name} is a tax account and can't be used here`);
  }
  if (input.total / input.months < 0.01) throw new Error("The amount is too small for that many months");
  const row = await prisma.spreadSchedule.create({ data: { ...input, companyId, startDate: new Date(`${input.startDate}T00:00:00Z`), createdByErpUserId: actor.erpUserId } });
  await writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action: "CREATE", entityType: "SpreadSchedule", entityId: row.id, afterJson: { ...input } });
  return row;
}

export async function listSpreads(companyId: string) {
  const [rows, accounts] = await Promise.all([
    prisma.spreadSchedule.findMany({ where: { companyId }, include: { postings: { orderBy: { sequence: "asc" } } }, orderBy: { createdAt: "desc" }, take: 500 }),
    prisma.account.findMany({ where: { companyId }, select: { id: true, code: true, name: true } }),
  ]);
  const label = new Map(accounts.map((a) => [a.id, `${a.code} ${a.name}`]));
  return rows.map((r) => {
    const posted = roundMoney(r.postings.reduce((s, p) => s + money(p.amount), 0));
    return { ...r, total: money(r.total), debitAccount: label.get(r.debitAccountId) ?? "", creditAccount: label.get(r.creditAccountId) ?? "", posted, remaining: roundMoney(money(r.total) - posted), next: r.status === "ACTIVE" ? monthEnd(r.startDate, r.postings.length + 1) : null };
  });
}

export async function stopSpread(companyId: string, id: string, actor: Actor) {
  return inTransaction(async () => {
    await lockForTransaction(`spread:${id}`);
    const row = await prisma.spreadSchedule.findFirst({ where: { id, companyId } });
    if (!row) throw notFound("Schedule");
    if (row.status !== "ACTIVE") throw new HttpError(409, "This schedule is already finished");
    const after = await prisma.spreadSchedule.update({ where: { id }, data: { status: "STOPPED" } });
    await writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action: "STOP", entityType: "SpreadSchedule", entityId: id });
    return after;
  });
}

/** Posts one month if it is due. Each month is its own transaction, so one refusal leaves the others posted. */
async function postNext(companyId: string, id: string, now: Date, actor: Actor) {
  return inTransaction(async () => {
    await lockForTransaction(`spread:${id}`);
    const s = await prisma.spreadSchedule.findFirst({ where: { id, companyId, status: "ACTIVE" }, include: { _count: { select: { postings: true } } } });
    if (!s) return false;
    const sequence = s._count.postings + 1;
    const date = monthEnd(s.startDate, sequence);
    if (sequence > s.months || date > now) return false;
    const amount = portion(money(s.total), s.months, sequence);
    const journal = await createAndPostJournal(
      companyId,
      {
        journalDate: date,
        journalType: "AUTOMATIC",
        description: `${s.name} (${sequence} of ${s.months})`,
        sourceModule: "SPREAD",
        sourceDocumentType: "SpreadSchedule",
        sourceDocumentId: s.id,
        sourceDocumentNumber: `${sequence}/${s.months}`,
        costCentre: s.costCentre ?? undefined,
        project: s.project ?? undefined,
        status: "APPROVED",
        lines: [
          { accountId: s.debitAccountId, description: s.name, debit: amount, credit: 0 },
          { accountId: s.creditAccountId, description: s.name, debit: 0, credit: amount },
        ],
      },
      actor,
    );
    await prisma.spreadPosting.create({ data: { scheduleId: s.id, sequence, date, amount, journalId: journal.id } });
    await prisma.spreadSchedule.update({ where: { id: s.id }, data: { lastError: null, ...(sequence === s.months ? { status: "DONE" } : {}) } });
    return true;
  });
}

export async function runSpreads(companyId: string, now = new Date(), actor: Actor = SYSTEM) {
  const out = { posted: 0, failed: 0 };
  for (const s of await prisma.spreadSchedule.findMany({ where: { companyId, status: "ACTIVE" }, select: { id: true, name: true, lastError: true } })) {
    try {
      for (let i = 0; i < 120 && (await postNext(companyId, s.id, now, actor)); i++) out.posted += 1;
    } catch (e) {
      out.failed += 1;
      const error = (e as Error).message.slice(0, 300);
      await prisma.spreadSchedule.update({ where: { id: s.id }, data: { lastError: error } });
      if (error !== s.lastError) await notify({ companyId, title: "A spread schedule could not post", body: `${s.name}: ${error}`, severity: "WARNING", entityType: "SpreadSchedule", entityId: s.id });
    }
  }
  return out;
}
