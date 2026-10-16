import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { controlAccounts, money } from "../../lib/documents";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { reconciliation as inventoryReconciliation } from "../inventory/inventory.service";
import { notify } from "../notifications/notification.service";

export type Actor = { erpUserId?: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } };

export const INTEGRITY_CHECKS = {
  AR_SUBLEDGER: "Receivables ledger vs GL",
  AP_SUBLEDGER: "Payables ledger vs GL",
  INVENTORY_SUBLEDGER: "Inventory valuation vs GL",
  DOCUMENT_WITHOUT_GL: "Documents without a posted journal",
  UNBALANCED_JOURNAL: "Unbalanced or mismatched journals",
  JOURNAL_NUMBER_GAP: "Journal number gaps",
  NEGATIVE_CASH: "Negative cash and bank balances",
} as const;
export type IntegrityCheck = keyof typeof INTEGRITY_CHECKS;

export type IntegrityFinding = {
  check: IntegrityCheck;
  severity: "ERROR" | "WARNING";
  message: string;
  details: Record<string, unknown>;
};

const TOLERANCE = 0.01;
const LIMIT = 50;
const NOTIFY_ROLES = ["ADMIN", "ACCOUNTANT"];
const KEEP_DAYS = 90;

const fmt = (n: number) => n.toFixed(2);
const round = (n: number) => Math.round(n * 100) / 100;

async function glNet(companyId: string, accountIds: string[]) {
  if (!accountIds.length) return 0;
  const sum = await prisma.glEntry.aggregate({ where: { companyId, accountId: { in: accountIds } }, _sum: { debit: true, credit: true } });
  return money(sum._sum.debit) - money(sum._sum.credit);
}

async function partyLedgers(companyId: string): Promise<IntegrityFinding[]> {
  const controls = await controlAccounts(companyId);
  const of = (kind: string) => [...controls].filter(([, k]) => k === kind).map(([id]) => id);
  const payablesIds = of("payables");
  const [arGl, apGl, ar, ap, payableOutsideBills] = await Promise.all([
    glNet(companyId, of("receivables")),
    glNet(companyId, payablesIds),
    prisma.arLedgerEntry.aggregate({ where: { companyId }, _sum: { debit: true, credit: true } }),
    prisma.apLedgerEntry.aggregate({ where: { companyId }, _sum: { debit: true, credit: true } }),
    // Expenses on account and fixed-asset purchases can credit the AP control without a supplier bill.
    payablesIds.length
      ? prisma.glEntry.aggregate({
          where: {
            companyId,
            accountId: { in: payablesIds },
            OR: [{ sourceModule: "EXPENSE" }, { sourceModule: "FIXED_ASSETS" }, { journal: { sourceDocumentType: { in: ["Expense", "FIXED_ASSET"] } } }],
          },
          _sum: { debit: true, credit: true },
        })
      : Promise.resolve({ _sum: { debit: null, credit: null } }),
  ]);
  const findings: IntegrityFinding[] = [];
  const compare = (check: IntegrityCheck, label: string, gl: number, ledger: number, explained?: { amount: number; note: string }) => {
    const difference = round(gl - ledger);
    if (Math.abs(difference) <= TOLERANCE) return;
    const remaining = explained ? round(difference - explained.amount) : difference;
    const explainedAway = explained && Math.abs(remaining) <= TOLERANCE;
    findings.push({
      check,
      severity: explainedAway ? "WARNING" : "ERROR",
      message: explainedAway
        ? `${label} control accounts show ${fmt(gl)} vs ledger ${fmt(ledger)} (difference ${fmt(difference)}), explained by ${explained.note}.`
        : `${label} control accounts show ${fmt(gl)} but the ${label.toLowerCase()} ledger totals ${fmt(ledger)} (difference ${fmt(difference)}${
            explained && Math.abs(explained.amount) > TOLERANCE ? `; ${fmt(explained.amount)} from ${explained.note}` : ""
          }).`,
      details: {
        glBalance: round(gl),
        subledgerBalance: round(ledger),
        difference,
        ...(explained ? { explainedByNonBillPayables: round(explained.amount), unexplained: remaining } : {}),
      },
    });
  };
  compare("AR_SUBLEDGER", "Receivables", arGl, money(ar._sum.debit) - money(ar._sum.credit));
  // Payables are credit-positive on both sides. Credits from expenses/FA without a bill explain part of a GL surplus.
  const nonBillPayables = round(money(payableOutsideBills._sum.credit) - money(payableOutsideBills._sum.debit));
  compare(
    "AP_SUBLEDGER",
    "Payables",
    -apGl,
    money(ap._sum.credit) - money(ap._sum.debit),
    Math.abs(nonBillPayables) > TOLERANCE
      ? { amount: nonBillPayables, note: "expenses on account and fixed-asset purchases posted to payables without a supplier bill" }
      : undefined,
  );
  return findings;
}

