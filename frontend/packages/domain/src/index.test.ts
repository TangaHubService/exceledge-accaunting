import { describe, expect, it } from "vitest";
import {
  assertNoPeriodOverlaps,
  buildAccountTree,
  canHardDeleteAccount,
  capabilitiesForRole,
  detectImportDuplicates,
  evaluateActivationGate,
  generateAccountingPeriods,
  hasCapability,
  openingBalancesBalanced,
  periodsOverlap,
  sumDebitsCredits,
  validateNewAccount,
  accountTypeForCode,
  assertCodeMatchesType,
  assertJournalBalanced,
  buildSaleCompletedLines,
  sumJournalLines,
  buildIdempotencyKey,
  ageingBucketKey,
  assertCreditAvailable,
  assertReceiptAllocations,
  buildArInvoiceLines,
  assertSupplierTransactable,
  assertWithholding,
  buildAdvanceApplicationLines,
  buildAdvanceRefundLines,
  buildApBillLines,
  buildApCreditNoteLines,
  buildApPaymentLines,
  buildSupplierAdvanceLines,
  buildInventoryMovementLines,
  costInventoryIssue,
  costInventoryReceipt,
  inventoryKindForErpMovement,
  inventoryTurnover,
  openingSnapshotDelta,
  assertFundsAvailable,
  assertMatchBalanced,
  autoMatchStatement,
  buildCashCountLines,
  buildMoneyPaidLines,
  buildMoneyReceivedLines,
  buildTransferLines,
  detectStatementFormat,
  parseStatement,
  parseStatementAmount,
  parseStatementDate,
  reconciliationSummary,
  statementFingerprints,
  suggestStatementLineKind,
  transferTypeFor,
  assertTaxCodeUsable,
  buildTaxAdjustmentLines,
  buildTaxPaymentLines,
  taxOnNet,
  taxReconciliation,
  taxTypeDirection,
  vatReturnTotals,
  assertExpenseAllocations,
  assertExpenseAmounts,
  assertExpenseTransition,
  buildExpenseLines,
  expenseByCategoryTotals,
  nextRecurringDate,
  assertResidualOk,
  buildAssetCapitalizationLines,
  buildDepreciationLines,
  buildDisposalLines,
  buildImpairmentLines,
  buildRevaluationLines,
  netBookValue,
  reducingBalanceMonthly,
  straightLineMonthly,
} from "./index";

describe("generateAccountingPeriods", () => {
  it("generates 12 monthly periods with first open", () => {
    const periods = generateAccountingPeriods({
      yearStart: new Date("2026-01-01T00:00:00.000Z"),
      yearEnd: new Date("2026-12-31T00:00:00.000Z"),
      frequency: "MONTHLY",
    });
    expect(periods).toHaveLength(12);
    expect(periods[0].status).toBe("OPEN");
    expect(periods[1].status).toBe("FUTURE");
    assertNoPeriodOverlaps(periods);
  });

  it("generates 4 quarterly periods", () => {
    const periods = generateAccountingPeriods({
      yearStart: new Date("2026-01-01T00:00:00.000Z"),
      yearEnd: new Date("2026-12-31T00:00:00.000Z"),
      frequency: "QUARTERLY",
    });
    expect(periods).toHaveLength(4);
  });

  it("rejects inverted year range", () => {
    expect(() =>
      generateAccountingPeriods({
        yearStart: new Date("2026-12-31"),
        yearEnd: new Date("2026-01-01"),
        frequency: "ANNUAL",
      }),
    ).toThrow(/start must be before end/);
  });
});

describe("period overlap", () => {
  it("detects overlap", () => {
    expect(
      periodsOverlap(
        { startDate: new Date("2026-01-01"), endDate: new Date("2026-03-31") },
        { startDate: new Date("2026-03-01"), endDate: new Date("2026-06-30") },
      ),
    ).toBe(true);
  });
});

describe("openingBalancesBalanced", () => {
  it("requires debit = credit", () => {
    expect(
      openingBalancesBalanced([
        { debit: 1000, credit: 0 },
        { debit: 0, credit: 1000 },
      ]),
    ).toBe(true);
    expect(openingBalancesBalanced([{ debit: 100, credit: 0 }])).toBe(false);
    expect(sumDebitsCredits([{ debit: "50.5", credit: "50.5" }]).balanced).toBe(true);
  });
});

