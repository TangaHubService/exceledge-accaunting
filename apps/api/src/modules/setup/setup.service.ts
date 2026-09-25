import {
  MANDATORY_DEFAULT_ACCOUNT_KEYS,
  SETUP_SECTIONS,
  SYSTEM_ACCOUNT_SEED,
  evaluateActivationGate,
  generateAccountingPeriods,
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
import { prisma } from "../../lib/prisma";
import { writeAudit } from "../audit/audit.service";

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

export async function ensureSystemChartOfAccounts(companyId: string) {
  const existing = await prisma.account.findMany({ where: { companyId } });
  const have = new Set(existing.map((a) => a.code));
  const missing = SYSTEM_ACCOUNT_SEED.filter((a) => !have.has(a.code));
  if (missing.length > 0) {
    await prisma.account.createMany({
      data: missing.map((a) => ({
        companyId,
        code: a.code,
        name: a.name,
        type: a.type,
        systemProtected: a.systemProtected,
        allowManualPost: !a.systemProtected,
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
    assetDisposalId: existing?.assetDisposalId ?? by("7100"),
    gainOnDisposalId: existing?.gainOnDisposalId ?? by("7110"),
    lossOnDisposalId: existing?.lossOnDisposalId ?? by("7120"),
    assetRevaluationReserveId: existing?.assetRevaluationReserveId ?? by("3300"),
  };

  return prisma.defaultPostingAccounts.upsert({
    where: { companyId },
    create: {
      companyId,
      accountsReceivableId: by("1200"),
      salesRevenueId: by("4100"),
      serviceRevenueId: by("4110"),
      salesDiscountsId: by("6800"),
      salesReturnsId: by("6810"),
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
      bankChargesId: by("2400"),
      interestIncomeId: by("4200"),
      inventoryAssetId: by("1300"),
      costOfSalesId: by("5100"),
      inventoryAdjustmentId: by("6400"),
      inventoryGainId: by("6900"),
      inventoryLossId: by("6420"),
      inventoryWriteOffId: by("6410"),
      grniId: by("2130"),
      goodsInTransitId: by("1600"),
      outputTaxPayableId: by("2200"),
      inputTaxReceivableId: by("1400"),
      withholdingTaxPayableId: by("2210"),
      payrollTaxPayableId: by("2300"),
      salariesWagesExpenseId: by("6100"),
      payrollPayableId: by("2300"),
      ...faPatch,
      retainedEarningsId: by("3100"),
      currentYearEarningsId: by("3200"),
      suspenseAccountId: by("6600"),
      roundingDifferenceId: by("6700"),
      fxGainId: by("4300"),
      fxLossId: by("6500"),
    },
    update: faPatch,
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
        include: { periods: { where: { status: "OPEN" }, take: 1 } },
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
    lines: Array<{ accountId?: string; memo?: string; debit: number; credit: number }>;
  },
  actor: { erpUserId: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } },
) {
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
      lines: {
        create: input.lines.map((l) => ({
          accountId: l.accountId,
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