async function inventory(companyId: string): Promise<IntegrityFinding[]> {
  const rec = await inventoryReconciliation(companyId);
  if (Math.abs(rec.difference) <= TOLERANCE) return [];
  const unposted = rec.explained.unpostedMovements.value;
  const unexplained = round(rec.difference + unposted - rec.explained.saleCostDifference);
  return [
    {
      check: "INVENTORY_SUBLEDGER",
      severity: Math.abs(unexplained) > TOLERANCE ? "ERROR" : "WARNING",
      message: `Inventory accounts show ${fmt(rec.glValue)} but the valuation totals ${fmt(rec.subledgerValue)} (difference ${fmt(rec.difference)}${
        Math.abs(unexplained) > TOLERANCE ? `, ${fmt(unexplained)} unexplained` : ", explained by unposted movements or sale costs"
      }).`,
      details: {
        glBalance: rec.glValue,
        subledgerBalance: rec.subledgerValue,
        difference: rec.difference,
        unpostedMovements: rec.explained.unpostedMovements,
        saleCostDifference: rec.explained.saleCostDifference,
        unexplained,
      },
    },
  ];
}

async function documentsWithoutGl(companyId: string): Promise<IntegrityFinding[]> {
  const rows = await prisma.$queryRaw<Array<{ type: string; id: string; number: string; journalId: string | null; journalStatus: string | null }>>`
    SELECT d.* FROM (
      SELECT 'ArInvoice' AS "type", i."id", i."invoiceNumber" AS "number", i."journalId", i."gross" AS "amount" FROM "ar_invoices" i WHERE i."companyId" = ${companyId}
      UNION ALL SELECT 'ArReceipt', r."id", r."receiptNumber", r."journalId", r."amount" FROM "ar_receipts" r WHERE r."companyId" = ${companyId}
      UNION ALL SELECT 'ArCreditNote', c."id", c."creditNoteNumber", c."journalId", c."gross" FROM "ar_credit_notes" c WHERE c."companyId" = ${companyId}
      UNION ALL SELECT 'ApBill', b."id", b."billNumber", b."journalId", b."gross" FROM "ap_bills" b WHERE b."companyId" = ${companyId} AND b."status" IN ('POSTED', 'REVERSED')
      UNION ALL SELECT 'ApPayment', p."id", p."paymentNumber", p."journalId", p."amount" FROM "ap_payments" p WHERE p."companyId" = ${companyId} AND p."status" IN ('POSTED', 'REVERSED')
      UNION ALL SELECT 'ApCreditNote', n."id", n."creditNoteNumber", n."journalId", n."gross" FROM "ap_credit_notes" n WHERE n."companyId" = ${companyId} AND n."status" IN ('POSTED', 'REVERSED')
      UNION ALL SELECT 'ArDebitNote', a."id", a."debitNoteNumber", a."journalId", a."gross" FROM "ar_debit_notes" a WHERE a."companyId" = ${companyId}
      UNION ALL SELECT 'ApDebitNote', s."id", s."debitNoteNumber", s."journalId", s."gross" FROM "ap_debit_notes" s WHERE s."companyId" = ${companyId} AND s."status" IN ('POSTED', 'REVERSED')
    ) d
    LEFT JOIN "journals" j ON j."id" = d."journalId" AND j."companyId" = ${companyId}
    WHERE d."amount" <> 0 AND (j."id" IS NULL OR j."status" NOT IN ('POSTED', 'REVERSED'))
    ORDER BY d."type", d."number"
    LIMIT ${LIMIT}`;
  return rows.map((r) => ({
    check: "DOCUMENT_WITHOUT_GL" as const,
    severity: "ERROR" as const,
    message: r.journalId ? `${r.type} ${r.number} points to a journal that is not posted.` : `${r.type} ${r.number} has no journal in the general ledger.`,
    details: { entityType: r.type, entityId: r.id, number: r.number, journalId: r.journalId },
  }));
}

