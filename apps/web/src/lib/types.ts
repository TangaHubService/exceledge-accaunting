/** Response shapes of the accounting API. Prisma decimals are serialised as strings. */

type Decimal = string | number;

export type SetupDashboard = {
  companyId: string;
  externalErpOrganizationId: string;
  activationStatus: "NOT_ACTIVATED" | "READY" | "ACTIVATED" | "CONFIGURATION_ERROR";
  activatedAt: string | null;
  counts: { total: number; completed: number; inProgress: number; pending: number; errors: number; requiresReview: number };
  sections: Array<{ key: string; status: string; lastError: string | null }>;
  currentFinancialYear: { id: string; name: string; startDate: string; endDate: string } | null;
  currentOpenPeriod: { id: string; name: string; startDate: string; endDate: string } | null;
  functionalCurrency: string | null;
  country: string | null;
  localizationPackage: string | null;
};

export type Account = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  description: string | null;
  isActive: boolean;
  systemProtected: boolean;
  allowManualPost: boolean;
  isCashAccount: boolean;
  currentBalance: Decimal;
  hasPostedTransactions: boolean;
};

export type AccountType =
  | "ASSET"
  | "LIABILITY"
  | "EQUITY"
  | "INCOME"
  | "COST_OF_SALES"
  | "EXPENSE"
  | "OTHER_INCOME"
  | "OTHER_EXPENSE";

export type SetupSnapshot = {
  profile: {
    registeredName: string | null;
    tradingName: string | null;
    taxIdentificationNumber: string | null;
    businessEmail: string | null;
    telephone: string | null;
    country: string | null;
  } | null;
  currency: { functionalCurrency: string | null; decimalPrecision: number | null } | null;
  localization: { taxAuthority: string | null; electronicInvoicingRequired: boolean | null } | null;
  defaults: Record<string, string | null> | null;
  years: Array<{
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    isCurrent: boolean;
    periods: Array<{ id: string; name: string; startDate: string; endDate: string; status: string }>;
  }>;
  accounts: Account[];
};

export type CoaDashboard = {
  total: number;
  active: number;
  inactive: number;
  categories: Array<{ type: AccountType; label: string; range: string; count: number }>;
};

export type ArDashboard = {
  totalCustomers: number;
  activeCustomers: number;
  cashCustomers: number;
  creditCustomers: number;
  totalOutstanding: number;
  totalDeposits: number;
  overdueInvoices: number;
  creditUtilization: number;
  ageing: AgeingBucket[];
  recentReceipts: Array<{ id: string; receiptNumber: string; amount: number; customerName: string; receiptDate: string }>;
};

export type AgeingBucket = { key: string; label: string; amount: number };

export type AgeingReport = {
  asOf: string;
  buckets: AgeingBucket[];
  lines: Array<{
    customerId: string;
    customerCode: string;
    customerName: string;
    invoiceNumber: string;
    dueDate: string;
    outstanding: number;
    bucket: string;
  }>;
  total: number;
};

export type CustomerType =
  | "CASH"
  | "CREDIT"
  | "WALK_IN"
  | "GOVERNMENT"
  | "CORPORATE"
  | "NGO"
  | "INDIVIDUAL"
  | "EXPORT"
  | "FOREIGN";

export type Customer = {
  id: string;
  code: string;
  name: string;
  customerType: CustomerType;
  tin: string | null;
  telephone: string | null;
  email: string | null;
  physicalAddress: string | null;
  currency: string;
  paymentTerms: string | null;
  creditLimit: Decimal;
  creditPeriodDays: number;
  status: "ACTIVE" | "INACTIVE";
  creditStatus: "GOOD" | "WATCH" | "ON_HOLD" | "BLOCKED";
  balance: Decimal;
  notes: string | null;
};

export type CustomerStatement = {
  type: "OUTSTANDING" | "FULL";
  customer: { id: string; code: string; name: string; balance: number };
  rows: Array<{
    invoiceNumber: string;
    invoiceDate: string;
    dueDate: string;
    gross: number;
    outstanding: number;
    description: string | null;
  }>;
  totalOutstanding: number;
};

export type CustomerLedger = {
  openingBalance: number;
  closingBalance: number;
  entries: Array<{
    id: string;
    entryDate: string;
    docType: string;
    docId: string;
    docNumber: string | null;
    description: string | null;
    debit: Decimal;
    credit: Decimal;
    runningBalance: Decimal;
  }>;
};

