import { roundMoney } from "@exceledge/accounting-domain";
import { z } from "zod";
import { money } from "../../lib/documents";
import { mailConfigured } from "../../lib/mailer";
import { inTransaction, lockForTransaction, prisma } from "../../lib/prisma";
import { createInvoice } from "../ar/ar.service";
import { emailInvoice } from "../ar/customer-email.service";
import { notify } from "../notifications/notification.service";

const SYSTEM = { erpUserId: 0, erpRole: "SYSTEM" };
const DAY = 86_400_000;
/** A rule only acts near its day, so switching it on never chases a year of old invoices at once. */
const WINDOW_DAYS = 7;

/** Company preferences saved by the Sales settings screen; anything missing or odd means off. */
const settingsSchema = z.object({
  enabled: z.boolean().catch(false),
  days: z.string().catch("3, 10, 30"),
  message: z.string().max(1000).catch(""),
  lateFee: z.boolean().catch(false),
  lateFeeType: z.enum(["Percent of balance", "Fixed amount"]).catch("Percent of balance"),
  lateFeeValue: z.string().catch(""),
  lateFeeGrace: z.string().catch("30"),
});

export async function collectionSettings(companyId: string) {
  const row = await prisma.workspaceRecord.findFirst({ where: { companyId, collection: "settings", recordId: "sales-reminders", ownerErpUserId: 0 } });
  const values = ((row?.data as { values?: unknown } | null)?.values ?? {}) as object;
  const s = settingsSchema.parse(values);
  const days = [...new Set(s.days.split(/[,;\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= -30 && n <= 365))].sort((a, b) => a - b);
  const fee = Number(s.lateFeeValue.replace(/[,\s]/g, ""));
  const grace = Number(s.lateFeeGrace);
  return {
    reminders: s.enabled ? days : [],
    message: s.message.trim() || undefined,
    lateFee: s.lateFee && fee > 0 && (s.lateFeeType === "Fixed amount" || fee <= 100) && Number.isInteger(grace) && grace >= 0 ? { type: s.lateFeeType, value: fee, grace } : null,
  };
}

/**
 * One claim per invoice, kind and day; null when it was already taken. A send that failed may be tried again. One left
 * half-way by a crash is not: it may have gone out, and a missed reminder is better than two.
 */
async function claim(companyId: string, invoiceId: string, kind: string, day: number) {
  try {
    return await prisma.invoiceAction.create({ data: { companyId, invoiceId, kind, day, status: "SKIPPED" } });
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e;
    const retry = await prisma.invoiceAction.updateMany({ where: { invoiceId, kind, day, status: "FAILED" }, data: { status: "SKIPPED" } });
    return retry.count ? prisma.invoiceAction.findFirst({ where: { invoiceId, kind, day } }) : null;
  }
}

/** Sends due payment reminders and charges late fees, as the company's sales settings ask. Both are off by default. */
export async function runCollections(companyId: string, now = new Date()) {
  const settings = await collectionSettings(companyId);
  const out = { reminders: 0, lateFees: 0, failed: 0 };
  if (!settings.reminders.length && !settings.lateFee) return out;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const invoices = await prisma.arInvoice.findMany({
    where: { companyId, status: "POSTED", dueDate: { lte: new Date(today + 31 * DAY) } },
    include: { customer: { select: { email: true, name: true, status: true } } },
  });
  const canMail = mailConfigured();
  for (const invoice of invoices) {
    const outstanding = roundMoney(money(invoice.gross) - money(invoice.amountPaid) - money(invoice.amountCredited));
    if (outstanding <= 0.005) continue;
    const late = Math.floor((today - Date.UTC(invoice.dueDate.getUTCFullYear(), invoice.dueDate.getUTCMonth(), invoice.dueDate.getUTCDate())) / DAY);

    const due = settings.reminders.filter((d) => late >= d && late < d + WINDOW_DAYS).pop();
    if (due !== undefined && canMail && invoice.customer.email && invoice.customer.status === "ACTIVE") {
      const later = await prisma.invoiceAction.count({ where: { invoiceId: invoice.id, kind: "REMINDER", day: { gte: due }, status: { not: "FAILED" } } });
      const claimed = later ? null : await claim(companyId, invoice.id, "REMINDER", due);
      if (claimed) {
        try {
          await emailInvoice(companyId, invoice.id, { reminder: true, message: settings.message }, SYSTEM);
          await prisma.invoiceAction.update({ where: { id: claimed.id }, data: { status: "SENT", detail: invoice.customer.email } });
          out.reminders += 1;
        } catch (e) {
          await prisma.invoiceAction.update({ where: { id: claimed.id }, data: { status: "FAILED", detail: (e as Error).message.slice(0, 300) } });
          out.failed += 1;
        }
      }
    }

    const fee = settings.lateFee;
    if (fee && late >= fee.grace && late > 0 && late < fee.grace + WINDOW_DAYS && invoice.sourceDocumentType !== "CustomerOpening" && !invoice.description?.startsWith("Late fee on ")) {
      try {
        // The claim and the fee commit together, so a failure leaves it to be tried again tomorrow.
        const charged = await inTransaction(async () => {
          await lockForTransaction(`late-fee:${invoice.id}`);
          if (await prisma.invoiceAction.count({ where: { invoiceId: invoice.id, kind: "LATE_FEE" } })) return null;
          const fresh = await prisma.arInvoice.findFirst({ where: { id: invoice.id, status: "POSTED" } });
          const owed = fresh ? roundMoney(money(fresh.gross) - money(fresh.amountPaid) - money(fresh.amountCredited)) : 0;
          if (owed <= 0.005) return null;
          const amount = fee.type === "Fixed amount" ? fee.value : Math.round(owed * fee.value) / 100;
          if (!(amount > 0)) return null;
          const raised = await createInvoice(companyId, { customerId: invoice.customerId, invoiceDate: new Date(today), net: amount, currency: invoice.currency, description: `Late fee on ${invoice.invoiceNumber}` }, { ...SYSTEM, allowCreditOverride: true });
          await prisma.invoiceAction.create({ data: { companyId, invoiceId: invoice.id, kind: "LATE_FEE", day: fee.grace, status: "CHARGED", detail: raised.invoiceNumber } });
          return raised;
        });
        if (charged) out.lateFees += 1;
      } catch (e) {
        out.failed += 1;
        console.error(`[collections] late fee on ${invoice.invoiceNumber}`, e);
      }
    }
  }
  if (settings.reminders.length && !canMail) await notify({ companyId, title: "Payment reminders could not be sent", body: "Email isn't set up on the server.", severity: "WARNING" });
  if (out.reminders || out.lateFees || out.failed) {
    await notify({ companyId, title: "Payment reminders and late fees", body: `${out.reminders} reminder(s) sent, ${out.lateFees} late fee(s) charged${out.failed ? `, ${out.failed} failed` : ""}.`, severity: out.failed ? "WARNING" : "INFO", entityType: "ArInvoice" });
  }
  return out;
}

/** One daily notice naming stock at or below its reorder point. */
export async function lowStockAlert(companyId: string, now = new Date()) {
  const items = await prisma.inventoryItem.findMany({ where: { companyId, isActive: true, type: "INVENTORY", reorderPoint: { not: null } }, include: { balances: { select: { quantity: true } } } });
  const low = items.map((i) => ({ name: i.name, quantity: i.balances.reduce((s, b) => s + Number(b.quantity), 0), reorder: Number(i.reorderPoint) })).filter((i) => i.quantity <= i.reorder);
  if (!low.length) return 0;
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (await prisma.notification.count({ where: { companyId, title: "Low stock", createdAt: { gte: day } } })) return low.length;
  const named = low.slice(0, 5).map((i) => `${i.name} (${i.quantity} left, reorder at ${i.reorder})`).join("; ");
  await notify({ companyId, title: "Low stock", body: `${low.length} item(s) at or below reorder point: ${named}${low.length > 5 ? "; and more" : ""}.`, severity: "WARNING", entityType: "InventoryItem" });
  return low.length;
}
