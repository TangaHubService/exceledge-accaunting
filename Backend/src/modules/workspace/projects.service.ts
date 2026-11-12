import { roundMoney } from "@exceledge/accounting-domain";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { type Actor, clientId, HttpError, notFound, optionalDay, optionalText, toDate } from "../../lib/http";
import { inTransaction, prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";

const audit = (companyId: string, actor: Actor, action: string, entityType: string, entityId: string, afterJson?: unknown) =>
  writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action, entityType, entityId, afterJson, ...actor.meta });

export const projectBody = z.object({
  name: z.string().trim().min(1, "Enter a project name").max(100),
  code: optionalText(40),
  customerId: z.string().min(1).nullish(),
  customerName: optionalText(200),
  customerAddress: optionalText(1000),
  email: optionalText(200),
  startDate: optionalDay,
  endDate: optionalDay,
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELED"]).default("NOT_STARTED"),
  notes: optionalText(4000),
  progress: z.number().int().min(0).max(100).default(0),
  starred: z.boolean().default(false),
  budget: z.number().min(0).nullish(),
  customFields: z.array(z.object({ name: z.string().max(100), value: z.string().max(500) })).max(50).nullish(),
});

async function nextCode(companyId: string) {
  const rows = await prisma.$queryRaw<Array<{ top: number | null }>>`
    SELECT MAX(code::numeric)::float8 AS top FROM "projects" WHERE "companyId" = ${companyId} AND code ~ '^[0-9]{1,15}$'`;
  return String(rows[0]?.top != null ? rows[0].top + 1 : 1001);
}

/** Creates or replaces a project under the browser's id, and keeps its PROJECT dimension in step so journals can carry it. */
export async function saveProject(companyId: string, id: string, input: z.infer<typeof projectBody>, actor: Actor) {
  clientId.parse(id);
  return inTransaction(async () => {
    const existing = await prisma.project.findUnique({ where: { id } });
    if (existing && existing.companyId !== companyId) throw notFound("Project");
    if (input.customerId && !(await prisma.customer.findFirst({ where: { id: input.customerId, companyId } }))) throw new Error("Choose an existing customer");
    const start = toDate(input.startDate);
    const end = toDate(input.endDate);
    if (start && end && end < start) throw new Error("The end date can't be before the start date");
    const code = input.code ?? existing?.code ?? (await nextCode(companyId));
    if (existing && existing.code !== code) throw new HttpError(409, "A project's code can't change; journals are tagged with it");
    const data = {
      name: input.name,
      customerId: input.customerId ?? null,
      customerName: input.customerName,
      customerAddress: input.customerAddress,
      email: input.email,
      startDate: start,
      endDate: end,
      status: input.status,
      notes: input.notes,
      progress: input.progress,
      starred: input.starred,
      budget: input.budget ?? null,
      customFields: (input.customFields ?? []) as Prisma.InputJsonValue,
    };
    const row = existing
      ? await prisma.project.update({ where: { id }, data })
      : await prisma.project.create({ data: { id, companyId, code, createdByErpUserId: actor.erpUserId, ...data } });
    await prisma.dimension.upsert({
      where: { companyId_kind_code: { companyId, kind: "PROJECT", code } },
      create: { companyId, kind: "PROJECT", code, name: input.name },
      update: { name: input.name, isActive: input.status !== "CANCELED" },
    });
    await audit(companyId, actor, existing ? "UPDATE" : "CREATE", "Project", id, { code, name: input.name, status: input.status });
    return row;
  });
}

export const listProjects = (companyId: string) => prisma.project.findMany({ where: { companyId }, orderBy: [{ starred: "desc" }, { createdAt: "desc" }] });

export async function getProject(companyId: string, id: string) {
  const row = await prisma.project.findFirst({ where: { id, companyId } });
  if (!row) throw notFound("Project");
  return row;
}

/** A project with posted journal lines stays for the audit trail; it can only be cancelled. */
export async function deleteProject(companyId: string, id: string, actor: Actor) {
  return inTransaction(async () => {
    const row = await getProject(companyId, id);
    const posted = await prisma.journalLine.count({ where: { project: row.code, journal: { companyId } } });
    if (posted) throw new HttpError(409, "This project has posted transactions; mark it canceled instead");
    await prisma.project.delete({ where: { id } });
    await prisma.dimension.updateMany({ where: { companyId, kind: "PROJECT", code: row.code }, data: { isActive: false } });
    await audit(companyId, actor, "DELETE", "Project", id, { code: row.code });
    return { id };
  });
}

/* ── Tagging records to a project ─────────────────────────────────────────────── */

