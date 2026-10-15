import {
  DEFAULT_SCENARIOS,
  anomalyScore,
  shiftMonth,
  findDuplicates,
  forecastVsActual,
  isKpiCode,
  isRoundAmount,
  kpiPack,
  kpiTargetMet,
  money4,
  monthRange,
  outsideWorkingHours,
  periodFromQuestion,
  scenarioForecast,
  topicOfQuestion,
  type AnomalyRule,
  type ForecastHistory,
  type ForecastMonth,
  type KpiInput,
  type ScenarioAssumption,
  type ScenarioName,
} from "@exceledge/accounting-domain";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { notify } from "../notifications/notification.service";
import { endOfDay, financialYearFor, periodStatements, type StatementLine } from "./reports.service";

type Actor = { erpUserId?: number; erpRole?: string };

async function audit(companyId: string, actor: Actor, action: string, entityType: string, entityId: string, afterJson?: unknown, beforeJson?: unknown) {
  if (!actor.erpUserId) return;
  await writeAudit({ companyId, erpUserId: actor.erpUserId, erpRole: actor.erpRole, action, entityType, entityId, afterJson, beforeJson: beforeJson ?? undefined });
}

async function functionalCurrency(companyId: string) {
  return (await prisma.currencySettings.findUnique({ where: { companyId } }))?.functionalCurrency ?? "RWF";
}

/* ── KPIs ─────────────────────────────────────────────────────────── */

type Statements = Awaited<ReturnType<typeof periodStatements>>;
type Key = "amount" | "comparative";

const INTEREST = /interest|finance (cost|charge)|loan charge/i;
const INCOME_TAX = /income tax|corporate tax|corporation tax|tax expense/i;

async function kpiAccounts(companyId: string) {
  const d = await prisma.defaultPostingAccounts.findUnique({ where: { companyId } });
  return {
    receivables: { id: d?.accountsReceivableId, code: "1200" },
    inventory: { id: d?.inventoryAssetId, code: "1300" },
    payables: { id: d?.accountsPayableId, code: "2100" },
  };
}

const lineSum = (lines: StatementLine[], key: Key, keep: (l: StatementLine) => boolean) => money4(lines.filter(keep).reduce((s, l) => s + l[key], 0));
const isAccount = (ref: { id?: string | null; code: string }) => (l: StatementLine) => (ref.id ? l.accountId === ref.id : l.code === ref.code);

function kpiInput(s: Statements, key: Key, accounts: Awaited<ReturnType<typeof kpiAccounts>>): KpiInput {
  const income = key === "amount" ? s.income : s.comparative.income;
  const position = key === "amount" ? s.position : s.comparative.position;
  const totals = position.totals;
  const cashFlow = key === "amount" ? s.cashFlow : s.comparative.cashFlow;
  const from = key === "amount" ? s.from : s.comparative.from;
  const to = key === "amount" ? s.to : s.comparative.to;
  const expenses = s.income.expenses;
  return {
    days: Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000)),
    revenue: income.totalRevenue,
    costOfSales: income.totalCostOfSales,
    grossProfit: income.grossProfit,
    profit: income.profit,
    depreciation: cashFlow.depreciation,
    interest: lineSum(expenses, key, (l) => INTEREST.test(l.name)),
    incomeTax: lineSum(expenses, key, (l) => INCOME_TAX.test(l.name) && !/withholding|vat|payable/i.test(l.name)),
    totalAssets: position.totalAssets,
    totalEquity: position.totalEquity,
    currentAssets: totals.currentAssets,
    currentLiabilities: totals.currentLiabilities,
    inventory: lineSum(s.position.assets, key, isAccount(accounts.inventory)),
    receivables: lineSum(s.position.assets, key, isAccount(accounts.receivables)),
    payables: lineSum(s.position.liabilities, key, isAccount(accounts.payables)),
    cash: lineSum(s.position.assets, key, (l) => l.code.startsWith("11")),
  };
}

