import { z } from "zod";
import { notFound } from "../../lib/http";
import { mailConfigured, sendMail } from "../../lib/mailer";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { notify } from "../notifications/notification.service";

type Actor = { erpUserId?: number; erpRole?: string };

/** Each trigger is something the audit trail already records, so every way of doing it counts. */
export const TRIGGERS: Record<string, { label: string; entityType: string; action: string; kind?: string }> = {
  INVOICE_POSTED: { label: "An invoice is posted", entityType: "ArInvoice", action: "POST" },
  INVOICE_EDITED: { label: "An invoice is corrected", entityType: "ArInvoice", action: "UPDATE" },
  INVOICE_VOIDED: { label: "An invoice is voided", entityType: "ArInvoice", action: "VOID" },
  PAYMENT_RECEIVED: { label: "A customer payment is recorded", entityType: "ArReceipt", action: "POST" },
  CREDIT_NOTE_POSTED: { label: "A credit note is posted", entityType: "ArCreditNote", action: "POST" },
  REFUND_PAID: { label: "A customer is refunded", entityType: "ArRefund", action: "POST" },
  BILL_POSTED: { label: "A supplier bill is posted", entityType: "ApBill", action: "POST" },
  SUPPLIER_PAID: { label: "A supplier is paid", entityType: "ApPayment", action: "POST" },
  PURCHASE_ORDER_CREATED: { label: "A purchase order is created", entityType: "CommercialDocument", action: "CREATE", kind: "PURCHASE_ORDER" },
  JOURNAL_REVERSED: { label: "A journal is reversed", entityType: "Journal", action: "REVERSE" },
};

export const ruleBody = z
  .object({
    name: z.string().trim().min(1, "Name the rule").max(120),
    trigger: z.string().refine((t) => Object.prototype.hasOwnProperty.call(TRIGGERS, t), "Choose what starts the rule"),
    minAmount: z.number().min(0).nullish(),
    action: z.enum(["NOTIFY", "EMAIL"]),
    target: z.string().trim().min(1).max(200),
    message: z.string().trim().max(1000).nullish(),
    isActive: z.boolean().default(true),
  })
  .superRefine((r, ctx) => {
    if (r.action === "EMAIL" && !z.string().email().safeParse(r.target).success) ctx.addIssue({ code: "custom", path: ["target"], message: "Enter one valid email address" });
    if (r.action === "NOTIFY" && !["ADMIN", "ACCOUNTANT", "BRANCH_MANAGER", "SELLER"].includes(r.target)) ctx.addIssue({ code: "custom", path: ["target"], message: "Choose who to notify" });
  });

export async function listRules(companyId: string) {
  const rows = await prisma.workflowRule.findMany({ where: { companyId }, include: { _count: { select: { runs: true } }, runs: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" } });
  return { triggers: Object.entries(TRIGGERS).map(([value, t]) => ({ value, label: t.label })), rules: rows.map(({ runs, _count, ...r }) => ({ ...r, minAmount: r.minAmount == null ? null : Number(r.minAmount), times: _count.runs, last: runs[0] ?? null })) };
}

export async function saveRule(companyId: string, id: string | null, input: z.infer<typeof ruleBody>, actor: Actor) {
  const before = id ? await prisma.workflowRule.findFirst({ where: { id, companyId } }) : null;
  if (id && !before) throw notFound("Rule");
  // Switching on, or watching for something else, starts from now rather than from the past.
  const restart = !before || before.trigger !== input.trigger || (!before.isActive && input.isActive);
  const data = { ...input, minAmount: input.minAmount ?? null, message: input.message ?? null, ...(restart ? { activeFrom: new Date() } : {}) };
  const row = before ? await prisma.workflowRule.update({ where: { id: before.id }, data }) : await prisma.workflowRule.create({ data: { ...data, companyId, createdByErpUserId: actor.erpUserId } });
  await writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action: before ? "UPDATE" : "CREATE", entityType: "WorkflowRule", entityId: row.id, beforeJson: before ?? undefined, afterJson: row });
  return row;
}

export async function deleteRule(companyId: string, id: string, actor: Actor) {
  const gone = await prisma.workflowRule.deleteMany({ where: { id, companyId } });
  if (!gone.count) throw notFound("Rule");
  await writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action: "DELETE", entityType: "WorkflowRule", entityId: id });
  return { id };
}

