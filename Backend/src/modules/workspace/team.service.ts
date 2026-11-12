import { randomUUID } from "node:crypto";
import type { Employee, Prisma } from "@prisma/client";
import { z } from "zod";
import { nextNumber } from "../../lib/documents";
import { type Actor, clientId, isoDay, notFound, optionalDay, optionalText, toDate } from "../../lib/http";
import { inTransaction, prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";

const audit = (companyId: string, actor: Actor, action: string, entityType: string, entityId: string, afterJson?: unknown) =>
  writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action, entityType, entityId, afterJson, ...actor.meta });

export const employeeBody = z.object({
  firstName: z.string().trim().min(1, "Enter a first name").max(100),
  lastName: z.string().trim().min(1, "Enter a last name").max(100),
  middleName: optionalText(100),
  preferredName: optionalText(100),
  email: z.union([z.string().trim().email("Enter a valid email"), z.literal("")]).nullish().transform((v) => v || null),
  phone: optionalText(30),
  address: optionalText(500),
  city: optionalText(100),
  country: optionalText(60),
  gender: optionalText(30),
  jobTitle: optionalText(150),
  department: optionalText(150),
  employmentType: optionalText(60),
  joiningDate: optionalDay,
  workLocation: optionalText(150),
  reportingManager: optionalText(150),
  employmentStatus: z.string().trim().max(40).default("active"),
  contractStart: optionalDay,
  contractEnd: optionalDay,
  probation: optionalText(60),
  workSchedule: optionalText(60),
  dateOfBirth: optionalDay,
  nationalId: optionalText(40),
  payFrequency: optionalText(40),
  currency: optionalText(3),
  basicSalary: z.number().min(0).nullish(),
  effectiveFrom: optionalDay,
  paymentMethod: optionalText(40),
  bankName: optionalText(100),
  accountHolder: optionalText(150),
  accountNumber: optionalText(60),
  tin: optionalText(40),
  rssb: optionalText(40),
});

const RESTRICTED = ["dateOfBirth", "nationalId", "payFrequency", "currency", "basicSalary", "effectiveFrom", "paymentMethod", "bankName", "accountHolder", "accountNumber", "tin", "rssb"] as const;

/** Pay, bank and identity details only reach people who can manage the team. */
export function presentEmployee(employee: Employee, canSeePrivate: boolean) {
  if (canSeePrivate) return employee;
  const copy: Record<string, unknown> = { ...employee };
  for (const key of RESTRICTED) delete copy[key];
  return copy;
}

export async function listEmployees(companyId: string, canSeePrivate: boolean) {
  const rows = await prisma.employee.findMany({ where: { companyId }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 2000 });
  return rows.map((r) => presentEmployee(r, canSeePrivate));
}

export async function getEmployee(companyId: string, id: string, canSeePrivate: boolean) {
  const row = await prisma.employee.findFirst({ where: { id, companyId } });
  if (!row) throw notFound("Employee");
  return presentEmployee(row, canSeePrivate);
}

export async function saveEmployee(companyId: string, id: string, input: z.infer<typeof employeeBody>, actor: Actor) {
  clientId.parse(id);
  return inTransaction(async () => {
    const existing = await prisma.employee.findUnique({ where: { id } });
    if (existing && existing.companyId !== companyId) throw notFound("Employee");
    const data = {
      ...input,
      joiningDate: toDate(input.joiningDate),
      contractStart: toDate(input.contractStart),
      contractEnd: toDate(input.contractEnd),
      dateOfBirth: toDate(input.dateOfBirth),
      effectiveFrom: toDate(input.effectiveFrom),
    };
    if (data.contractStart && data.contractEnd && data.contractEnd < data.contractStart) throw new Error("The contract can't end before it starts");
    const row = existing
      ? await prisma.employee.update({ where: { id }, data })
      : await prisma.employee.create({ data: { id, companyId, employeeNumber: await nextNumber(companyId, "EMPLOYEE", "EMP"), createdByErpUserId: actor.erpUserId, ...data } });
    // The trail records that someone changed a record, never the salary or bank details themselves.
    await audit(companyId, actor, existing ? "UPDATE" : "CREATE", "Employee", id, { employeeNumber: row.employeeNumber, name: `${row.firstName} ${row.lastName}`, status: row.employmentStatus });
    return row;
  });
}

/** Employees with recorded time are kept for the trail; mark them inactive instead. */
export async function deleteEmployee(companyId: string, id: string, actor: Actor) {
  return inTransaction(async () => {
    const row = await prisma.employee.findFirst({ where: { id, companyId } });
    if (!row) throw notFound("Employee");
    if (await prisma.timeActivity.count({ where: { employeeId: id } })) throw new Error("This employee has recorded time; mark them inactive instead");
    await prisma.employee.delete({ where: { id } });
    await audit(companyId, actor, "DELETE", "Employee", id, { employeeNumber: row.employeeNumber });
    return { id };
  });
}

/* ── Time ─────────────────────────────────────────────────────────────────────── */

const MINUTES_IN_DAY = 24 * 60;

