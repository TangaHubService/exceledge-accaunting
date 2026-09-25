import { FINANCIAL_ACCOUNT_KINDS, STATEMENT_FORMATS } from "@exceledge/accounting-domain";
import { type Response, Router } from "express";
import { z } from "zod";
import { AuthedRequest, authenticateErpJwt, getRequestMeta, requireCapability, resolveCompany } from "../../middleware/auth";
import * as banking from "./banking.service";
import * as recon from "./reconciliation.service";

export const bankingRouter = Router();

bankingRouter.use(authenticateErpJwt, requireCapability("bank:view"), resolveCompany);

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
const allocation = z.object({ accountId: z.string().min(1), amount: money, description: text(300) });
const METHODS = ["CASH", "BANK_TRANSFER", "MOBILE_MONEY", "CHEQUE", "EFT", "CARD", "OTHER"] as const;

const moneyBody = z.object({
  financialAccountId: z.string().min(1),
  transactionDate: day,
  lines: z.array(allocation).min(1).max(50),
  kind: z.enum(["RECEIPT", "PAYMENT", "BANK_CHARGE", "INTEREST"]).optional(),
  method: z.enum(METHODS).optional(),
  reference: text(120),
  chequeNumber: text(40),
  partyType: text(40),
  partyName: text(200),
  description: text(),
});

/* Dashboard, accounts, reports */

bankingRouter.get("/dashboard", handle((req) => banking.bankingDashboard(req.companyId!)));
bankingRouter.get("/cash-position", handle((req) => banking.cashPosition(req.companyId!, str(req.query.asOf))));
bankingRouter.get("/accounts", handle((req) => banking.listFinancialAccounts(req.companyId!, { includeInactive: req.query.all === "1" })));
bankingRouter.get("/accounts/:id", handle((req) => banking.getFinancialAccount(req.companyId!, req.params.id)));
bankingRouter.get("/accounts/:id/cashbook", handle((req) => banking.cashbook(req.companyId!, req.params.id, { from: str(req.query.from), to: str(req.query.to) })));

bankingRouter.post(
  "/accounts",
  requireCapability("bank:manage"),
  handle(async (req) => {
    const body = z
      .object({
        kind: z.enum(FINANCIAL_ACCOUNT_KINDS),
        name: z.string().trim().min(1).max(120),
        accountNumber: text(60),
        bankName: text(120),
        branchName: text(120),
        swiftCode: z.string().trim().regex(/^[A-Za-z0-9]{8}([A-Za-z0-9]{3})?$/, "SWIFT code is 8 or 11 letters and digits").optional(),
        provider: text(60),
        currency: z.string().length(3).optional(),
        glAccountId: z.string().optional(),
        openingBalance: z.number().min(-1e13).max(1e13).optional(),
        dateOpened: day,
        reconcileFrom: day.optional(),
        allowOverdraft: z.boolean().optional(),
        custodian: text(120),
        notes: text(2000),
      })
      .parse(req.body);
    return banking.createFinancialAccount(req.companyId!, body, actor(req));
  }, 201),
);

bankingRouter.patch(
  "/accounts/:id",
  requireCapability("bank:manage"),
  handle(async (req) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        accountNumber: text(60),
        bankName: text(120),
        branchName: text(120),
        swiftCode: z.string().trim().regex(/^[A-Za-z0-9]{8}([A-Za-z0-9]{3})?$/, "SWIFT code is 8 or 11 letters and digits").optional(),
        provider: text(60),
        allowOverdraft: z.boolean().optional(),
        custodian: text(120),
        notes: text(2000),
        reconcileFrom: day.optional(),
        isActive: z.boolean().optional(),
      })
      .parse(req.body);
    return banking.updateFinancialAccount(req.companyId!, req.params.id, body, actor(req));
  }),
);

/* Transactions */

bankingRouter.get(
  "/transactions",
  handle((req) =>
    banking.listTransactions(req.companyId!, {
      financialAccountId: str(req.query.accountId),
      kind: str(req.query.kind),
      from: str(req.query.from),
      to: str(req.query.to),
      q: str(req.query.q),
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 50,
    }),
  ),
);
bankingRouter.get("/transactions/:id", handle((req) => banking.getTransaction(req.companyId!, req.params.id)));

bankingRouter.post("/receipts", requireCapability("bank:manage"), handle((req) => banking.receiveMoney(req.companyId!, moneyBody.parse(req.body), actor(req)), 201));
bankingRouter.post("/payments", requireCapability("bank:manage"), handle((req) => banking.makePayment(req.companyId!, moneyBody.parse(req.body), actor(req)), 201));

bankingRouter.post(
  "/transfers",
  requireCapability("bank:manage"),
  handle(async (req) => {
    const body = z
      .object({
        fromAccountId: z.string().min(1),
        toAccountId: z.string().min(1),
        transactionDate: day,
        amount: money,
        fee: z.number().min(0).max(1e13).optional(),
        reference: text(120),
        chequeNumber: text(40),
        description: text(),
      })
      .parse(req.body);
    return banking.transferFunds(req.companyId!, body, actor(req));
  }, 201),
);

