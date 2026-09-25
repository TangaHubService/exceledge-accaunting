import {
  FA_CATEGORY_SEED,
  assertResidualOk,
  buildAssetCapitalizationLines,
  buildDepreciationLines,
  buildDisposalLines,
  buildExpenseLines,
  buildImpairmentLines,
  buildRevaluationLines,
  depreciationCharge,
  netBookValue,
  roundMoney,
  type AssetStatus,
  type DepreciationMethod,
  type DisposalMethod,
  type JournalLineDraft,
} from "@exceledge/accounting-domain";
import { defaultsFor, money, nextNumber } from "../../lib/documents";
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { endOfDay, isoDay, startOfDay } from "../banking/banking.service";
import { createJournal, postJournal } from "../journals/journal.service";

export type Actor = {
  erpUserId?: number;
  erpRole?: string;
  meta?: { ipAddress?: string; userAgent?: string };
};

async function audit(companyId: string, actor: Actor, action: string, entityType: string, entityId: string, afterJson: unknown, beforeJson?: unknown) {
  await writeAudit({ companyId, erpUserId: actor.erpUserId ?? 0, erpRole: actor.erpRole, action, entityType, entityId, beforeJson, afterJson, ...actor.meta });
}

async function postFaJournal(
  companyId: string,
  input: {
    journalDate: Date;
    description: string;
    referenceNumber?: string;
    sourceDocumentType: string;
    sourceDocumentId: string;
    sourceDocumentNumber?: string;
    lines: JournalLineDraft[];
  },
  actor: Actor,
) {
  const journal = await createJournal(
    companyId,
    {
      journalDate: input.journalDate,
      journalType: "AUTOMATIC",
      description: input.description,
      referenceNumber: input.referenceNumber,
      currencyCode: "RWF",
      sourceModule: "FIXED_ASSETS",
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      sourceDocumentNumber: input.sourceDocumentNumber,
      status: "APPROVED",
      lines: input.lines,
    },
    actor,
  );
  return postJournal(companyId, journal.id, actor);
}

async function faDefaults(companyId: string) {
  const defaults = await defaultsFor(companyId);
  if (!defaults.fixedAssetCostId || !defaults.accumulatedDepreciationId || !defaults.depreciationExpenseId) {
    throw new Error("Map fixed asset, accumulated depreciation and depreciation expense accounts in company defaults");
  }
  return defaults;
}

export async function ensureFaCategories(companyId: string, actor: Actor = {}) {
  const count = await prisma.fixedAssetCategory.count({ where: { companyId } });
  if (count > 0) return;
  const defaults = await faDefaults(companyId);
  for (const seed of FA_CATEGORY_SEED) {
    await prisma.fixedAssetCategory.create({
      data: {
        companyId,
        code: seed.code,
        name: seed.name,
        usefulLifeMonths: seed.usefulLifeMonths,
        depreciationMethod: seed.method,
        residualPercent: seed.residualPercent,
        ratePercent: seed.ratePercent ?? null,
        assetAccountId: defaults.fixedAssetCostId,
        accumDepAccountId: defaults.accumulatedDepreciationId,
        depExpenseAccountId: defaults.depreciationExpenseId,
        createdByErpUserId: actor.erpUserId,
      },
    });
  }
}

function serializeCategory(c: {
  id: string;
  code: string;
  name: string;
  usefulLifeMonths: number;
  depreciationMethod: DepreciationMethod;
  residualPercent: { toString(): string } | number;
  ratePercent: { toString(): string } | number | null;
  assetAccountId: string | null;
  accumDepAccountId: string | null;
  depExpenseAccountId: string | null;
  isActive: boolean;
  notes: string | null;
}) {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    usefulLifeMonths: c.usefulLifeMonths,
    depreciationMethod: c.depreciationMethod,
    residualPercent: money(c.residualPercent),
    ratePercent: c.ratePercent == null ? null : money(c.ratePercent),
    assetAccountId: c.assetAccountId,
    accumDepAccountId: c.accumDepAccountId,
    depExpenseAccountId: c.depExpenseAccountId,
    isActive: c.isActive,
    notes: c.notes,
  };
}

export async function listCategories(companyId: string, options: { includeInactive?: boolean } = {}) {
  await ensureFaCategories(companyId);
  const rows = await prisma.fixedAssetCategory.findMany({
    where: { companyId, ...(options.includeInactive ? {} : { isActive: true }) },
    orderBy: { code: "asc" },
  });
  return rows.map(serializeCategory);
}

export async function createCategory(
  companyId: string,
  input: {
    code: string;
    name: string;
    usefulLifeMonths: number;
    depreciationMethod: DepreciationMethod;
    residualPercent?: number;
    ratePercent?: number;
    assetAccountId?: string;
    accumDepAccountId?: string;
    depExpenseAccountId?: string;
    notes?: string;
  },
  actor: Actor = {},
) {
  await ensureFaCategories(companyId, actor);
  const defaults = await faDefaults(companyId);
  if (input.depreciationMethod === "REDUCING_BALANCE" && !(input.ratePercent && input.ratePercent > 0)) {
    throw new Error("Reducing-balance categories need a depreciation rate percent");
  }
  const created = await prisma.fixedAssetCategory.create({
    data: {
      companyId,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      usefulLifeMonths: Math.max(0, Math.floor(input.usefulLifeMonths)),
      depreciationMethod: input.depreciationMethod,
      residualPercent: input.residualPercent ?? 0,
      ratePercent: input.ratePercent ?? null,
      assetAccountId: input.assetAccountId ?? defaults.fixedAssetCostId,
      accumDepAccountId: input.accumDepAccountId ?? defaults.accumulatedDepreciationId,
      depExpenseAccountId: input.depExpenseAccountId ?? defaults.depreciationExpenseId,
      notes: input.notes,
      createdByErpUserId: actor.erpUserId,
    },
  });
  await audit(companyId, actor, "CREATE", "FixedAssetCategory", created.id, created);
  return serializeCategory(created);
}

