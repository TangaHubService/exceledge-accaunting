import type { AccountType } from "./types";

/** QuickBooks-style CoA taxonomy used by Chart of accounts UI. */

export type CoaGroup = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";

export type CoaAccountTypeOption = {
  /** Shown in the Account type column / dropdown. */
  label: string;
  /** Backend Account.type used for posting / reports. */
  backendType: AccountType;
  detailTypes: string[];
};

export type CoaGroupBlock = {
  group: CoaGroup;
  label: string;
  accountTypes: CoaAccountTypeOption[];
};

export const COA_TAXONOMY: CoaGroupBlock[] = [
  {
    group: "ASSET",
    label: "ASSET",
    accountTypes: [
      {
        label: "Cash and cash equivalents",
        backendType: "ASSET",
        detailTypes: [
          "Bank",
          "Cash and cash equivalents",
          "Cash on hand",
          "Client trust account",
          "Money Market",
          "Rents Held in Trust",
          "Savings",
        ],
      },
      {
        label: "Accounts receivable (A/R)",
        backendType: "ASSET",
        detailTypes: ["Accounts receivable (A/R)"],
      },
      {
        label: "Current assets",
        backendType: "ASSET",
        detailTypes: [
          "Allowance for bad debts",
          "Assets available for sale",
          "Development Costs",
          "Employee Cash Advances",
          "Inventory",
          "Investments - Other",
          "Loans To Officers",
          "Loans to Others",
          "Loans to Shareholders",
          "Other current assets",
          "Prepaid Expenses",
          "Retainage",
          "Undeposited Funds",
        ],
      },
      {
        label: "Fixed assets",
        backendType: "ASSET",
        detailTypes: [
          "Accumulated depletion",
          "Accumulated depreciation on property, plant and equipment",
          "Buildings",
          "Depletable Assets",
          "Furniture and Fixtures",
          "Land",
          "Leasehold Improvements",
          "Machinery and equipment",
          "Other fixed assets",
          "Vehicles",
        ],
      },
      {
        label: "Non-current assets",
        backendType: "ASSET",
        detailTypes: [
          "Accumulated amortisation of non-current assets",
          "Assets held for sale",
          "Deferred tax",
          "Goodwill",
          "Intangible Assets",
          "Lease Buyout",
          "Licences",
          "Long-term investments",
          "Organisational Costs",
          "Other non-current assets",
          "Security Deposits",
        ],
      },
    ],
  },
  {
    group: "LIABILITY",
    label: "LIABILITY",
    accountTypes: [
      {
        label: "Credit card",
        backendType: "LIABILITY",
        detailTypes: ["Credit card"],
      },
      {
        label: "Accounts payable (A/P)",
        backendType: "LIABILITY",
        detailTypes: ["Accounts payable (A/P)"],
      },
      {
        label: "Current liabilities",
        backendType: "LIABILITY",
        detailTypes: [
          "Accrued liabilities",
          "Client Trust Accounts - Liabilities",
          "Current portion of obligations under finance leases",
          "Current Tax Liability",
          "Dividends payable",
          "Income tax payable",
          "Insurance payable",
          "Line of Credit",
          "Loan Payable",
          "Other current liabilities",
          "Payroll Clearing",
          "Payroll liabilities",
          "Prepaid Expenses Payable",
          "Rents in trust - Liability",
          "Sales and service tax payable",
        ],
      },
      {
        label: "Non-current liabilities",
        backendType: "LIABILITY",
        detailTypes: [
          "Accrued holiday payable",
          "Accrued non-current liabilities",
          "Liabilities related to assets held for sale",
          "Long-term debt",
          "Notes Payable",
          "Other non-current liabilities",
          "Shareholder Notes Payable",
        ],
      },
    ],
  },
  {
    group: "EQUITY",
    label: "EQUITY",
    accountTypes: [
      {
        label: "Owner's equity",
        backendType: "EQUITY",
        detailTypes: [
          "Accumulated adjustment",
          "Dividend disbursed",
          "Equity in earnings of subsidiaries",
          "Opening Balance Equity",
          "Ordinary shares",
          "Other comprehensive income",
          "Owner's Equity",
          "Paid-in capital or surplus",
          "Partner Contributions",
          "Partner Distributions",
          "Partner's Equity",
          "Preferred shares",
          "Retained Earnings",
          "Share capital",
          "Treasury Shares",
        ],
      },
    ],
  },
  {
    group: "INCOME",
    label: "INCOME",
    accountTypes: [
      {
        label: "Income",
        backendType: "INCOME",
        detailTypes: [
          "Discounts/Refunds Given",
          "Non-Profit Income",
          "Other Primary Income",
          "Revenue - General",
          "Sales - retail",
          "Sales - wholesale",
          "Sales of Product Income",
          "Service/Fee Income",
          "Unapplied Cash Payment Income",
        ],
      },
      {
        label: "Other income",
        backendType: "OTHER_INCOME",
        detailTypes: [
          "Dividend income",
          "Interest earned",
          "Loss on disposal of assets",
          "Other Investment Income",
          "Other Miscellaneous Income",
          "Other operating income",
          "Tax-Exempt Interest",
          "Unrealised loss on securities, net of tax",
        ],
      },
    ],
  },
  {
    group: "EXPENSE",
    label: "EXPENSE",
    accountTypes: [
      {
        label: "Cost of sales",
        backendType: "COST_OF_SALES",
        detailTypes: [
          "Cost of labour - COS",
          "Equipment rental - COS",
          "Freight and delivery - COS",
          "Other costs of sales - COS",
          "Supplies and materials - COS",
        ],
      },
      {
        label: "Expenses",
        backendType: "EXPENSE",
        detailTypes: [
          "Advertising/Promotional",
          "Amortisation expense",
          "Auto",
          "Bad debts",
          "Bank charges",
          "Charitable Contributions",
          "Commissions and fees",
          "Cost of Labour",
          "Dues and Subscriptions",
          "Equipment rental",
          "Finance costs",
          "Income tax expense",
          "Insurance",
          "Interest paid",
          "Legal and professional fees",
          "Loss on discontinued operations, net of tax",
          "Management compensation",
          "Meals and entertainment",
          "Office/General Administrative Expenses",
          "Other Miscellaneous Service Cost",
          "Other selling expenses",
          "Payroll Expenses",
          "Rent or Lease of Buildings",
          "Repair and maintenance",
          "Shipping and delivery expense",
          "Supplies and materials",
          "Taxes Paid",
          "Travel expenses - general and admin expenses",
          "Travel expenses - selling expense",
          "Unapplied Cash Bill Payment Expense",
          "Utilities",
        ],
      },
      {
        label: "Other expense",
        backendType: "OTHER_EXPENSE",
        detailTypes: [
          "Amortisation",
          "Depreciation",
          "Exchange Gain or Loss",
          "Other Expense",
          "Penalties and settlements",
        ],
      },
    ],
  },
];

