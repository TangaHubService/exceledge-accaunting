import { AlertTriangle, Boxes, Package, ShoppingCart, Tag, Wrench } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { accountOptions } from "../../pages/Accounts";
import { useCompany } from "../../lib/company";
import { amount, date, humanize } from "../../lib/format";
import { useResource, useSession } from "../../lib/session";
import type { AccountType, ItemDetail, ItemDuplicate, ItemType, Supplier, TaxCode, TaxType } from "../../lib/types";
import { Footer, FormError, MoneyInput, parseAmount, useSubmit } from "../forms";
import { Select } from "../Select";
import { Section } from "../suppliers/SupplierFormDrawer";
import { Drawer, Field } from "../ui";

export const ITEM_TYPE_LABEL: Record<ItemType, string> = { SERVICE: "Service", NON_INVENTORY: "Non-stock", INVENTORY: "Stock" };

const TYPE_CHOICES: Array<{ value: ItemType; title: string; body: string; icon: typeof Wrench }> = [
  { value: "SERVICE", title: "Service", body: "Work you sell or buy, like hours, delivery or installation.", icon: Wrench },
  { value: "NON_INVENTORY", title: "Non-stock", body: "Goods you buy or sell without counting stock, like supplies.", icon: Package },
  { value: "INVENTORY", title: "Stock", body: "Counted goods. These come from the ERP, which keeps quantities and cost.", icon: Boxes },
];

const SALES_TAX_TYPES: TaxType[] = ["OUTPUT_VAT", "ZERO_RATED", "EXEMPT", "EXCISE", "OTHER"];
const PURCHASE_TAX_TYPES: TaxType[] = ["INPUT_VAT", "IMPORT_VAT", "ZERO_RATED", "EXEMPT", "EXCISE", "OTHER"];
const INCOME_TYPES: AccountType[] = ["INCOME", "OTHER_INCOME"];
const EXPENSE_TYPES: AccountType[] = ["COST_OF_SALES", "EXPENSE", "OTHER_EXPENSE", "ASSET"];

type Draft = {
  type: ItemType;
  name: string;
  sku: string;
  category: string;
  unit: string;
  isActive: boolean;
  sells: boolean;
  salesDescription: string;
  salesPrice: string;
  incomeAccountId: string;
  salesTaxCode: string;
  buys: boolean;
  purchaseDescription: string;
  purchaseCost: string;
  expenseAccountId: string;
  purchaseTaxCode: string;
  preferredSupplierId: string;
  reorderPoint: string;
};

const money = (n: number | null | undefined) => (n == null ? "" : String(n));

function draftFrom(item: ItemDetail | undefined, copy: boolean, initialName: string): Draft {
  const buys = Boolean(item && (item.purchaseCost != null || item.purchaseDescription || item.expenseAccount || item.preferredSupplier));
  return {
    type: copy && item?.type === "INVENTORY" ? "NON_INVENTORY" : item?.type ?? "SERVICE",
    name: copy ? `${item!.name} (copy)` : item?.name ?? initialName,
    sku: copy ? "" : item?.sku ?? "",
    category: item?.category ?? "",
    unit: item?.unit ?? "",
    isActive: item?.isActive ?? true,
    sells: item ? item.salesPrice != null || Boolean(item.salesDescription || item.incomeAccount) || !buys : true,
    salesDescription: item?.salesDescription ?? "",
    salesPrice: money(item?.salesPrice),
    incomeAccountId: item?.incomeAccount?.id ?? "",
    salesTaxCode: item?.salesTaxCode ?? "",
    buys,
    purchaseDescription: item?.purchaseDescription ?? "",
    purchaseCost: money(item?.purchaseCost),
    expenseAccountId: item?.expenseAccount?.id ?? "",
    purchaseTaxCode: item?.purchaseTaxCode ?? "",
    preferredSupplierId: item?.preferredSupplier?.id ?? "",
    reorderPoint: copy ? "" : money(item?.reorderPoint),
  };
}

