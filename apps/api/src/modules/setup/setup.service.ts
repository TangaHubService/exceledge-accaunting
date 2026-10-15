import {
  MANDATORY_DEFAULT_ACCOUNT_KEYS,
  SETUP_SECTIONS,
  SYSTEM_ACCOUNT_CODE_REMAP,
  SYSTEM_ACCOUNT_SEED,
  MAX_APPROVAL_LEVELS,
  assertNumberFormat,
  evaluateActivationGate,
  generateAccountingPeriods,
  numberPeriodKey,
  parseApprovalTiers,
  roundMoney,
  openingBalancesBalanced,
  type SetupSectionKey,
  type SetupSectionStatusValue,
} from "@exceledge/accounting-domain";
import type {
  PeriodFrequency,
  Prisma,
  SetupSectionKey as PrismaSectionKey,
  SetupSectionStatusValue as PrismaSectionStatus,
} from "@prisma/client";
import { Prisma as PrismaNs } from "@prisma/client";
import { inTransaction, prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";
import { ensureDefaultAutomation } from "../books/books.service";
import { createAndPostJournal, openStartedPeriods } from "../journals/journal.service";

const DEFAULT_DOCUMENT_TYPES = [
  "CUSTOMER",
  "SUPPLIER",
  "SALES_INVOICE",
  "SALES_RECEIPT",
  "CREDIT_NOTE",
  "DEBIT_NOTE",
  "CUSTOMER_PAYMENT",
  "PURCHASE_ORDER",
  "GOODS_RECEIVED_NOTE",
  "SUPPLIER_BILL",
  "SUPPLIER_PAYMENT",
  "JOURNAL_ENTRY",
  "EXPENSE_CLAIM",
  "INVENTORY_ADJUSTMENT",
  "FIXED_ASSET",
  "DEPRECIATION_JOURNAL",
  "TAX_TRANSACTION",
];

async function setSectionStatus(
  companyId: string,
  sectionKey: SetupSectionKey,
  status: SetupSectionStatusValue,
  erpUserId?: number,
  lastError?: string | null,
) {
  return prisma.setupSectionStatus.upsert({
    where: { companyId_sectionKey: { companyId, sectionKey: sectionKey as PrismaSectionKey } },
    create: {
      companyId,
      sectionKey: sectionKey as PrismaSectionKey,
      status: status as PrismaSectionStatus,
      updatedByErpUserId: erpUserId,
      lastError: lastError ?? null,
    },
    update: {
      status: status as PrismaSectionStatus,
      updatedByErpUserId: erpUserId,
      lastError: lastError ?? null,
    },
  });
}

async function isActivated(companyId: string) {
  return (await prisma.accountingActivation.findUnique({ where: { companyId } }))?.status === "ACTIVATED";
}

/** Receivables, payables, inventory and current-year earnings only move through their own modules. */
export const NO_MANUAL_POSTING_CODES = new Set(["1200", "2100", "1300", "3200"]);

export async function ensureSystemChartOfAccounts(companyId: string) {
  const existing = await prisma.account.findMany({ where: { companyId } });
  // Renumber legacy system codes that sat outside Seg 3.7 type ranges (idempotent).
  const byCode = new Map(existing.map((a) => [a.code, a]));
  for (const { from, to, name } of SYSTEM_ACCOUNT_CODE_REMAP) {
    const row = byCode.get(from);
    if (!row || byCode.has(to)) continue;
    await prisma.account.update({ where: { id: row.id }, data: { code: to, name } });
    byCode.delete(from);
    byCode.set(to, { ...row, code: to, name });
  }
  const have = new Set(byCode.keys());
  const missing = SYSTEM_ACCOUNT_SEED.filter((a) => !have.has(a.code));
  if (missing.length > 0) {
    await prisma.account.createMany({
      data: missing.map((a) => ({
        companyId,
        code: a.code,
        name: a.name,
        type: a.type,
        systemProtected: a.systemProtected,
        allowManualPost: !NO_MANUAL_POSTING_CODES.has(a.code),
      })),
    });
  }
  return prisma.account.findMany({ where: { companyId } });
}

function accountIdByCode(accounts: Array<{ id: string; code: string }>, code: string) {
  return accounts.find((a) => a.code === code)?.id;
}

export async function ensureDefaultAccountMappings(companyId: string) {
  const accounts = await ensureSystemChartOfAccounts(companyId);
  const by = (code: string) => accountIdByCode(accounts, code);

  const existing = await prisma.defaultPostingAccounts.findUnique({ where: { companyId } });
  const faPatch = {
    fixedAssetCostId: existing?.fixedAssetCostId ?? by("1500"),
    accumulatedDepreciationId: existing?.accumulatedDepreciationId ?? by("1510"),
    depreciationExpenseId: existing?.depreciationExpenseId ?? by("6300"),
    assetDisposalId: existing?.assetDisposalId ?? by("1590") ?? by("7100"),
    gainOnDisposalId: existing?.gainOnDisposalId ?? by("7300") ?? by("7110"),
    lossOnDisposalId: existing?.lossOnDisposalId ?? by("8100") ?? by("7120"),
    assetRevaluationReserveId: existing?.assetRevaluationReserveId ?? by("3300"),
  };

  return prisma.defaultPostingAccounts.upsert({
    where: { companyId },
    create: {
      companyId,
      accountsReceivableId: by("1200"),
      salesRevenueId: by("4100"),
      serviceRevenueId: by("4110"),
      salesDiscountsId: by("4400") ?? by("6800"),
      salesReturnsId: by("4410") ?? by("6810"),
      customerDepositsId: by("2120"),
      badDebtExpenseId: by("6200"),
      accountsPayableId: by("2100"),
      purchasesId: by("5200"),
      supplierAdvancesId: by("2110"),
      defaultCashAccountId: by("1100"),
      defaultBankAccountId: by("1110"),
      pettyCashAccountId: by("1120"),
      mobileMoneyClearingId: by("1130"),
      undepositedFundsId: by("1140"),
      bankChargesId: by("6430") ?? by("2400"),
      interestIncomeId: by("4200"),
      inventoryAssetId: by("1300"),
      costOfSalesId: by("5100"),
      inventoryAdjustmentId: by("6400"),
      inventoryGainId: by("7200") ?? by("6900"),
      inventoryLossId: by("6420"),
      inventoryWriteOffId: by("6410"),
      grniId: by("2130"),
      goodsInTransitId: by("1600"),
      outputTaxPayableId: by("2200"),
      inputTaxReceivableId: by("1400"),
      withholdingTaxPayableId: by("2210"),
      payrollTaxPayableId: by("2300"),
      salariesWagesExpenseId: by("6100"),
      payrollPayableId: by("2320"),
      ...faPatch,
      retainedEarningsId: by("3100"),
      currentYearEarningsId: by("3200"),
      suspenseAccountId: by("1900") ?? by("6600"),
      roundingDifferenceId: by("6700"),
      fxGainId: by("4300"),
      fxLossId: by("6500"),
    },
    update: {
      ...faPatch,
      ...(existing?.payrollPayableId && existing.payrollPayableId === existing.payrollTaxPayableId ? { payrollPayableId: by("2320") } : {}),
    },
  });
}

export async function getSetupDashboard(companyId: string) {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    include: {
      sectionStatuses: true,
      activation: true,
      currencySettings: true,
      localization: true,
      financialYears: {
        where: { isCurrent: true },
        include: { periods: { where: { status: { in: ["OPEN", "REOPENED"] } }, orderBy: { startDate: "desc" }, take: 1 } },
        take: 1,
      },
      profile: true,
    },
  });

  const statuses = Object.fromEntries(
    company.sectionStatuses.map((s) => [s.sectionKey, s.status]),
  ) as Record<SetupSectionKey, SetupSectionStatusValue>;

  const counts = {
    total: SETUP_SECTIONS.length,
    completed: company.sectionStatuses.filter((s) =>
      ["COMPLETED", "APPROVED"].includes(s.status),
    ).length,
    inProgress: company.sectionStatuses.filter((s) => s.status === "IN_PROGRESS").length,
    pending: company.sectionStatuses.filter((s) => s.status === "NOT_STARTED").length,
    errors: company.sectionStatuses.filter((s) => s.status === "CONFIGURATION_ERROR").length,
    requiresReview: company.sectionStatuses.filter((s) => s.status === "REQUIRES_REVIEW").length,
  };

  const currentYear = company.financialYears[0];
  return {
    companyId: company.id,
    externalErpOrganizationId: company.externalErpOrganizationId,
    activationStatus: company.activation?.status ?? "NOT_ACTIVATED",
    activatedAt: company.activation?.activatedAt ?? null,
    counts,
    sections: SETUP_SECTIONS.map((key) => ({
      key,
      status: statuses[key] ?? "NOT_STARTED",
      lastError: company.sectionStatuses.find((s) => s.sectionKey === key)?.lastError ?? null,
    })),
    currentFinancialYear: currentYear
      ? { id: currentYear.id, name: currentYear.name, startDate: currentYear.startDate, endDate: currentYear.endDate }
      : null,
    currentOpenPeriod: currentYear?.periods[0]
      ? {
          id: currentYear.periods[0].id,
          name: currentYear.periods[0].name,
          startDate: currentYear.periods[0].startDate,
          endDate: currentYear.periods[0].endDate,
        }
      : null,
    functionalCurrency: company.currencySettings?.functionalCurrency ?? null,
    country: company.localization?.countryOfRegistration ?? company.profile?.country ?? null,
    localizationPackage: company.localization?.localizationPackage ?? null,
    lastUpdatedAt: company.updatedAt,
  };
}