async function unbalancedJournals(companyId: string): Promise<IntegrityFinding[]> {
  const rows = await prisma.$queryRaw<
    Array<{ id: string; journalNumber: string; status: string; lineDebit: number; lineCredit: number; glDebit: number; glCredit: number; totalDebit: number; totalCredit: number }>
  >`
    WITH l AS (
      SELECT "journalId", SUM("debit") AS d, SUM("credit") AS c FROM "journal_lines" WHERE "companyId" = ${companyId} GROUP BY "journalId"
    ), g AS (
      SELECT "journalId", SUM("debit") AS d, SUM("credit") AS c FROM "gl_entries" WHERE "companyId" = ${companyId} GROUP BY "journalId"
    )
    SELECT j."id", j."journalNumber", j."status"::text AS "status",
           COALESCE(l.d, 0)::float8 AS "lineDebit", COALESCE(l.c, 0)::float8 AS "lineCredit",
           COALESCE(g.d, 0)::float8 AS "glDebit", COALESCE(g.c, 0)::float8 AS "glCredit",
           j."totalDebit"::float8 AS "totalDebit", j."totalCredit"::float8 AS "totalCredit"
    FROM "journals" j
    LEFT JOIN l ON l."journalId" = j."id"
    LEFT JOIN g ON g."journalId" = j."id"
    WHERE j."companyId" = ${companyId}
      AND (
        (j."status" IN ('POSTED', 'REVERSED') AND (
          ABS(COALESCE(l.d, 0) - COALESCE(l.c, 0)) > ${TOLERANCE}
          OR ABS(COALESCE(g.d, 0) - COALESCE(g.c, 0)) > ${TOLERANCE}
          OR ABS(COALESCE(l.d, 0) - COALESCE(g.d, 0)) > ${TOLERANCE}
          OR ABS(COALESCE(l.c, 0) - COALESCE(g.c, 0)) > ${TOLERANCE}
          OR ABS(j."totalDebit" - j."totalCredit") > ${TOLERANCE}
        ))
        OR (j."status" NOT IN ('POSTED', 'REVERSED') AND g."journalId" IS NOT NULL)
      )
    ORDER BY j."journalNumber"
    LIMIT ${LIMIT}`;
  return rows.map((r) => {
    const posted = r.status === "POSTED" || r.status === "REVERSED";
    const reason = !posted
      ? `is ${r.status} but has general ledger entries`
      : Math.abs(r.lineDebit - r.lineCredit) > TOLERANCE || Math.abs(r.totalDebit - r.totalCredit) > TOLERANCE
        ? `does not balance (debits ${fmt(r.lineDebit)}, credits ${fmt(r.lineCredit)})`
        : `has general ledger entries (debits ${fmt(r.glDebit)}, credits ${fmt(r.glCredit)}) that differ from its lines (debits ${fmt(r.lineDebit)}, credits ${fmt(r.lineCredit)})`;
    return {
      check: "UNBALANCED_JOURNAL" as const,
      severity: "ERROR" as const,
      message: `Journal ${r.journalNumber} ${reason}.`,
      details: { journalId: r.id, journalNumber: r.journalNumber, status: r.status, lines: { debit: r.lineDebit, credit: r.lineCredit }, gl: { debit: r.glDebit, credit: r.glCredit } },
    };
  });
}

/**
 * Journal numbers come from one counter per sequence and reset period, are allocated in the same transaction
 * that creates the journal, and journals are never deleted (drafts and cancelled journals keep their number).
 * A missing number therefore means a journal row disappeared. Numbers below `legacyFloor` were issued by the
 * old company-wide counter, which skipped numbers within a year, so gaps there are expected.
 *
 * Numbers are grouped by the counter that issued them, not by their text: the month and branch segments and
 * prefix changes share one counter, and without a yearly reset the year segment does too. The counter's period
 * comes from the year/month segment when the format has one, because a draft's date can change after numbering.
 */
