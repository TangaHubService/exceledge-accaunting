import {
  ACCOUNT_TYPE_RANGES,
  COA_IMPORT_TEMPLATE_HEADERS,
  buildAccountTree,
  canHardDeleteAccount,
  validateAccountUpdate,
  validateNewAccount,
  type AccountTypeCode,
} from "@exceledge/accounting-domain";
import { Prisma, type Account, type AccountType } from "@prisma/client";
import { paginateArray, type PageRequest } from "../../lib/pagination";
import { inTransaction, prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { createAndPostJournal } from "../journals/journal.service";
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

const TYPE_ORDER: AccountType[] = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "COST_OF_SALES", "EXPENSE", "OTHER_INCOME", "OTHER_EXPENSE"];
/** QuickBooks lists account types in this fixed order (the order of the type picker). */
const QB_TYPE_ORDER = [
  "Cash and cash equivalents", "Accounts receivable (A/R)", "Current assets", "Fixed assets", "Non-current assets",
  "Credit card", "Accounts payable (A/P)", "Current liabilities", "Non-current liabilities", "Owner's equity",
  "Income", "Other income", "Cost of sales", "Expenses", "Other expense",
];
const DEBIT_NORMAL = new Set<AccountType>(["ASSET", "COST_OF_SALES", "EXPENSE", "OTHER_EXPENSE"]);

/** The QuickBooks account type and detail type shown for an account (older bank/cash accounts are inferred). */
export function accountLabels(a: Pick<Account, "type" | "reportingGroup" | "isCashAccount" | "bankReconciliationRequired">) {
  const rg = a.reportingGroup ?? "";
  const i = rg.indexOf("|||");
  if (i >= 0) return { accountType: rg.slice(0, i), detailType: rg.slice(i + 3) };
  if (a.type === "ASSET" && a.isCashAccount) {
    return { accountType: "Cash and cash equivalents", detailType: a.bankReconciliationRequired ? "Bank" : "Cash on hand" };
  }
  return { accountType: rg, detailType: "" };
}

export type AccountListSort = "code" | "name" | "type" | "balance";
export type AccountListQuery = {
  q?: string;
  /** A category (ASSET, EXPENSE, …) or a QuickBooks account type label ("Cash and cash equivalents"). */
  type?: string;
  includeInactive?: boolean;
  /** Clean-up view: active, never used, zero balance, not a system account. */
  unused?: boolean;
  /** Search account numbers too (off when the company hides account numbers). */
  searchNumbers?: boolean;
  sort?: AccountListSort;
  dir?: "asc" | "desc";
};
export type AccountListRow = Account & { depth: number; hasChildren: boolean; accountType: string; detailType: string };

/**
 * The chart of accounts as the list screen shows it: siblings sorted, subaccounts directly under their parent, then
 * filtered and paged. Filtering keeps the hierarchy order, as QuickBooks does.
 */
