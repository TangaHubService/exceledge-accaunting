import { AP_PAYMENT_METHODS } from "@exceledge/accounting-domain";
import { type Response, Router } from "express";
import { z } from "zod";
import { AuthedRequest, authenticateErpJwt, getRequestMeta, requireCapability, resolveCompany } from "../../middleware/auth";
import * as ap from "./ap.service";

export const apRouter = Router();

apRouter.use(authenticateErpJwt, requireCapability("ap:view"), resolveCompany);

function actor(req: AuthedRequest) {
  return {
    erpUserId: req.erpUser!.userId,
    erpRole: req.organizationRole ?? req.erpUser?.role,
    meta: getRequestMeta(req),
  };
}

function fail(res: Response, e: unknown, status = 400) {
  const message = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("; ") : (e as Error).message;
  res.status(status).json({ success: false, error: message });
}

const str = (q: unknown) => (typeof q === "string" && q.trim() ? q.trim() : undefined);
const payMethod = z.enum(AP_PAYMENT_METHODS);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "Use a yyyy-mm-dd date");
const optionalText = z.string().trim().max(500).optional();

const supplierFields = {
  name: z.string().trim().min(1).max(200),
  category: optionalText,
  tin: z.string().regex(/^\d{9}$/, "TIN must be 9 digits").optional(),
  vatNumber: optionalText,
  registrationNumber: optionalText,
  contactPerson: optionalText,
  telephone: optionalText,
  mobile: optionalText,
  email: z.string().email().optional(),
  website: optionalText,
  physicalAddress: optionalText,
  country: optionalText,
  province: optionalText,
  district: optionalText,
  sector: optionalText,
  cell: optionalText,
  village: optionalText,
  currency: z.string().length(3).optional(),
  paymentTerms: optionalText,
  creditPeriodDays: z.number().int().min(0).max(3650).optional(),
  apAccountId: z.string().optional(),
  defaultExpenseAccountId: z.string().optional(),
  defaultInventoryAccountId: z.string().optional(),
  taxCategory: optionalText,
  whtCategory: optionalText,
  whtRate: z.number().min(0).lt(100).optional(),
  bankName: optionalText,
  bankAccountNumber: optionalText,
  branchId: z.string().optional(),
  costCentre: optionalText,
  notes: z.string().max(4000).optional(),
};

apRouter.get("/dashboard", async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await ap.apDashboard(req.companyId!) });
});

apRouter.get("/ageing", async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await ap.ageingReport(req.companyId!, str(req.query.asOf)) });
});

apRouter.get("/reports/withholding", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await ap.withholdingReport(req.companyId!, str(req.query.from), str(req.query.to)) });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.get("/reports/purchases-by-supplier", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await ap.purchasesBySupplier(req.companyId!, str(req.query.from), str(req.query.to)) });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.get("/suppliers", async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await ap.listSuppliers(req.companyId!, str(req.query.q)) });
});

