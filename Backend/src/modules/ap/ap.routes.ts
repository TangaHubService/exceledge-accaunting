import { AP_PAYMENT_METHODS, hasCapability } from "@exceledge/accounting-domain";
import { type Response, Router } from "express";
import { z } from "zod";
import { AuthedRequest, authenticate, getRequestMeta, requireCapability, resolveCompany } from "../../middleware/auth";
import { inTransaction } from "../../lib/prisma";
import { documentLines, notFoundStatus, periodQuery, sendPdf } from "../../lib/http-documents";
import { exportFormat, sendReport } from "../../lib/report-export";
import * as print from "../print/print.service";
import { ageingDocument, withholdingDocument } from "../books/report-documents";
import * as ap from "./ap.service";
import * as suppliers from "./suppliers.service";
import * as profile from "./supplier-profile.service";
import { parsePage, wantsPage } from "../../lib/pagination";

export const apRouter = Router();

apRouter.use(authenticate, requireCapability("ap:view"), resolveCompany);

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

const nullableText = z.string().trim().max(500).optional().nullable();
const blankToNull = <T extends z.ZodTypeAny>(schema: T) => schema.optional().nullable().or(z.literal("").transform(() => null));

const supplierFields = {
  name: z.string().trim().min(1, "Display name is required").max(200),
  companyName: nullableText,
  firstName: z.string().trim().max(100).optional().nullable(),
  lastName: z.string().trim().max(100).optional().nullable(),
  supplierType: z.enum(["BUSINESS", "INDIVIDUAL", "GOVERNMENT", "NON_PROFIT"]).optional(),
  category: nullableText,
  tin: blankToNull(z.string().trim().regex(/^\d{9}$/, "TIN must be 9 digits")),
  vatRegistered: z.boolean().optional(),
  vatNumber: nullableText,
  registrationNumber: nullableText,
  contactPerson: nullableText,
  telephone: nullableText,
  mobile: nullableText,
  email: blankToNull(z.string().trim().email("Email is not valid")),
  website: nullableText,
  alternateContact: nullableText,
  physicalAddress: nullableText,
  postalCode: z.string().trim().max(20).optional().nullable(),
  country: nullableText,
  province: nullableText,
  district: nullableText,
  sector: nullableText,
  cell: nullableText,
  village: nullableText,
  currency: z.string().length(3).optional(),
  paymentTerms: nullableText,
  creditPeriodDays: z.number().int().min(0).max(3650).optional(),
  apAccountId: z.string().optional().nullable(),
  defaultExpenseAccountId: z.string().optional().nullable(),
  defaultInventoryAccountId: z.string().optional().nullable(),
  taxCategory: nullableText,
  whtCategory: nullableText,
  whtRate: z.number().min(0).lt(100).optional(),
  preferredPaymentMethod: payMethod.optional().nullable(),
  bankName: nullableText,
  bankAccountHolder: nullableText,
  bankAccountNumber: z.string().trim().max(60).optional().nullable(),
  creditLimit: z.number().min(0, "Credit limit can't be negative").optional(),
  branchId: z.string().optional().nullable(),
  costCentre: nullableText,
  notes: z.string().max(4000).optional().nullable(),
  internalRemarks: z.string().max(4000).optional().nullable(),
};

const creditApplication = z.object({
  source: z.enum(["CREDIT_NOTE", "PAYMENT", "ADVANCE"]),
  sourceId: z.string().min(1),
  billId: z.string().min(1),
  amount: z.number().positive(),
});

const supplierListFilter = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(["active", "inactive", "all"]).optional(),
  balance: z.enum(["owing", "overdue", "credit"]).optional(),
  category: z.string().max(100).optional(),
  type: z.enum(["BUSINESS", "INDIVIDUAL", "GOVERNMENT", "NON_PROFIT"]).optional(),
  sort: z.enum(["name", "code", "balance", "purchases", "lastActivity", "created"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});

/** "Mobile money" → "MOBILE_MONEY", for enum cells typed by hand in a spreadsheet. */
const enumCell = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase().replace(/[\s-]+/g, "_") : undefined);

/** Turns nulls from the create form into "not given". */
function dropNulls<T extends Record<string, unknown>>(o: T) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as { [K in keyof T]: Exclude<T[K], null> };
}


apRouter.get("/dashboard", async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await ap.apDashboard(req.companyId!) });
});