export async function listAccountRows(companyId: string, query: AccountListQuery, page: PageRequest) {
  await ensureSystemChartOfAccounts(companyId);
  const accounts = await prisma.account.findMany({ where: { companyId } });
  const dir = query.dir === "desc" ? -1 : 1;
  const sort = query.sort ?? "code";
  const labels = new Map(accounts.map((a) => [a.id, accountLabels(a)]));
  const natural = (a: Account) => (DEBIT_NORMAL.has(a.type) ? Number(a.currentBalance) : -Number(a.currentBalance));
  const rank = (label: string) => {
    const i = QB_TYPE_ORDER.indexOf(label);
    return i < 0 ? QB_TYPE_ORDER.length : i;
  };
  const byNumber = (a: Account, b: Account) => a.code.localeCompare(b.code, undefined, { numeric: true });
  const compare = (a: Account, b: Account) => {
    let d = 0;
    if (sort === "name") d = a.name.localeCompare(b.name);
    else if (sort === "balance") d = natural(a) - natural(b);
    else if (sort === "type") {
      const la = labels.get(a.id)!.accountType, lb = labels.get(b.id)!.accountType;
      d = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || rank(la) - rank(lb) || la.localeCompare(lb) || a.name.localeCompare(b.name);
    } else d = byNumber(a, b);
    return (d || byNumber(a, b)) * dir;
  };

  const children = new Map<string | null, Account[]>();
  const ids = new Set(accounts.map((a) => a.id));
  for (const a of accounts) {
    const key = a.parentId && ids.has(a.parentId) ? a.parentId : null;
    children.set(key, [...(children.get(key) ?? []), a]);
  }
  const ordered: AccountListRow[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const a of [...(children.get(parent) ?? [])].sort(compare)) {
      const kids = children.get(a.id) ?? [];
      ordered.push({ ...a, depth, hasChildren: kids.length > 0, ...labels.get(a.id)! });
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);

  const q = query.q?.trim().toLowerCase() ?? "";
  const isCategory = (TYPE_ORDER as string[]).includes(query.type ?? "");
  const rows = ordered.filter((a) => {
    if (query.unused) {
      return a.isActive && !a.systemProtected && !a.hasPostedTransactions && Number(a.currentBalance) === 0;
    }
    if (!query.includeInactive && !a.isActive) return false;
    if (query.type && (isCategory ? a.type !== query.type : a.accountType !== query.type)) return false;
    if (!q) return true;
    return (
      (query.searchNumbers !== false && a.code.toLowerCase().includes(q)) ||
      a.name.toLowerCase().includes(q) ||
      a.accountType.toLowerCase().includes(q) ||
      a.detailType.toLowerCase().includes(q)
    );
  });
  return paginateArray(rows, page);
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

/** Next free number in the type's suggested range (QuickBooks assigns nothing; we need a unique key). */
export function nextAccountNumber(usedCodes: Set<string>, type: AccountType) {
  const range = ACCOUNT_TYPE_RANGES[type as AccountTypeCode];
  for (let n = range.min; n <= range.max; n++) if (!usedCodes.has(String(n))) return String(n);
  for (let n = 9000; n <= 9_999_999; n++) if (!usedCodes.has(String(n))) return String(n);
  throw new Error("No free account number left");
}

/** QuickBooks "Enable account numbers" (on unless the company turned it off). */
export async function getNumberingSettings(companyId: string) {
  const policy = await prisma.accountingPolicy.findUnique({ where: { companyId }, select: { useAccountNumbers: true } });
  return { useAccountNumbers: policy?.useAccountNumbers ?? true };
}

export async function setNumberingSettings(companyId: string, useAccountNumbers: boolean, actor: Actor) {
  const before = await getNumberingSettings(companyId);
  await prisma.accountingPolicy.upsert({
    where: { companyId },
    create: { companyId, useAccountNumbers },
    update: { useAccountNumbers },
  });
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: "UPDATE",
    entityType: "AccountingPolicy",
    entityId: companyId,
    beforeJson: before,
    afterJson: { useAccountNumbers },
    ...actor.meta,
  });
  return { useAccountNumbers };
}

