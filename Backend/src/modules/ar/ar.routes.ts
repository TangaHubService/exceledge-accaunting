import { Router } from "express";
import { z } from "zod";
import { hasCapability } from "@exceledge/accounting-domain";
import {
  AuthedRequest,
  authenticate,
  getRequestMeta,
  requireCapability,
  resolveCompany,
} from "../../middleware/auth";
import { inTransaction } from "../../lib/prisma";
import { documentLines, notFoundStatus, periodQuery, sendPdf } from "../../lib/http-documents";
import { exportFormat, sendReport } from "../../lib/report-export";
import * as print from "../print/print.service";
import { ageingDocument } from "../books/report-documents";
import { parsePage, wantsPage } from "../../lib/pagination";
import * as ar from "./ar.service";
import * as customers from "./customers.service";
import * as customerEmail from "./customer-email.service";

export const arRouter = Router();

arRouter.use(authenticate, requireCapability("ar:view"), resolveCompany);

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
  try {
    const format = exportFormat(req.query.format);
    const data = await ar.ageingReport(req.companyId!, asOf);
    if (format) return await sendReport(res, await ageingDocument(req.companyId!, "ar", data), format);
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

const listFilter = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(["active", "inactive", "all"]).optional(),
  balance: z.enum(["owing", "overdue", "over-limit", "credit"]).optional(),
  type: customerType.optional(),
  tag: z.string().max(30).optional(),
  sort: z.enum(["name", "code", "balance", "created"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});

const optionalText = z.string().trim().max(500).optional().nullable();
const customerFields = {
  name: z.string().trim().min(1, "Display name is required").max(200),
  companyName: optionalText,
  customerType: customerType.optional(),
  category: optionalText,
  tin: z
    .string()
    .trim()
    .regex(/^\d{9}$/, "TIN must be 9 digits")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  contactPerson: optionalText,
  telephone: optionalText,
  mobile: optionalText,
  email: z.string().trim().email("Email is not valid").optional().nullable().or(z.literal("").transform(() => null)),
  website: optionalText,
  physicalAddress: optionalText,
  shippingAddress: optionalText,
  country: optionalText,
  province: optionalText,
  district: optionalText,
  paymentTerms: optionalText,
  preferredPaymentMethod: payMethod.optional().nullable(),
  creditLimit: z.number().min(0, "Credit limit can't be negative").optional(),
  creditPeriodDays: z.number().int().min(0).max(365).optional(),
  creditStatus: z.enum(["GOOD", "WATCH", "ON_HOLD", "BLOCKED"]).optional(),
  notes: z.string().max(4000).optional().nullable(),
  parentId: z.string().min(1).optional().nullable(),
  tags: z.array(z.string().max(30)).max(10).optional(),
  taxExempt: z.boolean().optional(),
  taxExemptReason: optionalText,
};
/** Turns nulls from the create form into "not given". */
function dropNulls<T extends Record<string, unknown>>(o: T) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as { [K in keyof T]: Exclude<T[K], null> };
}
function zodMessage(e: unknown) {
  if (e instanceof z.ZodError) return e.issues.map((i) => i.message).join("; ");
  return (e as Error).message;
}

/** Without `page`: the full array older pickers use. With `page`: the paged customer centre list with counts. */
arRouter.get("/customers", async (req: AuthedRequest, res) => {
  if (!wantsPage(req.query)) {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    return res.json({ success: true, data: await ar.listCustomers(req.companyId!, q) });
  }
  try {
    const filter = listFilter.parse(req.query);
    res.json({ success: true, data: await customers.listCustomersPage(req.companyId!, filter, parsePage(req.query, { defaultSize: 25, maxSize: 200 })) });
  } catch (e) {
    res.status(400).json({ success: false, error: zodMessage(e) });
  }
});

/** Mail-server failures (bad login, unreachable host) are the server's problem, not the request's. */
function emailError(res: import("express").Response, e: unknown) {
  const err = e as Error & { status?: number; responseCode?: number; code?: string };
  if (err.status === 503) return res.status(503).json({ success: false, error: err.message });
  if (err instanceof z.ZodError) return res.status(400).json({ success: false, error: zodMessage(err) });
  if (err.responseCode || err.code === "EAUTH" || err.code === "ECONNECTION" || err.code === "ETIMEDOUT" || err.code === "ESOCKET") {
    return res.status(502).json({ success: false, error: `The mail server refused the message: ${err.message}` });
  }
  return res.status(notFoundStatus(e)).json({ success: false, error: err.message });
}