export async function upsertCompanyProfile(
  companyId: string,
  data: Prisma.CompanyProfileUncheckedCreateInput,
  actor: { erpUserId: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } },
) {
  const before = await prisma.companyProfile.findUnique({ where: { companyId } });
  const { companyId: _c, ...rest } = data;
  const after = await prisma.companyProfile.upsert({
    where: { companyId },
    create: { ...rest, companyId },
    update: rest,
  });
  const complete = Boolean(after.registeredName && after.taxIdentificationNumber && after.country);
  await setSectionStatus(
    companyId,
    "COMPANY_PROFILE",
    complete ? "COMPLETED" : "IN_PROGRESS",
    actor.erpUserId,
  );
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: before ? "UPDATE" : "CREATE",
    entityType: "CompanyProfile",
    entityId: after.id,
    sectionKey: "COMPANY_PROFILE",
    beforeJson: before,
    afterJson: after,
    ...actor.meta,
  });
  return after;
}

export async function upsertBusinessInfo(
  companyId: string,
  data: Omit<Prisma.BusinessAccountingInfoUncheckedCreateInput, "companyId">,
  actor: { erpUserId: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } },
) {
  const before = await prisma.businessAccountingInfo.findUnique({ where: { companyId } });
  const after = await prisma.businessAccountingInfo.upsert({
    where: { companyId },
    create: { ...data, companyId },
    update: data,
  });
  const complete = Boolean(after.accountingBasis && after.reportingFramework);
  await setSectionStatus(
    companyId,
    "BUSINESS_ACCOUNTING_INFO",
    complete ? "COMPLETED" : "IN_PROGRESS",
    actor.erpUserId,
  );
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: before ? "UPDATE" : "CREATE",
    entityType: "BusinessAccountingInfo",
    entityId: after.id,
    sectionKey: "BUSINESS_ACCOUNTING_INFO",
    beforeJson: before,
    afterJson: after,
    ...actor.meta,
  });
  return after;
}