/** KPI pack for a date range (financial year to date by default), with the comparative period and targets. */
export async function kpiReport(companyId: string, range: { from?: Date; to?: Date } = {}) {
  const s = await periodStatements(companyId, { from: range.from, to: range.to });
  return kpisFromStatements(companyId, s);
}

async function kpisFromStatements(companyId: string, s: Statements) {
  const [accounts, targets, currency] = await Promise.all([kpiAccounts(companyId), prisma.kpiTarget.findMany({ where: { companyId } }), functionalCurrency(companyId)]);
  const byCode = new Map(targets.map((t) => [t.code, Number(t.target)]));
  const prior = new Map(kpiPack(kpiInput(s, "comparative", accounts)).map((k) => [k.code, k.value]));
  return {
    from: s.from,
    to: s.to,
    compareFrom: s.comparative.from,
    compareTo: s.comparative.to,
    currency,
    kpis: kpiPack(kpiInput(s, "amount", accounts)).map((k) => {
      const target = byCode.get(k.code) ?? null;
      return { ...k, comparative: prior.get(k.code) ?? null, target, met: kpiTargetMet(k.value, target, k.higherIsBetter) };
    }),
  };
}

/** Sets a KPI target, or removes it when `target` is null. */
export async function saveKpiTarget(companyId: string, code: string, target: number | null, actor: Actor) {
  if (!isKpiCode(code)) throw new Error(`Unknown KPI ${code}`);
  const where = { companyId_code: { companyId, code } };
  const before = await prisma.kpiTarget.findUnique({ where });
  if (target === null) {
    if (before) await prisma.kpiTarget.delete({ where });
    await audit(companyId, actor, "DELETE", "KpiTarget", code, null, before && { target: Number(before.target) });
    return null;
  }
  if (!Number.isFinite(target)) throw new Error("The target must be a number");
  const row = await prisma.kpiTarget.upsert({ where, create: { companyId, code, target }, update: { target } });
  await audit(companyId, actor, before ? "UPDATE" : "CREATE", "KpiTarget", code, { target }, before && { target: Number(before.target) });
  return { code, target: Number(row.target) };
}

/* ── Forecasts ────────────────────────────────────────────────────── */

type MonthFigures = { revenue: number; expenses: number; cashMovement: number };

/** Revenue, expenses and cash movement per month before `before` (year-end closing journals excluded). */
async function monthlyFigures(companyId: string, before: Date) {
  const rows = await prisma.$queryRaw<Array<{ month: string; type: string; cash: boolean; debit: number; credit: number }>>(Prisma.sql`
    SELECT to_char(g."transactionDate", 'YYYY-MM') AS "month", a."type"::text AS "type", (a."type"::text = 'ASSET' AND a."code" LIKE '11%') AS "cash",
           COALESCE(SUM(g."debit"), 0)::float8 AS "debit", COALESCE(SUM(g."credit"), 0)::float8 AS "credit"
    FROM "gl_entries" g JOIN "accounts" a ON a."id" = g."accountId"
    WHERE g."companyId" = ${companyId} AND g."transactionDate" < ${before}
      AND (g."sourceDocumentType" IS NULL OR g."sourceDocumentType" <> 'YEAR_END_CLOSE')
    GROUP BY 1, 2, 3`);
  const months = new Map<string, MonthFigures>();
  for (const r of rows) {
    const m = months.get(r.month) ?? { revenue: 0, expenses: 0, cashMovement: 0 };
    if (r.type === "INCOME" || r.type === "OTHER_INCOME") m.revenue = money4(m.revenue + r.credit - r.debit);
    else if (r.type === "EXPENSE" || r.type === "OTHER_EXPENSE" || r.type === "COST_OF_SALES") m.expenses = money4(m.expenses + r.debit - r.credit);
    else if (r.cash) m.cashMovement = money4(m.cashMovement + r.debit - r.credit);
    months.set(r.month, m);
  }
  return months;
}

const monthStart = (month: string) => new Date(`${month}-01T00:00:00.000Z`);
const lastCompleteMonth = (now: Date) => shiftMonth(now.toISOString().slice(0, 7), -1);