describe("evaluateActivationGate", () => {
  const readySections = {
    COMPANY_PROFILE: "COMPLETED",
    BUSINESS_ACCOUNTING_INFO: "COMPLETED",
    FINANCIAL_YEAR_PERIODS: "APPROVED",
    CURRENCY: "APPROVED",
    ACCOUNTING_POLICIES: "APPROVED",
    LOCALIZATION: "COMPLETED",
    DEFAULT_POSTING_ACCOUNTS: "COMPLETED",
    INVENTORY_SETTINGS: "COMPLETED",
    PARTY_DEFAULTS: "COMPLETED",
    BANKING_PAYMENT: "COMPLETED",
    TRANSACTION_NUMBERING: "COMPLETED",
    APPROVAL_POSTING_CONTROLS: "COMPLETED",
  } as const;

  it("blocks when incomplete", () => {
    const result = evaluateActivationGate({
      sectionStatuses: { COMPANY_PROFILE: "NOT_STARTED" },
      hasOpenPeriod: false,
      hasFinancialYear: false,
      hasFunctionalCurrency: false,
      hasChartOfAccounts: false,
      mandatoryDefaultAccountsMapped: false,
      localizationComplete: false,
      numberingConfigured: false,
      approvalControlsDefined: false,
      hasCriticalErrors: false,
    });
    expect(result.canActivate).toBe(false);
    expect(result.status).toBe("NOT_ACTIVATED");
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it("allows activation when all gates pass", () => {
    const result = evaluateActivationGate({
      sectionStatuses: readySections,
      hasOpenPeriod: true,
      hasFinancialYear: true,
      hasFunctionalCurrency: true,
      hasChartOfAccounts: true,
      mandatoryDefaultAccountsMapped: true,
      localizationComplete: true,
      numberingConfigured: true,
      approvalControlsDefined: true,
      hasCriticalErrors: false,
    });
    expect(result.canActivate).toBe(true);
    expect(result.status).toBe("READY");
  });
});

describe("capabilities", () => {
  it("denies seller setup access", () => {
    expect(hasCapability("SELLER", "setup:view")).toBe(false);
    expect(capabilitiesForRole("ADMIN")).toContain("setup:activate");
    expect(hasCapability("ACCOUNTANT", "setup:approve")).toBe(false);
    expect(hasCapability("ACCOUNTANT", "setup:prepare")).toBe(true);
  });

  it("grants COA capabilities to accountant", () => {
    expect(hasCapability("ACCOUNTANT", "coa:view")).toBe(true);
    expect(hasCapability("ACCOUNTANT", "coa:create")).toBe(true);
    expect(hasCapability("SELLER", "coa:view")).toBe(false);
    expect(hasCapability("ACCOUNTANT", "coa:deactivate")).toBe(false);
    expect(hasCapability("ADMIN", "coa:deactivate")).toBe(true);
  });
});

describe("chart of accounts rules", () => {
  it("infers account type from code range", () => {
    expect(accountTypeForCode("1110")).toBe("ASSET");
    expect(accountTypeForCode("6100")).toBe("EXPENSE");
    expect(accountTypeForCode("8100")).toBe("OTHER_EXPENSE");
  });

  it("rejects code/type mismatch", () => {
    expect(() => assertCodeMatchesType("1100", "LIABILITY")).toThrow(/does not match/);
  });

  it("validates new account uniqueness and parent category", () => {
    expect(() =>
      validateNewAccount({
        code: "6110",
        name: "Rent",
        type: "EXPENSE",
        existingCodes: new Set(["6100"]),
        existingNamesInType: new Set(["salaries"]),
      }),
    ).not.toThrow();

    expect(() =>
      validateNewAccount({
        code: "6110",
        name: "Rent",
        type: "EXPENSE",
        parentId: "p1",
        parentType: "ASSET",
        existingCodes: new Set(),
        existingNamesInType: new Set(),
      }),
    ).toThrow(/match the parent/);
  });

  it("builds hierarchy tree sorted by code", () => {
    const tree = buildAccountTree([
      { id: "2", parentId: "1", code: "1110" },
      { id: "1", parentId: null, code: "1100" },
      { id: "3", parentId: "1", code: "1120" },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("1");
    expect(tree[0].children.map((c) => c.id)).toEqual(["2", "3"]);
  });

  it("blocks hard delete of protected or posted accounts", () => {
    expect(canHardDeleteAccount({ systemProtected: true, hasPostedTransactions: false, childCount: 0 }).allowed).toBe(false);
    expect(canHardDeleteAccount({ systemProtected: false, hasPostedTransactions: true, childCount: 0 }).allowed).toBe(false);
    expect(canHardDeleteAccount({ systemProtected: false, hasPostedTransactions: false, childCount: 0 }).allowed).toBe(true);
  });

  it("detects import duplicates", () => {
    const d = detectImportDuplicates([
      { code: "6110", name: "Rent", type: "EXPENSE" },
      { code: "6110", name: "Other", type: "EXPENSE" },
    ]);
    expect(d.duplicateCodes).toContain("6110");
  });
});

describe("journal balancing & sale posting rules", () => {
  it("rejects unbalanced journals", () => {
    expect(() =>
      assertJournalBalanced([
        { accountId: "a", debit: 100, credit: 0 },
        { accountId: "b", debit: 0, credit: 40 },
      ]),
    ).toThrow(/Unbalanced/);
  });

  it("builds balanced sale lines including VAT and COGS", () => {
    const lines = buildSaleCompletedLines(
      {
        defaultCashAccountId: "cash",
        salesRevenueId: "sales",
        outputTaxPayableId: "vat",
        costOfSalesId: "cogs",
        inventoryAssetId: "inv",
      },
      { net: 1000, tax: 180, gross: 1180, cogs: 400, paymentMethod: "CASH" },
    );
    const { debit, credit, balanced } = sumJournalLines(lines);
    expect(balanced).toBe(true);
    expect(debit).toBe(credit);
    expect(debit).toBe(1580); // 1180 receipt + 400 cogs
  });

  it("builds idempotency keys stably", () => {
    expect(
      buildIdempotencyKey({
        organizationId: 1,
        sourceModule: "POS",
        documentType: "Sale",
        documentId: 9,
        eventType: "SALE_COMPLETED",
      }),
    ).toBe("1|POS|Sale|9|SALE_COMPLETED|1");
  });
});

describe("accounts receivable rules", () => {
  it("classifies ageing buckets from the due date", () => {
    const asOf = new Date("2026-06-15T00:00:00.000Z");
    expect(ageingBucketKey(new Date("2026-06-20T00:00:00.000Z"), asOf)).toBe("CURRENT");
    expect(ageingBucketKey(new Date("2026-06-01T00:00:00.000Z"), asOf)).toBe("D1_30");
    expect(ageingBucketKey(new Date("2026-01-01T00:00:00.000Z"), asOf)).toBe("OVER_120");
  });

  it("blocks credit sales above the limit", () => {
    expect(() =>
      assertCreditAvailable({
        customerType: "CREDIT",
        creditLimit: 1000,
        outstanding: 800,
        additional: 300,
      }),
    ).toThrow(/Credit limit/);
    expect(() =>
      assertCreditAvailable({
        customerType: "CASH",
        creditLimit: 1000,
        outstanding: 800,
        additional: 300,
      }),
    ).not.toThrow();
  });

  it("rejects allocations above the invoice balance", () => {
    expect(() =>
      assertReceiptAllocations({
        amount: 500,
        allowOverpayment: true,
        allocations: [{ amount: 600, outstanding: 400 }],
      }),
    ).toThrow(/exceeds invoice/);
  });

  it("builds a balanced receivable invoice", () => {
    const lines = buildArInvoiceLines(
      {
        accountsReceivableId: "ar",
        salesRevenueId: "sales",
        outputTaxPayableId: "vat",
      },
      { net: 1000, tax: 180 },
    );
    const totals = sumJournalLines(lines);
    expect(totals.balanced).toBe(true);
    expect(totals.debit).toBe(1180);
  });
});

describe("Accounts payable rules", () => {
  const defaults = {
    accountsPayableId: "ap",
    purchasesId: "purchases",
    purchaseDiscountsId: "disc",
    purchaseReturnsId: "returns",
    inputTaxReceivableId: "vat-in",
    withholdingTaxPayableId: "wht",
    supplierAdvancesId: "adv",
    defaultCashAccountId: "cash",
    defaultBankAccountId: "bank",
  };

  it("posts a bill to purchases, input VAT and AP net of discount", () => {
    const lines = buildApBillLines(defaults, { net: 1000, tax: 180, discount: 50 });
    expect(sumJournalLines(lines).balanced).toBe(true);
    expect(lines.find((l) => l.accountId === "ap")?.credit).toBe(1130);
    expect(lines.find((l) => l.accountId === "vat-in")?.debit).toBe(180);
    expect(lines.find((l) => l.accountId === "disc")?.credit).toBe(50);
  });

  it("uses the supplier's AP and expense accounts when given", () => {
    const lines = buildApBillLines(defaults, { net: 200, tax: 0, apAccountId: "ap-2", expenseAccountId: "rent" });
    expect(lines.map((l) => l.accountId)).toEqual(["rent", "ap-2"]);
  });

  it("clears AP for cash paid plus tax withheld", () => {
    const lines = buildApPaymentLines(defaults, { amount: 850, withholdingTax: 150, method: "EFT" });
    expect(sumJournalLines(lines).balanced).toBe(true);
    expect(lines.find((l) => l.accountId === "ap")?.debit).toBe(1000);
    expect(lines.find((l) => l.accountId === "bank")?.credit).toBe(850);
    expect(lines.find((l) => l.accountId === "wht")?.credit).toBe(150);
  });

  it("rejects withholding that is negative or not below the settled amount", () => {
    expect(() => assertWithholding({ settled: 100, withholdingTax: -1 })).toThrow(/negative/);
    expect(() => assertWithholding({ settled: 100, withholdingTax: 100 })).toThrow(/less than/);
    expect(() => assertWithholding({ settled: 100, withholdingTax: 15 })).not.toThrow();
  });

  it("reverses purchases and input VAT on a credit note", () => {
    const lines = buildApCreditNoteLines(defaults, { net: 100, tax: 18 });
    expect(sumJournalLines(lines).balanced).toBe(true);
    expect(lines.find((l) => l.accountId === "ap")?.debit).toBe(118);
    expect(lines.find((l) => l.accountId === "returns")?.credit).toBe(100);
  });

  it("moves advances between cash, the advance asset and AP", () => {
    const paid = buildSupplierAdvanceLines(defaults, 300, "CASH");
    expect(paid[0]).toMatchObject({ accountId: "adv", debit: 300 });
    const applied = buildAdvanceApplicationLines(defaults, 120);
    expect(applied[0]).toMatchObject({ accountId: "ap", debit: 120 });
    const refunded = buildAdvanceRefundLines(defaults, 180, "CASH");
    expect(refunded.find((l) => l.accountId === "cash")?.debit).toBe(180);
    expect(sumJournalLines(refunded).balanced).toBe(true);
  });

  it("blocks inactive or missing suppliers", () => {
    expect(() => assertSupplierTransactable({ exists: false, active: false })).toThrow(/does not exist/);
    expect(() => assertSupplierTransactable({ exists: true, active: false })).toThrow(/not active/);
  });

  it("gives payables rights to accountants and read access to branch managers", () => {
    expect(hasCapability("ACCOUNTANT", "ap:manage")).toBe(true);
    expect(hasCapability("BRANCH_MANAGER", "ap:view")).toBe(true);
    expect(hasCapability("BRANCH_MANAGER", "ap:manage")).toBe(false);
    expect(hasCapability("SELLER", "ap:view")).toBe(false);
  });
});

describe("Inventory accounting rules", () => {
  const defaults = {
    inventoryAssetId: "inv",
    costOfSalesId: "cogs",
    grniId: "grni",
    goodsInTransitId: "git",
    inventoryGainId: "gain",
    inventoryLossId: "loss",
    inventoryWriteOffId: "writeoff",
    suspenseAccountId: "suspense",
  };
  const layers = [
    { id: "a", remaining: 5, unitCost: 100 },
    { id: "b", remaining: 10, unitCost: 130 },
  ];

  it("maps ERP movement types, including direction-based corrections", () => {
    expect(inventoryKindForErpMovement("PURCHASE", "IN")).toBe("PURCHASE");
    expect(inventoryKindForErpMovement("INITIAL_STOCK", "IN")).toBe("OPENING");
    expect(inventoryKindForErpMovement("RETURN_CUSTOMER", "IN")).toBe("CUSTOMER_RETURN");
    expect(inventoryKindForErpMovement("CORRECTION", "OUT")).toBe("ADJUSTMENT_OUT");
    expect(inventoryKindForErpMovement("ADJUSTMENT", "IN")).toBe("ADJUSTMENT_IN");
    expect(inventoryKindForErpMovement("PRODUCTION_CONSUME", "OUT")).toBeNull();
  });

  it("costs issues from the ERP cost first, then FIFO layers, then the average", () => {
    const position = { quantity: 15, value: 1800 };
    const erp = costInventoryIssue({ method: "FIFO", quantity: 7, position, layers, suppliedUnitCost: 110 });
    expect(erp).toMatchObject({ value: 770, source: "ERP" });
    expect(erp.draws).toEqual([
      { layerId: "a", quantity: 5, unitCost: 100 },
      { layerId: "b", quantity: 2, unitCost: 130 },
    ]);

    const fifo = costInventoryIssue({ method: "FIFO", quantity: 7, position, layers });
    expect(fifo).toMatchObject({ value: 760, source: "FIFO" });

    const average = costInventoryIssue({ method: "WEIGHTED_AVERAGE", quantity: 5, position, layers });
    expect(average).toMatchObject({ value: 600, unitCost: 120, source: "AVERAGE" });

    const all = costInventoryIssue({ method: "WEIGHTED_AVERAGE", quantity: 3, position: { quantity: 3, value: 100 }, layers: [] });
    expect(all.value).toBe(100);
  });

  it("refuses specific identification without an actual cost and flags uncosted stock", () => {
    expect(() => costInventoryIssue({ method: "SPECIFIC_IDENTIFICATION", quantity: 1, position: { quantity: 2, value: 50 }, layers: [] })).toThrow(/actual unit cost/);
    expect(costInventoryIssue({ method: "WEIGHTED_AVERAGE", quantity: 1, position: { quantity: 0, value: 0 }, layers: [] }).source).toBe("UNCOSTED");
  });

  it("costs receipts from the matched transfer, the ERP cost, then the average", () => {
    const position = { quantity: 4, value: 400 };
    expect(costInventoryReceipt({ quantity: 2, position, suppliedUnitCost: 150, matchedUnitCost: 120 })).toMatchObject({ value: 240, source: "TRANSFER" });
    expect(costInventoryReceipt({ quantity: 2, position, suppliedUnitCost: 150 })).toMatchObject({ value: 300, source: "ERP" });
    expect(costInventoryReceipt({ quantity: 2, position })).toMatchObject({ value: 200, source: "AVERAGE" });
  });

  it("posts each movement kind to the right accounts", () => {
    expect(buildInventoryMovementLines(defaults, { kind: "PURCHASE", value: 500 })).toEqual([
      { accountId: "inv", description: "Inventory", debit: 500, credit: 0 },
      { accountId: "grni", description: "Goods received not invoiced", debit: 0, credit: 500 },
    ]);
    const damage = buildInventoryMovementLines(defaults, { kind: "DAMAGE", value: 80 });
    expect(damage[0]).toMatchObject({ accountId: "writeoff", debit: 80 });
    expect(damage[1]).toMatchObject({ accountId: "inv", credit: 80 });
    expect(buildInventoryMovementLines(defaults, { kind: "TRANSFER_OUT", value: 60 })[0]).toMatchObject({ accountId: "git", debit: 60 });
    expect(buildInventoryMovementLines(defaults, { kind: "CUSTOMER_RETURN", value: 40 })[1]).toMatchObject({ accountId: "cogs", credit: 40 });
    expect(buildInventoryMovementLines(defaults, { kind: "SALE", value: 90 })).toEqual([]);
    expect(buildInventoryMovementLines(defaults, { kind: "PURCHASE", value: 0 })).toEqual([]);
  });

  it("reverses sides when an opening snapshot is below the recorded value", () => {
    const delta = openingSnapshotDelta({ quantity: 12, value: 1300 }, { quantity: 10, unitCost: 100 });
    expect(delta).toEqual({ quantityDelta: -2, valueDelta: -300, targetValue: 1000 });
    const lines = buildInventoryMovementLines(defaults, { kind: "OPENING", value: delta.valueDelta });
    expect(lines[0]).toMatchObject({ accountId: "suspense", debit: 300 });
    expect(lines[1]).toMatchObject({ accountId: "inv", credit: 300 });
  });

  it("refuses movements whose contra account is not mapped", () => {
    expect(() => buildInventoryMovementLines({ inventoryAssetId: "inv" }, { kind: "PURCHASE", value: 10 })).toThrow(/goods received not invoiced/);
  });

  it("computes turnover and gives inventory roles the right access", () => {
    expect(inventoryTurnover(1200, 500, 700)).toBe(2);
    expect(inventoryTurnover(100, 0, 0)).toBeNull();
    expect(hasCapability("ACCOUNTANT", "inventory:manage")).toBe(true);
    expect(hasCapability("BRANCH_MANAGER", "inventory:view")).toBe(true);
    expect(hasCapability("BRANCH_MANAGER", "inventory:manage")).toBe(false);
    expect(hasCapability("SELLER", "inventory:view")).toBe(false);
  });
});

describe("Banking and reconciliation rules", () => {
  it("builds balanced receipt, payment, transfer and cash count journals", () => {
    const received = buildMoneyReceivedLines("bank", [
      { accountId: "loan", amount: 500_000 },
      { accountId: "interest", amount: 1_250.5 },
    ]);
    expect(received[0]).toMatchObject({ accountId: "bank", debit: 501_250.5 });
    expect(sumJournalLines(received).balanced).toBe(true);
    expect(() => buildMoneyReceivedLines("bank", [{ accountId: "bank", amount: 10 }])).toThrow(/account the money is going into/);

    const paid = buildMoneyPaidLines("cash", [
      { accountId: "rent", amount: 100_000 },
      { accountId: "vat", amount: 18_000 },
    ]);
    expect(paid.at(-1)).toMatchObject({ accountId: "cash", credit: 118_000 });
    expect(() => buildMoneyPaidLines("cash", [{ accountId: "rent", amount: 0 }])).toThrow(/greater than zero/);

    const transfer = buildTransferLines({ fromAccountId: "bank", toAccountId: "momo", amount: 50_000, fee: 500, feeAccountId: "charges" });
    expect(transfer).toHaveLength(4);
    expect(transfer.filter((l) => l.accountId === "bank").reduce((s, l) => s + l.credit, 0)).toBe(50_500);
    expect(() => buildTransferLines({ fromAccountId: "bank", toAccountId: "bank", amount: 1 })).toThrow(/two different/);
    expect(transferTypeFor("CASH", "BANK")).toBe("DEPOSIT");
    expect(transferTypeFor("BANK", "CASH")).toBe("WITHDRAWAL");
    expect(transferTypeFor("BANK", "PETTY_CASH")).toBe("REPLENISHMENT");
    expect(transferTypeFor("MOBILE_MONEY", "BANK")).toBe("TRANSFER");

    expect(buildCashCountLines({ cashAccountId: "petty", bookBalance: 20_000, counted: 20_000 }).lines).toHaveLength(0);
    const short = buildCashCountLines({ cashAccountId: "petty", bookBalance: 20_000, counted: 19_400, overShortAccountId: "over-short" });
    expect(short.difference).toBe(-600);
    expect(short.lines[1]).toMatchObject({ accountId: "petty", credit: 600 });

    expect(() => assertFundsAvailable({ balance: 1000, amount: 1500, allowOverdraft: false, accountName: "Main cash" })).toThrow(/overdraft is not allowed/);
    expect(() => assertFundsAvailable({ balance: 1000, amount: 1500, allowOverdraft: true, accountName: "BK" })).not.toThrow();
  });

  it("parses statement dates and amounts in common bank layouts", () => {
    expect(parseStatementDate("05/01/2026")).toBe("2026-01-05");
    expect(parseStatementDate("05/01/2026", "MDY")).toBe("2026-05-01");
    expect(parseStatementDate("25/01/2026", "MDY")).toBe("2026-01-25");
    expect(parseStatementDate("2026-01-31")).toBe("2026-01-31");
    expect(parseStatementDate("20260131120000[+2:CAT]")).toBe("2026-01-31");
    expect(parseStatementDate("7 Jan 2026")).toBe("2026-01-07");
    expect(parseStatementDate("31/02/2026")).toBeNull();
    expect(parseStatementAmount("1,250.50")).toBe(1250.5);
    expect(parseStatementAmount("(300)")).toBe(-300);
    expect(parseStatementAmount("300-")).toBe(-300);
    expect(parseStatementAmount("2,000 DR")).toBe(-2000);
    expect(parseStatementAmount("RWF 1,000")).toBe(1000);
    expect(parseStatementAmount("")).toBeNull();
  });

  it("imports CSV statements with debit and credit columns, balances and duplicates", () => {
    const csv = [
      "Bank of Kigali,Statement",
      "Transaction Date,Value Date,Narrative,Reference,Debit,Credit,Balance",
      "01/01/2026,,Opening balance,,,,1000000",
      '03/01/2026,03/01/2026,"Deposit, cash",DEP-1,,250000,1250000',
      "05/01/2026,05/01/2026,SMS charges,,1500,,1248500",
      "05/01/2026,05/01/2026,SMS charges,,1500,,1247000",
      "07/01/2026,,Cheque 000123,CHQ123,100000,,1147000",
      "not a date,,Total,,,,",
    ].join("\n");
    const parsed = parseStatement(csv, detectStatementFormat("jan.csv", csv));
    expect(parsed.errors).toEqual([]);
    expect(parsed.lines.map((l) => l.amount)).toEqual([250000, -1500, -1500, -100000]);
    expect(parsed.openingBalance).toBe(1000000);
    expect(parsed.closingBalance).toBe(1147000);
    expect(parsed.periodStart).toBe("2026-01-03");
    expect(parsed.lines[0].description).toBe("Deposit, cash");
    const prints = statementFingerprints(parsed.lines);
    expect(new Set(prints).size).toBe(4);
    expect(statementFingerprints(parseStatement(csv, "CSV").lines)).toEqual(prints);

    const signed = parseStatement("Date;Details;Amount;Type\n2026-02-01;Interest;120.5;CR\n2026-02-02;Fee;80;DR", "CSV");
    expect(signed.lines.map((l) => l.amount)).toEqual([120.5, -80]);
    expect(parseStatement("Name,Value\nx,1", "CSV").errors[0]).toMatch(/No header row/);
  });

  it("imports OFX, QIF and CAMT.053 statements", () => {
    const ofx = `OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKTRANLIST><DTSTART>20260101<DTEND>20260131
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260110<TRNAMT>-45000.00<FITID>F1<CHECKNUM>000124<NAME>Rent</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260112<TRNAMT>90000<FITID>F2<NAME>Transfer in<MEMO>INV-2026-000004</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>545000<DTASOF>20260131</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    expect(detectStatementFormat("x.ofx", ofx)).toBe("OFX");
    const o = parseStatement(ofx, "OFX");
    expect(o.lines).toHaveLength(2);
    expect(o.lines[0]).toMatchObject({ transactionDate: "2026-01-10", amount: -45000, chequeNumber: "000124", reference: "F1" });
    expect(o.lines[1].description).toBe("Transfer in — INV-2026-000004");
    expect(o.closingBalance).toBe(545000);

    const qif = "!Type:Bank\nD01/15/2026\nT-2,500.00\nN1045\nPStationery\n^\nD01/20/2026\nT10,000\nPCustomer\n^\n";
    const q = parseStatement(qif, detectStatementFormat("x.qif", qif), "MDY");
    expect(q.lines.map((l) => [l.transactionDate, l.amount, l.chequeNumber])).toEqual([
      ["2026-01-15", -2500, "1045"],
      ["2026-01-20", 10000, undefined],
    ]);

    const camt = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="RWF">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="RWF">850.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
<Ntry><Amt Ccy="RWF">150.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-01-09</Dt></BookgDt><ValDt><Dt>2026-01-10</Dt></ValDt><AcctSvcrRef>BK-778</AcctSvcrRef>
<NtryDtls><TxDtls><RmtInf><Ustrd>Account maintenance fee</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
</Stmt></BkToCstmrStmt></Document>`;
    const c = parseStatement(camt, detectStatementFormat("jan.xml", camt));
    expect(c.lines).toEqual([
      { transactionDate: "2026-01-09", valueDate: "2026-01-10", description: "Account maintenance fee", reference: "BK-778", chequeNumber: undefined, amount: -150 },
    ]);
    expect([c.openingBalance, c.closingBalance]).toEqual([1000, 850]);
    expect(suggestStatementLineKind("Account maintenance fee", -150)).toBe("BANK_CHARGE");
    expect(suggestStatementLineKind("Interest earned", 40)).toBe("INTEREST");
    expect(suggestStatementLineKind("Unknown credit", 40)).toBe("OTHER");
  });

  it("auto-matches on reference first and leaves ambiguous amounts for manual matching", () => {
    const lines = [
      { id: "L1", date: "2026-01-12", amount: 90000, description: "Transfer in INV-2026-000004" },
      { id: "L2", date: "2026-01-20", amount: -45000, chequeNumber: "000124", description: "Cheque" },
      { id: "L3", date: "2026-01-15", amount: 5000, description: "Cash deposit" },
      { id: "L4", date: "2026-01-16", amount: 5000, description: "Cash deposit" },
      { id: "L5", date: "2026-01-18", amount: 7000, description: "Deposit" },
    ];
    const entries = [
      { id: "E1", date: "2026-01-10", amount: 90000, references: ["RCT-2026-000001", "INV-2026-000004"] },
      { id: "E1b", date: "2026-01-11", amount: 90000, references: ["RCT-2026-000002"] },
      { id: "E2", date: "2026-01-02", amount: -45000, references: ["000124", "PAY-2026-000003"] },
      { id: "E3", date: "2026-01-15", amount: 5000, references: [] },
      { id: "E4", date: "2026-01-15", amount: 5000, references: [] },
      { id: "E5", date: "2026-01-17", amount: 7000, references: [] },
      { id: "E6", date: "2025-11-01", amount: 7000, references: [] },
    ];
    const proposals = autoMatchStatement(lines, entries);
    const pairs = Object.fromEntries(proposals.map((p) => [p.lineId, p.entryId]));
    expect(pairs).toEqual({ L1: "E1", L2: "E2", L5: "E5" });
    expect(proposals.find((p) => p.lineId === "L1")!.byReference).toBe(true);

    expect(() => assertMatchBalanced([10000], [4000, 6000])).not.toThrow();
    expect(() => assertMatchBalanced([], [500, -500])).not.toThrow();
    expect(() => assertMatchBalanced([10000], [9000])).toThrow(/difference is 1000/);
    expect(() => assertMatchBalanced([10000], [])).toThrow(/at least two/);
  });

  it("summarises a reconciliation and only balances when everything is explained", () => {
    const summary = reconciliationSummary({
      bookBalance: 1_150_000,
      statementBalance: 1_147_000,
      outstanding: [{ amount: 60_000 }, { amount: -55_000 }],
      unrecorded: [
        { amount: -3_000, kind: "BANK_CHARGE" },
        { amount: 1_000, kind: "INTEREST" },
        { amount: -1_000, kind: "OTHER" },
      ],
    });
    expect(summary).toMatchObject({
      depositsInTransit: 60_000,
      outstandingPayments: 55_000,
      bankCharges: 3_000,
      interestIncome: 1_000,
      otherAdjustments: -1_000,
      adjustedBankBalance: 1_152_000,
      adjustedBookBalance: 1_147_000,
      difference: 5_000,
    });
    expect(hasCapability("ACCOUNTANT", "bank:manage")).toBe(true);
    expect(hasCapability("ACCOUNTANT", "bank:approve")).toBe(false);
    expect(hasCapability("ADMIN", "bank:approve")).toBe(true);
    expect(hasCapability("BRANCH_MANAGER", "bank:view")).toBe(true);
    expect(hasCapability("SELLER", "bank:view")).toBe(false);
  });
});

describe("Tax management rules", () => {
  it("applies a stored rate and classifies tax types", () => {
    expect(taxOnNet(1_000, 18)).toBe(180);
    expect(taxOnNet(50_000.5555, 3)).toBe(1_500.0167);
    expect(() => taxOnNet(-1, 18)).toThrow(/before tax/);
    expect(taxTypeDirection("OUTPUT_VAT")).toBe("PAYABLE");
    expect(taxTypeDirection("INPUT_VAT")).toBe("RECOVERABLE");
    expect(taxTypeDirection("ZERO_RATED")).toBe("MEMO");
  });

  it("refuses inactive or out-of-date tax codes", () => {
    assertTaxCodeUsable({ name: "VAT 18%", isActive: true, effectiveFrom: "2026-01-01", on: "2026-06-01" });
    expect(() => assertTaxCodeUsable({ name: "VAT 18%", isActive: false, effectiveFrom: "2026-01-01", on: "2026-06-01" })).toThrow(/inactive/);
    expect(() => assertTaxCodeUsable({ name: "VAT 18%", isActive: true, effectiveFrom: "2026-07-01", on: "2026-06-01" })).toThrow(/not yet/);
    expect(() => assertTaxCodeUsable({ name: "VAT 18%", isActive: true, effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31", on: "2026-01-01" })).toThrow(/ended/);
  });

  it("posts tax payments, refunds and adjustments as balanced journals", () => {
    const paid = buildTaxPaymentLines({ taxAccountId: "vat", bankAccountId: "bank", amount: 18_000 });
    expect(paid).toEqual([
      { accountId: "vat", description: "Tax paid", debit: 18_000, credit: 0 },
      { accountId: "bank", description: "Tax paid", debit: 0, credit: 18_000 },
    ]);
    const refund = buildTaxPaymentLines({ taxAccountId: "vat", bankAccountId: "bank", amount: 500, refund: true });
    expect(refund[0].accountId).toBe("bank");
    expect(refund[0].debit).toBe(500);
    const up = buildTaxAdjustmentLines({ taxAccountId: "vat", contraAccountId: "suspense", amount: 200, increase: true });
    expect(up.find((l) => l.accountId === "vat")?.credit).toBe(200);
    expect(() => buildTaxPaymentLines({ taxAccountId: "vat", bankAccountId: "vat", amount: 1 })).toThrow(/not the tax account/);
  });

  it("summarises a VAT return and reconciles ledgers", () => {
    expect(vatReturnTotals({ output: 180_000, input: 50_000, adjustments: 2_000, paid: 100_000 })).toMatchObject({
      net: 132_000,
      outstanding: 32_000,
    });
    expect(taxReconciliation({ ledger: 132_000, gl: 132_000, filed: 130_000, ebm: 132_000 })).toMatchObject({
      ledgerVsGl: 0,
      ledgerVsFiled: 2_000,
      ledgerVsEbm: 0,
    });
    expect(hasCapability("ACCOUNTANT", "tax:manage")).toBe(true);
    expect(hasCapability("ACCOUNTANT", "tax:file")).toBe(false);
    expect(hasCapability("ADMIN", "tax:file")).toBe(true);
    expect(hasCapability("BRANCH_MANAGER", "tax:view")).toBe(true);
    expect(hasCapability("SELLER", "tax:view")).toBe(false);
  });
});

describe("expense management (phase 9)", () => {
  it("builds immediate and on-account expense journals", () => {
    const paid = buildExpenseLines({
      expenseAccountId: "exp",
      creditAccountId: "bank",
      net: 100_000,
      tax: 18_000,
      inputTaxAccountId: "vat",
    });
    expect(paid.find((l) => l.accountId === "exp")?.debit).toBe(100_000);
    expect(paid.find((l) => l.accountId === "vat")?.debit).toBe(18_000);
    expect(paid.find((l) => l.accountId === "bank")?.credit).toBe(118_000);
    expect(() => buildExpenseLines({ expenseAccountId: "exp", creditAccountId: "bank", net: 10, tax: 2 })).toThrow(/input VAT/);
    expect(() => buildExpenseLines({ expenseAccountId: "exp", creditAccountId: "exp", net: 10 })).toThrow(/not the expense/);
  });

  it("validates allocations, transitions and recurring dates", () => {
    expect(assertExpenseAmounts({ net: 50_000, tax: 0 })).toEqual({ net: 50_000, tax: 0, gross: 50_000 });
    expect(assertExpenseAllocations([{ amount: 30_000 }, { amount: 20_000 }], 50_000)).toEqual([
      { amount: 30_000, percent: 60 },
      { amount: 20_000, percent: 40 },
    ]);
    expect(() => assertExpenseAllocations([{ amount: 10 }], 50_000)).toThrow(/total/);
    expect(() => assertExpenseTransition("POSTED", "DRAFT")).toThrow(/can't move/);
    assertExpenseTransition("DRAFT", "SUBMITTED");
    assertExpenseTransition("SUBMITTED", "APPROVED");
    expect(nextRecurringDate("2026-01-15", "MONTHLY")).toBe("2026-02-15");
    expect(nextRecurringDate("2026-01-15", "WEEKLY")).toBe("2026-01-22");
    expect(expenseByCategoryTotals([
      { categoryName: "Fuel", amount: 10 },
      { categoryName: "Fuel", amount: 5 },
      { categoryName: "Rent", amount: 20 },
    ])).toEqual([
      { name: "Rent", amount: 20 },
      { name: "Fuel", amount: 15 },
    ]);
    expect(hasCapability("ACCOUNTANT", "expense:approve")).toBe(true);
    expect(hasCapability("BRANCH_MANAGER", "expense:manage")).toBe(true);
    expect(hasCapability("BRANCH_MANAGER", "expense:approve")).toBe(false);
    expect(hasCapability("SELLER", "expense:view")).toBe(false);
  });
});

describe("fixed assets (phase 10)", () => {
  it("computes straight-line and reducing-balance monthly charges", () => {
    expect(straightLineMonthly({ cost: 1_200_000, residual: 0, usefulLifeMonths: 36, accumulated: 0 })).toBe(33_333.3333);
    expect(straightLineMonthly({ cost: 1_200_000, residual: 0, usefulLifeMonths: 36, accumulated: 1_166_666.6667 })).toBe(33_333.3333);
    expect(straightLineMonthly({ cost: 500_000, residual: 50_000, usefulLifeMonths: 0, accumulated: 0 })).toBe(0);
    expect(reducingBalanceMonthly({ cost: 1_000_000, residual: 100_000, ratePercent: 25, accumulated: 0 })).toBe(20_833.3333);
    expect(reducingBalanceMonthly({ cost: 1_000_000, residual: 100_000, ratePercent: 25, accumulated: 890_000 })).toBe(2_291.6667);
    expect(() => assertResidualOk(100, 150)).toThrow(/exceed/);
    expect(netBookValue(100_000, 40_000)).toBe(60_000);
  });

  it("builds capitalization, depreciation, disposal, impairment and revaluation journals", () => {
    const cap = buildAssetCapitalizationLines({ assetAccountId: "fa", creditAccountId: "bank", cost: 500_000 });
    expect(cap).toEqual([
      { accountId: "fa", description: "Asset capitalization", debit: 500_000, credit: 0 },
      { accountId: "bank", description: "Asset capitalization", debit: 0, credit: 500_000 },
    ]);
    const dep = buildDepreciationLines({ expenseAccountId: "exp", accumulatedAccountId: "accum", amount: 10_000 });
    expect(dep.find((l) => l.accountId === "exp")?.debit).toBe(10_000);
    const sale = buildDisposalLines({
      assetAccountId: "fa",
      accumulatedAccountId: "accum",
      proceedsAccountId: "bank",
      gainAccountId: "gain",
      lossAccountId: "loss",
      cost: 100_000,
      accumulated: 60_000,
      proceeds: 50_000,
    });
    expect(sale.find((l) => l.accountId === "gain")?.credit).toBe(10_000);
    const loss = buildDisposalLines({
      assetAccountId: "fa",
      accumulatedAccountId: "accum",
      proceedsAccountId: "bank",
      gainAccountId: "gain",
      lossAccountId: "loss",
      cost: 100_000,
      accumulated: 60_000,
      proceeds: 20_000,
    });
    expect(loss.find((l) => l.accountId === "loss")?.debit).toBe(20_000);
    const impair = buildImpairmentLines({ lossAccountId: "loss", accumulatedAccountId: "accum", amount: 5_000 });
    expect(impair[0].debit).toBe(5_000);
    const reval = buildRevaluationLines({ assetAccountId: "fa", reserveAccountId: "reserve", amount: 8_000, increase: true });
    expect(reval.find((l) => l.accountId === "reserve")?.credit).toBe(8_000);
    expect(hasCapability("ACCOUNTANT", "fa:post")).toBe(true);
    expect(hasCapability("BRANCH_MANAGER", "fa:view")).toBe(true);
    expect(hasCapability("BRANCH_MANAGER", "fa:manage")).toBe(false);
    expect(hasCapability("SELLER", "fa:view")).toBe(false);
  });
});
