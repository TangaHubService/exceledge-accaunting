import { claimOnce, withJobLock } from "../../lib/job-lock";
import { inTransaction, prisma } from "../../lib/prisma";
import * as expenses from "../expense/expense.service";
import { recordIntegrityScan } from "../integrity/integrity.service";
import { openStartedPeriods } from "../journals/journal.service";
import { deliverDueEmails } from "../notifications/email-outbox.service";
import { notify } from "../notifications/notification.service";
import { deliverDueWebhooks } from "../platform/webhook.service";
import { automationDue, purgeApiKeyUsage, runAutomation, runRecurring } from "./books.service";

const SYSTEM = { erpUserId: 0, erpRole: "SYSTEM" };

async function notifyFailure(companyId: string, title: string, error: unknown) {
  await notify({ companyId, title, body: (error as Error).message, severity: "WARNING" });
}

const DAY = 86_400_000;
const outstanding = (d: { gross: unknown; amountPaid: unknown; amountCredited: unknown }) =>
  Number(d.gross) - Number(d.amountPaid) - Number(d.amountCredited);
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Daily summaries of overdue receivables/payables and a heads-up for open periods ending within 3 days. */
export async function dailyAlerts(companyId: string, now: Date) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sent = { overdueInvoices: 0, overdueBills: 0, periodsEnding: 0 };

  const invoices = (
    await prisma.arInvoice.findMany({
      where: { companyId, status: "POSTED", dueDate: { lt: today } },
      select: { gross: true, amountPaid: true, amountCredited: true },
    })
  ).filter((d) => outstanding(d) > 0.005);
  if (invoices.length) {
    const total = invoices.reduce((s, d) => s + outstanding(d), 0);
    await notify({
      companyId,
      title: "Overdue customer invoices",
      body: `${invoices.length} invoice(s) are past due with ${money(total)} outstanding.`,
      severity: "WARNING",
      entityType: "ArInvoice",
    });
    sent.overdueInvoices = invoices.length;
  }

  const bills = (
    await prisma.apBill.findMany({
      where: { companyId, status: "POSTED", dueDate: { lt: today } },
      select: { gross: true, amountPaid: true, amountCredited: true },
    })
  ).filter((d) => outstanding(d) > 0.005);
  if (bills.length) {
    const total = bills.reduce((s, d) => s + outstanding(d), 0);
    await notify({
      companyId,
      title: "Overdue supplier bills",
      body: `${bills.length} bill(s) are past due with ${money(total)} unpaid.`,
      severity: "WARNING",
      entityType: "ApBill",
    });
    sent.overdueBills = bills.length;
  }

  const ending = await prisma.accountingPeriod.findMany({
    where: { financialYear: { companyId }, status: { in: ["OPEN", "REOPENED"] }, endDate: { gte: today, lt: new Date(today.getTime() + 3 * DAY) } },
  });
  for (const period of ending) {
    const already = await prisma.notification.count({ where: { companyId, entityType: "AccountingPeriod", entityId: period.id, title: "Period ending soon" } });
    if (already) continue;
    await notify({
      companyId,
      title: "Period ending soon",
      body: `${period.name} ends on ${period.endDate.toISOString().slice(0, 10)}. Post outstanding entries and prepare to close it.`,
      entityType: "AccountingPeriod",
      entityId: period.id,
    });
    sent.periodsEnding += 1;
  }
  return sent;
}

/** Opens started periods and runs due recurring journals and expenses, once per UTC day. */
async function runDailyWork(companyId: string, now: Date) {
  const summary = { periodsOpened: 0, recurringJournals: 0, recurringExpenses: 0 };
  summary.periodsOpened = await openStartedPeriods(companyId, now);

  if (await prisma.recurringJournal.count({ where: { companyId, isActive: true, nextRunDate: { lte: now } } })) {
    try {
      // Each pass posts one occurrence per template; repeat to catch up templates that fell behind.
      for (let pass = 0; pass < 31; pass++) {
        const result = await runRecurring(companyId, now, SYSTEM);
        summary.recurringJournals += result.generated;
        if (!result.generated || result.failed.length) break;
      }
    } catch (e) {
      await notifyFailure(companyId, "Recurring journals did not run", e);
    }
  }

  const dueExpenses = await prisma.recurringExpense.findMany({
    where: { companyId, isActive: true, nextRunDate: { lte: now } },
    select: { id: true, name: true },
  });
  for (const template of dueExpenses) {
    try {
      await inTransaction(() => expenses.runRecurring(companyId, template.id, SYSTEM));
      summary.recurringExpenses += 1;
    } catch (e) {
      await notifyFailure(companyId, `Recurring expense ${template.name} failed`, e);
    }
  }
  try {
    await dailyAlerts(companyId, now);
  } catch (e) {
    console.error(`[scheduler] alerts for ${companyId}`, e);
  }
  try {
    await recordIntegrityScan(companyId, "SCHEDULED", SYSTEM);
  } catch (e) {
    console.error(`[scheduler] integrity scan for ${companyId}`, e);
  }
  return summary;
}

async function runDueAutomation(companyId: string, now: Date) {
  const jobs = await prisma.automationJob.findMany({ where: { companyId, enabled: true } });
  let ran = 0;
  for (const job of jobs.filter((j) => automationDue(j, now))) {
    try {
      await runAutomation(companyId, job.id, SYSTEM);
      ran += 1;
    } catch (e) {
      await notifyFailure(companyId, `Automation ${job.name} failed`, e);
    }
  }
  return ran;
}

export const SCHEDULER_LOCK = "scheduler";
export const SCHEDULER_LEASE_MS = 5 * 60_000;

/**
 * One scheduler tick. A lease keeps a second API instance from running the same tick, and the
 * daily work is claimed per day so a restart does not repeat it. The lease is renewed while the
 * tick runs, so a slow tick keeps it and a crashed instance's lease frees up within 5 minutes.
 */
export async function runScheduledWork(now = new Date()) {
  return withJobLock(SCHEDULER_LOCK, SCHEDULER_LEASE_MS, async () => {
    const activations = await prisma.accountingActivation.findMany({ where: { status: "ACTIVATED" }, select: { companyId: true } });
    const today = now.toISOString().slice(0, 10);
    const daily = await claimOnce(`daily:${today}`, 26 * 3_600_000);
    if (daily) await prisma.jobLock.deleteMany({ where: { expiresAt: { lt: now } } });
    if (daily) await purgeApiKeyUsage(now).catch((e) => console.error("[scheduler] API key usage purge", e));
    let automationRuns = 0;
    for (const { companyId } of activations) {
      try {
        if (daily) await runDailyWork(companyId, now);
        automationRuns += await runDueAutomation(companyId, now);
      } catch (e) {
        console.error(`[scheduler] company ${companyId}`, e);
      }
    }
    const webhooks = await deliverDueWebhooks(now).catch((e) => (console.error("[scheduler] webhooks", e), null));
    const emails = await deliverDueEmails(now).catch((e) => (console.error("[scheduler] emails", e), null));
    return { daily, automationRuns, webhooks, emails };
  }, { renew: true });
}

export function startScheduler(intervalMs = 60_000) {
  return setInterval(() => {
    runScheduledWork().catch((e) => console.error("[scheduler]", e));
  }, intervalMs);
}
