import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import {
  AuthedRequest,
  authenticateErpJwt,
  getRequestMeta,
  requireCapability,
  resolveCompany,
} from "../../middleware/auth";
import * as integration from "./integration.service";

export const integrationRouter = Router();

function requireIntegrationKey(req: AuthedRequest, res: import("express").Response, next: import("express").NextFunction) {
  const key = req.header("x-integration-key") || req.header("x-api-key");
  if (!key || key !== env.integrationApiKey) {
    return res.status(401).json({ success: false, error: "Invalid integration API key" });
  }
  return next();
}

const envelopeSchema = z.object({
  eventId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  externalOrganizationId: z.union([z.string(), z.number()]).transform(String),
  externalBranchId: z.union([z.string(), z.number()]).nullable().optional(),
  eventType: z.string().min(1),
  occurredAt: z.string(),
  sourceModule: z.string().min(1),
  sourceDocumentType: z.string().min(1),
  sourceDocumentId: z.union([z.string(), z.number()]).transform(String),
  sourceDocumentNumber: z.string().optional(),
  currencyCode: z.string().min(1),
  amountTotals: z.object({
    gross: z.union([z.string(), z.number()]).transform(String),
    net: z.union([z.string(), z.number()]).transform(String),
    tax: z.union([z.string(), z.number()]).transform(String),
    discount: z.union([z.string(), z.number()]).optional().transform((v) => (v == null ? undefined : String(v))),
  }),
  parties: z
    .object({
      externalCustomerId: z.union([z.string(), z.number()]).optional(),
      externalSupplierId: z.union([z.string(), z.number()]).optional(),
    })
    .optional(),
  lines: z.array(z.any()).optional(),
  paymentSplits: z.array(z.any()).optional(),
  taxSummary: z.array(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
  correlationId: z.string().optional(),
});

integrationRouter.post("/events", requireIntegrationKey, async (req, res) => {
  try {
    const body = envelopeSchema.parse(req.body);
    const result = await integration.ingestEvent({
      ...body,
      externalBranchId:
        body.externalBranchId == null ? null : String(body.externalBranchId),
      amountTotals: {
        gross: body.amountTotals.gross,
        net: body.amountTotals.net,
        tax: body.amountTotals.tax,
        discount: body.amountTotals.discount,
      },
    });
    res.status(result.duplicate ? 200 : 201).json({ success: true, data: result });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

integrationRouter.get(
  "/events/:idempotencyKey",
  requireIntegrationKey,
  async (req, res) => {
    try {
      const orgId = String(req.query.externalOrganizationId ?? "");
      if (!orgId) throw new Error("externalOrganizationId query required");
      const company = await (
        await import("../../lib/prisma")
      ).prisma.company.findUnique({
        where: { externalErpOrganizationId: orgId },
      });
      if (!company) throw new Error("Company not found");
      const data = await integration.getEventByIdempotency(
        company.id,
        req.params.idempotencyKey,
      );
      res.json({ success: true, data });
    } catch (e) {
      res.status(400).json({ success: false, error: (e as Error).message });
    }
  },
);

integrationRouter.post("/process-pending", requireIntegrationKey, async (req, res) => {
  const data = await integration.processPendingEvents(Number(req.body?.limit ?? 20));
  res.json({ success: true, data });
});

/** Human-facing exception queue (ERP JWT) */
export const exceptionsRouter = Router();
exceptionsRouter.use(authenticateErpJwt, requireCapability("exceptions:view"), resolveCompany);

exceptionsRouter.get("/", async (req: AuthedRequest, res) => {
  const data = await integration.listExceptions(
    req.companyId!,
    typeof req.query.status === "string" ? req.query.status : undefined,
  );
  res.json({ success: true, data });
});

exceptionsRouter.post(
  "/:id/retry",
  requireCapability("exceptions:retry"),
  async (req: AuthedRequest, res) => {
    try {
      const data = await integration.retryException(
        req.companyId!,
        req.params.id,
        req.erpUser?.userId,
      );
      res.json({ success: true, data });
    } catch (e) {
      res.status(400).json({ success: false, error: (e as Error).message });
    }
  },
);