apRouter.get("/ageing", async (req: AuthedRequest, res) => {
  try {
    const format = exportFormat(req.query.format);
    const data = await ap.ageingReport(req.companyId!, str(req.query.asOf));
    if (format) return await sendReport(res, await ageingDocument(req.companyId!, "ap", data), format);
    res.json({ success: true, data });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.get("/reports/withholding", async (req: AuthedRequest, res) => {
  try {
    const format = exportFormat(req.query.format);
    const data = await ap.withholdingReport(req.companyId!, str(req.query.from), str(req.query.to));
    if (format) return await sendReport(res, await withholdingDocument(req.companyId!, data), format);
    res.json({ success: true, data });
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

/** Without `page`: the full array transaction pickers use. With `page`: the paged supplier centre list with counts. */
apRouter.get("/suppliers", async (req: AuthedRequest, res) => {
  if (!wantsPage(req.query)) return res.json({ success: true, data: await ap.listSuppliers(req.companyId!, str(req.query.q)) });
  try {
    const filter = supplierListFilter.parse(req.query);
    res.json({ success: true, data: await suppliers.listSuppliersPage(req.companyId!, filter, parsePage(req.query, { defaultSize: 25, maxSize: 200 })) });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.post("/suppliers", requireCapability("ap:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        ...supplierFields,
        code: z.string().trim().max(40).optional(),
        openingBalance: z.number().min(0, "Opening balance can't be negative").optional(),
        openingBalanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Opening balance date must be yyyy-mm-dd").optional(),
      })
      .parse(req.body);
    res.status(201).json({ success: true, data: await inTransaction(() => ap.createSupplier(req.companyId!, dropNulls(body), actor(req))) });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.get("/suppliers/money-bar", async (req: AuthedRequest, res) => {
  res.json({ success: true, data: await suppliers.apMoneyBar(req.companyId!, str(req.query.supplierId)) });
});

apRouter.get("/suppliers/duplicates", async (req: AuthedRequest, res) => {
  res.json({
    success: true,
    data: await suppliers.findSupplierDuplicates(req.companyId!, {
      name: str(req.query.name),
      tin: str(req.query.tin),
      email: str(req.query.email),
      phone: str(req.query.phone),
      exceptId: str(req.query.exceptId),
    }),
  });
});

apRouter.get("/suppliers/export.csv", async (req: AuthedRequest, res) => {
  try {
    const filter = supplierListFilter.parse(req.query);
    const csv = await suppliers.exportSuppliersCsv(req.companyId!, filter);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="suppliers-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (e) {
    fail(res, e);
  }
});

apRouter.post("/suppliers/import", requireCapability("ap:manage"), async (req: AuthedRequest, res) => {
  try {
    const { name: _name, ...optional } = supplierFields;
    const row = z.object({
      ...Object.fromEntries(
        (["companyName", "supplierType", "category", "contactPerson", "email", "telephone", "mobile", "website", "tin", "vatRegistered", "physicalAddress", "district", "province", "country", "creditPeriodDays", "preferredPaymentMethod", "bankName", "bankAccountHolder", "bankAccountNumber", "notes"] as const).map((k) => [k, optional[k]]),
      ),
      name: z.string().trim().max(200),
      // Checked row by row in the service, so one bad cell is reported on its row instead of failing the file.
      tin: z.string().trim().max(20).optional().nullable(),
      email: z.string().trim().max(200).optional().nullable(),
      // Spreadsheets say "Business" or "mobile money"; an unknown value falls back to the default instead of failing the file.
      supplierType: z.preprocess(enumCell, z.enum(["BUSINESS", "INDIVIDUAL", "GOVERNMENT", "NON_PROFIT"]).optional()).catch(undefined),
      preferredPaymentMethod: z.preprocess(enumCell, payMethod.optional()).catch(undefined),
      category: z.preprocess(enumCell, z.string().max(100).optional()),
      openingBalance: z.number().optional(),
      openingBalanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Opening balance date must be yyyy-mm-dd").optional(),
    });
    const body = z.object({ dryRun: z.boolean().optional(), rows: z.array(row).min(1, "The file has no rows").max(2000, "Import at most 2,000 suppliers at a time") }).parse(req.body);
    const rows = body.rows.map((r) => dropNulls(r) as unknown as suppliers.SupplierImportRow);
    res.json({ success: true, data: await suppliers.importSuppliers(req.companyId!, rows, { dryRun: body.dryRun }, actor(req), inTransaction) });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.post("/suppliers/bulk-status", requireCapability("ap:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ ids: z.array(z.string().min(1)).min(1).max(500), status: z.enum(["ACTIVE", "INACTIVE"]) }).parse(req.body);
    res.json({ success: true, data: await suppliers.bulkSetStatus(req.companyId!, body.ids, body.status, actor(req)) });
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
      .parse(req.body);
    res.json({ success: true, data: await inTransaction(() => ap.updateSupplier(req.companyId!, req.params.id, body, actor(req))) });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.get("/suppliers/:id/notes", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await suppliers.listSupplierNotes(req.companyId!, req.params.id) });
  } catch (e) {
    fail(res, e, 404);
  }
});

apRouter.post("/suppliers/:id/notes", requireCapability("ap:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ body: z.string().max(4000) }).parse(req.body);
    const data = await suppliers.addSupplierNote(req.companyId!, req.params.id, body.body, { erpUserId: req.erpUser!.userId, name: req.erpUser!.email });
    res.status(201).json({ success: true, data });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.get("/suppliers/:id/summary", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await profile.supplierSummary(req.companyId!, req.params.id) });
  } catch (e) {
    fail(res, e, 404);
  }
});

apRouter.get("/suppliers/:id/transactions", async (req: AuthedRequest, res) => {
  try {
    const filter = z
      .object({
        type: z.enum(profile.SUPPLIER_TXN_TYPES).optional(),
        status: z.enum(["open", "overdue", "closed"]).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .parse(req.query);
    const can = (c: "expense:view" | "inventory:view") => (req.apiKey ? req.apiKey.scopes.includes(c) : hasCapability(req.organizationRole ?? req.erpUser?.role, c));
    const hidden: profile.SupplierTxnType[] = [...(can("expense:view") ? [] : (["EXPENSE"] as const)), ...(can("inventory:view") ? [] : (["ITEM_RECEIPT"] as const))];
    res.json({ success: true, data: await profile.supplierTransactions(req.companyId!, req.params.id, filter, parsePage(req.query, { defaultSize: 25, maxSize: 200 }), hidden) });
  } catch (e) {
    fail(res, e, e instanceof z.ZodError ? 400 : 404);
  }
});

apRouter.get("/suppliers/:id/credits", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await profile.supplierCredits(req.companyId!, req.params.id) });
  } catch (e) {
    fail(res, e, 404);
  }
});

apRouter.get("/suppliers/:id/activity", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await profile.supplierActivity(req.companyId!, req.params.id) });
  } catch (e) {
    fail(res, e, 404);
  }
});

apRouter.get("/transactions/:type/:id", async (req: AuthedRequest, res) => {
  try {
    const type = z.enum(["PAYMENT", "CREDIT_NOTE", "DEBIT_NOTE", "ADVANCE", "EXPENSE", "ITEM_RECEIPT"]).parse(req.params.type);
    // Expenses and goods receipts belong to other modules; seeing them needs that module's permission too.
    const needs = type === "EXPENSE" ? "expense:view" : type === "ITEM_RECEIPT" ? "inventory:view" : null;
    if (needs && !(req.apiKey ? req.apiKey.scopes.includes(needs) : hasCapability(req.organizationRole ?? req.erpUser?.role, needs))) {
      return res.status(403).json({ success: false, error: `Missing capability: ${needs}` });
    }
    res.json({ success: true, data: await profile.supplierTransactionDetail(req.companyId!, type, req.params.id) });
  } catch (e) {
    fail(res, e, e instanceof z.ZodError ? 400 : 404);
  }
});

apRouter.get("/suppliers/:id/open-items", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await ap.supplierOpenItems(req.companyId!, req.params.id) });
  } catch (e) {
    fail(res, e, 404);
  }
});

