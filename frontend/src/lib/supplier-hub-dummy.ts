/** Dummy copy + draft shape for Suppliers hub mocks. */

export const SUPPLIER_HERO = {
  title: "Keep track of who you pay",
  bullets: [
    "Find all your suppliers and contractors in one place",
    "See how much you're spending by supplier",
    "Keep track of money you owe each supplier (bills)",
  ],
} as const;

export const SUPPLIER_DRAWER_TABS = [
  { id: "contact", label: "Contact" },
  { id: "address", label: "Address" },
  { id: "notes", label: "Notes" },
  { id: "documents", label: "Documents" },
  { id: "tools", label: "Tools" },
] as const;

export type SupplierDrawerTabId = (typeof SUPPLIER_DRAWER_TABS)[number]["id"];

export const SUPPLIER_TITLE_OPTIONS = [
  { value: "", label: "Select" },
  { value: "Mr", label: "Mr" },
  { value: "Mrs", label: "Mrs" },
  { value: "Ms", label: "Ms" },
  { value: "Dr", label: "Dr" },
] as const;

export const SUPPLIER_TERMS = [
  { value: "", label: "Select" },
  { value: "0", label: "Due on receipt" },
  { value: "15", label: "Net 15" },
  { value: "30", label: "Net 30" },
  { value: "45", label: "Net 45" },
  { value: "60", label: "Net 60" },
] as const;

export type SupplierDraft = {
  title: string;
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  displayName: string;
  companyName: string;
  email: string;
  phone: string;
  cc: string;
  bcc: string;
  mobile: string;
  fax: string;
  other: string;
  website: string;
  street1: string;
  street2: string;
  city: string;
  province: string;
  postal: string;
  country: string;
  notes: string;
  businessId: string;
  billingRate: string;
  terms: string;
  accountNo: string;
  expenseCategory: string;
  openingBalance: string;
  asOf: string;
};

export function emptySupplierDraft(): SupplierDraft {
  const today = new Date();
  const asOf = `${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}/${today.getFullYear()}`;
  return {
    title: "",
    firstName: "",
    middleName: "",
    lastName: "",
    suffix: "",
    displayName: "",
    companyName: "",
    email: "",
    phone: "",
    cc: "",
    bcc: "",
    mobile: "",
    fax: "",
    other: "",
    website: "",
    street1: "",
    street2: "",
    city: "",
    province: "",
    postal: "",
    country: "Rwanda",
    notes: "",
    businessId: "",
    billingRate: "",
    terms: "30",
    accountNo: "",
    expenseCategory: "",
    openingBalance: "",
    asOf,
  };
}