export async function createFinancialYearWithPeriods(
  companyId: string,
  input: {
    name: string;
    startDate: string;
    endDate: string;
    periodFrequency: PeriodFrequency;
    closingPolicy?: string;
    isCurrent?: boolean;
  },
  actor: { erpUserId: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } },
) {
  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);
  const overlapping = await prisma.financialYear.findMany({ where: { companyId } });
  for (const fy of overlapping) {
    if (startDate <= fy.endDate && fy.startDate <= endDate) {
      throw new Error("Financial years must not overlap");
    }
  }

  const generated = generateAccountingPeriods({
    yearStart: startDate,
    yearEnd: endDate,
    frequency: input.periodFrequency,
  });

  if (input.isCurrent !== false) {
    await prisma.financialYear.updateMany({
      where: { companyId },
      data: { isCurrent: false },
    });
  }

  const year = await prisma.financialYear.create({
    data: {
      companyId,
      name: input.name,
      startDate,
      endDate,
      periodFrequency: input.periodFrequency,
      closingPolicy: input.closingPolicy,
      isCurrent: input.isCurrent !== false,
      periods: {
        create: generated.map((p) => ({
          name: p.name,
          sequence: p.sequence,
          startDate: p.startDate,
          endDate: p.endDate,
          status: p.status,
        })),
      },
    },
    include: { periods: { orderBy: { sequence: "asc" } } },
  });
  if (await openStartedPeriods(companyId)) {
    year.periods = await prisma.accountingPeriod.findMany({ where: { financialYearId: year.id }, orderBy: { sequence: "asc" } });
  }

  await setSectionStatus(companyId, "FINANCIAL_YEAR_PERIODS", "REQUIRES_REVIEW", actor.erpUserId);
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: "CREATE",
    entityType: "FinancialYear",
    entityId: year.id,
    sectionKey: "FINANCIAL_YEAR_PERIODS",
    afterJson: year,
    ...actor.meta,
  });
  return year;
}

export async function upsertCurrency(
  companyId: string,
  data: Omit<Prisma.CurrencySettingsUncheckedCreateInput, "companyId">,
  actor: { erpUserId: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } },
) {
  if (!data.functionalCurrency) throw new Error("Functional currency is mandatory");
  const before = await prisma.currencySettings.findUnique({ where: { companyId } });
  if (before && before.functionalCurrency !== data.functionalCurrency && (await isActivated(companyId))) {
    throw new Error("The functional currency cannot change after accounting is activated");
  }
  const after = await prisma.currencySettings.upsert({
    where: { companyId },
    create: { ...data, companyId },
    update: data,
  });
  await setSectionStatus(companyId, "CURRENCY", "REQUIRES_REVIEW", actor.erpUserId);
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: before ? "UPDATE" : "CREATE",
    entityType: "CurrencySettings",
    entityId: after.id,
    sectionKey: "CURRENCY",
    beforeJson: before,
    afterJson: after,
    ...actor.meta,
  });
  return after;
}

export async function upsertPolicies(
  companyId: string,
  data: Omit<Prisma.AccountingPolicyUncheckedCreateInput, "companyId">,
  actor: { erpUserId: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } },
) {
  const before = await prisma.accountingPolicy.findUnique({ where: { companyId } });
  if (
    data.inventoryValuationMethod &&
    before?.inventoryValuationMethod &&
    data.inventoryValuationMethod !== before.inventoryValuationMethod &&
    (await isActivated(companyId))
  ) {
    throw new Error("The inventory valuation method cannot change after accounting is activated");
  }
  const after = await prisma.accountingPolicy.upsert({
    where: { companyId },
    create: { ...data, companyId },
    update: data,
  });
  await setSectionStatus(companyId, "ACCOUNTING_POLICIES", "REQUIRES_REVIEW", actor.erpUserId);
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: before ? "UPDATE" : "CREATE",
    entityType: "AccountingPolicy",
    entityId: after.id,
    sectionKey: "ACCOUNTING_POLICIES",
    beforeJson: before,
    afterJson: after,
    ...actor.meta,
  });
  return after;
}

export async function upsertLocalization(
  companyId: string,
  data: Omit<Prisma.LocalizationSettingsUncheckedCreateInput, "companyId">,
  actor: { erpUserId: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } },
) {
  if (!data.countryOfRegistration || !data.localizationPackage) {
    throw new Error("Country and localization package are required");
  }
  const before = await prisma.localizationSettings.findUnique({ where: { companyId } });
  const after = await prisma.localizationSettings.upsert({
    where: { companyId },
    create: { ...data, companyId },
    update: data,
  });
  await setSectionStatus(companyId, "LOCALIZATION", "COMPLETED", actor.erpUserId);
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: before ? "UPDATE" : "CREATE",
    entityType: "LocalizationSettings",
    entityId: after.id,
    sectionKey: "LOCALIZATION",
    beforeJson: before,
    afterJson: after,
    ...actor.meta,
  });
  return after;
}