const emailBody = z.object({
  to: z.string().max(500).optional(),
  cc: z.string().max(500).optional(),
  subject: z.string().max(200).optional(),
  message: z.string().max(4000).optional(),
});

arRouter.get("/email/status", (_req, res) => {
  res.json({ success: true, data: customerEmail.emailStatus() });
});

arRouter.post("/email/test", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ to: z.string().min(3).max(200) }).parse(req.body);
    res.json({ success: true, data: await customerEmail.sendTestEmail(req.companyId!, body.to, actor(req)) });
  } catch (e) {
    emailError(res, e);
  }
});

arRouter.post("/invoices/:id/email", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = emailBody.extend({ reminder: z.boolean().optional() }).parse(req.body ?? {});
    res.json({ success: true, data: await customerEmail.emailInvoice(req.companyId!, req.params.id, body, actor(req)) });
  } catch (e) {
    emailError(res, e);
  }
});

arRouter.post("/customers/:id/statement/email", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = emailBody.extend({ from: z.string().optional(), toDate: z.string().optional() }).parse(req.body ?? {});
    res.json({ success: true, data: await customerEmail.emailStatement(req.companyId!, req.params.id, body, actor(req)) });
  } catch (e) {
    emailError(res, e);
  }
});

arRouter.get("/customers/duplicates", async (req: AuthedRequest, res) => {
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  res.json({
    success: true,
    data: await customers.findCustomerDuplicates(req.companyId!, {
      name: str(req.query.name),
      tin: str(req.query.tin),
      email: str(req.query.email),
      phone: str(req.query.phone),
      exceptId: str(req.query.exceptId),
    }),
  });
});

arRouter.get("/customers/export.csv", async (req: AuthedRequest, res) => {
  try {
    const filter = listFilter.parse(req.query);
    const csv = await customers.exportCustomersCsv(req.companyId!, filter);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (e) {
    res.status(400).json({ success: false, error: zodMessage(e) });
  }
});

arRouter.post("/customers/import", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const row = z.object({
      ...customerFields,
      name: z.string().trim().max(200).default(""),
      tin: z.string().trim().optional().nullable(),
      email: z.string().trim().optional().nullable(),
      openingBalance: z.number().optional(),
      openingBalanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Opening balance date must be yyyy-mm-dd").optional(),
    });
    const body = z.object({ dryRun: z.boolean().optional(), rows: z.array(row).min(1, "The file has no rows").max(2000, "Import at most 2,000 customers at a time") }).parse(req.body);
    const rows = body.rows.map((r) => dropNulls(r) as customers.ImportRow);
    res.json({ success: true, data: await customers.importCustomers(req.companyId!, rows, { dryRun: body.dryRun }, actor(req), inTransaction) });
  } catch (e) {
    res.status(400).json({ success: false, error: zodMessage(e) });
  }
});

arRouter.post("/customers/bulk-status", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ ids: z.array(z.string()).min(1).max(500), status: z.enum(["ACTIVE", "INACTIVE"]) }).parse(req.body);
    res.json({ success: true, data: await customers.bulkSetStatus(req.companyId!, body.ids, body.status, actor(req)) });
  } catch (e) {
    res.status(400).json({ success: false, error: zodMessage(e) });
  }
});

arRouter.post("/customers", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        ...customerFields,
        code: z.string().trim().max(40).optional(),
        // Fixed at creation: posted documents carry the customer's currency.
        currency: z.string().trim().toUpperCase().length(3, "Currency must be a 3-letter code").optional(),
        openingBalance: z.number().min(0, "Opening balance can't be negative").optional(),
        openingBalanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Opening balance date must be yyyy-mm-dd").optional(),
      })
      .parse(req.body);
    const data = await inTransaction(() => ar.createCustomer(req.companyId!, dropNulls(body), actor(req)));
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: zodMessage(e) });
  }
});

arRouter.get("/customers/:id", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await customers.customerProfile(req.companyId!, req.params.id) });
  } catch (e) {
    res.status(404).json({ success: false, error: (e as Error).message });
  }
});

arRouter.patch("/customers/:id", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({ ...customerFields, status: z.enum(["ACTIVE", "INACTIVE"]).optional() })
      .partial()
      .parse(req.body);
    res.json({ success: true, data: await inTransaction(() => ar.updateCustomer(req.companyId!, req.params.id, body, actor(req))) });
  } catch (e) {
    res.status(400).json({ success: false, error: zodMessage(e) });
  }
});

