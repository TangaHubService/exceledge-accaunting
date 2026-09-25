import { type FormEvent, useState } from "react";
import { financialAccountOptions, useFinancialAccounts } from "../lib/banking";
import { ASSET_STATUS, DEP_METHOD_LABELS, DISPOSAL_LABELS, currentPeriod } from "../lib/fa";
import { isoDay } from "../lib/format";
import { useResource, useSession } from "../lib/session";
import type { DepPreview, DisposalMethod, FaCategory, FixedAsset } from "../lib/types";
import { Footer, FormError, MoneyInput, parseAmount, useSubmit } from "./forms";
import { Select } from "./Select";
import { Drawer, Field } from "./ui";

export function RegisterAssetForm({ onClose, onSaved }: { onClose: () => void; onSaved: (a: FixedAsset) => void }) {
  const { api } = useSession();
  const categories = useResource<FaCategory[]>("/api/v1/fixed-assets/categories");
  const banks = useFinancialAccounts();
  const [form, setForm] = useState({
    name: "",
    categoryId: "",
    acquisitionCost: "",
    residualValue: "",
    purchaseDate: isoDay(),
    serialNumber: "",
    branch: "",
    location: "",
    assignedEmployee: "",
    description: "",
    capitalize: true,
    financialAccountId: "",
  });
  const { busy, error, run } = useSubmit();
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const cost = parseAmount(form.acquisitionCost);
    if (!(cost > 0) || !form.categoryId || !form.name.trim()) return;
    void run(async () => {
      const bank = (banks.data ?? []).find((b) => b.id === form.financialAccountId);
      const saved = await api<FixedAsset>("/api/v1/fixed-assets/assets", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          categoryId: form.categoryId,
          acquisitionCost: cost,
          residualValue: form.residualValue ? parseAmount(form.residualValue) : undefined,
          purchaseDate: form.purchaseDate,
          serialNumber: form.serialNumber.trim() || undefined,
          branch: form.branch.trim() || undefined,
          location: form.location.trim() || undefined,
          assignedEmployee: form.assignedEmployee.trim() || undefined,
          description: form.description.trim() || undefined,
          capitalize: form.capitalize,
          creditAccountId: bank?.glAccountId,
          capitalizationDate: form.purchaseDate,
        }),
      });
      onSaved(saved);
      return form.capitalize ? "Asset registered and capitalized" : "Asset registered";
    });
  }

  return (
    <Drawer title="Register asset" onClose={onClose} wide footer={<Footer onCancel={onClose} busy={busy} label={form.capitalize ? "Register & capitalize" : "Register"} formId="fa-reg" />}>
      <FormError message={error} />
      <form id="fa-reg" onSubmit={submit} className="form-grid">
        <Field label="Asset name" className="span-2">
          <input className="input" required value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="e.g. Dell Latitude 5540" />
        </Field>
        <Field label="Category">
          <Select
            value={form.categoryId}
            onChange={set("categoryId")}
            options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name, hint: DEP_METHOD_LABELS[c.depreciationMethod] }))}
            placeholder="Choose category"
            required
          />
        </Field>
        <Field label="Purchase date">
          <input className="input" type="date" required value={form.purchaseDate} onChange={(e) => set("purchaseDate")(e.target.value)} />
        </Field>
        <Field label="Acquisition cost">
          <MoneyInput value={form.acquisitionCost} onChange={set("acquisitionCost")} required />
        </Field>
        <Field label="Residual value">
          <MoneyInput value={form.residualValue} onChange={set("residualValue")} placeholder="Category default" />
        </Field>
        <Field label="Serial number">
          <input className="input" value={form.serialNumber} onChange={(e) => set("serialNumber")(e.target.value)} />
        </Field>
        <Field label="Pay from">
          <Select
            value={form.financialAccountId}
            onChange={set("financialAccountId")}
            options={[{ value: "", label: "Default bank / cash" }, ...financialAccountOptions(banks.data ?? [])]}
            searchable
          />
        </Field>
        <Field label="Branch">
          <input className="input" value={form.branch} onChange={(e) => set("branch")(e.target.value)} />
        </Field>
        <Field label="Location">
          <input className="input" value={form.location} onChange={(e) => set("location")(e.target.value)} />
        </Field>
        <Field label="Assigned to" className="span-2">
          <input className="input" value={form.assignedEmployee} onChange={(e) => set("assignedEmployee")(e.target.value)} />
        </Field>
        <Field label="Description" className="span-2">
          <textarea className="input" rows={2} value={form.description} onChange={(e) => set("description")(e.target.value)} />
        </Field>
        <label className="span-2" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={form.capitalize} onChange={(e) => set("capitalize")(e.target.checked)} />
          Capitalize now (post to the ledger)
        </label>
      </form>
    </Drawer>
  );
}