const amountOf = (json: unknown) => {
  const j = (json ?? {}) as Record<string, unknown>;
  for (const k of ["gross", "total", "amount"]) if (Number.isFinite(Number(j[k])) && j[k] != null) return Number(j[k]);
  return null;
};
const numberOf = (json: unknown) => {
  const j = (json ?? {}) as Record<string, unknown>;
  return String(j.invoiceNumber ?? j.receiptNumber ?? j.creditNoteNumber ?? j.refundNumber ?? j.billNumber ?? j.paymentNumber ?? j.journalNumber ?? j.number ?? "");
};

/** The document's rate to the company's currency, so a threshold means the same for every document. */
async function rateOf(companyId: string, entityType: string, id: string | null) {
  if (!id) return 1;
  const q = { where: { id, companyId }, select: { exchangeRate: true } };
  const row =
    entityType === "ArInvoice" ? await prisma.arInvoice.findFirst(q)
    : entityType === "ArReceipt" ? await prisma.arReceipt.findFirst(q)
    : entityType === "ArCreditNote" ? await prisma.arCreditNote.findFirst(q)
    : entityType === "ApBill" ? await prisma.apBill.findFirst(q)
    : entityType === "ApPayment" ? await prisma.apPayment.findFirst(q)
    : null;
  return row ? Number(row.exchangeRate) : 1;
}

/** How far back to look: long enough for a slow transaction's event to appear, and for a restart. */
const LOOK_BACK_MS = 24 * 3_600_000;

/** Runs after each scheduler tick. One run per rule and event, whoever gets there first. */
export async function runWorkflowRules(companyId: string, now = new Date()) {
  const out = { sent: 0, failed: 0 };
  const rules = await prisma.workflowRule.findMany({ where: { companyId, isActive: true } });
  for (const rule of rules) {
    const t = TRIGGERS[rule.trigger];
    if (!t) continue;
    const since = new Date(Math.max(rule.activeFrom.getTime(), now.getTime() - LOOK_BACK_MS));
    const events = await prisma.auditEvent.findMany({ where: { companyId, entityType: t.entityType, action: t.action, createdAt: { gte: since } }, orderBy: { createdAt: "asc" }, take: 500 });
    const done = new Set((await prisma.workflowRuleRun.findMany({ where: { ruleId: rule.id, auditEventId: { in: events.map((e) => e.id) } }, select: { auditEventId: true } })).map((r) => r.auditEventId));
    for (const e of events) {
      if (done.has(e.id)) continue;
      if (t.kind && (e.afterJson as { kind?: string } | null)?.kind !== t.kind) continue;
      // A void records what it was worth in the before side.
      const raw = amountOf(e.afterJson) ?? amountOf(e.beforeJson);
      const amount = raw === null ? null : raw * (await rateOf(companyId, t.entityType, e.entityId));
      if (rule.minAmount != null && (amount === null || amount < Number(rule.minAmount))) continue;
      let run;
      try {
        // Taken first, so a message is never sent twice.
        run = await prisma.workflowRuleRun.create({ data: { ruleId: rule.id, auditEventId: e.id, status: "FAILED", detail: "Started" } });
      } catch (err) {
        if ((err as { code?: string }).code === "P2002") continue;
        throw err;
      }
      const what = [t.label.replace(/^An? /, "").replace(/^./, (c) => c.toUpperCase()), numberOf(e.afterJson), amount === null ? "" : amount.toLocaleString("en-US")].filter(Boolean).join(" · ");
      try {
        if (rule.action === "EMAIL") {
          if (!mailConfigured()) throw new Error("Email isn't set up on the server");
          await sendMail({ to: rule.target, subject: `${rule.name}: ${what}`, text: [rule.message, what].filter(Boolean).join("\n\n") });
        } else await notify({ companyId, title: rule.name, body: [what, rule.message].filter(Boolean).join(". "), targetRole: rule.target, entityType: t.entityType, entityId: e.entityId ?? undefined });
        await prisma.workflowRuleRun.update({ where: { id: run.id }, data: { status: "SENT", detail: null } });
        out.sent += 1;
      } catch (err) {
        await prisma.workflowRuleRun.update({ where: { id: run.id }, data: { detail: (err as Error).message.slice(0, 300) } });
        out.failed += 1;
      }
    }
  }
  return out;
}
