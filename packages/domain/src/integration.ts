/** Wave C: settlement of ERP documents across payment methods. */
import type { DefaultAccountMap, JournalLineDraft } from "./index";

export type SettlementMethod = "CASH" | "BANK" | "MOBILE_MONEY" | "CREDIT";

export interface PaymentSplit {
  method: SettlementMethod;
  amount: number;
}

/** The ERP rounds each split to whole units, so a small residual against the document total is absorbed. */
export const SPLIT_TOLERANCE = 0.5;

const round = (value: number) => Math.round((Number(value) || 0) * 10000) / 10000;

/**
 * Maps the ERP's payment method to the account it settles through. Store credit, wallets and gift cards draw on
 * the customer's account. The ERP's "Other" (details in the payment note) is taken into cash on hand. A method
 * that is not recognised is an error rather than a guess at cash.
 */
export function normalizePaymentMethod(raw: unknown): SettlementMethod {
  const value = String(raw ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!value || value === "CASH" || value === "OTHER") return "CASH";
  if (["CREDIT", "DEBT", "INSURANCE", "ON_ACCOUNT", "STORE_CREDIT", "WALLET", "GIFT_CARD"].includes(value)) return "CREDIT";
  if (value.includes("MOMO") || value.includes("MOBILE") || value.startsWith("MTN") || value.startsWith("AIRTEL") || value === "PAYPACK") return "MOBILE_MONEY";
  if (
    value.startsWith("BANK") ||
    value.endsWith("_CARD") ||
    ["TRANSFER", "CHEQUE", "CHECK", "CARD", "EFT", "ONLINE", "VISA", "MASTERCARD"].includes(value)
  ) {
    return "BANK";
  }
  if (value === "MIXED" || value === "SPLIT") throw new Error(`A ${value.toLowerCase()} payment needs its payment splits`);
  throw new Error(`Unknown payment method "${String(raw)}"`);
}

/**
 * Reads the payment splits of an ERP document. With no splits the whole total settles through the fallback
 * method. Splits must add up to the total; each method appears once.
 */
export function readPaymentSplits(raw: unknown, total: number, fallbackMethod: unknown): PaymentSplit[] {
  const target = round(total);
  const rows = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
  const merged = new Map<SettlementMethod, number>();
  for (const row of rows) {
    const amount = round(Number(row?.amount ?? row?.gross ?? 0));
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Payment split amounts cannot be negative");
    if (amount === 0) continue;
    const method = normalizePaymentMethod(row?.paymentMethod ?? row?.paymentType ?? row?.method);
    merged.set(method, round((merged.get(method) ?? 0) + amount));
  }
  if (!merged.size) return target > 0 ? [{ method: normalizePaymentMethod(fallbackMethod), amount: target }] : [];
  const splits = [...merged.entries()].map(([method, amount]) => ({ method, amount }));
  const sum = round(splits.reduce((s, x) => s + x.amount, 0));
  const residual = round(target - sum);
  if (Math.abs(residual) > SPLIT_TOLERANCE) {
    throw new Error(`Payment splits (${sum}) do not add up to the document total (${target})`);
  }
  if (residual !== 0) {
    const largest = splits.reduce((a, b) => (b.amount > a.amount ? b : a));
    largest.amount = round(largest.amount + residual);
  }
  return splits;
}

export function creditPortion(splits: PaymentSplit[]): number {
  return round(splits.filter((s) => s.method === "CREDIT").reduce((sum, s) => sum + s.amount, 0));
}

export function settledPortion(splits: PaymentSplit[]): number {
  return round(splits.filter((s) => s.method !== "CREDIT").reduce((sum, s) => sum + s.amount, 0));
}

/** The cash, bank or mobile money account for a method. Credit settles through the account the caller passes. */
export function settlementAccountFor(defaults: DefaultAccountMap, method: SettlementMethod, creditAccountId?: string | null) {
  switch (method) {
    case "BANK":
      return defaults.defaultBankAccountId;
    case "MOBILE_MONEY":
      return defaults.mobileMoneyClearingId || defaults.defaultCashAccountId;
    case "CREDIT":
      return creditAccountId;
    default:
      return defaults.defaultCashAccountId;
  }
}