async function journalNumberGaps(companyId: string): Promise<IntegrityFinding[]> {
  const seq = await prisma.numberSequence.findUnique({ where: { companyId_documentType: { companyId, documentType: "JOURNAL_ENTRY" } } });
  const floor = seq?.legacyFloor ?? 0;
  const reset = seq?.resetFrequency ?? "YEARLY";
  const includeYear = seq?.includeYear ?? true;
  const mode =
    reset === "YEARLY" ? (includeYear ? "number-year" : "date-year")
    : reset === "MONTHLY" ? (includeYear && seq?.includeMonth ? "number-month" : "date-month")
    : "all";
  const rows = await prisma.$queryRaw<Array<{ period: string; from: number; to: number; after: string; before: string }>>`
    WITH nums AS (
      SELECT
        CASE ${mode}::text
          WHEN 'number-year' THEN COALESCE(substring("journalNumber" from '-((?:19|20)[0-9]{2})-'), to_char("journalDate", 'YYYY'))
          WHEN 'number-month' THEN COALESCE(substring("journalNumber" from '-((?:19|20)[0-9]{2}-[0-9]{2})-'), to_char("journalDate", 'YYYY-MM'))
          WHEN 'date-year' THEN to_char("journalDate", 'YYYY')
          WHEN 'date-month' THEN to_char("journalDate", 'YYYY-MM')
          ELSE 'ALL'
        END AS period,
        substring("journalNumber" from '([0-9]{1,9})$')::int AS n,
        "journalNumber"
      FROM "journals"
      WHERE "companyId" = ${companyId} AND "journalNumber" ~ '[0-9]$'
    ), ordered AS (
      SELECT period, n, "journalNumber",
             LAG(n) OVER w AS prev, LAG("journalNumber") OVER w AS "prevNumber"
      FROM nums
      WINDOW w AS (PARTITION BY period ORDER BY n, "journalNumber")
    )
    SELECT period, GREATEST(prev + 1, ${floor}::int) AS "from", (n - 1) AS "to", "prevNumber" AS "after", "journalNumber" AS "before"
    FROM ordered
    WHERE prev IS NOT NULL AND n - prev > 1 AND n - 1 >= ${floor}::int
    ORDER BY period, n
    LIMIT ${LIMIT}`;
  return rows.map((r) => {
    const missing = r.to - r.from + 1;
    const range = missing === 1 ? `number ${r.from} is` : `numbers ${r.from}–${r.to} are`;
    return {
      check: "JOURNAL_NUMBER_GAP" as const,
      severity: "WARNING" as const,
      message: `Journal ${range} missing between ${r.after} and ${r.before}.`,
      details: { period: r.period, from: r.from, to: r.to, missing, after: r.after, before: r.before },
    };
  });
}

