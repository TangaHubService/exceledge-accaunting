import { TAX_FILING_KINDS, TAX_TYPES } from "@exceledge/accounting-domain";
import { type Response, Router } from "express";
import { z } from "zod";
import { AuthedRequest, authenticateErpJwt, getRequestMeta, requireCapability, resolveCompany } from "../../middleware/auth";
import * as tax from "./tax.service";

export const taxRouter = Router();

taxRouter.use(authenticateErpJwt, requireCapability("tax:view"), resolveCompany);

function actor(req: AuthedRequest) {
  return { erpUserId: req.erpUser!.userId, erpRole: req.organizationRole ?? req.erpUser?.role, meta: getRequestMeta(req) };
}

function fail(res: Response, e: unknown, status = 400) {
  const message = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("; ") : (e as Error).message;
  res.status(status).json({ success: false, error: message });
}

type Handler = (req: AuthedRequest) => Promise<unknown>;
const handle = (fn: Handler, status = 200) => async (req: AuthedRequest, res: Response) => {
  try {
    res.status(status).json({ success: true, data: await fn(req) });
  } catch (e) {
    fail(res, e);
  }
};

const str = (q: unknown) => (typeof q === "string" && q.trim() ? q.trim() : undefined);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "Use a yyyy-mm-dd date");
const text = (max = 500) => z.string().trim().max(max).optional();
const money = z.number().positive().max(1e13);
const taxType = z.enum(TAX_TYPES);
const filingKind = z.enum(TAX_FILING_KINDS);

taxRouter.get("/dashboard", handle((req) => tax.taxDashboard(req.companyId!)));
taxRouter.get("/settings", handle((req) => tax.getTaxSettings(req.companyId!)));
taxRouter.put(
  "/settings",
  requireCapability("tax:manage"),
  handle(async (req) => {
    const body = z
      .object({
        taxAuthority: text(120),
        tin: z.string().regex(/^\d{9}$/, "TIN must be 9 digits").nullable().optional(),
        vatRegistered: z.boolean().optional(),
        vatFilingFrequency: text(40),
        taxCurrency: z.string().length(3).optional(),
        roundingMethod: text(40),
        defaultOutputTaxCodeId: z.string().nullable().optional(),
        defaultInputTaxCodeId: z.string().nullable().optional(),
        defaultWhtTaxCodeId: z.string().nullable().optional(),
        notes: text(2000),
      })
      .parse(req.body);
    return tax.updateTaxSettings(req.companyId!, body, actor(req));
  }),
);

taxRouter.get(
  "/codes",
  handle((req) => tax.listTaxCodes(req.companyId!, { includeInactive: req.query.all === "1", taxType: str(req.query.taxType) as never })),
);
taxRouter.post(
  "/codes",
  requireCapability("tax:manage"),
  handle(async (req) => {
    const body = z
      .object({
        code: z.string().trim().min(1).max(20),
        name: z.string().trim().min(1).max(120),
        taxType,
        ratePercent: z.number().min(0).max(100),
        glAccountId: z.string().optional(),
        authority: text(80),
        effectiveFrom: day,
        effectiveTo: day.optional(),
        appliesTo: text(40),
        notes: text(2000),
      })
      .parse(req.body);
    return tax.createTaxCode(req.companyId!, body, actor(req));
  }, 201),
);
taxRouter.patch(
  "/codes/:id",
  requireCapability("tax:manage"),
  handle(async (req) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        ratePercent: z.number().min(0).max(100).optional(),
        glAccountId: z.string().nullable().optional(),
        authority: text(80),
        effectiveFrom: day.optional(),
        effectiveTo: day.nullable().optional(),
        isActive: z.boolean().optional(),
        appliesTo: text(40),
        notes: text(2000),
      })
      .parse(req.body);
    return tax.updateTaxCode(req.companyId!, req.params.id, body, actor(req));
  }),
);

taxRouter.get("/reports/vat", handle((req) => tax.vatReport(req.companyId!, str(req.query.from), str(req.query.to))));
taxRouter.get(
  "/ledger",
  handle((req) =>
    tax.taxLedger(req.companyId!, {
      taxType: str(req.query.taxType) as never,
      from: str(req.query.from),
      to: str(req.query.to),
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 50,
    }),
  ),
);
taxRouter.get("/reconciliation", handle((req) => tax.taxReconciliationReport(req.companyId!, { from: str(req.query.from), to: str(req.query.to) })));

taxRouter.get(
  "/payments",
  handle((req) =>
    tax.listTaxPayments(req.companyId!, {
      from: str(req.query.from),
      to: str(req.query.to),
      taxType: str(req.query.taxType) as never,
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 50,
    }),
  ),
);
taxRouter.get("/payments/:id", handle((req) => tax.getTaxPayment(req.companyId!, req.params.id)));
taxRouter.post(
  "/payments",
  requireCapability("tax:manage"),
  handle(async (req) => {
    const body = z
      .object({
        paymentDate: day,
        taxType,
        taxCodeId: z.string().optional(),
        taxAccountId: z.string().optional(),
        bankAccountId: z.string().optional(),
        financialAccountId: z.string().optional(),
        amount: money,
        isRefund: z.boolean().optional(),
        reference: text(120),
        description: text(),
        periodFrom: day.optional(),
        periodTo: day.optional(),
      })
      .parse(req.body);
    return tax.recordTaxPayment(req.companyId!, body, actor(req));
  }, 201),
);
taxRouter.post(
  "/payments/:id/reverse",
  requireCapability("tax:manage"),
  handle(async (req) => {
    const body = z.object({ reason: z.string().trim().min(3).max(300), reversalDate: day.optional() }).parse(req.body);
    return tax.reverseTaxPayment(req.companyId!, req.params.id, body, actor(req));
  }),
);

taxRouter.post(
  "/adjustments",
  requireCapability("tax:manage"),
  handle(async (req) => {
    const body = z
      .object({
        adjustmentDate: day,
        taxType,
        taxCodeId: z.string().optional(),
        taxAccountId: z.string().optional(),
        contraAccountId: z.string().min(1),
        amount: money,
        increasesLiability: z.boolean().optional(),
        reason: z.string().trim().min(3).max(500),
        reference: text(120),
      })
      .parse(req.body);
    return tax.recordTaxAdjustment(req.companyId!, body, actor(req));
  }, 201),
);

taxRouter.get("/filings", handle((req) => tax.listFilings(req.companyId!, { kind: str(req.query.kind) as never })));
taxRouter.get("/filings/:id", handle((req) => tax.getFiling(req.companyId!, req.params.id)));
taxRouter.post(
  "/filings",
  requireCapability("tax:manage"),
  handle(async (req) => {
    const body = z
      .object({ kind: filingKind, periodFrom: day, periodTo: day, dueDate: day.optional(), notes: text(2000) })
      .parse(req.body);
    return tax.prepareFiling(req.companyId!, body, actor(req));
  }, 201),
);
taxRouter.post(
  "/filings/:id/file",
  requireCapability("tax:file"),
  handle(async (req) => {
    const body = z.object({ filingReference: text(120), filedAt: day.optional() }).parse(req.body);
    return tax.fileFiling(req.companyId!, req.params.id, body, actor(req));
  }),
);
taxRouter.delete("/filings/:id", requireCapability("tax:manage"), handle((req) => tax.discardFiling(req.companyId!, req.params.id, actor(req))));

taxRouter.get(
  "/fiscal-documents",
  handle((req) =>
    tax.listFiscalDocuments(req.companyId!, {
      from: str(req.query.from),
      to: str(req.query.to),
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 50,
    }),
  ),
);
