import { type CsvImportField, CsvImportPage } from "../components/CsvImport";

/** Fields the item import endpoint accepts. Headers from our own export are recognised. Stock items come from the ERP. */
const FIELDS: CsvImportField[] = [
  { key: "name", label: "Name *", aliases: ["name", "item", "item name", "product", "product/service", "product/service name", "service"] },
  { key: "type", label: "Type (Service or Non-stock)", aliases: ["type", "item type"] },
  { key: "sku", label: "SKU", aliases: ["sku", "code", "item code", "product code"] },
  { key: "category", label: "Category", aliases: ["category"] },
  { key: "unit", label: "Unit", aliases: ["unit", "uom", "unit of measure"] },
  { key: "salesDescription", label: "Sales description", aliases: ["sales description", "description"] },
  { key: "salesPrice", label: "Sales price", aliases: ["sales price", "price", "rate", "sales price/rate", "unit price"], number: true },
  { key: "incomeAccount", label: "Income account", aliases: ["income account"] },
  { key: "salesTaxCode", label: "Sales tax", aliases: ["sales tax", "sales tax code", "tax code"] },
  { key: "purchaseDescription", label: "Purchase description", aliases: ["purchase description", "purchasing description"] },
  { key: "purchaseCost", label: "Cost", aliases: ["cost", "purchase cost", "unit cost"], number: true },
  { key: "expenseAccount", label: "Expense account", aliases: ["expense account"] },
  { key: "purchaseTaxCode", label: "Purchase tax", aliases: ["purchase tax", "purchase tax code"] },
  { key: "preferredSupplier", label: "Preferred supplier", aliases: ["preferred supplier", "supplier", "vendor", "preferred vendor"] },
];

const CONFIG = {
  fields: FIELDS,
  noun: "item",
  nounPlural: "products and services",
  endpoint: "/api/v1/inventory/items/import",
  listPath: "/products-services",
  templateRow: "Delivery,Service,DLV-1,Logistics,trip,Delivery within Kigali,5000,,VAT18,,,,,",
};

export function ImportItems() {
  return <CsvImportPage config={CONFIG} />;
}