/** Up to 24 completed months of history, from the first month with any posting. */
async function forecastHistory(companyId: string, now: Date): Promise<ForecastHistory> {
  const last = lastCompleteMonth(now);
  const figures = await monthlyFigures(companyId, monthStart(shiftMonth(last, 1)));
  const closingCash = money4([...figures.values()].reduce((s, m) => s + m.cashMovement, 0));
  const active = [...figures.entries()].filter(([, m]) => m.revenue || m.expenses || m.cashMovement).map(([k]) => k).sort();
  if (!active.length) return { months: [], revenue: [], expenses: [], cashMovement: [], closingCash };
  const first = active[0] > shiftMonth(last, -23) ? active[0] : shiftMonth(last, -23);
  const months = monthRange(first, last);
  const at = (m: string) => figures.get(m) ?? { revenue: 0, expenses: 0, cashMovement: 0 };
  return {
    months,
    revenue: months.map((m) => at(m).revenue),
    expenses: months.map((m) => at(m).expenses),
    cashMovement: months.map((m) => at(m).cashMovement),
    closingCash,
  };
}

export type ScenarioInput = Partial<Record<ScenarioName, ScenarioAssumption>>;

function scenariosFrom(input?: ScenarioInput): Record<ScenarioName, ScenarioAssumption> {
  const out = { ...DEFAULT_SCENARIOS };
  for (const [name, a] of Object.entries(input ?? {}) as Array<[ScenarioName, ScenarioAssumption]>) {
    for (const v of [a.revenue, a.expenses]) if (!(v >= 0.1 && v <= 3)) throw new Error("Scenario multipliers must be between 0.1 and 3");
    out[name] = a;
  }
  return out;
}

export async function createForecast(companyId: string, input: { name: string; horizonMonths: number; scenarios?: ScenarioInput }, actor: Actor = {}, now = new Date()) {
  const history = await forecastHistory(companyId, now);
  const scenarios = scenariosFrom(input.scenarios);
  const forecast = scenarioForecast(history, input.horizonMonths, scenarios);
  const row = await prisma.forecastScenario.create({
    data: {
      companyId,
      name: input.name.trim() || "Forecast",
      horizonMonths: input.horizonMonths,
      createdByErpUserId: actor.erpUserId,
      resultJson: {
        version: 2,
        basedOn: history,
        scenarios,
        forecast,
        // Earlier screens read the base profit trend from these.
        months: history.months,
        history: history.months.map((_, i) => money4(history.revenue[i] - history.expenses[i])),
        baseProfit: forecast.BASE.map((m) => m.profit),
      } as unknown as Prisma.InputJsonValue,
    },
  });
  await audit(companyId, actor, "CREATE", "ForecastScenario", row.id, { name: row.name, horizonMonths: row.horizonMonths, scenarios });
  return row;
}

export async function listForecasts(companyId: string) {
  return prisma.forecastScenario.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 50 });
}

/** A saved forecast's months against what was then posted; months not yet complete have no actual. */
export async function forecastAgainstActual(companyId: string, id: string, scenario: ScenarioName = "BASE", now = new Date()) {
  const row = await prisma.forecastScenario.findFirst({ where: { id, companyId } });
  if (!row) throw new Error("Forecast not found");
  const result = row.resultJson as { version?: number; forecast?: Record<string, ForecastMonth[]> };
  if (result.version !== 2 || !result.forecast?.[scenario]) throw new Error("This forecast was made before scenarios; make a new one to compare it with actuals");
  const months = result.forecast[scenario];
  const figures = await monthlyFigures(companyId, monthStart(shiftMonth(months.at(-1)!.month, 1)));
  const rows = forecastVsActual(months, figures, lastCompleteMonth(now));
  const compared = rows.filter((r) => r.actualProfit !== null);
  return {
    forecast: { id: row.id, name: row.name, createdAt: row.createdAt, horizonMonths: row.horizonMonths },
    scenario,
    rows,
    totals: compared.length
      ? {
          months: compared.length,
          forecastProfit: money4(compared.reduce((s, r) => s + r.forecastProfit, 0)),
          actualProfit: money4(compared.reduce((s, r) => s + (r.actualProfit ?? 0), 0)),
        }
      : null,
  };
}

