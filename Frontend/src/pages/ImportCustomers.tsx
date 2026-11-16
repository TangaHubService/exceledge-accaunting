import { type CsvImportField, CsvImportPage } from "../components/CsvImport";

/** Fields the customer import endpoint accepts, with the header spellings we recognise automatically. */
const FIELDS: CsvImportField[] = [
  { key: "name", label: "Display name *", aliases: ["display name", "name", "customer", "customer name", "full name"] },
  { key: "companyName", label: "Company", aliases: ["company", "company name", "business"] },
  { key: "email", label: "Email", aliases: ["email", "e-mail", "email address"] },
  { key: "telephone", label: "Phone", aliases: ["phone", "telephone", "phone number", "tel"] },
  { key: "mobile", label: "Mobile", aliases: ["mobile", "cell", "mobile number"] },
  { key: "contactPerson", label: "Contact person", aliases: ["contact", "contact person"] },
  { key: "website", label: "Website", aliases: ["website", "web"] },
  { key: "tin", label: "TIN", aliases: ["tin", "tax id", "vat", "tax number"] },
  { key: "physicalAddress", label: "Billing address", aliases: ["address", "billing address", "street"] },
  { key: "shippingAddress", label: "Shipping address", aliases: ["shipping address"] },
  { key: "country", label: "Country", aliases: ["country"] },
  { key: "creditPeriodDays", label: "Terms (days)", aliases: ["terms", "terms (days)", "credit days", "payment terms"], number: true, integer: true },
  { key: "creditLimit", label: "Credit limit", aliases: ["credit limit", "limit"], number: true },
  { key: "openingBalance", label: "Opening balance", aliases: ["opening balance", "balance", "open balance"], number: true },
  { key: "openingBalanceDate", label: "Opening balance date", aliases: ["opening balance date", "as of", "balance date"] },
  { key: "notes", label: "Notes", aliases: ["notes", "note", "memo"] },
];

const CONFIG = {
  fields: FIELDS,
  noun: "customer",
  nounPlural: "customers",
  endpoint: "/api/v1/ar/customers/import",
  listPath: "/customers",
  templateRow: 'Kigali Traders Ltd,Kigali Traders Ltd,accounts@example.rw,+250788000000,,Jane Doe,,123456789,"KN 4 Ave, Kigali",,Rwanda,30,500000,0,,',
};

export function ImportCustomers() {
  return <CsvImportPage config={CONFIG} />;
}
