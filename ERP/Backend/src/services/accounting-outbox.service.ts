import { randomUUID } from "crypto";
import { AccountingOutboxStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

const ACCOUNTING_API_URL = (
  process.env.ACCOUNTING_API_URL ||
  "http://localhost:4600"
).replace(/\/$/, "");
const ACCOUNTING_INTEGRATION_API_KEY =
  process.env.ACCOUNTING_INTEGRATION_API_KEY || "dev-integration-key";

export function isAccountingIntegrationEnabled(): boolean {
  const flag = process.env.ACCOUNTING_INTEGRATION_ENABLED;
  if (flag === "false" || flag === "0") return false;
  return true;
}

export async function enqueueSaleCompletedAccountingEvent(input: {
  organizationId: number;
  branchId: number;
  saleId: number;
  saleNumber?: string | null;
  invoiceNumber?: string | null;
  customerId?: number | null;
  currencyCode?: string;
  totalAmount: number;
  taxableAmount: number;
  vatAmount: number;
  paymentType?: string | null;
  splitPayments?: Array<{ paymentMethod: string; amount: number }>;
  cogs?: number;
  occurredAt?: Date;
}): Promise<void> {
  if (!isAccountingIntegrationEnabled()) return;

  const idempotencyKey = [
    input.organizationId,
    "POS",
    "Sale",
    input.saleId,
    "SALE_COMPLETED",
    "1",
  ].join("|");

  const payload = {
    eventId: randomUUID(),
    idempotencyKey,
    externalOrganizationId: String(input.organizationId),
    externalBranchId: String(input.branchId),
    eventType: "SALE_COMPLETED",
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    sourceModule: "POS",
    sourceDocumentType: "Sale",
    sourceDocumentId: String(input.saleId),
    sourceDocumentNumber: input.invoiceNumber || input.saleNumber || undefined,
    currencyCode: input.currencyCode || "RWF",
    amountTotals: {
      gross: String(input.totalAmount),
      net: String(input.taxableAmount),
      tax: String(input.vatAmount),
    },
    parties: input.customerId
      ? { externalCustomerId: String(input.customerId) }
      : undefined,
    paymentSplits: input.splitPayments,
    metadata: {
      paymentType: input.paymentType,
      cogs: input.cogs ?? 0,
    },
  };

  await prisma.erpAccountingOutbox.upsert({
    where: { idempotencyKey },
    create: {
      organizationId: input.organizationId,
      saleId: input.saleId,
      eventType: "SALE_COMPLETED",
      idempotencyKey,
      payload: payload as Prisma.InputJsonValue,
      status: AccountingOutboxStatus.PENDING,
      nextAttemptAt: new Date(),
    },
    update: {},
  });
}

type InventoryLedgerRow = {
  id: number;
  organizationId: number;
  productId: number;
  branchId: number | null;
  movementType: string;
  direction: string;
  quantity: number | Prisma.Decimal;
  runningBalance: number | Prisma.Decimal;
  unitCost?: Prisma.Decimal | number | null;
  reference?: string | null;
  referenceType?: string | null;
  batchNumber?: string | null;
  note?: string | null;
  createdAt: Date;
};

/** Batch-weighted average cost at a branch, read through the caller's transaction. */
async function branchAverageCost(tx: Prisma.TransactionClient, organizationId: number, productId: number, branchId: number | null) {
  if (branchId == null) return null;
  const batches = await tx.batch.findMany({
    where: { organizationId, productId, branchId, isActive: true, quantity: { gt: 0 } },
    select: { unitCost: true, quantity: true },
  });
  const quantity = batches.reduce((sum, b) => sum + Number(b.quantity), 0);
  if (quantity <= 0) return null;
  return batches.reduce((sum, b) => sum + Number(b.unitCost) * Number(b.quantity), 0) / quantity;
}

/**
 * Queues one stock movement for Accounting in the same transaction that wrote the ledger row, so the
 * valuation subledger sees every movement exactly once. The cost is the row's own cost, the cost the
 * caller used (e.g. the batch a sale drew from), or the branch's batch average.
 */
export async function enqueueInventoryMovementAccountingEvent(
  tx: Prisma.TransactionClient,
  row: InventoryLedgerRow,
  options: { unitCost?: number | null } = {},
): Promise<void> {
  if (!isAccountingIntegrationEnabled()) return;

  const [product, branch] = await Promise.all([
    tx.product.findUnique({ where: { id: row.productId }, select: { name: true, sku: true, category: true, qtyUnitCd: true } }),
    row.branchId ? tx.branch.findUnique({ where: { id: row.branchId }, select: { name: true } }) : null,
  ]);
  const ownCost = row.unitCost == null ? 0 : Number(row.unitCost);
  const unitCost =
    ownCost > 0
      ? ownCost
      : options.unitCost && options.unitCost > 0
        ? options.unitCost
        : await branchAverageCost(tx, row.organizationId, row.productId, row.branchId);

  const idempotencyKey = [row.organizationId, "INVENTORY", "InventoryLedger", row.id, "INVENTORY_MOVEMENT", "1"].join("|");
  const payload = {
    eventId: randomUUID(),
    idempotencyKey,
    externalOrganizationId: String(row.organizationId),
    externalBranchId: row.branchId ? String(row.branchId) : undefined,
    eventType: "INVENTORY_MOVEMENT",
    occurredAt: row.createdAt.toISOString(),
    sourceModule: "INVENTORY",
    sourceDocumentType: "InventoryLedger",
    sourceDocumentId: String(row.id),
    sourceDocumentNumber: row.reference || undefined,
    currencyCode: "RWF",
    amountTotals: { gross: "0", net: "0", tax: "0" },
    metadata: {
      ledgerId: row.id,
      movementType: row.movementType,
      direction: row.direction,
      productId: row.productId,
      productName: product?.name,
      sku: product?.sku,
      category: product?.category,
      unit: product?.qtyUnitCd,
      branchId: row.branchId,
      branchName: branch?.name,
      quantity: Number(row.quantity),
      runningBalance: Number(row.runningBalance),
      unitCost: unitCost ?? null,
      reference: row.reference,
      referenceType: row.referenceType,
      batchNumber: row.batchNumber,
      note: row.note,
    },
  };

  await tx.erpAccountingOutbox.upsert({
    where: { idempotencyKey },
    create: {
      organizationId: row.organizationId,
      eventType: "INVENTORY_MOVEMENT",
      idempotencyKey,
      payload: payload as Prisma.InputJsonValue,
      status: AccountingOutboxStatus.PENDING,
      nextAttemptAt: new Date(),
    },
    update: {},
  });
}

/**
 * Queues the organization's current stock by branch, valued at each branch's batch average, as
 * Accounting's opening inventory. Accounting applies it once per item and branch.
 */
export async function enqueueInventoryOpeningSnapshot(organizationId: number) {
  const [latest, batches, branches] = await Promise.all([
    prisma.inventoryLedger.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      distinct: ["productId", "branchId"],
      select: { productId: true, branchId: true, runningBalance: true },
    }),
    prisma.batch.findMany({
      where: { organizationId, isActive: true, quantity: { gt: 0 } },
      select: { productId: true, branchId: true, unitCost: true, quantity: true },
    }),
    prisma.branch.findMany({ where: { organizationId }, select: { id: true, name: true } }),
  ]);

  const costs = new Map<string, { cost: number; quantity: number }>();
  for (const b of batches) {
    const key = `${b.productId}:${b.branchId}`;
    const row = costs.get(key) ?? { cost: 0, quantity: 0 };
    row.cost += Number(b.unitCost) * Number(b.quantity);
    row.quantity += Number(b.quantity);
    costs.set(key, row);
  }
  const onHand = latest.filter((l) => l.branchId != null && Number(l.runningBalance) > 0);
  const products = await prisma.product.findMany({
    where: { id: { in: [...new Set(onHand.map((l) => l.productId))] } },
    select: { id: true, name: true, sku: true, category: true, qtyUnitCd: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  const lines = onHand.map((l) => {
    const cost = costs.get(`${l.productId}:${l.branchId}`);
    const product = productById.get(l.productId);
    return {
      productId: l.productId,
      productName: product?.name,
      sku: product?.sku,
      category: product?.category,
      unit: product?.qtyUnitCd,
      branchId: l.branchId,
      branchName: branchName.get(l.branchId as number),
      quantity: Number(l.runningBalance),
      unitCost: cost && cost.quantity > 0 ? cost.cost / cost.quantity : 0,
    };
  });
  const uncosted = lines.filter((l) => !(l.unitCost > 0)).length;
  if (!lines.length) return { queued: false, lines: 0, uncosted: 0 };

  const snapshotAt = new Date();
  const idempotencyKey = [organizationId, "INVENTORY", "OpeningSnapshot", snapshotAt.getTime(), "INVENTORY_OPENING", "1"].join("|");
  await prisma.erpAccountingOutbox.create({
    data: {
      organizationId,
      eventType: "INVENTORY_OPENING",
      idempotencyKey,
      payload: {
        eventId: randomUUID(),
        idempotencyKey,
        externalOrganizationId: String(organizationId),
        eventType: "INVENTORY_OPENING",
        occurredAt: snapshotAt.toISOString(),
        sourceModule: "INVENTORY",
        sourceDocumentType: "OpeningSnapshot",
        sourceDocumentId: String(snapshotAt.getTime()),
        currencyCode: "RWF",
        amountTotals: { gross: "0", net: "0", tax: "0" },
        lines,
        metadata: { snapshotAt: snapshotAt.toISOString() },
      } as Prisma.InputJsonValue,
      status: AccountingOutboxStatus.PENDING,
      nextAttemptAt: new Date(),
    },
  });
  return { queued: true, lines: lines.length, uncosted };
}

/**
 * A scanned supplier invoice becomes a supplier bill in Accounting once it is imported. Stock
 * imported from it is already on Goods Received Not Invoiced at cost (`receivedAtCost`), which the
 * bill clears; the rest of the invoice goes to purchases.
 */
export async function enqueueScannedSupplierBillAccountingEvent(
  invoiceId: number,
  receivedAtCost: number,
): Promise<{ queued: boolean; reason?: string }> {
  if (!isAccountingIntegrationEnabled()) return { queued: false, reason: "Accounting integration is off" };
  const invoice = await prisma.supplierInvoice.findUnique({
    where: { id: invoiceId },
    include: { files: { orderBy: { createdAt: "asc" }, take: 1 }, supplier: true },
  });
  if (!invoice) return { queued: false, reason: "Invoice not found" };
  if (!invoice.supplierId) return { queued: false, reason: "The invoice has no supplier" };
  const tax = Number(invoice.taxAmount ?? 0);
  const total = Number(invoice.totalAmount ?? 0);
  const net = invoice.subtotal != null ? Number(invoice.subtotal) - Number(invoice.discount ?? 0) : total - tax;
  if (!(net > 0)) return { queued: false, reason: "The invoice has no amount to bill" };

  const idempotencyKey = [invoice.organizationId, "PURCHASES", "SupplierInvoice", invoice.id, "SUPPLIER_BILL_APPROVED", "1"].join("|");
  const file = invoice.files[0];
  const payload = {
    eventId: randomUUID(),
    idempotencyKey,
    externalOrganizationId: String(invoice.organizationId),
    externalBranchId: String(invoice.branchId),
    eventType: "SUPPLIER_BILL_APPROVED",
    occurredAt: (invoice.invoiceDate ?? invoice.importedAt ?? new Date()).toISOString(),
    sourceModule: "PURCHASES",
    sourceDocumentType: "SupplierInvoice",
    sourceDocumentId: String(invoice.id),
    sourceDocumentNumber: invoice.invoiceNumber || `SCAN-${invoice.id}`,
    currencyCode: invoice.currency || "RWF",
    amountTotals: { gross: String(net + tax), net: String(net), tax: String(tax) },
    parties: { externalSupplierId: String(invoice.supplierId) },
    metadata: {
      supplierName: invoice.supplier?.name ?? invoice.supplierName,
      supplierTin: invoice.vendorTIN,
      supplierInvoiceNumber: invoice.invoiceNumber,
      dueDate: invoice.dueDate?.toISOString(),
      poReference: invoice.poNumber,
      receivedAtCost: Math.round(receivedAtCost * 100) / 100,
      capturedBy: "OCR",
      fraudRiskScore: invoice.fraudRiskScore,
      mathVerified: invoice.mathVerified,
      document: file ? { fileName: file.originalName, path: `/uploads/invoices/${file.storedName}`, mimeType: file.mimeType } : undefined,
    },
  };
  await prisma.erpAccountingOutbox.upsert({
    where: { idempotencyKey },
    create: {
      organizationId: invoice.organizationId,
      eventType: "SUPPLIER_BILL_APPROVED",
      idempotencyKey,
      payload: payload as Prisma.InputJsonValue,
      status: AccountingOutboxStatus.PENDING,
      nextAttemptAt: new Date(),
    },
    update: {},
  });
  return { queued: true };
}

type PayrollRunForAccounting = {
  id: number;
  organizationId: number;
  periodYear: number;
  periodMonth: number;
  employeeCount: number;
  grossPay: Prisma.Decimal | number;
  paye: Prisma.Decimal | number;
  employeeRssb: Prisma.Decimal | number;
  employerRssb: Prisma.Decimal | number;
  cbhi: Prisma.Decimal | number;
  netPay: Prisma.Decimal | number;
  paymentMethod?: string | null;
};

/**
 * Approval accrues the payroll (expense against PAYE, RSSB and net salaries payable); payment
 * clears net salaries payable. Both are queued in the caller's transaction.
 */
export async function enqueuePayrollAccountingEvent(
  tx: Prisma.TransactionClient,
  run: PayrollRunForAccounting,
  kind: "PAYROLL_APPROVED" | "PAYROLL_PAID",
  occurredAt: Date,
): Promise<void> {
  if (!isAccountingIntegrationEnabled()) return;
  const period = `${run.periodYear}-${String(run.periodMonth).padStart(2, "0")}`;
  const idempotencyKey = [run.organizationId, "PAYROLL", "PayrollRun", run.id, kind, "1"].join("|");
  const figures = {
    grossPay: Number(run.grossPay),
    paye: Number(run.paye),
    employeeRssb: Number(run.employeeRssb),
    employerRssb: Number(run.employerRssb),
    cbhi: Number(run.cbhi),
    netPay: Number(run.netPay),
  };
  const payload = {
    eventId: randomUUID(),
    idempotencyKey,
    externalOrganizationId: String(run.organizationId),
    eventType: kind,
    occurredAt: occurredAt.toISOString(),
    sourceModule: "PAYROLL",
    sourceDocumentType: "PayrollRun",
    sourceDocumentId: String(run.id),
    sourceDocumentNumber: `PAYROLL-${period}`,
    currencyCode: "RWF",
    amountTotals:
      kind === "PAYROLL_APPROVED"
        ? { gross: String(figures.grossPay), net: String(figures.netPay), tax: String(figures.paye) }
        : { gross: String(figures.netPay), net: String(figures.netPay), tax: "0" },
    paymentSplits: kind === "PAYROLL_PAID" ? [{ paymentMethod: run.paymentMethod ?? "BANK", amount: figures.netPay }] : undefined,
    metadata: { period, employeeCount: run.employeeCount, ...figures, paymentMethod: run.paymentMethod ?? undefined },
  };
  await tx.erpAccountingOutbox.upsert({
    where: { idempotencyKey },
    create: {
      organizationId: run.organizationId,
      eventType: kind,
      idempotencyKey,
      payload: payload as Prisma.InputJsonValue,
      status: AccountingOutboxStatus.PENDING,
      nextAttemptAt: new Date(),
    },
    update: {},
  });
}

type OutboxWriter = Pick<Prisma.TransactionClient, "erpAccountingOutbox">;

/** Queues one event in the caller's transaction; the idempotency key keeps a retried request from queuing it twice. */
async function enqueueEvent(
  db: OutboxWriter,
  input: {
    organizationId: number;
    branchId?: number | null;
    eventType: string;
    sourceModule: string;
    sourceDocumentType: string;
    sourceDocumentId: string | number;
    sourceDocumentNumber?: string | null;
    occurredAt?: Date;
    amountTotals: { gross: number; net: number; tax: number };
    parties?: { externalCustomerId?: string; externalSupplierId?: string };
    paymentSplits?: Array<{ paymentMethod: string; amount: number }>;
    lines?: unknown[];
    metadata?: Record<string, unknown>;
    saleId?: number;
  },
) {
  if (!isAccountingIntegrationEnabled()) return;
  const idempotencyKey = [input.organizationId, input.sourceModule, input.sourceDocumentType, input.sourceDocumentId, input.eventType, "1"].join("|");
  const payload = {
    eventId: randomUUID(),
    idempotencyKey,
    externalOrganizationId: String(input.organizationId),
    externalBranchId: input.branchId ? String(input.branchId) : undefined,
    eventType: input.eventType,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    sourceModule: input.sourceModule,
    sourceDocumentType: input.sourceDocumentType,
    sourceDocumentId: String(input.sourceDocumentId),
    sourceDocumentNumber: input.sourceDocumentNumber || undefined,
    currencyCode: "RWF",
    amountTotals: {
      gross: String(input.amountTotals.gross),
      net: String(input.amountTotals.net),
      tax: String(input.amountTotals.tax),
    },
    parties: input.parties,
    paymentSplits: input.paymentSplits,
    lines: input.lines,
    metadata: input.metadata,
  };
  await db.erpAccountingOutbox.upsert({
    where: { idempotencyKey },
    create: {
      organizationId: input.organizationId,
      saleId: input.saleId,
      eventType: input.eventType,
      idempotencyKey,
      payload: payload as Prisma.InputJsonValue,
      status: AccountingOutboxStatus.PENDING,
      nextAttemptAt: new Date(),
    },
    update: {},
  });
}

/**
 * A refund reverses the sale's revenue and VAT in Accounting and credits the customer's invoice;
 * the returned stock arrives separately as RETURN_CUSTOMER movements, valued by Accounting.
 */
export async function enqueueSaleRefundedAccountingEvent(
  tx: OutboxWriter,
  input: {
    organizationId: number;
    branchId: number;
    refundSaleId: number;
    refundNumber?: string | null;
    originalSaleId: number;
    originalSaleNumber?: string | null;
    customerId?: number | null;
    paymentType?: string | null;
    /** Debt still owed on the original sale; the refund clears that first and pays back the rest. */
    outstandingDebt?: number | null;
    gross: number;
    net: number;
    tax: number;
    reason?: string | null;
  },
) {
  const onAccount = Math.min(input.gross, Math.max(0, Number(input.outstandingDebt ?? 0) || 0));
  const paidBack = Math.round((input.gross - onAccount) * 100) / 100;
  const paidMethod = ["DEBT", "INSURANCE", "MIXED", "SPLIT", "", undefined, null].includes(input.paymentType as string)
    ? "CASH"
    : String(input.paymentType);
  await enqueueEvent(tx, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    eventType: "SALE_REFUNDED",
    sourceModule: "POS",
    sourceDocumentType: "SaleRefund",
    sourceDocumentId: input.refundSaleId,
    sourceDocumentNumber: input.refundNumber,
    amountTotals: { gross: input.gross, net: input.net, tax: input.tax },
    parties: input.customerId ? { externalCustomerId: String(input.customerId) } : undefined,
    paymentSplits: [
      ...(onAccount > 0 ? [{ paymentMethod: "DEBT", amount: onAccount }] : []),
      ...(paidBack > 0 ? [{ paymentMethod: paidMethod, amount: paidBack }] : []),
    ],
    metadata: {
      originalSaleId: String(input.originalSaleId),
      originalSaleNumber: input.originalSaleNumber,
      paymentType: input.paymentType,
      reason: input.reason,
    },
    saleId: input.originalSaleId,
  });
}

/** A customer paying off a credit sale. `paymentId` identifies the payment record (or a unique token when there is none). */
export async function enqueueCustomerPaymentAccountingEvent(
  tx: OutboxWriter,
  input: {
    organizationId: number;
    branchId?: number | null;
    paymentId: string | number;
    saleId: number;
    saleNumber?: string | null;
    customerId: number;
    amount: number;
    paymentMethod?: string | null;
    reference?: string | null;
    occurredAt?: Date;
  },
) {
  await enqueueEvent(tx, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    eventType: "CUSTOMER_PAYMENT_RECEIVED",
    sourceModule: "POS",
    sourceDocumentType: "DebtPayment",
    sourceDocumentId: input.paymentId,
    sourceDocumentNumber: input.reference || (input.saleNumber ? `DEBT-${input.saleNumber}` : undefined),
    occurredAt: input.occurredAt,
    amountTotals: { gross: input.amount, net: input.amount, tax: 0 },
    parties: { externalCustomerId: String(input.customerId) },
    paymentSplits: [{ paymentMethod: input.paymentMethod || "CASH", amount: input.amount }],
    metadata: { saleId: String(input.saleId), saleNumber: input.saleNumber, paymentMethod: input.paymentMethod },
    saleId: input.saleId,
  });
}