export async function updateCategory(
  companyId: string,
  id: string,
  input: {
    name?: string;
    usefulLifeMonths?: number;
    depreciationMethod?: DepreciationMethod;
    residualPercent?: number;
    ratePercent?: number | null;
    assetAccountId?: string | null;
    accumDepAccountId?: string | null;
    depExpenseAccountId?: string | null;
    isActive?: boolean;
    notes?: string | null;
  },
  actor: Actor = {},
) {
  const before = await prisma.fixedAssetCategory.findFirst({ where: { id, companyId } });
  if (!before) throw new Error("Asset category does not exist");
  const updated = await prisma.fixedAssetCategory.update({
    where: { id },
    data: {
      name: input.name?.trim(),
      usefulLifeMonths: input.usefulLifeMonths === undefined ? undefined : Math.max(0, Math.floor(input.usefulLifeMonths)),
      depreciationMethod: input.depreciationMethod,
      residualPercent: input.residualPercent,
      ratePercent: input.ratePercent === undefined ? undefined : input.ratePercent,
      assetAccountId: input.assetAccountId === undefined ? undefined : input.assetAccountId,
      accumDepAccountId: input.accumDepAccountId === undefined ? undefined : input.accumDepAccountId,
      depExpenseAccountId: input.depExpenseAccountId === undefined ? undefined : input.depExpenseAccountId,
      isActive: input.isActive,
      notes: input.notes === undefined ? undefined : input.notes,
    },
  });
  await audit(companyId, actor, "UPDATE", "FixedAssetCategory", id, updated, before);
  return serializeCategory(updated);
}

function assetNbv(a: { acquisitionCost: { toString(): string } | number; accumulatedDepreciation: { toString(): string } | number }) {
  return netBookValue(money(a.acquisitionCost), money(a.accumulatedDepreciation));
}

async function serializeAsset(companyId: string, id: string) {
  const a = await prisma.fixedAsset.findFirst({
    where: { id, companyId },
    include: {
      category: true,
      depreciations: { orderBy: { period: "desc" }, take: 12 },
      maintenances: { orderBy: { maintenanceDate: "desc" }, take: 10 },
      transfers: { orderBy: { transferDate: "desc" }, take: 10 },
      revaluations: { orderBy: { effectiveDate: "desc" }, take: 5 },
      impairments: { orderBy: { impairmentDate: "desc" }, take: 5 },
    },
  });
  if (!a) throw new Error("Asset does not exist");
  const cost = money(a.acquisitionCost);
  const accum = money(a.accumulatedDepreciation);
  const residual = money(a.residualValue);
  return {
    id: a.id,
    number: a.number,
    name: a.name,
    categoryId: a.categoryId,
    categoryCode: a.category.code,
    categoryName: a.category.name,
    serialNumber: a.serialNumber,
    barcode: a.barcode,
    description: a.description,
    supplierId: a.supplierId,
    supplierName: a.supplierName,
    purchaseDate: a.purchaseDate ? isoDay(a.purchaseDate) : null,
    acquisitionCost: cost,
    currencyCode: a.currencyCode,
    acquisitionMethod: a.acquisitionMethod,
    residualValue: residual,
    usefulLifeMonths: a.usefulLifeMonths,
    depreciationMethod: a.depreciationMethod,
    ratePercent: a.ratePercent == null ? null : money(a.ratePercent),
    assetAccountId: a.assetAccountId,
    accumDepAccountId: a.accumDepAccountId,
    depExpenseAccountId: a.depExpenseAccountId,
    creditAccountId: a.creditAccountId,
    branch: a.branch,
    department: a.department,
    costCentre: a.costCentre,
    project: a.project,
    location: a.location,
    assignedEmployee: a.assignedEmployee,
    warrantyExpiry: a.warrantyExpiry ? isoDay(a.warrantyExpiry) : null,
    insuranceDetails: a.insuranceDetails,
    status: a.status as AssetStatus,
    capitalizedAt: a.capitalizedAt ? isoDay(a.capitalizedAt) : null,
    capitalizationJournalId: a.capitalizationJournalId,
    accumulatedDepreciation: accum,
    netBookValue: assetNbv(a),
    lastDepreciationPeriod: a.lastDepreciationPeriod,
    disposedAt: a.disposedAt ? isoDay(a.disposedAt) : null,
    disposalMethod: a.disposalMethod,
    disposalProceeds: a.disposalProceeds == null ? null : money(a.disposalProceeds),
    disposalJournalId: a.disposalJournalId,
    disposalNotes: a.disposalNotes,
    depreciations: a.depreciations.map((d) => ({ id: d.id, period: d.period, amount: money(d.amount), journalId: d.journalId })),
    maintenances: a.maintenances.map((m) => ({
      id: m.id,
      maintenanceDate: isoDay(m.maintenanceDate),
      maintenanceType: m.maintenanceType,
      serviceProvider: m.serviceProvider,
      description: m.description,
      cost: money(m.cost),
      nextMaintenanceDate: m.nextMaintenanceDate ? isoDay(m.nextMaintenanceDate) : null,
    })),
    transfers: a.transfers.map((t) => ({
      id: t.id,
      transferDate: isoDay(t.transferDate),
      toBranch: t.toBranch,
      toDepartment: t.toDepartment,
      toLocation: t.toLocation,
      toEmployee: t.toEmployee,
      notes: t.notes,
    })),
    revaluations: a.revaluations.map((r) => ({
      id: r.id,
      effectiveDate: isoDay(r.effectiveDate),
      previousCarrying: money(r.previousCarrying),
      fairValue: money(r.fairValue),
      amount: money(r.amount),
      increase: r.increase,
      journalId: r.journalId,
    })),
    impairments: a.impairments.map((i) => ({
      id: i.id,
      impairmentDate: isoDay(i.impairmentDate),
      recoverableAmount: money(i.recoverableAmount),
      lossAmount: money(i.lossAmount),
      reason: i.reason,
      journalId: i.journalId,
    })),
  };
}