export async function createAccount(
  companyId: string,
  input: {
    /** Optional: a free number is assigned when left blank (account numbers off, or simply not entered). */
    code?: string;
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
    /** When set with a non-zero openingBalance, posts it against Opening Balance Equity on this date. */
    openingBalanceDate?: string;
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
  const opening = Math.round((input.openingBalance ?? 0) * 100) / 100;
  if (opening !== 0) {
    if (!BALANCE_SHEET_TYPES.has(input.type)) {
      throw new Error("Opening balances can only be entered on balance sheet accounts (assets, liabilities, equity)");
    }
    if (!input.openingBalanceDate) throw new Error("Choose the date the opening balance is as of");
    if (input.isActive === false) throw new Error("An inactive account cannot take an opening balance");
    return inTransaction(async () => {
      const created = await insertAccount(companyId, { ...input, openingBalance: opening }, actor);
      await postAccountOpeningBalance(companyId, created, opening, input.openingBalanceDate!, actor);
      return prisma.account.findUniqueOrThrow({ where: { id: created.id } });
    });
  }
  return insertAccount(companyId, { ...input, openingBalance: 0 }, actor);
}

const BALANCE_SHEET_TYPES = new Set<AccountType>(["ASSET", "LIABILITY", "EQUITY"]);
const OPENING_BALANCE_EQUITY_CODE = "3020";

/**
 * QuickBooks-style opening balance: one OPENING_BALANCE journal between the new account and
 * Opening Balance Equity. A positive amount is a balance on the account's normal side.
 */
async function postAccountOpeningBalance(
  companyId: string,
  account: Account,
  amount: number,
  asOf: string,
  actor: Actor,
) {
  const obe = await prisma.account.findFirst({ where: { companyId, code: OPENING_BALANCE_EQUITY_CODE } });
  if (!obe) throw new Error("Opening Balance Equity (3020) is missing from the chart of accounts");
  if (obe.id === account.id) throw new Error("Opening Balance Equity cannot take an opening balance against itself");
  const debitNormal = account.type === "ASSET";
  const abs = Math.abs(amount);
  const accountDebit = debitNormal === amount > 0;
  await createAndPostJournal(
    companyId,
    {
      journalDate: asOf,
      journalType: "OPENING_BALANCE",
      sourceModule: "OPENING_BALANCE",
      sourceDocumentType: "Account",
      sourceDocumentId: account.id,
      description: `Opening balance: ${account.code} ${account.name}`,
      currencyCode: account.currency ?? undefined,
      lines: [
        { accountId: account.id, debit: accountDebit ? abs : 0, credit: accountDebit ? 0 : abs, description: "Opening balance" },
        { accountId: obe.id, debit: accountDebit ? 0 : abs, credit: accountDebit ? abs : 0, description: `Opening balance: ${account.code} ${account.name}` },
      ],
    },
    actor,
  );
}

/** QuickBooks allows subaccounts up to five levels below a top-level account. */
export const MAX_SUBACCOUNT_LEVELS = 5;

/** The QuickBooks account type stored in reportingGroup ("Account type|||Detail type"), if any. */
function qbAccountType(reportingGroup: string | null | undefined) {
  if (!reportingGroup) return "";
  const i = reportingGroup.indexOf("|||");
  return i >= 0 ? reportingGroup.slice(0, i) : "";
}

type ParentLink = { id: string; parentId: string | null };

/** How many levels below the top an account sits (a top-level account is 0). */
function levelOf(id: string, byId: Map<string, ParentLink>) {
  let level = 0;
  for (let cur = byId.get(id)?.parentId; cur && level <= byId.size; cur = byId.get(cur)?.parentId) level++;
  return level;
}

/** How many levels of subaccounts sit under an account (0 when it has none). */
function levelsBelow(id: string, all: ParentLink[]): number {
  const kids = all.filter((a) => a.parentId === id);
  return kids.length ? 1 + Math.max(...kids.map((k) => levelsBelow(k.id, all))) : 0;
}

/** QuickBooks rules for a subaccount: same account type as its parent, at most five levels deep. */
function assertSubaccountRules(opts: {
  parent: ParentLink & { name: string; reportingGroup: string | null };
  reportingGroup: string | null | undefined;
  levelsUnder: number;
  byId: Map<string, ParentLink>;
}) {
  const childType = qbAccountType(opts.reportingGroup);
  const parentType = qbAccountType(opts.parent.reportingGroup);
  if (childType && parentType && childType !== parentType) {
    throw new Error(`A subaccount must have the same account type as its parent (${opts.parent.name} is ${parentType})`);
  }
  if (levelOf(opts.parent.id, opts.byId) + 1 + opts.levelsUnder > MAX_SUBACCOUNT_LEVELS) {
    throw new Error(`Subaccounts can only go ${MAX_SUBACCOUNT_LEVELS} levels deep`);
  }
}

async function insertAccount(
  companyId: string,
  input: Parameters<typeof createAccount>[1],
  actor: Actor,
) {
  const existing = await prisma.account.findMany({ where: { companyId } });
  const parent = input.parentId
    ? existing.find((a) => a.id === input.parentId)
    : undefined;
  if (input.parentId && !parent) throw new Error("Parent account does not exist");
  if (parent && parent.type === input.type) {
    assertSubaccountRules({ parent, reportingGroup: input.reportingGroup, levelsUnder: 0, byId: new Map(existing.map((a) => [a.id, a])) });
  }

  const usedCodes = new Set(existing.map((a) => a.code));
  const code = input.code?.trim() || nextAccountNumber(usedCodes, input.type);
  validateNewAccount({
    code,
    name: input.name,
    type: input.type as AccountTypeCode,
    parentId: input.parentId,
    parentType: parent?.type as AccountTypeCode | undefined,
    existingCodes: usedCodes,
    // QuickBooks: names are unique among accounts sharing a parent (subaccounts of different parents may repeat).
    siblingNames: new Set(
      existing.filter((a) => (a.parentId ?? null) === (input.parentId || null)).map((a) => a.name.trim().toLowerCase()),
    ),
  });

  const created = await prisma.account.create({
    data: {
      companyId,
      code,
      name: input.name.trim(),
      type: input.type,
      parentId: input.parentId || null,
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
  if (input.parentId === "") input = { ...input, parentId: null };

  const nextType = input.type ?? existing.type;
  const nextParentId = input.parentId !== undefined ? input.parentId : existing.parentId;
  if (nextParentId) {
    if (nextParentId === accountId) throw new Error("Account cannot be its own parent");
    const all = await prisma.account.findMany({
      where: { companyId },
      select: { id: true, parentId: true, type: true, name: true, reportingGroup: true },
    });
    const parent = all.find((a) => a.id === nextParentId);
    if (!parent) throw new Error("Parent account does not exist");
    if (parent.type !== nextType) throw new Error("Account category must match the parent account");
    // Walk up from the new parent: reaching this account means the move would create a loop.
    const byId = new Map(all.map((a) => [a.id, a]));
    let cursor: string | null = parent.parentId;
    for (let guard = 0; cursor && guard < all.length; guard++) {
      if (cursor === accountId) throw new Error("An account cannot be moved under one of its own subaccounts");
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    assertSubaccountRules({
      parent,
      reportingGroup: input.reportingGroup !== undefined ? input.reportingGroup : existing.reportingGroup,
      levelsUnder: levelsBelow(accountId, all),
      byId,
    });
  }
  if (input.type !== undefined && input.type !== existing.type) {
    const children = await prisma.account.count({ where: { companyId, parentId: accountId } });
    if (children > 0) throw new Error("Move or change the subaccounts first; they must share the parent's category");
  }
  if (input.isActive === false && existing.systemProtected) {
    throw new Error("Protected system accounts cannot be deactivated");
  }

  // QuickBooks: a name must be unique among the accounts that share the (new) parent.
  const nameChecked = input.name ?? (input.parentId !== undefined ? existing.name : undefined);
  const nameTaken =
    nameChecked !== undefined
      ? Boolean(
          await prisma.account.findFirst({
            where: {
              companyId,
              parentId: nextParentId ?? null,
              name: { equals: nameChecked.trim(), mode: "insensitive" },
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
    nameTakenBySibling: nameTaken,
  });

  if (input.currency !== undefined && existing.hasPostedTransactions) {
    const functional = (await prisma.currencySettings.findUnique({ where: { companyId } }))?.functionalCurrency ?? "RWF";
    const effective = (c: string | null | undefined) => (c?.trim() ? c.trim().toUpperCase() : functional);
    if (effective(input.currency) !== effective(existing.currency)) {
      throw new Error("The currency of an account with postings cannot be changed; open a new account instead");
    }
  }

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
    });
  }

  let updated = await prisma.account.update({ where: { id: accountId }, data });
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
  // Status changes go through setAccountActive so subaccounts follow their parent.
  if (input.isActive !== undefined && input.isActive !== existing.isActive) {
    updated = await setAccountActive(companyId, accountId, input.isActive, actor);
  }
  return updated;
}

/**
 * Making an account inactive also makes its subaccounts inactive (as QuickBooks does); history and
 * balances are kept. A subaccount can only be reactivated while its parent is active.
 */
export async function setAccountActive(
  companyId: string,
  accountId: string,
  isActive: boolean,
  actor: Actor,
) {
  const all = await prisma.account.findMany({ where: { companyId } });
  const existing = all.find((a) => a.id === accountId);
  if (!existing) throw new Error("Account not found");
  if (existing.isActive === isActive) return existing;

  let targets = [existing];
  if (!isActive) {
    const descendants = (id: string): Account[] =>
      all.filter((a) => a.parentId === id).flatMap((c) => [c, ...descendants(c.id)]);
    targets = [existing, ...descendants(accountId).filter((a) => a.isActive)];
    const protectedHit = targets.find((a) => a.systemProtected);
    if (protectedHit) {
      throw new Error(
        protectedHit.id === accountId
          ? "Protected system accounts cannot be deactivated"
          : `Subaccount ${protectedHit.code} ${protectedHit.name} is a protected system account, so this parent cannot be deactivated`,
      );
    }
  } else if (existing.parentId) {
    const parent = all.find((a) => a.id === existing.parentId);
    if (parent && !parent.isActive) {
      throw new Error(`Reactivate the parent account ${parent.code} ${parent.name} first`);
    }
  }

  return inTransaction(async () => {
    await prisma.account.updateMany({
      where: { companyId, id: { in: targets.map((t) => t.id) } },
      data: { isActive },
    });
    for (const t of targets) {
      await writeAudit({
        companyId,
        erpUserId: actor.erpUserId,
        erpRole: actor.erpRole,
        action: isActive ? "REACTIVATE" : "DEACTIVATE",
        entityType: "Account",
        entityId: t.id,
        beforeJson: t,
        afterJson: { ...t, isActive },
        ...actor.meta,
      });
    }
    return prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  });
}

/** Batch actions from the chart of accounts list. Each account succeeds or fails on its own. */
export async function batchSetAccountsActive(
  companyId: string,
  ids: string[],
  isActive: boolean,
  actor: Actor,
) {
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  // Reactivate parents before children; deactivation order does not matter (it cascades).
  const accounts = await prisma.account.findMany({ where: { companyId, id: { in: ids } } });
  const depth = new Map<string, number>();
  const all = await prisma.account.findMany({ where: { companyId }, select: { id: true, parentId: true } });
  const parentOf = new Map(all.map((a) => [a.id, a.parentId]));
  for (const a of accounts) {
    let d = 0;
    let p = a.parentId;
    while (p && d < all.length) {
      d++;
      p = parentOf.get(p) ?? null;
    }
    depth.set(a.id, d);
  }
  const ordered = [...ids].sort((x, y) => (depth.get(x) ?? 0) - (depth.get(y) ?? 0));
  for (const id of ordered) {
    try {
      await setAccountActive(companyId, id, isActive, actor);
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: (e as Error).message });
    }
  }
  return { updated: results.filter((r) => r.ok).length, results };
}

/**
 * Every column that can hold an account id. Ids are globally unique cuids, so repointing any "...Id" column
 * that holds the merged account's id can only ever touch references to that account.
 */
function idColumns() {
  // The audit trail and integration outbox keep pointing at the account as it was.
  const keepHistory = new Set(["AuditEvent", "IntegrationEvent"]);
  return Prisma.dmmf.datamodel.models.filter((m) => !keepHistory.has(m.name)).flatMap((m) =>
    m.fields
      .filter((f) => f.kind === "scalar" && f.type === "String" && /Id$/.test(f.name) && f.name !== "companyId")
      .map((f) => ({ model: m.name, table: m.dbName ?? m.name, column: f.dbName ?? f.name })),
  );
}

/**
 * QuickBooks merge: renaming an account to the name of a sibling with the same type and detail type folds it into that
 * account. All history moves to the account that is kept, its subaccounts follow, and the merged account is removed.
 * This cannot be undone.
 */
export async function mergeAccounts(companyId: string, sourceId: string, targetId: string, actor: Actor) {
  if (sourceId === targetId) throw new Error("Choose a different account to merge into");
  const [source, target] = await Promise.all([
    prisma.account.findFirst({ where: { id: sourceId, companyId } }),
    prisma.account.findFirst({ where: { id: targetId, companyId } }),
  ]);
  if (!source || !target) throw new Error("Account not found");
  if (source.systemProtected) throw new Error(`${source.code} ${source.name} is a system account and cannot be merged away`);
  if (source.type !== target.type || qbAccountType(source.reportingGroup) !== qbAccountType(target.reportingGroup)) {
    throw new Error("Only accounts with the same account type can be merged");
  }
  const detail = (rg: string | null) => (rg?.includes("|||") ? rg.split("|||")[1] : "");
  if (detail(source.reportingGroup) !== detail(target.reportingGroup)) {
    throw new Error("Only accounts with the same detail type can be merged");
  }
  if ((source.parentId ?? null) !== (target.parentId ?? null)) {
    throw new Error("Only accounts at the same level (same parent) can be merged");
  }
  const functional = (await prisma.currencySettings.findUnique({ where: { companyId } }))?.functionalCurrency ?? "RWF";
  const cur = (c: string | null) => (c?.trim() ? c.trim().toUpperCase() : functional);
  if (cur(source.currency) !== cur(target.currency)) throw new Error("Accounts kept in different currencies cannot be merged");
  const linked = await prisma.financialAccount.count({ where: { companyId, glAccountId: { in: [sourceId, targetId] } } });
  if (linked > 1) throw new Error("Both accounts are linked to bank or cash accounts in Banking; close one there first");

  const merged = await inTransaction(async () => {
    for (const c of idColumns()) {
      try {
        await prisma.$executeRawUnsafe(`UPDATE "${c.table}" SET "${c.column}" = $1 WHERE "${c.column}" = $2`, targetId, sourceId);
      } catch (e) {
        if (/unique/i.test((e as Error).message)) {
          throw new Error(`Both accounts have ${c.model} records that cannot be combined automatically`);
        }
        throw e;
      }
    }
    const kept = await prisma.account.update({
      where: { id: targetId },
      data: {
        currentBalance: { increment: source.currentBalance },
        openingBalance: { increment: source.openingBalance },
        hasPostedTransactions: target.hasPostedTransactions || source.hasPostedTransactions,
        isActive: true,
      },
    });
    await prisma.account.delete({ where: { id: sourceId } });
    return kept;
  });

  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: "MERGE",
    entityType: "Account",
    entityId: targetId,
    beforeJson: { merged: source, into: target },
    afterJson: merged,
    ...actor.meta,
  });
  return { kept: merged, mergedId: sourceId };
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
  const normalized = rows.map((r) => {
    // QuickBooks full names are "Parent:Child"; the prefix names the parent when no parent number is given.
    const path = String(r.name ?? "").split(":").map((x) => x.trim());
    const parentCode = String(r.parentCode ?? "").trim() || null;
    const parentPath = parentCode ? null : String(r.parentName ?? "").trim() || (path.length > 1 ? path.slice(0, -1).join(":") : null);
    return {
      code: String(r.code ?? "").trim(),
      name: path[path.length - 1],
      type: String(r.type ?? "").trim().toUpperCase() as AccountType,
      parentCode,
      parentPath,
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
    };
  });

  // Same rules as the chart: numbers unique when given, names unique among accounts sharing a parent.
  const key = (r: { parentCode: string | null; parentPath: string | null; name: string }) =>
    `${(r.parentCode ?? r.parentPath ?? "").toLowerCase()}>${r.name.toLowerCase()}`;
  const count = <T,>(items: T[]) => items.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<T, number>());
  const dupCodes = [...count(normalized.map((r) => r.code).filter(Boolean))].filter(([, n]) => n > 1).map(([c]) => c);
  const dupNames = [...count(normalized.map(key))].filter(([, n]) => n > 1).map(([k]) => k.split(">").pop()!);
  if (dupCodes.length || dupNames.length) {
    throw new Error(
      `The file repeats ${[dupCodes.length ? `account numbers ${dupCodes.join(", ")}` : "", dupNames.length ? `names ${dupNames.join(", ")} under the same parent` : ""].filter(Boolean).join(" and ")}`,
    );
  }

  const existing = await prisma.account.findMany({ where: { companyId } });
  const byCode = new Map(existing.map((a) => [a.code, a]));
  const byId = new Map(existing.map((a) => [a.id, a]));
  const fullName = (a: Account): string => {
    const parent = a.parentId ? byId.get(a.parentId) : undefined;
    return parent ? `${fullName(parent)}:${a.name}` : a.name;
  };
  const byFullName = new Map(existing.map((a) => [fullName(a).toLowerCase(), a]));
  const rowFullName = (r: (typeof normalized)[number]) => {
    const parent = r.parentCode ? byCode.get(r.parentCode) : undefined;
    const prefix = parent ? fullName(parent) : r.parentPath;
    return (prefix ? `${prefix}:${r.name}` : r.name).toLowerCase();
  };
  const created: Account[] = [];
  const errors: Array<{ code: string; error: string }> = [];

  // Parents before children at any depth: a row is placed once its parent exists or is already placed.
  const ordered: typeof normalized = [];
  const placedCodes = new Set(existing.map((a) => a.code));
  const placedNames = new Set(byFullName.keys());
  const parentPlaced = (r: (typeof normalized)[number]) =>
    r.parentCode ? placedCodes.has(r.parentCode) : r.parentPath ? placedNames.has(r.parentPath.toLowerCase()) : true;
  let pending = [...normalized];
  while (pending.length) {
    const ready = pending.filter(parentPlaced);
    if (!ready.length) {
      ordered.push(...pending); // unknown parents: these report "Parent ... not found"
      break;
    }
    for (const r of ready) {
      if (r.code) placedCodes.add(r.code);
      placedNames.add(`${r.parentPath ? `${r.parentPath}:` : ""}${r.name}`.toLowerCase());
    }
    ordered.push(...ready);
    pending = pending.filter((r) => !ready.includes(r));
  }

  for (const row of ordered) {
    const label = row.code || row.name;
    try {
      if (row.code && byCode.has(row.code)) {
        errors.push({ code: label, error: "Account number already exists" });
        continue;
      }
      if (byFullName.has(rowFullName(row))) {
        errors.push({ code: label, error: "An account with this name already exists here" });
        continue;
      }
      const parent = row.parentCode ? byCode.get(row.parentCode) : row.parentPath ? byFullName.get(row.parentPath.toLowerCase()) : undefined;
      if ((row.parentCode || row.parentPath) && !parent) {
        errors.push({ code: label, error: `Parent ${row.parentCode ?? row.parentPath} not found` });
        continue;
      }
      const account = await createAccount(
        companyId,
        {
          code: row.code || undefined,
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
      byId.set(account.id, account);
      byFullName.set(fullName(account).toLowerCase(), account);
      created.push(account);
    } catch (e) {
      errors.push({ code: label, error: (e as Error).message });
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