const SUPPLIER_PAYMENT_EVENT = "SUPPLIER_PAYMENT_MADE";

/**
 * Takes a supplier payment's event back off the queue so the payment can be deleted. Returns false once the
 * event may have reached Accounting (it was picked up for sending); the payment then stays in the books.
 */
export async function withdrawSupplierPaymentAccountingEvent(
  tx: OutboxWriter,
  input: { organizationId: number; paymentId: number },
): Promise<boolean> {
  const idempotencyKey = [input.organizationId, "PURCHASES", "SupplierPayment", input.paymentId, SUPPLIER_PAYMENT_EVENT, "1"].join("|");
  const queued = await tx.erpAccountingOutbox.findUnique({ where: { idempotencyKey }, select: { id: true } });
  if (!queued) return true;
  const removed = await tx.erpAccountingOutbox.deleteMany({
    where: { idempotencyKey, status: AccountingOutboxStatus.PENDING, retryCount: 0 },
  });
  return removed.count === 1;
}

export async function enqueueSupplierPaymentAccountingEvent(
  tx: OutboxWriter,
  input: {
    organizationId: number;
    branchId?: number | null;
    paymentId: number;
    supplierId: number;
    supplierName?: string | null;
    purchaseOrderNumber?: string | null;
    amount: number;
    paymentMethod: string;
    paymentDate: Date;
    reference?: string | null;
  },
) {
  await enqueueEvent(tx, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    eventType: SUPPLIER_PAYMENT_EVENT,
    sourceModule: "PURCHASES",
    sourceDocumentType: "SupplierPayment",
    sourceDocumentId: input.paymentId,
    sourceDocumentNumber: input.reference || `SPAY-${input.paymentId}`,
    occurredAt: input.paymentDate,
    amountTotals: { gross: input.amount, net: input.amount, tax: 0 },
    parties: { externalSupplierId: String(input.supplierId) },
    paymentSplits: [{ paymentMethod: input.paymentMethod, amount: input.amount }],
    metadata: { supplierName: input.supplierName, poReference: input.purchaseOrderNumber, paymentMethod: input.paymentMethod },
  });
}

