import { Calendar, Filter, Printer, Sparkles, SlidersHorizontal, Smartphone, Upload, X } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { useFeedback } from "../../components/feedback";
import { Select } from "../../components/Select";
import { AddSupplierDrawer } from "../../components/suppliers/AddSupplierDrawer";
import {
  type CategoryLine,
  categoryColumns,
  categoryLinesSchema,
  categoryTotal,
  emptyCategoryLine,
  filledCategoryLines,
  fmt,
  num,
} from "../../components/txn/lines";
import {
  AttachmentBox,
  BandAmount,
  CancelButton,
  COMPANY_PROFILE,
  DocPreview,
  ErrorBanner,
  GridTools,
  HeaderBand,
  isBlankRow,
  LineGrid,
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
import { financialAccountOptions, useFinancialAccounts } from "../../lib/banking";
import { useCompany } from "../../lib/company";
import { amount, date, isoDay } from "../../lib/format";
import { navigate, useLocation } from "../../lib/router";
import { useResource, useSession } from "../../lib/session";
import {
  addDays,
  customerOptions,
  emailListValid,
  indexTxn,
  monthsAgo,
  newId,
  peekNumber,
  rwf,
  saveLocal,
  supplierOptions,
  takeNumber,
  TERMS,
  termDays,
  type TxnKind,
  useCustomers,
  useExpenseAccountOptions,
  useInventoryItems,
  usePayees,
  useSuppliers,
} from "../../lib/txn";
import type { ApBill, Supplier } from "../../lib/types";
import { yup } from "../../lib/validation";

/* ── Autofill panel ────────────────────────────────────── */

/**
 * Drop documents to attach them. CSV/TXT files (description, amount per row) are read straight into
 * the lines; PDFs and photos are attached for reference while you type the details.
 */
export function AutofillPanel({
  title,
  onClose,
  onFiles,
  onRows,
  photos = true,
  accept = ".pdf,.png,.jpg,.jpeg,.heic,.csv,.txt",
  formats = "PDF, PNG, JPEG, HEIC.",
  showSample = true,
}: {
  title: string;
  onClose: () => void;
  onFiles: (files: File[]) => void;
  onRows?: (rows: string[][]) => void;
  photos?: boolean;
  accept?: string;
  formats?: string;
  showSample?: boolean;
}) {
  const { toast } = useFeedback();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [about, setAbout] = useState(false);

  async function take(list: FileList | null) {
    if (!list?.length) return;
    const files = Array.from(list).filter((f) => {
      if (f.size > 20 * 1024 * 1024) {
        toast(`${f.name} is larger than 20 MB`, { error: true });
        return false;
      }
      return true;
    });
    const sheets = files.filter((f) => /\.(csv|txt)$/i.test(f.name));
    if (sheets.length && onRows) {
      let rows: string[][] = [];
      for (const s of sheets) {
        const text = await s.text();
        rows = rows.concat(
          text
            .split(/\r?\n/)
            .map((l) => l.split(/[,\t;]/).map((c) => c.replace(/^"|"$/g, "").trim()))
            .filter((r) => r.some(Boolean) && !/^(description|item|category)$/i.test(r[0] ?? "")),
        );
      }
      if (rows.length) {
        onRows(rows);
        toast(`Filled ${rows.length} line${rows.length > 1 ? "s" : ""} from ${sheets.map((s) => s.name).join(", ")} — review before you save`);
      }
    }
    const docs = files.filter((f) => !sheets.includes(f));
    if (docs.length) {
      onFiles(docs);
      toast(`${docs.length} document${docs.length > 1 ? "s" : ""} attached — copy the details into the form`);
    }
  }

  return (
    <aside className="txn-autofill" aria-label={title}>
      <div className="txn-autofill-head">
        <Sparkles size={24} />
        <strong>{title}</strong>
        {!photos ? <span className="txn-beta">BETA</span> : null}
        <button type="button" className="txn-icon sm" aria-label="Close autofill" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div
        className={`txn-autofill-drop ${over ? "over" : ""}`}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => (e.preventDefault(), setOver(false), void take(e.dataTransfer.files))}
      >
        <span>{photos ? "Drag and drop documents here, or choose an option to autofill from file." : "Drag and drop a document anywhere in the dotted lines."}</span>
        <span className="muted">Supported formats: {formats}</span>
        <div className="txn-autofill-tiles">
          <button type="button" className={`txn-autofill-tile ${photos ? "" : "wide"}`} onClick={() => fileInput.current?.click()}>
            <span className="ic">
              <Upload size={26} />
            </span>
            Select files
          </button>
          {photos ? (
            <button type="button" className="txn-autofill-tile" onClick={() => cameraInput.current?.click()}>
              <span className="ic">
                <Smartphone size={26} />
              </span>
              Snap photos
            </button>
          ) : null}
        </div>
        {showSample ? (
          <div style={{ marginTop: "auto" }}>
            <p style={{ margin: "0 0 8px" }}>
              Try with
              <br />
              <strong>bills or invoices</strong>
            </p>
            <BillSketch />
          </div>
        ) : null}
        <input ref={fileInput} type="file" multiple hidden accept={accept} onChange={(e) => (void take(e.target.files), (e.target.value = ""))} />
        <input ref={cameraInput} type="file" hidden accept="image/*" capture="environment" onChange={(e) => (void take(e.target.files), (e.target.value = ""))} />
      </div>
      <div className="txn-autofill-foot">
        <span>Review before you save.</span>
        <button type="button" className="txn-link" style={{ justifySelf: "center", textDecoration: "underline" }} onClick={() => setAbout(true)}>
          About document autofill.
        </button>
      </div>
      {about ? (
        <Modal title="About document autofill" onClose={() => setAbout(false)}>
          <p style={{ margin: 0 }}>Spreadsheets (CSV) with a description and an amount per row fill the lines for you. PDFs and photos are attached to the record so you can copy the details across.</p>
          <p style={{ margin: 0 }}>Always check the supplier, dates and amounts before saving.</p>
        </Modal>
      ) : null}
    </aside>
  );
}