export async function completeDefaultAccounts(
  companyId: string,
  actor: { erpUserId: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } },
) {
  const defaults = await ensureDefaultAccountMappings(companyId);
  const mapped = MANDATORY_DEFAULT_ACCOUNT_KEYS.every((key) => Boolean((defaults as Record<string, unknown>)[key]));
  await setSectionStatus(
    companyId,
    "DEFAULT_POSTING_ACCOUNTS",
    mapped ? "COMPLETED" : "CONFIGURATION_ERROR",
    actor.erpUserId,
    mapped ? null : "Mandatory default posting accounts missing",
  );
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: "UPDATE",
    entityType: "DefaultPostingAccounts",
    entityId: defaults.id,
    sectionKey: "DEFAULT_POSTING_ACCOUNTS",
    afterJson: defaults,
    ...actor.meta,
  });
  return defaults;
}

export async function upsertInventorySettings(
  companyId: string,
  data: Omit<Prisma.InventoryAccountingSettingsUncheckedCreateInput, "companyId">,
  actor: { erpUserId: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } },
) {
  await ensureDefaultAccountMappings(companyId);
  const defaults = await prisma.defaultPostingAccounts.findUniqueOrThrow({ where: { companyId } });
  const payload = {
    valuationMethod: data.valuationMethod,
    automaticCogsPosting: data.automaticCogsPosting ?? true,
    negativeInventoryPolicy: data.negativeInventoryPolicy ?? "PREVENT",
    adjustmentRequiresApproval: data.adjustmentRequiresApproval ?? true,
    stockCountRequiresApproval: data.stockCountRequiresApproval ?? true,
    inventoryAssetAccountId: data.inventoryAssetAccountId ?? defaults.inventoryAssetId,
    costOfSalesAccountId: data.costOfSalesAccountId ?? defaults.costOfSalesId,
    adjustmentAccountId: data.adjustmentAccountId ?? defaults.inventoryAdjustmentId,
    writeOffAccountId: data.writeOffAccountId ?? defaults.inventoryWriteOffId,
    gainAccountId: data.gainAccountId ?? defaults.inventoryGainId,
    lossAccountId: data.lossAccountId ?? defaults.inventoryLossId,
    grniAccountId: data.grniAccountId ?? defaults.grniId,
    goodsInTransitAccountId: data.goodsInTransitAccountId ?? defaults.goodsInTransitId,
  };
  const before = await prisma.inventoryAccountingSettings.findUnique({ where: { companyId } });
  if (payload.valuationMethod && before?.valuationMethod && payload.valuationMethod !== before.valuationMethod && (await isActivated(companyId))) {
    throw new Error("The inventory valuation method cannot change after accounting is activated");
  }
  const after = await prisma.inventoryAccountingSettings.upsert({
    where: { companyId },
    create: { ...payload, companyId },
    update: payload,
  });
  await setSectionStatus(companyId, "INVENTORY_SETTINGS", "COMPLETED", actor.erpUserId);
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: before ? "UPDATE" : "CREATE",
    entityType: "InventoryAccountingSettings",
    entityId: after.id,
    sectionKey: "INVENTORY_SETTINGS",
    beforeJson: before,
    afterJson: after,
    ...actor.meta,
  });
  return after;
}

export async function upsertPartyDefaults(
  companyId: string,
  data: Omit<Prisma.PartyDefaultsUncheckedCreateInput, "companyId">,
  actor: { erpUserId: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } },
) {
  await ensureDefaultAccountMappings(companyId);
  const defaults = await prisma.defaultPostingAccounts.findUniqueOrThrow({ where: { companyId } });
  const payload = {
    ...data,
    defaultArAccountId: data.defaultArAccountId ?? defaults.accountsReceivableId,
    defaultApAccountId: data.defaultApAccountId ?? defaults.accountsPayableId,
  };
  const before = await prisma.partyDefaults.findUnique({ where: { companyId } });
  const after = await prisma.partyDefaults.upsert({
    where: { companyId },
    create: { ...payload, companyId },
    update: payload,
  });
  await setSectionStatus(companyId, "PARTY_DEFAULTS", "COMPLETED", actor.erpUserId);
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: before ? "UPDATE" : "CREATE",
    entityType: "PartyDefaults",
    entityId: after.id,
    sectionKey: "PARTY_DEFAULTS",
    beforeJson: before,
    afterJson: after,
    ...actor.meta,
  });
  return after;
}

export async function upsertBankingSettings(
  companyId: string,
  data: Omit<Prisma.BankingPaymentSettingsUncheckedCreateInput, "companyId">,
  actor: { erpUserId: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } },
) {
  await ensureDefaultAccountMappings(companyId);
  const defaults = await prisma.defaultPostingAccounts.findUniqueOrThrow({ where: { companyId } });
  const payload = {
    ...data,
    defaultCashAccountId: data.defaultCashAccountId ?? defaults.defaultCashAccountId,
    defaultBankAccountId: data.defaultBankAccountId ?? defaults.defaultBankAccountId,
    pettyCashAccountId: data.pettyCashAccountId ?? defaults.pettyCashAccountId,
    mobileMoneyAccountId: data.mobileMoneyAccountId ?? defaults.mobileMoneyClearingId,
    undepositedFundsAccountId: data.undepositedFundsAccountId ?? defaults.undepositedFundsId,
    bankChargesAccountId: data.bankChargesAccountId ?? defaults.bankChargesId,
    interestIncomeAccountId: data.interestIncomeAccountId ?? defaults.interestIncomeId,
  };
  const before = await prisma.bankingPaymentSettings.findUnique({ where: { companyId } });
  const after = await prisma.bankingPaymentSettings.upsert({
    where: { companyId },
    create: { ...payload, companyId },
    update: payload,
  });
  await setSectionStatus(companyId, "BANKING_PAYMENT", "COMPLETED", actor.erpUserId);
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: before ? "UPDATE" : "CREATE",
    entityType: "BankingPaymentSettings",
    entityId: after.id,
    sectionKey: "BANKING_PAYMENT",
    beforeJson: before,
    afterJson: after,
    ...actor.meta,
  });
  return after;
}