export type ApPaymentMethod = "CASH" | "BANK" | "MOBILE_MONEY" | "CHEQUE" | "EFT";

export type Supplier = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  tin: string | null;
  vatNumber: string | null;
  contactPerson: string | null;
  telephone: string | null;
  email: string | null;
  physicalAddress: string | null;
  currency: string;
  paymentTerms: string | null;
  creditPeriodDays: number;
  apAccountId: string | null;
  defaultExpenseAccountId: string | null;
  whtCategory: string | null;
  whtRate: Decimal;
  bankName: string | null;
  bankAccountNumber: string | null;
  status: "ACTIVE" | "INACTIVE";
  balance: Decimal;
  notes: string | null;
  externalErpSupplierId: string | null;
};

export type ApBill = {
  id: string;
  billNumber: string;
  supplierInvoiceNumber: string | null;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  billDate: string;
  dueDate: string;
  poReference: string | null;
  grnReference: string | null;
  net: number;
  tax: number;
  gross: number;
  paid: number;
  credited: number;
  outstanding: number;
  description: string | null;
  sourceModule: string | null;
};

export type ApPayment = {
  id: string;
  paymentNumber: string;
  paymentDate: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  method: ApPaymentMethod;
  amount: number;
  withholdingTax: number;
  unallocated: number;
  status: "POSTED" | "REVERSED";
  reference: string | null;
  sourceModule: string | null;
  bills: Array<{ billNumber: string; amount: number }>;
};

export type ApAdvance = {
  id: string;
  advanceNumber: string;
  advanceDate: string;
  supplierId: string;
  supplierName: string;
  method: ApPaymentMethod;
  amount: number;
  remaining: number;
  refunded: number;
  reference: string | null;
  description: string | null;
  allocations: Array<{ billNumber: string; amount: number; date: string }>;
};

export type SupplierStatement = {
  type: "OUTSTANDING" | "FULL";
  supplier: { id: string; code: string; name: string; balance: number };
  rows: ApBill[];
  totalOutstanding: number;
};

export type SupplierLedger = CustomerLedger;

export type ApAgeingReport = {
  asOf: string;
  buckets: AgeingBucket[];
  lines: Array<{
    billId: string;
    supplierId: string;
    supplierCode: string;
    supplierName: string;
    billNumber: string;
    supplierInvoiceNumber: string | null;
    dueDate: string;
    outstanding: number;
    bucket: string;
  }>;
  total: number;
};

type CountAmount = { count: number; amount: number };

export type ApDashboard = {
  totalSuppliers: number;
  activeSuppliers: number;
  totalOutstanding: number;
  billsDueToday: CountAmount;
  overdueBills: CountAmount;
  dueNext7Days: CountAmount;
  totalAdvances: number;
  monthlyPurchases: number;
  averagePaymentDays: number | null;
  ageing: AgeingBucket[];
  paymentCalendar: Array<{ date: string; count: number; amount: number }>;
  recentBills: Array<{ id: string; billNumber: string; supplierId: string; supplierName: string; billDate: string; gross: number; outstanding: number }>;
  recentPayments: Array<{ id: string; paymentNumber: string; supplierId: string; supplierName: string; paymentDate: string; amount: number; withholdingTax: number }>;
};

export type WithholdingReport = {
  from: string;
  to: string;
  rows: Array<{
    paymentId: string;
    paymentNumber: string;
    paymentDate: string;
    supplierId: string;
    supplierName: string;
    supplierTin: string | null;
    whtCategory: string | null;
    grossSettled: number;
    withholdingTax: number;
    netPaid: number;
    reference: string | null;
  }>;
  totalWithheld: number;
  totalSettled: number;
};

export type PurchasesBySupplier = {
  from: string;
  to: string;
  rows: Array<{ supplierId: string; supplierCode: string; supplierName: string; bills: number; net: number; tax: number; gross: number; outstanding: number }>;
  totalGross: number;
  totalTax: number;
};

export type JournalStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "POSTED"
  | "REVERSED"
  | "CANCELLED"
  | "POSTING_FAILED";

export type Journal = {
  id: string;
  journalNumber: string;
  journalDate: string;
  postingDate: string | null;
  journalType: string;
  status: JournalStatus;
  referenceNumber: string | null;
  description: string | null;
  currencyCode: string;
  totalDebit: Decimal;
  totalCredit: Decimal;
  sourceModule: string | null;
  sourceDocumentType: string | null;
  sourceDocumentNumber: string | null;
  reversedJournalId: string | null;
  reversesJournalId: string | null;
  createdAt: string;
  lines: Array<{
    id: string;
    lineNumber: number;
    description: string | null;
    debit: Decimal;
    credit: Decimal;
    account: { id: string; code: string; name: string };
  }>;
};

