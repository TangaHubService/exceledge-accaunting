import { type AccountingCapability, hasCapability } from "@exceledge/accounting-domain";
import type { Prisma } from "@prisma/client";
import { HttpError } from "../../lib/http";
import { prisma } from "../../lib/prisma";

type Policy = { scope: "company" | "user"; view: AccountingCapability; manage: AccountingCapability };

const REPORTS: Policy = { scope: "company", view: "report:view", manage: "report:view" };
const MINE: Policy = { scope: "user", view: "report:view", manage: "report:view" };

/**
 * Screen state that has no accounting effect. Only these collections are accepted, so this can't
 * become a back door for storing documents that should go through a real, validated endpoint.
 */
export const COLLECTIONS: Record<string, Policy> = {
  "custom-reports": REPORTS,
  "management-reports": REPORTS,
  "report-favourites": MINE,
  "report-feedback": MINE,
  "custom-kpis": REPORTS,
  "kpi-hidden": MINE,
  forecasts: REPORTS,
  "planner-items": REPORTS,
  "planner-started": REPORTS,
  "performance-layout": MINE,
  statement: { scope: "company", view: "ar:view", manage: "ar:manage" },
  recurring: { scope: "company", view: "report:view", manage: "journal:create" },
  settings: { scope: "company", view: "setup:view", manage: "setup:prepare" },
};

const MAX_RECORD_BYTES = 256 * 1024;
const MAX_RECORDS_PER_COLLECTION = 2000;

function policyFor(collection: string) {
  if (!Object.prototype.hasOwnProperty.call(COLLECTIONS, collection)) throw new HttpError(404, "Unknown collection");
  return COLLECTIONS[collection];
}

function assertAllowed(role: string | undefined, capability: AccountingCapability) {
  if (!hasCapability(role, capability)) throw new HttpError(403, `Missing capability: ${capability}`);
}

const ownerFor = (policy: Policy, userId: number) => (policy.scope === "user" ? userId : 0);

export async function listRecords(companyId: string, collection: string, user: { userId: number; role?: string }) {
  const policy = policyFor(collection);
  assertAllowed(user.role, policy.view);
  const rows = await prisma.workspaceRecord.findMany({
    where: { companyId, collection, ownerErpUserId: ownerFor(policy, user.userId) },
    orderBy: { updatedAt: "desc" },
    take: MAX_RECORDS_PER_COLLECTION,
  });
  return rows.map((r) => r.data);
}

/** Every collection this user may see, for loading the screens in one request. */
export async function bootstrap(companyId: string, user: { userId: number; role?: string }) {
  const out: Record<string, unknown[]> = {};
  for (const [collection, policy] of Object.entries(COLLECTIONS)) {
    if (hasCapability(user.role, policy.view)) out[collection] = await listRecords(companyId, collection, user);
  }
  return out;
}

export async function saveRecord(companyId: string, collection: string, recordId: string, data: unknown, user: { userId: number; role?: string }) {
  const policy = policyFor(collection);
  assertAllowed(user.role, policy.manage);
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error("A record must be an object");
  if (Buffer.byteLength(JSON.stringify(data)) > MAX_RECORD_BYTES) throw new HttpError(413, "This record is too large to save");
  const key = { companyId, collection, recordId, ownerErpUserId: ownerFor(policy, user.userId) };
  const existing = await prisma.workspaceRecord.findUnique({ where: { companyId_collection_recordId_ownerErpUserId: key }, select: { recordId: true } });
  if (!existing && (await prisma.workspaceRecord.count({ where: { companyId, collection, ownerErpUserId: key.ownerErpUserId } })) >= MAX_RECORDS_PER_COLLECTION) {
    throw new HttpError(409, "This list is full; remove something first");
  }
  const json = { ...(data as object), id: recordId } as Prisma.InputJsonValue;
  await prisma.workspaceRecord.upsert({ where: { companyId_collection_recordId_ownerErpUserId: key }, create: { ...key, data: json }, update: { data: json } });
  return json;
}

export async function deleteRecord(companyId: string, collection: string, recordId: string, user: { userId: number; role?: string }) {
  const policy = policyFor(collection);
  assertAllowed(user.role, policy.manage);
  const removed = await prisma.workspaceRecord.deleteMany({ where: { companyId, collection, recordId, ownerErpUserId: ownerFor(policy, user.userId) } });
  return { removed: removed.count };
}