/** Screen kinds that have a posted journal, and where to find it. */
const JOURNAL_SOURCES: Record<string, (companyId: string, id: string) => Promise<{ journalId?: string | null } | null>> = {
  invoice: (companyId, id) => prisma.arInvoice.findFirst({ where: { id, companyId }, select: { journalId: true } }),
  bill: (companyId, id) => prisma.apBill.findFirst({ where: { id, companyId }, select: { journalId: true } }),
  expense: (companyId, id) => prisma.expense.findFirst({ where: { id, companyId }, select: { journalId: true } }),
  journal: async (companyId, id) => {
    const j = await prisma.journal.findFirst({ where: { id, companyId }, select: { id: true } });
    return j && { journalId: j.id };
  },
};

const SOURCE_EXISTS: Record<string, (companyId: string, id: string) => Promise<unknown>> = {
  ...JOURNAL_SOURCES,
  estimate: (companyId, id) => prisma.commercialDocument.findFirst({ where: { id, companyId, kind: "ESTIMATE" } }),
  proposal: (companyId, id) => prisma.commercialDocument.findFirst({ where: { id, companyId, kind: "PROPOSAL" } }),
  "sales-order": (companyId, id) => prisma.commercialDocument.findFirst({ where: { id, companyId, kind: "SALES_ORDER" } }),
  "delayed-charge": (companyId, id) => prisma.commercialDocument.findFirst({ where: { id, companyId, kind: "DELAYED_CHARGE" } }),
  "delayed-credit": (companyId, id) => prisma.commercialDocument.findFirst({ where: { id, companyId, kind: "DELAYED_CREDIT" } }),
  "purchase-order": (companyId, id) => prisma.commercialDocument.findFirst({ where: { id, companyId, kind: "PURCHASE_ORDER" } }),
  payment: (companyId, id) => prisma.arReceipt.findFirst({ where: { id, companyId } }),
  "bill-payment": (companyId, id) => prisma.apPayment.findFirst({ where: { id, companyId } }),
  "credit-note": (companyId, id) => prisma.arCreditNote.findFirst({ where: { id, companyId } }),
  "supplier-credit": (companyId, id) => prisma.apCreditNote.findFirst({ where: { id, companyId } }),
  "item-receipt": (companyId, id) => prisma.itemReceipt.findFirst({ where: { id, companyId } }),
  "inventory-adjustment": (companyId, id) => prisma.inventoryAdjustment.findFirst({ where: { id, companyId } }),
  cheque: (companyId, id) => prisma.bankTransaction.findFirst({ where: { id, companyId } }),
  "bank-deposit": (companyId, id) => prisma.bankTransaction.findFirst({ where: { id, companyId } }),
  transfer: (companyId, id) => prisma.bankTransaction.findFirst({ where: { id, companyId } }),
  "credit-card-credit": (companyId, id) => prisma.bankTransaction.findFirst({ where: { id, companyId } }),
  "credit-card-payment": (companyId, id) => prisma.bankTransaction.findFirst({ where: { id, companyId } }),
  "sales-receipt": (companyId, id) => prisma.arInvoice.findFirst({ where: { id, companyId } }),
  "refund-receipt": (companyId, id) => prisma.bankTransaction.findFirst({ where: { id, companyId } }),
};

/** Screen kinds that are really another record, so tagging reaches its journal. */
const SAME_RECORD_AS: Record<string, string> = { "sales-receipt": "invoice" };

export const linkBody = z.object({ links: z.array(z.object({ kind: z.string().min(1).max(40), sourceId: z.string().min(1).max(64) })).min(1).max(200) });

/** Income and expense lines carry the project so its profit comes from the GL; balance-sheet lines don't. */
async function tagJournal(companyId: string, kind: string, sourceId: string, code: string | null) {
  const source = await JOURNAL_SOURCES[SAME_RECORD_AS[kind] ?? kind]?.(companyId, sourceId);
  if (!source?.journalId) return;
  await prisma.journalLine.updateMany({
    where: { journalId: source.journalId, journal: { companyId }, account: { type: { in: ["INCOME", "EXPENSE", "COST_OF_SALES", "OTHER_INCOME", "OTHER_EXPENSE"] } } },
    data: { project: code },
  });
}

export async function linkTransactions(companyId: string, projectId: string, links: z.infer<typeof linkBody>["links"], actor: Actor) {
  return inTransaction(async () => {
    const project = await getProject(companyId, projectId);
    for (const { kind, sourceId } of links) {
      const exists = SOURCE_EXISTS[kind];
      if (!exists) throw new Error(`Records of type ${kind} can't be tagged to a project`);
      if (!(await exists(companyId, sourceId))) throw notFound(`${kind} record`);
      await prisma.projectLink.upsert({
        where: { companyId_kind_sourceId: { companyId, kind, sourceId } },
        create: { companyId, projectId, kind, sourceId },
        update: { projectId },
      });
      await tagJournal(companyId, kind, sourceId, project.code);
    }
    await audit(companyId, actor, "LINK", "Project", projectId, { links });
    return { linked: links.length };
  });
}

