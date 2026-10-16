import {
  buildCustomerReceiptLines,
  buildSaleRefundLines,
  buildSaleSettlementLines,
  buildSupplierPaymentSettlementLines,
  readPaymentSplits,
  roundMoney,
  type DefaultAccountMap,
  type JournalLineDraft,
} from "@exceledge/accounting-domain";
import { lockForTransaction, prisma } from "../../lib/prisma";
import { inventoryConfig } from "../inventory/inventory.service";
import { ensureDefaultAccountMappings } from "../setup/setup.service";

function asDefaults(row: Record<string, unknown>): DefaultAccountMap {
  return row as DefaultAccountMap;
}

/**
 * Clears goods received not invoiced for a bill against the open receipts of its purchase order, oldest first.
 * Must run inside the posting transaction: the increments lock the receipts, and an over-match from a concurrent
 * bill throws so the event is retried with fresh figures.
 */
async function matchGoodsReceipts(companyId: string, poReference: unknown, amountNet: number): Promise<number> {
  const reference = poReference === undefined || poReference === null ? "" : String(poReference).trim();
  if (!reference || amountNet <= 0) return 0;
  await lockForTransaction(`goods-receipt:${companyId}:${reference}`);
  const receipts = await prisma.goodsReceipt.findMany({
    where: { companyId, poReference: reference },
    orderBy: [{ receiptDate: "asc" }, { createdAt: "asc" }],
  });
  let left = roundMoney(amountNet);
  let cleared = 0;
  for (const receipt of receipts) {
    if (left <= 0) break;
    const open = roundMoney(Number(receipt.value) - Number(receipt.matchedValue));
    const take = Math.min(open, left);
    if (take <= 0) continue;
    const updated = await prisma.goodsReceipt.update({ where: { id: receipt.id }, data: { matchedValue: { increment: take } } });
    if (Number(updated.matchedValue) - Number(updated.value) > 0.0001) {
      throw new Error(`Goods receipt for ${reference} was matched by another bill at the same time; retry`);
    }
    left = roundMoney(left - take);
    cleared = roundMoney(cleared + take);
  }
  return cleared;
}

