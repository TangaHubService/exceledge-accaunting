import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { logManualActivity } from "../middleware/activity-log.middleware";
import { AuthRequest } from "../middleware/auth.middleware";
import { enqueuePayrollAccountingEvent } from "../services/accounting-outbox.service";
import { RWANDA_PAYROLL_RULES, calculatePayslip, payrollTotals } from "../services/payroll-calc.service";
import { error, success } from "../utils/apiResponse";

const money = z.coerce.number().min(0);
const optionalText = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((v) => (v ? v : null));

const employeeSchema = z.object({
  employeeNumber: z.string().trim().min(1).max(30),
  fullName: z.string().trim().min(2).max(120),
  nationalId: optionalText,
  rssbNumber: optionalText,
  jobTitle: optionalText,
  email: z
    .string()
    .trim()
    .email()
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
  phone: optionalText,
  hireDate: z.coerce.date().optional().nullable(),
  basicSalary: money,
  housingAllowance: money.default(0),
  transportAllowance: money.default(0),
  otherAllowance: money.default(0),
  paymentMethod: z.enum(["BANK", "CASH", "MOBILE_MONEY"]).default("BANK"),
  bankName: optionalText,
  bankAccount: optionalText,
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

const runSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  notes: z.string().trim().max(500).optional(),
});

function orgId(req: Request) {
  return parseInt(req.params.organizationId, 10);
}

function userId(req: AuthRequest) {
  return req.user?.userId as number;
}

function fail(res: Response, e: unknown) {
  if (e instanceof z.ZodError) {
    return res.status(400).json(error(e.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; "), "VALIDATION"));
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return res.status(409).json(error("An employee with this number already exists", "DUPLICATE"));
  }
  return res.status(500).json(error((e as Error).message || "Payroll request failed"));
}

async function audit(req: AuthRequest, description: string, entityType: string, entityId: number, metadata: Record<string, unknown> = {}) {
  await logManualActivity({
    userId: userId(req),
    organizationId: orgId(req),
    module: "SYSTEM",
    type: "OTHER",
    description,
    entityType,
    entityId,
    metadata,
  });
}

export const listEmployees = async (req: AuthRequest, res: Response) => {
  try {
    const status = req.query.status === "ACTIVE" || req.query.status === "INACTIVE" ? req.query.status : undefined;
    const employees = await prisma.employee.findMany({
      where: { organizationId: orgId(req), ...(status ? { status } : {}) },
      orderBy: [{ status: "asc" }, { fullName: "asc" }],
    });
    res.json(success(employees));
  } catch (e) {
    fail(res, e);
  }
};

export const createEmployee = async (req: AuthRequest, res: Response) => {
  try {
    const input = employeeSchema.parse(req.body);
    const employee = await prisma.employee.create({ data: { ...input, organizationId: orgId(req) } });
    await audit(req, `Added employee ${employee.fullName}`, "Employee", employee.id);
    res.status(201).json(success(employee, "Employee added"));
  } catch (e) {
    fail(res, e);
  }
};

export const updateEmployee = async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.employee.findFirst({ where: { id, organizationId: orgId(req) } });
    if (!existing) return res.status(404).json(error("Employee not found", "NOT_FOUND"));
    const input = employeeSchema.parse(req.body);
    const employee = await prisma.employee.update({ where: { id }, data: input });
    await audit(req, `Updated employee ${employee.fullName}`, "Employee", employee.id);
    res.json(success(employee, "Employee updated"));
  } catch (e) {
    fail(res, e);
  }
};

export const previewPayslip = async (req: AuthRequest, res: Response) => {
  try {
    const input = z
      .object({ basicSalary: money, housingAllowance: money.default(0), transportAllowance: money.default(0), otherAllowance: money.default(0) })
      .parse(req.body);
    res.json(success({ rulesVersion: RWANDA_PAYROLL_RULES.version, ...calculatePayslip(input) }));
  } catch (e) {
    fail(res, e);
  }
};

export const listRuns = async (req: AuthRequest, res: Response) => {
  try {
    const runs = await prisma.payrollRun.findMany({
      where: { organizationId: orgId(req) },
      orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { id: "desc" }],
    });
    res.json(success(runs));
  } catch (e) {
    fail(res, e);
  }
};

async function findRun(req: AuthRequest) {
  return prisma.payrollRun.findFirst({
    where: { id: parseInt(req.params.id, 10), organizationId: orgId(req) },
    include: { payslips: { include: { employee: true }, orderBy: { employee: { fullName: "asc" } } } },
  });
}

export const getRun = async (req: AuthRequest, res: Response) => {
  try {
    const run = await findRun(req);
    if (!run) return res.status(404).json(error("Payroll run not found", "NOT_FOUND"));
    res.json(success(run));
  } catch (e) {
    fail(res, e);
  }
};