function BillSketch() {
  return (
    <svg width="200" height="150" viewBox="0 0 200 150" aria-hidden="true">
      <rect x="70" y="20" width="110" height="120" rx="6" fill="#e9dcc3" transform="rotate(8 125 80)" />
      <g transform="rotate(-14 90 80)">
        <rect x="30" y="18" width="120" height="122" rx="6" fill="#fff" stroke="#cfd8e6" />
        <rect x="96" y="26" width="46" height="14" rx="2" fill="#16343c" />
        <text x="105" y="37" fontSize="9" fill="#fff" fontWeight="700">BILL</text>
        <rect x="42" y="50" width="70" height="4" fill="#16343c" />
        <rect x="42" y="64" width="96" height="40" fill="#e3eef5" stroke="#9fb6c8" />
        <rect x="42" y="116" width="36" height="4" fill="#16343c" />
        <text x="96" y="122" fontSize="7" fill="#16343c">TOTAL DUE</text>
      </g>
    </svg>
  );
}

/* ── Category-line supplier forms ──────────────────────── */

type CatKind = "bill" | "cheque" | "purchase-order" | "supplier-credit" | "credit-card-credit";

type CatForm = {
  party: string;
  email: string;
  cc: string;
  bcc: string;
  status: string;
  mailing: string;
  shipToCustomer: string;
  shipping: string;
  shipVia: string;
  account: string;
  terms: string;
  date: string;
  dueDate: string;
  number: string;
  message: string;
  memo: string;
  lines: CategoryLine[];
};

const CAT_TITLES: Record<CatKind, string> = { bill: "Bill", cheque: "Cheque", "purchase-order": "Purchase Order", "supplier-credit": "Supplier Credit", "credit-card-credit": "Credit Card Credit" };
const CAT_BACK: Record<CatKind, string> = { bill: "/bills", cheque: "/banking", "purchase-order": "/bills", "supplier-credit": "/bills", "credit-card-credit": "/banking" };