/**
 * Goods received against a purchase order. The stock value itself reaches Accounting through the
 * PURCHASE inventory movements; this event records the receipt so a later supplier bill for the same
 * order clears goods received not invoiced instead of booking the purchase twice.
 */
export async function enqueueGoodsReceivedAccountingEvent(
  tx: OutboxWriter,
  input: {
    organizationId: number;
    branchId: number;
    purchaseOrderId: number;
    purchaseOrderNumber: string;
    supplierId: number;
    supplierName?: string | null;
    receivedAt: Date;
    lines: Array<{ productId: number | null; productName: string; quantity: number; unitCost: number }>;
  },
) {
  const net = Math.round(input.lines.reduce((s, l) => s + l.quantity * l.unitCost, 0) * 100) / 100;
  if (!(net > 0)) return;
  await enqueueEvent(tx, {
    organizationId: input.organizationId,
    branchId: input.branchId,
    eventType: "GOODS_RECEIVED",
    sourceModule: "PURCHASES",
    sourceDocumentType: "PurchaseOrderReceipt",
    sourceDocumentId: `${input.purchaseOrderId}:${input.receivedAt.getTime()}`,
    sourceDocumentNumber: input.purchaseOrderNumber,
    occurredAt: input.receivedAt,
    amountTotals: { gross: net, net, tax: 0 },
    parties: { externalSupplierId: String(input.supplierId) },
    lines: input.lines,
    metadata: { supplierName: input.supplierName, poReference: input.purchaseOrderNumber, purchaseOrderId: input.purchaseOrderId },
  });
}

