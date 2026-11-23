import { amount } from "../../lib/format";
import { type ProductItem, productAccountId } from "../../lib/txn";
import { yup } from "../../lib/validation";
import { parseAmount } from "../forms";
import type { SelectOption } from "../Select";
import { type GridColumn, isBlankRow } from "./TxnKit";

const num = (v: string) => {
  const n = parseAmount(v);
  return Number.isFinite(n) ? n : 0;
};
const fmt = (n: number) => (n ? amount(Math.round(n * 100) / 100, 2) : "");

/* ── Product / service lines ───────────────────────────── */

/** `tax` is a tax code ("" for none). */
export type ProductLine = { date: string; product: string; sku: string; description: string; qty: string; rate: string; amount: string; tax: string };

export const emptyProductLine = (): ProductLine => ({ date: "", product: "", sku: "", description: "", qty: "", rate: "", amount: "", tax: "" });

/** Which side of the business a line is on: sales lines use an item's sales defaults, purchase lines its purchasing defaults. */
export type LineSide = "sales" | "purchase";

function itemDefaults(item: ProductItem, side: LineSide) {
  return side === "sales"
    ? { description: item.salesDescription, price: item.salesPrice, tax: item.salesTaxCode }
    : { description: item.purchaseDescription, price: item.purchaseCost, tax: item.purchaseTaxCode };
}

const PRODUCT_KEYS = ["date", "product", "description", "qty", "rate", "amount"];

export function filledProductLines(lines: ProductLine[]) {
  return lines.filter((l) => !isBlankRow(l, PRODUCT_KEYS));
}

export function productTotal(lines: ProductLine[]) {
  return filledProductLines(lines).reduce((s, l) => s + num(l.amount), 0);
}

/**
 * Columns for product grids. Choosing an item fills its description, SKU, price and tax code for the side the grid is on;
 * qty × rate keeps amount in step. Pass `taxOptions` to show a Tax column.
 */
export function productColumns(
  options: SelectOption[],
  items: ProductItem[],
  opts: { date?: boolean; product?: boolean; qty?: boolean; sku?: boolean; caps?: boolean; side?: LineSide; taxOptions?: SelectOption[] } = {},
): GridColumn<ProductLine>[] {
  const { date = true, product = true, qty = true, sku = false, side = "sales", taxOptions } = opts;
  const cols: GridColumn<ProductLine>[] = [];
  if (date) cols.push({ key: "date", label: "Service Date", kind: "date", width: "15%" });
  if (product)
    cols.push({
      key: "product",
      label: "Product/service",
      kind: "select",
      options,
      width: "22%",
      onSet: (row, value) => {
        const next = { ...row, product: value };
        const label = options.find((o) => o.value === value)?.label ?? "";
        const item = value.startsWith("item:") ? items.find((i) => `item:${i.id}` === value) : undefined;
        const d = item ? itemDefaults(item, side) : undefined;
        if (!row.description) next.description = d?.description || label;
        next.sku = item?.sku ?? "";
        if (!next.qty) next.qty = "1";
        if (d?.price != null && !row.rate && !row.amount) {
          next.rate = fmt(d.price) || "0";
          next.amount = fmt(num(next.qty) * d.price);
        }
        // Only a code the grid offers, so an inactive or wrong-side code never lands on the line.
        if (taxOptions && item) next.tax = d?.tax && taxOptions.some((o) => o.value === d.tax) ? d.tax : "";
        return next;
      },
    });
  if (sku) cols.push({ key: "sku", label: "SKU", kind: "readonly", width: "10%" });
  cols.push({ key: "description", label: "Description", width: product ? "26%" : "48%" });
  if (qty) {
    cols.push({
      key: "qty",
      label: "Qty",
      kind: "number",
      align: "right",
      width: "9%",
      onSet: (row, value) => ({ ...row, qty: value, amount: row.rate ? fmt(num(value) * num(row.rate)) : row.amount }),
    });
    cols.push({
      key: "rate",
      label: "Rate",
      kind: "money",
      align: "right",
      width: "11%",
      onSet: (row, value) => ({ ...row, rate: value, amount: fmt((row.qty ? num(row.qty) : 1) * num(value)) }),
    });
  }
  cols.push({
    key: "amount",
    label: "Amount",
    kind: "money",
    align: "right",
    width: "13%",
    onSet: (row, value) => ({ ...row, amount: value, rate: qty && num(row.qty) > 0 ? fmt(num(value) / num(row.qty)) : row.rate }),
  });
  if (taxOptions) cols.push({ key: "tax", label: "Tax", kind: "select", options: taxOptions, width: "12%", placeholder: "" });
  return cols;
}

