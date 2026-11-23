import { useCallback, useEffect, useMemo, useState } from "react";
import type { SelectOption } from "../components/Select";
import { useCompany } from "./company";
import { amount, isoDay } from "./format";
import { linkToProject, pushRecordInBackground, removeRecordInBackground } from "./server-store";
import { useResource, useSession } from "./session";
import type { AccountType, Customer, ItemType, Supplier, TaxCode, TaxType } from "./types";

/* ── Terms & methods ───────────────────────────────────── */

export const TERMS = [
  { value: "DUE_ON_RECEIPT", label: "Due on receipt", days: 0 },
  { value: "NET_15", label: "Net 15", days: 15 },
  { value: "NET_30", label: "Net 30", days: 30 },
  { value: "NET_60", label: "Net 60", days: 60 },
] as const;

export function termDays(term: string) {
  return TERMS.find((t) => t.value === term)?.days ?? 0;
}

/** Customer/AR payment methods (ar.routes payMethod). */
export const AR_METHODS: SelectOption[] = [
  { value: "CASH", label: "Cash" },
  { value: "BANK", label: "Bank transfer" },
  { value: "MOBILE_MONEY", label: "Mobile money" },
  { value: "CARD", label: "Card" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "ONLINE", label: "Online" },
];

/** Banking module methods (banking.routes METHODS). */
export const BANK_TXN_METHODS: SelectOption[] = [
  { value: "CASH", label: "Cash" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "MOBILE_MONEY", label: "Mobile money" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "EFT", label: "EFT" },
  { value: "CARD", label: "Card" },
  { value: "OTHER", label: "Other" },
];

/** Map an AR method onto the banking module's method list. */
export function toBankMethod(method: string) {
  return method === "BANK" ? "BANK_TRANSFER" : method === "ONLINE" ? "EFT" : method || undefined;
}

export function addDays(day: string, days: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function monthsAgo(day: string, months: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** "a@b.rw, c@d.rw" → valid when every part is an email. */
export function emailListValid(text: string) {
  const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.every((p) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p));
}

export function rwf(value: number, currency = "RWF") {
  return `${currency} ${amount(value, 2)}`;
}

/* ── Parties & accounts ────────────────────────────────── */

export function useCustomers() {
  const { can } = useSession();
  const list = useResource<Customer[]>(can("ar:view") ? "/api/v1/ar/customers" : null);
  const active = useMemo(() => (list.data ?? []).filter((c) => c.status === "ACTIVE"), [list.data]);
  return { customers: active, loading: list.loading, reload: list.reload };
}

export function useSuppliers() {
  const { can } = useSession();
  const list = useResource<Supplier[]>(can("ap:view") ? "/api/v1/ap/suppliers" : null);
  const active = useMemo(() => (list.data ?? []).filter((s) => s.status === "ACTIVE"), [list.data]);
  return { suppliers: active, loading: list.loading, reload: list.reload };
}

export const customerOptions = (list: Customer[]): SelectOption[] => list.map((c) => ({ value: c.id, label: c.name, hint: c.code }));
export const supplierOptions = (list: Supplier[]): SelectOption[] => list.map((s) => ({ value: s.id, label: s.name, hint: s.code }));

/** Payees across customers and suppliers, keyed "customer:<id>" / "supplier:<id>". */
export function usePayees() {
  const { customers } = useCustomers();
  const { suppliers } = useSuppliers();
  const options = useMemo<SelectOption[]>(
    () => [
      ...suppliers.map((s) => ({ value: `supplier:${s.id}`, label: s.name, hint: s.code, group: "Suppliers" })),
      ...customers.map((c) => ({ value: `customer:${c.id}`, label: c.name, hint: c.code, group: "Customers" })),
    ],
    [customers, suppliers],
  );
  const lookup = useCallback(
    (key: string) => {
      const [kind, id] = key.split(":");
      if (kind === "supplier") {
        const s = suppliers.find((x) => x.id === id);
        return s ? { kind: "supplier" as const, id, name: s.name, address: s.physicalAddress ?? "", email: s.email ?? "" } : undefined;
      }
      const c = customers.find((x) => x.id === id);
      return c ? { kind: "customer" as const, id, name: c.name, address: c.physicalAddress ?? "", email: c.email ?? "" } : undefined;
    },
    [customers, suppliers],
  );
  return { options, lookup };
}

const EXPENSE_TYPES: AccountType[] = ["COST_OF_SALES", "EXPENSE", "OTHER_EXPENSE", "ASSET"];
const INCOME_TYPES: AccountType[] = ["INCOME", "OTHER_INCOME"];

/** GL accounts that accept manual postings, optionally limited to some account types. */
export function useAccountOptions(types?: AccountType[]) {
  const { accounts } = useCompany();
  return useMemo<SelectOption[]>(
    () =>
      accounts
        .filter((a) => a.isActive && a.allowManualPost && (!types || types.includes(a.type)))
        .map((a) => ({ value: a.id, label: a.name, prefix: a.code, group: a.type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (m) => m.toUpperCase()) })),
    [accounts, types],
  );
}

