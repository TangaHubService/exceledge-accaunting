import { type FormEvent, useState } from "react";
import { accountOptions } from "../pages/Accounts";
import { monthStart } from "../pages/WithholdingTax";
import { financialAccountOptions, useFinancialAccounts } from "../lib/banking";
import { useCompany } from "../lib/company";
import { isoDay } from "../lib/format";
import { useResource, useSession } from "../lib/session";
import { FILING_KIND_LABELS, FILING_KINDS, PAYABLE_TAX_TYPES, TAX_TYPE_LABELS } from "../lib/tax";
import type { TaxCode, TaxFiling, TaxFilingKind, TaxPayment, TaxSettings, TaxType } from "../lib/types";
import { Footer, FormError, MoneyInput, parseAmount, useSubmit } from "./forms";
import { Select } from "./Select";
import { Drawer, Field } from "./ui";

export function TaxPaymentForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const banks = useFinancialAccounts();
  const [form, setForm] = useState({
    paymentDate: isoDay(),
    taxType: "OUTPUT_VAT" as TaxType,
    financialAccountId: "",
    amount: "",
    isRefund: false,
    reference: "",
    description: "",
    periodFrom: monthStart(),
    periodTo: isoDay(),
  });
  const { busy, error, run } = useSubmit();
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const amount = parseAmount(form.amount);
    if (!(amount > 0)) return;
    void run(async () => {
      await api<TaxPayment>("/api/v1/tax/payments", {
        method: "POST",
        body: JSON.stringify({
          paymentDate: form.paymentDate,
          taxType: form.taxType,
          financialAccountId: form.financialAccountId || undefined,
          amount,
          isRefund: form.isRefund || undefined,
          reference: form.reference.trim() || undefined,
          description: form.description.trim() || undefined,
          periodFrom: form.periodFrom || undefined,
          periodTo: form.periodTo || undefined,
        }),
      });
      onSaved();
      return form.isRefund ? "Tax refund recorded" : "Tax payment recorded";
    });
  }

  return (
    <Drawer title={form.isRefund ? "Record tax refund" : "Record tax payment"} onClose={onClose} wide footer={<Footer onCancel={onClose} busy={busy} label="Post" formId="tax-pay" />}>
      <FormError message={error} />
      <form id="tax-pay" onSubmit={submit} className="form-grid">
        <Field label="Date">
          <input className="input" type="date" required value={form.paymentDate} onChange={(e) => set("paymentDate")(e.target.value)} />
        </Field>
        <Field label="Tax type">
          <Select
            value={form.taxType}
            onChange={(v) => set("taxType")(v as TaxType)}
            options={PAYABLE_TAX_TYPES.map((t) => ({ value: t, label: TAX_TYPE_LABELS[t] }))}
          />
        </Field>
        <Field label="Paid from">
          <Select
            value={form.financialAccountId}
            onChange={set("financialAccountId")}
            options={[{ value: "", label: "Default bank / cash" }, ...financialAccountOptions(banks.data ?? [])]}
            searchable
          />
        </Field>
        <Field label="Amount">
          <MoneyInput value={form.amount} onChange={set("amount")} required />
        </Field>
        <Field label="Period from">
          <input className="input" type="date" value={form.periodFrom} onChange={(e) => set("periodFrom")(e.target.value)} />
        </Field>
        <Field label="Period to">
          <input className="input" type="date" value={form.periodTo} onChange={(e) => set("periodTo")(e.target.value)} />
        </Field>
        <Field label="Authority reference" className="span-2">
          <input className="input" value={form.reference} onChange={(e) => set("reference")(e.target.value)} placeholder="RRA receipt or declaration number" />
        </Field>
        <Field label="Notes" className="span-2">
          <input className="input" value={form.description} onChange={(e) => set("description")(e.target.value)} />
        </Field>
        <label className="check span-2">
          <input type="checkbox" checked={form.isRefund} onChange={(e) => set("isRefund")(e.target.checked)} />
          This is a refund received from the authority
        </label>
      </form>
    </Drawer>
  );
}