/** Yup schema for product lines; blank rows are skipped, at least one filled row is required. */
export function productLinesSchema(opts: { requireProduct?: boolean; requireAccount?: boolean; qty?: boolean; items?: ProductItem[]; optional?: boolean } = {}) {
  const { requireProduct = false, requireAccount = false, qty = true, items, optional = false } = opts;
  return yup
    .array()
    .of(
      yup.object({
        date: yup.string(),
        product: yup
          .string()
          .test("product", "Choose a product or service", function (v) {
            if (isBlankRow(this.parent, PRODUCT_KEYS)) return true;
            if (requireAccount && v?.startsWith("item:") && !productAccountId(v, items)) {
              return this.createError({ message: "This item has no income account; choose an income account instead" });
            }
            if (requireAccount) return Boolean(v && productAccountId(v, items));
            return !requireProduct || Boolean(v);
          }),
        description: yup
          .string()
          .max(500, "Keep descriptions under 500 characters")
          .test("described", "Add a product or a description", function (v) {
            if (isBlankRow(this.parent, PRODUCT_KEYS)) return true;
            return Boolean((v ?? "").trim() || this.parent.product);
          }),
        qty: yup.string().test("qty", "Quantity must be more than 0", function (v) {
          if (!qty || isBlankRow(this.parent, PRODUCT_KEYS)) return true;
          return !v || num(v) > 0;
        }),
        rate: yup.string().test("rate", "Rate can't be negative", (v) => !v || num(v) >= 0),
        amount: yup.string().test("amount", "Enter an amount more than 0", function (v) {
          if (isBlankRow(this.parent, PRODUCT_KEYS)) return true;
          return num(v ?? "") > 0;
        }),
      }),
    )
    .test("some", "Add at least one line with an amount", (rows) => optional || filledProductLines((rows ?? []) as ProductLine[]).length > 0);
}

/**
 * Tax on product lines as the server will work it out: each line's net (after its share of a document discount) × its rate.
 * `rates` maps tax code → percent.
 */
export function productTax(lines: ProductLine[], rates: Map<string, number>, discountPct = 0) {
  const keep = 1 - Math.min(Math.max(discountPct, 0), 100) / 100;
  const tax = filledProductLines(lines).reduce((s, l) => {
    const rate = l.tax ? (rates.get(l.tax) ?? 0) : 0;
    return s + Math.round(num(l.amount) * keep * rate) / 100;
  }, 0);
  return Math.round(tax * 100) / 100;
}

/** API line payload (documentLines on the server). An item line posts to the item's income (or expense) account when it has one. */
export function productLinesPayload(lines: ProductLine[], options: SelectOption[], items?: ProductItem[], side: LineSide = "sales") {
  return filledProductLines(lines).map((l) => {
    const q = num(l.qty) || 1;
    const a = num(l.amount);
    return {
      description: (l.description.trim() || options.find((o) => o.value === l.product)?.label || "Item").slice(0, 500),
      quantity: q,
      unitPrice: Math.round((a / q) * 10000) / 10000,
      accountId: productAccountId(l.product, items, side),
      taxCode: l.tax || null,
    };
  });
}

export const previewLines = (lines: ProductLine[], options: SelectOption[]) =>
  filledProductLines(lines).map((l) => ({
    date: l.date,
    description: l.description || options.find((o) => o.value === l.product)?.label || "",
    qty: l.qty,
    rate: l.rate,
    amount: num(l.amount),
  }));

/* ── Category (account) lines ──────────────────────────── */

export type CategoryLine = { category: string; description: string; amount: string };

export const emptyCategoryLine = (): CategoryLine => ({ category: "", description: "", amount: "" });

const CATEGORY_KEYS = ["category", "description", "amount"];

export function filledCategoryLines(lines: CategoryLine[]) {
  return lines.filter((l) => !isBlankRow(l, CATEGORY_KEYS));
}

export const categoryTotal = (lines: CategoryLine[]) => filledCategoryLines(lines).reduce((s, l) => s + num(l.amount), 0);

export function categoryColumns(options: SelectOption[], caps = true): GridColumn<CategoryLine>[] {
  return [
    { key: "category", label: caps ? "CATEGORY" : "Category", kind: "select", options, width: "28%", placeholder: "" },
    { key: "description", label: caps ? "DESCRIPTION" : "Description", width: "52%" },
    { key: "amount", label: caps ? "AMOUNT" : "AMOUNT", kind: "money", align: "right", width: "18%" },
  ];
}

/** Pass `optional` when another grid on the form can hold the lines instead (a bill's item details). */
export function categoryLinesSchema(requireCategory = true, optional = false) {
  return yup
    .array()
    .of(
      yup.object({
        category: yup.string().test("category", "Choose a category", function (v) {
          return !requireCategory || isBlankRow(this.parent, CATEGORY_KEYS) || Boolean(v);
        }),
        description: yup.string().max(500, "Keep descriptions under 500 characters"),
        amount: yup.string().test("amount", "Enter an amount more than 0", function (v) {
          return isBlankRow(this.parent, CATEGORY_KEYS) || num(v ?? "") > 0;
        }),
      }),
    )
    .test("some", "Add at least one line with an amount", (rows) => optional || filledCategoryLines((rows ?? []) as CategoryLine[]).length > 0);
}

export { num, fmt };
