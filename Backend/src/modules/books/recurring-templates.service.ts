import type { RecurringTemplate, Prisma } from "@prisma/client";
import { z } from "zod";
import { type Actor, HttpError, isoDay, notFound, optionalDay } from "../../lib/http";
import { documentLines } from "../../lib/http-documents";
import { withJobLock } from "../../lib/job-lock";
import { inTransaction, prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import * as ap from "../ap/ap.service";
import * as ar from "../ar/ar.service";
import { notify } from "../notifications/notification.service";

const DAY = 86_400_000;
const SYSTEM: Actor = { erpUserId: 0, erpRole: "SYSTEM" };

/** What to post each time, without dates: those come from the schedule. */
const common = { lines: documentLines, description: z.string().max(1000).optional(), dueInDays: z.number().int().min(0).max(365).default(0) };
const invoicePayload = z.object({ customerId: z.string().min(1), ...common });
const billPayload = z.object({ supplierId: z.string().min(1), ...common });

const KINDS = [
  "invoice", "estimate", "sales-order", "credit-note", "sales-receipt", "refund-receipt", "delayed-credit", "delayed-charge",
  "bill", "cheque", "supplier-credit", "credit-card-credit", "purchase-order", "bank-deposit", "transfer", "journal", "expense",
] as const;

export const templateBody = z
  .object({
    kind: z.enum(KINDS),
    name: z.string().trim().min(1, "Name the template").max(80),
    mode: z.enum(["SCHEDULED", "REMINDER", "UNSCHEDULED"]),
    interval: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
    every: z.number().int().min(1).max(99),
    startDate: isoDay,
    endDate: optionalDay,
    daysInAdvance: z.number().int().min(0).max(60).default(0),
    partyName: z.string().trim().max(200).nullish(),
    amount: z.number().min(0).max(1e13).nullish(),
    payload: z.record(z.string(), z.unknown()).nullish(),
    isActive: z.boolean().default(true),
  })
  .superRefine((t, ctx) => {
    if (t.endDate && t.endDate.slice(0, 10) <= t.startDate.slice(0, 10)) ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be after the start date" });
    if (t.mode !== "SCHEDULED") return;
    if (t.kind !== "invoice" && t.kind !== "bill") return void ctx.addIssue({ code: "custom", path: ["mode"], message: "Only invoices and bills can be created automatically; use a reminder" });
    const parsed = (t.kind === "invoice" ? invoicePayload : billPayload).safeParse(t.payload);
    if (!parsed.success) ctx.addIssue({ code: "custom", path: ["payload"], message: parsed.error.issues[0].message });
  });
export type TemplateInput = z.infer<typeof templateBody>;
type Can = (capability: "ar:manage" | "ap:manage" | "journal:create" | "bank:manage") => boolean;

const CAPABILITY = (kind: string) =>
  ["bill", "supplier-credit", "purchase-order"].includes(kind)
    ? ("ap:manage" as const)
    : ["cheque", "credit-card-credit", "bank-deposit", "transfer"].includes(kind)
      ? ("bank:manage" as const)
      : kind === "journal" || kind === "expense"
        ? ("journal:create" as const)
        : ("ar:manage" as const);

/** A template posts later without a person, so whoever saves it must be allowed to post that kind now. */
function assertMay(kind: string, can: Can) {
  const capability = CAPABILITY(kind);
  if (!can(capability)) throw new HttpError(403, `Missing capability: ${capability}`);
}

const utcDay = (d: string | Date) => new Date(`${(typeof d === "string" ? d : d.toISOString()).slice(0, 10)}T00:00:00.000Z`);

/** Date of the nth occurrence, always counted from the start so a 31st stays a month end. */
export function occurrence(start: Date, interval: string, every: number, n: number) {
  const step = every * n;
  if (interval === "DAILY" || interval === "WEEKLY") return new Date(start.getTime() + step * (interval === "DAILY" ? 1 : 7) * DAY);
  const months = interval === "YEARLY" ? step * 12 : step;
  const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, Math.min(start.getUTCDate(), last)));
}

function schedule(t: { mode: string; startDate: Date; endDate: Date | null; interval: string; every: number }, done: number) {
  if (t.mode === "UNSCHEDULED") return null;
  const next = occurrence(t.startDate, t.interval, t.every, done);
  return t.endDate && next > t.endDate ? null : next;
}

const view = (t: RecurringTemplate) => ({ ...t, amount: t.amount === null ? null : Number(t.amount) });

export async function listTemplates(companyId: string) {
  return (await prisma.recurringTemplate.findMany({ where: { companyId }, orderBy: { name: "asc" } })).map(view);
}

async function load(companyId: string, id: string) {
  const t = await prisma.recurringTemplate.findFirst({ where: { id, companyId } });
  if (!t) throw notFound("Recurring template");
  return t;
}

async function assertParty(companyId: string, input: TemplateInput) {
  if (input.mode !== "SCHEDULED") return;
  const p = input.payload as { customerId?: string; supplierId?: string };
  const found = input.kind === "invoice" ? await prisma.customer.count({ where: { id: p.customerId, companyId } }) : await prisma.supplier.count({ where: { id: p.supplierId, companyId } });
  if (!found) throw new Error(input.kind === "invoice" ? "Choose a customer of this company" : "Choose a supplier of this company");
}

const fieldsOf = (input: TemplateInput) => ({
  ...input,
  startDate: utcDay(input.startDate),
  endDate: input.endDate ? utcDay(input.endDate) : null,
  partyName: input.partyName || null,
  amount: input.amount ?? null,
  payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
});

