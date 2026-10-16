import { Router } from "express";
import { z } from "zod";
import type { SetupSectionKey } from "@exceledge/accounting-domain";
import {
  AuthedRequest,
  authenticateErpJwt,
  getRequestMeta,
  requireCapability,
  resolveCompany,
} from "../../middleware/auth";
import * as setup from "./setup.service";

export const setupRouter = Router();

setupRouter.use(authenticateErpJwt, requireCapability("setup:view"), resolveCompany);

function actor(req: AuthedRequest) {
  return {
    erpUserId: req.erpUser!.userId,
    erpRole: req.organizationRole ?? req.erpUser!.role,
    meta: getRequestMeta(req),
  };
}

setupRouter.get("/dashboard", async (req: AuthedRequest, res) => {
  const data = await setup.getSetupDashboard(req.companyId!);
  res.json({ success: true, data });
});

setupRouter.get("/snapshot", async (req: AuthedRequest, res) => {
  const data = await setup.getSectionSnapshot(req.companyId!);
  res.json({ success: true, data });
});

setupRouter.put("/profile", requireCapability("setup:prepare"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        registeredName: z.string().min(1).optional(),
        tradingName: z.string().optional(),
        registrationNumber: z.string().optional(),
        taxIdentificationNumber: z.string().optional(),
        businessEmail: z.string().email().optional().or(z.literal("")),
        telephone: z.string().optional(),
        website: z.string().optional(),
        registeredAddress: z.string().optional(),
        operatingAddress: z.string().optional(),
        country: z.string().optional(),
        region: z.string().optional(),
        district: z.string().optional(),
        city: z.string().optional(),
        postalCode: z.string().optional(),
        industry: z.string().optional(),
        businessActivity: z.string().optional(),
        incorporationDate: z.string().datetime().optional().or(z.string().optional()),
        operationsStartDate: z.string().datetime().optional().or(z.string().optional()),
      })
      .parse(req.body);

    const data = await setup.upsertCompanyProfile(
      req.companyId!,
      {
        companyId: req.companyId!,
        ...body,
        businessEmail: body.businessEmail || undefined,
        incorporationDate: body.incorporationDate ? new Date(body.incorporationDate) : undefined,
        operationsStartDate: body.operationsStartDate
          ? new Date(body.operationsStartDate)
          : undefined,
      },
      actor(req),
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

setupRouter.put("/business-info", requireCapability("setup:prepare"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        businessType: z.string().optional(),
        legalStructure: z.string().optional(),
        industry: z.string().optional(),
        accountingCommencementDate: z.string().optional(),
        numberOfBranches: z.number().int().optional(),
        headOffice: z.string().optional(),
        reportingStructure: z.string().optional(),
        accountingBasis: z.enum(["ACCRUAL", "CASH", "MODIFIED_CASH"]).optional(),
        reportingFramework: z
          .enum(["IFRS", "IFRS_SME", "IPSAS", "LOCAL_GAAP", "INTERNAL"])
          .optional(),
        defaultLanguage: z.string().optional(),
        dateFormat: z.string().optional(),
        numberFormat: z.string().optional(),
        timeZone: z.string().optional(),
      })
      .parse(req.body);

    const data = await setup.upsertBusinessInfo(
      req.companyId!,
      {
        ...body,
        accountingCommencementDate: body.accountingCommencementDate
          ? new Date(body.accountingCommencementDate)
          : undefined,
      },
      actor(req),
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

setupRouter.post("/financial-years", requireCapability("setup:prepare"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        name: z.string().min(1),
        startDate: z.string(),
        endDate: z.string(),
        periodFrequency: z.enum(["MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "ANNUAL", "CUSTOM"]),
        closingPolicy: z.string().optional(),
        isCurrent: z.boolean().optional(),
      })
      .parse(req.body);
    const data = await setup.createFinancialYearWithPeriods(req.companyId!, body, actor(req));
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

setupRouter.put("/currency", requireCapability("setup:prepare"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        functionalCurrency: z.string().min(3).max(3),
        reportingCurrency: z.string().optional(),
        multiCurrencyEnabled: z.boolean().optional(),
        currencySymbol: z.string().optional(),
        displayFormat: z.string().optional(),
        decimalPrecision: z.number().int().min(0).max(6).optional(),
        exchangeRateSource: z.string().optional(),
        exchangeRateUpdateFrequency: z.string().optional(),
      })
      .parse(req.body);
    const data = await setup.upsertCurrency(req.companyId!, body, actor(req));
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

setupRouter.put("/policies", requireCapability("setup:prepare"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        accountingBasis: z.enum(["ACCRUAL", "CASH", "MODIFIED_CASH"]).optional(),
        inventoryValuationMethod: z
          .enum(["FIFO", "WEIGHTED_AVERAGE", "SPECIFIC_IDENTIFICATION"])
          .optional(),
        depreciationPolicy: z.string().optional(),
        revenueRecognitionMethod: z.string().optional(),
        expenseRecognitionMethod: z.string().optional(),
        badDebtPolicy: z.string().optional(),
        fxRevaluationPolicy: z.string().optional(),
        documentRetentionPeriod: z.string().optional(),
        materialityThreshold: z.number().optional(),
        roundingPolicy: z.string().optional(),
        periodClosingPolicy: z.string().optional(),
      })
      .parse(req.body);
    const data = await setup.upsertPolicies(req.companyId!, body, actor(req));
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

setupRouter.put("/localization", requireCapability("setup:prepare"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        countryOfRegistration: z.string().min(2),
        localizationPackage: z.string().min(2),
        taxAuthority: z.string().optional(),
        taxRegistrationNumbers: z.record(z.string()).optional(),
        taxpayerCategory: z.string().optional(),
        taxFilingFrequency: z.string().optional(),
        electronicInvoicingRequired: z.boolean().optional(),
        governmentIntegrationStatus: z.string().optional(),
        payrollCompliancePackage: z.string().optional(),
        defaultTaxCodes: z.any().optional(),
      })
      .parse(req.body);
    const data = await setup.upsertLocalization(req.companyId!, body, actor(req));
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

setupRouter.post(
  "/default-accounts/ensure",
  requireCapability("setup:prepare"),
  async (req: AuthedRequest, res) => {
    try {
      const data = await setup.completeDefaultAccounts(req.companyId!, actor(req));
      res.json({ success: true, data });
    } catch (e) {
      res.status(400).json({ success: false, error: (e as Error).message });
    }
  },
);

setupRouter.put("/inventory-settings", requireCapability("setup:prepare"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        valuationMethod: z
          .enum(["FIFO", "WEIGHTED_AVERAGE", "SPECIFIC_IDENTIFICATION"])
          .optional(),
        automaticCogsPosting: z.boolean().optional(),
        negativeInventoryPolicy: z.string().optional(),
        adjustmentRequiresApproval: z.boolean().optional(),
        stockCountRequiresApproval: z.boolean().optional(),
      })
      .parse(req.body);
    const data = await setup.upsertInventorySettings(req.companyId!, body, actor(req));
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

setupRouter.put("/party-defaults", requireCapability("setup:prepare"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        customerPaymentTerms: z.string().optional(),
        defaultCreditLimit: z.number().optional(),
        defaultCustomerCurrency: z.string().optional(),
        defaultSalesTaxCode: z.string().optional(),
        supplierPaymentTerms: z.string().optional(),
        defaultSupplierCurrency: z.string().optional(),
        supplierApprovalRequired: z.boolean().optional(),
        withholdingTaxStatus: z.string().optional(),
      })
      .parse(req.body);
    const data = await setup.upsertPartyDefaults(req.companyId!, body, actor(req));
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

setupRouter.put("/banking", requireCapability("setup:prepare"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        defaultReceiptMethod: z.string().optional(),
        defaultPaymentMethod: z.string().optional(),
        bankReconciliationMethod: z.string().optional(),
        paymentMethodAccountMap: z.record(z.string()).optional(),
      })
      .parse(req.body);
    const data = await setup.upsertBankingSettings(req.companyId!, body, actor(req));
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

setupRouter.post(
  "/numbering/ensure",
  requireCapability("setup:prepare"),
  async (req: AuthedRequest, res) => {
    try {
      const data = await setup.ensureNumberSequences(req.companyId!, actor(req));
      res.json({ success: true, data });
    } catch (e) {
      res.status(400).json({ success: false, error: (e as Error).message });
    }
  },
);

setupRouter.put("/approvals", requireCapability("setup:prepare"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        automaticPostingEnabled: z.boolean().optional(),
        manualPostingRequired: z.boolean().optional(),
        approvalWorkflowEnabled: z.boolean().optional(),
        approvalLevels: z.number().int().min(1).max(5).optional(),
        amountBasedApprovalLimits: z.any().optional(),
        backdatedTransactionPolicy: z.string().optional(),
        futureDatedTransactionPolicy: z.string().optional(),
        transactionEditingPolicy: z.string().optional(),
        transactionDeletionPolicy: z.string().optional(),
        supportingDocumentRequired: z.boolean().optional(),
        periodLockEnforcement: z.boolean().optional(),
      })
      .parse(req.body);
    const data = await setup.upsertApprovalControls(req.companyId!, body, actor(req));
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

setupRouter.post("/opening-balances", requireCapability("setup:prepare"), async (req: AuthedRequest, res) => {
  try {
    const body = z
      .object({
        name: z.string().min(1),
        lines: z
          .array(
            z.object({
              accountId: z.string().optional(),
              memo: z.string().optional(),
              debit: z.number().nonnegative(),
              credit: z.number().nonnegative(),
            }),
          )
          .min(1),
      })
      .parse(req.body);
    const data = await setup.saveOpeningBalances(req.companyId!, body, actor(req));
    res.status(201).json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

setupRouter.post(
  "/sections/:sectionKey/approve",
  requireCapability("setup:approve"),
  async (req: AuthedRequest, res) => {
    try {
      const sectionKey = req.params.sectionKey as SetupSectionKey;
      const data = await setup.approveSection(req.companyId!, sectionKey, actor(req));
      res.json({ success: true, data });
    } catch (e) {
      res.status(400).json({ success: false, error: (e as Error).message });
    }
  },
);

setupRouter.get("/activation/validate", async (req: AuthedRequest, res) => {
  const data = await setup.evaluateAndPersistActivation(req.companyId!);
  res.json({ success: true, data });
});

setupRouter.post("/activation/activate", requireCapability("setup:activate"), async (req: AuthedRequest, res) => {
  try {
    const data = await setup.activateAccounting(req.companyId!, actor(req));
    res.json({
      success: true,
      data,
      message:
        "Accounting environment activated successfully. Transactions may now be processed and posted.",
    });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});