function validate(d: Draft) {
  const e: Partial<Record<keyof Draft, string>> = {};
  if (!d.name.trim()) e.name = "Give the item a name";
  const bad = (v: string) => v.trim() !== "" && !(parseAmount(v) >= 0);
  if (d.sells && bad(d.salesPrice)) e.salesPrice = "Enter a price of 0 or more";
  if (d.buys && bad(d.purchaseCost)) e.purchaseCost = "Enter a cost of 0 or more";
  if (bad(d.reorderPoint)) e.reorderPoint = "Enter 0 or more";
  return e;
}

type SectionId = "sales" | "purchasing" | "stock";

/**
 * Add or edit a product or service (QuickBooks product/service form): type, basic details, sales and purchasing
 * defaults, and, for ERP stock items, quantities and the reorder point. ERP-managed fields are read-only.
 */
export function ItemFormDrawer({
  itemId,
  copyOf,
  initialName,
  categories,
  onClose,
  onSaved,
}: {
  /** Edit this item. */
  itemId?: string;
  /** Start a new item from this one. */
  copyOf?: string;
  initialName?: string;
  categories: string[];
  onClose: () => void;
  onSaved: (item: ItemDetail) => void;
}) {
  const sourceId = itemId ?? copyOf;
  const loaded = useResource<ItemDetail>(sourceId ? `/api/v1/inventory/items/${sourceId}` : null);
  if (sourceId && !loaded.data) {
    return (
      <Drawer title={itemId ? "Edit item" : "New item"} onClose={onClose}>
        {loaded.error ? <FormError message={loaded.error} /> : <p className="muted">Loading…</p>}
      </Drawer>
    );
  }
  return (
    <ItemForm
      key={sourceId ?? "new"}
      item={loaded.data}
      editing={Boolean(itemId)}
      initialName={initialName ?? ""}
      categories={categories}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function ItemForm({
  item,
  editing,
  initialName,
  categories,
  onClose,
  onSaved,
}: {
  item?: ItemDetail;
  editing: boolean;
  initialName: string;
  categories: string[];
  onClose: () => void;
  onSaved: (item: ItemDetail) => void;
}) {
  const { api, can } = useSession();
  const { accounts, currency } = useCompany();
  const taxCodes = useResource<TaxCode[]>(can("tax:view") ? "/api/v1/tax/codes" : null);
  const suppliers = useResource<Supplier[]>(can("ap:view") ? "/api/v1/ap/suppliers" : null);
  const [d, setD] = useState<Draft>(() => draftFrom(item, !editing && Boolean(item), initialName));
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<keyof Draft, boolean>>>({});
  const [open, setOpen] = useState<Record<SectionId, boolean>>({ sales: true, purchasing: true, stock: true });
  const [dupes, setDupes] = useState<ItemDuplicate[]>([]);
  const { busy, error, setError, run } = useSubmit();

  const erp = editing && item?.source === "ERP";
  const stock = d.type === "INVENTORY";
  const errors = useMemo(() => validate(d), [d]);
  const show = (k: keyof Draft) => (submitted || touched[k] ? errors[k] : undefined);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const blur = (k: keyof Draft) => () => setTouched((t) => ({ ...t, [k]: true }));

  const incomeOptions = useMemo(
    () => [{ value: "", label: "Company default sales account" }, ...accountOptions(accounts.filter((a) => a.isActive && INCOME_TYPES.includes(a.type)))],
    [accounts],
  );
  const expenseOptions = useMemo(
    () => [{ value: "", label: "Company default purchases account" }, ...accountOptions(accounts.filter((a) => a.isActive && EXPENSE_TYPES.includes(a.type)))],
    [accounts],
  );
  const taxOptionsFor = (types: TaxType[]) => [
    { value: "", label: "No tax code" },
    ...(taxCodes.data ?? []).filter((t) => t.isActive && types.includes(t.taxType)).map((t) => ({ value: t.code, label: t.name, prefix: t.code, hint: `${t.ratePercent}%` })),
  ];
  const salesTaxOptions = useMemo(() => taxOptionsFor(SALES_TAX_TYPES), [taxCodes.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const purchaseTaxOptions = useMemo(() => taxOptionsFor(PURCHASE_TAX_TYPES), [taxCodes.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const supplierOptions = useMemo(
    () => [{ value: "", label: "None" }, ...(suppliers.data ?? []).filter((s) => s.status === "ACTIVE" || s.id === d.preferredSupplierId).map((s) => ({ value: s.id, label: s.name, hint: s.code }))],
    [suppliers.data, d.preferredSupplierId],
  );

  // Name and SKU must be unique; warn as they settle rather than on save.
  const dupeKey = `${d.name.trim()}|${d.sku.trim()}`;
  useEffect(() => {
    const [name, sku] = dupeKey.split("|");
    if ((!name && !sku) || erp) {
      setDupes([]);
      return;
    }
    let live = true;
    const t = window.setTimeout(() => {
      const q = new URLSearchParams();
      if (name) q.set("name", name);
      if (sku) q.set("sku", sku);
      if (editing && item) q.set("excludeId", item.id);
      api<ItemDuplicate[]>(`/api/v1/inventory/items/duplicates?${q.toString()}`)
        .then((rows) => live && setDupes(rows))
        .catch(() => live && setDupes([]));
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [dupeKey, api, editing, item, erp]);

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const bad = Object.keys(errors) as Array<keyof Draft>;
    if (bad.length) {
      setOpen((o) => ({
        sales: o.sales || bad.includes("salesPrice"),
        purchasing: o.purchasing || bad.includes("purchaseCost"),
        stock: o.stock || bad.includes("reorderPoint"),
      }));
      return;
    }
    if (dupes[0]) {
      const x = dupes[0];
      setError(x.matched.includes("name") ? `An item named "${x.name}" already exists.` : `SKU ${x.sku} is already used by ${x.name}.`);
      return;
    }
    const empty = editing ? null : undefined;
    const text = (v: string) => v.trim() || empty;
    const num = (v: string) => (v.trim() === "" ? empty : parseAmount(v));
    const body: Record<string, unknown> = {
      salesDescription: d.sells ? text(d.salesDescription) : empty,
      salesPrice: d.sells ? num(d.salesPrice) : empty,
      incomeAccountId: d.sells ? d.incomeAccountId || empty : empty,
      salesTaxCode: d.sells ? d.salesTaxCode || empty : empty,
      purchaseDescription: d.buys ? text(d.purchaseDescription) : empty,
      purchaseCost: d.buys && !stock ? num(d.purchaseCost) : empty,
      expenseAccountId: d.buys && !stock ? d.expenseAccountId || empty : empty,
      purchaseTaxCode: d.buys ? d.purchaseTaxCode || empty : empty,
      preferredSupplierId: d.buys ? d.preferredSupplierId || empty : empty,
    };
    if (!erp) Object.assign(body, { name: d.name.trim(), sku: text(d.sku), category: text(d.category), unit: text(d.unit), type: d.type });
    if (stock) body.reorderPoint = num(d.reorderPoint);
    if (editing) body.isActive = d.isActive;
    void run(async () => {
      const saved = editing
        ? await api<ItemDetail>(`/api/v1/inventory/items/${item!.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : await api<ItemDetail>("/api/v1/inventory/items", { method: "POST", body: JSON.stringify(body) });
      onSaved(saved);
      return editing ? `${saved.name} updated` : `${saved.name} added`;
    });
  }

  const toggle = (id: SectionId) => () => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const typeLocked = editing && (item?.type === "INVENTORY" || erp);
  const erpHint = erp ? "Managed in the ERP" : undefined;

  return (
    <Drawer
      title={editing ? `Edit ${item!.name}` : item ? "Duplicate item" : "New product or service"}
      subtitle={
        erp
          ? "This stock item comes from the ERP. Its name, SKU, category, unit and quantities follow the ERP; prices, accounts and tax are set here."
          : "Only the name is required. Prices and accounts fill in automatically on invoices and bills."
      }
      wide
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label={editing ? "Save changes" : "Save item"} formId="item-form" />}
    >
      <form id="item-form" className="cf" onSubmit={submit} noValidate>
        <FormError message={error} />

        {!typeLocked && (
          <div className="ps-types" role="radiogroup" aria-label="Item type">
            {TYPE_CHOICES.map((t) => {
              const disabled = t.value === "INVENTORY";
              const Icon = t.icon;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={d.type === t.value}
                  aria-disabled={disabled}
                  disabled={disabled}
                  className={`ps-type ${d.type === t.value ? "on" : ""}`}
                  onClick={() => set("type", t.value)}
                  title={disabled ? "Stock items are created in the ERP and appear here automatically" : undefined}
                >
                  <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                  <span className="strong">{t.title}</span>
                  <span className="sub">{t.body}</span>
                </button>
              );
            })}
          </div>
        )}

        {dupes.length > 0 && (
          <div className="cf-dupes blocking" role="status">
            <AlertTriangle size={16} aria-hidden="true" />
            <div>
              <strong>This item already exists</strong>
              <ul>
                {dupes.map((x) => (
                  <li key={x.id}>
                    {x.name}{" "}
                    <span className="muted">
                      {x.sku ? `SKU ${x.sku} · ` : ""}same {x.matched.join(" and ")}
                      {x.isActive ? "" : " · inactive"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="small muted">Names and SKUs must be unique, including inactive items.</p>
            </div>
          </div>
        )}

        <div className="cf-basic">
          <div className="form-grid">
            <Field label="Name" required error={show("name")} className="span-2" hint={erpHint}>
              <input
                className="input"
                value={d.name}
                onChange={(e) => {
                  set("name", e.target.value);
                  setTouched((t) => ({ ...t, name: true }));
                }}
                maxLength={200}
                autoComplete="off"
                disabled={erp}
              />
            </Field>
            <Field label="SKU" hint={erpHint ?? "Your own product code"}>
              <input className="input" value={d.sku} onChange={(e) => set("sku", e.target.value)} maxLength={80} autoComplete="off" disabled={erp} />
            </Field>
            <Field label="Category" hint={erpHint}>
              <input className="input" list="item-categories" value={d.category} onChange={(e) => set("category", e.target.value)} maxLength={100} disabled={erp} placeholder="Choose or type a new one" />
              <datalist id="item-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="Unit" hint={erpHint ?? "e.g. hour, pcs, kg"}>
              <input className="input" value={d.unit} onChange={(e) => set("unit", e.target.value)} maxLength={30} disabled={erp} />
            </Field>
            {typeLocked && (
              <Field label="Type">
                <input className="input" value={ITEM_TYPE_LABEL[d.type]} disabled />
              </Field>
            )}
            {editing && (
              <Field label="Status" hint="Inactive items are hidden from new transactions; their history stays">
                <Select
                  value={d.isActive ? "1" : "0"}
                  onChange={(v) => set("isActive", v === "1")}
                  searchable={false}
                  options={[
                    { value: "1", label: "Active" },
                    { value: "0", label: "Inactive" },
                  ]}
                />
              </Field>
            )}
          </div>
        </div>

        <Section
          title="Sales"
          icon={Tag}
          open={open.sales}
          onToggle={toggle("sales")}
          summary={d.sells ? [d.salesPrice && `${currency} ${amount(parseAmount(d.salesPrice) || 0, 2)}`, d.salesTaxCode].filter(Boolean).join(" · ") || "Sold" : "Not sold"}
        >
          <label className="checkbox ps-check">
            <input type="checkbox" checked={d.sells} onChange={(e) => set("sells", e.target.checked)} />
            <span>I sell this {d.type === "SERVICE" ? "service" : "product"} to my customers</span>
          </label>
          {d.sells && (
            <div className="form-grid">
              <Field label="Description on sales forms" className="span-2">
                <textarea className="input" rows={2} value={d.salesDescription} onChange={(e) => set("salesDescription", e.target.value)} maxLength={1000} />
              </Field>
              <Field label={`Sales price / rate (${currency})`} error={show("salesPrice")}>
                <MoneyInput value={d.salesPrice} onChange={(v) => set("salesPrice", v)} invalid={Boolean(show("salesPrice"))} aria-label="Sales price" />
              </Field>
              <Field label="Sales tax">
                <Select value={d.salesTaxCode} onChange={(v) => set("salesTaxCode", v)} options={salesTaxOptions} searchable={false} />
              </Field>
              <Field label="Income account" className="span-2" hint="Where the sale is recorded when this item is invoiced">
                <Select value={d.incomeAccountId} onChange={(v) => set("incomeAccountId", v)} options={incomeOptions} />
              </Field>
            </div>
          )}
        </Section>

        <Section
          title="Purchasing"
          icon={ShoppingCart}
          open={open.purchasing}
          onToggle={toggle("purchasing")}
          summary={d.buys ? [d.purchaseCost && `${currency} ${amount(parseAmount(d.purchaseCost) || 0, 2)}`, supplierOptions.find((s) => s.value === d.preferredSupplierId && s.value)?.label].filter(Boolean).join(" · ") || "Bought" : "Not bought"}
        >
          <label className="checkbox ps-check">
            <input type="checkbox" checked={d.buys} onChange={(e) => set("buys", e.target.checked)} />
            <span>I purchase this {d.type === "SERVICE" ? "service" : "product"} from a supplier</span>
          </label>
          {d.buys && (
            <div className="form-grid">
              <Field label="Description on purchase forms" className="span-2">
                <textarea className="input" rows={2} value={d.purchaseDescription} onChange={(e) => set("purchaseDescription", e.target.value)} maxLength={1000} />
              </Field>
              {!stock && (
                <Field label={`Cost (${currency})`} error={show("purchaseCost")}>
                  <MoneyInput value={d.purchaseCost} onChange={(v) => set("purchaseCost", v)} invalid={Boolean(show("purchaseCost"))} aria-label="Cost" />
                </Field>
              )}
              <Field label="Purchase tax">
                <Select value={d.purchaseTaxCode} onChange={(v) => set("purchaseTaxCode", v)} options={purchaseTaxOptions} searchable={false} />
              </Field>
              {!stock && (
                <Field label="Expense account" className="span-2" hint="Where the cost is recorded when this item is billed">
                  <Select value={d.expenseAccountId} onChange={(v) => set("expenseAccountId", v)} options={expenseOptions} />
                </Field>
              )}
              <Field label="Preferred supplier" className={stock ? undefined : "span-2"}>
                <Select value={d.preferredSupplierId} onChange={(v) => set("preferredSupplierId", v)} options={supplierOptions} />
              </Field>
            </div>
          )}
        </Section>

        {stock && item && (
          <Section
            title="Stock"
            icon={Boxes}
            open={open.stock}
            onToggle={toggle("stock")}
            summary={`${amount(item.quantity ?? 0)} ${item.unit ?? "on hand"}`}
          >
            <div className="ps-stock">
              <div>
                <span className="field-label">Quantity on hand</span>
                <span className="ps-stock-num">
                  {amount(item.quantity ?? 0)} {item.unit ?? ""}
                </span>
              </div>
              <div>
                <span className="field-label">Stock value ({currency})</span>
                <span className="ps-stock-num">{amount(item.value ?? 0, 2)}</span>
              </div>
              <div>
                <span className="field-label">Average cost</span>
                <span className="ps-stock-num">{item.averageCost != null ? amount(item.averageCost, 2) : "—"}</span>
              </div>
            </div>
            {item.locations.length > 1 && (
              <table className="table ps-locations">
                <thead>
                  <tr>
                    <th>Location</th>
                    <th className="num">Quantity</th>
                    <th className="num">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {item.locations.map((l) => (
                    <tr key={l.id}>
                      <td>{l.name}</td>
                      <td className="num">{amount(l.quantity)}</td>
                      <td className="num">{amount(l.value, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="small muted">
              Quantities and cost come from the ERP
              {item.lastMovement ? `; last movement ${humanize(item.lastMovement.kind).toLowerCase()} on ${date(item.lastMovement.movementDate)}` : ""}.
            </p>
            <div className="form-grid">
              <Field label="Reorder point" error={show("reorderPoint")} hint="Flag the item as low stock at or below this quantity">
                <input className="input" inputMode="decimal" value={d.reorderPoint} onChange={(e) => set("reorderPoint", e.target.value)} onBlur={blur("reorderPoint")} />
              </Field>
            </div>
          </Section>
        )}
      </form>
    </Drawer>
  );
}