/** One line per settlement account (methods sharing an account are merged), on the side given. */
export function settlementLines(
  defaults: DefaultAccountMap,
  splits: PaymentSplit[],
  side: "debit" | "credit",
  options: { creditAccountId?: string | null; description: string; creditDescription?: string },
): JournalLineDraft[] {
  const byAccount = new Map<string, { amount: number; description: string }>();
  for (const split of splits) {
    const accountId = settlementAccountFor(defaults, split.method, options.creditAccountId);
    if (!accountId) {
      throw new Error(
        split.method === "CREDIT"
          ? "Credit settlement is not allowed for this document or its account is not configured"
          : `No ${split.method.toLowerCase().replace("_", " ")} account is configured`,
      );
    }
    const description = split.method === "CREDIT" ? options.creditDescription ?? options.description : `${options.description} (${split.method.toLowerCase().replace("_", " ")})`;
    const current = byAccount.get(accountId);
    byAccount.set(accountId, { amount: round((current?.amount ?? 0) + split.amount), description: current?.description ?? description });
  }
  return [...byAccount.entries()]
    .filter(([, v]) => v.amount > 0)
    .map(([accountId, v]) => ({ accountId, description: v.description, debit: side === "debit" ? v.amount : 0, credit: side === "credit" ? v.amount : 0 }));
}

function assertBalanced(lines: JournalLineDraft[]) {
  const debit = round(lines.reduce((s, l) => s + l.debit, 0));
  const credit = round(lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(debit - credit) > 0.0001) throw new Error(`Journal is not balanced: debits ${debit}, credits ${credit}`);
}

export interface SaleSettlementInput {
  net: number;
  tax: number;
  discount?: number;
  splits: PaymentSplit[];
}

/**
 * A POS sale: one debit per settlement method (credit to receivables), revenue and output VAT.
 * Cost of sales is not here; it posts from the inventory valuation subledger.
 */
export function buildSaleSettlementLines(defaults: DefaultAccountMap, input: SaleSettlementInput): JournalLineDraft[] {
  const net = round(input.net);
  const tax = round(input.tax);
  const discount = round(input.discount ?? 0);
  if (net <= 0) throw new Error("Sale amounts must be positive");
  if (!defaults.salesRevenueId) throw new Error("Default sales revenue account is not configured");
  if (!defaults.accountsReceivableId && input.splits.some((s) => s.method === "CREDIT")) {
    throw new Error("Accounts receivable account is not configured");
  }
  const lines = settlementLines(defaults, input.splits, "debit", {
    creditAccountId: defaults.accountsReceivableId,
    description: "Sale receipt",
    creditDescription: "Sale on credit",
  });
  if (discount > 0) {
    if (!defaults.salesDiscountsId) throw new Error("Sales discounts account is not configured");
    lines.push({ accountId: defaults.salesDiscountsId, description: "Sales discount", debit: discount, credit: 0 });
  }
  lines.push({ accountId: defaults.salesRevenueId, description: "Sales revenue", debit: 0, credit: net });
  if (tax > 0) {
    if (!defaults.outputTaxPayableId) throw new Error("Output tax account is not configured");
    lines.push({ accountId: defaults.outputTaxPayableId, description: "Output VAT", debit: 0, credit: tax });
  }
  assertBalanced(lines);
  return lines;
}

/**
 * A refund or return of a POS sale: sales returns and output VAT are debited, and the refund leaves through
 * each settlement method. A credit split reduces the customer's receivable instead of paying cash out.
 */
export function buildSaleRefundLines(defaults: DefaultAccountMap, input: SaleSettlementInput): JournalLineDraft[] {
  const net = round(input.net);
  const tax = round(input.tax);
  const discount = round(input.discount ?? 0);
  if (net <= 0) throw new Error("Refund amounts must be positive");
  const returns = defaults.salesReturnsId || defaults.salesRevenueId;
  if (!returns) throw new Error("Sales returns account is not configured");
  const lines: JournalLineDraft[] = [{ accountId: returns, description: "Sales returns", debit: net, credit: 0 }];
  if (tax > 0) {
    if (!defaults.outputTaxPayableId) throw new Error("Output tax account is not configured");
    lines.push({ accountId: defaults.outputTaxPayableId, description: "Output VAT reversed", debit: tax, credit: 0 });
  }
  if (discount > 0) {
    if (!defaults.salesDiscountsId) throw new Error("Sales discounts account is not configured");
    lines.push({ accountId: defaults.salesDiscountsId, description: "Sales discount reversed", debit: 0, credit: discount });
  }
  lines.push(
    ...settlementLines(defaults, input.splits, "credit", {
      creditAccountId: defaults.accountsReceivableId,
      description: "Refund paid",
      creditDescription: "Refund against receivable",
    }),
  );
  assertBalanced(lines);
  return lines;
}

