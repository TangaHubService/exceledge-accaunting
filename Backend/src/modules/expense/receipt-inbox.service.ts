import { z } from "zod";
import { HttpError, notFound } from "../../lib/http";
import { inTransaction, lockForTransaction, prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { createExpense } from "./expense.service";

type Actor = Parameters<typeof createExpense>[2];

export async function listInbox(companyId: string, status: string) {
  const items = await prisma.receiptInboxItem.findMany({ where: { companyId, status }, orderBy: { createdAt: "desc" }, take: 500 });
  const files = await prisma.accountingDocument.findMany({ where: { companyId, entityType: { in: ["ReceiptInbox", "Expense"] }, entityId: { in: items.flatMap((i) => [i.id, i.expenseId ?? ""]) } }, select: { id: true, entityId: true, fileName: true, mimeType: true, sizeBytes: true, storageKey: true } });
  return items.map((i) => ({ ...i, files: files.filter((f) => f.entityId === i.id || f.entityId === i.expenseId).map(({ storageKey, ...f }) => ({ ...f, stored: Boolean(storageKey) })) }));
}

export async function addInboxItem(companyId: string, note: string | undefined, actor: Actor) {
  const row = await prisma.receiptInboxItem.create({ data: { companyId, note: note?.trim() || null, createdByErpUserId: actor?.erpUserId } });
  return row;
}

export const inboxExpenseBody = z.object({
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a yyyy-mm-dd date"),
  categoryId: z.string().min(1, "Choose a category"),
  payeeName: z.string().trim().max(160).optional(),
  supplierId: z.string().optional(),
  description: z.string().trim().max(2000).optional(),
  net: z.number().positive(),
  tax: z.number().min(0).optional(),
  financialAccountId: z.string().optional(),
});

/** Turns a receipt into a draft expense and moves its files there. Posting stays a separate, approved step. */
export async function inboxToExpense(companyId: string, id: string, input: z.infer<typeof inboxExpenseBody>, actor: Actor) {
  return inTransaction(async () => {
    await lockForTransaction(`receipt-inbox:${id}`);
    const item = await prisma.receiptInboxItem.findFirst({ where: { id, companyId } });
    if (!item) throw notFound("Receipt");
    if (item.status !== "NEW") throw new HttpError(409, "This receipt is already dealt with");
    const expense = await createExpense(companyId, { ...input, paymentMode: "IMMEDIATE" }, actor);
    await prisma.accountingDocument.updateMany({ where: { companyId, entityType: "ReceiptInbox", entityId: id }, data: { entityType: "Expense", entityId: expense.id } });
    await prisma.receiptInboxItem.update({ where: { id }, data: { status: "USED", expenseId: expense.id } });
    return expense;
  });
}

export async function dismissInboxItem(companyId: string, id: string, actor: Actor) {
  const done = await prisma.receiptInboxItem.updateMany({ where: { id, companyId, status: "NEW" }, data: { status: "DISMISSED" } });
  if (!done.count) throw new HttpError(409, "This receipt is already dealt with");
  await writeAudit({ companyId, erpUserId: actor?.erpUserId ?? 0, erpRole: actor?.erpRole, action: "DISMISS", entityType: "ReceiptInbox", entityId: id });
  return { id };
}
