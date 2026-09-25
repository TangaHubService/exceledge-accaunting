import {
  ACCOUNT_TYPE_RANGES,
  COA_IMPORT_TEMPLATE_HEADERS,
  buildAccountTree,
  canHardDeleteAccount,
  detectImportDuplicates,
  validateAccountUpdate,
  validateNewAccount,
  type AccountTypeCode,
} from "@exceledge/accounting-domain";
import type { Account, AccountType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { ensureSystemChartOfAccounts } from "../setup/setup.service";

type Actor = {
  erpUserId: number;
  erpRole?: string;
  meta?: { ipAddress?: string; userAgent?: string };
};

function bool(v: unknown, fallback = true) {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "boolean") return v;
  return String(v).toLowerCase() === "true" || String(v) === "1";
}

export async function getCoaDashboard(companyId: string) {
  await ensureSystemChartOfAccounts(companyId);
  const [total, active, inactive, recentCreated, recentModified, byType] = await Promise.all([
    prisma.account.count({ where: { companyId } }),
    prisma.account.count({ where: { companyId, isActive: true } }),
    prisma.account.count({ where: { companyId, isActive: false } }),
    prisma.account.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, code: true, name: true, createdAt: true },
    }),
    prisma.account.findMany({
      where: { companyId },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true, code: true, name: true, updatedAt: true },
    }),
    prisma.account.groupBy({
      by: ["type"],
      where: { companyId },
      _count: { _all: true },
    }),
  ]);

  return {
    total,
    active,
    inactive,
    recentlyCreated: recentCreated,
    recentlyModified: recentModified,
    categories: Object.entries(ACCOUNT_TYPE_RANGES).map(([type, range]) => ({
      type,
      label: range.label,
      range: `${range.min}-${range.max}`,
      count: byType.find((b) => b.type === type)?._count._all ?? 0,
    })),
  };
}

export async function listAccounts(
  companyId: string,
  filters: {
    q?: string;
    type?: AccountType;
    isActive?: boolean;
    parentId?: string | null;
    branchId?: string;
    costCentre?: string;
    currency?: string;
    taxMapping?: string;
  },
) {
  await ensureSystemChartOfAccounts(companyId);
  const where: Prisma.AccountWhereInput = { companyId };
  if (filters.type) where.type = filters.type;
  if (filters.isActive !== undefined) where.isActive = filters.isActive;
  if (filters.parentId !== undefined) where.parentId = filters.parentId;
  if (filters.branchId) where.branchId = filters.branchId;
  if (filters.costCentre) where.costCentre = filters.costCentre;
  if (filters.currency) where.currency = filters.currency;
  if (filters.taxMapping) where.taxMapping = filters.taxMapping;
  if (filters.q) {
    where.OR = [
      { code: { contains: filters.q, mode: "insensitive" } },
      { name: { contains: filters.q, mode: "insensitive" } },
      { description: { contains: filters.q, mode: "insensitive" } },
    ];
  }
  return prisma.account.findMany({
    where,
    orderBy: [{ code: "asc" }],
  });
}

export async function getAccountTree(companyId: string) {
  const accounts = await listAccounts(companyId, {});
  return buildAccountTree(
    accounts.map((a) => ({
      ...a,
      openingBalance: Number(a.openingBalance),
      currentBalance: Number(a.currentBalance),
      parentId: a.parentId,
    })),
  );
}