apRouter.post("/suppliers", requireCapability("ap:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({ ...supplierFields, code: z.string().trim().max(40).optional(), openingBalance: z.number().min(0).optional() })
      .parse(req.body);
    res.status(201).json({ success: true, data: await ap.createSupplier(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.get("/suppliers/:id", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await ap.getSupplier(req.companyId!, req.params.id) });
  } catch (e) {
    fail(res, e, 404);
  }
});

apRouter.patch("/suppliers/:id", requireCapability("ap:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({ ...supplierFields, status: z.enum(["ACTIVE", "INACTIVE"]) })
      .partial()
      .omit({ tin: true })
      .parse(req.body);
    res.json({ success: true, data: await ap.updateSupplier(req.companyId!, req.params.id, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.get("/suppliers/:id/ledger", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await ap.supplierLedger(req.companyId!, req.params.id) });
  } catch (e) {
    fail(res, e, 404);
  }
});

apRouter.get("/suppliers/:id/statement", async (req: AuthedRequest, res) => {
  try {
    const type = req.query.type === "FULL" ? "FULL" : "OUTSTANDING";
    res.json({ success: true, data: await ap.supplierStatement(req.companyId!, req.params.id, type) });
  } catch (e) {
    fail(res, e, 404);
  }
});

apRouter.get("/bills", async (req: AuthedRequest, res) => {
  const status = req.query.status === "ALL" ? "ALL" : "OPEN";
  res.json({ success: true, data: await ap.listBills(req.companyId!, { status, supplierId: str(req.query.supplierId) }) });
});

apRouter.post("/bills", requireCapability("ap:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        supplierId: z.string().min(1),
        supplierInvoiceNumber: z.string().trim().max(80).optional(),
        billDate: day,
        dueDate: day.optional(),
        poReference: z.string().trim().max(80).optional(),
        grnReference: z.string().trim().max(80).optional(),
        net: z.number().positive(),
        tax: z.number().min(0).optional(),
        discount: z.number().min(0).optional(),
        expenseAccountId: z.string().optional(),
        description: optionalText,
      })
      .parse(req.body);
    res.status(201).json({ success: true, data: await ap.createBill(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.get("/payments", async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await ap.listPayments(req.companyId!, { supplierId: str(req.query.supplierId) }) });
});

apRouter.post("/payments", requireCapability("ap:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        supplierId: z.string().min(1),
        paymentDate: day,
        method: payMethod.optional(),
        amount: z.number().positive(),
        withholdingTax: z.number().min(0).optional(),
        reference: z.string().trim().max(120).optional(),
        description: optionalText,
        allowUnallocated: z.boolean().optional(),
        financialAccountId: z.string().optional(),
        allocations: z.array(z.object({ billId: z.string().min(1), amount: z.number().positive() })).optional(),
      })
      .parse(req.body);
    res.status(201).json({ success: true, data: await ap.createPayment(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.post("/payments/:id/reverse", requireCapability("ap:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ reason: z.string().trim().max(300).optional(), reversalDate: day.optional() }).parse(req.body ?? {});
    res.json({ success: true, data: await ap.reversePayment(req.companyId!, req.params.id, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.post("/credit-notes", requireCapability("ap:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        supplierId: z.string().min(1),
        billId: z.string().optional(),
        supplierReference: z.string().trim().max(80).optional(),
        noteDate: day,
        reason: z.string().trim().min(1).max(300),
        net: z.number().positive(),
        tax: z.number().min(0).optional(),
        description: optionalText,
      })
      .parse(req.body);
    res.status(201).json({ success: true, data: await ap.createCreditNote(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.post("/debit-notes", requireCapability("ap:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        supplierId: z.string().min(1),
        supplierReference: z.string().trim().max(80).optional(),
        noteDate: day,
        dueDate: day.optional(),
        reason: z.string().trim().min(1).max(300),
        net: z.number().positive(),
        tax: z.number().min(0).optional(),
        expenseAccountId: z.string().optional(),
        description: optionalText,
      })
      .parse(req.body);
    res.status(201).json({ success: true, data: await ap.createDebitNote(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.get("/advances", async (req: AuthedRequest, res) => {
  res.json({
    success: true,
    data: await ap.listAdvances(req.companyId!, { supplierId: str(req.query.supplierId), openOnly: req.query.open === "1" }),
  });
});

apRouter.post("/advances", requireCapability("ap:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        supplierId: z.string().min(1),
        advanceDate: day,
        method: payMethod.optional(),
        amount: z.number().positive(),
        reference: z.string().trim().max(120).optional(),
        description: optionalText,
      })
      .parse(req.body);
    res.status(201).json({ success: true, data: await ap.createAdvance(req.companyId!, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.post("/advances/:id/allocate", requireCapability("ap:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ billId: z.string().min(1), amount: z.number().positive(), allocationDate: day.optional() }).parse(req.body);
    res.json({ success: true, data: await ap.allocateAdvance(req.companyId!, req.params.id, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.post("/advances/:id/refund", requireCapability("ap:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({ amount: z.number().positive().optional(), method: payMethod.optional(), refundDate: day.optional() })
      .parse(req.body ?? {});
    res.json({ success: true, data: await ap.refundAdvance(req.companyId!, req.params.id, body, actor(req)) });
  } catch (e) {
    fail(res, e);
  }
});