export function CapitalizeForm({ asset, onClose, onSaved }: { asset: FixedAsset; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const banks = useFinancialAccounts();
  const [form, setForm] = useState({ date: asset.purchaseDate ?? isoDay(), financialAccountId: "" });
  const { busy, error, run } = useSubmit();

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const bank = (banks.data ?? []).find((b) => b.id === form.financialAccountId);
      await api(`/api/v1/fixed-assets/assets/${asset.id}/capitalize`, {
        method: "POST",
        body: JSON.stringify({ capitalizationDate: form.date, creditAccountId: bank?.glAccountId }),
      });
      onSaved();
      return "Asset capitalized";
    });
  }

  return (
    <Drawer title={`Capitalize ${asset.number}`} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Capitalize" formId="fa-cap" />}>
      <FormError message={error} />
      <form id="fa-cap" onSubmit={submit} className="form-grid">
        <Field label="Capitalization date">
          <input className="input" type="date" required value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
        </Field>
        <Field label="Credit account">
          <Select
            value={form.financialAccountId}
            onChange={(v) => setForm((f) => ({ ...f, financialAccountId: v }))}
            options={[{ value: "", label: "Default bank / AP" }, ...financialAccountOptions(banks.data ?? [])]}
            searchable
          />
        </Field>
        <p className="muted span-2">Status: {ASSET_STATUS[asset.status].label} · Cost {asset.acquisitionCost.toLocaleString()}</p>
      </form>
    </Drawer>
  );
}

export function TransferForm({ asset, onClose, onSaved }: { asset: FixedAsset; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const [form, setForm] = useState({
    transferDate: isoDay(),
    toBranch: asset.branch ?? "",
    toLocation: asset.location ?? "",
    toEmployee: asset.assignedEmployee ?? "",
    notes: "",
  });
  const { busy, error, run } = useSubmit();

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api(`/api/v1/fixed-assets/assets/${asset.id}/transfer`, {
        method: "POST",
        body: JSON.stringify({
          transferDate: form.transferDate,
          toBranch: form.toBranch.trim() || undefined,
          toLocation: form.toLocation.trim() || undefined,
          toEmployee: form.toEmployee.trim() || undefined,
          notes: form.notes.trim() || undefined,
        }),
      });
      onSaved();
      return "Asset transferred";
    });
  }

  return (
    <Drawer title={`Transfer ${asset.number}`} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Transfer" formId="fa-tr" />}>
      <FormError message={error} />
      <form id="fa-tr" onSubmit={submit} className="form-grid">
        <Field label="Date">
          <input className="input" type="date" required value={form.transferDate} onChange={(e) => setForm((f) => ({ ...f, transferDate: e.target.value }))} />
        </Field>
        <Field label="Branch">
          <input className="input" value={form.toBranch} onChange={(e) => setForm((f) => ({ ...f, toBranch: e.target.value }))} />
        </Field>
        <Field label="Location">
          <input className="input" value={form.toLocation} onChange={(e) => setForm((f) => ({ ...f, toLocation: e.target.value }))} />
        </Field>
        <Field label="Assigned to">
          <input className="input" value={form.toEmployee} onChange={(e) => setForm((f) => ({ ...f, toEmployee: e.target.value }))} />
        </Field>
        <Field label="Notes" className="span-2">
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </Field>
      </form>
    </Drawer>
  );
}

export function MaintenanceForm({ asset, onClose, onSaved }: { asset: FixedAsset; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const banks = useFinancialAccounts();
  const [form, setForm] = useState({
    maintenanceDate: isoDay(),
    maintenanceType: "Service",
    serviceProvider: "",
    cost: "",
    nextMaintenanceDate: "",
    postExpense: true,
    financialAccountId: "",
    description: "",
  });
  const { busy, error, run } = useSubmit();

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const bank = (banks.data ?? []).find((b) => b.id === form.financialAccountId);
      await api(`/api/v1/fixed-assets/assets/${asset.id}/maintenance`, {
        method: "POST",
        body: JSON.stringify({
          maintenanceDate: form.maintenanceDate,
          maintenanceType: form.maintenanceType,
          serviceProvider: form.serviceProvider.trim() || undefined,
          cost: form.cost ? parseAmount(form.cost) : 0,
          nextMaintenanceDate: form.nextMaintenanceDate || undefined,
          postExpense: form.postExpense,
          creditAccountId: bank?.glAccountId,
          description: form.description.trim() || undefined,
        }),
      });
      onSaved();
      return "Maintenance recorded";
    });
  }

  return (
    <Drawer title={`Maintenance · ${asset.number}`} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Save" formId="fa-mnt" />}>
      <FormError message={error} />
      <form id="fa-mnt" onSubmit={submit} className="form-grid">
        <Field label="Date">
          <input className="input" type="date" required value={form.maintenanceDate} onChange={(e) => setForm((f) => ({ ...f, maintenanceDate: e.target.value }))} />
        </Field>
        <Field label="Type">
          <input className="input" required value={form.maintenanceType} onChange={(e) => setForm((f) => ({ ...f, maintenanceType: e.target.value }))} />
        </Field>
        <Field label="Service provider">
          <input className="input" value={form.serviceProvider} onChange={(e) => setForm((f) => ({ ...f, serviceProvider: e.target.value }))} />
        </Field>
        <Field label="Cost">
          <MoneyInput value={form.cost} onChange={(v) => setForm((f) => ({ ...f, cost: v }))} />
        </Field>
        <Field label="Next due">
          <input className="input" type="date" value={form.nextMaintenanceDate} onChange={(e) => setForm((f) => ({ ...f, nextMaintenanceDate: e.target.value }))} />
        </Field>
        <Field label="Pay from">
          <Select
            value={form.financialAccountId}
            onChange={(v) => setForm((f) => ({ ...f, financialAccountId: v }))}
            options={[{ value: "", label: "Default bank / cash" }, ...financialAccountOptions(banks.data ?? [])]}
            searchable
          />
        </Field>
        <label className="span-2" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={form.postExpense} onChange={(e) => setForm((f) => ({ ...f, postExpense: e.target.checked }))} />
          Post maintenance cost to the ledger
        </label>
      </form>
    </Drawer>
  );
}