export type AccountLedger = {
  account: {
    id: string;
    code: string;
    name: string;
    type: AccountType;
    openingBalance: number;
    currentBalance: number;
    currency: string | null;
  };
  entries: Array<{
    id: string;
    postingDate: string;
    journalNumber: string;
    journalId: string;
    referenceNumber: string | null;
    sourceModule: string | null;
    description: string | null;
    debit: number;
    credit: number;
    runningBalance: number;
  }>;
};

export type PostingException = {
  id: string;
  integrationEventId: string | null;
  journalId: string | null;
  reason: string;
  detailsJson: unknown;
  status: "OPEN" | "RETRYING" | "RESOLVED" | "DISMISSED";
  createdAt: string;
  resolvedAt: string | null;
};

export type AuditEvent = {
  id: string;
  erpUserId: number;
  erpRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  sectionKey: string | null;
  beforeJson: unknown;
  afterJson: unknown;
  createdAt: string;
};

export type InventoryMovementKind =
  | "OPENING"
  | "PURCHASE"
  | "SALE"
  | "CUSTOMER_RETURN"
  | "ADJUSTMENT_IN"
  | "ADJUSTMENT_OUT"
  | "DAMAGE"
  | "EXPIRED"
  | "TRANSFER_IN"
  | "TRANSFER_OUT";

export type InventoryValuationMethod = "FIFO" | "WEIGHTED_AVERAGE" | "SPECIFIC_IDENTIFICATION";

export type InventoryMovement = {
  id: string;
  movementDate: string;
  kind: InventoryMovementKind;
  item: { id: string; name: string; sku: string | null };
  location: { id: string; name: string };
  quantityIn: number;
  quantityOut: number;
  unitCost: number;
  value: number;
  quantityAfter: number;
  valueAfter: number;
  costSource: "ERP" | "FIFO" | "AVERAGE" | "TRANSFER" | "OPENING" | "UNCOSTED";
  reference: string | null;
  referenceType: string | null;
  batchNumber: string | null;
  note: string | null;
  journalId: string | null;
  journalNumber: string | null;
};

export type InventoryMovementPage = {
  page: number;
  pageSize: number;
  total: number;
  totals: { quantityIn: number; quantityOut: number; value: number };
  rows: InventoryMovement[];
};

export type InventoryLocation = { id: string; name: string; externalBranchId: string };

export type InventoryDashboard = {
  valuationMethod: InventoryValuationMethod;
  openingLoaded: boolean;
  itemCount: number;
  locationCount: number;
  totalValue: number;
  totalQuantity: number;
  averageUnitCost: number | null;
  month: {
    from: string;
    costOfSales: number;
    purchases: number;
    gains: number;
    losses: number;
    writeOffs: number;
    returns: number;
    adjustments: number;
  };
  turnover: { costOfSales: number; ratio: number | null };
  byLocation: Array<{ name: string; value: number; quantity: number }>;
  byCategory: Array<{ name: string; value: number; quantity: number }>;
  trend: Array<{ month: string; value: number }>;
  reconciliation: {
    glValue: number;
    subledgerValue: number;
    difference: number;
    failedEvents: number;
    unpostedMovements: number;
    uncostedMovements: number;
  };
  recentMovements: InventoryMovement[];
};

export type InventoryValuation = {
  asOf: string;
  valuationMethod: InventoryValuationMethod;
  lines: Array<{
    itemId: string;
    locationId: string;
    name: string;
    sku: string | null;
    category: string | null;
    unit: string | null;
    location: string;
    quantity: number;
    unitCost: number | null;
    value: number;
  }>;
  totalQuantity: number;
  totalValue: number;
  categories: string[];
};

export type InventoryReconciliation = {
  accounts: Array<{ id: string; code: string; name: string }>;
  accountsDiffer: boolean;
  glValue: number;
  subledgerValue: number;
  difference: number;
  explained: { unpostedMovements: { count: number; value: number }; saleCostDifference: number };
  quantityDifferences: Array<{
    item: string;
    sku: string | null;
    location: string;
    erpQuantity: number;
    erpQuantityAt: string | null;
    accountingQuantity: number;
    difference: number;
    openingRecorded: boolean;
  }>;
  valueWithoutStock: Array<{ item: string; sku: string | null; location: string; value: number }>;
  negativeStock: Array<{ item: string; sku: string | null; location: string; quantity: number; value: number }>;
  uncostedMovements: number;
  failedEvents: Array<{
    id: string;
    eventType: string;
    sourceDocumentNumber: string | null;
    sourceDocumentId: string;
    occurredAt: string;
    status: string;
    lastError: string | null;
  }>;
};