export const useExpenseAccountOptions = () => useAccountOptions(EXPENSE_TYPES);
export const useIncomeAccountOptions = () => useAccountOptions(INCOME_TYPES);

export type InventoryItem = { id: string; name: string; sku: string; quantity: number; unitCost: number };

/** Items on hand, summed across locations (from the valuation report). */
const EMPTY_ITEMS: InventoryItem[] = [];

export function useInventoryItems() {
  const { can } = useSession();
  const list = useResource<InventoryItem[]>(can("inventory:view") ? "/api/v1/inventory/items" : null);
  return list.data ?? EMPTY_ITEMS;
}

/** An active item from Products and services, with the defaults it brings to a transaction line. */
export type ProductItem = {
  id: string;
  name: string;
  sku: string | null;
  type: ItemType;
  unit: string | null;
  salesDescription: string | null;
  salesPrice: number | null;
  incomeAccountId: string | null;
  salesTaxCode: string | null;
  purchaseDescription: string | null;
  purchaseCost: number | null;
  expenseAccountId: string | null;
  purchaseTaxCode: string | null;
};
const EMPTY_PRODUCTS: ProductItem[] = [];

/** Product/service picker: items from Products and services, then income accounts, keyed "item:" / "acct:". */
export function useProductOptions() {
  const income = useIncomeAccountOptions();
  const items = useProductItems();
  const options = useMemo<SelectOption[]>(
    () => [
      ...items.map((i) => ({ value: `item:${i.id}`, label: i.name, hint: i.sku || undefined, group: "Products and services" })),
      ...income.map((o) => ({ ...o, value: `acct:${o.value}`, group: "Income accounts" })),
    ],
    [items, income],
  );
  return { options, items };
}

/** Bill item picker: services and non-stock items only. Stock is bought through ERP item receipts, so stock items stay off bills. */
export function usePurchaseItemOptions() {
  const all = useProductItems();
  const items = useMemo(() => all.filter((i) => i.type !== "INVENTORY"), [all]);
  const options = useMemo<SelectOption[]>(() => items.map((i) => ({ value: `item:${i.id}`, label: i.name, hint: i.sku || undefined })), [items]);
  return { options, items };
}

function useProductItems() {
  const { can } = useSession();
  const list = useResource<ProductItem[]>(can("inventory:view") ? "/api/v1/inventory/items/options" : null);
  return list.data ?? EMPTY_PRODUCTS;
}

/** The account a line posts to: the chosen account, or the chosen item's income (sales) or expense (purchase) account; else the server default. */
export function productAccountId(product: string, items: ProductItem[] = EMPTY_PRODUCTS, side: "sales" | "purchase" = "sales") {
  if (product.startsWith("acct:")) return product.slice(5);
  if (product.startsWith("item:")) {
    const item = items.find((i) => i.id === product.slice(5));
    return (side === "sales" ? item?.incomeAccountId : item?.expenseAccountId) ?? undefined;
  }
  return undefined;
}