export async function unlinkTransaction(companyId: string, projectId: string, kind: string, sourceId: string, actor: Actor) {
  return inTransaction(async () => {
    await getProject(companyId, projectId);
    const removed = await prisma.projectLink.deleteMany({ where: { companyId, projectId, kind, sourceId } });
    if (removed.count) await tagJournal(companyId, kind, sourceId, null);
    await audit(companyId, actor, "UNLINK", "Project", projectId, { kind, sourceId });
    return { removed: removed.count };
  });
}

/** Actual income and costs from posted GL lines, budget use, and estimates from documents that don't post. */
export async function projectFinancials(companyId: string, id: string) {
  const project = await getProject(companyId, id);
  const lines = await prisma.journalLine.findMany({
    where: { project: project.code, journal: { companyId, status: "POSTED" } },
    select: { debit: true, credit: true, account: { select: { type: true } } },
  });
  let income = 0;
  let costs = 0;
  for (const line of lines) {
    const type = line.account.type;
    const debit = Number(line.debit);
    const credit = Number(line.credit);
    if (type === "OTHER_INCOME" || type === "INCOME") income += credit - debit;
    else if (type === "EXPENSE" || type === "COST_OF_SALES" || type === "OTHER_EXPENSE") costs += debit - credit;
  }
  const documents = await prisma.commercialDocument.findMany({
    where: { companyId, projectId: id, status: { notIn: ["VOID", "DECLINED", "CONVERTED"] } },
    select: { kind: true, total: true },
  });
  const estimatedIncome = documents.filter((d) => d.kind === "ESTIMATE" || d.kind === "PROPOSAL").reduce((sum, d) => sum + Number(d.total), 0);
  const estimatedCosts = documents.filter((d) => d.kind === "PURCHASE_ORDER").reduce((sum, d) => sum + Number(d.total), 0);
  const time = await prisma.timeActivity.aggregate({ where: { companyId, projectId: id }, _sum: { durationMinutes: true } });
  const budget = project.budget === null ? null : Number(project.budget);
  return {
    projectId: id,
    code: project.code,
    income: roundMoney(income),
    costs: roundMoney(costs),
    profit: roundMoney(income - costs),
    estimatedIncome: roundMoney(estimatedIncome),
    estimatedCosts: roundMoney(estimatedCosts),
    timeMinutes: time._sum.durationMinutes ?? 0,
    budget,
    budgetRemaining: budget === null ? null : roundMoney(budget - costs),
    budgetUsedPct: budget ? Math.round((costs / budget) * 1000) / 10 : null,
  };
}

/* ── Tasks ────────────────────────────────────────────────────────────────────── */

export const taskBody = z.object({
  name: z.string().trim().min(1, "Enter a task name").max(200),
  description: optionalText(4000),
  assignee: optionalText(200),
  dueDate: optionalDay,
  priority: z.enum(["", "LOW", "MEDIUM", "HIGH"]).nullish().transform((v) => v || null),
  recurring: z.boolean().default(false),
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).nullish(),
  links: z.array(z.object({ id: z.string().max(64), label: z.string().max(200) })).max(50).nullish(),
  files: z.array(z.object({ name: z.string().max(200), size: z.number().min(0) })).max(50).nullish(),
  done: z.boolean().default(false),
  projectId: z.string().min(1).nullish(),
});

export const listTasks = (companyId: string) => prisma.task.findMany({ where: { companyId }, orderBy: [{ done: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }], take: 1000 });

export async function saveTask(companyId: string, id: string, input: z.infer<typeof taskBody>, actor: Actor) {
  clientId.parse(id);
  const existing = await prisma.task.findUnique({ where: { id } });
  if (existing && existing.companyId !== companyId) throw notFound("Task");
  if (input.projectId && !(await prisma.project.findFirst({ where: { id: input.projectId, companyId } }))) throw new Error("Choose an existing project");
  const data = {
    name: input.name,
    description: input.description,
    assignee: input.assignee,
    dueDate: toDate(input.dueDate),
    priority: input.priority,
    recurring: input.recurring,
    frequency: input.frequency ?? null,
    links: (input.links ?? []) as Prisma.InputJsonValue,
    files: (input.files ?? []) as Prisma.InputJsonValue,
    done: input.done,
    projectId: input.projectId ?? null,
  };
  const row = existing ? await prisma.task.update({ where: { id }, data }) : await prisma.task.create({ data: { id, companyId, createdByErpUserId: actor.erpUserId, ...data } });
  await audit(companyId, actor, existing ? "UPDATE" : "CREATE", "Task", id, { name: input.name, done: input.done });
  return row;
}

export async function deleteTask(companyId: string, id: string, actor: Actor) {
  const removed = await prisma.task.deleteMany({ where: { id, companyId } });
  if (!removed.count) throw notFound("Task");
  await audit(companyId, actor, "DELETE", "Task", id);
  return { id };
}