export type CostOfSalesReport = {
  from: string;
  to: string;
  lines: Array<{
    itemId: string;
    name: string;
    sku: string | null;
    category: string | null;
    quantitySold: number;
    quantityReturned: number;
    cost: number;
    returnedCost: number;
    netCost: number;
  }>;
  totals: { quantitySold: number; cost: number; returnedCost: number; netCost: number };
  openingValue: number;
  closingValue: number;
  turnover: number | null;
};

export type SlowMovingReport = {
  slowDays: number;
  deadDays: number;
  lines: Array<{
    itemId: string;
    name: string;
    sku: string | null;
    category: string | null;
    location: string;
    quantity: number;
    value: number;
    lastSaleAt: string | null;
    trackedSince: string;
    daysWithoutSale: number;
    status: "SLOW" | "DEAD";
  }>;
  slow: { count: number; value: number };
  dead: { count: number; value: number };
};

/* ── Banking & reconciliation ──────────────────────────── */

export type FinancialAccountKind = "BANK" | "CASH" | "PETTY_CASH" | "MOBILE_MONEY";
export type BankTransactionKind = "RECEIPT" | "PAYMENT" | "TRANSFER" | "BANK_CHARGE" | "INTEREST" | "CASH_COUNT";
export type TransferType = "DEPOSIT" | "WITHDRAWAL" | "REPLENISHMENT" | "TRANSFER";
export type ReconciliationStatus = "DRAFT" | "REVIEWED" | "APPROVED" | "COMPLETED";
export type StatementLineKind = "BANK_CHARGE" | "INTEREST" | "OTHER";

export type FinancialAccount = {
  id: string;
  kind: FinancialAccountKind;
  name: string;
  accountNumber: string | null;
  bankName: string | null;
  branchName: string | null;
  swiftCode: string | null;
  provider: string | null;
  currency: string;
  glAccountId: string;
  glAccountCode: string | null;
  glAccountName: string | null;
  openingBalance: number;
  balance: number;
  dateOpened: string;
  reconcileFrom: string;
  isActive: boolean;
  allowOverdraft: boolean;
  custodian: string | null;
  notes: string | null;
  lastReconciledTo: string | null;
  lastReconciledBalance: number | null;
  openReconciliation: { id: string; number: string; status: ReconciliationStatus; statementDate: string } | null;
  unmatchedStatementLines: number;
};

export type FinancialAccountDetail = FinancialAccount & { monthIn: number; monthOut: number; statementCount: number };

export type BankTransaction = {
  id: string;
  number: string;
  kind: BankTransactionKind;
  transferType: TransferType | null;
  financialAccountId: string;
  financialAccountName: string;
  financialAccountKind: FinancialAccountKind;
  counterAccountId: string | null;
  counterAccountName: string | null;
  transactionDate: string;
  amount: number;
  fee: number;
  method: string | null;
  reference: string | null;
  chequeNumber: string | null;
  partyType: string | null;
  partyName: string | null;
  description: string | null;
  countedAmount: number | null;
  bookAmount: number | null;
  lines: Array<{ accountId: string; accountCode: string | null; accountName: string | null; amount: number; description: string | null }>;
  status: "POSTED" | "REVERSED";
  journalId: string | null;
  journalNumber: string | null;
  reversalJournalId: string | null;
  reversalJournalNumber: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  createdAt: string;
};

export type BankTransactionPage = {
  page: number;
  pageSize: number;
  total: number;
  totals: { received: number; paid: number; transferred: number };
  rows: BankTransaction[];
};

export type Cashbook = {
  account: FinancialAccount;
  from: string;
  to: string;
  openingBalance: number;
  receipts: number;
  payments: number;
  transfersIn: number;
  transfersOut: number;
  closingBalance: number;
  rows: Array<{
    id: string;
    date: string;
    journalId: string;
    journalNumber: string;
    reference: string | null;
    description: string | null;
    sourceModule: string | null;
    sourceDocumentType: string | null;
    transactionId: string | null;
    transactionNumber: string | null;
    transactionKind: BankTransactionKind | null;
    moneyIn: number;
    moneyOut: number;
    balance: number;
    cleared: boolean;
  }>;
};

