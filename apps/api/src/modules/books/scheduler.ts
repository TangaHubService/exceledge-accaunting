import { claimOnce, withJobLock } from "../../lib/job-lock";
import { inTransaction, prisma } from "../../lib/prisma";
import * as expenses from "../expense/expense.service";
import { openStartedPeriods } from "../journals/journal.service";
import { automationDue, runAutomation, runRecurring } from "./books.service";

const SYSTEM = { erpUserId: 0, erpRole: "SYSTEM" };

async function notifyFailure(companyId: string, title: string, error: unknown) {
  await prisma.notification.create({
    data: { companyId, title, body: (error as Error).message, severity: "WARNING" },
  });
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

/**
 * One scheduler tick. A lease keeps a second API instance from running the same tick, and the
 * daily work is claimed per day so a restart does not repeat it.
 */
export async function runScheduledWork(now = new Date()) {
  return withJobLock("scheduler", 10 * 60_000, async () => {
    const activations = await prisma.accountingActivation.findMany({ where: { status: "ACTIVATED" }, select: { companyId: true } });
    const today = now.toISOString().slice(0, 10);
    const daily = await claimOnce(`daily:${today}`, 26 * 3_600_000);
    if (daily) await prisma.jobLock.deleteMany({ where: { expiresAt: { lt: now } } });
    let automationRuns = 0;
    for (const { companyId } of activations) {
      try {
        if (daily) await runDailyWork(companyId, now);
        automationRuns += await runDueAutomation(companyId, now);
      } catch (e) {
        console.error(`[scheduler] company ${companyId}`, e);
      }
    }
    return { daily, automationRuns };
  });
}

export function startScheduler(intervalMs = 60_000) {
  return setInterval(() => {
    runScheduledWork().catch((e) => console.error("[scheduler]", e));
  }, intervalMs);
}
