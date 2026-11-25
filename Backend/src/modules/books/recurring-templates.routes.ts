import { Router } from "express";
import { actorOf, handle } from "../../lib/http";
import { type AuthedRequest, authenticateErpJwt, can, requireCapability, resolveCompany } from "../../middleware/auth";
import { inTransaction } from "../../lib/prisma";
import * as templates from "./recurring-templates.service";

export const recurringRouter = Router();
recurringRouter.use(authenticateErpJwt, requireCapability("report:view"), resolveCompany);

const canOf = (req: AuthedRequest) => (c: Parameters<typeof can>[1]) => can(req, c);

recurringRouter.get("/", handle((req) => templates.listTemplates(req.companyId!)));
recurringRouter.post("/", handle((req) => inTransaction(() => templates.createTemplate(req.companyId!, templates.templateBody.parse(req.body), actorOf(req), canOf(req))), 201));
recurringRouter.put("/:id", handle((req) => inTransaction(() => templates.updateTemplate(req.companyId!, req.params.id, templates.templateBody.parse(req.body), actorOf(req), canOf(req)))));
recurringRouter.delete("/:id", handle((req) => inTransaction(() => templates.deleteTemplate(req.companyId!, req.params.id, actorOf(req), canOf(req)))));
recurringRouter.post("/:id/use", handle((req) => templates.useTemplate(req.companyId!, req.params.id, actorOf(req), canOf(req)), 201));