export function CategoryTxnForm({ kind }: { kind: CatKind }) {
  const { api } = useSession();
  const { toast } = useFeedback();
  const { currency, name: companyName } = useCompany();
  const { query } = useLocation();
  const { suppliers, reload: reloadSuppliers } = useSuppliers();
  const { customers } = useCustomers();
  const payees = usePayees();
  const banks = useFinancialAccounts();
  const categories = useExpenseAccountOptions();
  const v = useValidation();
  const title = CAT_TITLES[kind];
  const usesSupplier = kind === "bill" || kind === "purchase-order" || kind === "supplier-credit";
  const usesBank = kind === "cheque" || kind === "credit-card-credit";

  const blank = (): CatForm => ({
    party: query.get("supplier") ? `${query.get("supplier")}` : "",
    email: "",
    cc: "",
    bcc: "",
    status: "OPEN",
    mailing: "",
    shipToCustomer: "",
    shipping: [(companyName || "EXCEL EDGE CPA").toUpperCase(), COMPANY_PROFILE.address2, `${COMPANY_PROFILE.address1}, Rwanda`].join("\n"),
    shipVia: "",
    account: "",
    terms: "",
    date: isoDay(),
    dueDate: kind === "purchase-order" ? "" : isoDay(),
    number: kind === "purchase-order" ? peekNumber("purchase-order") : "",
    message: "",
    memo: "",
    lines: kind === "cheque" ? [emptyCategoryLine()] : [emptyCategoryLine(), emptyCategoryLine()],
  });
  const [form, setForm] = useState<CatForm>(blank);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [autofill, setAutofill] = useState(kind === "bill");
  const [recurring, setRecurring] = useState(false);
  const [preview, setPreview] = useState(false);
  const [adding, setAdding] = useState(false);
  const [ccOpen, setCcOpen] = useState(false);
  const [more, setMore] = useState(false);

  const total = categoryTotal(form.lines);
  const supplier = suppliers.find((s) => s.id === form.party);
  const payee = usesBank ? payees.lookup(form.party) : undefined;
  const partyName = supplier?.name ?? payee?.name ?? "";
  const bank = banks.data?.find((b) => b.id === form.account);
  const set = <K extends keyof CatForm>(k: K, val: CatForm[K]) => (setForm((f) => ({ ...f, [k]: val })), v.clear(k));

  function pickSupplier(id: string, list: Supplier[] = suppliers) {
    const s = list.find((x) => x.id === id);
    setForm((f) => {
      const terms = s?.creditPeriodDays ? (TERMS.find((t) => t.days === s.creditPeriodDays)?.value ?? f.terms) : f.terms;
      const lines =
        s?.defaultExpenseAccountId && f.lines.every((l) => !l.category)
          ? f.lines.map((l, i) => (i === 0 ? { ...l, category: s.defaultExpenseAccountId! } : l))
          : f.lines;
      return {
        ...f,
        party: id,
        email: s?.email ?? f.email,
        mailing: s ? [s.name, s.physicalAddress].filter(Boolean).join("\n") : f.mailing,
        terms,
        dueDate: kind === "bill" && terms ? addDays(f.date, termDays(terms)) : f.dueDate,
        lines,
      };
    });
    v.clear("party");
  }

  const schema = yup.object({
    party: yup.string().test("party", usesBank ? "Choose who you paid" : "Choose a supplier", (val) => (kind === "credit-card-credit" ? true : Boolean(val))),
    email: yup.string().test("emails", "Enter valid emails, separated by commas", (val) => !val || emailListValid(val)),
    cc: yup.string().test("emails", "Enter valid emails, separated by commas", (val) => !val || emailListValid(val)),
    bcc: yup.string().test("emails", "Enter valid emails, separated by commas", (val) => !val || emailListValid(val)),
    account: usesBank ? yup.string().required(kind === "cheque" ? "Choose the bank account" : "Choose the bank or credit account") : yup.string(),
    date: yup.string().required("Choose a date"),
    dueDate:
      kind === "bill" || kind === "purchase-order"
        ? yup.string().test("due", "Due date can't be before the date", function (val) {
            return !val || val >= this.parent.date;
          })
        : yup.string(),
    number:
      kind === "purchase-order"
        ? yup.string().trim().required("Enter a purchase order number").max(21, "Use 21 characters or fewer")
        : kind === "cheque"
          ? yup.string().trim().max(40, "Use 40 characters or fewer").matches(/^[A-Za-z0-9-]*$/, "Letters, numbers and - only")
          : yup.string().trim().max(80, "Use 80 characters or fewer"),
    shipVia: yup.string().max(60, "Use 60 characters or fewer"),
    message: yup.string().max(1000, "Use 1,000 characters or fewer"),
    memo: yup.string().max(1000, "Use 1,000 characters or fewer"),
    lines: categoryLinesSchema(),
  });

  const accountLines = () =>
    filledCategoryLines(form.lines).map((l) => ({ accountId: l.category, amount: Math.round(num(l.amount) * 100) / 100, description: (l.description.trim() || categories.find((c) => c.value === l.category)?.label || title).slice(0, 300) }));

  async function post(): Promise<{ id: string; number: string; posted: boolean }> {
    const description = form.memo.trim() || undefined;
    switch (kind) {
      case "bill": {
        const bill = await api<{ id: string; billNumber: string }>("/api/v1/ap/bills", {
          method: "POST",
          body: JSON.stringify({
            supplierId: form.party,
            supplierInvoiceNumber: form.number.trim() || undefined,
            billDate: form.date,
            dueDate: form.dueDate || undefined,
            description,
            lines: accountLines().map((l) => ({ description: l.description, quantity: 1, unitPrice: l.amount, accountId: l.accountId })),
          }),
        });
        if (files.length) {
          const failed = await uploadAttachments(api, "ApBill", bill.id, files);
          if (failed) toast(`${failed} attachment${failed > 1 ? "s" : ""} couldn't be uploaded`, { error: true });
        }
        return { id: bill.id, number: bill.billNumber, posted: true };
      }
      case "supplier-credit": {
        const note = await api<{ id: string; creditNoteNumber?: string; noteNumber?: string }>("/api/v1/ap/credit-notes", {
          method: "POST",
          body: JSON.stringify({ supplierId: form.party, supplierReference: form.number.trim() || undefined, noteDate: form.date, reason: description ?? "Supplier credit", net: Math.round(total * 100) / 100, description: accountLines().map((l) => l.description).join("; ").slice(0, 500) }),
        });
        return { id: note.id, number: note.creditNoteNumber ?? note.noteNumber ?? form.number, posted: true };
      }
      case "cheque":
      case "credit-card-credit": {
        const t = await api<{ id: string; number: string }>(kind === "cheque" ? "/api/v1/banking/payments" : "/api/v1/banking/receipts", {
          method: "POST",
          body: JSON.stringify({
            financialAccountId: form.account,
            transactionDate: form.date,
            method: kind === "cheque" ? "CHEQUE" : "CARD",
            chequeNumber: kind === "cheque" ? form.number.trim() || undefined : undefined,
            reference: kind === "credit-card-credit" ? form.number.trim() || undefined : undefined,
            partyType: payee ? payee.kind.toUpperCase() : undefined,
            partyName: payee?.name,
            description: description ?? `${title}${partyName ? ` — ${partyName}` : ""}`,
            lines: accountLines(),
          }),
        });
        return { id: t.id, number: t.number, posted: true };
      }
      case "purchase-order": {
        const id = newId();
        takeNumber("purchase-order", form.number);
        saveLocal("purchase-order", { id, ...form, supplierName: partyName, total, attachments: files.map((f) => f.file.name), createdAt: new Date().toISOString() });
        return { id, number: form.number, posted: false };
      }
    }
  }

  async function save(after: "stay" | "new" | "close" | "approval") {
    setError("");
    if (bank && kind === "cheque" && !bank.allowOverdraft && total > bank.balance + 0.001) {
      v.setErrors({ account: `${bank.name} only has ${rwf(bank.balance, currency)} — it doesn't allow overdrafts` });
      return;
    }
    if (!(await v.validate(schema, form))) return;
    setBusy(true);
    try {
      const result = await post();
      if (after === "approval") {
        try {
          await api("/api/v1/books/approvals", { method: "POST", body: JSON.stringify({ entityType: "ApBill", entityId: result.id, amount: Math.round(total * 100) / 100, reason: form.memo || undefined }) });
          toast(`Bill ${result.number} submitted for approval`);
        } catch (e) {
          toast(`Bill saved, but the approval request failed: ${(e as Error).message}`, { error: true });
        }
      }
      indexTxn({
        id: result.id,
        kind: kind as TxnKind,
        number: result.number,
        date: form.date,
        party: partyName,
        amount: total,
        memo: form.memo,
        status: kind === "purchase-order" ? form.status : "Posted",
        projectId: query.get("project") ?? undefined,
        posted: result.posted,
      });
      if (after !== "approval") toast(`${title} ${result.number} ${result.posted ? "posted" : "saved"}`);
      if (after === "close" || after === "approval") return navigate(CAT_BACK[kind]);
      setForm(blank());
      setFiles([]);
    } catch (e) {
      setError((e as Error).message || "Something's not working. Try refreshing the page and check back.");
    } finally {
      setBusy(false);
    }
  }

  async function pasteLines() {
    try {
      const rows = await readClipboardRows();
      fillRows(rows);
    } catch {
      toast("Allow clipboard access to paste lines from a spreadsheet", { error: true });
    }
  }
  function fillRows(rows: string[][]) {
    const lines = rows.map((r) => {
      const amt = [...r].reverse().find((c) => Number.isFinite(num(c)) && num(c) > 0) ?? "";
      const match = categories.find((c) => c.label.toLowerCase() === (r[0] ?? "").toLowerCase());
      return { category: match?.value ?? "", description: (match ? r[1] : r[0]) ?? "", amount: fmt(num(amt)) };
    });
    set("lines", [...filledCategoryLines(form.lines), ...lines]);
  }

  const wideBand = kind === "bill" || kind === "purchase-order";
  const amountLabel = kind === "bill" ? "BALANCE DUE" : kind === "supplier-credit" ? "CREDIT AMOUNT" : "AMOUNT";
  const backTo = CAT_BACK[kind];

  const footer = (() => {
    const center: ReactNode[] = [];
    if (kind === "bill" || kind === "purchase-order" || kind === "cheque")
      center.push(
        <button key="print" type="button" className="txn-btn-outline" style={{ fontSize: 18 }} onClick={() => setPreview(true)}>
          Print
        </button>,
      );
    center.push(
      <button key="rec" type="button" className="txn-btn-outline" style={{ fontSize: 18 }} onClick={() => setRecurring(true)}>
        Make recurring
      </button>,
    );
    if (kind === "cheque")
      center.push(
        <span key="more" style={{ position: "relative" }}>
          <button type="button" className="txn-btn-outline" style={{ fontSize: 18 }} onClick={() => setMore((m) => !m)}>
            More
          </button>
          {more ? (
            <div className="txn-split-menu" style={{ left: 0, right: "auto" }}>
              <button type="button" onClick={() => (setMore(false), setForm((f) => ({ ...f, number: "" })), toast("Cheque number cleared — the bank will assign one"))}>
                Clear cheque no.
              </button>
              <button type="button" onClick={() => (setMore(false), navigate("/banking/transactions"))}>
                Transaction journal
              </button>
            </div>
          ) : null}
        </span>,
      );
    const right =
      kind === "bill" ? (
        <>
          <button type="button" className="txn-btn-primary" onClick={() => void save("stay")} disabled={busy}>
            {busy ? "Saving…" : "Save bill"}
          </button>
          <SplitButton
            label="Save and new"
            onClick={() => void save("new")}
            busy={busy}
            items={[
              { label: "Save and close", onSelect: () => void save("close") },
              { label: "Save and submit for approval", onSelect: () => void save("approval") },
            ]}
          />
        </>
      ) : (
        <>
          <button type="button" className={kind === "cheque" ? "txn-btn-outline blue" : "txn-btn-primary"} onClick={() => void save("stay")} disabled={busy}>
            Save
          </button>
          <SplitButton label="Save and close" onClick={() => void save("close")} busy={busy} items={[{ label: "Save and new", onSelect: () => void save("new") }]} />
        </>
      );
    return <TxnFooter left={<CancelButton onClick={() => navigate(backTo)} />} center={center} right={right} />;
  })();

  const partyField = usesSupplier ? (
    <TField label="Supplier" required error={v.errors.party} className={kind === "supplier-credit" ? "w-lg" : "w-lg"}>
      <PartySelect value={form.party} onChange={(id) => pickSupplier(id)} options={supplierOptions(suppliers)} placeholder="Choose a supplier" invalid={Boolean(v.errors.party)} addLabel="Add new supplier" onAdd={() => setAdding(true)} />
    </TField>
  ) : (
    <TField label="Payee" required={kind === "cheque"} error={v.errors.party} className="w-lg">
      <PartySelect
        value={form.party}
        onChange={(key) => {
          const p = payees.lookup(key);
          setForm((f) => ({ ...f, party: key, mailing: p ? [p.name, p.address].filter(Boolean).join("\n") : f.mailing }));
          v.clear("party");
        }}
        options={payees.options}
        placeholder="Who did you pay?"
        invalid={Boolean(v.errors.party)}
      />
    </TField>
  );

  const bankField = usesBank ? (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 18 }}>
      <TField label={kind === "cheque" ? "Bank Account" : "Bank/Credit account"} required error={v.errors.account} className="w-lg">
        <Select value={form.account} onChange={(a) => set("account", a)} options={financialAccountOptions(banks.data ?? [])} placeholder="Choose an account" invalid={Boolean(v.errors.account)} />
      </TField>
      <span style={{ paddingBottom: v.errors.account ? 30 : 9, fontSize: 16 }}>
        <strong>Balance</strong> {rwf(bank?.balance ?? 0, currency)}
      </span>
    </div>
  ) : null;

  return (
    <TxnPage
      title={kind === "purchase-order" && form.number ? `Purchase Order` : title}
      kind={kind as TxnKind}
      brand={kind === "bill" || kind === "cheque"}
      onClose={() => navigate(backTo)}
      actions={["feedback", "settings", "help", "autofill", "close"]}
      feedbackLabel="Give feedback"
      onSettings={() => navigate("/settings/expenses")}
      autofillOn={autofill}
      onAutofill={() => setAutofill((a) => !a)}
      left={
        autofill ? (
          <AutofillPanel title={`Autofill this ${title.toLowerCase()}`} onClose={() => setAutofill(false)} onFiles={(fs) => setFiles((cur) => [...cur, ...fs.map((f) => ({ id: `${f.name}-${f.size}-${f.lastModified}`, file: f }))])} onRows={fillRows} />
        ) : undefined
      }
      footer={footer}
    >
      <ErrorBanner message={error} onClose={() => setError("")} />
      <ValidationSummary count={v.count} />
      <HeaderBand
        amountLabel={wideBand ? undefined : amountLabel}
        amountValue={wideBand ? undefined : rwf(total, currency)}
        summary={partyName ? `${partyName} · ${date(form.date)}` : "Nothing chosen yet"}
      >
        {kind === "bill" ? (
          <>
            <div className="txn-row">
              {partyField}
              <BandAmount label={amountLabel} value={rwf(total, currency)} />
            </div>
            <div className="txn-row" style={{ flexWrap: "nowrap" }}>
              <TField label="Mailing address" className="grow" >
                <textarea className="txn-textarea addr" value={form.mailing} onChange={(e) => set("mailing", e.target.value)} />
              </TField>
              <TField label="Terms" className="txn-w-170">
                <Select value={form.terms} onChange={(t) => setForm((f) => ({ ...f, terms: t, dueDate: addDays(f.date, termDays(t)) }))} options={TERMS.map((t) => ({ value: t.value, label: t.label }))} placeholder="" searchable={false} />
              </TField>
              <TField label="Bill date" required error={v.errors.date} className="txn-w-185">
                <input className="txn-input" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value, dueDate: f.terms ? addDays(e.target.value, termDays(f.terms)) : f.dueDate }))} />
              </TField>
              <TField label="Due date" error={v.errors.dueDate} className="txn-w-185">
                <input className="txn-input" type="date" value={form.dueDate} min={form.date} onChange={(e) => set("dueDate", e.target.value)} />
              </TField>
              <TField label="Bill no." error={v.errors.number} className="txn-w-185" hint="Supplier's invoice no.">
                <input className="txn-input" value={form.number} onChange={(e) => set("number", e.target.value)} />
              </TField>
            </div>
          </>
        ) : kind === "purchase-order" ? (
          <>
            <div className="txn-row">
              {partyField}
              <div className="w-xl" style={{ display: "grid", gap: 10 }}>
                <TField
                  label="Email"
                  error={v.errors.email}
                  aside={
                    <button type="button" className="txn-link txn-label-aside" onClick={() => setCcOpen((o) => !o)}>
                      Cc/Bcc
                    </button>
                  }
                >
                  <input className="txn-input" value={form.email} placeholder="Email (Separate emails with a comma)" onChange={(e) => set("email", e.target.value)} />
                </TField>
                {ccOpen ? (
                  <div className="txn-form-grid">
                    <TField label="Cc" error={v.errors.cc}>
                      <input className="txn-input" value={form.cc} onChange={(e) => set("cc", e.target.value)} />
                    </TField>
                    <TField label="Bcc" error={v.errors.bcc}>
                      <input className="txn-input" value={form.bcc} onChange={(e) => set("bcc", e.target.value)} />
                    </TField>
                  </div>
                ) : null}
              </div>
              <BandAmount label={amountLabel} value={rwf(total, currency)} />
            </div>
            <div className="txn-row" style={{ alignItems: "center" }}>
              <strong style={{ fontSize: 16 }}>Purchase Order status</strong>
              <div style={{ width: 120 }}>
                <Select value={form.status} onChange={(s) => set("status", s)} searchable={false} options={[{ value: "OPEN", label: "OPEN" }, { value: "CLOSED", label: "CLOSED" }]} aria-label="Purchase Order status" />
              </div>
            </div>
            <div className="txn-row">
              <TField label="Mailing address" className="w-lg">
                <textarea className="txn-textarea" style={{ minHeight: 170 }} value={form.mailing} onChange={(e) => set("mailing", e.target.value)} />
              </TField>
              <div className="w-lg" style={{ display: "grid", gap: 12 }}>
                <TField label="Ship to">
                  <Select
                    value={form.shipToCustomer}
                    onChange={(id) => {
                      const c = customers.find((x) => x.id === id);
                      setForm((f) => ({ ...f, shipToCustomer: id, shipping: c ? [c.name, c.physicalAddress].filter(Boolean).join("\n") : f.shipping }));
                    }}
                    options={customerOptions(customers)}
                    placeholder="Select customer for address"
                  />
                </TField>
                <TField label="Shipping address">
                  <textarea className="txn-textarea" value={form.shipping} onChange={(e) => set("shipping", e.target.value)} />
                </TField>
              </div>
              <div className="w-md" style={{ display: "grid", gap: 12 }}>
                <TField label="Purchase Order date" required error={v.errors.date}>
                  <input className="txn-input" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
                </TField>
                <TField label="Ship Via" error={v.errors.shipVia}>
                  <input className="txn-input" value={form.shipVia} onChange={(e) => set("shipVia", e.target.value)} />
                </TField>
              </div>
              <div className="w-md" style={{ display: "grid", gap: 12 }}>
                <TField label="Due date" error={v.errors.dueDate}>
                  <input className="txn-input" type="date" value={form.dueDate} min={form.date} onChange={(e) => set("dueDate", e.target.value)} />
                </TField>
                <TField label="P.O. no." required error={v.errors.number}>
                  <input className="txn-input" value={form.number} onChange={(e) => set("number", e.target.value)} />
                </TField>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="txn-row">
              {partyField}
              {bankField}
            </div>
            <div className="txn-row">
              {kind !== "credit-card-credit" ? (
                <TField label="Mailing address" className="w-lg">
                  <textarea className="txn-textarea addr" value={form.mailing} onChange={(e) => set("mailing", e.target.value)} />
                </TField>
              ) : null}
              <TField label={kind === "credit-card-credit" ? "Payment Date" : "Payment date"} required error={v.errors.date} className="w-sm">
                <input className="txn-input" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
              </TField>
              <TField label={kind === "cheque" ? "Cheque no." : "Ref no."} error={v.errors.number} className="w-sm">
                <input className="txn-input" value={form.number} onChange={(e) => set("number", e.target.value)} />
              </TField>
            </div>
          </>
        )}
      </HeaderBand>

      <LineGrid
        columns={categoryColumns(categories, kind !== "cheque")}
        rows={form.lines}
        onChange={(rows) => set("lines", rows)}
        newRow={emptyCategoryLine}
        errors={v.errors}
        copy={kind !== "cheque"}
        remove={kind !== "cheque"}
        toolbar={<GridTools onPaste={pasteLines} onSettings={() => navigate("/accounting/chart-of-accounts")} />}
        extraButtons={null}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -58, marginBottom: 30, pointerEvents: "none" }}>
        <Totals rows={[{ label: "Total", value: rwf(total, currency), strong: true, big: true }]} />
      </div>

      <div className="txn-lower" style={{ gap: 30 }}>
        {kind === "purchase-order" ? <TextArea label="Your message to supplier" value={form.message} onChange={(t) => set("message", t)} error={v.errors.message} className="grow" rows={4} /> : null}
        <TextArea label="Memo" value={form.memo} onChange={(t) => set("memo", t)} error={v.errors.memo} className="grow" rows={4} />
        <TField label="Attachments" className="grow">
          <AttachmentBox files={files} onChange={setFiles} dashed={kind !== "cheque"} />
        </TField>
        {kind === "bill" || kind === "cheque" ? <div className="grow" style={{ maxWidth: 260 }} /> : null}
      </div>
      {(kind === "cheque" || kind === "credit-card-credit") && files.length ? <p className="muted">Bank transactions don't store files yet — keep the receipt with your records.</p> : null}
      {kind === "purchase-order" ? <p className="muted">Purchase orders don't post to the books. They're kept here until you turn them into a bill.</p> : null}
      <p className="txn-privacy">
        <button type="button" className="txn-link" onClick={() => navigate("/settings/advanced")}>
          Privacy
        </button>
      </p>

      {adding ? (
        <AddSupplierDrawer
          onClose={() => setAdding(false)}
          onSaved={(s) => {
            setAdding(false);
            reloadSuppliers();
            pickSupplier(s.id, [...suppliers, s]);
          }}
        />
      ) : null}
      {recurring ? <RecurringModal kind={kind as TxnKind} defaultName={`${partyName || title} recurring`} snapshot={form} onClose={() => setRecurring(false)} /> : null}
      {preview ? (
        <Modal
          title="Print preview"
          onClose={() => setPreview(false)}
          width={940}
          footer={
            <button type="button" className="txn-btn-primary" onClick={() => window.print()}>
              <Printer size={18} style={{ verticalAlign: "-3px", marginRight: 8 }} /> Print
            </button>
          }
        >
          <DocPreview
            mode="pdf"
            docTitle={title}
            number={form.number}
            party={partyName}
            partyAddress={form.mailing}
            dates={kind === "bill" || kind === "purchase-order" ? [["Date", form.date], ["Due date", form.dueDate]] : [["Date", form.date]]}
            lines={filledCategoryLines(form.lines).map((l) => ({ description: [categories.find((c) => c.value === l.category)?.label, l.description].filter(Boolean).join(" — "), amount: num(l.amount) }))}
            totals={[["Total", rwf(total, currency)]]}
            note={form.message || form.memo}
          />
        </Modal>
      ) : null}
    </TxnPage>
  );
}

