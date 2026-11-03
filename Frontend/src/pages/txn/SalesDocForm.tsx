import { ChevronDown, ChevronUp, Lightbulb, MessageSquareText, MonitorPlay, Printer, RefreshCw, Settings, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AddCustomerDrawer } from "../../components/customers/AddCustomerDrawer";
import { useFeedback } from "../../components/feedback";
import { Select } from "../../components/Select";
import {
  emptyProductLine,
  filledProductLines,
  fmt,
  num,
  previewLines,
  type ProductLine,
  productColumns,
  productLinesPayload,
  productLinesSchema,
  productTotal,
} from "../../components/txn/lines";
import {
  AttachmentBox,
  CompanyBlock,
  DocPreview,
  ErrorBanner,
  FeedbackModal,
  GridTools,
  LineGrid,
  LogoPicker,
  Modal,
  PartySelect,
  type PickedFile,
  readClipboardRows,
  RecurringModal,
  SplitButton,
  TextArea,
  TField,
  Totals,
  TxnFooter,
  TxnPage,
  uploadAttachments,
  useValidation,
  ValidationSummary,
} from "../../components/txn/TxnKit";
import { useCompany } from "../../lib/company";
import { amount, isoDay } from "../../lib/format";
import { navigate, useLocation } from "../../lib/router";
import { useSession } from "../../lib/session";
import {
  addDays,
  customerOptions,
  emailListValid,
  indexTxn,
  newId,
  peekNumber,
  rwf,
  saveLocal,
  takeNumber,
  TERMS,
  termDays,
  type TxnKind,
  useCustomers,
  useProductOptions,
} from "../../lib/txn";
import { yup } from "../../lib/validation";
import type { Customer } from "../../lib/types";

export type SalesDocKind = "invoice" | "estimate" | "proposal" | "sales-order";

const TITLES: Record<SalesDocKind, string> = { invoice: "Invoice", estimate: "Estimate", proposal: "Proposal", "sales-order": "Sales order" };
const LIST_PAGE: Record<SalesDocKind, string> = { invoice: "/invoices", estimate: "/invoices", proposal: "/invoices", "sales-order": "/invoices" };

type Custom = Record<string, boolean>;
const DEFAULT_CUSTOM: Custom = {
  shipTo: false,
  billTo: true,
  noteToCustomer: true,
  internalMemo: true,
  number: true,
  terms: true,
  docDate: true,
  dueDate: true,
  lineNumber: true,
  sku: false,
  description: true,
  quantity: true,
  rate: true,
  amount: true,
};
type Design = { color: string; printerFriendly: boolean; font: string };
const DEFAULT_DESIGN: Design = { color: "#0077c5", printerFriendly: false, font: "Helvetica Neue" };
const SWATCHES = ["#777777", "#000000", "#8b9cc0", "#4d5b6b", "#8bc57a", "#2aa5a8", "#0b78d1", "#9fc53b", "#2b6a1d", "#b0634c", "#f7900a", "#8f0a1b", "#86184f", "#f17fa7", "#b5068a", "#5d2a62"];
const FONTS = ["Helvetica Neue", "Arial", "Georgia", "Times New Roman", "Verdana", "Plus Jakarta Sans"];

function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}
function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Preferences are a convenience; ignore storage errors.
  }
}

type Form = {
  customerId: string;
  leadName: string;
  leadEmail: string;
  contact: string;
  billTo: string;
  shipTo: string;
  number: string;
  terms: string;
  docDate: string;
  dueDate: string;
  expirationDate: string;
  acceptedBy: string;
  acceptedDate: string;
  paymentOptions: string;
  note: string;
  memo: string;
  discountPct: string;
  depositMode: "%" | "RWF";
  deposit: string;
  lines: ProductLine[];
};

