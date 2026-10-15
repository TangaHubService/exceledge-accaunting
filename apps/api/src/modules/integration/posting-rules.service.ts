import {
  buildCustomerPaymentLines,
  buildSaleCompletedLines,
  type DefaultAccountMap,
  type JournalLineDraft,
} from "@exceledge/accounting-domain";
import { prisma } from "../../lib/prisma";
import { ensureDefaultAccountMappings } from "../setup/setup.service";

function asDefaults(row: Record<string, unknown>): DefaultAccountMap {
  return row as DefaultAccountMap;
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

  switch (eventType) {
    case "SALE_COMPLETED": {
      const cogs = Number(metadata.cogs ?? metadata.costOfGoodsSold ?? 0);
      const lines = buildSaleCompletedLines(defaults, {
        net: net || gross - tax,
        tax,
        gross,
        discount,
        cogs,
        paymentMethod: primaryMethod,
      });
      return {
        lines,
        description: `Auto post sale ${payload.sourceDocumentNumber ?? payload.sourceDocumentId}`,
      };
    }
    case "CUSTOMER_PAYMENT_RECEIVED": {
      const amount = Number(totals.gross ?? totals.net ?? metadata.amount ?? 0);
      const lines = buildCustomerPaymentLines(defaults, amount, primaryMethod);
      return {
        lines,
        description: `Auto post customer payment ${payload.sourceDocumentNumber ?? ""}`,
      };
    }
    case "SALES_RETURN_COMPLETED": {
      // Opposite of a cash sale revenue recognition (simplified)
      const saleLines = buildSaleCompletedLines(defaults, {
        net: net || gross - tax,
        tax,
        gross,
        discount,
        cogs: Number(metadata.cogs ?? 0),
        paymentMethod: primaryMethod,
      });
      const lines = saleLines.map((l) => ({
        ...l,
        debit: l.credit,
        credit: l.debit,
        description: l.description ? `Return: ${l.description}` : "Sales return",
      }));
      return {
        lines,
        description: `Auto post sales return ${payload.sourceDocumentNumber ?? ""}`,
      };
    }
    case "INVENTORY_ADJUSTED": {
      const amount = Math.abs(Number(totals.net ?? metadata.amount ?? 0));
      const direction = String(metadata.direction ?? "LOSS").toUpperCase();
      if (!defaults.inventoryAssetId) throw new Error("Inventory asset account not configured");
      const contra =
        direction === "GAIN"
          ? defaults.inventoryGainId || defaults.inventoryAdjustmentId
          : defaults.inventoryLossId ||
            defaults.inventoryAdjustmentId ||
            defaults.inventoryWriteOffId;
      if (!contra) throw new Error("Inventory adjustment contra account not configured");
      const lines: JournalLineDraft[] =
        direction === "GAIN"
          ? [
              { accountId: defaults.inventoryAssetId, debit: amount, credit: 0, description: "Inventory gain" },
              { accountId: contra, debit: 0, credit: amount, description: "Inventory gain income" },
            ]
          : [
              { accountId: contra, debit: amount, credit: 0, description: "Inventory loss/adj" },
              {
                accountId: defaults.inventoryAssetId,
                debit: 0,
                credit: amount,
                description: "Inventory relief",
              },
            ];
      return { lines, description: `Auto post inventory adjustment` };
    }
    case "INVENTORY_WRITTEN_OFF": {
      const amount = Math.abs(Number(totals.net ?? metadata.amount ?? 0));
      if (!defaults.inventoryAssetId || !defaults.inventoryWriteOffId) {
        throw new Error("Inventory write-off accounts not configured");
      }
      return {
        lines: [
          {
            accountId: defaults.inventoryWriteOffId,
            debit: amount,
            credit: 0,
            description: "Inventory write-off",
          },
          {
            accountId: defaults.inventoryAssetId,
            debit: 0,
            credit: amount,
            description: "Inventory relief",
          },
        ],
        description: "Auto post inventory write-off",
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
      const receivedAtCost = Math.max(0, Number(metadata.receivedAtCost ?? 0));
      const clearsGrni = Math.min(receivedAtCost, amountNet);
      if (clearsGrni > 0 && !defaultsRow.grniId) throw new Error("Goods received not invoiced account not configured");
      const lines: JournalLineDraft[] = [];
      if (clearsGrni > 0) {
        lines.push({ accountId: defaultsRow.grniId!, debit: clearsGrni, credit: 0, description: "Stock received, now invoiced" });
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
    case "SUPPLIER_PAYMENT_COMPLETED": {
      const amount = Number(totals.gross ?? totals.net ?? metadata.amount ?? 0);
      const creditAccount =
        String(primaryMethod).toUpperCase() === "BANK"
          ? defaults.defaultBankAccountId
          : defaults.defaultCashAccountId;
      if (!defaults.accountsPayableId || !creditAccount) {
        throw new Error("AP/Cash accounts not configured for supplier payment");
      }
      return {
        lines: [
          {
            accountId: defaults.accountsPayableId,
            debit: amount,
            credit: 0,
            description: "AP payment",
          },
          { accountId: creditAccount, debit: 0, credit: amount, description: "Supplier payment" },
        ],
        description: `Auto post supplier payment`,
      };
    }
    case "GOODS_RECEIVED": {
      const amount = Number(totals.net ?? metadata.amount ?? 0);
      const grniId = defaultsRow.grniId;
      if (!defaults.inventoryAssetId || !grniId) {
        throw new Error("Inventory/GRNI accounts not configured");
      }
      return {
        lines: [
          {
            accountId: defaults.inventoryAssetId,
            debit: amount,
            credit: 0,
            description: "Goods received",
          },
          { accountId: grniId, debit: 0, credit: amount, description: "GRNI" },
        ],
        description: "Auto post goods received",
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