export type BankingDashboard = {
  accounts: FinancialAccount[];
  byKind: Array<{ kind: FinancialAccountKind; count: number; balance: number }>;
  totalAvailable: number;
  receivedToday: number;
  paidToday: number;
  pendingDeposits: number | null;
  outstandingPayments: { count: number; amount: number };
  depositsInTransit: { count: number; amount: number };
  unmatchedStatementLines: number;
  cashFlow: Array<{ day: string; moneyIn: number; moneyOut: number }>;
  recent: Array<{
    id: string;
    date: string;
    accountId: string | null;
    accountName: string;
    journalId: string;
    journalNumber: string;
    description: string | null;
    sourceModule: string | null;
    moneyIn: number;
    moneyOut: number;
  }>;
};

export type CashPositionReport = {
  asOf: string;
  rows: Array<{ id: string; kind: FinancialAccountKind; name: string; currency: string; isActive: boolean; opening: number; moneyIn: number; moneyOut: number; closing: number }>;
  totals: { opening: number; moneyIn: number; moneyOut: number; closing: number };
};

export type StatementFormat = "CSV" | "OFX" | "QIF" | "CAMT053";

export type StatementPreview = {
  format: StatementFormat;
  errors: string[];
  openingBalance: number | null;
  closingBalance: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  lines: Array<{
    transactionDate: string;
    valueDate?: string;
    description: string;
    reference?: string;
    chequeNumber?: string;
    amount: number;
    runningBalance?: number;
    status: "NEW" | "DUPLICATE" | "RECONCILED_PERIOD" | "BEFORE_START";
  }>;
  counts: { new: number; duplicate: number; reconciledPeriod: number; beforeStart: number };
};

export type BankStatement = {
  id: string;
  fileName: string;
  format: StatementFormat;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  lineCount: number;
  matchedCount: number;
  duplicateCount: number;
  errorCount: number;
  importedAt: string;
};

export type StatementLine = {
  id: string;
  date: string;
  valueDate: string | null;
  amount: number;
  description: string;
  reference: string | null;
  chequeNumber: string | null;
  runningBalance: number | null;
  suggestedKind: StatementLineKind;
};

export type BookEntry = {
  id: string;
  date: string;
  amount: number;
  journalId: string;
  journalNumber: string;
  description: string | null;
  reference: string | null;
  documentNumber: string | null;
  chequeNumber: string | null;
  partyName: string | null;
  sourceModule: string | null;
};

export type MatchingWorkspace = {
  lines: StatementLine[];
  entries: BookEntry[];
  matches: Array<{
    id: string;
    method: "AUTO" | "MANUAL" | "RECORDED";
    clearedDate: string;
    locked: boolean;
    createdAt: string;
    lines: Array<{ id: string; date: string; description: string; reference: string | null; amount: number }>;
    entries: Array<{ id: string; date: string; amount: number; journalId: string | null; journalNumber: string | null; description: string | null }>;
  }>;
};

export type ReconciliationSummary = {
  bookBalance: number;
  statementBalance: number;
  depositsInTransit: number;
  outstandingPayments: number;
  bankCharges: number;
  interestIncome: number;
  otherAdjustments: number;
  adjustedBankBalance: number;
  adjustedBookBalance: number;
  difference: number;
};

export type Reconciliation = {
  id: string;
  number: string;
  status: ReconciliationStatus;
  financialAccountId: string;
  accountName: string;
  accountKind: FinancialAccountKind;
  accountNumber: string | null;
  bankName: string | null;
  currency: string;
  glAccountCode: string | null;
  glAccountName: string | null;
  periodStart: string;
  statementDate: string;
  statementBalance: number;
  notes: string | null;
  summary: ReconciliationSummary;
  outstanding: Array<{
    id: string;
    date: string;
    amount: number;
    journalId: string;
    journalNumber: string;
    documentNumber: string | null;
    reference: string | null;
    chequeNumber: string | null;
    partyName: string | null;
    description: string | null;
    daysOutstanding: number;
    matched: boolean;
  }>;
  unrecorded: Array<{ id: string; date: string; amount: number; description: string; reference: string | null; chequeNumber: string | null; kind: StatementLineKind; matched: boolean }>;
  clearedEntryCount: number;
  statementLineCount: number;
  checks: { statementImported: boolean; differenceZero: boolean; allLinesAccounted: boolean; periodOpen: boolean };
  ready: boolean;
  workflowEnabled: boolean;
  preparedBy: number | null;
  reviewedBy: number | null;
  approvedBy: number | null;
  completedBy: number | null;
  preparedAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  completedAt: string | null;
};