export async function createAccount(
  companyId: string,
  input: {
    code: string;
    name: string;
    type: AccountType;
    parentId?: string | null;
    description?: string;
    reportingGroup?: string;
    currency?: string;
    branchId?: string;
    costCentre?: string;
    taxMapping?: string;
    openingBalance?: number;
    allowManualPost?: boolean;
    allowAutoPost?: boolean;
    bankReconciliationRequired?: boolean;
    isCashAccount?: boolean;
    isTaxAccount?: boolean;
    isInventoryAccount?: boolean;
    requireApproval?: boolean;
    allowNegativeBalance?: boolean;
    isActive?: boolean;
  },
  actor: Actor,
) {
  const existing = await prisma.account.findMany({ where: { companyId } });
  const parent = input.parentId
    ? existing.find((a) => a.id === input.parentId)
    : undefined;
  if (input.parentId && !parent) throw new Error("Parent account does not exist");

  validateNewAccount({
    code: input.code,
    name: input.name,
    type: input.type as AccountTypeCode,
    parentId: input.parentId,
    parentType: parent?.type as AccountTypeCode | undefined,
    existingCodes: new Set(existing.map((a) => a.code)),
    existingNamesInType: new Set(
      existing.filter((a) => a.type === input.type).map((a) => a.name.toLowerCase()),
    ),
  });

  const created = await prisma.account.create({
    data: {
      companyId,
      code: input.code.trim(),
      name: input.name.trim(),
      type: input.type,
      parentId: input.parentId ?? null,
      description: input.description,
      reportingGroup: input.reportingGroup,
      currency: input.currency,
      branchId: input.branchId,
      costCentre: input.costCentre,
      taxMapping: input.taxMapping,
      openingBalance: input.openingBalance ?? 0,
      allowManualPost: input.allowManualPost ?? true,
      allowAutoPost: input.allowAutoPost ?? true,
      bankReconciliationRequired: input.bankReconciliationRequired ?? false,
      isCashAccount: input.isCashAccount ?? false,
      isTaxAccount: input.isTaxAccount ?? false,
      isInventoryAccount: input.isInventoryAccount ?? false,
      requireApproval: input.requireApproval ?? false,
      allowNegativeBalance: input.allowNegativeBalance ?? true,
      isActive: input.isActive ?? true,
      systemProtected: false,
    },
  });

  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: "CREATE",
    entityType: "Account",
    entityId: created.id,
    afterJson: created,
    ...actor.meta,
  });
  return created;
}

export async function updateAccount(
  companyId: string,
  accountId: string,
  input: Partial<{
    code: string;
    name: string;
    type: AccountType;
    parentId: string | null;
    description: string;
    reportingGroup: string;
    currency: string;
    branchId: string;
    costCentre: string;
    taxMapping: string;
    openingBalance: number;
    allowManualPost: boolean;
    allowAutoPost: boolean;
    bankReconciliationRequired: boolean;
    isCashAccount: boolean;
    isTaxAccount: boolean;
    isInventoryAccount: boolean;
    requireApproval: boolean;
    allowNegativeBalance: boolean;
    isActive: boolean;
  }>,
  actor: Actor,
) {
  const existing = await prisma.account.findFirst({ where: { id: accountId, companyId } });
  if (!existing) throw new Error("Account not found");

  if (input.parentId) {
    const parent = await prisma.account.findFirst({ where: { id: input.parentId, companyId } });
    if (!parent) throw new Error("Parent account does not exist");
    if (parent.type !== (input.type ?? existing.type)) {
      throw new Error("Account category must match the parent account");
    }
    if (parent.id === accountId) throw new Error("Account cannot be its own parent");
  }

  const nameTaken =
    input.name !== undefined
      ? Boolean(
          await prisma.account.findFirst({
            where: {
              companyId,
              type: input.type ?? existing.type,
              name: { equals: input.name.trim(), mode: "insensitive" },
              NOT: { id: accountId },
            },
          }),
        )
      : false;

  validateAccountUpdate({
    existing: {
      code: existing.code,
      systemProtected: existing.systemProtected,
      hasPostedTransactions: existing.hasPostedTransactions,
      type: existing.type as AccountTypeCode,
    },
    nextCode: input.code,
    nextType: input.type as AccountTypeCode | undefined,
    nextName: input.name,
    nameTakenInType: nameTaken,
  });

  // Protected accounts: only allow non-structural field updates
  const data: Prisma.AccountUpdateInput = {};
  if (existing.systemProtected) {
    if (input.description !== undefined) data.description = input.description;
    if (input.reportingGroup !== undefined) data.reportingGroup = input.reportingGroup;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.taxMapping !== undefined) data.taxMapping = input.taxMapping;
    if (input.costCentre !== undefined) data.costCentre = input.costCentre;
    if (input.branchId !== undefined) data.branchId = input.branchId;
    if (input.allowManualPost !== undefined) data.allowManualPost = input.allowManualPost;
    if (input.allowAutoPost !== undefined) data.allowAutoPost = input.allowAutoPost;
    if (input.bankReconciliationRequired !== undefined) {
      data.bankReconciliationRequired = input.bankReconciliationRequired;
    }
    if (input.requireApproval !== undefined) data.requireApproval = input.requireApproval;
    if (input.allowNegativeBalance !== undefined) data.allowNegativeBalance = input.allowNegativeBalance;
  } else {
    Object.assign(data, {
      ...(input.code !== undefined ? { code: input.code.trim() } : {}),
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.reportingGroup !== undefined ? { reportingGroup: input.reportingGroup } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
      ...(input.costCentre !== undefined ? { costCentre: input.costCentre } : {}),
      ...(input.taxMapping !== undefined ? { taxMapping: input.taxMapping } : {}),
      ...(input.openingBalance !== undefined ? { openingBalance: input.openingBalance } : {}),
      ...(input.allowManualPost !== undefined ? { allowManualPost: input.allowManualPost } : {}),
      ...(input.allowAutoPost !== undefined ? { allowAutoPost: input.allowAutoPost } : {}),
      ...(input.bankReconciliationRequired !== undefined
        ? { bankReconciliationRequired: input.bankReconciliationRequired }
        : {}),
      ...(input.isCashAccount !== undefined ? { isCashAccount: input.isCashAccount } : {}),
      ...(input.isTaxAccount !== undefined ? { isTaxAccount: input.isTaxAccount } : {}),
      ...(input.isInventoryAccount !== undefined
        ? { isInventoryAccount: input.isInventoryAccount }
        : {}),
      ...(input.requireApproval !== undefined ? { requireApproval: input.requireApproval } : {}),
      ...(input.allowNegativeBalance !== undefined
        ? { allowNegativeBalance: input.allowNegativeBalance }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    });
  }

  const updated = await prisma.account.update({ where: { id: accountId }, data });
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: "UPDATE",
    entityType: "Account",
    entityId: updated.id,
    beforeJson: existing,
    afterJson: updated,
    ...actor.meta,
  });
  return updated;
}