const SALES_TAX_TYPES: TaxType[] = ["OUTPUT_VAT", "ZERO_RATED", "EXEMPT", "EXCISE", "OTHER"];
const PURCHASE_TAX_TYPES: TaxType[] = ["INPUT_VAT", "IMPORT_VAT", "ZERO_RATED", "EXEMPT", "EXCISE", "OTHER"];
const NO_TAX: { options?: SelectOption[]; rates: Map<string, number> } = { options: undefined, rates: new Map() };

/**
 * Tax codes a sales or purchase line can carry on `onDate`, with their rates. `options` is undefined when the user
 * can't see tax codes, which hides the Tax column.
 */
export function useLineTaxCodes(side: "sales" | "purchase", onDate: string) {
  const { can } = useSession();
  const codes = useResource<TaxCode[]>(can("tax:view") ? "/api/v1/tax/codes" : null);
  return useMemo(() => {
    if (!codes.data) return NO_TAX;
    const types = side === "sales" ? SALES_TAX_TYPES : PURCHASE_TAX_TYPES;
    const day = onDate || isoDay();
    const usable = codes.data.filter(
      (t) => t.isActive && types.includes(t.taxType) && t.effectiveFrom.slice(0, 10) <= day && (!t.effectiveTo || t.effectiveTo.slice(0, 10) >= day),
    );
    return {
      options: [{ value: "", label: "No tax" }, ...usable.map((t) => ({ value: t.code, label: t.code, hint: `${t.ratePercent}%` }))],
      rates: new Map(usable.map((t) => [t.code, Number(t.ratePercent)])),
    };
  }, [codes.data, side, onDate]);
}

/* ── Local records ─────────────────────────────────────── */
// Documents with no backend endpoint yet (estimates, sales orders, POs, projects, tasks, …) live in
// this browser. Every saved document — local or posted — is also indexed so projects can list them.

export type TxnKind =
  | "invoice"
  | "payment"
  | "statement"
  | "estimate"
  | "proposal"
  | "sales-order"
  | "credit-note"
  | "sales-receipt"
  | "refund-receipt"
  | "delayed-credit"
  | "delayed-charge"
  | "bill"
  | "cheque"
  | "bill-payment"
  | "purchase-order"
  | "item-receipt"
  | "supplier-credit"
  | "credit-card-credit"
  | "bank-deposit"
  | "transfer"
  | "journal"
  | "inventory-adjustment"
  | "credit-card-payment"
  | "expense"
  | "time";

export const TXN_LABELS: Record<TxnKind, string> = {
  invoice: "Invoice",
  payment: "Payment",
  statement: "Statement",
  estimate: "Estimate",
  proposal: "Proposal",
  "sales-order": "Sales order",
  "credit-note": "Credit note",
  "sales-receipt": "Sales receipt",
  "refund-receipt": "Refund receipt",
  "delayed-credit": "Delayed credit",
  "delayed-charge": "Delayed charge",
  bill: "Bill",
  cheque: "Cheque",
  "bill-payment": "Bill payment",
  "purchase-order": "Purchase order",
  "item-receipt": "Item receipt",
  "supplier-credit": "Supplier credit",
  "credit-card-credit": "Credit card credit",
  "bank-deposit": "Bank deposit",
  transfer: "Transfer",
  journal: "Journal entry",
  "inventory-adjustment": "Inventory adjustment",
  "credit-card-payment": "Credit card payment",
  expense: "Expense",
  time: "Time activity",
};

/** Kinds that bring money in (project income) vs. spend it (project costs). */
export const INCOME_KINDS: TxnKind[] = ["invoice", "sales-receipt", "delayed-charge"];
export const COST_KINDS: TxnKind[] = ["bill", "cheque", "expense", "credit-card-credit", "purchase-order"];