const log = (companyId: string, actor: Actor, action: string, id: string, newValue: unknown) =>
  writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action, entityType: "RecurringTemplate", entityId: id, afterJson: newValue, ...actor.meta });

export async function createTemplate(companyId: string, input: TemplateInput, actor: Actor, can: Can) {
  assertMay(input.kind, can);
  await assertParty(companyId, input);
  const data = fieldsOf(input);
  const t = await prisma.recurringTemplate.create({ data: { ...data, companyId, nextDate: schedule(data, 0), createdByErpUserId: actor.erpUserId } });
  await log(companyId, actor, "CREATE", t.id, { kind: t.kind, name: t.name });
  return view(t);
}

export async function updateTemplate(companyId: string, id: string, input: TemplateInput, actor: Actor, can: Can) {
  const before = await load(companyId, id);
  assertMay(before.kind, can);
  if (input.kind !== before.kind) throw new Error("A template can't change its transaction type");
  await assertParty(companyId, input);
  const data = fieldsOf(input);
  // A changed schedule never reaches back to dates that already ran.
  let done = 0;
  if (before.previousDate) while (done < 40_000 && occurrence(data.startDate, data.interval, data.every, done) <= before.previousDate) done += 1;
  const t = await prisma.recurringTemplate.update({ where: { id }, data: { ...data, occurrences: done, nextDate: schedule(data, done), lastError: null } });
  await log(companyId, actor, "UPDATE", id, { name: t.name, isActive: t.isActive });
  return view(t);
}

export async function deleteTemplate(companyId: string, id: string, actor: Actor, can: Can) {
  const t = await load(companyId, id);
  assertMay(t.kind, can);
  await prisma.recurringTemplate.delete({ where: { id } });
  await log(companyId, actor, "DELETE", id, { name: t.name });
  return { deleted: true };
}

/** Creates the document (or reminder) for one date, and moves the template on, in one transaction. */
async function generate(companyId: string, id: string, date: Date, advance: boolean, actor: Actor) {
  return inTransaction(async () => {
    const t = await load(companyId, id);
    const day = date.toISOString().slice(0, 10);
    if (advance) {
      const done = t.occurrences + 1;
      const next = schedule(t, done);
      const moved = await prisma.recurringTemplate.updateMany({
        where: { id, isActive: true, nextDate: date, occurrences: t.occurrences },
        data: { occurrences: done, previousDate: date, nextDate: next, lastError: null },
      });
      if (!moved.count) throw new Error("This occurrence was already created");
    }
    let number: string | null = null;
    if (t.mode === "REMINDER" || (t.kind !== "invoice" && t.kind !== "bill")) {
      await notify({ companyId, title: `Recurring reminder: ${t.name}`, body: `Create the ${t.kind.replace(/-/g, " ")} dated ${day}.`, severity: "INFO", entityType: "RecurringTemplate", entityId: id });
    } else if (t.kind === "invoice") {
      const p = invoicePayload.parse(t.payload);
      const doc = await ar.createInvoice(companyId, { customerId: p.customerId, lines: p.lines, description: p.description, invoiceDate: day, dueDate: new Date(date.getTime() + p.dueInDays * DAY).toISOString().slice(0, 10) }, actor);
      number = doc.invoiceNumber;
    } else {
      const p = billPayload.parse(t.payload);
      const doc = await ap.createBill(companyId, { supplierId: p.supplierId, lines: p.lines, description: p.description, billDate: day, dueDate: new Date(date.getTime() + p.dueInDays * DAY).toISOString().slice(0, 10) }, actor);
      number = doc.billNumber;
    }
    await log(companyId, actor, "GENERATE", id, { day, number });
    return { date: day, number };
  });
}

/** "Use" on the list: creates one now, dated today, without touching the schedule. */
export async function useTemplate(companyId: string, id: string, actor: Actor, can: Can) {
  const t = await load(companyId, id);
  assertMay(t.kind, can);
  if (t.kind !== "invoice" && t.kind !== "bill") throw new Error("Open the form to create this transaction");
  if (!t.payload) throw new Error("This template has no saved transaction");
  return inTransaction(async () => {
    const today = utcDay(new Date());
    if (t.mode === "REMINDER") throw new Error("This template only reminds you; open the form to create the transaction");
    return generate(companyId, id, today, false, actor);
  });
}

export async function runDueTemplates(companyId: string, now = new Date()) {
  const summary = { created: 0, failed: 0 };
  await withJobLock(
    `recurring-templates:${companyId}`,
    5 * 60_000,
    async () => {
      const templates = await prisma.recurringTemplate.findMany({ where: { companyId, isActive: true, nextDate: { not: null } } });
      for (const template of templates) {
        let next = template.nextDate;
        // Catch up what was missed, a bounded number per run.
        for (let i = 0; i < 31 && next && next.getTime() - template.daysInAdvance * DAY <= now.getTime(); i += 1) {
          try {
            await generate(companyId, template.id, next, true, SYSTEM);
            summary.created += 1;
          } catch (e) {
            const message = (e as Error).message;
            summary.failed += 1;
            await prisma.recurringTemplate.updateMany({ where: { id: template.id }, data: { lastError: message.slice(0, 500) } });
            await notify({ companyId, title: `Recurring ${template.name} was not created`, body: message, severity: "WARNING", entityType: "RecurringTemplate", entityId: template.id });
            break;
          }
          next = (await prisma.recurringTemplate.findUnique({ where: { id: template.id }, select: { nextDate: true } }))?.nextDate ?? null;
        }
      }
    },
    { renew: true },
  );
  return summary;
}
