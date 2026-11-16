import { type CsvImportField, CsvImportPage } from "../components/CsvImport";

/** Fields the supplier import endpoint accepts. Headers from our own supplier export are recognised. */
const FIELDS: CsvImportField[] = [
  { key: "name", label: "Display name *", aliases: ["display name", "name", "supplier", "supplier name", "vendor", "vendor name"] },
  { key: "companyName", label: "Company", aliases: ["company", "company name", "business", "legal name"] },
  { key: "supplierType", label: "Type", aliases: ["type", "supplier type"] },
  { key: "category", label: "Category", aliases: ["category", "supplier category"] },
  { key: "contactPerson", label: "Contact person", aliases: ["contact", "contact person"] },
  { key: "email", label: "Email", aliases: ["email", "e-mail", "email address"] },
  { key: "telephone", label: "Phone", aliases: ["phone", "telephone", "phone number", "tel"] },
  { key: "mobile", label: "Mobile", aliases: ["mobile", "cell", "mobile number"] },
  { key: "website", label: "Website", aliases: ["website", "web"] },
  { key: "tin", label: "TIN", aliases: ["tin", "tax id", "tax number"] },
  { key: "vatRegistered", label: "VAT registered", aliases: ["vat registered", "vat"], boolean: true },
  { key: "physicalAddress", label: "Street address", aliases: ["address", "street address", "street", "billing address"] },
  { key: "district", label: "District", aliases: ["district", "city"] },
  { key: "province", label: "Province", aliases: ["province", "region"] },
  { key: "country", label: "Country", aliases: ["country"] },
  { key: "creditPeriodDays", label: "Terms (days)", aliases: ["terms", "terms (days)", "credit days", "payment terms"], number: true, integer: true },
  { key: "preferredPaymentMethod", label: "Payment method", aliases: ["payment method", "preferred payment method"] },
  { key: "bankName", label: "Bank", aliases: ["bank", "bank name"] },
  { key: "bankAccountHolder", label: "Account holder", aliases: ["account holder", "account name"] },
  { key: "bankAccountNumber", label: "Account number", aliases: ["account number", "bank account", "bank account number"] },
  { key: "openingBalance", label: "Opening balance", aliases: ["opening balance", "open balance", "balance"], number: true },
  { key: "openingBalanceDate", label: "Opening balance date", aliases: ["opening balance date", "as of", "balance date"] },
  { key: "notes", label: "Notes", aliases: ["notes", "note", "memo"] },
];

const CONFIG = {
  fields: FIELDS,
  noun: "supplier",
  nounPlural: "suppliers",
  endpoint: "/api/v1/ap/suppliers/import",
  listPath: "/suppliers",
  templateRow:
    'Kigali Hardware,Kigali Hardware Ltd,BUSINESS,INVENTORY,Jean Mugabo,sales@example.rw,+250788000000,,,123456789,yes,KN 5 Rd,Gasabo,Kigali,Rwanda,30,BANK,Bank of Kigali,Kigali Hardware Ltd,000400012345,0,,',
};

export function ImportSuppliers() {
  return <CsvImportPage config={CONFIG} />;
}