export function DisposeForm({ asset, onClose, onSaved }: { asset: FixedAsset; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const banks = useFinancialAccounts();
  const [form, setForm] = useState({
    disposalDate: isoDay(),
    disposalMethod: "SALE" as DisposalMethod,
    proceeds: "",
    financialAccountId: "",
    notes: "",
  });
  const { busy, error, run } = useSubmit();

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const bank = (banks.data ?? []).find((b) => b.id === form.financialAccountId);
      await api(`/api/v1/fixed-assets/assets/${asset.id}/dispose`, {
        method: "POST",
        body: JSON.stringify({
          disposalDate: form.disposalDate,
          disposalMethod: form.disposalMethod,
          proceeds: form.proceeds ? parseAmount(form.proceeds) : 0,
          proceedsAccountId: bank?.glAccountId,
          notes: form.notes.trim() || undefined,
        }),
      });
      onSaved();
      return "Asset disposed";
    });
  }

  return (
    <Drawer title={`Dispose ${asset.number}`} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Dispose" formId="fa-dis" />}>
      <FormError message={error} />
      <form id="fa-dis" onSubmit={submit} className="form-grid">
        <Field label="Date">
          <input className="input" type="date" required value={form.disposalDate} onChange={(e) => setForm((f) => ({ ...f, disposalDate: e.target.value }))} />
        </Field>
        <Field label="Method">
          <Select
            value={form.disposalMethod}
            onChange={(v) => setForm((f) => ({ ...f, disposalMethod: v as DisposalMethod }))}
            options={Object.entries(DISPOSAL_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Field>
        <Field label="Proceeds">
          <MoneyInput value={form.proceeds} onChange={(v) => setForm((f) => ({ ...f, proceeds: v }))} placeholder="0" />
        </Field>
        <Field label="Proceeds to">
          <Select
            value={form.financialAccountId}
            onChange={(v) => setForm((f) => ({ ...f, financialAccountId: v }))}
            options={[{ value: "", label: "Default bank" }, ...financialAccountOptions(banks.data ?? [])]}
            searchable
          />
        </Field>
        <p className="muted span-2">Net book value {asset.netBookValue.toLocaleString()} — gain or loss posts automatically.</p>
      </form>
    </Drawer>
  );
}

export function DepreciationRunForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const [period, setPeriod] = useState(currentPeriod());
  const preview = useResource<DepPreview>(`/api/v1/fixed-assets/depreciation/preview?period=${period}`);
  const { busy, error, run } = useSubmit();

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api("/api/v1/fixed-assets/depreciation/run", { method: "POST", body: JSON.stringify({ period }) });
      onSaved();
      return `Depreciation posted for ${period}`;
    });
  }

  return (
    <Drawer title="Run depreciation" onClose={onClose} wide footer={<Footer onCancel={onClose} busy={busy} label="Post depreciation" formId="fa-dep" />}>
      <FormError message={error} />
      <form id="fa-dep" onSubmit={submit} className="form-grid">
        <Field label="Period (yyyy-mm)">
          <input className="input" required pattern="\d{4}-\d{2}" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </Field>
        <div className="span-2 panel">
          {!preview.data ? (
            <p className="muted">Loading preview…</p>
          ) : preview.data.assetCount === 0 ? (
            <p className="all-clear">No assets need depreciation for this period.</p>
          ) : (
            <>
              <p>
                {preview.data.assetCount} asset{preview.data.assetCount === 1 ? "" : "s"} · total {preview.data.totalAmount.toLocaleString()}
              </p>
              <table className="table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th className="num">Charge</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.data.items.map((i) => (
                    <tr key={i.assetId}>
                      <td>
                        {i.number}
                        <span className="sub">{i.name}</span>
                      </td>
                      <td className="num">{i.amount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </form>
    </Drawer>
  );
}