apRouter.post("/suppliers/:id/apply-credits", requireCapability("ap:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ applications: z.array(creditApplication).min(1).max(200), date: day.optional() }).parse(req.body);
    res.json({ success: true, data: await inTransaction(() => ap.applySupplierCredits(req.companyId!, req.params.id, body, actor(req))) });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.get("/bills/:id/applications", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await ap.billApplications(req.companyId!, req.params.id) });
  } catch (e) {
    fail(res, e, 404);
  }
});

apRouter.post("/bills/:id/unapply", requireCapability("ap:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ kind: z.enum(["PAYMENT", "CREDIT_NOTE", "CREDIT_ON_ISSUE", "ADVANCE"]), applicationId: z.string().min(1) }).parse(req.body);
    const data = await inTransaction(async () => {
      // The application must belong to this bill, so a stale screen can't take a credit off another one.
      const listed = await ap.billApplications(req.companyId!, req.params.id);
      if (!listed.rows.some((r) => r.kind === body.kind && r.id === body.applicationId)) throw new Error("That is no longer applied to this bill");
      return ap.unapplyFromBill(req.companyId!, body.kind, body.applicationId, actor(req));
    });
    res.json({ success: true, data });
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
        net: z.number().positive().optional(),
        tax: z.number().min(0).optional(),
        discount: z.number().min(0).optional(),
        expenseAccountId: z.string().optional(),
        description: optionalText,
        lines: documentLines.optional(),
      })
      .parse(req.body);
    res.status(201).json({ success: true, data: await inTransaction(() => ap.createBill(req.companyId!, body, actor(req))) });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.get("/bills/:id", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await ap.getBill(req.companyId!, req.params.id) });
  } catch (e) {
    fail(res, e, 404);
  }
});