const SEP = "|||";

/** Persist UI account type + detail type in Account.reportingGroup. */
export function encodeReportingGroup(accountType: string, detailType: string) {
  return `${accountType}${SEP}${detailType}`;
}

export function decodeReportingGroup(value: string | null | undefined): {
  accountType: string;
  detailType: string;
} {
  if (!value) return { accountType: "", detailType: "" };
  const i = value.indexOf(SEP);
  if (i >= 0) {
    return { accountType: value.slice(0, i), detailType: value.slice(i + SEP.length) };
  }
  // Legacy / seed data: treat whole string as account type.
  return { accountType: value, detailType: "" };
}

export function findAccountTypeOption(label: string): CoaAccountTypeOption | undefined {
  for (const g of COA_TAXONOMY) {
    const hit = g.accountTypes.find((a) => a.label === label);
    if (hit) return hit;
  }
  return undefined;
}

export function detailTypesFor(accountTypeLabel: string): string[] {
  return findAccountTypeOption(accountTypeLabel)?.detailTypes ?? [];
}

export function backendTypeFor(accountTypeLabel: string): AccountType | undefined {
  return findAccountTypeOption(accountTypeLabel)?.backendType;
}

/** Infer flags the backend uses for bank/cash/inventory/tax behaviour. */
export function flagsForDetailType(detailType: string): {
  isCashAccount?: boolean;
  isInventoryAccount?: boolean;
  isTaxAccount?: boolean;
  bankReconciliationRequired?: boolean;
} {
  const d = detailType.toLowerCase();
  if (d === "bank" || d === "cash on hand" || d === "cash and cash equivalents" || d === "savings" || d === "money market" || d === "undeposited funds") {
    return { isCashAccount: true, bankReconciliationRequired: d === "bank" || d === "savings" || d === "money market" };
  }
  if (d === "inventory") return { isInventoryAccount: true };
  if (d.includes("tax") || d.includes("vat") || d.includes("gst")) return { isTaxAccount: true };
  return {};
}

/** Flat list for filter dropdowns. */
export const ALL_ACCOUNT_TYPE_LABELS = COA_TAXONOMY.flatMap((g) => g.accountTypes.map((a) => a.label));