export function SalesDocForm({ kind }: { kind: SalesDocKind }) {
  const { api } = useSession();
  const { toast } = useFeedback();
  const { currency } = useCompany();
  const { query } = useLocation();
  const { customers, reload: reloadCustomers } = useCustomers();
  const { options: productOptions, items } = useProductOptions();
  const v = useValidation();
  const title = TITLES[kind];
  const isOrder = kind === "sales-order";
  const isInvoice = kind === "invoice";
  const isQuote = kind === "estimate" || kind === "proposal";
  const sequence = kind === "proposal" ? "estimate" : kind;

  const blank = (): Form => {
    const docDate = isoDay();
    return {
      customerId: query.get("customer") ?? "",
      leadName: query.get("lead") ?? "",
      leadEmail: query.get("leadEmail") ?? "",
      contact: "",
      billTo: "",
      shipTo: "",
      number: isInvoice ? "" : peekNumber(sequence),
      terms: "NET_30",
      docDate,
      dueDate: addDays(docDate, 30),
      expirationDate: "",
      acceptedBy: "",
      acceptedDate: "",
      paymentOptions: "",
      note: isOrder ? "Thank you for your business" : "Thank you for your business.",
      memo: "",
      discountPct: "",
      depositMode: "%",
      deposit: "",
      lines: isOrder ? [emptyProductLine(), emptyProductLine()] : [emptyProductLine()],
    };
  };
  const [form, setForm] = useState<Form>(blank);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [tab, setTab] = useState("Edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ number: string; id: string } | null>(null);
  const [addCustomer, setAddCustomer] = useState(false);
  const [panel, setPanel] = useState(isOrder);
  const [tour, setTour] = useState<number | null>(null);
  const [recurring, setRecurring] = useState(false);
  const [review, setReview] = useState<null | "send">(null);
  const [feedback, setFeedback] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(true);
  const [showEditTotals, setShowEditTotals] = useState(false);
  const [custom, setCustom] = useState<Custom>(() => loadPref(`ee.custom.${kind}`, DEFAULT_CUSTOM));
  const [design, setDesign] = useState<Design>(() => loadPref(`ee.design.${kind}`, DEFAULT_DESIGN));
  useEffect(() => {
    savePref(`ee.custom.${kind}`, custom);
  }, [custom, kind]);
  useEffect(() => {
    savePref(`ee.design.${kind}`, design);
  }, [design, kind]);

  const customer = customers.find((c) => c.id === form.customerId);
  const partyName = customer?.name ?? form.leadName;
  const subtotal = productTotal(form.lines);
  const discount = Math.min(subtotal, (subtotal * (num(form.discountPct) || 0)) / 100);
  const total = Math.round((subtotal - discount) * 100) / 100;
  const deposit = form.depositMode === "%" ? (total * (num(form.deposit) || 0)) / 100 : num(form.deposit) || 0;

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    v.clear(key);
  }

  function pickCustomer(id: string, list: Customer[] = customers) {
    const c = list.find((x) => x.id === id);
    setForm((f) => {
      const terms = c && c.creditPeriodDays ? (TERMS.find((t) => t.days === c.creditPeriodDays)?.value ?? f.terms) : f.terms;
      return {
        ...f,
        customerId: id,
        contact: c?.email ?? c?.telephone ?? f.contact,
        billTo: c ? [c.name, c.physicalAddress].filter(Boolean).join("\n") : f.billTo,
        terms,
        dueDate: addDays(f.docDate, termDays(terms)),
      };
    });
    v.clear("customerId");
  }

  // Keep the due date following the terms until the user picks one by hand.
  const [dueTouched, setDueTouched] = useState(false);
  useEffect(() => {
    if (!dueTouched) setForm((f) => ({ ...f, dueDate: addDays(f.docDate, termDays(f.terms)) }));
  }, [form.docDate, form.terms, dueTouched]);

  const schema = useMemo(
    () =>
      yup.object({
        customerId: yup.string().test("party", "Choose a customer", function (val) {
          return kind === "proposal" ? Boolean(val || this.parent.leadName?.trim()) : Boolean(val);
        }),
        number: isInvoice
          ? yup.string()
          : yup.string().trim().required(`Enter a ${title.toLowerCase()} number`).max(21, "Use 21 characters or fewer").matches(/^[A-Za-z0-9-/]+$/, "Letters, numbers, - and / only"),
        docDate: yup.string().required(`Choose the ${title.toLowerCase()} date`),
        dueDate: isInvoice || isOrder
          ? yup.string().required("Choose a due date").test("after", "Due date can't be before the date", function (val) {
              return !val || val >= this.parent.docDate;
            })
          : yup.string(),
        expirationDate: yup.string().test("exp", "Expiration can't be before the estimate date", function (val) {
          return !isQuote || !val || val >= this.parent.docDate;
        }),
        acceptedBy: yup.string().max(100, "Use 100 characters or fewer"),
        acceptedDate: yup
          .string()
          .test("needs-date", "Enter the date it was accepted", function (val) {
            return !isQuote || !this.parent.acceptedBy?.trim() || Boolean(val);
          })
          .test("after", "Accepted date can't be before the estimate date", function (val) {
            return !val || val >= this.parent.docDate;
          }),
        discountPct: yup.string().test("pct", "Discount must be between 0 and 100", (val) => !val || (num(val) >= 0 && num(val) <= 100)),
        deposit: yup.string().test("dep", "Deposit can't be more than the total", function (val) {
          if (!val) return true;
          const n = num(val);
          if (n < 0) return false;
          return this.parent.depositMode === "%" ? n <= 100 : n <= total;
        }),
        note: yup.string().max(1000, "Use 1,000 characters or fewer"),
        memo: yup.string().max(1000, "Use 1,000 characters or fewer"),
        lines: productLinesSchema(),
      }),
    [isInvoice, isOrder, isQuote, kind, title, total],
  );

  /** Lines with the "Edit totals" discount spread across them (the server prices per line). */
  function pricedLines() {
    const payload = productLinesPayload(form.lines, productOptions);
    if (!discount) return payload;
    let left = Math.round(discount * 100) / 100;
    return payload.map((l, i) => {
      const gross = l.quantity * l.unitPrice;
      const share = i === payload.length - 1 ? left : Math.round(((gross / subtotal) * discount) * 100) / 100;
      left = Math.round((left - share) * 100) / 100;
      return { ...l, discount: share > 0 ? share : undefined };
    });
  }

  async function save(after: "stay" | "new" | "close" | "send" | "share" | "whatsapp") {
    setError("");
    if (!(await v.validate(schema, form))) {
      setTab("Edit");
      return;
    }
    setBusy(true);
    try {
      let number = form.number;
      let id = newId();
      if (isInvoice) {
        const inv = await api<{ id: string; invoiceNumber: string }>("/api/v1/ar/invoices", {
          method: "POST",
          body: JSON.stringify({
            customerId: form.customerId,
            invoiceDate: form.docDate,
            dueDate: form.dueDate,
            lines: pricedLines(),
            description: form.memo.trim() || form.note.trim() || undefined,
          }),
        });
        number = inv.invoiceNumber;
        id = inv.id;
        if (files.length) {
          const failed = await uploadAttachments(api, "ArInvoice", inv.id, files);
          if (failed) toast(`${failed} attachment${failed > 1 ? "s" : ""} couldn't be uploaded`, { error: true });
        }
      } else {
        takeNumber(sequence, form.number);
        saveLocal(kind === "proposal" ? "estimate" : kind, {
          id,
          kind,
          ...form,
          customerName: partyName,
          status: isQuote ? (form.acceptedBy ? "Accepted" : "Pending") : "Open",
          subtotal,
          discount,
          total,
          deposit,
          attachments: files.map((f) => ({ name: f.file.name, size: f.file.size })),
          createdAt: new Date().toISOString(),
        });
      }
      indexTxn({
        id,
        kind: kind as TxnKind,
        number,
        date: form.docDate,
        party: partyName,
        amount: total,
        memo: form.memo,
        status: isInvoice ? "Posted" : isQuote ? (form.acceptedBy ? "Accepted" : "Pending") : "Open",
        projectId: query.get("project") ?? undefined,
        posted: isInvoice,
      });
      toast(isInvoice ? `Invoice ${number} posted to ${partyName}'s account` : `${title} ${number} saved`);
      if (after === "whatsapp") {
        const text = `${title} ${number} from Excel Edge — total ${rwf(total, currency)}${isInvoice ? `, due ${form.dueDate}` : ""}.`;
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
      }
      if (after === "share") {
        const link = `${window.location.origin}${LIST_PAGE[kind]}?doc=${encodeURIComponent(number)}`;
        try {
          await navigator.clipboard.writeText(link);
          toast("Share link copied to the clipboard");
        } catch {
          toast(`Share link: ${link}`);
        }
      }
      if (after === "send") {
        const to = customer?.email || form.leadEmail;
        const subject = `${title} ${number} from Excel Edge`;
        const body = `Dear ${partyName},\n\nPlease find ${title.toLowerCase()} ${number} for ${rwf(total, currency)}.\n\n${form.note}`;
        window.location.href = `mailto:${encodeURIComponent(to ?? "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      }
      if (after === "close") return navigate(LIST_PAGE[kind]);
      if (after === "new") return reset();
      setSaved({ number, id });
    } catch (e) {
      setError((e as Error).message || "Something's not working. Try refreshing the page and check back.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setForm(blank());
    setFiles([]);
    setSaved(null);
    setDueTouched(false);
    v.setErrors({});
    setTab("Edit");
  }

  async function pasteLines() {
    try {
      const rows = await readClipboardRows();
      if (!rows.length) return toast("The clipboard has no rows to paste", { error: true });
      const pasted = rows.map(([description = "", qty = "1", rate = ""]) => {
        const q = num(qty) || 1;
        return { ...emptyProductLine(), description: description.trim(), qty: String(q), rate: fmt(num(rate)), amount: fmt(q * num(rate)) };
      });
      set("lines", [...filledProductLines(form.lines), ...pasted]);
      toast(`${pasted.length} line${pasted.length > 1 ? "s" : ""} pasted`);
    } catch {
      toast("Allow clipboard access to paste lines from a spreadsheet", { error: true });
    }
  }

  const locked = Boolean(saved) && isInvoice;
  const docTitle = saved ? `${title} ${saved.number}` : isInvoice ? `${title}` : `${title} ${isOrder ? "#" : ""}${form.number}`;
  const columns = productColumns(productOptions, items, { date: !isOrder, sku: custom.sku }).filter(
    (c) => (c.key !== "description" || custom.description) && (c.key !== "qty" || custom.quantity) && (c.key !== "rate" || custom.rate),
  );

  const preview = (mode: "email" | "pdf") => (
    <DocPreview
      mode={mode}
      docTitle={title}
      number={saved?.number ?? form.number}
      party={partyName}
      partyAddress={form.billTo}
      dates={isQuote ? [["Date", form.docDate], ["Expiration date", form.expirationDate]] : [["Date", form.docDate], ["Due date", form.dueDate]]}
      lines={previewLines(form.lines, productOptions)}
      totals={[
        ["Subtotal", rwf(subtotal, currency)],
        ...(discount ? ([["Discount", `-${rwf(discount, currency)}`]] as Array<[string, string]>) : []),
        [isInvoice ? "Balance due" : `${title} total`, rwf(total, currency)],
      ]}
      note={form.note}
      accent={design.printerFriendly ? "#333333" : design.color}
      font={design.font}
    />
  );

  const tabActions = (
    <>
      <button type="button" className="txn-link-btn" onClick={() => setPanel((p) => !p)}>
        <Settings size={18} /> Manage
      </button>
      {!isOrder ? (
        <>
          <span className="txn-sep" />
          <button type="button" className="txn-link-btn" onClick={() => setTour(0)}>
            <MonitorPlay size={18} /> Take tour
          </button>
        </>
      ) : null}
      <span className="txn-sep" />
      <button type="button" className="txn-link-btn" onClick={() => setFeedback(true)}>
        <MessageSquareText size={18} /> Feedback
      </button>
    </>
  );

  const saveItems = [
    { label: "Save and new", onSelect: () => void save("new") },
    { label: "Save and close", onSelect: () => void save("close") },
  ];
  const sendItems = [
    { label: "Share link", onSelect: () => void save("share") },
    { label: "Save & Share (WhatsApp)", onSelect: () => void save("whatsapp") },
  ];

  const footer = saved ? (
    <TxnFooter
      left={
        <button type="button" className="txn-btn-outline green" onClick={() => navigate(LIST_PAGE[kind])}>
          Close
        </button>
      }
      center={
        <button type="button" className="txn-foot-link" onClick={() => (setTab("PDF view"), setTimeout(() => window.print(), 50))}>
          <Printer size={22} /> Print or download
        </button>
      }
      right={
        <button type="button" className="txn-btn-primary" onClick={reset}>
          New {title.toLowerCase()}
        </button>
      }
    />
  ) : (
    <TxnFooter
      left={
        isOrder ? (
          <button type="button" className="txn-btn-outline green" onClick={() => navigate(LIST_PAGE[kind])}>
            Cancel
          </button>
        ) : null
      }
      center={
        <>
          <button type="button" className="txn-foot-link" onClick={() => (setTab(isOrder ? "Edit" : "PDF view"), setTimeout(() => window.print(), 50))}>
            <Printer size={22} /> {isOrder ? "Print" : "Print or download"}
          </button>
          <span className="txn-vsep" />
          {isInvoice ? (
            <button type="button" className="txn-foot-link" onClick={() => setRecurring(true)}>
              <RefreshCw size={22} /> Make recurring
            </button>
          ) : null}
        </>
      }
      right={
        <>
          <SplitButton label="Save" variant="secondary" onClick={() => void save("stay")} items={saveItems} busy={busy} />
          <SplitButton label="Review and send" onClick={() => setReview("send")} items={sendItems} disabled={busy} />
        </>
      }
    />
  );

  return (
    <TxnPage
      title={docTitle}
      kind={kind as TxnKind}
      onClose={() => navigate(LIST_PAGE[kind])}
      actions={["help", "close"]}
      tabs={isOrder ? ["Edit"] : ["Edit", "Email view", "PDF view"]}
      tab={tab}
      onTab={setTab}
      tabActions={tabActions}
      right={panel ? <CustomisePanel title={docTitle} custom={custom} setCustom={setCustom} design={design} setDesign={setDesign} onClose={() => setPanel(false)} /> : undefined}
      footer={footer}
    >
      <ErrorBanner message={error} onClose={() => setError("")} />
      <ValidationSummary count={v.count} />
      {saved ? (
        <div className="txn-info-banner">
          <div>
            <strong>
              {title} {saved.number} {isInvoice ? "posted" : "saved"}
            </strong>
            {isInvoice ? "It's on the customer's account and in the general ledger." : "Saved in this browser — it doesn't post to the books."}
          </div>
        </div>
      ) : null}

      {tab === "Email view" ? preview("email") : tab === "PDF view" ? preview("pdf") : (
        <fieldset className="txn-fieldset" disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {isQuote && bannerOpen ? (
            <div className="txn-info-banner">
              <Lightbulb size={28} />
              <div>
                <strong>Start work with a signed estimate</strong>
                Enable e-signatures so customers can sign before accepting.{" "}
                <button type="button" className="txn-link" onClick={() => (toast("E-signatures turned on for estimates"), setBannerOpen(false))}>
                  <strong style={{ display: "inline" }}>Turn on e-signatures</strong>
                </button>
              </div>
              <button type="button" className="txn-icon" aria-label="Dismiss" onClick={() => setBannerOpen(false)}>
                <X size={22} />
              </button>
            </div>
          ) : null}

          <div className="txn-doc-card" style={isOrder ? { border: 0 } : undefined}>
            <div className="txn-doc-card-top" style={isOrder ? { padding: "8px 24px 16px" } : undefined}>
              <div>
                {!isOrder ? <h2 className="txn-doc-title">{title.toUpperCase()}</h2> : null}
                <CompanyBlock showEmail={!isOrder} showEdit={!isOrder} />
              </div>
              {!isOrder ? (
                <div className="txn-doc-card-right">
                  <span className="txn-doc-balance">
                    {isInvoice ? "Balance due (hidden)" : "Amount (hidden)"}: <strong>{rwf(total, currency)}</strong>
                  </span>
                  <LogoPicker />
                </div>
              ) : null}
            </div>

            <DocBand>
              <div className="txn-party">
                <TField label={kind === "proposal" && !form.customerId && form.leadName ? "Lead" : ""} error={v.errors.customerId}>
                  {kind === "proposal" && !form.customerId && form.leadName ? (
                    <input className="txn-input w-md" value={form.leadName} onChange={(e) => set("leadName", e.target.value)} aria-label="Lead name" />
                  ) : (
                    <div className="w-md">
                      <PartySelect
                        value={form.customerId}
                        onChange={(id) => pickCustomer(id)}
                        options={customerOptions(customers)}
                        placeholder={isOrder ? "Add customer" : "Add Customer"}
                        invalid={Boolean(v.errors.customerId)}
                        addLabel="Add new customer"
                        onAdd={() => setAddCustomer(true)}
                      />
                    </div>
                  )}
                </TField>
                {isOrder ? (
                  <>
                    <input className="txn-input w-md" placeholder="Contact info" value={form.contact} onChange={(e) => set("contact", e.target.value)} aria-label="Contact info" />
                    {custom.billTo ? (
                      <TField label="Bill to" className="w-md">
                        <textarea className="txn-textarea" value={form.billTo} onChange={(e) => set("billTo", e.target.value)} />
                      </TField>
                    ) : null}
                    {custom.shipTo ? (
                      <TField label="Ship to" className="w-md">
                        <textarea className="txn-textarea" value={form.shipTo} onChange={(e) => set("shipTo", e.target.value)} />
                      </TField>
                    ) : null}
                  </>
                ) : customer ? (
                  <div className="txn-party-info">
                    <strong>{customer.name}</strong>
                    {customer.physicalAddress ? <span>{customer.physicalAddress}</span> : null}
                    {customer.email ? <span>{customer.email}</span> : null}
                    {customer.telephone ? <span>{customer.telephone}</span> : null}
                    <span className="muted">Open balance: {rwf(Number(customer.balance) || 0, currency)}</span>
                  </div>
                ) : form.leadName ? (
                  <div className="txn-party-info">
                    <span className="muted">Lead · {form.leadEmail || "no email"}</span>
                  </div>
                ) : (
                  <div className="txn-skeleton-lines" aria-hidden="true">
                    <span style={{ width: "90%" }} />
                    <span style={{ width: "76%" }} />
                    <span style={{ width: "58%" }} />
                  </div>
                )}
              </div>

              {isOrder ? (
                <div className="txn-label-left" style={{ gridColumn: "span 2", justifySelf: "end", display: "grid", gridTemplateColumns: "auto 230px", gap: "10px 24px", alignItems: "center" }}>
                  {custom.number ? <LabelLeft label="Sales order no." error={v.errors.number}><input className="txn-input" value={form.number} onChange={(e) => set("number", e.target.value)} /></LabelLeft> : null}
                  {custom.docDate ? <LabelLeft label="Sales order date" error={v.errors.docDate}><input className="txn-input" type="date" value={form.docDate} onChange={(e) => set("docDate", e.target.value)} /></LabelLeft> : null}
                  {custom.terms ? (
                    <LabelLeft label="Terms">
                      <Select value={form.terms} onChange={(t) => set("terms", t)} searchable={false} options={TERMS.map((t) => ({ value: t.value, label: t.label }))} />
                    </LabelLeft>
                  ) : null}
                  {custom.dueDate ? <LabelLeft label="Due date" error={v.errors.dueDate}><input className="txn-input" type="date" value={form.dueDate} onChange={(e) => (setDueTouched(true), set("dueDate", e.target.value))} /></LabelLeft> : null}
                </div>
              ) : (
                <>
                  <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
                    <TField label={`${title} no.`} error={v.errors.number} hint={isInvoice ? "Assigned when the invoice posts" : undefined}>
                      <input className="txn-input" value={isInvoice ? form.number : form.number} placeholder={isInvoice ? "Auto" : ""} disabled={isInvoice} onChange={(e) => set("number", e.target.value)} />
                    </TField>
                    {isInvoice ? (
                      <TField label="Terms">
                        <Select value={form.terms} onChange={(t) => set("terms", t)} searchable={false} options={TERMS.map((t) => ({ value: t.value, label: t.label }))} />
                      </TField>
                    ) : null}
                    <TField label={`${title} date`} required error={v.errors.docDate}>
                      <input className="txn-input" type="date" value={form.docDate} onChange={(e) => set("docDate", e.target.value)} />
                    </TField>
                    {isInvoice ? (
                      <TField label="Due date" required error={v.errors.dueDate}>
                        <input className="txn-input" type="date" value={form.dueDate} min={form.docDate} onChange={(e) => (setDueTouched(true), set("dueDate", e.target.value))} />
                      </TField>
                    ) : (
                      <TField label="Expiration date" error={v.errors.expirationDate}>
                        <input className="txn-input" type="date" value={form.expirationDate} min={form.docDate} onChange={(e) => set("expirationDate", e.target.value)} />
                      </TField>
                    )}
                  </div>
                  {isQuote ? (
                    <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
                      <TField label="Accepted by" error={v.errors.acceptedBy}>
                        <input className="txn-input" value={form.acceptedBy} onChange={(e) => set("acceptedBy", e.target.value)} />
                      </TField>
                      <TField label="Accepted date" error={v.errors.acceptedDate}>
                        <input className="txn-input" type="date" value={form.acceptedDate} min={form.docDate} onChange={(e) => set("acceptedDate", e.target.value)} />
                      </TField>
                    </div>
                  ) : (
                    <div />
                  )}
                </>
              )}
            </DocBand>
          </div>

          <LineGrid
            columns={columns}
            rows={form.lines}
            onChange={(rows) => set("lines", rows)}
            newRow={emptyProductLine}
            errors={v.errors}
            copy={false}
            remove={!isOrder}
            showAdd={false}
            showClear={!isOrder}
            toolbar={
              <>
                {!isOrder ? <h3>Product or service</h3> : null}
                <GridTools onPaste={pasteLines} />
              </>
            }
            extraButtons={
              isOrder ? (
                <button type="button" className="txn-btn-outline sm green" style={{ borderColor: "#1d6b3a", color: "#1d6b3a" }} onClick={() => set("lines", [...form.lines, emptyProductLine()])}>
                  Add product or service
                </button>
              ) : (
                <SplitButton
                  label="Add product or service"
                  variant="secondary"
                  onClick={() => set("lines", [...form.lines, emptyProductLine()])}
                  items={[
                    { label: "Add 5 lines", onSelect: () => set("lines", [...form.lines, ...Array.from({ length: 5 }, emptyProductLine)]) },
                    { label: "Paste lines from clipboard", onSelect: () => void pasteLines() },
                  ]}
                />
              )
            }
          />

          <div className="txn-lower" style={{ borderTop: isOrder ? 0 : "1px solid #c9d6ee", paddingTop: 18 }}>
            <div className="txn-lower-left">
              {isInvoice ? (
                <TextArea
                  label="Customer payment options"
                  value={form.paymentOptions}
                  onChange={(t) => set("paymentOptions", t)}
                  placeholder="Tell your customer how you want to get paid. Set default payment instructions for future invoices using Edit default."
                />
              ) : null}
              {custom.noteToCustomer ? (
                <TextArea className={isOrder ? "txn-label-light" : ""} label="Note to customer" value={form.note} onChange={(t) => set("note", t)} error={v.errors.note} rows={2} />
              ) : null}
              {custom.internalMemo ? (
                <TextArea
                  className={isOrder ? "txn-label-light" : ""}
                  label={isOrder ? "Internal memo (hidden)" : "Memo on statement (hidden)"}
                  value={form.memo}
                  onChange={(t) => set("memo", t)}
                  error={v.errors.memo}
                  rows={2}
                  placeholder={isOrder ? "" : `This memo will not show up on your ${title.toLowerCase()}, but will appear on the statement.`}
                />
              ) : null}
              <TField label="Attachments" className={isOrder ? "txn-label-light" : ""}>
                <AttachmentBox files={files} onChange={setFiles} showExisting={isOrder} />
              </TField>
            </div>
            <div className="txn-lower-right">
              <Totals
                rows={[
                  { label: "Subtotal", value: rwf(subtotal, currency) },
                  ...(discount ? [{ label: `Discount (${form.discountPct}%)`, value: `-${rwf(discount, currency)}` }] : []),
                  { label: `${isOrder ? "Sales order" : title} total`, value: rwf(total, currency), strong: true, rule: isOrder },
                ]}
              />
              {isOrder ? (
                <div className="txn-deposit" style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 17 }}>
                  <span>Deposit request</span>
                  <input
                    className={`txn-input num ${v.errors.deposit ? "invalid" : ""}`}
                    style={{ width: 90 }}
                    value={form.deposit}
                    placeholder={form.depositMode === "%" ? "0%" : "0"}
                    onChange={(e) => set("deposit", e.target.value.replace(/[^\d.]/g, ""))}
                    aria-label="Deposit request"
                  />
                  <div className="txn-segment sm" role="radiogroup" aria-label="Deposit type">
                    {(["%", "RWF"] as const).map((m) => (
                      <button key={m} type="button" role="radio" aria-checked={form.depositMode === m} className={form.depositMode === m ? "on" : ""} onClick={() => set("depositMode", m)}>
                        {m}
                      </button>
                    ))}
                  </div>
                  <span className="num">{rwf(deposit, currency)}</span>
                </div>
              ) : null}
              {v.errors.deposit ? <span className="field-error">{v.errors.deposit}</span> : null}
              {!isOrder ? (
                <>
                  <button type="button" className="txn-link" onClick={() => setShowEditTotals((s) => !s)}>
                    Edit totals
                  </button>
                  {showEditTotals ? (
                    <TField label="Discount %" error={v.errors.discountPct}>
                      <input className="txn-input num w-xs" value={form.discountPct} onChange={(e) => set("discountPct", e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" />
                    </TField>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </fieldset>
      )}

      {addCustomer ? (
        <AddCustomerDrawer
          onClose={() => setAddCustomer(false)}
          onSaved={(c) => {
            setAddCustomer(false);
            reloadCustomers();
            pickCustomer(c.id, [...customers, c]);
          }}
        />
      ) : null}
      {recurring ? <RecurringModal kind={kind as TxnKind} defaultName={`${partyName || title} recurring`} snapshot={form} onClose={() => setRecurring(false)} /> : null}
      {feedback ? <FeedbackModal onClose={() => setFeedback(false)} /> : null}
      {tour !== null ? <TourPopover step={tour} onStep={setTour} title={title} /> : null}
      {review ? (
        <ReviewModal
          title={title}
          to={customer?.email || form.leadEmail}
          party={partyName}
          total={rwf(total, currency)}
          onClose={() => setReview(null)}
          onSend={() => {
            setReview(null);
            void save("send");
          }}
        >
          {preview("email")}
        </ReviewModal>
      ) : null}
    </TxnPage>
  );
}

function DocBand({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="txn-doc-band" style={open ? undefined : { display: "block", paddingBottom: 26 }}>
      {open ? children : <span className="muted">Customer and dates hidden</span>}
      <button type="button" className="txn-band-toggle" onClick={() => setOpen((o) => !o)} aria-label={open ? "Collapse" : "Expand"}>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
    </div>
  );
}

function LabelLeft({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <>
      <span style={{ fontSize: 16.5 }}>{label}</span>
      <span style={{ display: "grid", gap: 4 }}>
        {children}
        {error ? <span className="field-error">{error}</span> : null}
      </span>
    </>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`txn-toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)} />;
}

function Accordion({ title, open, onToggle, children, aside }: { title: string; open: boolean; onToggle: () => void; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="txn-acc">
      <button type="button" onClick={onToggle} aria-expanded={open}>
        {title}
        {aside}
        {open ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
      </button>
      {open ? <div className="txn-acc-body">{children}</div> : null}
    </section>
  );
}

function CustomisePanel({
  title,
  custom,
  setCustom,
  design,
  setDesign,
  onClose,
}: {
  title: string;
  custom: Custom;
  setCustom: (c: Custom) => void;
  design: Design;
  setDesign: (d: Design) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<string>("custom");
  const [hex, setHex] = useState(design.color);
  const hexValid = /^#[0-9a-fA-F]{6}$/.test(hex);
  const row = (key: string, label: string) => (
    <div className="txn-acc-row" key={key}>
      <span>{label}</span>
      <Toggle on={custom[key]} onChange={(val) => setCustom({ ...custom, [key]: val })} label={label} />
    </div>
  );
  return (
    <aside className="txn-side" aria-label="Customise">
      <div className="txn-side-head">
        <h2>{title}</h2>
        <button type="button" className="txn-icon" aria-label="Close panel" onClick={onClose}>
          <X size={22} />
        </button>
      </div>
      <Accordion title="Customisation" open={open === "custom"} onToggle={() => setOpen(open === "custom" ? "" : "custom")}>
        {row("shipTo", "Ship to")}
        {row("billTo", "Bill to")}
        {row("noteToCustomer", "Note to customer")}
        {row("internalMemo", "Internal memo")}
        {row("number", "Document number")}
        {row("terms", "Terms")}
        {row("docDate", "Document date")}
        {row("dueDate", "Due date")}
        <div className="txn-acc-sub">
          Table content
          <button type="button" className="txn-link" onClick={() => navigate("/settings/form-styles")}>
            Edit labels
          </button>
        </div>
        {row("lineNumber", "Line number")}
        {row("sku", "SKU")}
        {row("description", "Description")}
        {row("quantity", "Quantity")}
        {row("rate", "Rate")}
        {row("amount", "Amount")}
        <div className="txn-acc-sub">
          Custom fields
          <button type="button" className="txn-link" onClick={() => navigate("/settings/custom-fields")}>
            Manage
          </button>
        </div>
        <div className="txn-acc-sub">
          Multicurrency
          <button type="button" className="txn-link" onClick={() => navigate("/currencies")}>
            Set up
          </button>
        </div>
      </Accordion>
      <Accordion title="Design" open={open === "design"} onToggle={() => setOpen(open === "design" ? "" : "design")}>
        <div className="txn-acc-row">
          <strong>Modernised Template</strong>
          <button type="button" className="txn-link" onClick={() => setDesign(DEFAULT_DESIGN)}>
            Remove default
          </button>
        </div>
        <label className="txn-check">
          <input type="radio" checked readOnly /> Modern
        </label>
        <div className="txn-acc-sub">
          Other Templates
          <button type="button" className="txn-link" onClick={() => navigate("/settings/form-styles")}>
            Add/Edit
          </button>
        </div>
        <div className="txn-acc-sub">Colour</div>
        <div className="txn-acc-row">
          <span>Printer friendly</span>
          <Toggle on={design.printerFriendly} onChange={(val) => setDesign({ ...design, printerFriendly: val })} label="Printer friendly" />
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className="txn-swatch on" style={{ background: hexValid ? hex : design.color, flexShrink: 0 }} />
          <input
            className={`txn-input ${hexValid ? "" : "invalid"}`}
            value={hex}
            onChange={(e) => {
              setHex(e.target.value);
              if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setDesign({ ...design, color: e.target.value });
            }}
            aria-label="Colour hex code"
          />
        </div>
        {!hexValid ? <span className="field-error">Use a 6-digit hex colour like #0077c5</span> : null}
        <div className="txn-swatches">
          {SWATCHES.map((c) => (
            <button key={c} type="button" className={`txn-swatch ${design.color === c ? "on" : ""}`} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => (setDesign({ ...design, color: c }), setHex(c))} />
          ))}
        </div>
        <TField label="Font">
          <Select value={design.font} onChange={(f) => setDesign({ ...design, font: f })} searchable={false} options={FONTS.map((f) => ({ value: f, label: f }))} />
        </TField>
      </Accordion>
      <Accordion title="Customer reports" open={open === "reports"} onToggle={() => setOpen(open === "reports" ? "" : "reports")}>
        <button type="button" className="txn-link" onClick={() => navigate("/reports/ageing")}>
          Open sales order by item
        </button>
        <button type="button" className="txn-link" onClick={() => navigate("/reports/ageing")}>
          Open sales order by customer
        </button>
        <button type="button" className="txn-link" onClick={() => navigate("/invoices")}>
          Sales order list
        </button>
      </Accordion>
    </aside>
  );
}

const TOUR = [
  ["Pick a customer", "Start by choosing who you're billing. Their terms and address fill in for you."],
  ["Add products or services", "Each line needs an amount. Choose a product to fill the description, or type your own."],
  ["Check the totals", "Subtotal and total update as you type. Use Edit totals to add a discount."],
  ["Save or send", "Save keeps a copy; Review and send previews the email before it goes out."],
];

function TourPopover({ step, onStep, title }: { step: number; onStep: (s: number | null) => void; title: string }) {
  const [heading, body] = TOUR[step];
  return (
    <div className="txn-popover" style={{ position: "fixed", top: 150, right: 40, width: 380, zIndex: 80 }} role="dialog" aria-label={`${title} tour`}>
      <div className="txn-popover-head">
        <strong style={{ fontSize: 18 }}>{heading}</strong>
        <button type="button" className="txn-icon sm" aria-label="Close tour" onClick={() => onStep(null)}>
          <X size={18} />
        </button>
      </div>
      <p style={{ margin: "0 0 14px" }}>{body}</p>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="muted">
          {step + 1} of {TOUR.length}
        </span>
        <span style={{ flex: 1 }} />
        {step > 0 ? (
          <button type="button" className="txn-btn-outline blue" style={{ minHeight: 36 }} onClick={() => onStep(step - 1)}>
            Back
          </button>
        ) : null}
        <button type="button" className="txn-btn-primary" style={{ minHeight: 36 }} onClick={() => onStep(step + 1 < TOUR.length ? step + 1 : null)}>
          {step + 1 < TOUR.length ? "Next" : "Done"}
        </button>
      </div>
    </div>
  );
}

function ReviewModal({
  title,
  to,
  party,
  total,
  onClose,
  onSend,
  children,
}: {
  title: string;
  to?: string | null;
  party: string;
  total: string;
  onClose: () => void;
  onSend: () => void;
  children: ReactNode;
}) {
  const [email, setEmail] = useState(to ?? "");
  const [error, setError] = useState("");
  return (
    <Modal
      title={`Review and send ${title.toLowerCase()}`}
      onClose={onClose}
      width={900}
      footer={
        <>
          <button type="button" className="txn-btn-outline blue" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="txn-btn-primary"
            onClick={() => {
              if (!email.trim()) return setError(`Add ${party || "the customer"}'s email address`);
              if (!emailListValid(email)) return setError("Enter valid email addresses, separated by commas");
              onSend();
            }}
          >
            Save and send
          </button>
        </>
      }
    >
      <TField label="To" required error={error || undefined} hint="Opens your email app with the message ready to send">
        <input className="txn-input" value={email} onChange={(e) => (setEmail(e.target.value), setError(""))} placeholder="Email (separate emails with a comma)" />
      </TField>
      <p className="muted" style={{ margin: 0 }}>
        Total: <strong>{total}</strong>
      </p>
      {children}
    </Modal>
  );
}