apRouter.post("/bills/:id/void", requireCapability("ap:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ reason: z.string().trim().min(1).max(300), voidDate: day.optional() }).parse(req.body ?? {});
    res.json({ success: true, data: await inTransaction(() => ap.voidBill(req.companyId!, req.params.id, body, actor(req))) });
  } catch (e) {
    fail(res, e, notFoundStatus(e));
  }
});

apRouter.get("/suppliers/:id/period-statement", async (req: AuthedRequest, res) => {
  try {
    const { from, to } = periodQuery.parse(req.query);
    res.json({ success: true, data: await ap.supplierPeriodStatement(req.companyId!, req.params.id, from, to) });
  } catch (e) {
    fail(res, e, notFoundStatus(e));
  }
});

apRouter.get("/suppliers/:id/statement.pdf", async (req: AuthedRequest, res) => {
  try {
    const { from, to } = periodQuery.parse(req.query);
    sendPdf(res, await print.supplierStatementPdf(req.companyId!, req.params.id, from, to));
  } catch (e) {
    fail(res, e, notFoundStatus(e));
  }
});

apRouter.get("/payments/:id/remittance.pdf", async (req: AuthedRequest, res) => {
  try {
    sendPdf(res, await print.remittancePdf(req.companyId!, req.params.id));
  } catch (e) {
    fail(res, e, 404);
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
        amount: z.number().min(0),
        withholdingTax: z.number().min(0).optional(),
        reference: z.string().trim().max(120).optional(),
        description: optionalText,
        allowUnallocated: z.boolean().optional(),
        financialAccountId: z.string().optional(),
        allocations: z.array(z.object({ billId: z.string().min(1), amount: z.number().positive() })).optional(),
        credits: z.array(creditApplication).max(200).optional(),
      })
      .refine((b) => b.amount > 0 || (b.credits?.length ?? 0) > 0, { message: "Payment amount must be positive", path: ["amount"] })
      .parse(req.body);
    const data = await inTransaction(async () => {
      // Credits alone can settle the bills; then there is no cash payment to record.
      if (body.amount === 0) {
        if (body.allocations?.length) throw new Error("Enter the amount paid for the bills you selected");
        return { payment: null, credited: await ap.applySupplierCredits(req.companyId!, body.supplierId, { applications: body.credits!, date: body.paymentDate }, actor(req)) };
      }
      return ap.createPayment(req.companyId!, body, actor(req));
    });
    res.status(201).json({ success: true, data });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.post("/payments/:id/reverse", requireCapability("ap:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ reason: z.string().trim().max(300).optional(), reversalDate: day.optional() }).parse(req.body ?? {});
    res.json({ success: true, data: await inTransaction(() => ap.reversePayment(req.companyId!, req.params.id, body, actor(req))) });
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
        returnedItems: z
          .array(z.object({ itemId: z.string().min(1), locationId: z.string().min(1), quantity: z.number().positive() }))
          .max(200)
          .optional(),
      })
      .parse(req.body);
    res.status(201).json({ success: true, data: await inTransaction(() => ap.createCreditNote(req.companyId!, body, actor(req))) });
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
    res.status(201).json({ success: true, data: await inTransaction(() => ap.createDebitNote(req.companyId!, body, actor(req))) });
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
    res.status(201).json({ success: true, data: await inTransaction(() => ap.createAdvance(req.companyId!, body, actor(req))) });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.post("/advances/:id/allocate", requireCapability("ap:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ billId: z.string().min(1), amount: z.number().positive(), allocationDate: day.optional() }).parse(req.body);
    res.json({ success: true, data: await inTransaction(() => ap.allocateAdvance(req.companyId!, req.params.id, body, actor(req))) });
  } catch (e) {
    fail(res, e);
  }
});

apRouter.post("/advances/:id/refund", requireCapability("ap:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({ amount: z.number().positive().optional(), method: payMethod.optional(), refundDate: day.optional() })
      .parse(req.body ?? {});
    res.json({ success: true, data: await inTransaction(() => ap.refundAdvance(req.companyId!, req.params.id, body, actor(req))) });
  } catch (e) {
    fail(res, e);
  }
});