/** Payslips for every employee active and hired by the end of the period, replacing any drafts. */
async function buildPayslips(tx: Prisma.TransactionClient, organizationId: number, runId: number, year: number, month: number) {
  const periodEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  const employees = await tx.employee.findMany({
    where: { organizationId, status: "ACTIVE", OR: [{ hireDate: null }, { hireDate: { lte: periodEnd } }] },
  });
  if (employees.length === 0) throw new Error("There are no active employees to pay for this period");
  const slips = employees.map((e) => ({
    employeeId: e.id,
    figures: calculatePayslip({
      basicSalary: Number(e.basicSalary),
      housingAllowance: Number(e.housingAllowance),
      transportAllowance: Number(e.transportAllowance),
      otherAllowance: Number(e.otherAllowance),
    }),
  }));
  await tx.payslip.deleteMany({ where: { payrollRunId: runId } });
  await tx.payslip.createMany({ data: slips.map((s) => ({ payrollRunId: runId, employeeId: s.employeeId, ...s.figures })) });
  const totals = payrollTotals(slips.map((s) => s.figures));
  return tx.payrollRun.update({ where: { id: runId }, data: { ...totals, rulesVersion: RWANDA_PAYROLL_RULES.version } });
}

export const createRun = async (req: AuthRequest, res: Response) => {
  try {
    const { year, month, notes } = runSchema.parse(req.body);
    const organizationId = orgId(req);
    const clash = await prisma.payrollRun.findFirst({
      where: { organizationId, periodYear: year, periodMonth: month, status: { not: "CANCELLED" } },
    });
    if (clash) return res.status(409).json(error("A payroll run already exists for this month", "DUPLICATE"));
    const run = await prisma.$transaction(async (tx) => {
      const created = await tx.payrollRun.create({
        data: { organizationId, periodYear: year, periodMonth: month, notes, createdById: userId(req), rulesVersion: RWANDA_PAYROLL_RULES.version },
      });
      return buildPayslips(tx, organizationId, created.id, year, month);
    });
    await audit(req, `Prepared payroll for ${year}-${String(month).padStart(2, "0")}`, "PayrollRun", run.id);
    res.status(201).json(success(run, "Payroll prepared"));
  } catch (e) {
    fail(res, e);
  }
};

export const recalculateRun = async (req: AuthRequest, res: Response) => {
  try {
    const run = await findRun(req);
    if (!run) return res.status(404).json(error("Payroll run not found", "NOT_FOUND"));
    if (run.status !== "DRAFT") return res.status(400).json(error("Only a draft payroll can be recalculated", "INVALID_STATUS"));
    const updated = await prisma.$transaction((tx) => buildPayslips(tx, run.organizationId, run.id, run.periodYear, run.periodMonth));
    res.json(success(updated, "Payroll recalculated"));
  } catch (e) {
    fail(res, e);
  }
};

export const approveRun = async (req: AuthRequest, res: Response) => {
  try {
    const run = await findRun(req);
    if (!run) return res.status(404).json(error("Payroll run not found", "NOT_FOUND"));
    if (run.status !== "DRAFT") return res.status(400).json(error("Only a draft payroll can be approved", "INVALID_STATUS"));
    const approvedAt = new Date();
    const periodEnd = new Date(Date.UTC(run.periodYear, run.periodMonth, 0, 12));
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.payrollRun.update({
        where: { id: run.id },
        data: { status: "APPROVED", approvedById: userId(req), approvedAt },
      });
      await enqueuePayrollAccountingEvent(tx, row, "PAYROLL_APPROVED", periodEnd);
      return row;
    });
    await audit(req, `Approved payroll ${run.periodYear}-${String(run.periodMonth).padStart(2, "0")}`, "PayrollRun", run.id, {
      netPay: Number(updated.netPay),
    });
    res.json(success(updated, "Payroll approved and sent to Accounting"));
  } catch (e) {
    fail(res, e);
  }
};

export const payRun = async (req: AuthRequest, res: Response) => {
  try {
    const { paymentMethod } = z.object({ paymentMethod: z.enum(["BANK", "CASH", "MOBILE_MONEY"]) }).parse(req.body);
    const run = await findRun(req);
    if (!run) return res.status(404).json(error("Payroll run not found", "NOT_FOUND"));
    if (run.status !== "APPROVED") return res.status(400).json(error("Approve the payroll before recording payment", "INVALID_STATUS"));
    const paidAt = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.payrollRun.update({
        where: { id: run.id },
        data: { status: "PAID", paidById: userId(req), paidAt, paymentMethod },
      });
      await enqueuePayrollAccountingEvent(tx, row, "PAYROLL_PAID", paidAt);
      return row;
    });
    await audit(req, `Recorded payment of payroll ${run.periodYear}-${String(run.periodMonth).padStart(2, "0")}`, "PayrollRun", run.id, {
      paymentMethod,
    });
    res.json(success(updated, "Payment recorded and sent to Accounting"));
  } catch (e) {
    fail(res, e);
  }
};

export const cancelRun = async (req: AuthRequest, res: Response) => {
  try {
    const run = await findRun(req);
    if (!run) return res.status(404).json(error("Payroll run not found", "NOT_FOUND"));
    if (run.status !== "DRAFT") return res.status(400).json(error("Only a draft payroll can be cancelled", "INVALID_STATUS"));
    const updated = await prisma.payrollRun.update({ where: { id: run.id }, data: { status: "CANCELLED" } });
    await audit(req, `Cancelled payroll ${run.periodYear}-${String(run.periodMonth).padStart(2, "0")}`, "PayrollRun", run.id);
    res.json(success(updated, "Payroll cancelled"));
  } catch (e) {
    fail(res, e);
  }
};