export async function ensureNumberSequences(
  companyId: string,
  actor: { erpUserId: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } },
) {
  for (const documentType of DEFAULT_DOCUMENT_TYPES) {
    await prisma.numberSequence.upsert({
      where: { companyId_documentType: { companyId, documentType } },
      create: {
        companyId,
        documentType,
        prefix: documentType.slice(0, 3),
        includeYear: true,
        sequenceLength: 6,
        startingNumber: 1,
        nextNumber: 1,
      },
      update: {},
    });
  }
  const sequences = await prisma.numberSequence.findMany({ where: { companyId } });
  await setSectionStatus(companyId, "TRANSACTION_NUMBERING", "COMPLETED", actor.erpUserId);
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: "UPDATE",
    entityType: "NumberSequence",
    sectionKey: "TRANSACTION_NUMBERING",
    afterJson: { count: sequences.length },
    ...actor.meta,
  });
  return sequences;
}

export async function upsertApprovalControls(
  companyId: string,
  data: Omit<Prisma.ApprovalPostingControlsUncheckedCreateInput, "companyId">,
  actor: { erpUserId: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } },
) {
  if (data.amountBasedApprovalLimits === null) {
    data = { ...data, amountBasedApprovalLimits: PrismaNs.DbNull };
  } else if (data.amountBasedApprovalLimits !== undefined) {
    data = { ...data, amountBasedApprovalLimits: parseApprovalTiers(data.amountBasedApprovalLimits) as unknown as Prisma.InputJsonValue };
  }
  if (data.approvalLevels !== undefined && (data.approvalLevels < 0 || data.approvalLevels > MAX_APPROVAL_LEVELS)) {
    throw new Error(`Approval levels must be between 0 and ${MAX_APPROVAL_LEVELS}`);
  }
  for (const key of ["backdatedTransactionPolicy", "futureDatedTransactionPolicy"] as const) {
    const value = data[key];
    if (value !== undefined && value !== null && !["ALLOW", "REQUIRE_APPROVAL", "BLOCK"].includes(value)) {
      throw new Error(`${key} must be ALLOW, REQUIRE_APPROVAL or BLOCK`);
    }
  }
  const before = await prisma.approvalPostingControls.findUnique({ where: { companyId } });
  const after = await prisma.approvalPostingControls.upsert({
    where: { companyId },
    create: { ...data, companyId },
    update: data,
  });
  await setSectionStatus(companyId, "APPROVAL_POSTING_CONTROLS", "COMPLETED", actor.erpUserId);
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: before ? "UPDATE" : "CREATE",
    entityType: "ApprovalPostingControls",
    entityId: after.id,
    sectionKey: "APPROVAL_POSTING_CONTROLS",
    beforeJson: before,
    afterJson: after,
    ...actor.meta,
  });
  return after;
}

export async function saveOpeningBalances(
  companyId: string,
  input: {
    name: string;
    lines: Array<{
      accountId?: string;
      memo?: string;
      debit: number;
      credit: number;
      partyType?: "CUSTOMER" | "SUPPLIER";
      partyRef?: string;
    }>;
  },
  actor: { erpUserId: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } },
) {
  for (const l of input.lines) {
    if (l.partyType && !l.partyRef) throw new Error("A customer or supplier opening balance needs the party");
  }
  if (!openingBalancesBalanced(input.lines)) {
    await setSectionStatus(
      companyId,
      "OPENING_BALANCES",
      "CONFIGURATION_ERROR",
      actor.erpUserId,
      "Total opening debits must equal total opening credits",
    );
    throw new Error("Total opening debits must equal total opening credits");
  }

  const batch = await prisma.openingBalanceBatch.create({
    data: {
      companyId,
      name: input.name,
      status: "REQUIRES_REVIEW",
      createdByErpUserId: actor.erpUserId,
      lines: {
        create: input.lines.map((l) => ({
          accountId: l.accountId,
          partyType: l.partyType,
          partyRef: l.partyRef,
          memo: l.memo,
          debit: l.debit,
          credit: l.credit,
        })),
      },
    },
    include: { lines: true },
  });

  await setSectionStatus(companyId, "OPENING_BALANCES", "REQUIRES_REVIEW", actor.erpUserId);
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: "CREATE",
    entityType: "OpeningBalanceBatch",
    entityId: batch.id,
    sectionKey: "OPENING_BALANCES",
    afterJson: batch,
    ...actor.meta,
  });
  return batch;
}

type SetupActor = { erpUserId: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } };

