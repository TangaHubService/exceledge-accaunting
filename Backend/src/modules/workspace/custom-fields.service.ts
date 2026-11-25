import { z } from "zod";
import { HttpError, notFound } from "../../lib/http";
import { inTransaction, prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { assertCan, ATTACHABLE_TYPES, findRecord } from "../books/documents.service";

type Actor = Parameters<typeof assertCan>[0] & { erpUserId?: number; erpRole?: string };
export const FIELD_ENTITIES = ["ArInvoice", "ApBill", "Customer", "Supplier", "Expense", "Project"] as const;

export const fieldBody = z
  .object({
    entityType: z.enum(FIELD_ENTITIES),
    name: z.string().trim().min(1, "Name the field").max(60),
    type: z.enum(["TEXT", "NUMBER", "DATE", "LIST", "YES_NO"]),
    options: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
    showOnForm: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .refine((f) => f.type !== "LIST" || f.options.length > 0, { message: "A list needs at least one choice", path: ["options"] });

export const listFields = (companyId: string) => prisma.customField.findMany({ where: { companyId }, orderBy: [{ entityType: "asc" }, { createdAt: "asc" }] });

export async function saveField(companyId: string, id: string | null, input: z.infer<typeof fieldBody>, actor: Actor) {
  const before = id ? await prisma.customField.findFirst({ where: { id, companyId } }) : null;
  if (id && !before) throw notFound("Custom field");
  // Values already entered were checked against the type, so it stays.
  if (before && (before.type !== input.type || before.entityType !== input.entityType) && (await prisma.customFieldValue.count({ where: { fieldId: before.id } }))) throw new HttpError(409, "This field has values; its type can't change");
  if (!id && (await prisma.customField.count({ where: { companyId, entityType: input.entityType, isActive: true } })) >= 20) throw new HttpError(400, "At most 20 fields for each kind of record");
  if (await prisma.customField.count({ where: { companyId, entityType: input.entityType, name: input.name, NOT: { id: before?.id ?? "" } } })) throw new HttpError(409, "There is already a field with that name");
  const row = before ? await prisma.customField.update({ where: { id: before.id }, data: input }) : await prisma.customField.create({ data: { ...input, companyId } });
  await writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action: before ? "UPDATE" : "CREATE", entityType: "CustomField", entityId: row.id, beforeJson: before ?? undefined, afterJson: row });
  return row;
}

function check(field: { name: string; type: string; options: string[] }, value: string) {
  const bad = (why: string) => new HttpError(400, `${field.name} ${why}`);
  if (value.length > 500) throw bad("is too long");
  if (field.type === "NUMBER" && !/^-?\d{1,15}(\.\d{1,6})?$/.test(value)) throw bad("must be a number");
  if (field.type === "DATE" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))) throw bad("must be a date");
  if (field.type === "YES_NO" && value !== "Yes" && value !== "No") throw bad("must be Yes or No");
  if (field.type === "LIST" && !field.options.includes(value)) throw bad("must be one of its choices");
}

export async function recordValues(companyId: string, entityType: string, entityId: string, actor: Actor) {
  const type = z.enum(FIELD_ENTITIES).parse(entityType);
  assertCan(actor, ATTACHABLE_TYPES[type].view);
  if (!(await findRecord(companyId, type, entityId))) throw notFound("Record");
  const fields = await prisma.customField.findMany({ where: { companyId, entityType: type, isActive: true }, include: { values: { where: { entityId } } }, orderBy: { createdAt: "asc" } });
  return fields.map(({ values, ...f }) => ({ ...f, value: values[0]?.value ?? "" }));
}

export async function saveValues(companyId: string, entityType: string, entityId: string, input: Record<string, string>, actor: Actor) {
  const type = z.enum(FIELD_ENTITIES).parse(entityType);
  assertCan(actor, ATTACHABLE_TYPES[type].attach);
  if (!(await findRecord(companyId, type, entityId))) throw notFound("Record");
  return inTransaction(async () => {
    const fields = await prisma.customField.findMany({ where: { companyId, entityType: type, isActive: true, id: { in: Object.keys(input) } } });
    if (fields.length !== Object.keys(input).length) throw notFound("Custom field");
    const before: Record<string, string> = {};
    for (const f of fields) {
      const value = input[f.id].trim();
      const where = { fieldId_entityId: { fieldId: f.id, entityId } };
      before[f.name] = (await prisma.customFieldValue.findUnique({ where }))?.value ?? "";
      if (!value) await prisma.customFieldValue.deleteMany({ where: { fieldId: f.id, entityId } });
      else {
        check(f, value);
        await prisma.customFieldValue.upsert({ where, create: { fieldId: f.id, entityId, value }, update: { value } });
      }
    }
    await writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action: "UPDATE_FIELDS", entityType: type, entityId, beforeJson: before, afterJson: Object.fromEntries(fields.map((f) => [f.name, input[f.id].trim()])) });
    return recordValues(companyId, entityType, entityId, actor);
  });
}

/** What the customer sees on a printed document. */
export async function printedFields(companyId: string, entityType: (typeof FIELD_ENTITIES)[number], entityId: string): Promise<Array<[string, string]>> {
  const rows = await prisma.customFieldValue.findMany({ where: { entityId, field: { companyId, entityType, isActive: true, showOnForm: true } }, include: { field: { select: { name: true, createdAt: true } } } });
  return rows.sort((a, b) => a.field.createdAt.getTime() - b.field.createdAt.getTime()).map((r) => [r.field.name, r.value]);
}