export async function processAccountingOutboxBatch(limit = 40): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  if (!isAccountingIntegrationEnabled()) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  const rows = await prisma.erpAccountingOutbox.findMany({
    where: {
      status: { in: [AccountingOutboxStatus.PENDING, AccountingOutboxStatus.FAILED] },
      nextAttemptAt: { lte: new Date() },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    const claimed = await prisma.erpAccountingOutbox.updateMany({
      where: { id: row.id, status: row.status },
      data: { status: AccountingOutboxStatus.PROCESSING },
    });
    if (claimed.count !== 1) continue;

    try {
      const res = await fetch(`${ACCOUNTING_API_URL}/api/v1/integration/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-integration-key": ACCOUNTING_INTEGRATION_API_KEY,
        },
        body: JSON.stringify(row.payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };
      if (!res.ok || body.success === false) {
        throw new Error(body.error || `Accounting ingest HTTP ${res.status}`);
      }

      await prisma.erpAccountingOutbox.update({
        where: { id: row.id },
        data: {
          status: AccountingOutboxStatus.SUCCEEDED,
          lastError: null,
        },
      });
      succeeded += 1;
    } catch (e) {
      const retryCount = row.retryCount + 1;
      const dead = retryCount >= 8;
      await prisma.erpAccountingOutbox.update({
        where: { id: row.id },
        data: {
          status: dead
            ? AccountingOutboxStatus.DEAD_LETTER
            : AccountingOutboxStatus.FAILED,
          retryCount,
          lastError: (e as Error).message,
          nextAttemptAt: new Date(Date.now() + Math.min(retryCount, 10) * 60_000),
        },
      });
      failed += 1;
    }
  }

  return { processed: rows.length, succeeded, failed };
}