export async function listAssets(
  companyId: string,
  filters: { status?: string; categoryId?: string; q?: string; from?: string; to?: string } = {},
) {
  await ensureFaCategories(companyId);
  const rows = await prisma.fixedAsset.findMany({
    where: {
      companyId,
      ...(filters.status ? { status: filters.status as AssetStatus } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.q
        ? {
            OR: [
              { number: { contains: filters.q, mode: "insensitive" } },
              { name: { contains: filters.q, mode: "insensitive" } },
              { serialNumber: { contains: filters.q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(filters.from || filters.to
        ? {
            purchaseDate: {
              ...(filters.from ? { gte: startOfDay(filters.from) } : {}),
              ...(filters.to ? { lte: endOfDay(filters.to) } : {}),
            },
          }
        : {}),
    },
    include: { category: true },
    orderBy: [{ number: "desc" }],
    take: 500,
  });
  return rows.map((a) => ({
    id: a.id,
    number: a.number,
    name: a.name,
    categoryId: a.categoryId,
    categoryName: a.category.name,
    acquisitionCost: money(a.acquisitionCost),
    accumulatedDepreciation: money(a.accumulatedDepreciation),
    netBookValue: assetNbv(a),
    status: a.status,
    branch: a.branch,
    location: a.location,
    assignedEmployee: a.assignedEmployee,
    purchaseDate: a.purchaseDate ? isoDay(a.purchaseDate) : null,
    capitalizedAt: a.capitalizedAt ? isoDay(a.capitalizedAt) : null,
  }));
}

export async function getAsset(companyId: string, id: string) {
  return serializeAsset(companyId, id);
}

export async function registerAsset(
  companyId: string,
  input: {
    name: string;
    categoryId: string;
    acquisitionCost: number;
    residualValue?: number;
    purchaseDate?: string;
    serialNumber?: string;
    barcode?: string;
    description?: string;
    supplierId?: string;
    supplierName?: string;
    acquisitionMethod?: string;
    usefulLifeMonths?: number;
    depreciationMethod?: DepreciationMethod;
    ratePercent?: number;
    branch?: string;
    department?: string;
    costCentre?: string;
    project?: string;
    location?: string;
    assignedEmployee?: string;
    warrantyExpiry?: string;
    insuranceDetails?: string;
    capitalize?: boolean;
    creditAccountId?: string;
    capitalizationDate?: string;
    sourceDocumentType?: string;
    sourceDocumentId?: string;
  },
  actor: Actor = {},
) {
  await ensureFaCategories(companyId, actor);
  const category = await prisma.fixedAssetCategory.findFirst({ where: { id: input.categoryId, companyId, isActive: true } });
  if (!category) throw new Error("Choose an active asset category");
  const cost = roundMoney(input.acquisitionCost);
  const residual =
    input.residualValue !== undefined
      ? roundMoney(input.residualValue)
      : roundMoney((cost * money(category.residualPercent)) / 100);
  assertResidualOk(cost, residual);
  const method = (input.depreciationMethod ?? category.depreciationMethod) as DepreciationMethod;
  const life = input.usefulLifeMonths ?? category.usefulLifeMonths;
  const rate = input.ratePercent ?? (category.ratePercent == null ? undefined : money(category.ratePercent));
  if (method === "REDUCING_BALANCE" && !(rate && rate > 0)) throw new Error("Reducing-balance assets need a depreciation rate percent");
  if (life < 0) throw new Error("Useful life cannot be negative");

  const defaults = await faDefaults(companyId);
  const number = await nextNumber(companyId, "FIXED_ASSET", "FA");
  const created = await prisma.fixedAsset.create({
    data: {
      companyId,
      number,
      name: input.name.trim(),
      categoryId: category.id,
      serialNumber: input.serialNumber?.trim(),
      barcode: input.barcode?.trim(),
      description: input.description?.trim(),
      supplierId: input.supplierId,
      supplierName: input.supplierName?.trim(),
      purchaseDate: input.purchaseDate ? startOfDay(input.purchaseDate) : null,
      acquisitionCost: cost,
      acquisitionMethod: (input.acquisitionMethod as never) ?? "PURCHASE",
      residualValue: residual,
      usefulLifeMonths: life,
      depreciationMethod: method,
      ratePercent: rate ?? null,
      assetAccountId: category.assetAccountId ?? defaults.fixedAssetCostId,
      accumDepAccountId: category.accumDepAccountId ?? defaults.accumulatedDepreciationId,
      depExpenseAccountId: category.depExpenseAccountId ?? defaults.depreciationExpenseId,
      branch: input.branch,
      department: input.department,
      costCentre: input.costCentre,
      project: input.project,
      location: input.location,
      assignedEmployee: input.assignedEmployee,
      warrantyExpiry: input.warrantyExpiry ? startOfDay(input.warrantyExpiry) : null,
      insuranceDetails: input.insuranceDetails,
      sourceDocumentType: input.sourceDocumentType,
      sourceDocumentId: input.sourceDocumentId,
      createdByErpUserId: actor.erpUserId,
    },
  });
  await audit(companyId, actor, "CREATE", "FixedAsset", created.id, created);

  if (input.capitalize) {
    return capitalizeAsset(
      companyId,
      created.id,
      { capitalizationDate: input.capitalizationDate ?? input.purchaseDate ?? isoDay(new Date()), creditAccountId: input.creditAccountId },
      actor,
    );
  }
  return serializeAsset(companyId, created.id);
}

export async function capitalizeAsset(
  companyId: string,
  id: string,
  input: { capitalizationDate: string; creditAccountId?: string; residualValue?: number; usefulLifeMonths?: number },
  actor: Actor = {},
) {
  const asset = await prisma.fixedAsset.findFirst({ where: { id, companyId } });
  if (!asset) throw new Error("Asset does not exist");
  if (asset.status !== "REGISTERED") throw new Error("Only registered assets can be capitalized");
  const defaults = await faDefaults(companyId);
  const creditAccountId = input.creditAccountId ?? defaults.defaultBankAccountId ?? defaults.accountsPayableId;
  if (!creditAccountId) throw new Error("Choose the bank or payable account to credit on capitalization");
  const assetAccountId = asset.assetAccountId ?? defaults.fixedAssetCostId!;
  const cost = money(asset.acquisitionCost);
  const residual = input.residualValue !== undefined ? roundMoney(input.residualValue) : money(asset.residualValue);
  assertResidualOk(cost, residual);
  const lines = buildAssetCapitalizationLines({
    assetAccountId,
    creditAccountId,
    cost,
    description: `Capitalize ${asset.number} ${asset.name}`,
  });
  const journal = await postFaJournal(
    companyId,
    {
      journalDate: startOfDay(input.capitalizationDate),
      description: `Asset capitalization ${asset.number}`,
      referenceNumber: asset.number,
      sourceDocumentType: "FIXED_ASSET",
      sourceDocumentId: asset.id,
      sourceDocumentNumber: asset.number,
      lines,
    },
    actor,
  );
  const updated = await prisma.fixedAsset.update({
    where: { id },
    data: {
      status: "ACTIVE",
      capitalizedAt: startOfDay(input.capitalizationDate),
      capitalizationJournalId: journal.id,
      creditAccountId,
      assetAccountId,
      residualValue: residual,
      usefulLifeMonths: input.usefulLifeMonths ?? asset.usefulLifeMonths,
    },
  });
  await audit(companyId, actor, "CAPITALIZE", "FixedAsset", id, updated, asset);
  return serializeAsset(companyId, id);
}

function periodEndDate(period: string) {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error("Use a yyyy-mm depreciation period");
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
}

export async function previewDepreciation(companyId: string, period: string) {
  await ensureFaCategories(companyId);
  const assets = await prisma.fixedAsset.findMany({
    where: { companyId, status: { in: ["ACTIVE", "FULLY_DEPRECIATED"] } },
  });
  const items = [];
  for (const a of assets) {
    if (a.status === "FULLY_DEPRECIATED") continue;
    if (a.lastDepreciationPeriod && a.lastDepreciationPeriod >= period) continue;
    const existing = await prisma.fixedAssetDepreciation.findUnique({ where: { assetId_period: { assetId: a.id, period } } });
    if (existing) continue;
    const charge = depreciationCharge(a.depreciationMethod as DepreciationMethod, {
      cost: money(a.acquisitionCost),
      residual: money(a.residualValue),
      usefulLifeMonths: a.usefulLifeMonths,
      ratePercent: a.ratePercent == null ? undefined : money(a.ratePercent),
      accumulated: money(a.accumulatedDepreciation),
    });
    if (!(charge > 0)) continue;
    items.push({
      assetId: a.id,
      number: a.number,
      name: a.name,
      amount: charge,
      netBookValueAfter: roundMoney(assetNbv(a) - charge),
    });
  }
  return { period, assetCount: items.length, totalAmount: roundMoney(items.reduce((s, i) => s + i.amount, 0)), items };
}

export async function runDepreciation(companyId: string, period: string, actor: Actor = {}) {
  const existing = await prisma.fixedAssetDepreciationRun.findUnique({ where: { companyId_period: { companyId, period } } });
  if (existing) throw new Error(`Depreciation for ${period} is already posted`);
  const preview = await previewDepreciation(companyId, period);
  if (preview.assetCount === 0) throw new Error("No assets need depreciation for this period");
  const defaults = await faDefaults(companyId);
  const assets = await prisma.fixedAsset.findMany({ where: { id: { in: preview.items.map((i) => i.assetId) } } });
  const byId = new Map(assets.map((a) => [a.id, a]));

  type Agg = { expenseAccountId: string; accumAccountId: string; amount: number };
  const agg = new Map<string, Agg>();
  for (const item of preview.items) {
    const a = byId.get(item.assetId)!;
    const expenseAccountId = a.depExpenseAccountId ?? defaults.depreciationExpenseId!;
    const accumAccountId = a.accumDepAccountId ?? defaults.accumulatedDepreciationId!;
    const key = `${expenseAccountId}|${accumAccountId}`;
    const cur = agg.get(key) ?? { expenseAccountId, accumAccountId, amount: 0 };
    cur.amount = roundMoney(cur.amount + item.amount);
    agg.set(key, cur);
  }

  const lines: JournalLineDraft[] = [];
  for (const group of agg.values()) {
    lines.push(
      ...buildDepreciationLines({
        expenseAccountId: group.expenseAccountId,
        accumulatedAccountId: group.accumAccountId,
        amount: group.amount,
        description: `Depreciation ${period}`,
      }),
    );
  }

  const run = await prisma.fixedAssetDepreciationRun.create({
    data: {
      companyId,
      period,
      assetCount: preview.assetCount,
      totalAmount: preview.totalAmount,
      postedByErpUserId: actor.erpUserId,
    },
  });

  const journal = await postFaJournal(
    companyId,
    {
      journalDate: periodEndDate(period),
      description: `Fixed asset depreciation ${period}`,
      referenceNumber: `DEP-${period}`,
      sourceDocumentType: "FA_DEPRECIATION_RUN",
      sourceDocumentId: run.id,
      sourceDocumentNumber: period,
      lines,
    },
    actor,
  );

  for (const item of preview.items) {
    const a = byId.get(item.assetId)!;
    const newAccum = roundMoney(money(a.accumulatedDepreciation) + item.amount);
    const nbv = netBookValue(money(a.acquisitionCost), newAccum);
    const residual = money(a.residualValue);
    const status: AssetStatus = nbv <= residual ? "FULLY_DEPRECIATED" : "ACTIVE";
    await prisma.fixedAssetDepreciation.create({
      data: {
        companyId,
        assetId: a.id,
        runId: run.id,
        period,
        amount: item.amount,
        journalId: journal.id,
      },
    });
    await prisma.fixedAsset.update({
      where: { id: a.id },
      data: { accumulatedDepreciation: newAccum, lastDepreciationPeriod: period, status },
    });
  }

  const updatedRun = await prisma.fixedAssetDepreciationRun.update({
    where: { id: run.id },
    data: { journalId: journal.id },
  });
  await audit(companyId, actor, "DEPRECIATE", "FixedAssetDepreciationRun", run.id, { ...updatedRun, items: preview.items });
  return {
    id: updatedRun.id,
    period,
    assetCount: preview.assetCount,
    totalAmount: preview.totalAmount,
    journalId: journal.id,
    journalNumber: journal.journalNumber,
    items: preview.items,
  };
}

export async function listDepreciationRuns(companyId: string) {
  const rows = await prisma.fixedAssetDepreciationRun.findMany({ where: { companyId }, orderBy: { period: "desc" }, take: 48 });
  return rows.map((r) => ({
    id: r.id,
    period: r.period,
    assetCount: r.assetCount,
    totalAmount: money(r.totalAmount),
    journalId: r.journalId,
    postedAt: r.postedAt.toISOString(),
  }));
}

export async function transferAsset(
  companyId: string,
  id: string,
  input: {
    transferDate: string;
    toBranch?: string;
    toDepartment?: string;
    toCostCentre?: string;
    toProject?: string;
    toLocation?: string;
    toEmployee?: string;
    notes?: string;
  },
  actor: Actor = {},
) {
  const asset = await prisma.fixedAsset.findFirst({ where: { id, companyId } });
  if (!asset) throw new Error("Asset does not exist");
  if (asset.status === "DISPOSED") throw new Error("Disposed assets cannot be transferred");
  const transfer = await prisma.fixedAssetTransfer.create({
    data: {
      companyId,
      assetId: id,
      transferDate: startOfDay(input.transferDate),
      fromBranch: asset.branch,
      toBranch: input.toBranch ?? asset.branch,
      fromDepartment: asset.department,
      toDepartment: input.toDepartment ?? asset.department,
      fromCostCentre: asset.costCentre,
      toCostCentre: input.toCostCentre ?? asset.costCentre,
      fromProject: asset.project,
      toProject: input.toProject ?? asset.project,
      fromLocation: asset.location,
      toLocation: input.toLocation ?? asset.location,
      fromEmployee: asset.assignedEmployee,
      toEmployee: input.toEmployee ?? asset.assignedEmployee,
      notes: input.notes,
      createdByErpUserId: actor.erpUserId,
    },
  });
  const updated = await prisma.fixedAsset.update({
    where: { id },
    data: {
      branch: input.toBranch ?? asset.branch,
      department: input.toDepartment ?? asset.department,
      costCentre: input.toCostCentre ?? asset.costCentre,
      project: input.toProject ?? asset.project,
      location: input.toLocation ?? asset.location,
      assignedEmployee: input.toEmployee ?? asset.assignedEmployee,
    },
  });
  await audit(companyId, actor, "TRANSFER", "FixedAsset", id, { transfer, asset: updated }, asset);
  return serializeAsset(companyId, id);
}

export async function recordMaintenance(
  companyId: string,
  id: string,
  input: {
    maintenanceDate: string;
    maintenanceType: string;
    serviceProvider?: string;
    description?: string;
    cost?: number;
    nextMaintenanceDate?: string;
    postExpense?: boolean;
    expenseAccountId?: string;
    creditAccountId?: string;
  },
  actor: Actor = {},
) {
  const asset = await prisma.fixedAsset.findFirst({ where: { id, companyId } });
  if (!asset) throw new Error("Asset does not exist");
  if (asset.status === "DISPOSED") throw new Error("Disposed assets cannot receive maintenance");
  const cost = roundMoney(input.cost ?? 0);
  let expenseJournalId: string | null = null;
  if (input.postExpense && cost > 0) {
    const defaults = await faDefaults(companyId);
    let expenseAccountId = input.expenseAccountId;
    if (!expenseAccountId) {
      const repairs = await prisma.account.findFirst({ where: { companyId, code: "6150" } });
      if (repairs) expenseAccountId = repairs.id;
      else {
        const created = await prisma.account.create({
          data: {
            companyId,
            code: "6150",
            name: "Repairs and maintenance",
            type: "EXPENSE",
            isActive: true,
            systemProtected: false,
            allowManualPost: true,
          },
        });
        expenseAccountId = created.id;
      }
    }
    const creditAccountId = input.creditAccountId ?? defaults.defaultBankAccountId;
    if (!creditAccountId) throw new Error("Map a payment account to post maintenance");
    const lines = buildExpenseLines({
      expenseAccountId,
      creditAccountId,
      net: cost,
      tax: 0,
      description: `Maintenance ${asset.number}`,
    });
    const journal = await postFaJournal(
      companyId,
      {
        journalDate: startOfDay(input.maintenanceDate),
        description: `Asset maintenance ${asset.number}`,
        referenceNumber: asset.number,
        sourceDocumentType: "FA_MAINTENANCE",
        sourceDocumentId: id,
        sourceDocumentNumber: asset.number,
        lines,
      },
      actor,
    );
    expenseJournalId = journal.id;
  }
  const row = await prisma.fixedAssetMaintenance.create({
    data: {
      companyId,
      assetId: id,
      maintenanceDate: startOfDay(input.maintenanceDate),
      maintenanceType: input.maintenanceType.trim(),
      serviceProvider: input.serviceProvider,
      description: input.description,
      cost,
      nextMaintenanceDate: input.nextMaintenanceDate ? startOfDay(input.nextMaintenanceDate) : null,
      expenseJournalId,
      createdByErpUserId: actor.erpUserId,
    },
  });
  await audit(companyId, actor, "MAINTENANCE", "FixedAsset", id, row);
  return serializeAsset(companyId, id);
}

export async function revalueAsset(
  companyId: string,
  id: string,
  input: { effectiveDate: string; fairValue: number; valuationReference?: string },
  actor: Actor = {},
) {
  const asset = await prisma.fixedAsset.findFirst({ where: { id, companyId } });
  if (!asset) throw new Error("Asset does not exist");
  if (asset.status !== "ACTIVE" && asset.status !== "FULLY_DEPRECIATED") throw new Error("Only active assets can be revalued");
  const defaults = await faDefaults(companyId);
  if (!defaults.assetRevaluationReserveId) throw new Error("Map an asset revaluation reserve account in company defaults");
  const carrying = assetNbv(asset);
  const fairValue = roundMoney(input.fairValue);
  const amount = roundMoney(Math.abs(fairValue - carrying));
  if (!(amount > 0)) throw new Error("Fair value equals current carrying amount");
  const increase = fairValue > carrying;
  const assetAccountId = asset.assetAccountId ?? defaults.fixedAssetCostId!;
  const lines = buildRevaluationLines({
    assetAccountId,
    reserveAccountId: defaults.assetRevaluationReserveId,
    amount,
    increase,
    description: `Revaluation ${asset.number}`,
  });
  const journal = await postFaJournal(
    companyId,
    {
      journalDate: startOfDay(input.effectiveDate),
      description: `Asset revaluation ${asset.number}`,
      referenceNumber: asset.number,
      sourceDocumentType: "FA_REVALUATION",
      sourceDocumentId: id,
      sourceDocumentNumber: asset.number,
      lines,
    },
    actor,
  );
  const newCost = roundMoney(money(asset.acquisitionCost) + (increase ? amount : -amount));
  if (newCost <= 0) throw new Error("Revaluation would reduce asset cost to zero or below");
  assertResidualOk(newCost, money(asset.residualValue));
  await prisma.fixedAssetRevaluation.create({
    data: {
      companyId,
      assetId: id,
      effectiveDate: startOfDay(input.effectiveDate),
      previousCarrying: carrying,
      fairValue,
      amount,
      increase,
      valuationReference: input.valuationReference,
      journalId: journal.id,
      createdByErpUserId: actor.erpUserId,
    },
  });
  await prisma.fixedAsset.update({
    where: { id },
    data: { acquisitionCost: newCost, assetAccountId },
  });
  await audit(companyId, actor, "REVALUE", "FixedAsset", id, { fairValue, amount, increase, journalId: journal.id });
  return serializeAsset(companyId, id);
}

export async function impairAsset(
  companyId: string,
  id: string,
  input: { impairmentDate: string; recoverableAmount: number; reason?: string },
  actor: Actor = {},
) {
  const asset = await prisma.fixedAsset.findFirst({ where: { id, companyId } });
  if (!asset) throw new Error("Asset does not exist");
  if (asset.status !== "ACTIVE" && asset.status !== "FULLY_DEPRECIATED") throw new Error("Only active assets can be impaired");
  const defaults = await faDefaults(companyId);
  const carrying = assetNbv(asset);
  const recoverable = roundMoney(input.recoverableAmount);
  if (recoverable < 0) throw new Error("Recoverable amount cannot be negative");
  const loss = roundMoney(carrying - recoverable);
  if (!(loss > 0)) throw new Error("Recoverable amount is not below carrying amount");
  const lossAccountId = defaults.lossOnDisposalId ?? defaults.depreciationExpenseId;
  const accumAccountId = asset.accumDepAccountId ?? defaults.accumulatedDepreciationId!;
  if (!lossAccountId) throw new Error("Map a loss account for impairment");
  const lines = buildImpairmentLines({
    lossAccountId,
    accumulatedAccountId: accumAccountId,
    amount: loss,
    description: `Impairment ${asset.number}`,
  });
  const journal = await postFaJournal(
    companyId,
    {
      journalDate: startOfDay(input.impairmentDate),
      description: `Asset impairment ${asset.number}`,
      referenceNumber: asset.number,
      sourceDocumentType: "FA_IMPAIRMENT",
      sourceDocumentId: id,
      sourceDocumentNumber: asset.number,
      lines,
    },
    actor,
  );
  const newAccum = roundMoney(money(asset.accumulatedDepreciation) + loss);
  await prisma.fixedAssetImpairment.create({
    data: {
      companyId,
      assetId: id,
      impairmentDate: startOfDay(input.impairmentDate),
      recoverableAmount: recoverable,
      lossAmount: loss,
      reason: input.reason,
      journalId: journal.id,
      createdByErpUserId: actor.erpUserId,
    },
  });
  await prisma.fixedAsset.update({
    where: { id },
    data: {
      accumulatedDepreciation: newAccum,
      status: recoverable <= money(asset.residualValue) ? "FULLY_DEPRECIATED" : asset.status,
    },
  });
  await audit(companyId, actor, "IMPAIR", "FixedAsset", id, { loss, recoverable, journalId: journal.id });
  return serializeAsset(companyId, id);
}

export async function disposeAsset(
  companyId: string,
  id: string,
  input: { disposalDate: string; disposalMethod: DisposalMethod; proceeds?: number; proceedsAccountId?: string; notes?: string },
  actor: Actor = {},
) {
  const asset = await prisma.fixedAsset.findFirst({ where: { id, companyId } });
  if (!asset) throw new Error("Asset does not exist");
  if (asset.status === "DISPOSED") throw new Error("Asset is already disposed");
  if (asset.status === "REGISTERED") throw new Error("Capitalize the asset before disposal");
  const defaults = await faDefaults(companyId);
  const proceeds = roundMoney(input.proceeds ?? 0);
  const lines = buildDisposalLines({
    assetAccountId: asset.assetAccountId ?? defaults.fixedAssetCostId!,
    accumulatedAccountId: asset.accumDepAccountId ?? defaults.accumulatedDepreciationId!,
    proceedsAccountId: input.proceedsAccountId ?? defaults.defaultBankAccountId,
    gainAccountId: defaults.gainOnDisposalId,
    lossAccountId: defaults.lossOnDisposalId,
    cost: money(asset.acquisitionCost),
    accumulated: money(asset.accumulatedDepreciation),
    proceeds,
    description: `Dispose ${asset.number}`,
  });
  const journal = await postFaJournal(
    companyId,
    {
      journalDate: startOfDay(input.disposalDate),
      description: `Asset disposal ${asset.number}`,
      referenceNumber: asset.number,
      sourceDocumentType: "FA_DISPOSAL",
      sourceDocumentId: id,
      sourceDocumentNumber: asset.number,
      lines,
    },
    actor,
  );
  const updated = await prisma.fixedAsset.update({
    where: { id },
    data: {
      status: "DISPOSED",
      disposedAt: startOfDay(input.disposalDate),
      disposalMethod: input.disposalMethod,
      disposalProceeds: proceeds,
      disposalJournalId: journal.id,
      disposalNotes: input.notes,
    },
  });
  await audit(companyId, actor, "DISPOSE", "FixedAsset", id, updated, asset);
  return serializeAsset(companyId, id);
}

export async function faDashboard(companyId: string) {
  await ensureFaCategories(companyId);
  const assets = await prisma.fixedAsset.findMany({ where: { companyId, status: { not: "DISPOSED" } }, include: { category: true } });
  const disposed = await prisma.fixedAsset.count({ where: { companyId, status: "DISPOSED" } });
  const year = new Date().getUTCFullYear();
  const acquiredThisYear = await prisma.fixedAsset.count({
    where: { companyId, purchaseDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31, 23, 59, 59)) } },
  });
  const fullyDepreciated = assets.filter((a) => a.status === "FULLY_DEPRECIATED").length;
  const dueMaintenance = await prisma.fixedAssetMaintenance.count({
    where: { companyId, nextMaintenanceDate: { lte: endOfDay(isoDay(new Date())) } },
  });
  const totalCost = roundMoney(assets.reduce((s, a) => s + money(a.acquisitionCost), 0));
  const totalAccum = roundMoney(assets.reduce((s, a) => s + money(a.accumulatedDepreciation), 0));
  const byCategory = new Map<string, { name: string; count: number; cost: number; nbv: number }>();
  for (const a of assets) {
    const cur = byCategory.get(a.categoryId) ?? { name: a.category.name, count: 0, cost: 0, nbv: 0 };
    cur.count += 1;
    cur.cost = roundMoney(cur.cost + money(a.acquisitionCost));
    cur.nbv = roundMoney(cur.nbv + assetNbv(a));
    byCategory.set(a.categoryId, cur);
  }
  const recent = await prisma.fixedAsset.findMany({
    where: { companyId },
    include: { category: true },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  const runs = await listDepreciationRuns(companyId);
  return {
    totals: {
      count: assets.length,
      cost: totalCost,
      accumulatedDepreciation: totalAccum,
      netBookValue: roundMoney(totalCost - totalAccum),
      disposed,
      acquiredThisYear,
      fullyDepreciated,
      dueMaintenance,
    },
    byCategory: [...byCategory.values()].sort((a, b) => b.cost - a.cost),
    recent: recent.map((a) => ({
      id: a.id,
      number: a.number,
      name: a.name,
      categoryName: a.category.name,
      status: a.status,
      netBookValue: assetNbv(a),
      acquisitionCost: money(a.acquisitionCost),
    })),
    depreciationRuns: runs.slice(0, 6),
  };
}

export async function registerReport(companyId: string) {
  return listAssets(companyId);
}

export async function depreciationSchedule(companyId: string, period?: string) {
  const where = { companyId, ...(period ? { period } : {}) };
  const rows = await prisma.fixedAssetDepreciation.findMany({
    where,
    include: { asset: { select: { number: true, name: true } } },
    orderBy: [{ period: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
  return {
    total: roundMoney(rows.reduce((s, r) => s + money(r.amount), 0)),
    rows: rows.map((r) => ({
      id: r.id,
      period: r.period,
      amount: money(r.amount),
      assetNumber: r.asset.number,
      assetName: r.asset.name,
      journalId: r.journalId,
    })),
  };
}

/** ERP ASSET_ACQUIRED → register + capitalize (idempotent on source document). */
export async function syncAssetFromEvent(
  companyId: string,
  event: {
    sourceModule: string;
    sourceDocumentType: string;
    sourceDocumentId: string;
    sourceDocumentNumber?: string | null;
    occurredAt: Date;
    amountTotals?: { net?: string; tax?: string; gross?: string } | null;
    metadata?: Record<string, unknown> | null;
  },
  actor: Actor = {},
) {
  const existing = await prisma.fixedAsset.findFirst({
    where: { companyId, sourceDocumentType: event.sourceDocumentType, sourceDocumentId: event.sourceDocumentId },
  });
  if (existing) return serializeAsset(companyId, existing.id);

  await ensureFaCategories(companyId, actor);
  const meta = event.metadata ?? {};
  const categoryCode = String(meta.categoryCode ?? "OFFICE").toUpperCase();
  let category = await prisma.fixedAssetCategory.findFirst({ where: { companyId, code: categoryCode } });
  if (!category) category = await prisma.fixedAssetCategory.findFirst({ where: { companyId, isActive: true }, orderBy: { code: "asc" } });
  if (!category) throw new Error("No fixed asset category available");
  const cost = roundMoney(Number(event.amountTotals?.gross ?? event.amountTotals?.net ?? meta.acquisitionCost ?? 0));
  if (!(cost > 0)) throw new Error("ASSET_ACQUIRED requires a positive acquisition cost");
  const defaults = await faDefaults(companyId);
  return registerAsset(
    companyId,
    {
      name: String(meta.name ?? event.sourceDocumentNumber ?? "Acquired asset"),
      categoryId: category.id,
      acquisitionCost: cost,
      purchaseDate: isoDay(event.occurredAt),
      description: meta.description ? String(meta.description) : undefined,
      supplierName: meta.supplierName ? String(meta.supplierName) : undefined,
      branch: meta.branch ? String(meta.branch) : undefined,
      capitalize: true,
      creditAccountId: (meta.creditAccountId as string | undefined) ?? defaults.defaultBankAccountId ?? undefined,
      capitalizationDate: isoDay(event.occurredAt),
      sourceDocumentType: event.sourceDocumentType,
      sourceDocumentId: event.sourceDocumentId,
    },
    actor,
  );
}