export type TxnIndexRow = {
  id: string;
  kind: TxnKind;
  number: string;
  date: string;
  party: string;
  amount: number;
  memo: string;
  status: string;
  projectId?: string;
  /** Saved through the API (posted to the books) rather than kept in this browser. */
  posted: boolean;
  createdAt: string;
};

const INDEX_KEY = "ee.txn.index";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the record still saved to the server where there is one.
  }
  window.dispatchEvent(new CustomEvent("ee-local-store", { detail: key }));
}

export function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function readLocal<T>(collection: string): T[] {
  return read<T[]>(`ee.local.${collection}`, []);
}

export function saveLocal<T extends { id: string }>(collection: string, record: T) {
  const list = readLocal<T>(collection).filter((r) => r.id !== record.id);
  write(`ee.local.${collection}`, [record, ...list]);
  pushRecordInBackground(collection, record);
  return record;
}

export function removeLocal(collection: string, id: string) {
  write(`ee.local.${collection}`, readLocal<{ id: string }>(collection).filter((r) => r.id !== id));
  removeRecordInBackground(collection, id);
}

/** Next document number for a local sequence, starting at `start`. Reserved on save with `takeNumber`. */
export function peekNumber(sequence: string, start = 1001) {
  return String(read<number>(`ee.seq.${sequence}`, start));
}

export function takeNumber(sequence: string, used: string, start = 1001) {
  const n = Number(used);
  const current = read<number>(`ee.seq.${sequence}`, start);
  if (Number.isFinite(n) && n >= current) write(`ee.seq.${sequence}`, n + 1);
}

export function indexTxn(row: Omit<TxnIndexRow, "id" | "createdAt"> & { id?: string }) {
  const full: TxnIndexRow = { ...row, id: row.id ?? newId(), createdAt: new Date().toISOString() };
  const list = read<TxnIndexRow[]>(INDEX_KEY, []).filter((r) => r.id !== full.id);
  write(INDEX_KEY, [full, ...list].slice(0, 2000));
  if (full.projectId) linkToProject(full.projectId, full.kind, full.id);
  return full;
}

/** Re-renders when any local collection changes (in this tab or another). */
export function useLocalCollection<T>(collection: string) {
  const [rows, setRows] = useState<T[]>(() => readLocal<T>(collection));
  useEffect(() => {
    const key = `ee.local.${collection}`;
    const refresh = () => setRows(readLocal<T>(collection));
    const onLocal = (e: Event) => (e as CustomEvent<string>).detail === key && refresh();
    const onStorage = (e: StorageEvent) => e.key === key && refresh();
    window.addEventListener("ee-local-store", onLocal);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("ee-local-store", onLocal);
      window.removeEventListener("storage", onStorage);
    };
  }, [collection]);
  return rows;
}

export function useTxnIndex() {
  const [rows, setRows] = useState<TxnIndexRow[]>(() => read<TxnIndexRow[]>(INDEX_KEY, []));
  useEffect(() => {
    const refresh = () => setRows(read<TxnIndexRow[]>(INDEX_KEY, []));
    const onLocal = (e: Event) => (e as CustomEvent<string>).detail === INDEX_KEY && refresh();
    window.addEventListener("ee-local-store", onLocal);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("ee-local-store", onLocal);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return rows;
}

/* ── Recurring templates ───────────────────────────────── */

export type RecurringTemplate = {
  id: string;
  kind: TxnKind;
  name: string;
  interval: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  every: number;
  startDate: string;
  endDate: string;
  daysInAdvance: number;
  snapshot: unknown;
  createdAt: string;
};

export function saveRecurring(t: Omit<RecurringTemplate, "id" | "createdAt">) {
  return saveLocal<RecurringTemplate>("recurring", { ...t, id: newId(), createdAt: new Date().toISOString() });
}

export const today = () => isoDay();