export function TaxAdjustmentForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const { accounts } = useCompany();
  const [form, setForm] = useState({
    adjustmentDate: isoDay(),
    taxType: "OUTPUT_VAT" as TaxType,
    contraAccountId: "",
    amount: "",
    increasesLiability: true,
    reason: "",
    reference: "",
  });
  const { busy, error, run } = useSubmit();
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const amount = parseAmount(form.amount);
    if (!(amount > 0) || !form.contraAccountId || form.reason.trim().length < 3) return;
    void run(async () => {
      await api("/api/v1/tax/adjustments", {
        method: "POST",
        body: JSON.stringify({
          adjustmentDate: form.adjustmentDate,
          taxType: form.taxType,
          contraAccountId: form.contraAccountId,
          amount,
          increasesLiability: form.increasesLiability,
          reason: form.reason.trim(),
          reference: form.reference.trim() || undefined,
        }),
      });
      onSaved();
      return "Tax adjustment posted";
    });
  }

  return (
    <Drawer title="Tax adjustment" onClose={onClose} wide footer={<Footer onCancel={onClose} busy={busy} label="Post" formId="tax-adj" />}>
      <FormError message={error} />
      <form id="tax-adj" onSubmit={submit} className="form-grid">
        <Field label="Date">
          <input className="input" type="date" required value={form.adjustmentDate} onChange={(e) => set("adjustmentDate")(e.target.value)} />
        </Field>
        <Field label="Tax type">
          <Select
            value={form.taxType}
            onChange={(v) => set("taxType")(v as TaxType)}
            options={(["OUTPUT_VAT", "INPUT_VAT", "WHT_PAYABLE", "PAYE", "OTHER"] as TaxType[]).map((t) => ({ value: t, label: TAX_TYPE_LABELS[t] }))}
          />
        </Field>
        <Field label="Amount">
          <MoneyInput value={form.amount} onChange={set("amount")} required />
        </Field>
        <Field label="Effect">
          <Select
            value={form.increasesLiability ? "up" : "down"}
            onChange={(v) => set("increasesLiability")(v === "up")}
            options={[
              { value: "up", label: "Increases liability / reduces recoverable" },
              { value: "down", label: "Reduces liability / increases recoverable" },
            ]}
          />
        </Field>
        <Field label="Contra account" className="span-2">
          <Select value={form.contraAccountId} onChange={set("contraAccountId")} options={accountOptions(accounts.filter((a) => a.isActive))} placeholder="Choose account" />
        </Field>
        <Field label="Reason" className="span-2">
          <textarea className="input" rows={3} required minLength={3} value={form.reason} onChange={(e) => set("reason")(e.target.value)} placeholder="Assessment, correction, credit note…" />
        </Field>
        <Field label="Reference" className="span-2">
          <input className="input" value={form.reference} onChange={(e) => set("reference")(e.target.value)} />
        </Field>
      </form>
    </Drawer>
  );
}

export function PrepareFilingForm({ onClose, onSaved }: { onClose: () => void; onSaved: (f: TaxFiling) => void }) {
  const { api } = useSession();
  const [form, setForm] = useState({
    kind: "VAT" as TaxFilingKind,
    periodFrom: monthStart(),
    periodTo: isoDay(),
    dueDate: "",
    notes: "",
  });
  const { busy, error, run } = useSubmit();
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const filing = await api<TaxFiling>("/api/v1/tax/filings", {
        method: "POST",
        body: JSON.stringify({
          kind: form.kind,
          periodFrom: form.periodFrom,
          periodTo: form.periodTo,
          dueDate: form.dueDate || undefined,
          notes: form.notes.trim() || undefined,
        }),
      });
      onSaved(filing);
      return `${FILING_KIND_LABELS[form.kind]} prepared`;
    });
  }

  return (
    <Drawer title="Prepare tax return" onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Prepare" formId="tax-fil" />}>
      <FormError message={error} />
      <form id="tax-fil" onSubmit={submit} className="form-grid">
        <Field label="Return" className="span-2">
          <Select value={form.kind} onChange={(v) => set("kind")(v as TaxFilingKind)} options={FILING_KINDS.map((k) => ({ value: k, label: FILING_KIND_LABELS[k] }))} />
        </Field>
        <Field label="Period from">
          <input className="input" type="date" required value={form.periodFrom} onChange={(e) => set("periodFrom")(e.target.value)} />
        </Field>
        <Field label="Period to">
          <input className="input" type="date" required value={form.periodTo} onChange={(e) => set("periodTo")(e.target.value)} />
        </Field>
        <Field label="Due date" className="span-2">
          <input className="input" type="date" value={form.dueDate} onChange={(e) => set("dueDate")(e.target.value)} />
        </Field>
        <Field label="Notes" className="span-2">
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => set("notes")(e.target.value)} />
        </Field>
        <p className="muted small span-2">Figures are taken from posted journals for the period. Rates are never recalculated here.</p>
      </form>
    </Drawer>
  );
}