export async function listOpeningBalances(companyId: string) {
  return prisma.openingBalanceBatch.findMany({
    where: { companyId },
    include: { lines: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function approveOpeningBalances(companyId: string, id: string, actor: SetupActor) {
  const batch = await prisma.openingBalanceBatch.findFirst({ where: { id, companyId } });
  if (!batch) throw new Error("Opening balance batch not found");
  if (batch.status !== "REQUIRES_REVIEW") throw new Error(`Opening balances are ${batch.status.toLowerCase()}, not awaiting review`);
  if (batch.createdByErpUserId != null && batch.createdByErpUserId === actor.erpUserId) {
    throw new Error("You entered these opening balances; someone else must approve them");
  }
  const claimed = await prisma.openingBalanceBatch.updateMany({
    where: { id, companyId, status: "REQUIRES_REVIEW" },
    data: { status: "APPROVED", approvedByErpUserId: actor.erpUserId, approvedAt: new Date() },
  });
  if (claimed.count !== 1) throw new Error("Opening balances changed while approving; reload and try again");
  const after = await prisma.openingBalanceBatch.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: "APPROVE",
    entityType: "OpeningBalanceBatch",
    entityId: id,
    sectionKey: "OPENING_BALANCES",
    beforeJson: batch,
    afterJson: after,
    ...actor.meta,
  });
  return after;
}

/**
 * Posts an approved batch as one OPENING_BALANCE journal on the first day of the earliest financial
 * year. Customer and supplier lines must sit on the AR/AP control account and also open the party's
 * subledger, so the control account and the subledger agree from day one.
 */
export async function postOpeningBalances(companyId: string, id: string, actor: SetupActor) {
  const batch = await prisma.openingBalanceBatch.findFirst({ where: { id, companyId }, include: { lines: true } });
  if (!batch) throw new Error("Opening balance batch not found");
  if (batch.status !== "APPROVED") throw new Error("Opening balances must be approved before posting");
  const year = await prisma.financialYear.findFirst({ where: { companyId }, orderBy: { startDate: "asc" } });
  if (!year) throw new Error("Create a financial year before posting opening balances");
  const defaults = await prisma.defaultPostingAccounts.findUnique({ where: { companyId } });

  const lines: Array<{ accountId: string; description: string; debit: number; credit: number; customerRef?: string; supplierRef?: string }> = [];
  const parties: Array<{ kind: "CUSTOMER" | "SUPPLIER"; partyId: string; debit: number; credit: number; memo?: string | null }> = [];
  for (const l of batch.lines) {
    const debit = Number(l.debit);
    const credit = Number(l.credit);
    let accountId = l.accountId ?? undefined;
    let customerRef: string | undefined;
    let supplierRef: string | undefined;
    if (l.partyType === "CUSTOMER" || l.partyType === "SUPPLIER") {
      const control = l.partyType === "CUSTOMER" ? defaults?.accountsReceivableId : defaults?.accountsPayableId;
      if (!control) throw new Error(`Map the ${l.partyType === "CUSTOMER" ? "receivables" : "payables"} control account first`);
      if (accountId && accountId !== control) throw new Error("Customer and supplier opening balances must use the AR/AP control account");
      accountId = control;
      const party =
        l.partyType === "CUSTOMER"
          ? await prisma.customer.findFirst({ where: { companyId, OR: [{ id: l.partyRef ?? "" }, { code: l.partyRef ?? "" }] } })
          : await prisma.supplier.findFirst({ where: { companyId, OR: [{ id: l.partyRef ?? "" }, { code: l.partyRef ?? "" }] } });
      if (!party) throw new Error(`${l.partyType === "CUSTOMER" ? "Customer" : "Supplier"} ${l.partyRef} not found`);
      if (l.partyType === "CUSTOMER") customerRef = party.id;
      else supplierRef = party.id;
      parties.push({ kind: l.partyType, partyId: party.id, debit, credit, memo: l.memo });
    } else if (accountId && (accountId === defaults?.accountsReceivableId || accountId === defaults?.accountsPayableId)) {
      throw new Error("Receivable and payable opening balances need the customer or supplier on the line");
    }
    if (!accountId) throw new Error("Every opening balance line needs an account");
    lines.push({ accountId, description: l.memo ?? batch.name, debit, credit, customerRef, supplierRef });
  }

  return inTransaction(async () => {
    const claimed = await prisma.openingBalanceBatch.updateMany({
      where: { id, companyId, status: "APPROVED" },
      data: { status: "POSTED", postedAt: new Date() },
    });
    if (claimed.count !== 1) throw new Error("Opening balances were already posted");
    const journal = await createAndPostJournal(
      companyId,
      {
        journalDate: year.startDate,
        journalType: "OPENING_BALANCE",
        sourceModule: "OPENING_BALANCE",
        sourceDocumentType: "OpeningBalanceBatch",
        sourceDocumentId: batch.id,
        description: `Opening balances: ${batch.name}`,
        lines,
      },
      actor,
    );
    for (const p of parties) {
      if (p.kind === "CUSTOMER") {
        const c = await prisma.customer.findUniqueOrThrow({ where: { id: p.partyId } });
        const next = roundMoney(Number(c.balance) + p.debit - p.credit);
        await prisma.customer.update({ where: { id: c.id }, data: { balance: next } });
        await prisma.arLedgerEntry.create({
          data: {
            companyId, customerId: c.id, entryDate: year.startDate, docType: "OPENING_BALANCE", docId: batch.id,
            docNumber: journal.journalNumber, description: p.memo ?? batch.name, debit: p.debit, credit: p.credit, runningBalance: next,
          },
        });
      } else {
        const s = await prisma.supplier.findUniqueOrThrow({ where: { id: p.partyId } });
        const next = roundMoney(Number(s.balance) + p.credit - p.debit);
        await prisma.supplier.update({ where: { id: s.id }, data: { balance: next } });
        await prisma.apLedgerEntry.create({
          data: {
            companyId, supplierId: s.id, entryDate: year.startDate, docType: "OPENING_BALANCE", docId: batch.id,
            docNumber: journal.journalNumber, description: p.memo ?? batch.name, debit: p.debit, credit: p.credit, runningBalance: next,
          },
        });
      }
    }
    const after = await prisma.openingBalanceBatch.update({ where: { id }, data: { journalId: journal.id }, include: { lines: true } });
    await setSectionStatus(companyId, "OPENING_BALANCES", "COMPLETED", actor.erpUserId);
    await writeAudit({
      companyId,
      erpUserId: actor.erpUserId,
      erpRole: actor.erpRole,
      action: "POST",
      entityType: "OpeningBalanceBatch",
      entityId: id,
      sectionKey: "OPENING_BALANCES",
      beforeJson: batch,
      afterJson: after,
      ...actor.meta,
    });
    return { batch: after, journal };
  });
}

/** Partial remap of default posting accounts; every account must belong to the company and be active. */
export async function updateDefaultAccounts(companyId: string, changes: Record<string, string | null>, actor: SetupActor) {
  const known = new Set<string>(Object.values(PrismaNs.DefaultPostingAccountsScalarFieldEnum));
  const data: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (!key.endsWith("Id") || key === "companyId" || !known.has(key)) throw new Error(`Unknown default account ${key}`);
    data[key] = value;
  }
  const ids = Object.values(data).filter((v): v is string => Boolean(v));
  if (ids.length) {
    const found = await prisma.account.findMany({ where: { companyId, id: { in: ids }, isActive: true } });
    if (found.length !== new Set(ids).size) throw new Error("Every default account must be an active account of this company");
  }
  const mandatory = new Set<string>(MANDATORY_DEFAULT_ACCOUNT_KEYS);
  for (const [key, value] of Object.entries(data)) {
    if (!value && mandatory.has(key)) throw new Error(`${key} is mandatory and cannot be cleared`);
  }
  await ensureDefaultAccountMappings(companyId);
  const before = await prisma.defaultPostingAccounts.findUniqueOrThrow({ where: { companyId } });
  const after = await prisma.defaultPostingAccounts.update({ where: { companyId }, data });
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: "UPDATE",
    entityType: "DefaultPostingAccounts",
    entityId: after.id,
    sectionKey: "DEFAULT_POSTING_ACCOUNTS",
    beforeJson: before,
    afterJson: after,
    ...actor.meta,
  });
  return after;
}