/* ── Anomalies ────────────────────────────────────────────────────── */

type Candidate = { rule: AnomalyRule; entityType: string; entityId: string; journalId?: string | null; score: number; reason: string };

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DAY = 86_400_000;
const MANUAL = { journalType: "MANUAL" as const, OR: [{ sourceModule: null }, { sourceModule: "IMPORT" }] };

/**
 * Checks recent books against the anomaly rules: manual journals far from the usual amount, in round
 * amounts or entered outside working hours; supplier bills and payments that look entered twice.
 * A record is flagged once per rule, however often the scan runs.
 */
export async function scanAnomalies(companyId: string, actor: Actor = {}, now = new Date()) {
  const startedAt = new Date();
  const since = new Date(now.getTime() - 90 * DAY);
  const info = await prisma.businessAccountingInfo.findUnique({ where: { companyId }, select: { timeZone: true } });
  const timeZone = info?.timeZone || "Africa/Kigali";
  const candidates: Candidate[] = [];

  const journals = await prisma.journal.findMany({
    where: { companyId, status: "POSTED", ...MANUAL, journalDate: { gte: new Date(now.getTime() - 365 * DAY) } },
    orderBy: [{ journalDate: "asc" }, { createdAt: "asc" }],
    select: { id: true, journalNumber: true, journalDate: true, totalDebit: true, createdAt: true },
  });
  journals.forEach((j, i) => {
    if (j.journalDate < since && j.createdAt < since) return;
    const amount = Number(j.totalDebit);
    const history = journals.slice(Math.max(0, i - 30), i).map((h) => Number(h.totalDebit));
    const outlier = anomalyScore(amount, history);
    if (outlier.flag) {
      candidates.push({ rule: "AMOUNT_OUTLIER", entityType: "Journal", entityId: j.id, journalId: j.id, score: outlier.score, reason: `Journal ${j.journalNumber} for ${fmt(amount)} is far from the last ${history.length} manual journals` });
    }
    if (isRoundAmount(amount)) {
      candidates.push({ rule: "ROUND_AMOUNT", entityType: "Journal", entityId: j.id, journalId: j.id, score: 1, reason: `Journal ${j.journalNumber} is a round ${fmt(amount)}` });
    }
    const when = outsideWorkingHours(j.createdAt, timeZone);
    if (when) candidates.push({ rule: "OUTSIDE_HOURS", entityType: "Journal", entityId: j.id, journalId: j.id, score: 1, reason: `Journal ${j.journalNumber} was entered ${when}` });
  });

  const lookback = new Date(now.getTime() - 180 * DAY);
  const bills = await prisma.apBill.findMany({
    where: { companyId, status: "POSTED", billDate: { gte: lookback } },
    select: { id: true, billNumber: true, supplierId: true, gross: true, billDate: true, supplierInvoiceNumber: true, journalId: true, createdAt: true, supplier: { select: { name: true } } },
  });
  const billById = new Map(bills.map((b) => [b.id, b]));
  for (const d of findDuplicates(bills.map((b) => ({ id: b.id, partyId: b.supplierId, amount: Number(b.gross), date: b.billDate, reference: b.supplierInvoiceNumber })), 7)) {
    const b = billById.get(d.id)!;
    if (b.createdAt < since) continue;
    candidates.push({ rule: "DUPLICATE_BILL", entityType: "ApBill", entityId: b.id, journalId: b.journalId, score: 5, reason: `Bill ${b.billNumber} from ${b.supplier.name} ${d.reason} ${billById.get(d.duplicateOf)!.billNumber}` });
  }

  const payments = await prisma.apPayment.findMany({
    where: { companyId, status: "POSTED", paymentDate: { gte: lookback } },
    select: { id: true, paymentNumber: true, supplierId: true, amount: true, paymentDate: true, reference: true, journalId: true, createdAt: true, supplier: { select: { name: true } } },
  });
  const paymentById = new Map(payments.map((p) => [p.id, p]));
  for (const d of findDuplicates(payments.map((p) => ({ id: p.id, partyId: p.supplierId, amount: Number(p.amount), date: p.paymentDate, reference: p.reference })), 3)) {
    const p = paymentById.get(d.id)!;
    if (p.createdAt < since) continue;
    candidates.push({ rule: "DUPLICATE_PAYMENT", entityType: "ApPayment", entityId: p.id, journalId: p.journalId, score: 5, reason: `Payment ${p.paymentNumber} to ${p.supplier.name} ${d.reason} ${paymentById.get(d.duplicateOf)!.paymentNumber}` });
  }

  if (candidates.length) {
    await prisma.anomalyFlag.createMany({
      data: candidates.map((c) => ({ companyId, rule: c.rule, entityType: c.entityType, entityId: c.entityId, journalId: c.journalId ?? null, score: c.score, reason: c.reason })),
      skipDuplicates: true,
    });
  }
  const created = await prisma.anomalyFlag.findMany({ where: { companyId, createdAt: { gte: startedAt } }, orderBy: { createdAt: "asc" } });
  if (created.length) {
    await notify({
      companyId,
      title: "Unusual entries found",
      body: `${created.length} new item(s) to review: ${[...new Set(created.map((f) => f.rule.replace(/_/g, " ").toLowerCase()))].join(", ")}.`,
      severity: "WARNING",
      targetRole: "ACCOUNTANT",
      entityType: "AnomalyFlag",
    });
  }
  await audit(companyId, actor, "SCAN_ANOMALIES", "AnomalyFlag", companyId, { checked: candidates.length, flagged: created.map((f) => f.id) });
  return created;
}