export async function setAccountActive(
  companyId: string,
  accountId: string,
  isActive: boolean,
  actor: Actor,
) {
  const existing = await prisma.account.findFirst({ where: { id: accountId, companyId } });
  if (!existing) throw new Error("Account not found");
  if (existing.systemProtected && !isActive) {
    throw new Error("Protected system accounts cannot be deactivated");
  }
  const updated = await prisma.account.update({
    where: { id: accountId },
    data: { isActive },
  });
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: isActive ? "REACTIVATE" : "DEACTIVATE",
    entityType: "Account",
    entityId: updated.id,
    beforeJson: existing,
    afterJson: updated,
    ...actor.meta,
  });
  return updated;
}

export async function deleteAccount(companyId: string, accountId: string, actor: Actor) {
  const existing = await prisma.account.findFirst({ where: { id: accountId, companyId } });
  if (!existing) throw new Error("Account not found");
  const childCount = await prisma.account.count({ where: { companyId, parentId: accountId } });
  const gate = canHardDeleteAccount({
    systemProtected: existing.systemProtected,
    hasPostedTransactions: existing.hasPostedTransactions,
    childCount,
  });
  if (!gate.allowed) throw new Error(gate.reason);

  await prisma.account.delete({ where: { id: accountId } });
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: "DELETE",
    entityType: "Account",
    entityId: accountId,
    beforeJson: existing,
    ...actor.meta,
  });
  return { deleted: true, id: accountId };
}

export function getImportTemplate() {
  return {
    headers: [...COA_IMPORT_TEMPLATE_HEADERS],
    sample: [
      {
        code: "6110",
        name: "Office Rent",
        type: "EXPENSE",
        parentCode: "",
        description: "Monthly office rent",
        reportingGroup: "Occupancy",
        currency: "RWF",
        branchId: "",
        costCentre: "",
        taxMapping: "",
        allowManualPost: "true",
        allowAutoPost: "true",
        bankReconciliationRequired: "false",
        isCashAccount: "false",
        isTaxAccount: "false",
        isInventoryAccount: "false",
        requireApproval: "false",
        allowNegativeBalance: "true",
        isActive: "true",
      },
    ],
  };
}