/** `nextNumber` is the number the current period's counter will issue next (see lib/numbering). */
export async function listNumberSequences(companyId: string) {
  const sequences = await prisma.numberSequence.findMany({
    where: { companyId },
    orderBy: { documentType: "asc" },
    include: { counters: true },
  });
  const now = new Date();
  return sequences.map(({ counters, ...seq }) => {
    const periodKey = numberPeriodKey(seq.resetFrequency, now);
    const counter = counters.find((c) => c.periodKey === periodKey);
    return { ...seq, nextNumber: counter?.nextNumber ?? Math.max(seq.startingNumber, seq.legacyFloor, 1) };
  });
}

export async function updateNumberSequence(
  companyId: string,
  documentType: string,
  input: Partial<{ prefix: string; includeYear: boolean; includeMonth: boolean; includeBranch: boolean; sequenceLength: number; resetFrequency: string; startingNumber: number }>,
  actor: SetupActor,
) {
  const before = await prisma.numberSequence.findUnique({ where: { companyId_documentType: { companyId, documentType } } });
  if (!before) throw new Error(`No numbering sequence for ${documentType}`);
  const format = {
    prefix: input.prefix ?? before.prefix ?? documentType.slice(0, 3),
    includeYear: input.includeYear ?? before.includeYear,
    includeMonth: input.includeMonth ?? before.includeMonth,
    includeBranch: input.includeBranch ?? before.includeBranch,
    sequenceLength: input.sequenceLength ?? before.sequenceLength,
    resetFrequency: (input.resetFrequency ?? before.resetFrequency).toUpperCase(),
  };
  assertNumberFormat(format);
  if (input.startingNumber !== undefined && (!Number.isInteger(input.startingNumber) || input.startingNumber < 1)) {
    throw new Error("The starting number must be a whole number of 1 or more");
  }
  const after = await prisma.numberSequence.update({
    where: { id: before.id },
    data: { ...format, ...(input.startingNumber !== undefined ? { startingNumber: input.startingNumber } : {}) },
  });
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: "UPDATE",
    entityType: "NumberSequence",
    entityId: after.id,
    sectionKey: "TRANSACTION_NUMBERING",
    beforeJson: before,
    afterJson: after,
    ...actor.meta,
  });
  return after;
}

export async function updateFinancialYear(companyId: string, id: string, input: { name?: string; isCurrent?: boolean }, actor: SetupActor) {
  const before = await prisma.financialYear.findFirst({ where: { id, companyId } });
  if (!before) throw new Error("Financial year not found");
  if (input.name !== undefined && !input.name.trim()) throw new Error("A financial year needs a name");
  const after = await inTransaction(async () => {
    if (input.isCurrent) await prisma.financialYear.updateMany({ where: { companyId, NOT: { id } }, data: { isCurrent: false } });
    return prisma.financialYear.update({
      where: { id },
      data: { name: input.name?.trim(), isCurrent: input.isCurrent },
    });
  });
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: "UPDATE",
    entityType: "FinancialYear",
    entityId: id,
    sectionKey: "FINANCIAL_YEAR_PERIODS",
    beforeJson: before,
    afterJson: after,
    ...actor.meta,
  });
  return after;
}

