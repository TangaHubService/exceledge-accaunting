import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { type AccountingCapability, hasCapability } from "@exceledge/accounting-domain";
import { inTransaction, prisma } from "../../lib/prisma";
import { documentStorage, newStorageKey } from "../../lib/storage";
import { writeAudit } from "../audit/audit.service";

type Actor = { erpUserId?: number; erpRole?: string };

/** Records that take uploaded files, with the capability to see them and to attach to them. */
export const ATTACHABLE_TYPES = {
  Journal: { view: "journal:view", attach: "journal:create" },
  ApBill: { view: "ap:view", attach: "ap:manage" },
  ArInvoice: { view: "ar:view", attach: "ar:manage" },
  Expense: { view: "expense:view", attach: "expense:manage" },
  FixedAsset: { view: "fa:view", attach: "fa:manage" },
  BankReconciliation: { view: "bank:view", attach: "bank:manage" },
  ControlTest: { view: "control:view", attach: "control:manage" },
} as const satisfies Record<string, { view: AccountingCapability; attach: AccountingCapability }>;
export type AttachableType = keyof typeof ATTACHABLE_TYPES;

/** May remove documents someone else uploaded. */
export const DOCUMENT_MANAGER_CAPABILITY: AccountingCapability = "platform:manage";

export class DocumentError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function isAttachableType(value: unknown): value is AttachableType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ATTACHABLE_TYPES, value);
}

/** Older rows (the Assurance records page) used these names for the same records. */
const LEGACY_TYPE_NAMES: Record<string, AttachableType> = { Invoice: "ArInvoice" };

/** The attachable type a stored or requested entity type means, if any. */
export function attachableTypeOf(value: unknown): AttachableType | null {
  if (isAttachableType(value)) return value;
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LEGACY_TYPE_NAMES, value) ? LEGACY_TYPE_NAMES[value] : null;
}

function storedTypeNames(entityType: AttachableType) {
  return [entityType, ...Object.keys(LEGACY_TYPE_NAMES).filter((legacy) => LEGACY_TYPE_NAMES[legacy] === entityType)];
}