export type ReconciliationOverview = {
  accounts: Array<{
    id: string;
    name: string;
    kind: FinancialAccountKind;
    isActive: boolean;
    bankName: string | null;
    accountNumber: string | null;
    bookBalance: number;
    lastStatementDate: string | null;
    lastStatementBalance: number | null;
    unmatchedLines: number;
    lastReconciledTo: string | null;
    lastReconciledBalance: number | null;
    openReconciliation: { id: string; number: string; status: ReconciliationStatus; statementDate: string; difference: number | null } | null;
  }>;
  history: Array<{
    id: string;
    number: string;
    accountId: string;
    accountName: string;
    statementDate: string;
    statementBalance: number;
    bookBalance: number | null;
    status: ReconciliationStatus;
    outstandingCount: number | null;
    preparedBy: number | null;
    approvedBy: number | null;
    completedAt: string | null;
    preparedAt: string | null;
  }>;
};

/* ── Tax (Phase 8) ─────────────────────────────────────── */

export type TaxType =
  | "OUTPUT_VAT"
  | "INPUT_VAT"
  | "ZERO_RATED"
  | "EXEMPT"
  | "WHT_PAYABLE"
  | "WHT_RECEIVABLE"
  | "EXCISE"
  | "IMPORT_VAT"
  | "PAYE"
  | "OTHER";

export type TaxFilingKind = "VAT" | "WHT" | "PAYE" | "EXCISE" | "ANNUAL";
export type TaxFilingStatus = "DRAFT" | "PREPARED" | "FILED";
export type TaxPaymentStatus = "POSTED" | "REVERSED";

export type TaxCode = {
  id: string;
  code: string;
  name: string;
  taxType: TaxType;
  ratePercent: number;
  glAccountId: string | null;
  glAccountCode: string | null;
  glAccountName: string | null;
  authority: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  appliesTo: string | null;
  notes: string | null;
};

export type TaxSettings = {
  id?: string;
  taxAuthority: string | null;
  tin: string | null;
  vatRegistered: boolean;
  vatFilingFrequency: string | null;
  taxCurrency: string;
  roundingMethod: string | null;
  defaultOutputTaxCodeId: string | null;
  defaultInputTaxCodeId: string | null;
  defaultWhtTaxCodeId: string | null;
  notes: string | null;
  codes: TaxCode[];
};

export type TaxDashboard = {
  settings: {
    taxAuthority: string | null;
    tin: string | null;
    vatRegistered: boolean;
    vatFilingFrequency: string | null;
  };
  balances: {
    vatPayable: number;
    vatReceivable: number;
    vatNetDue: number;
    withholdingPayable: number;
    payePayable: number;
    totalOutstanding: number;
  };
  month: {
    from: string;
    to: string;
    outputVat: number;
    inputVat: number;
    withholding: number;
    vatNet: number;
  };
  openFilings: number;
  dueSoon: Array<{ id: string; number: string; kind: TaxFilingKind; dueDate: string | null; status: TaxFilingStatus }>;
  recentFilings: Array<{
    id: string;
    number: string;
    kind: TaxFilingKind;
    status: TaxFilingStatus;
    periodFrom: string;
    periodTo: string;
    filedAt: string | null;
    filingReference: string | null;
  }>;
  recentPayments: Array<{
    id: string;
    number: string;
    paymentDate: string;
    taxType: TaxType;
    amount: number;
    isRefund: boolean;
    reference: string | null;
  }>;
};

export type VatReport = {
  from: string;
  to: string;
  outputAccount: { id: string; code: string; name: string } | null;
  inputAccount: { id: string; code: string; name: string } | null;
  totals: { output: number; input: number; adjustments: number; paid: number; net: number; outstanding: number };
  outputLines: Array<{
    id: string;
    date: string;
    journalId: string;
    journalNumber: string;
    description: string | null;
    sourceModule: string | null;
    sourceDocumentNumber: string | null;
    debit: number;
    credit: number;
    amount: number;
  }>;
  inputLines: Array<{
    id: string;
    date: string;
    journalId: string;
    journalNumber: string;
    description: string | null;
    sourceModule: string | null;
    sourceDocumentNumber: string | null;
    debit: number;
    credit: number;
    amount: number;
  }>;
  payments: Array<{ id: string; number: string; paymentDate: string; amount: number; isRefund: boolean; reference: string | null }>;
};

