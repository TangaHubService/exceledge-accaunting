/** Dummy data for the Customer Hub screens (matches design mocks). */
export { CUSTOMER_HUB_ITEMS } from "./app-hub-nav";

export const CUSTOMER_HERO = {
  title: "Keep track of who needs to pay you",
  videoLabel: "See how it works (3:07s)",
  bullets: [
    "Find your customers and their info in one place",
    "See who your top customers are",
    "Track invoices to see who owes you money",
  ],
  tips: [
    { label: "How to create an invoice", href: "/invoices" },
    { label: "How to add a customer or sub-customer", href: "#" },
  ],
} as const;

export const LEADS_HERO = {
  title: "Turn leads into paying customers",
  videoLabel: "See how it works (2:41s)",
  bullets: [
    "Capture leads from forms, referrals and imports",
    "Follow up before they go cold",
    "Convert a lead to a customer when they are ready",
  ],
  tips: [
    { label: "How to qualify a lead", href: "#" },
    { label: "How to convert a lead to a customer", href: "#" },
  ],
} as const;

export const TITLE_OPTIONS = [
  { value: "", label: "None" },
  { value: "Mr", label: "Mr" },
  { value: "Mrs", label: "Mrs" },
  { value: "Ms", label: "Ms" },
  { value: "Dr", label: "Dr" },
] as const;

export const PAYMENT_METHODS = [
  { value: "", label: "Choose one" },
  { value: "cash", label: "Cash" },
  { value: "bank", label: "Bank transfer" },
  { value: "card", label: "Card" },
  { value: "mobile", label: "Mobile money" },
] as const;

export const PAYMENT_TERMS = [
  { value: "0", label: "Due on receipt" },
  { value: "15", label: "Net 15" },
  { value: "30", label: "Net 30" },
  { value: "60", label: "Net 60" },
] as const;

export const DELIVERY_OPTIONS = [
  { value: "print", label: "Print later" },
  { value: "email", label: "Send later" },
  { value: "both", label: "Print and send later" },
] as const;

export const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "rw", label: "Kinyarwanda" },
] as const;

export const CONTACT_METHODS = [
  { value: "", label: "Choose one" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "mobile", label: "Mobile" },
  { value: "in_person", label: "In person" },
] as const;

export const INDUSTRIES = [
  { value: "", label: "Choose one" },
  { value: "retail", label: "Retail" },
  { value: "services", label: "Professional services" },
  { value: "construction", label: "Construction" },
  { value: "hospitality", label: "Hospitality" },
  { value: "agriculture", label: "Agriculture" },
  { value: "other", label: "Other" },
] as const;

export const SOURCE_OPTIONS = [
  { value: "", label: "Choose one" },
  { value: "referral", label: "Referral" },
  { value: "website", label: "Website" },
  { value: "walk_in", label: "Walk-in" },
  { value: "advertising", label: "Advertising" },
  { value: "other", label: "Other" },
] as const;

export const ROLE_OPTIONS = [
  { value: "", label: "Choose one" },
  { value: "owner", label: "Owner" },
  { value: "manager", label: "Manager" },
  { value: "accountant", label: "Accountant" },
  { value: "other", label: "Other" },
] as const;

export type CustomerDraft = {
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
  isSubCustomer: boolean;
  billingStreet1: string;
  billingStreet2: string;
  billingCity: string;
  billingProvince: string;
  billingPostal: string;
  billingCountry: string;
  sameAsBilling: boolean;
  notes: string;
  paymentMethod: string;
  terms: string;
  deliveryOption: string;
  language: string;
  salesTaxReg: string;
  openingBalance: string;
  asOf: string;
  source: string;
  referredBy: string;
  jobTitle: string;
  role: string;
  preferredContact: string;
  industry: string;
};

/** Empty draft matching the Add customer mocks (As of date as shown). */
export function emptyCustomerDraft(asOf = "2026-10-17"): CustomerDraft {
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
    isSubCustomer: false,
    billingStreet1: "",
    billingStreet2: "",
    billingCity: "",
    billingProvince: "",
    billingPostal: "",
    billingCountry: "",
    sameAsBilling: true,
    notes: "",
    paymentMethod: "",
    terms: "30",
    deliveryOption: "email",
    language: "en",
    salesTaxReg: "",
    openingBalance: "",
    asOf,
    source: "",
    referredBy: "",
    jobTitle: "",
    role: "",
    preferredContact: "",
    industry: "",
  };
}

export type DrawerTabId = "contact" | "address" | "notes" | "payment" | "documents" | "tools" | "relationships";

export const DRAWER_TABS: Array<{ id: DrawerTabId; label: string }> = [
  { id: "contact", label: "Contact" },
  { id: "address", label: "Address" },
  { id: "notes", label: "Notes" },
  { id: "payment", label: "Payment" },
  { id: "documents", label: "Documents" },
  { id: "tools", label: "Tools" },
  { id: "relationships", label: "Relationships" },
];