export async function resolvePostingLines(
  companyId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<{ lines: JournalLineDraft[]; description: string }> {
  await ensureDefaultAccountMappings(companyId);
  const defaultsRow = await prisma.defaultPostingAccounts.findUniqueOrThrow({
    where: { companyId },
  });
  const defaults = asDefaults(defaultsRow as unknown as Record<string, unknown>);
  const totals = (payload.amountTotals ?? {}) as Record<string, string | number>;
  const net = Number(totals.net ?? 0);
  const tax = Number(totals.tax ?? 0);
  const gross = Number(totals.gross ?? net + tax);
  const discount = Number(totals.discount ?? 0);
  const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
  const paymentSplits = (payload.paymentSplits ?? []) as Array<{
    paymentMethod?: string;
    amount?: number;
  }>;
  const primaryMethod =
    paymentSplits[0]?.paymentMethod ||
    (metadata.paymentType as string) ||
    (metadata.paymentMethod as string) ||
    "CASH";

  // The ERP's net is its taxable amount, which leaves out exempt sales; gross is what the customer paid.
  const documentTotal = gross > 0 ? gross : net + tax - discount;
  const revenue = documentTotal + discount - tax;

  switch (eventType) {
    case "SALE_COMPLETED": {
      const splits = readPaymentSplits(payload.paymentSplits, documentTotal, primaryMethod);
      return {
        lines: buildSaleSettlementLines(defaults, { net: revenue, tax, discount, splits }),
        description: `Auto post sale ${payload.sourceDocumentNumber ?? payload.sourceDocumentId}`,
      };
    }
    case "CUSTOMER_PAYMENT_RECEIVED": {
      const amount = Number(totals.gross ?? totals.net ?? metadata.amount ?? 0);
      const splits = readPaymentSplits(payload.paymentSplits, amount, primaryMethod);
      return {
        lines: buildCustomerReceiptLines(defaults, splits),
        description: `Auto post customer payment ${payload.sourceDocumentNumber ?? ""}`.trim(),
      };
    }
    case "SALE_REFUNDED":
    case "SALES_RETURN_COMPLETED": {
      const splits = readPaymentSplits(payload.paymentSplits, documentTotal, primaryMethod);
      return {
        lines: buildSaleRefundLines(defaults, { net: revenue, tax, discount, splits }),
        description: `Auto post ${eventType === "SALE_REFUNDED" ? "sale refund" : "sales return"} ${payload.sourceDocumentNumber ?? ""}`.trim(),
      };
    }
    case "EXPENSE_APPROVED": {
      const amount = Number(totals.gross ?? totals.net ?? 0);
      const expenseAccountId = String(metadata.expenseAccountId ?? "") || defaults.purchasesId;
      const creditAccount =
        String(metadata.paymentMethod ?? "CASH").toUpperCase() === "BANK"
          ? defaults.defaultBankAccountId
          : defaults.defaultCashAccountId;
      if (!expenseAccountId || !creditAccount) {
        throw new Error("Expense posting accounts not configured");
      }
      return {
        lines: [
          { accountId: expenseAccountId, debit: amount, credit: 0, description: "Expense" },
          { accountId: creditAccount, debit: 0, credit: amount, description: "Expense payment" },
        ],
        description: `Auto post expense ${payload.sourceDocumentNumber ?? ""}`,
      };
    }
    case "SUPPLIER_BILL_APPROVED": {
      const amountNet = net || Number(metadata.net ?? 0);
      const amountTax = tax || Number(metadata.tax ?? 0);
      const grossAmt = amountNet + amountTax;
      if (!defaults.accountsPayableId || !defaults.purchasesId) {
        throw new Error("AP/Purchases accounts not configured");
      }
      // Stock imported from the bill itself comes with its cost; stock received on the purchase order is matched.
      const receivedAtCost = Math.max(0, Number(metadata.receivedAtCost) || 0);
      const clearsGrni =
        receivedAtCost > 0
          ? Math.min(receivedAtCost, amountNet)
          : await matchGoodsReceipts(companyId, metadata.poReference, amountNet);
      // The account stock receipts credit: the inventory settings may override the company default.
      const grniId = clearsGrni > 0 ? (await inventoryConfig(companyId)).accounts.grniId : null;
      if (clearsGrni > 0 && !grniId) throw new Error("Goods received not invoiced account not configured");
      const lines: JournalLineDraft[] = [];
      if (clearsGrni > 0) {
        lines.push({ accountId: grniId!, debit: clearsGrni, credit: 0, description: "Stock received, now invoiced" });
      }
      if (amountNet - clearsGrni > 0) {
        lines.push({ accountId: defaults.purchasesId, debit: amountNet - clearsGrni, credit: 0, description: "Purchases / expense" });
      }
      if (amountTax > 0) {
        if (!defaults.inputTaxReceivableId) throw new Error("Input tax account not configured");
        lines.push({
          accountId: defaults.inputTaxReceivableId,
          debit: amountTax,
          credit: 0,
          description: "Input VAT",
        });
      }
      lines.push({
        accountId: defaults.accountsPayableId,
        debit: 0,
        credit: grossAmt,
        description: "Accounts payable",
      });
      return {
        lines,
        description: `Auto post supplier bill ${payload.sourceDocumentNumber ?? ""}`,
      };
    }
    case "SUPPLIER_PAYMENT_MADE":
    case "SUPPLIER_PAYMENT_COMPLETED": {
      const amount = Number(totals.gross ?? totals.net ?? metadata.amount ?? 0);
      const splits = readPaymentSplits(payload.paymentSplits, amount, primaryMethod);
      return {
        lines: buildSupplierPaymentSettlementLines(defaults, splits),
        description: `Auto post supplier payment ${payload.sourceDocumentNumber ?? ""}`.trim(),
      };
    }
    case "PAYROLL_APPROVED": {
      const figure = (key: string) => Number(metadata[key] ?? 0);
      const grossPay = figure("grossPay");
      const paye = figure("paye");
      const employeeRssb = figure("employeeRssb");
      const employerRssb = figure("employerRssb");
      const cbhi = figure("cbhi");
      const netPay = figure("netPay");
      if (Math.abs(grossPay - paye - employeeRssb - cbhi - netPay) > 0.5) {
        throw new Error("Payroll totals do not add up: gross pay must equal PAYE, employee RSSB, CBHI and net pay");
      }
      const [rssbPayable, netSalaries, employerExpense] = await Promise.all(
        ["2310", "2320", "6120"].map((code) => prisma.account.findFirst({ where: { companyId, code } })),
      );
      const salaries = defaultsRow.salariesWagesExpenseId;
      const payePayable = defaults.payrollTaxPayableId;
      if (!salaries || !payePayable || !rssbPayable || !netSalaries || !employerExpense) {
        throw new Error("Payroll accounts are not configured (6100, 6120, 2300, 2310, 2320)");
      }
      const period = String(metadata.period ?? "");
      const lines: JournalLineDraft[] = [
        { accountId: salaries, debit: grossPay, credit: 0, description: `Gross pay ${period}` },
        { accountId: employerExpense.id, debit: employerRssb, credit: 0, description: `Employer RSSB ${period}` },
        { accountId: payePayable, debit: 0, credit: paye, description: `PAYE ${period}` },
        { accountId: rssbPayable.id, debit: 0, credit: employeeRssb + employerRssb + cbhi, description: `RSSB and CBHI ${period}` },
        { accountId: netSalaries.id, debit: 0, credit: netPay, description: `Net salaries ${period}` },
      ].filter((l) => l.debit > 0 || l.credit > 0);
      return { lines, description: `Payroll ${period}` };
    }
    case "PAYROLL_PAID": {
      const amount = Number(totals.gross ?? metadata.netPay ?? 0);
      const method = String(primaryMethod).toUpperCase();
      const creditAccount =
        method === "BANK" ? defaults.defaultBankAccountId : method === "MOBILE_MONEY" ? defaults.mobileMoneyClearingId || defaults.defaultCashAccountId : defaults.defaultCashAccountId;
      const netSalaries = await prisma.account.findFirst({ where: { companyId, code: "2320" } });
      if (!netSalaries || !creditAccount) throw new Error("Net salaries payable (2320) or the payment account is not configured");
      return {
        lines: [
          { accountId: netSalaries.id, debit: amount, credit: 0, description: "Net salaries paid" },
          { accountId: creditAccount, debit: 0, credit: amount, description: `Salary payment (${method.toLowerCase().replace("_", " ")})` },
        ],
        description: `Salary payment ${metadata.period ?? ""}`.trim(),
      };
    }
    default:
      throw new Error(`No posting rule configured for event type ${eventType}`);
  }
}