const OOXML = ["application/zip", "application/x-zip-compressed"];
const FILE_TYPES: Record<string, { mime: string; declared: string[]; looksRight: (b: Buffer) => boolean }> = {
  pdf: { mime: "application/pdf", declared: [], looksRight: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  png: { mime: "image/png", declared: [], looksRight: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  jpg: { mime: "image/jpeg", declared: ["image/jpg", "image/pjpeg"], looksRight: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { mime: "image/jpeg", declared: ["image/jpg", "image/pjpeg"], looksRight: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  webp: { mime: "image/webp", declared: [], looksRight: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
  csv: { mime: "text/csv", declared: ["text/plain", "application/csv", "application/vnd.ms-excel"], looksRight: (b) => !b.includes(0) },
  txt: { mime: "text/plain", declared: [], looksRight: (b) => !b.includes(0) },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", declared: OOXML, looksRight: (b) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", declared: OOXML, looksRight: (b) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) },
};
export const ALLOWED_EXTENSIONS = Object.keys(FILE_TYPES);

/** The last path segment, without control characters or quotes, kept to a sane length. */
export function safeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(-180)
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "");
  return clean || "document";
}

function canDo(actor: Actor, capability: AccountingCapability) {
  return hasCapability(actor.erpRole, capability);
}

function assertCan(actor: Actor, capability: AccountingCapability) {
  if (!canDo(actor, capability)) throw new DocumentError(403, `Missing capability: ${capability}`);
}

/** The record (in this company) a document is attached to, with why its documents can't be removed, if so. */
async function findRecord(companyId: string, entityType: AttachableType, entityId: string): Promise<{ date: Date | null; keepReason: string | null } | null> {
  const where = { id: entityId, companyId };
  switch (entityType) {
    case "Journal": {
      const j = await prisma.journal.findFirst({ where, select: { status: true, journalDate: true } });
      return j && { date: j.journalDate, keepReason: j.status === "DRAFT" ? null : `the journal is ${j.status.toLowerCase().replace("_", " ")}` };
    }
    case "Expense": {
      const e = await prisma.expense.findFirst({ where, select: { status: true, expenseDate: true } });
      return e && { date: e.expenseDate, keepReason: e.status === "DRAFT" || e.status === "REJECTED" ? null : `the expense is ${e.status.toLowerCase()}` };
    }
    case "BankReconciliation": {
      const r = await prisma.bankReconciliation.findFirst({ where, select: { status: true, statementDate: true } });
      return r && { date: r.statementDate, keepReason: r.status === "COMPLETED" ? "the reconciliation is completed" : null };
    }
    case "ApBill": {
      const b = await prisma.apBill.findFirst({ where, select: { billDate: true } });
      return b && { date: b.billDate, keepReason: null };
    }
    case "ArInvoice": {
      const i = await prisma.arInvoice.findFirst({ where, select: { invoiceDate: true } });
      return i && { date: i.invoiceDate, keepReason: null };
    }
    case "FixedAsset": {
      const a = await prisma.fixedAsset.findFirst({ where, select: { purchaseDate: true } });
      return a && { date: a.purchaseDate, keepReason: null };
    }
    case "ControlTest": {
      const t = await prisma.controlTest.findFirst({ where, select: { id: true } });
      return t && { date: null, keepReason: "it is evidence for a recorded control test" };
    }
  }
}

async function closedPeriodReason(companyId: string, date: Date | null) {
  if (!date) return null;
  const period = await prisma.accountingPeriod.findFirst({
    where: { financialYear: { companyId }, startDate: { lte: date }, endDate: { gte: date } },
    include: { financialYear: true },
  });
  if (!period) return null;
  const lockDate = period.financialYear.transactionLockDate;
  if (lockDate && date <= lockDate) return `transactions dated on or before ${lockDate.toISOString().slice(0, 10)} are locked`;
  if (period.status === "CLOSED" || period.status === "TEMPORARILY_LOCKED") return `accounting period ${period.name} is ${period.status.toLowerCase().replace("_", " ")}`;
  return null;
}

export async function listAttachments(companyId: string, entityType: AttachableType, entityId: string, actor: Actor) {
  assertCan(actor, ATTACHABLE_TYPES[entityType].view);
  return prisma.accountingDocument.findMany({ where: { companyId, entityType: { in: storedTypeNames(entityType) }, entityId }, orderBy: { createdAt: "desc" } });
}

/** Any filter combination; documents on records the actor can't view are left out rather than refused. */
export async function listDocuments(companyId: string, entityType: string | undefined, entityId: string | undefined, actor: Actor) {
  const attachable = attachableTypeOf(entityType);
  if (attachable && entityId) return listAttachments(companyId, attachable, entityId, actor);
  const hidden = (Object.keys(ATTACHABLE_TYPES) as AttachableType[]).filter((t) => !canDo(actor, ATTACHABLE_TYPES[t].view)).flatMap(storedTypeNames);
  return prisma.accountingDocument.findMany({
    where: {
      companyId,
      AND: [{ entityType: { notIn: hidden } }, attachable ? { entityType: { in: storedTypeNames(attachable) } } : entityType ? { entityType } : {}],
      ...(entityId ? { entityId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Before anything is stored: the type takes files and the actor may attach to it. */
export function assertCanAttach(entityType: unknown, actor: Actor): AttachableType {
  const attachable = attachableTypeOf(entityType);
  if (!attachable) throw new DocumentError(400, `Files can be attached to ${Object.keys(ATTACHABLE_TYPES).join(", ")}`);
  assertCan(actor, ATTACHABLE_TYPES[attachable].attach);
  return attachable;
}

/** For reference-only rows: checks an attachable record like an upload would, and returns the type to store. */
export async function referenceTarget(companyId: string, entityType: string, entityId: string, actor: Actor) {
  const attachable = attachableTypeOf(entityType);
  if (!attachable) return entityType;
  assertCan(actor, ATTACHABLE_TYPES[attachable].attach);
  if (!(await findRecord(companyId, attachable, entityId))) throw new DocumentError(404, "The record does not exist");
  return attachable;
}

export async function uploadDocument(
  companyId: string,
  input: { entityType: string; entityId: string; note?: string },
  file: { originalname: string; mimetype: string; buffer: Buffer; size: number } | undefined,
  actor: Actor,
) {
  const entityType = assertCanAttach(input.entityType, actor);
  if (!(await findRecord(companyId, entityType, input.entityId))) throw new DocumentError(404, "The record does not exist");
  if (!file || file.size === 0) throw new DocumentError(400, "Choose a non-empty file to upload");

  const fileName = safeFileName(file.originalname);
  const extension = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  const type = FILE_TYPES[extension];
  if (!type) throw new DocumentError(415, `Only ${ALLOWED_EXTENSIONS.join(", ")} files can be attached`);
  const declared = (file.mimetype || "").toLowerCase();
  if (declared && declared !== "application/octet-stream" && declared !== type.mime && !type.declared.includes(declared)) {
    throw new DocumentError(415, `A .${extension} file can't be sent as ${declared}`);
  }
  if (!type.looksRight(file.buffer)) throw new DocumentError(415, `The file content is not a valid .${extension} file`);

  const storageKey = newStorageKey(companyId);
  const storage = documentStorage();
  await storage.put(storageKey, Readable.from(file.buffer));
  try {
    return await inTransaction(async () => {
      const row = await prisma.accountingDocument.create({
        data: {
          companyId,
          entityType,
          entityId: input.entityId,
          fileName,
          note: input.note?.trim() || undefined,
          storageKey,
          mimeType: type.mime,
          sizeBytes: file.size,
          sha256: createHash("sha256").update(file.buffer).digest("hex"),
          createdByErpUserId: actor.erpUserId,
        },
      });
      if (actor.erpUserId) {
        await writeAudit({
          companyId,
          erpUserId: actor.erpUserId,
          erpRole: actor.erpRole,
          action: "UPLOAD_DOCUMENT",
          entityType,
          entityId: input.entityId,
          afterJson: { documentId: row.id, fileName, sizeBytes: row.sizeBytes, sha256: row.sha256 },
        });
      }
      return row;
    });
  } catch (e) {
    await storage.delete(storageKey).catch(() => undefined);
    throw e;
  }
}

async function documentFor(companyId: string, id: string) {
  const doc = await prisma.accountingDocument.findFirst({ where: { id, companyId } });
  if (!doc) throw new DocumentError(404, "The document does not exist");
  return doc;
}

/** Documents on other record types stay readable to anyone who could already list them. */
function viewCapability(entityType: string): AccountingCapability {
  const attachable = attachableTypeOf(entityType);
  return attachable ? ATTACHABLE_TYPES[attachable].view : "platform:view";
}

export async function openDocument(companyId: string, id: string, actor: Actor) {
  const doc = await documentFor(companyId, id);
  assertCan(actor, viewCapability(doc.entityType));
  if (!doc.storageKey) throw new DocumentError(404, "This document is a reference only; no file was uploaded");
  try {
    return { doc, stream: await documentStorage().get(doc.storageKey) };
  } catch {
    throw new DocumentError(404, "The stored file is missing");
  }
}

export async function deleteDocument(companyId: string, id: string, actor: Actor) {
  const doc = await documentFor(companyId, id);
  assertCan(actor, viewCapability(doc.entityType));
  const own = !!actor.erpUserId && doc.createdByErpUserId === actor.erpUserId;
  const attachable = attachableTypeOf(doc.entityType);
  const attach = attachable ? ATTACHABLE_TYPES[attachable].attach : DOCUMENT_MANAGER_CAPABILITY;
  if (!canDo(actor, DOCUMENT_MANAGER_CAPABILITY) && !(own && canDo(actor, attach))) {
    throw new DocumentError(403, "Only the person who uploaded this document or a manager can remove it");
  }
  if (attachable) {
    const record = await findRecord(companyId, attachable, doc.entityId);
    const reason = record && (record.keepReason ?? (await closedPeriodReason(companyId, record.date)));
    if (reason) throw new DocumentError(409, `This document can't be removed because ${reason}`);
  }
  await inTransaction(async () => {
    const { count } = await prisma.accountingDocument.deleteMany({ where: { id: doc.id, companyId } });
    if (!count) throw new DocumentError(404, "The document does not exist");
    if (actor.erpUserId) {
      await writeAudit({
        companyId,
        erpUserId: actor.erpUserId,
        erpRole: actor.erpRole,
        action: "DELETE_DOCUMENT",
        entityType: doc.entityType,
        entityId: doc.entityId,
        beforeJson: { documentId: doc.id, fileName: doc.fileName, sizeBytes: doc.sizeBytes, sha256: doc.sha256 },
      });
    }
  });
  if (doc.storageKey) await documentStorage().delete(doc.storageKey).catch(() => undefined);
  return { id: doc.id };
}

/** `attachment` with an ASCII fallback and the UTF-8 name, so no header injection through the filename. */
export function contentDisposition(fileName: string) {
  const ascii = safeFileName(fileName).replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "_");
  const encoded = encodeURIComponent(safeFileName(fileName)).replace(/['()!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