arRouter.get("/customers/:id/summary", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await customers.customerSummary(req.companyId!, req.params.id) });
  } catch (e) {
    res.status(404).json({ success: false, error: (e as Error).message });
  }
});

arRouter.get("/customers/:id/transactions", async (req: AuthedRequest, res) => {
  try {
    const filter = z
      .object({
        type: z.enum(["INVOICE", "PAYMENT", "CREDIT_NOTE", "DEBIT_NOTE", "DEPOSIT", "ESTIMATE", "SALES_ORDER", "DELAYED_CHARGE", "DELAYED_CREDIT", "REFUND"]).optional(),
        status: z.enum(["open", "overdue", "closed"]).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(req.query);
    res.json({ success: true, data: await customers.customerTransactions(req.companyId!, req.params.id, filter, parsePage(req.query, { defaultSize: 25, maxSize: 200 })) });
  } catch (e) {
    res.status(notFoundStatus(e)).json({ success: false, error: zodMessage(e) });
  }
});

arRouter.get("/customers/:id/credits", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await ar.customerCredits(req.companyId!, req.params.id) });
  } catch (e) {
    res.status(404).json({ success: false, error: (e as Error).message });
  }
});

arRouter.post("/customers/:id/apply-credits", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        applications: z
          .array(z.object({ source: z.enum(["PAYMENT", "CREDIT_NOTE", "DEPOSIT"]), sourceId: z.string().min(1), invoiceId: z.string().min(1), amount: z.number().positive() }))
          .min(1, "Enter an amount to apply")
          .max(200),
      })
      .parse(req.body);
    res.json({ success: true, data: await inTransaction(() => ar.applyCustomerCredits(req.companyId!, req.params.id, body, actor(req))) });
  } catch (e) {
    res.status(notFoundStatus(e)).json({ success: false, error: zodMessage(e) });
  }
});

arRouter.post("/customers/:id/contacts", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        name: z.string().trim().min(1, "Enter the contact's name").max(200),
        role: optionalText,
        email: z.string().trim().email("Email is not valid").optional().nullable().or(z.literal("").transform(() => null)),
        phone: optionalText,
      })
      .parse(req.body);
    res.status(201).json({ success: true, data: await customers.addContact(req.companyId!, req.params.id, body) });
  } catch (e) {
    res.status(notFoundStatus(e)).json({ success: false, error: zodMessage(e) });
  }
});

arRouter.delete("/customers/:id/contacts/:contactId", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await customers.removeContact(req.companyId!, req.params.id, req.params.contactId) });
  } catch (e) {
    res.status(notFoundStatus(e)).json({ success: false, error: zodMessage(e) });
  }
});

arRouter.post("/customers/:id/merge", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ intoCustomerId: z.string().min(1) }).parse(req.body);
    res.json({ success: true, data: await inTransaction(() => customers.mergeCustomers(req.companyId!, req.params.id, body.intoCustomerId, actor(req))) });
  } catch (e) {
    res.status(notFoundStatus(e)).json({ success: false, error: zodMessage(e) });
  }
});

arRouter.get("/customers/:id/notes", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await customers.listCustomerNotes(req.companyId!, req.params.id) });
  } catch (e) {
    res.status(404).json({ success: false, error: (e as Error).message });
  }
});

arRouter.post("/customers/:id/notes", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ body: z.string().min(1, "Write something in the note").max(4000) }).parse(req.body);
    const data = await customers.addCustomerNote(req.companyId!, req.params.id, body.body, { erpUserId: req.erpUser!.userId, name: req.erpUser!.email });
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(notFoundStatus(e)).json({ success: false, error: zodMessage(e) });
  }
});

arRouter.get("/customers/:id/activity", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await customers.customerActivity(req.companyId!, req.params.id) });
  } catch (e) {
    res.status(404).json({ success: false, error: (e as Error).message });
  }
});