/* ── Item receipt (151) ────────────────────────────────── */

type ReceiptLine = { product: string; sku: string; rate: string; qty: string };
const emptyReceiptLine = (): ReceiptLine => ({ product: "", sku: "", rate: "", qty: "" });
const RECEIPT_KEYS = ["product", "rate", "qty"];

export function ItemReceiptForm() {
  const { toast } = useFeedback();
  const { suppliers, reload } = useSuppliers();
  const items = useInventoryItems();
  const v = useValidation();
  const blank = () => ({ supplierId: "", date: isoDay(), number: peekNumber("item-receipt"), memo: "", lines: [emptyReceiptLine(), emptyReceiptLine()] });
  const [form, setForm] = useState(blank);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [autofill, setAutofill] = useState(true);
  const [adding, setAdding] = useState(false);
  const itemOptions = useMemo(() => items.map((i) => ({ value: i.id, label: i.name, hint: i.sku || undefined })), [items]);
  const supplier = suppliers.find((s) => s.id === form.supplierId);

  const schema = yup.object({
    supplierId: yup.string().required("Choose a supplier"),
    date: yup.string().required("Choose the date"),
    number: yup.string().trim().required("Enter a receipt number").max(21, "Use 21 characters or fewer"),
    memo: yup.string().max(1000, "Use 1,000 characters or fewer"),
    lines: yup
      .array()
      .of(
        yup.object({
          product: yup.string().test("p", "Choose an item", function (val) {
            return isBlankRow(this.parent, RECEIPT_KEYS) || Boolean(val);
          }),
          rate: yup.string().test("r", "Rate can't be negative", (val) => !val || num(val) >= 0),
          qty: yup.string().test("q", "Quantity received must be more than 0", function (val) {
            return isBlankRow(this.parent, RECEIPT_KEYS) || num(val ?? "") > 0;
          }),
        }),
      )
      .test("some", "Add at least one item received", (rows) => (rows ?? []).some((r) => !isBlankRow(r as ReceiptLine, RECEIPT_KEYS))),
  });

  async function save(close: boolean) {
    if (!(await v.validate(schema, form))) return;
    const lines = form.lines.filter((l) => !isBlankRow(l, RECEIPT_KEYS));
    const value = lines.reduce((s, l) => s + num(l.qty) * num(l.rate), 0);
    const id = newId();
    takeNumber("item-receipt", form.number);
    saveLocal("item-receipt", { id, ...form, lines, supplierName: supplier?.name, value, attachments: files.map((f) => f.file.name), createdAt: new Date().toISOString() });
    indexTxn({ id, kind: "item-receipt", number: form.number, date: form.date, party: supplier?.name ?? "", amount: value, memo: form.memo, status: "Received", posted: false });
    toast(`Item receipt #${form.number} saved — record the supplier's bill when it arrives`);
    if (close) return navigate("/inventory");
    setForm(blank());
    setFiles([]);
  }

  return (
    <TxnPage
      title={`Item receipt #${form.number}`}
      kind="item-receipt"
      brand={false}
      onClose={() => navigate("/inventory")}
      actions={["feedback", "help", "close"]}
      feedbackLabel="Give feedback"
      left={
        autofill ? (
          <AutofillPanel
            title="Autofill this item receipt"
            photos={false}
            showSample={false}
            formats="PDF, PNG, JPEG."
            accept=".pdf,.png,.jpg,.jpeg,.csv"
            onClose={() => setAutofill(false)}
            onFiles={(fs) => setFiles((cur) => [...cur, ...fs.map((f) => ({ id: `${f.name}-${f.size}`, file: f }))])}
            onRows={(rows) =>
              setForm((f) => ({
                ...f,
                lines: [
                  ...f.lines.filter((l) => !isBlankRow(l, RECEIPT_KEYS)),
                  ...rows.map(([name = "", qty = "", rate = ""]) => {
                    const item = items.find((i) => i.name.toLowerCase() === name.toLowerCase() || i.sku.toLowerCase() === name.toLowerCase());
                    return { product: item?.id ?? "", sku: item?.sku ?? "", qty: String(num(qty) || ""), rate: fmt(num(rate)) };
                  }),
                ],
              }))
            }
          />
        ) : undefined
      }
      footer={
        <TxnFooter
          left={<CancelButton onClick={() => navigate("/inventory")} />}
          right={
            <>
              <button type="button" className="txn-btn-outline blue" onClick={() => void save(false)}>
                Save
              </button>
              <button type="button" className="txn-btn-primary" onClick={() => void save(true)}>
                Save and close
              </button>
            </>
          }
        />
      }
    >
      <ValidationSummary count={v.count} />
      <HeaderBand collapsible={false}>
        <div className="txn-row">
          <TField label="Supplier" required error={v.errors.supplierId} className="w-md">
            <PartySelect value={form.supplierId} onChange={(id) => (setForm((f) => ({ ...f, supplierId: id })), v.clear("supplierId"))} options={supplierOptions(suppliers)} placeholder="Choose a supplier" invalid={Boolean(v.errors.supplierId)} addLabel="Add new supplier" onAdd={() => setAdding(true)} />
          </TField>
          <TField label="Date" required error={v.errors.date} className="w-md">
            <input className="txn-input" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </TField>
          <TField label="Receipt no." required error={v.errors.number} className="w-md">
            <input className="txn-input" value={form.number} onChange={(e) => (setForm((f) => ({ ...f, number: e.target.value })), v.clear("number"))} />
          </TField>
        </div>
      </HeaderBand>
      <h3 style={{ fontSize: 24, margin: "0 0 4px" }}>Item details</h3>
      <LineGrid
        columns={[
          {
            key: "product",
            label: "PRODUCT/SERVICE",
            kind: "select",
            options: itemOptions,
            width: "30%",
            onSet: (row, value) => {
              const item = items.find((i) => i.id === value);
              return { ...row, product: value, sku: item?.sku ?? "", rate: row.rate || (item?.unitCost ? fmt(item.unitCost) : "") };
            },
          },
          { key: "sku", label: "SKU", kind: "readonly", width: "12%" },
          { key: "rate", label: "RATE", kind: "money", width: "20%" },
          { key: "qty", label: "QTY RECEIVED", kind: "number", width: "22%" },
        ]}
        rows={form.lines}
        onChange={(rows) => (setForm((f) => ({ ...f, lines: rows })), v.clear("lines"))}
        newRow={emptyReceiptLine}
        errors={v.errors}
        showClear={false}
      />
      {itemOptions.length === 0 ? <p className="muted" style={{ marginTop: -10 }}>No stocked items yet — add products under Inventory first.</p> : null}
      <div className="txn-lower" style={{ gap: 30 }}>
        <TextArea label="Memo" value={form.memo} onChange={(t) => setForm((f) => ({ ...f, memo: t }))} error={v.errors.memo} className="w-lg" rows={4} />
        <TField label="Attachments" className="w-lg">
          <AttachmentBox files={files} onChange={setFiles} />
        </TField>
      </div>
      <p className="muted">Item receipts are kept here and don't move stock in the books until the matching bill is posted.</p>
      {adding ? (
        <AddSupplierDrawer
          onClose={() => setAdding(false)}
          onSaved={(s) => {
            setAdding(false);
            reload();
            setForm((f) => ({ ...f, supplierId: s.id }));
          }}
        />
      ) : null}
    </TxnPage>
  );
}