/** A customer paying a receivable: one debit per method, credit to receivables. Credit is not a way to pay. */
export function buildCustomerReceiptLines(defaults: DefaultAccountMap, splits: PaymentSplit[], arAccountId?: string | null): JournalLineDraft[] {
  const ar = arAccountId || defaults.accountsReceivableId;
  if (!ar) throw new Error("Accounts receivable account is not configured");
  if (splits.some((s) => s.method === "CREDIT")) throw new Error("A customer payment cannot be settled on credit");
  const total = round(splits.reduce((s, x) => s + x.amount, 0));
  if (total <= 0) throw new Error("Payment amount must be positive");
  const lines = settlementLines(defaults, splits, "debit", { description: "Customer payment" });
  lines.push({ accountId: ar, description: "Accounts receivable", debit: 0, credit: total });
  assertBalanced(lines);
  return lines;
}

/**
 * A supplier credit note for goods sent back: payables are reduced by the gross, the stock leaves inventory at
 * its valuation cost, input VAT is reversed, and any gap between the credited net and that cost goes to
 * purchase returns.
 */
export function buildSupplierReturnLines(
  defaults: DefaultAccountMap,
  input: { net: number; tax: number; cost: number; apAccountId?: string | null; returnsAccountId?: string | null },
): JournalLineDraft[] {
  const net = round(input.net);
  const tax = round(input.tax);
  const cost = round(input.cost);
  if (net <= 0) throw new Error("Credit note amount must be positive");
  if (cost < 0) throw new Error("Returned stock cost cannot be negative");
  const ap = input.apAccountId || defaults.accountsPayableId;
  if (!ap) throw new Error("Accounts payable account is not configured");
  if (cost > 0 && !defaults.inventoryAssetId) throw new Error("Inventory asset account is not configured");
  const lines: JournalLineDraft[] = [{ accountId: ap, description: "Accounts payable", debit: round(net + tax), credit: 0 }];
  if (cost > 0) lines.push({ accountId: defaults.inventoryAssetId!, description: "Stock returned to supplier", debit: 0, credit: cost });
  const gap = round(net - cost);
  if (gap !== 0) {
    const returns = input.returnsAccountId || defaults.purchaseReturnsId || defaults.purchasesId;
    if (!returns) throw new Error("Purchase returns account is not configured");
    lines.push({ accountId: returns, description: "Purchase returns", debit: gap < 0 ? -gap : 0, credit: gap > 0 ? gap : 0 });
  }
  if (tax > 0) {
    if (!defaults.inputTaxReceivableId) throw new Error("Input tax account is not configured");
    lines.push({ accountId: defaults.inputTaxReceivableId, description: "Input VAT reversed", debit: 0, credit: tax });
  }
  assertBalanced(lines);
  return lines;
}

/** A payment to a supplier: debit payables, one credit per method. */
export function buildSupplierPaymentSettlementLines(defaults: DefaultAccountMap, splits: PaymentSplit[], apAccountId?: string | null): JournalLineDraft[] {
  const ap = apAccountId || defaults.accountsPayableId;
  if (!ap) throw new Error("Accounts payable account is not configured");
  if (splits.some((s) => s.method === "CREDIT")) throw new Error("A supplier payment cannot be settled on credit");
  const total = round(splits.reduce((s, x) => s + x.amount, 0));
  if (total <= 0) throw new Error("Payment amount must be positive");
  const lines: JournalLineDraft[] = [{ accountId: ap, description: "Accounts payable", debit: total, credit: 0 }];
  lines.push(...settlementLines(defaults, splits, "credit", { description: "Supplier payment" }));
  assertBalanced(lines);
  return lines;
}