export async function importAccounts(
  companyId: string,
  rows: Array<Record<string, unknown>>,
  actor: Actor,
) {
  await ensureSystemChartOfAccounts(companyId);
  const normalized = rows.map((r) => ({
    code: String(r.code ?? "").trim(),
    name: String(r.name ?? "").trim(),
    type: String(r.type ?? "").trim().toUpperCase() as AccountType,
    parentCode: String(r.parentCode ?? "").trim() || null,
    description: String(r.description ?? "") || undefined,
    reportingGroup: String(r.reportingGroup ?? "") || undefined,
    currency: String(r.currency ?? "") || undefined,
    branchId: String(r.branchId ?? "") || undefined,
    costCentre: String(r.costCentre ?? "") || undefined,
    taxMapping: String(r.taxMapping ?? "") || undefined,
    allowManualPost: bool(r.allowManualPost, true),
    allowAutoPost: bool(r.allowAutoPost, true),
    bankReconciliationRequired: bool(r.bankReconciliationRequired, false),
    isCashAccount: bool(r.isCashAccount, false),
    isTaxAccount: bool(r.isTaxAccount, false),
    isInventoryAccount: bool(r.isInventoryAccount, false),
    requireApproval: bool(r.requireApproval, false),
    allowNegativeBalance: bool(r.allowNegativeBalance, true),
    isActive: bool(r.isActive, true),
  }));

  const dupes = detectImportDuplicates(normalized);
  if (dupes.duplicateCodes.length || dupes.duplicateNamesByType.length) {
    throw new Error(
      `Duplicate detection failed: codes=${dupes.duplicateCodes.join(",") || "none"}; names=${dupes.duplicateNamesByType.join(",") || "none"}`,
    );
  }

  const existing = await prisma.account.findMany({ where: { companyId } });
  const byCode = new Map(existing.map((a) => [a.code, a]));
  const created: Account[] = [];
  const errors: Array<{ code: string; error: string }> = [];

  // Parents first: rows without parentCode, then with
  const ordered = [
    ...normalized.filter((r) => !r.parentCode),
    ...normalized.filter((r) => r.parentCode),
  ];

  for (const row of ordered) {
    try {
      if (byCode.has(row.code)) {
        errors.push({ code: row.code, error: "Account code already exists" });
        continue;
      }
      const parent = row.parentCode ? byCode.get(row.parentCode) : undefined;
      if (row.parentCode && !parent) {
        errors.push({ code: row.code, error: `Parent code ${row.parentCode} not found` });
        continue;
      }
      const account = await createAccount(
        companyId,
        {
          code: row.code,
          name: row.name,
          type: row.type,
          parentId: parent?.id,
          description: row.description,
          reportingGroup: row.reportingGroup,
          currency: row.currency,
          branchId: row.branchId,
          costCentre: row.costCentre,
          taxMapping: row.taxMapping,
          allowManualPost: row.allowManualPost,
          allowAutoPost: row.allowAutoPost,
          bankReconciliationRequired: row.bankReconciliationRequired,
          isCashAccount: row.isCashAccount,
          isTaxAccount: row.isTaxAccount,
          isInventoryAccount: row.isInventoryAccount,
          requireApproval: row.requireApproval,
          allowNegativeBalance: row.allowNegativeBalance,
          isActive: row.isActive,
        },
        actor,
      );
      byCode.set(account.code, account);
      created.push(account);
    } catch (e) {
      errors.push({ code: row.code, error: (e as Error).message });
    }
  }

  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: "IMPORT",
    entityType: "ChartOfAccounts",
    afterJson: { created: created.length, errors },
    ...actor.meta,
  });

  return { createdCount: created.length, created, errors };
}

export async function exportAccounts(companyId: string) {
  const accounts = await listAccounts(companyId, {});
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return accounts.map((a) => ({
    code: a.code,
    name: a.name,
    type: a.type,
    parentCode: a.parentId ? byId.get(a.parentId)?.code ?? "" : "",
    description: a.description ?? "",
    reportingGroup: a.reportingGroup ?? "",
    currency: a.currency ?? "",
    branchId: a.branchId ?? "",
    costCentre: a.costCentre ?? "",
    taxMapping: a.taxMapping ?? "",
    allowManualPost: a.allowManualPost,
    allowAutoPost: a.allowAutoPost,
    bankReconciliationRequired: a.bankReconciliationRequired,
    isCashAccount: a.isCashAccount,
    isTaxAccount: a.isTaxAccount,
    isInventoryAccount: a.isInventoryAccount,
    requireApproval: a.requireApproval,
    allowNegativeBalance: a.allowNegativeBalance,
    isActive: a.isActive,
    systemProtected: a.systemProtected,
    openingBalance: Number(a.openingBalance),
    currentBalance: Number(a.currentBalance),
  }));
}

export function toCsv(rows: Array<Record<string, unknown>>) {
  const headers = [...COA_IMPORT_TEMPLATE_HEADERS];
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join(
    "\n",
  );
}
