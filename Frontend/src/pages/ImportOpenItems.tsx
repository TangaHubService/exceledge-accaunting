import { type CsvImportConfig, CsvImportPage } from "../components/CsvImport";

const config = (side: "customers" | "suppliers"): CsvImportConfig => {
  const customers = side === "customers";
  return {
    fields: [
      { key: "name", label: `${customers ? "Customer" : "Supplier"} *`, aliases: ["name", "customer", "supplier", "vendor", "customer full name", "supplier name", "display name"] },
      { key: "number", label: "Number *", aliases: ["number", "num", "no.", "invoice no", "invoice number", "bill number", "bill no", "doc number"] },
      { key: "date", label: "Date * (yyyy-mm-dd)", aliases: ["date", "invoice date", "bill date", "transaction date"] },
      { key: "dueDate", label: "Due date (yyyy-mm-dd)", aliases: ["due date", "due"] },
      { key: "amount", label: "Open balance *", aliases: ["open balance", "balance", "amount due", "amount", "outstanding"], number: true },
      { key: "currency", label: "Currency", aliases: ["currency"] },
      { key: "memo", label: "Memo", aliases: ["memo", "description", "memo/description"] },
    ],
    noun: customers ? "open invoice" : "open bill",
    nounPlural: customers ? "open invoices" : "open bills",
    endpoint: `/api/v1/setup/open-items?side=${side}`,
    listPath: customers ? "/invoices" : "/bills",
    templateRow: customers ? "Kigali Shop,QB-1001,2026-01-05,2026-02-04,118000,RWF,From QuickBooks" : "Musanze Mill,B-204,2026-01-07,2026-02-06,500000,RWF,From QuickBooks",
  };
};
const INVOICES = config("customers");
const BILLS = config("suppliers");

export const ImportOpenInvoices = () => <CsvImportPage config={INVOICES} />;
export const ImportOpenBills = () => <CsvImportPage config={BILLS} />;