/* ── Pay bills (149) ───────────────────────────────────── */

const RANGES = [
  { value: "12M", label: "Last 12 months", months: 12 },
  { value: "6M", label: "Last 6 months", months: 6 },
  { value: "3M", label: "Last 3 months", months: 3 },
  { value: "1M", label: "Last month", months: 1 },
  { value: "ALL", label: "All dates", months: 0 },
];

export function PayBillsForm() {
  const { api } = useSession();
  const { toast } = useFeedback();
  const { currency } = useCompany();
  const banks = useFinancialAccounts();
  const bills = useResource<ApBill[]>("/api/v1/ap/bills?status=OPEN");
  const v = useValidation();
  const [account, setAccount] = useState("");
  const [paymentDate, setPaymentDate] = useState(isoDay());
  const [range, setRange] = useState("12M");
  const [rangeChip, setRangeChip] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);
  const [payeeFilter, setPayeeFilter] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [customise, setCustomise] = useState(false);
  const [cols, setCols] = useState({ ref: true, status: true, approval: true, credit: true });
  const [sortAsc, setSortAsc] = useState(true);
  const [payments, setPayments] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pageSize = 10;
  const today = isoDay();
  const from = rangeChip && range !== "ALL" ? monthsAgo(today, RANGES.find((r) => r.value === range)!.months) : "";

  const rows = useMemo(() => {
    let list = (bills.data ?? []).filter((b) => b.outstanding > 0);
    if (from) list = list.filter((b) => b.dueDate >= from && b.dueDate <= addDays(today, 3650));
    if (payeeFilter) list = list.filter((b) => b.supplierId === payeeFilter);
    if (overdueOnly) list = list.filter((b) => b.dueDate < today);
    return list.sort((a, b) => (sortAsc ? a.dueDate.localeCompare(b.dueDate) : b.dueDate.localeCompare(a.dueDate)));
  }, [bills.data, from, payeeFilter, overdueOnly, sortAsc, today]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const visible = rows.slice((page - 1) * pageSize, page * pageSize);
  const selected = rows.filter((b) => num(payments[b.id] ?? "") > 0);
  const totalPayment = selected.reduce((s, b) => s + num(payments[b.id]), 0);
  const suppliersInList = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of bills.data ?? []) m.set(b.supplierId, b.supplierName);
    return [...m].map(([value, label]) => ({ value, label }));
  }, [bills.data]);
  const allOn = visible.length > 0 && visible.every((b) => num(payments[b.id] ?? "") > 0);

  async function save(close: boolean) {
    setError("");
    const errs: Record<string, string> = {};
    if (!account) errs.account = "Choose the account you're paying from";
    if (!paymentDate) errs.paymentDate = "Choose a payment date";
    for (const b of rows) {
      const p = num(payments[b.id] ?? "");
      if (p > b.outstanding + 0.001) errs[`pay.${b.id}`] = `More than the ${amount(b.outstanding, 2)} open balance`;
    }
    v.setErrors(errs);
    if (Object.keys(errs).length) return;
    if (!selected.length) return setError("Select at least one bill to pay.");
    const bank = banks.data?.find((b) => b.id === account);
    if (bank && !bank.allowOverdraft && totalPayment > bank.balance + 0.001) return setError(`${bank.name} only has ${rwf(bank.balance, currency)} and doesn't allow overdrafts.`);
    setBusy(true);
    const bySupplier = new Map<string, ApBill[]>();
    for (const b of selected) bySupplier.set(b.supplierId, [...(bySupplier.get(b.supplierId) ?? []), b]);
    let done = 0;
    try {
      for (const [supplierId, list] of bySupplier) {
        const allocations = list.map((b) => ({ billId: b.id, amount: Math.round(num(payments[b.id]) * 100) / 100 }));
        const total = allocations.reduce((s, a) => s + a.amount, 0);
        const p = await api<{ id: string; paymentNumber: string }>("/api/v1/ap/payments", {
          method: "POST",
          body: JSON.stringify({ supplierId, paymentDate, method: "BANK", amount: Math.round(total * 100) / 100, financialAccountId: account, allocations }),
        });
        indexTxn({ id: p.id, kind: "bill-payment", number: p.paymentNumber, date: paymentDate, party: list[0].supplierName, amount: total, memo: list.map((b) => b.billNumber).join(", "), status: "Posted", posted: true });
        done++;
      }
      toast(`${done} payment${done > 1 ? "s" : ""} recorded for ${rwf(totalPayment, currency)}`);
      if (close) return navigate("/supplier-payments");
      setPayments({});
      bills.reload();
    } catch (e) {
      setError(`${done ? `${done} payment${done > 1 ? "s" : ""} saved, then ` : ""}${(e as Error).message}`);
      bills.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <TxnPage
      title="Pay Bills"
      onClose={() => navigate("/bills")}
      actions={["help", "autofill", "close"]}
      onAutofill={() => toast("Select bills below, enter what you're paying, then save.")}
      footer={
        <TxnFooter
          left={<CancelButton onClick={() => navigate("/bills")} />}
          right={
            <>
              <button type="button" className="txn-btn-outline blue" onClick={() => void save(false)} disabled={busy || !selected.length}>
                Save
              </button>
              <SplitButton label="Save and close" onClick={() => void save(true)} busy={busy} disabled={!selected.length} />
            </>
          }
        />
      }
    >
      <ErrorBanner message={error || bills.error || ""} onClose={() => setError("")} />
      <HeaderBand
        collapsible={false}
        aside={
          <>
            <span style={{ marginBottom: 18 }} />
            <span className="txn-amount-label">Total payment amount</span>
            <strong className="txn-amount">{rwf(totalPayment, currency)}</strong>
          </>
        }
      >
        <div className="txn-row">
          <TField label="Payment account" required error={v.errors.account} className="w-md">
            <Select value={account} onChange={(a) => (setAccount(a), v.clear("account"))} options={financialAccountOptions(banks.data ?? [])} placeholder="Select an account" invalid={Boolean(v.errors.account)} />
          </TField>
          <TField label="Payment date" required error={v.errors.paymentDate} className="w-sm">
            <input className="txn-input" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </TField>
        </div>
      </HeaderBand>

      <div className="txn-row" style={{ alignItems: "flex-end" }}>
        <TField label="Due Date" className="w-md">
          <Select value={range} onChange={(r) => (setRange(r), setRangeChip(true), setPage(1))} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} searchable={false} />
        </TField>
        <span style={{ position: "relative" }}>
          <button type="button" className="txn-btn-outline blue" onClick={() => setFilterOpen((o) => !o)}>
            <Filter size={18} /> Filters
          </button>
          {filterOpen ? (
            <div className="txn-popover" style={{ left: 0 }}>
              <TField label="Payee">
                <Select value={payeeFilter} onChange={(p) => (setPayeeFilter(p), setPage(1))} options={[{ value: "", label: "All payees" }, ...suppliersInList]} />
              </TField>
              <label className="txn-check" style={{ marginTop: 10 }}>
                <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only
              </label>
            </div>
          ) : null}
        </span>
        <span style={{ marginLeft: "auto", position: "relative" }}>
          <button type="button" className="txn-btn-outline blue" onClick={() => setCustomise((c) => !c)}>
            <SlidersHorizontal size={18} /> Customise
          </button>
          {customise ? (
            <div className="txn-popover" style={{ right: 0 }}>
              {(
                [
                  ["ref", "Ref no."],
                  ["status", "Status"],
                  ["approval", "Bill approval"],
                  ["credit", "Credit applied"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="txn-check">
                  <input type="checkbox" checked={cols[k]} onChange={(e) => setCols((c) => ({ ...c, [k]: e.target.checked }))} /> {label}
                </label>
              ))}
            </div>
          ) : null}
        </span>
      </div>
      {rangeChip && from ? (
        <div style={{ margin: "14px 0" }}>
          <span className="txn-chip">
            <Calendar size={15} /> Due Date: {date(from)}–{date(today)}
            <button type="button" className="txn-icon sm" aria-label="Remove due date filter" onClick={() => setRangeChip(false)}>
              <X size={16} />
            </button>
          </span>
        </div>
      ) : null}

      <table className="txn-table caps">
        <thead>
          <tr>
            <th style={{ width: 48 }}>
              <input
                type="checkbox"
                aria-label="Select all bills on this page"
                checked={allOn}
                onChange={(e) => setPayments((p) => ({ ...p, ...Object.fromEntries(visible.map((b) => [b.id, e.target.checked ? fmt(b.outstanding) : ""])) }))}
              />
            </th>
            <th>Payee</th>
            {cols.ref ? <th>Ref no.</th> : null}
            <th>
              <button type="button" className="txn-link" style={{ color: "inherit", fontWeight: 750 }} onClick={() => setSortAsc((s) => !s)}>
                DUE DATE {sortAsc ? "↑" : "↓"}
              </button>
            </th>
            {cols.status ? <th>Status</th> : null}
            {cols.approval ? <th className="right">Bill approval</th> : null}
            <th className="right">Open balance</th>
            {cols.credit ? <th className="right">Credit applied</th> : null}
            <th className="right" style={{ width: 170 }}>
              Payment
            </th>
            <th className="right">Total amount</th>
            <th className="right">Action</th>
          </tr>
        </thead>
        <tbody>
          {bills.loading ? (
            <tr>
              <td colSpan={11} className="muted">
                Loading bills…
              </td>
            </tr>
          ) : visible.length === 0 ? (
            <tr>
              <td colSpan={11}>
                <div className="txn-empty">
                  <h3>No results found</h3>
                  <p>Remove some filters or try a different search</p>
                </div>
              </td>
            </tr>
          ) : (
            visible.map((b) => {
              const err = v.errors[`pay.${b.id}`];
              const overdue = b.dueDate < today;
              return (
                <tr key={b.id}>
                  <td>
                    <input type="checkbox" aria-label={`Pay ${b.billNumber}`} checked={num(payments[b.id] ?? "") > 0} onChange={(e) => setPayments((p) => ({ ...p, [b.id]: e.target.checked ? fmt(b.outstanding) : "" }))} />
                  </td>
                  <td>{b.supplierName}</td>
                  {cols.ref ? <td>{b.supplierInvoiceNumber ?? b.billNumber}</td> : null}
                  <td>{date(b.dueDate)}</td>
                  {cols.status ? <td style={{ color: overdue ? "#b42318" : undefined }}>{overdue ? "Overdue" : "Due"}</td> : null}
                  {cols.approval ? <td className="right">Approved</td> : null}
                  <td className="right">{amount(b.outstanding, 2)}</td>
                  {cols.credit ? <td className="right">{amount(b.credited, 2)}</td> : null}
                  <td className="right">
                    <input
                      className={`txn-input num ${err ? "invalid" : ""}`}
                      value={payments[b.id] ?? ""}
                      title={err}
                      aria-label={`Payment for ${b.billNumber}`}
                      onChange={(e) => (setPayments((p) => ({ ...p, [b.id]: e.target.value.replace(/[^\d.,]/g, "") })), v.clear(`pay.${b.id}`))}
                    />
                    {err ? <div className="field-error">{err}</div> : null}
                  </td>
                  <td className="right">{amount(b.gross, 2)}</td>
                  <td className="right">
                    <button type="button" className="txn-link" onClick={() => setPayments((p) => ({ ...p, [b.id]: fmt(b.outstanding) }))}>
                      Pay full
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
        <tfoot>
          <tr>
            <td />
            <td>Total payment</td>
            {cols.ref ? <td /> : null}
            <td />
            {cols.status ? <td /> : null}
            {cols.approval ? <td /> : null}
            <td className="right">{rwf(rows.reduce((s, b) => s + b.outstanding, 0), currency)}</td>
            {cols.credit ? <td className="right">{rwf(rows.reduce((s, b) => s + b.credited, 0), currency)}</td> : null}
            <td className="right">{rwf(totalPayment, currency)}</td>
            <td className="right">{rwf(rows.reduce((s, b) => s + b.gross, 0), currency)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      <div className="txn-pager">
        <span>
          {rows.length ? (page - 1) * pageSize + 1 : 0} - {Math.min(page * pageSize, rows.length)} of {rows.length} items
        </span>
        <button type="button" className="txn-icon sm" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          ‹
        </button>
        <span>
          Page <strong>{page}</strong> of {pages}
        </span>
        <button type="button" className="txn-icon sm" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
          ›
        </button>
      </div>
    </TxnPage>
  );
}