bankingRouter.post(
  "/cash-counts",
  requireCapability("bank:manage"),
  handle(async (req) => {
    const body = z
      .object({ financialAccountId: z.string().min(1), countDate: day, counted: z.number().min(0).max(1e13), overShortAccountId: z.string().optional(), description: text() })
      .parse(req.body);
    return banking.recordCashCount(req.companyId!, body, actor(req));
  }, 201),
);

bankingRouter.post(
  "/transactions/:id/reverse",
  requireCapability("bank:manage"),
  handle(async (req) => {
    const body = z.object({ reason: z.string().trim().min(3).max(300), reversalDate: day.optional() }).parse(req.body);
    return banking.reverseTransaction(req.companyId!, req.params.id, body, actor(req));
  }),
);

/* Statements and matching */

const upload = z.object({
  fileName: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(7_000_000),
  format: z.enum(STATEMENT_FORMATS).optional(),
  dateOrder: z.enum(["DMY", "MDY"]).optional(),
});

bankingRouter.get("/accounts/:id/statements", handle((req) => recon.listStatements(req.companyId!, req.params.id)));
bankingRouter.post("/accounts/:id/statements/preview", requireCapability("bank:manage"), handle((req) => recon.previewStatement(req.companyId!, req.params.id, upload.parse(req.body))));
bankingRouter.post("/accounts/:id/statements", requireCapability("bank:manage"), handle((req) => recon.importStatement(req.companyId!, req.params.id, upload.parse(req.body), actor(req)), 201));
bankingRouter.delete("/statements/:id", requireCapability("bank:manage"), handle((req) => recon.deleteStatement(req.companyId!, req.params.id, actor(req))));

bankingRouter.get("/accounts/:id/matching", handle((req) => recon.matchingWorkspace(req.companyId!, req.params.id, { until: str(req.query.until) })));
bankingRouter.post("/accounts/:id/auto-match", requireCapability("bank:manage"), handle((req) => recon.autoMatch(req.companyId!, req.params.id, actor(req))));
bankingRouter.post(
  "/accounts/:id/matches",
  requireCapability("bank:manage"),
  handle(async (req) => {
    const body = z.object({ lineIds: z.array(z.string()).max(200).default([]), entryIds: z.array(z.string()).max(200).default([]) }).parse(req.body);
    return recon.createMatch(req.companyId!, req.params.id, body, actor(req));
  }, 201),
);
bankingRouter.delete("/matches/:id", requireCapability("bank:manage"), handle((req) => recon.removeMatch(req.companyId!, req.params.id, actor(req))));
bankingRouter.get("/statement-lines/:id/suggestions", handle((req) => recon.suggestionsForLine(req.companyId!, req.params.id)));
bankingRouter.post(
  "/statement-lines/:id/record",
  requireCapability("bank:manage"),
  handle(async (req) => {
    const body = z.object({ kind: z.enum(["BANK_CHARGE", "INTEREST", "OTHER"]).optional(), accountId: z.string().optional(), description: text() }).parse(req.body);
    return recon.recordStatementLine(req.companyId!, req.params.id, body, actor(req));
  }, 201),
);

/* Reconciliation */

bankingRouter.get("/reconciliations", handle((req) => recon.reconciliationOverview(req.companyId!)));
bankingRouter.get("/reconciliations/:id", handle((req) => recon.getReconciliation(req.companyId!, req.params.id)));
bankingRouter.get(
  "/accounts/:id/statement-balance",
  handle(async (req) => {
    const date = day.parse(req.query.date);
    return recon.statementBalanceAt(req.companyId!, req.params.id, date);
  }),
);
bankingRouter.post(
  "/reconciliations",
  requireCapability("bank:manage"),
  handle(async (req) => {
    const body = z.object({ financialAccountId: z.string().min(1), statementDate: day, statementBalance: z.number().min(-1e13).max(1e13), notes: text(2000) }).parse(req.body);
    return recon.startReconciliation(req.companyId!, body, actor(req));
  }, 201),
);
bankingRouter.patch(
  "/reconciliations/:id",
  requireCapability("bank:manage"),
  handle(async (req) => {
    const body = z.object({ statementBalance: z.number().min(-1e13).max(1e13).optional(), notes: text(2000) }).parse(req.body);
    return recon.updateReconciliation(req.companyId!, req.params.id, body, actor(req));
  }),
);
bankingRouter.post("/reconciliations/:id/review", requireCapability("bank:manage"), handle((req) => recon.reviewReconciliation(req.companyId!, req.params.id, actor(req))));
bankingRouter.post("/reconciliations/:id/approve", requireCapability("bank:approve"), handle((req) => recon.approveReconciliation(req.companyId!, req.params.id, actor(req))));
bankingRouter.post("/reconciliations/:id/complete", requireCapability("bank:approve"), handle((req) => recon.completeReconciliation(req.companyId!, req.params.id, actor(req))));
bankingRouter.post("/reconciliations/:id/reopen", requireCapability("bank:manage"), handle((req) => recon.reopenReconciliation(req.companyId!, req.params.id, actor(req))));
bankingRouter.delete("/reconciliations/:id", requireCapability("bank:manage"), handle((req) => recon.discardReconciliation(req.companyId!, req.params.id, actor(req))));