arRouter.get("/transactions/:type/:id", async (req: AuthedRequest, res) => {
  try {
    const type = z.enum(["PAYMENT", "CREDIT_NOTE", "DEBIT_NOTE", "DEPOSIT"]).parse(req.params.type);
    res.json({ success: true, data: await customers.customerTransactionDetail(req.companyId!, type, req.params.id) });
  } catch (e) {
    res.status(404).json({ success: false, error: zodMessage(e) });
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

arRouter.get("/customers/:id/period-statement", async (req: AuthedRequest, res) => {
  try {
    const { from, to } = periodQuery.parse(req.query);
    res.json({ success: true, data: await ar.customerPeriodStatement(req.companyId!, req.params.id, from, to) });
  } catch (e) {
    res.status(notFoundStatus(e)).json({ success: false, error: (e as Error).message });
  }
});

arRouter.get("/customers/:id/statement.pdf", async (req: AuthedRequest, res) => {
  try {
    const { from, to } = periodQuery.parse(req.query);
    sendPdf(res, await print.customerStatementPdf(req.companyId!, req.params.id, from, to));
  } catch (e) {
    res.status(notFoundStatus(e)).json({ success: false, error: (e as Error).message });
  }
});

arRouter.get("/customers/:id/deposits", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await ar.listDeposits(req.companyId!, req.params.id) });
  } catch (e) {
    res.status(404).json({ success: false, error: (e as Error).message });
  }
});

arRouter.get("/invoices", async (req: AuthedRequest, res) => {
  try {
    const query = z
      .object({
        status: z.enum(["OPEN", "OVERDUE", "PAID", "ALL"]).optional(),
        customerId: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        q: z.string().max(100).optional(),
        page: z.coerce.number().int().min(1).optional(),
        pageSize: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(req.query);
    res.json({ success: true, data: await ar.listInvoices(req.companyId!, query) });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

arRouter.get("/invoices/:id", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await ar.getInvoice(req.companyId!, req.params.id) });
  } catch (e) {
    res.status(404).json({ success: false, error: (e as Error).message });
  }
});

arRouter.get("/invoices/:id/applications", async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await ar.invoiceApplications(req.companyId!, req.params.id) });
  } catch (e) {
    res.status(404).json({ success: false, error: (e as Error).message });
  }
});

arRouter.post("/invoices/:id/void", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ reason: z.string().trim().max(300).optional() }).parse(req.body ?? {});
    res.json({ success: true, data: await inTransaction(() => ar.voidInvoice(req.companyId!, req.params.id, body.reason || undefined, actor(req))) });
  } catch (e) {
    res.status(notFoundStatus(e)).json({ success: false, error: zodMessage(e) });
  }
});

arRouter.delete("/applications/:kind/:id", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const kind = z.enum(["PAYMENT", "CREDIT_NOTE", "DEPOSIT", "CREDIT_ON_ISSUE"]).parse(req.params.kind);
    res.json({ success: true, data: await inTransaction(() => ar.unapplyFromInvoice(req.companyId!, kind, req.params.id, actor(req))) });
  } catch (e) {
    res.status(notFoundStatus(e)).json({ success: false, error: zodMessage(e) });
  }
});

arRouter.get("/invoices/:id/pdf", async (req: AuthedRequest, res) => {
  try {
    sendPdf(res, await print.invoicePdf(req.companyId!, req.params.id));
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
        net: z.number().positive().optional(),
        lines: documentLines.optional(),
        tax: z.number().min(0).optional(),
        discount: z.number().min(0).optional(),
        description: z.string().optional(),
        currency: z.string().optional(),
        creditOverride: z.boolean().optional(),
      })
      .parse(req.body);
    const data = await inTransaction(() => ar.createInvoice(req.companyId!, body, actor(req, body.creditOverride)));
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
    const data = await inTransaction(() => ar.createReceipt(req.companyId!, body, actor(req)));
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

arRouter.post("/receipts/:id/reverse", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await inTransaction(() => ar.reverseReceipt(req.companyId!, req.params.id, actor(req))) });
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
    res.status(201).json({ success: true, data: await inTransaction(() => ar.createCreditNote(req.companyId!, body, actor(req))) });
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
      data: await inTransaction(() => ar.createDebitNote(req.companyId!, body, actor(req, body.creditOverride))),
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
    res.status(201).json({ success: true, data: await inTransaction(() => ar.createDeposit(req.companyId!, body, actor(req))) });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

arRouter.post("/deposits/:id/allocate", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    const body = z.object({ invoiceId: z.string(), amount: z.number().positive() }).parse(req.body);
    res.json({ success: true, data: await inTransaction(() => ar.allocateDeposit(req.companyId!, req.params.id, body, actor(req))) });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

arRouter.post("/deposits/:id/refund", requireCapability("ar:manage"), async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, data: await inTransaction(() => ar.refundDeposit(req.companyId!, req.params.id, actor(req))) });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});
