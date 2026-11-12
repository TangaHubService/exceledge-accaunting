import { hasCapability } from "@exceledge/accounting-domain";
import { Router } from "express";
import { z } from "zod";
import { actorOf, handle, HttpError, isoDay, optionalText } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { type AuthedRequest, authenticateErpJwt, requireCapability, resolveCompany } from "../../middleware/auth";
import * as commercial from "./commercial.service";

export const commercialRouter = Router();

commercialRouter.use(authenticateErpJwt, resolveCompany);

const roleOf = (req: AuthedRequest) => req.organizationRole ?? req.erpUser?.role;

/** Sales documents follow ar:*, purchase orders ap:*. */
function assertSide(req: AuthedRequest, slug: commercial.KindSlug, level: "view" | "manage") {
  const capability = `${commercial.capabilityFor(slug)}:${level}` as const;
  if (!hasCapability(roleOf(req), capability)) throw new HttpError(403, `Missing capability: ${capability}`);
}

function slugParam(req: AuthedRequest): commercial.KindSlug {
  const slug = req.params.kind;
  if (!commercial.isKindSlug(slug)) throw new HttpError(404, "Unknown document type");
  return slug;
}

async function loadSlug(req: AuthedRequest) {
  const row = await prisma.commercialDocument.findFirst({ where: { id: req.params.id, companyId: req.companyId! }, select: { kind: true } });
  if (!row) throw new HttpError(404, "Document does not exist");
  return commercial.slugOf(row.kind);
}

const str = (q: unknown) => (typeof q === "string" && q.trim() ? q.trim() : undefined);

commercialRouter.get("/next-numbers", handle((req) => commercial.nextNumbers(req.companyId!)));

commercialRouter.get(
  "/documents/:id",
  handle(async (req) => {
    assertSide(req, await loadSlug(req), "view");
    return commercial.getDocument(req.companyId!, req.params.id);
  }),
);

commercialRouter.put(
  "/documents/:id",
  handle(async (req) => {
    assertSide(req, await loadSlug(req), "manage");
    return commercial.updateDocument(req.companyId!, req.params.id, commercial.documentBody.parse(req.body), actorOf(req));
  }),
);

commercialRouter.post(
  "/documents/:id/status",
  handle(async (req) => {
    assertSide(req, await loadSlug(req), "manage");
    const body = z.object({ status: z.enum(commercial.STATUS_VALUES) }).parse(req.body);
    return commercial.setStatus(req.companyId!, req.params.id, body.status, actorOf(req));
  }),
);

commercialRouter.post(
  "/documents/:id/convert",
  handle(async (req) => {
    assertSide(req, await loadSlug(req), "manage");
    const body = commercial.convertBody.parse(req.body);
    const allowCreditOverride = Boolean(body.creditOverride) && hasCapability(roleOf(req), "ar:credit-override");
    return commercial.convertDocument(req.companyId!, req.params.id, body, { ...actorOf(req), allowCreditOverride });
  }),
);

commercialRouter.delete(
  "/documents/:id",
  handle(async (req) => {
    assertSide(req, await loadSlug(req), "manage");
    return commercial.deleteDocument(req.companyId!, req.params.id, actorOf(req));
  }),
);

commercialRouter.post(
  "/item-receipts/:id/bill",
  requireCapability("ap:manage"),
  handle((req) => {
    const body = z.object({ date: isoDay.optional(), dueDate: isoDay.optional(), supplierInvoiceNumber: optionalText(60) }).parse(req.body ?? {});
    return commercial.billItemReceipt(req.companyId!, req.params.id, body, actorOf(req));
  }),
);

commercialRouter.get(
  "/:kind",
  handle((req) => {
    const slug = slugParam(req);
    assertSide(req, slug, "view");
    return commercial.listDocuments(req.companyId!, slug, { status: str(req.query.status), q: str(req.query.q), customerId: str(req.query.customerId), supplierId: str(req.query.supplierId) });
  }),
);

commercialRouter.post(
  "/:kind",
  handle((req) => {
    const slug = slugParam(req);
    assertSide(req, slug, "manage");
    return commercial.createDocument(req.companyId!, slug, commercial.documentBody.parse(req.body), actorOf(req));
  }, 201),
);
