import { type FormEvent, useState } from "react";
import { financialAccountOptions, useFinancialAccounts } from "../lib/banking";
import { isoDay } from "../lib/format";
import { useResource, useSession } from "../lib/session";
import { FREQUENCY_LABELS, PAYMENT_MODE_LABELS } from "../lib/expense";
import type { Expense, ExpenseCategory, ExpensePaymentMode, RecurringExpense, RecurringFrequency } from "../lib/types";
import { Footer, FormError, MoneyInput, parseAmount, useSubmit } from "./forms";
import { Select } from "./Select";
import { Drawer, Field } from "./ui";

export function ExpenseForm({ onClose, onSaved }: { onClose: () => void; onSaved: (e: Expense) => void }) {
  const { api } = useSession();
  const categories = useResource<ExpenseCategory[]>("/api/v1/expenses/categories");
  const banks = useFinancialAccounts();
  const [form, setForm] = useState({
    expenseDate: isoDay(),
    categoryId: "",
    paymentMode: "IMMEDIATE" as ExpensePaymentMode,
    payeeName: "",
    employeeName: "",
    description: "",
    net: "",
    tax: "",
    financialAccountId: "",
    department: "",
    branch: "",
    receiptReference: "",
    submit: true,
  });
  const { busy, error, run } = useSubmit();
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const net = parseAmount(form.net);
    const tax = parseAmount(form.tax) || 0;
    if (!(net > 0) || !form.categoryId) return;
    void run(async () => {
      const saved = await api<Expense>("/api/v1/expenses", {
        method: "POST",
        body: JSON.stringify({
          expenseDate: form.expenseDate,
          categoryId: form.categoryId,
          paymentMode: form.paymentMode,
          payeeName: form.payeeName.trim() || undefined,
          employeeName: form.employeeName.trim() || undefined,
          description: form.description.trim() || undefined,
          net,
          tax: tax > 0 ? tax : undefined,
          financialAccountId: form.financialAccountId || undefined,
          department: form.department.trim() || undefined,
          branch: form.branch.trim() || undefined,
          receiptReference: form.receiptReference.trim() || undefined,
          submit: form.submit,
        }),
      });
      onSaved(saved);
      return form.submit ? "Expense submitted for approval" : "Expense saved as draft";
    });
  }

  return (
    <Drawer title="Record expense" onClose={onClose} wide footer={<Footer onCancel={onClose} busy={busy} label={form.submit ? "Submit" : "Save draft"} formId="exp-form" />}>
      <FormError message={error} />
      <form id="exp-form" onSubmit={submit} className="form-grid">
        <Field label="Date">
          <input className="input" type="date" required value={form.expenseDate} onChange={(e) => set("expenseDate")(e.target.value)} />
        </Field>
        <Field label="Category">
          <Select
            value={form.categoryId}
            onChange={set("categoryId")}
            options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.code }))}
            placeholder="Choose category"
            required
          />
        </Field>
        <Field label="How paid">
          <Select
            value={form.paymentMode}
            onChange={(v) => set("paymentMode")(v as ExpensePaymentMode)}
            options={Object.entries(PAYMENT_MODE_LABELS).map(([value, label]) => ({ value, label }))}
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
        <Field label="Amount (ex. tax)">
          <MoneyInput value={form.net} onChange={set("net")} required />
        </Field>
        <Field label="Input VAT">
          <MoneyInput value={form.tax} onChange={set("tax")} placeholder="0" />
        </Field>
        {form.paymentMode === "REIMBURSEMENT" ? (
          <Field label="Employee" className="span-2">
            <input className="input" value={form.employeeName} onChange={(e) => set("employeeName")(e.target.value)} required placeholder="Employee name" />
          </Field>
        ) : (
          <Field label="Payee" className="span-2">
            <input className="input" value={form.payeeName} onChange={(e) => set("payeeName")(e.target.value)} placeholder="Vendor or payee" />
          </Field>
        )}
        <Field label="Department">
          <input className="input" value={form.department} onChange={(e) => set("department")(e.target.value)} />
        </Field>
        <Field label="Branch">
          <input className="input" value={form.branch} onChange={(e) => set("branch")(e.target.value)} />
        </Field>
        <Field label="Description" className="span-2">
          <input className="input" value={form.description} onChange={(e) => set("description")(e.target.value)} />
        </Field>
        <Field label="Receipt reference" className="span-2">
          <input className="input" value={form.receiptReference} onChange={(e) => set("receiptReference")(e.target.value)} />
        </Field>
        <label className="check span-2">
          <input type="checkbox" checked={form.submit} onChange={(e) => set("submit")(e.target.checked)} />
          Submit for approval now
        </label>
      </form>
    </Drawer>
  );
}

export function RecurringExpenseForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const categories = useResource<ExpenseCategory[]>("/api/v1/expenses/categories");
  const banks = useFinancialAccounts();
  const [form, setForm] = useState({
    name: "",
    categoryId: "",
    frequency: "MONTHLY" as RecurringFrequency,
    amount: "",
    payeeName: "",
    startDate: isoDay(),
    financialAccountId: "",
    autoPost: false,
  });
  const { busy, error, run } = useSubmit();
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const amount = parseAmount(form.amount);
    if (!(amount > 0) || !form.categoryId || !form.name.trim()) return;
    void run(async () => {
      await api<RecurringExpense>("/api/v1/expenses/recurring", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          categoryId: form.categoryId,
          frequency: form.frequency,
          amount,
          payeeName: form.payeeName.trim() || undefined,
          startDate: form.startDate,
          financialAccountId: form.financialAccountId || undefined,
          autoPost: form.autoPost,
        }),
      });
      onSaved();
      return "Recurring expense saved";
    });
  }

  return (
    <Drawer title="Recurring expense" onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Save" formId="rex-form" />}>
      <FormError message={error} />
      <form id="rex-form" onSubmit={submit} className="form-grid">
        <Field label="Name" className="span-2">
          <input className="input" required value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="Office rent" />
        </Field>
        <Field label="Category">
          <Select value={form.categoryId} onChange={set("categoryId")} options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} required />
        </Field>
        <Field label="Frequency">
          <Select value={form.frequency} onChange={(v) => set("frequency")(v as RecurringFrequency)} options={Object.entries(FREQUENCY_LABELS).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Amount">
          <MoneyInput value={form.amount} onChange={set("amount")} required />
        </Field>
        <Field label="Start date">
          <input className="input" type="date" required value={form.startDate} onChange={(e) => set("startDate")(e.target.value)} />
        </Field>
        <Field label="Payee" className="span-2">
          <input className="input" value={form.payeeName} onChange={(e) => set("payeeName")(e.target.value)} />
        </Field>
        <Field label="Paid from" className="span-2">
          <Select value={form.financialAccountId} onChange={set("financialAccountId")} options={[{ value: "", label: "Default bank / cash" }, ...financialAccountOptions(banks.data ?? [])]} />
        </Field>
        <label className="check span-2">
          <input type="checkbox" checked={form.autoPost} onChange={(e) => set("autoPost")(e.target.checked)} />
          Post automatically when generated
        </label>
      </form>
    </Drawer>
  );
}
