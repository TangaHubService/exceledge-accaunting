import { EXPENSE_PAYMENT_MODES, RECURRING_FREQUENCIES } from "@exceledge/accounting-domain";
import { type Response, Router } from "express";
import { z } from "zod";
import { AuthedRequest, authenticateErpJwt, getRequestMeta, requireCapability, resolveCompany } from "../../middleware/auth";
import * as expense from "./expense.service";

export const expenseRouter = Router();

expenseRouter.use(authenticateErpJwt, requireCapability("expense:view"), resolveCompany);

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
const paymentMode = z.enum(EXPENSE_PAYMENT_MODES);
const frequency = z.enum(RECURRING_FREQUENCIES);

const allocation = z.object({
  branch: text(80),
  department: text(80),
  costCentre: text(80),
  project: text(80),
  amount: money,
  notes: text(300),
});

expenseRouter.get("/dashboard", handle((req) => expense.expenseDashboard(req.companyId!)));
expenseRouter.get("/reports/by-category", handle((req) => expense.expensesByCategoryReport(req.companyId!, str(req.query.from), str(req.query.to))));

expenseRouter.get("/categories", handle((req) => expense.listCategories(req.companyId!, { includeInactive: req.query.all === "1" })));
expenseRouter.post(
  "/categories",
  requireCapability("expense:manage"),
  handle(async (req) => {
    const body = z.object({ code: z.string().trim().min(1).max(20), name: z.string().trim().min(1).max(120), glAccountId: z.string().optional(), notes: text(2000) }).parse(req.body);
    return expense.createCategory(req.companyId!, body, actor(req));
  }, 201),
);
expenseRouter.patch(
  "/categories/:id",
  requireCapability("expense:manage"),
  handle(async (req) => {
    const body = z
      .object({ name: z.string().trim().min(1).max(120).optional(), glAccountId: z.string().nullable().optional(), isActive: z.boolean().optional(), notes: text(2000) })
      .parse(req.body);
    return expense.updateCategory(req.companyId!, req.params.id, body, actor(req));
  }),
);

expenseRouter.get("/recurring", handle((req) => expense.listRecurring(req.companyId!)));
expenseRouter.post(
  "/recurring",
  requireCapability("expense:manage"),
  handle(async (req) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(160),
        categoryId: z.string().min(1),
        expenseAccountId: z.string().optional(),
        paymentMode: paymentMode.optional(),
        frequency,
        amount: money,
        taxAmount: z.number().min(0).max(1e13).optional(),
        payeeName: text(160),
        supplierId: z.string().optional(),
        creditAccountId: z.string().optional(),
        financialAccountId: z.string().optional(),
        description: text(2000),
        branch: text(80),
        department: text(80),
        costCentre: text(80),
        project: text(80),
        startDate: day,
        endDate: day.optional(),
        autoPost: z.boolean().optional(),
      })
      .parse(req.body);
    return expense.createRecurring(req.companyId!, body, actor(req));
  }, 201),
);
expenseRouter.post("/recurring/:id/run", requireCapability("expense:manage"), handle((req) => expense.runRecurring(req.companyId!, req.params.id, actor(req))));

expenseRouter.get(
  "/",
  handle((req) =>
    expense.listExpenses(req.companyId!, {
      from: str(req.query.from),
      to: str(req.query.to),
      status: str(req.query.status) as never,
      categoryId: str(req.query.categoryId),
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 50,
    }),
  ),
);
expenseRouter.post(
  "/",
  requireCapability("expense:manage"),
  handle(async (req) => {
    const body = z
      .object({
        expenseDate: day,
        categoryId: z.string().min(1),
        expenseAccountId: z.string().optional(),
        paymentMode: paymentMode.optional(),
        payeeName: text(160),
        supplierId: z.string().optional(),
        employeeErpUserId: z.number().int().optional(),
        employeeName: text(160),
        description: text(2000),
        net: money,
        tax: z.number().min(0).max(1e13).optional(),
        taxCodeId: z.string().optional(),
        creditAccountId: z.string().optional(),
        financialAccountId: z.string().optional(),
        paymentMethod: text(40),
        reference: text(120),
        branch: text(80),
        department: text(80),
        costCentre: text(80),
        project: text(80),
        receiptReference: text(200),
        allocations: z.array(allocation).max(20).optional(),
        submit: z.boolean().optional(),
        post: z.boolean().optional(),
      })
      .parse(req.body);
    return expense.createExpense(req.companyId!, body, actor(req));
  }, 201),
);
expenseRouter.get("/:id", handle((req) => expense.getExpense(req.companyId!, req.params.id)));
expenseRouter.post("/:id/submit", requireCapability("expense:manage"), handle((req) => expense.submitExpense(req.companyId!, req.params.id, actor(req))));
expenseRouter.post("/:id/approve", requireCapability("expense:approve"), handle((req) => expense.approveExpense(req.companyId!, req.params.id, actor(req))));
expenseRouter.post(
  "/:id/reject",
  requireCapability("expense:approve"),
  handle(async (req) => {
    const body = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
    return expense.rejectExpense(req.companyId!, req.params.id, body, actor(req));
  }),
);
expenseRouter.post("/:id/post", requireCapability("expense:manage"), handle((req) => expense.postExpense(req.companyId!, req.params.id, actor(req))));
expenseRouter.post(
  "/:id/reverse",
  requireCapability("expense:manage"),
  handle(async (req) => {
    const body = z.object({ reason: z.string().trim().min(3).max(500), reversalDate: day.optional() }).parse(req.body);
    return expense.reverseExpense(req.companyId!, req.params.id, body, actor(req));
  }),
);
expenseRouter.delete("/:id", requireCapability("expense:manage"), handle((req) => expense.discardExpense(req.companyId!, req.params.id, actor(req))));