export type TaxLedger = {
  from: string;
  to: string;
  page: number;
  pageSize: number;
  total: number;
  openingBalance: number;
  closingBalance: number;
  rows: Array<{
    id: string;
    date: string;
    taxType: TaxType;
    accountCode: string;
    accountName: string;
    journalId: string;
    journalNumber: string;
    reference: string | null;
    description: string | null;
    sourceModule: string | null;
    debit: number;
    credit: number;
    balance: number;
  }>;
};

export type TaxPayment = {
  id: string;
  number: string;
  paymentDate: string;
  taxType: TaxType;
  amount: number;
  isRefund: boolean;
  reference: string | null;
  description: string | null;
  status: TaxPaymentStatus;
  journalId?: string | null;
  journalNumber: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  taxAccount?: { id: string; code: string; name: string } | null;
  bankAccount?: { id: string; code: string; name: string } | null;
};

export type TaxPaymentList = {
  page: number;
  pageSize: number;
  total: number;
  rows: Array<{
    id: string;
    number: string;
    paymentDate: string;
    taxType: TaxType;
    amount: number;
    isRefund: boolean;
    reference: string | null;
    description?: string | null;
    status: TaxPaymentStatus;
    journalId?: string | null;
  }>;
};

export type TaxFiling = {
  id: string;
  number: string;
  kind: TaxFilingKind;
  status: TaxFilingStatus;
  periodFrom: string;
  periodTo: string;
  dueDate: string | null;
  preparedAt: string | null;
  filedAt: string | null;
  filingReference: string | null;
  summary: Record<string, unknown> | null;
  notes: string | null;
};

export type TaxReconciliationReport = {
  from: string;
  to: string;
  vat: {
    ledger: number;
    gl: number;
    ledgerVsGl: number;
    filed: number | null;
    ledgerVsFiled: number | null;
    ebm: number | null;
    ledgerVsEbm: number | null;
  };
  withholding: { ledger: number; gl: number; difference: number };
  fiscalDocuments: number;
};

export type FiscalDocumentList = {
  page: number;
  pageSize: number;
  total: number;
  totals: { net: number; tax: number; gross: number };
  rows: Array<{
    id: string;
    sourceDocumentType: string;
    sourceDocumentId: string;
    sourceDocumentNumber: string | null;
    occurredAt: string;
    netAmount: number;
    taxAmount: number;
    grossAmount: number;
    vsdcInvoiceNumber: number | null;
    sdcReceiptNumber: string | null;
    journalId: string | null;
  }>;
};

/* ── Expense (Phase 9) ─────────────────────────────────── */

export type ExpenseStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "POSTED" | "REVERSED";
export type ExpensePaymentMode = "IMMEDIATE" | "ON_ACCOUNT" | "REIMBURSEMENT";
export type RecurringFrequency = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";

export type ExpenseCategory = {
  id: string;
  code: string;
  name: string;
  glAccountId: string | null;
  glAccountCode: string | null;
  glAccountName: string | null;
  isActive: boolean;
  notes: string | null;
};

export type Expense = {
  id: string;
  number: string;
  expenseDate: string;
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  expenseAccountId: string;
  paymentMode: ExpensePaymentMode;
  status: ExpenseStatus;
  payeeName: string | null;
  employeeName: string | null;
  description: string | null;
  netAmount: number;
  taxAmount: number;
  grossAmount: number;
  creditAccountId: string | null;
  financialAccountId: string | null;
  branch: string | null;
  department: string | null;
  costCentre: string | null;
  project: string | null;
  journalNumber: string | null;
  rejectionReason: string | null;
  allocations: Array<{ id: string; department: string | null; branch: string | null; amount: number; percent: number }>;
};

export type ExpenseList = {
  page: number;
  pageSize: number;
  total: number;
  rows: Array<{
    id: string;
    number: string;
    expenseDate: string;
    categoryCode: string;
    categoryName: string;
    paymentMode: ExpensePaymentMode;
    status: ExpenseStatus;
    payeeName: string | null;
    employeeName: string | null;
    description: string | null;
    netAmount: number;
    taxAmount: number;
    grossAmount: number;
    branch: string | null;
    department: string | null;
  }>;
};

