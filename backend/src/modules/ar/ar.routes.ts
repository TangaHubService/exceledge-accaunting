import { Router } from "express";
import { z } from "zod";
import { hasCapability } from "@exceledge/accounting-domain";
import {
  AuthedRequest,
  authenticateErpJwt,
  getRequestMeta,
  requireCapability,
  resolveCompany,
} from "../../middleware/auth";
import * as ar from "./ar.service";

export const arRouter = Router();

arRouter.use(authenticateErpJwt, requireCapability("ar:view"), resolveCompany);

function actor(req: AuthedRequest, creditOverride?: boolean) {
  const role = req.organizationRole ?? req.erpUser?.role;
  return {
    erpUserId: req.erpUser!.userId,
    erpRole: role,
    allowCreditOverride: Boolean(creditOverride) && hasCapability(role, "ar:credit-override"),
    meta: getRequestMeta(req),
  };
}

const customerType = z.enum([
  "CASH",
  "CREDIT",
  "WALK_IN",
  "GOVERNMENT",
  "CORPORATE",
  "NGO",
  "INDIVIDUAL",
  "EXPORT",
  "FOREIGN",
]);
const payMethod = z.enum(["CASH", "BANK", "MOBILE_MONEY", "CARD", "CHEQUE", "ONLINE"]);

arRouter.get("/dashboard", async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await ar.arDashboard(req.companyId!) });
});

arRouter.get("/ageing", async (req: AuthedRequest, res) => {
  const asOf = typeof req.query.asOf === "string" ? req.query.asOf : undefined;
  res.json({ success: true, data: await ar.ageingReport(req.companyId!, asOf) });
});

arRouter.get("/customers", async (req: AuthedRequest, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  res.json({ success: true, data: await ar.listCustomers(req.companyId!, q) });
});

arRouter.post("/customers", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        code: z.string().optional(),
        name: z.string().min(1),
        customerType: customerType.optional(),
        category: z.string().optional(),
        tin: z.string().optional(),
        telephone: z.string().optional(),
        email: z.string().optional(),
        currency: z.string().optional(),
        paymentTerms: z.string().optional(),
        creditLimit: z.number().optional(),
        creditPeriodDays: z.number().int().optional(),
        creditStatus: z.enum(["GOOD", "WATCH", "ON_HOLD", "BLOCKED"]).optional(),
        openingBalance: z.number().optional(),
        notes: z.string().optional(),
        physicalAddress: z.string().optional(),
      })
      .parse(req.body);
    const data = await ar.createCustomer(req.companyId!, body, actor(req));
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

arRouter.get("/customers/:id", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await ar.getCustomer(req.companyId!, req.params.id) });
  } catch (e) {
    res.status(404).json({ success: false, error: (e as Error).message });
  }
});

arRouter.patch("/customers/:id", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        name: z.string().min(1).optional(),
        customerType: customerType.optional(),
        creditLimit: z.number().optional(),
        creditPeriodDays: z.number().int().optional(),
        creditStatus: z.enum(["GOOD", "WATCH", "ON_HOLD", "BLOCKED"]).optional(),
        status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
        notes: z.string().optional(),
        paymentTerms: z.string().optional(),
        telephone: z.string().optional(),
        email: z.string().optional(),
      })
      .parse(req.body);
    res.json({ success: true, data: await ar.updateCustomer(req.companyId!, req.params.id, body, actor(req)) });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

arRouter.get("/customers/:id/ledger", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await ar.customerLedger(req.companyId!, req.params.id) });
  } catch (e) {
    res.status(404).json({ success: false, error: (e as Error).message });
  }
});

arRouter.get("/customers/:id/statement", async (req: AuthedRequest, res) => {
  try {
    const type = req.query.type === "FULL" ? "FULL" : "OUTSTANDING";
    res.json({ success: true, data: await ar.customerStatement(req.companyId!, req.params.id, type) });
  } catch (e) {
    res.status(404).json({ success: false, error: (e as Error).message });
  }
});

arRouter.post("/invoices", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        customerId: z.string().min(1),
        invoiceDate: z.string(),
        dueDate: z.string().optional(),
        net: z.number().positive(),
        tax: z.number().min(0).optional(),
        discount: z.number().min(0).optional(),
        description: z.string().optional(),
        currency: z.string().optional(),
        creditOverride: z.boolean().optional(),
      })
      .parse(req.body);
    const data = await ar.createInvoice(req.companyId!, body, actor(req, body.creditOverride));
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

arRouter.post("/receipts", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        customerId: z.string().min(1),
        receiptDate: z.string(),
        method: payMethod.optional(),
        amount: z.number().positive(),
        reference: z.string().optional(),
        description: z.string().optional(),
        allowOverpayment: z.boolean().optional(),
        financialAccountId: z.string().optional(),
        allocations: z.array(z.object({ invoiceId: z.string(), amount: z.number().positive() })).optional(),
      })
      .parse(req.body);
    const data = await ar.createReceipt(req.companyId!, body, actor(req));
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

arRouter.post("/receipts/:id/reverse", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await ar.reverseReceipt(req.companyId!, req.params.id, actor(req)) });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

arRouter.post("/credit-notes", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        customerId: z.string().min(1),
        invoiceId: z.string().optional(),
        noteDate: z.string(),
        reason: z.string().min(1),
        net: z.number().positive(),
        tax: z.number().min(0).optional(),
        description: z.string().optional(),
      })
      .parse(req.body);
    res.status(201).json({ success: true, data: await ar.createCreditNote(req.companyId!, body, actor(req)) });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

arRouter.post("/debit-notes", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        customerId: z.string().min(1),
        noteDate: z.string(),
        dueDate: z.string().optional(),
        reason: z.string().min(1),
        net: z.number().positive(),
        tax: z.number().min(0).optional(),
        description: z.string().optional(),
        creditOverride: z.boolean().optional(),
      })
      .parse(req.body);
    res.status(201).json({
      success: true,
      data: await ar.createDebitNote(req.companyId!, body, actor(req, body.creditOverride)),
    });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

arRouter.post("/deposits", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        customerId: z.string().min(1),
        depositDate: z.string(),
        method: payMethod.optional(),
        amount: z.number().positive(),
        reference: z.string().optional(),
        description: z.string().optional(),
      })
      .parse(req.body);
    res.status(201).json({ success: true, data: await ar.createDeposit(req.companyId!, body, actor(req)) });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

arRouter.post("/deposits/:id/allocate", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ invoiceId: z.string(), amount: z.number().positive() }).parse(req.body);
    res.json({ success: true, data: await ar.allocateDeposit(req.companyId!, req.params.id, body, actor(req)) });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

arRouter.post("/deposits/:id/refund", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await ar.refundDeposit(req.companyId!, req.params.id, actor(req)) });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});