async function negativeCash(companyId: string): Promise<IntegrityFinding[]> {
  const [financial, flagged, defaults] = await Promise.all([
    prisma.financialAccount.findMany({ where: { companyId }, select: { glAccountId: true, allowOverdraft: true, name: true } }),
    prisma.account.findMany({ where: { companyId, isCashAccount: true }, select: { id: true } }),
    prisma.defaultPostingAccounts.findUnique({ where: { companyId } }),
  ]);
  const overdraft = new Set(financial.filter((f) => f.allowOverdraft).map((f) => f.glAccountId));
  const names = new Map(financial.map((f) => [f.glAccountId, f.name]));
  const ids = [
    ...new Set(
      [
        ...financial.map((f) => f.glAccountId),
        ...flagged.map((a) => a.id),
        defaults?.defaultCashAccountId,
        defaults?.defaultBankAccountId,
        defaults?.pettyCashAccountId,
      ].filter((id): id is string => Boolean(id) && !overdraft.has(id!)),
    ),
  ];
  if (!ids.length) return [];
  const sums = await prisma.glEntry.groupBy({ by: ["accountId"], where: { companyId, accountId: { in: ids } }, _sum: { debit: true, credit: true } });
  const negative = sums
    .map((s) => ({ accountId: s.accountId, balance: round(money(s._sum.debit) - money(s._sum.credit)) }))
    .filter((s) => s.balance < -TOLERANCE);
  if (!negative.length) return [];
  const accounts = await prisma.account.findMany({ where: { companyId, id: { in: negative.map((n) => n.accountId) } }, select: { id: true, code: true, name: true } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return negative.map((n) => {
    const account = byId.get(n.accountId);
    const label = names.get(n.accountId) ?? `${account?.code ?? ""} ${account?.name ?? ""}`.trim();
    return {
      check: "NEGATIVE_CASH" as const,
      severity: "ERROR" as const,
      message: `${label} has a negative balance of ${fmt(n.balance)}.`,
      details: { accountId: n.accountId, code: account?.code, name: account?.name, balance: n.balance },
    };
  });
}

/** A check that throws is reported as a finding so the other checks still run and are stored. */
async function guarded(checks: IntegrityCheck[], run: () => Promise<IntegrityFinding[]>): Promise<IntegrityFinding[]> {
  try {
    return await run();
  } catch (e) {
    return [
      {
        check: checks[0],
        severity: "WARNING",
        message: `${checks.map((c) => INTEGRITY_CHECKS[c]).join(" and ")} could not be checked: ${(e as Error).message}`,
        details: { error: (e as Error).message },
      },
    ];
  }
}

/** Runs every check for one company. Read-only. */
export async function runIntegrityScan(companyId: string): Promise<IntegrityFinding[]> {
  const groups = await Promise.all([
    guarded(["AR_SUBLEDGER", "AP_SUBLEDGER"], () => partyLedgers(companyId)),
    guarded(["INVENTORY_SUBLEDGER"], () => inventory(companyId)),
    guarded(["DOCUMENT_WITHOUT_GL"], () => documentsWithoutGl(companyId)),
    guarded(["UNBALANCED_JOURNAL"], () => unbalancedJournals(companyId)),
    guarded(["JOURNAL_NUMBER_GAP"], () => journalNumberGaps(companyId)),
    guarded(["NEGATIVE_CASH"], () => negativeCash(companyId)),
  ]);
  return groups.flat();
}

function countsByCheck(findings: IntegrityFinding[]) {
  return (Object.keys(INTEGRITY_CHECKS) as IntegrityCheck[]).map((check) => ({
    check,
    label: INTEGRITY_CHECKS[check],
    count: findings.filter((f) => f.check === check).length,
  }));
}

function present(scan: { id: string; trigger: string; runByErpUserId: number | null; findingCount: number; findings: Prisma.JsonValue; createdAt: Date }) {
  const findings = scan.findings as unknown as IntegrityFinding[];
  return {
    id: scan.id,
    trigger: scan.trigger,
    runByErpUserId: scan.runByErpUserId,
    ranAt: scan.createdAt,
    findingCount: scan.findingCount,
    errors: findings.filter((f) => f.severity === "ERROR").length,
    checks: countsByCheck(findings),
    findings,
  };
}

/**
 * Runs and stores a scan. A notification goes to admins and accountants when there are findings, unless the
 * previous scan found exactly the same ones.
 */
export async function recordIntegrityScan(companyId: string, trigger: "SCHEDULED" | "MANUAL", actor: Actor = {}) {
  const findings = await runIntegrityScan(companyId);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(findings.map((f) => `${f.check} ${f.message}`).sort()))
    .digest("hex");
  const previous = await prisma.integrityScan.findFirst({ where: { companyId }, orderBy: { createdAt: "desc" }, select: { fingerprint: true } });
  const scan = await prisma.integrityScan.create({
    data: {
      companyId,
      trigger,
      runByErpUserId: actor.erpUserId || null,
      findingCount: findings.length,
      fingerprint,
      findings: findings as unknown as Prisma.InputJsonValue,
    },
  });
  await prisma.integrityScan.deleteMany({ where: { companyId, createdAt: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } } });

  if (findings.length && previous?.fingerprint !== fingerprint) {
    const summary = countsByCheck(findings)
      .filter((c) => c.count)
      .map((c) => `${c.label}: ${c.count}`)
      .join("; ");
    const critical = findings.some((f) => f.severity === "ERROR");
    for (const role of NOTIFY_ROLES) {
      await notify({
        companyId,
        title: "Data integrity issues found",
        body: `${findings.length} issue(s). ${summary}.`,
        severity: critical ? "CRITICAL" : "WARNING",
        targetRole: role,
        entityType: "IntegrityScan",
        entityId: scan.id,
      });
    }
  }

  if (trigger === "MANUAL") {
    await writeAudit({
      companyId,
      erpUserId: actor.erpUserId ?? 0,
      erpRole: actor.erpRole,
      action: "RUN",
      entityType: "IntegrityScan",
      entityId: scan.id,
      afterJson: { findingCount: findings.length, checks: countsByCheck(findings).filter((c) => c.count) },
      ...actor.meta,
    });
  }
  return present(scan);
}

export async function latestIntegrityScan(companyId: string) {
  const scan = await prisma.integrityScan.findFirst({ where: { companyId }, orderBy: { createdAt: "desc" } });
  return scan ? present(scan) : null;
}