export type ExpenseDashboard = {
  month: { from: string; to: string; total: number; count: number };
  today: { total: number; count: number };
  pendingApprovals: number;
  approvedWaiting: number;
  rejectedThisMonth: number;
  reimbursable: { count: number; amount: number };
  topCategories: Array<{ name: string; amount: number }>;
  recent: Array<{
    id: string;
    number: string;
    expenseDate: string;
    categoryName: string;
    status: ExpenseStatus;
    payeeName: string | null;
    grossAmount: number;
    description: string | null;
  }>;
};

export type RecurringExpense = {
  id: string;
  number: string;
  name: string;
  categoryId: string;
  categoryCode: string | null;
  categoryName: string | null;
  paymentMode: ExpensePaymentMode;
  frequency: RecurringFrequency;
  amount: number;
  taxAmount: number;
  payeeName: string | null;
  nextRunDate: string;
  endDate: string | null;
  autoPost: boolean;
  isActive: boolean;
  lastGeneratedAt: string | null;
};

export type ExpensesByCategoryReport = {
  from: string;
  to: string;
  total: number;
  categories: Array<{ name: string; amount: number }>;
  rows: Array<{
    id: string;
    number: string;
    expenseDate: string;
    categoryName: string;
    payeeName: string | null;
    description: string | null;
    branch: string | null;
    department: string | null;
    amount: number;
  }>;
};

/* ── Fixed assets (Phase 10) ───────────────────────────── */

export type DepreciationMethod = "STRAIGHT_LINE" | "REDUCING_BALANCE";
export type AssetStatus = "REGISTERED" | "ACTIVE" | "FULLY_DEPRECIATED" | "DISPOSED";
export type DisposalMethod = "SALE" | "SCRAP" | "DONATION" | "THEFT" | "DESTRUCTION" | "RETIREMENT";

export type FaCategory = {
  id: string;
  code: string;
  name: string;
  usefulLifeMonths: number;
  depreciationMethod: DepreciationMethod;
  residualPercent: number;
  ratePercent: number | null;
  isActive: boolean;
};

export type FixedAssetListItem = {
  id: string;
  number: string;
  name: string;
  categoryId: string;
  categoryName: string;
  acquisitionCost: number;
  accumulatedDepreciation: number;
  netBookValue: number;
  status: AssetStatus;
  branch: string | null;
  location: string | null;
  assignedEmployee: string | null;
  purchaseDate: string | null;
  capitalizedAt: string | null;
};

export type FixedAsset = FixedAssetListItem & {
  categoryCode: string;
  serialNumber: string | null;
  barcode: string | null;
  description: string | null;
  supplierName: string | null;
  residualValue: number;
  usefulLifeMonths: number;
  depreciationMethod: DepreciationMethod;
  ratePercent: number | null;
  department: string | null;
  costCentre: string | null;
  project: string | null;
  capitalizationJournalId: string | null;
  lastDepreciationPeriod: string | null;
  disposedAt: string | null;
  disposalMethod: DisposalMethod | null;
  disposalProceeds: number | null;
  depreciations: Array<{ id: string; period: string; amount: number; journalId: string | null }>;
  maintenances: Array<{
    id: string;
    maintenanceDate: string;
    maintenanceType: string;
    serviceProvider: string | null;
    description: string | null;
    cost: number;
    nextMaintenanceDate: string | null;
  }>;
  transfers: Array<{ id: string; transferDate: string; toBranch: string | null; toLocation: string | null; toEmployee: string | null; notes: string | null }>;
  revaluations: Array<{ id: string; effectiveDate: string; previousCarrying: number; fairValue: number; amount: number; increase: boolean }>;
  impairments: Array<{ id: string; impairmentDate: string; recoverableAmount: number; lossAmount: number; reason: string | null }>;
};

export type FaDashboard = {
  totals: {
    count: number;
    cost: number;
    accumulatedDepreciation: number;
    netBookValue: number;
    disposed: number;
    acquiredThisYear: number;
    fullyDepreciated: number;
    dueMaintenance: number;
  };
  byCategory: Array<{ name: string; count: number; cost: number; nbv: number }>;
  recent: Array<{ id: string; number: string; name: string; categoryName: string; status: AssetStatus; netBookValue: number; acquisitionCost: number }>;
  depreciationRuns: Array<{ id: string; period: string; assetCount: number; totalAmount: number; journalId: string | null }>;
};

export type DepPreview = {
  period: string;
  assetCount: number;
  totalAmount: number;
  items: Array<{ assetId: string; number: string; name: string; amount: number; netBookValueAfter: number }>;
};