export async function approveSection(
  companyId: string,
  sectionKey: SetupSectionKey,
  actor: { erpUserId: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } },
) {
  const current = await prisma.setupSectionStatus.findUnique({
    where: { companyId_sectionKey: { companyId, sectionKey: sectionKey as PrismaSectionKey } },
  });
  if (!current || !["REQUIRES_REVIEW", "COMPLETED", "IN_PROGRESS"].includes(current.status)) {
    throw new Error("Section is not approvable in its current status");
  }
  const after = await setSectionStatus(companyId, sectionKey, "APPROVED", actor.erpUserId);
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: "APPROVE",
    entityType: "SetupSectionStatus",
    entityId: after.id,
    sectionKey,
    beforeJson: current,
    afterJson: after,
    ...actor.meta,
  });
  return after;
}

export async function evaluateAndPersistActivation(companyId: string) {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    include: {
      sectionStatuses: true,
      currencySettings: true,
      localization: true,
      defaultAccounts: true,
      approvalControls: true,
      numberSequences: true,
      financialYears: { include: { periods: true } },
      accounts: { take: 1 },
      activation: true,
    },
  });

  const sectionStatuses = Object.fromEntries(
    company.sectionStatuses.map((s) => [s.sectionKey, s.status]),
  ) as Record<SetupSectionKey, SetupSectionStatusValue>;

  const hasOpenPeriod = company.financialYears.some((y) =>
    y.periods.some((p) => p.status === "OPEN"),
  );
  const defaults = company.defaultAccounts;
  const mandatoryDefaultAccountsMapped = Boolean(
    defaults &&
      MANDATORY_DEFAULT_ACCOUNT_KEYS.every((k) => Boolean((defaults as Record<string, unknown>)[k])),
  );

  const gate = evaluateActivationGate({
    sectionStatuses,
    hasOpenPeriod,
    hasFinancialYear: company.financialYears.length > 0,
    hasFunctionalCurrency: Boolean(company.currencySettings?.functionalCurrency),
    hasChartOfAccounts: company.accounts.length > 0,
    mandatoryDefaultAccountsMapped,
    localizationComplete: Boolean(
      company.localization?.countryOfRegistration && company.localization?.localizationPackage,
    ),
    numberingConfigured: company.numberSequences.length > 0,
    approvalControlsDefined: Boolean(company.approvalControls),
    hasCriticalErrors: company.sectionStatuses.some((s) => s.status === "CONFIGURATION_ERROR"),
  });

  const activation = await prisma.accountingActivation.upsert({
    where: { companyId },
    create: {
      companyId,
      status: gate.status,
      lastValidationJson: gate as object,
    },
    update: {
      status: company.activation?.status === "ACTIVATED" ? "ACTIVATED" : gate.status,
      lastValidationJson: gate as object,
    },
  });

  await setSectionStatus(
    companyId,
    "REVIEW_ACTIVATION",
    gate.canActivate ? "COMPLETED" : "IN_PROGRESS",
  );

  return { gate, activation };
}

export async function activateAccounting(
  companyId: string,
  actor: { erpUserId: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } },
) {
  const { gate, activation } = await evaluateAndPersistActivation(companyId);
  if (!gate.canActivate) {
    throw new Error(`Cannot activate: ${gate.missing.join(", ") || gate.errors.join(", ")}`);
  }
  if (activation.status === "ACTIVATED") {
    return activation;
  }

  const updated = await prisma.accountingActivation.update({
    where: { companyId },
    data: {
      status: "ACTIVATED",
      activatedAt: new Date(),
      activatedByErpUserId: actor.erpUserId,
      lastValidationJson: gate as object,
    },
  });
  await openStartedPeriods(companyId);
  await ensureDefaultAutomation(companyId);

  await setSectionStatus(companyId, "REVIEW_ACTIVATION", "APPROVED", actor.erpUserId);
  await writeAudit({
    companyId,
    erpUserId: actor.erpUserId,
    erpRole: actor.erpRole,
    action: "ACTIVATE",
    entityType: "AccountingActivation",
    entityId: updated.id,
    sectionKey: "REVIEW_ACTIVATION",
    afterJson: updated,
    ...actor.meta,
  });
  return updated;
}

export async function getSectionSnapshot(companyId: string) {
  const [
    profile,
    businessInfo,
    years,
    currency,
    policies,
    localization,
    defaults,
    inventory,
    parties,
    banking,
    sequences,
    approvals,
    opening,
    accounts,
  ] = await Promise.all([
    prisma.companyProfile.findUnique({ where: { companyId } }),
    prisma.businessAccountingInfo.findUnique({ where: { companyId } }),
    prisma.financialYear.findMany({
      where: { companyId },
      include: { periods: { orderBy: { sequence: "asc" } } },
      orderBy: { startDate: "asc" },
    }),
    prisma.currencySettings.findUnique({ where: { companyId } }),
    prisma.accountingPolicy.findUnique({ where: { companyId } }),
    prisma.localizationSettings.findUnique({ where: { companyId } }),
    prisma.defaultPostingAccounts.findUnique({ where: { companyId } }),
    prisma.inventoryAccountingSettings.findUnique({ where: { companyId } }),
    prisma.partyDefaults.findUnique({ where: { companyId } }),
    prisma.bankingPaymentSettings.findUnique({ where: { companyId } }),
    prisma.numberSequence.findMany({ where: { companyId } }),
    prisma.approvalPostingControls.findUnique({ where: { companyId } }),
    prisma.openingBalanceBatch.findMany({
      where: { companyId },
      include: { lines: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.account.findMany({ where: { companyId }, orderBy: { code: "asc" } }),
  ]);

  return {
    profile,
    businessInfo,
    years,
    currency,
    policies,
    localization,
    defaults,
    inventory,
    parties,
    banking,
    sequences,
    approvals,
    opening,
    accounts,
  };
}