export async function listAnomalies(companyId: string, status?: string) {
  return prisma.anomalyFlag.findMany({
    where: { companyId, ...(status ? { status } : {}) },
    include: { notes: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}

const OPEN_STATUSES = ["OPEN", "INVESTIGATING"];

export async function addAnomalyNote(companyId: string, id: string, note: string, actor: Actor) {
  if (!actor.erpUserId) throw new Error("A signed-in user is required");
  const text = note.trim();
  if (text.length < 3) throw new Error("Write a note of at least 3 characters");
  const flag = await prisma.anomalyFlag.findFirst({ where: { id, companyId } });
  if (!flag) throw new Error("Anomaly not found");
  const row = await prisma.anomalyNote.create({ data: { flagId: id, erpUserId: actor.erpUserId, note: text } });
  if (flag.status === "OPEN") await prisma.anomalyFlag.updateMany({ where: { id, status: "OPEN" }, data: { status: "INVESTIGATING" } });
  await audit(companyId, actor, "ADD_NOTE", "AnomalyFlag", id, { note: text });
  return row;
}

/** Closes a case as a real problem (CONFIRMED) or a false alarm (DISMISSED), with the reason. */
export async function resolveAnomaly(companyId: string, id: string, outcome: "CONFIRMED" | "DISMISSED", reason: string, actor: Actor) {
  if (!actor.erpUserId) throw new Error("A signed-in user is required");
  const text = reason.trim();
  if (text.length < 3) throw new Error(outcome === "DISMISSED" ? "Say why this is not a problem" : "Say what was found");
  const flag = await prisma.anomalyFlag.findFirst({ where: { id, companyId } });
  if (!flag) throw new Error("Anomaly not found");
  const updated = await prisma.anomalyFlag.updateMany({
    where: { id, status: { in: OPEN_STATUSES } },
    data: { status: outcome, resolution: text, decidedByErpUserId: actor.erpUserId, decidedAt: new Date() },
  });
  if (!updated.count) throw new Error(`This item is already ${flag.status.toLowerCase()}`);
  await audit(companyId, actor, outcome === "DISMISSED" ? "DISMISS" : "CONFIRM", "AnomalyFlag", id, { status: outcome, resolution: text }, { status: flag.status });
  return prisma.anomalyFlag.findUniqueOrThrow({ where: { id }, include: { notes: { orderBy: { createdAt: "asc" } } } });
}

/* ── Assistant ────────────────────────────────────────────────────── */

type Link = { label: string; path: string };

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Answers from posted figures only: the question's topic and period are recognised from its words,
 * the figures come from the statements and subledgers, and links lead to the report behind the answer.
 */
export async function askAssistant(companyId: string, question: string, now = new Date()) {
  const fy = await financialYearFor(companyId, now);
  const named = periodFromQuestion(question, now, { start: fy.start, end: fy.end });
  const from = named?.from ?? fy.start;
  const to = named ? endOfDay(named.to < now ? named.to : now) : endOfDay(now);
  const label = named?.label ?? "this financial year to date";
  const topic = topicOfQuestion(question);
  const currency = await functionalCurrency(companyId);
  const money = (n: number) => `${currency} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const pct = (n: number | null) => (n === null ? "not available (no revenue)" : `${(n * 100).toFixed(1)}%`);
  const range = `from=${day(from)}&to=${day(to)}`;
  const statements: Link = { label: "Financial statements", path: `/reports/statements?${range}` };
  const asOf = `as at ${day(to)}`;

  const s = await periodStatements(companyId, { from, to });
  const report = await kpisFromStatements(companyId, s);
  const k = (code: string) => report.kpis.find((x) => x.code === code)!;
  const figures: Record<string, number | null> = {};
  let answer: string;
  let links: Link[] = [statements];

  switch (topic) {
    case "PROFIT":
      figures.profit = s.income.profit;
      figures.revenue = s.income.totalRevenue;
      figures.expenses = s.income.totalExpenses;
      answer = `${s.income.profit < 0 ? "Loss" : "Profit"} for ${label} is ${money(Math.abs(s.income.profit))}: revenue ${money(s.income.totalRevenue)} less expenses ${money(s.income.totalExpenses)}.`;
      break;
    case "REVENUE":
      figures.revenue = s.income.totalRevenue;
      answer = `Revenue for ${label} is ${money(s.income.totalRevenue)}${s.income.revenue.length ? `, mostly ${[...s.income.revenue].sort((a, b) => b.amount - a.amount)[0].name}` : ""}.`;
      break;
    case "EXPENSES":
      figures.expenses = s.income.totalExpenses;
      answer = `Expenses for ${label} total ${money(s.income.totalExpenses)}, of which cost of sales is ${money(s.income.totalCostOfSales)}.`;
      break;
    case "TOP_EXPENSES": {
      const top = [...s.income.expenses].sort((a, b) => b.amount - a.amount).slice(0, 3).filter((l) => l.amount > 0);
      figures.expenses = s.income.totalExpenses;
      answer = top.length
        ? `The largest expenses for ${label} are ${top.map((l) => `${l.name} (${money(l.amount)})`).join(", ")}, out of ${money(s.income.totalExpenses)} in total.`
        : `No expenses were posted for ${label}.`;
      links = [statements, ...top.filter((l) => l.accountId).map((l) => ({ label: `${l.name} ledger`, path: `/ledger?account=${l.accountId}&${range}` }))];
      break;
    }
    case "CASH":
      figures.cash = k("CASH").value;
      answer = (figures.cash ?? 0) < 0 ? `Cash and bank accounts are overdrawn by ${money(-(figures.cash ?? 0))} ${asOf}.` : `Cash and bank balances total ${money(figures.cash ?? 0)} ${asOf}.`;
      links = [{ label: "Cash position", path: "/reports/cash-position" }, statements];
      break;
    case "RECEIVABLES":
    case "OVERDUE": {
      const invoices = (
        await prisma.arInvoice.findMany({
          where: { companyId, status: "POSTED", invoiceDate: { lte: to } },
          select: { gross: true, amountPaid: true, amountCredited: true, dueDate: true, customer: { select: { name: true } } },
        })
      ).map((i) => ({ owed: money4(Number(i.gross) - Number(i.amountPaid) - Number(i.amountCredited)), due: i.dueDate, customer: i.customer.name }));
      const open = invoices.filter((i) => i.owed > 0.005);
      const overdue = open.filter((i) => i.due < to);
      const owed = money4(open.reduce((s2, i) => s2 + i.owed, 0));
      const late = money4(overdue.reduce((s2, i) => s2 + i.owed, 0));
      figures.receivables = owed;
      figures.overdue = late;
      const worst = [...overdue.reduce((m, i) => m.set(i.customer, (m.get(i.customer) ?? 0) + i.owed), new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 3);
      answer =
        topic === "OVERDUE"
          ? overdue.length
            ? `${overdue.length} invoice(s) totalling ${money(late)} are overdue today. Largest: ${worst.map(([n, v]) => `${n} (${money(v)})`).join(", ")}.`
            : "No customer invoices are overdue."
          : `Customers owe ${money(owed)} on open invoices, of which ${money(late)} is overdue. Days sales outstanding for ${label}: ${k("DSO").value ?? "n/a"}.`;
      links = [{ label: "Receivables ageing", path: "/reports/ageing" }, { label: "Invoices", path: "/invoices" }];
      break;
    }
    case "PAYABLES":
      figures.payables = await payablesOwed(companyId, to);
      answer = `Suppliers are owed ${money(figures.payables ?? 0)} on open bills ${asOf}. Days payables outstanding for ${label}: ${k("DPO").value ?? "n/a"}.`;
      links = [{ label: "Payables ageing", path: "/reports/payables-ageing" }, { label: "Bills", path: "/bills" }];
      break;
    case "MARGIN":
      figures.grossMargin = k("GROSS_MARGIN").value;
      figures.netMargin = k("NET_MARGIN").value;
      answer = `For ${label}, gross margin is ${pct(figures.grossMargin)} and net margin is ${pct(figures.netMargin)}.`;
      break;
    case "EBITDA":
      figures.ebitda = k("EBITDA").value;
      figures.ebitdaMargin = k("EBITDA_MARGIN").value;
      answer = `EBITDA for ${label} is ${money(figures.ebitda ?? 0)} (${pct(figures.ebitdaMargin)} of revenue): profit plus interest, income tax, depreciation and amortisation.`;
      links = [{ label: "KPIs", path: `/platform?${range}` }, statements];
      break;
    case "LIQUIDITY":
      figures.currentRatio = k("CURRENT_RATIO").value;
      figures.quickRatio = k("QUICK_RATIO").value;
      figures.workingCapital = k("WORKING_CAPITAL").value;
      answer = `${asOf[0].toUpperCase()}${asOf.slice(1)}, the current ratio is ${figures.currentRatio ?? "n/a"} and the quick ratio ${figures.quickRatio ?? "n/a"}; working capital is ${money(figures.workingCapital ?? 0)}.`;
      links = [{ label: "KPIs", path: `/platform?${range}` }, statements];
      break;
    default:
      figures.profit = s.income.profit;
      figures.revenue = s.income.totalRevenue;
      figures.cash = k("CASH").value;
      answer = `For ${label}: revenue ${money(s.income.totalRevenue)}, profit ${money(s.income.profit)}. Cash ${asOf} is ${money(figures.cash ?? 0)}. Ask about profit, revenue, expenses, cash, customers, suppliers, margins, EBITDA or liquidity, for a month, quarter or year.`;
  }

  return { answer, topic, period: { from: day(from), to: day(to), label }, figures, links, currency, source: "Posted books" };
}

async function payablesOwed(companyId: string, at: Date) {
  const bills = await prisma.apBill.findMany({
    where: { companyId, status: "POSTED", billDate: { lte: at } },
    select: { gross: true, amountPaid: true, amountCredited: true },
  });
  return money4(bills.reduce((s, b) => s + Math.max(0, Number(b.gross) - Number(b.amountPaid) - Number(b.amountCredited)), 0));
}
