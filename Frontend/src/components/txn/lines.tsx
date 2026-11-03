import { amount } from "../../lib/format";
import { type InventoryItem, productAccountId } from "../../lib/txn";
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

export type ProductLine = { date: string; product: string; sku: string; description: string; qty: string; rate: string; amount: string };

export const emptyProductLine = (): ProductLine => ({ date: "", product: "", sku: "", description: "", qty: "", rate: "", amount: "" });

const PRODUCT_KEYS = ["date", "product", "description", "qty", "rate", "amount"];

export function filledProductLines(lines: ProductLine[]) {
  return lines.filter((l) => !isBlankRow(l, PRODUCT_KEYS));
}

export function productTotal(lines: ProductLine[]) {
  return filledProductLines(lines).reduce((s, l) => s + num(l.amount), 0);
}

/** Columns for product grids. Choosing a product fills description/SKU/rate; qty × rate keeps amount in step. */
export function productColumns(
  options: SelectOption[],
  items: InventoryItem[],
  opts: { date?: boolean; product?: boolean; qty?: boolean; sku?: boolean; caps?: boolean } = {},
): GridColumn<ProductLine>[] {
  const { date = true, product = true, qty = true, sku = false } = opts;
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
        if (!row.description) next.description = label;
        if (value.startsWith("item:")) {
          const item = items.find((i) => `item:${i.id}` === value);
          if (item) next.sku = item.sku;
        }
        if (!next.qty) next.qty = "1";
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
  return cols;
}

/** Yup schema for product lines; blank rows are skipped, at least one filled row is required. */
export function productLinesSchema(opts: { requireProduct?: boolean; requireAccount?: boolean; qty?: boolean } = {}) {
  const { requireProduct = false, requireAccount = false, qty = true } = opts;
  return yup
    .array()
    .of(
      yup.object({
        date: yup.string(),
        product: yup
          .string()
          .test("product", "Choose a product or service", function (v) {
            if (isBlankRow(this.parent, PRODUCT_KEYS)) return true;
            if (requireAccount) return Boolean(v && productAccountId(v));
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
    .test("some", "Add at least one line with an amount", (rows) => filledProductLines((rows ?? []) as ProductLine[]).length > 0);
}

/** API line payload (documentLines on the server). */
export function productLinesPayload(lines: ProductLine[], options: SelectOption[]) {
  return filledProductLines(lines).map((l) => {
    const q = num(l.qty) || 1;
    const a = num(l.amount);
    return {
      description: (l.description.trim() || options.find((o) => o.value === l.product)?.label || "Item").slice(0, 500),
      quantity: q,
      unitPrice: Math.round((a / q) * 10000) / 10000,
      accountId: productAccountId(l.product),
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

export function categoryLinesSchema(requireCategory = true) {
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
    .test("some", "Add at least one line with an amount", (rows) => filledCategoryLines((rows ?? []) as CategoryLine[]).length > 0);
}

export { num, fmt };