const entryFields = {
  employeeId: z.string().min(1).nullish(),
  personName: optionalText(200),
  customerId: z.string().min(1).nullish(),
  projectId: z.string().min(1).nullish(),
  service: optionalText(200),
  billable: z.boolean().default(false),
  hourlyRate: z.number().min(0).nullish(),
  notes: optionalText(2000),
};

export const timeBody = z.object({
  ...entryFields,
  date: isoDay,
  durationMinutes: z.number().int().positive("Enter how long this took").max(MINUTES_IN_DAY, "One entry can't be more than 24 hours"),
});

export const weeklyBody = z.object({
  employeeId: z.string().min(1).nullish(),
  personName: optionalText(200),
  rows: z
    .array(
      z.object({
        customerId: z.string().min(1).nullish(),
        projectId: z.string().min(1).nullish(),
        service: optionalText(200),
        billable: z.boolean().default(false),
        hourlyRate: z.number().min(0).nullish(),
        notes: optionalText(2000),
        days: z.array(z.object({ date: isoDay, durationMinutes: z.number().int().min(0).max(MINUTES_IN_DAY) })).max(7),
      }),
    )
    .min(1)
    .max(100),
});

async function resolvePeople(companyId: string, input: { employeeId?: string | null; personName?: string | null; customerId?: string | null; projectId?: string | null }) {
  const employee = input.employeeId ? await prisma.employee.findFirst({ where: { id: input.employeeId, companyId } }) : null;
  if (input.employeeId && !employee) throw new Error("Choose an existing employee");
  const personName = employee ? `${employee.firstName} ${employee.lastName}` : input.personName;
  if (!personName) throw new Error("Choose who did the work");
  const customer = input.customerId ? await prisma.customer.findFirst({ where: { id: input.customerId, companyId } }) : null;
  if (input.customerId && !customer) throw new Error("Choose an existing customer");
  if (input.projectId && !(await prisma.project.findFirst({ where: { id: input.projectId, companyId } }))) throw new Error("Choose an existing project");
  return { employeeId: employee?.id ?? null, personName, customerId: customer?.id ?? null, customerName: customer?.name ?? null, projectId: input.projectId ?? null };
}

export async function createTime(companyId: string, input: z.infer<typeof timeBody>, actor: Actor) {
  const people = await resolvePeople(companyId, input);
  const row = await prisma.timeActivity.create({
    data: {
      companyId,
      ...people,
      service: input.service,
      activityDate: toDate(input.date)!,
      durationMinutes: input.durationMinutes,
      billable: input.billable,
      hourlyRate: input.hourlyRate ?? null,
      notes: input.notes,
      createdByErpUserId: actor.erpUserId,
    },
  });
  await audit(companyId, actor, "CREATE", "TimeActivity", row.id, { person: people.personName, minutes: input.durationMinutes });
  return row;
}

/** Saves a weekly timesheet as one entry per day with time, all or nothing. */
export async function createWeekly(companyId: string, input: z.infer<typeof weeklyBody>, actor: Actor) {
  return inTransaction(async () => {
    const batchId = randomUUID();
    const rows: Prisma.TimeActivityCreateManyInput[] = [];
    const perDay = new Map<string, number>();
    for (const row of input.rows) {
      const people = await resolvePeople(companyId, { ...row, employeeId: input.employeeId, personName: input.personName });
      for (const day of row.days) {
        if (!day.durationMinutes) continue;
        const total = (perDay.get(day.date) ?? 0) + day.durationMinutes;
        if (total > MINUTES_IN_DAY) throw new Error(`${day.date} adds up to more than 24 hours`);
        perDay.set(day.date, total);
        rows.push({
          companyId,
          ...people,
          service: row.service,
          activityDate: toDate(day.date)!,
          durationMinutes: day.durationMinutes,
          billable: row.billable,
          hourlyRate: row.hourlyRate ?? null,
          notes: row.notes,
          batchId,
          createdByErpUserId: actor.erpUserId,
        });
      }
    }
    if (!rows.length) throw new Error("Enter some time on at least one day");
    await prisma.timeActivity.createMany({ data: rows });
    await audit(companyId, actor, "CREATE", "TimeActivity", batchId, { entries: rows.length, minutes: rows.reduce((s, r) => s + r.durationMinutes, 0) });
    return { batchId, entries: rows.length };
  });
}

export function listTime(companyId: string, filter: { employeeId?: string; projectId?: string; from?: string; to?: string }) {
  const activityDate = { ...(filter.from ? { gte: new Date(`${filter.from}T00:00:00Z`) } : {}), ...(filter.to ? { lte: new Date(`${filter.to}T23:59:59Z`) } : {}) };
  return prisma.timeActivity.findMany({
    where: {
      companyId,
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      ...(filter.projectId ? { projectId: filter.projectId } : {}),
      ...(filter.from || filter.to ? { activityDate } : {}),
    },
    orderBy: [{ activityDate: "desc" }, { createdAt: "desc" }],
    take: 2000,
  });
}

export async function deleteTime(companyId: string, id: string, actor: Actor) {
  const removed = await prisma.timeActivity.deleteMany({ where: { id, companyId } });
  if (!removed.count) throw notFound("Time activity");
  await audit(companyId, actor, "DELETE", "TimeActivity", id);
  return { id };
}