export function FileFilingForm({ filing, onClose, onSaved }: { filing: TaxFiling; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const [reference, setReference] = useState(filing.filingReference ?? "");
  const [filedAt, setFiledAt] = useState(isoDay());
  const { busy, error, run } = useSubmit();

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api(`/api/v1/tax/filings/${filing.id}/file`, {
        method: "POST",
        body: JSON.stringify({ filingReference: reference.trim() || undefined, filedAt }),
      });
      onSaved();
      return "Return marked as filed";
    });
  }

  return (
    <Drawer title={`File ${filing.number}`} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Mark filed" formId="tax-file" />}>
      <FormError message={error} />
      <form id="tax-file" onSubmit={submit} className="form-grid">
        <Field label="Filed on" className="span-2">
          <input className="input" type="date" required value={filedAt} onChange={(e) => setFiledAt(e.target.value)} />
        </Field>
        <Field label="Authority reference" className="span-2">
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Declaration or acknowledgement number" />
        </Field>
      </form>
    </Drawer>
  );
}

export function TaxCodeForm({ code, onClose, onSaved }: { code?: TaxCode; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const { accounts } = useCompany();
  const editing = Boolean(code);
  const [form, setForm] = useState({
    code: code?.code ?? "",
    name: code?.name ?? "",
    taxType: (code?.taxType ?? "OUTPUT_VAT") as TaxType,
    ratePercent: code ? String(code.ratePercent) : "18",
    glAccountId: code?.glAccountId ?? "",
    authority: code?.authority ?? "RRA",
    effectiveFrom: code ? code.effectiveFrom.slice(0, 10) : "2020-01-01",
    effectiveTo: code?.effectiveTo ? code.effectiveTo.slice(0, 10) : "",
    appliesTo: code?.appliesTo ?? "SALES",
    notes: code?.notes ?? "",
    isActive: code?.isActive ?? true,
  });
  const { busy, error, run } = useSubmit();
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const rate = Number(form.ratePercent);
    if (!(rate >= 0) || rate > 100) return;
    void run(async () => {
      if (editing) {
        await api(`/api/v1/tax/codes/${code!.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: form.name.trim(),
            ratePercent: rate,
            glAccountId: form.glAccountId || null,
            authority: form.authority.trim() || null,
            effectiveFrom: form.effectiveFrom,
            effectiveTo: form.effectiveTo || null,
            appliesTo: form.appliesTo || null,
            notes: form.notes.trim() || null,
            isActive: form.isActive,
          }),
        });
      } else {
        await api("/api/v1/tax/codes", {
          method: "POST",
          body: JSON.stringify({
            code: form.code.trim().toUpperCase(),
            name: form.name.trim(),
            taxType: form.taxType,
            ratePercent: rate,
            glAccountId: form.glAccountId || undefined,
            authority: form.authority.trim() || undefined,
            effectiveFrom: form.effectiveFrom,
            effectiveTo: form.effectiveTo || undefined,
            appliesTo: form.appliesTo || undefined,
            notes: form.notes.trim() || undefined,
          }),
        });
      }
      onSaved();
      return editing ? "Tax code updated" : "Tax code created";
    });
  }

  return (
    <Drawer title={editing ? `Edit ${code!.code}` : "Add tax code"} onClose={onClose} wide footer={<Footer onCancel={onClose} busy={busy} label={editing ? "Save" : "Create"} formId="tax-code" />}>
      <FormError message={error} />
      <form id="tax-code" onSubmit={submit} className="form-grid">
        <Field label="Code">
          <input className="input" required disabled={editing} value={form.code} onChange={(e) => set("code")(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Name">
          <input className="input" required value={form.name} onChange={(e) => set("name")(e.target.value)} />
        </Field>
        <Field label="Type">
          <Select
            value={form.taxType}
            onChange={(v) => set("taxType")(v as TaxType)}
            options={Object.entries(TAX_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
            disabled={editing}
          />
        </Field>
        <Field label="Rate %">
          <input className="input num" type="number" min={0} max={100} step="0.01" required value={form.ratePercent} onChange={(e) => set("ratePercent")(e.target.value)} />
        </Field>
        <Field label="GL account" className="span-2">
          <Select value={form.glAccountId} onChange={set("glAccountId")} options={[{ value: "", label: "Use company default" }, ...accountOptions(accounts.filter((a) => a.isActive))]} searchable />
        </Field>
        <Field label="Authority">
          <input className="input" value={form.authority} onChange={(e) => set("authority")(e.target.value)} />
        </Field>
        <Field label="Applies to">
          <Select
            value={form.appliesTo}
            onChange={set("appliesTo")}
            options={[
              { value: "SALES", label: "Sales" },
              { value: "PURCHASES", label: "Purchases" },
              { value: "BOTH", label: "Both" },
            ]}
          />
        </Field>
        <Field label="Effective from">
          <input className="input" type="date" required value={form.effectiveFrom} onChange={(e) => set("effectiveFrom")(e.target.value)} />
        </Field>
        <Field label="Effective to">
          <input className="input" type="date" value={form.effectiveTo} onChange={(e) => set("effectiveTo")(e.target.value)} />
        </Field>
        {editing && (
          <label className="check span-2">
            <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive")(e.target.checked)} />
            Active
          </label>
        )}
        <Field label="Notes" className="span-2">
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => set("notes")(e.target.value)} />
        </Field>
      </form>
    </Drawer>
  );
}

export function TaxSettingsForm({ settings, onClose, onSaved }: { settings: TaxSettings; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const codes = useResource<TaxCode[]>("/api/v1/tax/codes?all=1");
  const [form, setForm] = useState({
    taxAuthority: settings.taxAuthority ?? "RRA",
    tin: settings.tin ?? "",
    vatRegistered: settings.vatRegistered,
    vatFilingFrequency: settings.vatFilingFrequency ?? "MONTHLY",
    taxCurrency: settings.taxCurrency || "RWF",
    roundingMethod: settings.roundingMethod ?? "HALF_UP",
    defaultOutputTaxCodeId: settings.defaultOutputTaxCodeId ?? "",
    defaultInputTaxCodeId: settings.defaultInputTaxCodeId ?? "",
    defaultWhtTaxCodeId: settings.defaultWhtTaxCodeId ?? "",
    notes: settings.notes ?? "",
  });
  const { busy, error, run } = useSubmit();
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const codeOpts = (codes.data ?? settings.codes).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}`, hint: `${c.ratePercent}%` }));

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api("/api/v1/tax/settings", {
        method: "PUT",
        body: JSON.stringify({
          taxAuthority: form.taxAuthority.trim() || null,
          tin: form.tin.trim() || null,
          vatRegistered: form.vatRegistered,
          vatFilingFrequency: form.vatFilingFrequency || null,
          taxCurrency: form.taxCurrency,
          roundingMethod: form.roundingMethod || null,
          defaultOutputTaxCodeId: form.defaultOutputTaxCodeId || null,
          defaultInputTaxCodeId: form.defaultInputTaxCodeId || null,
          defaultWhtTaxCodeId: form.defaultWhtTaxCodeId || null,
          notes: form.notes.trim() || null,
        }),
      });
      onSaved();
      return "Tax settings saved";
    });
  }

  return (
    <Drawer title="Tax settings" onClose={onClose} wide footer={<Footer onCancel={onClose} busy={busy} label="Save" formId="tax-set" />}>
      <FormError message={error} />
      <form id="tax-set" onSubmit={submit} className="form-grid">
        <Field label="Tax authority">
          <input className="input" value={form.taxAuthority} onChange={(e) => set("taxAuthority")(e.target.value)} />
        </Field>
        <Field label="TIN">
          <input className="input" value={form.tin} onChange={(e) => set("tin")(e.target.value)} pattern="\d{9}" title="9 digits" placeholder="9-digit TIN" />
        </Field>
        <Field label="Filing frequency">
          <Select
            value={form.vatFilingFrequency}
            onChange={set("vatFilingFrequency")}
            options={[
              { value: "MONTHLY", label: "Monthly" },
              { value: "QUARTERLY", label: "Quarterly" },
              { value: "ANNUAL", label: "Annual" },
            ]}
          />
        </Field>
        <Field label="Tax currency">
          <input className="input" maxLength={3} value={form.taxCurrency} onChange={(e) => set("taxCurrency")(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Default output VAT code">
          <Select value={form.defaultOutputTaxCodeId} onChange={set("defaultOutputTaxCodeId")} options={[{ value: "", label: "None" }, ...codeOpts]} />
        </Field>
        <Field label="Default input VAT code">
          <Select value={form.defaultInputTaxCodeId} onChange={set("defaultInputTaxCodeId")} options={[{ value: "", label: "None" }, ...codeOpts]} />
        </Field>
        <Field label="Default WHT code" className="span-2">
          <Select value={form.defaultWhtTaxCodeId} onChange={set("defaultWhtTaxCodeId")} options={[{ value: "", label: "None" }, ...codeOpts]} />
        </Field>
        <label className="check span-2">
          <input type="checkbox" checked={form.vatRegistered} onChange={(e) => set("vatRegistered")(e.target.checked)} />
          VAT registered
        </label>
        <Field label="Notes" className="span-2">
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => set("notes")(e.target.value)} />
        </Field>
      </form>
    </Drawer>
  );
}
