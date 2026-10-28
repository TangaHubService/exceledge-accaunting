import { type FormEvent, useState } from "react";
import { financialAccountOptions, useFinancialAccounts } from "../lib/banking";
import { ASSET_STATUS, DEP_FREQUENCY_LABELS, DEP_METHOD_LABELS, DISPOSAL_LABELS, currentPeriod } from "../lib/fa";
import { isoDay } from "../lib/format";
import { useResource, useSession } from "../lib/session";
import type { DepPreview, DepreciationFrequency, DepreciationMethod, DisposalMethod, FaCategory, FixedAsset } from "../lib/types";
import { Footer, FormError, MoneyInput, parseAmount, useSubmit } from "./forms";
import { Select } from "./Select";
import { Drawer, Field, Skeleton } from "./ui";

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
    depreciationMethod: "" as DepreciationMethod | "",
    depreciationFrequency: "MONTHLY" as DepreciationFrequency,
    usefulLifeMonths: "",
    ratePercent: "",
    totalUnits: "",
  });
  const { busy, error, run } = useSubmit();
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const category = (categories.data ?? []).find((c) => c.id === form.categoryId);
  const method = form.depreciationMethod || category?.depreciationMethod || "STRAIGHT_LINE";

  function submit(e: FormEvent) {
    e.preventDefault();
    const cost = parseAmount(form.acquisitionCost);
    if (!(cost > 0) || !form.categoryId || !form.name.trim()) return;
    const life = form.usefulLifeMonths ? Number(form.usefulLifeMonths) : undefined;
    const rate = form.ratePercent ? Number(form.ratePercent) : undefined;
    const units = form.totalUnits ? parseAmount(form.totalUnits) : undefined;
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
          depreciationMethod: form.depreciationMethod || undefined,
          depreciationFrequency: form.depreciationFrequency,
          usefulLifeMonths: life,
          ratePercent: method === "REDUCING_BALANCE" ? rate : undefined,
          totalUnits: method === "UNITS_OF_PRODUCTION" ? units : undefined,
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
        <Field label="Depreciation method">
          <Select
            value={form.depreciationMethod}
            onChange={(v) => set("depreciationMethod")(v as DepreciationMethod | "")}
            options={[
              { value: "", label: category ? `Category default (${DEP_METHOD_LABELS[category.depreciationMethod]})` : "Category default" },
              ...Object.entries(DEP_METHOD_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
        </Field>
        <Field label="Post depreciation">
          <Select
            value={form.depreciationFrequency}
            onChange={(v) => set("depreciationFrequency")(v as DepreciationFrequency)}
            options={Object.entries(DEP_FREQUENCY_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Field>
        {method === "UNITS_OF_PRODUCTION" ? (
          <Field label="Total units expected" hint="Hours, km or units the asset will produce over its life">
            <input className="input" inputMode="decimal" required value={form.totalUnits} onChange={(e) => set("totalUnits")(e.target.value)} />
          </Field>
        ) : (
          <Field label="Useful life (months)">
            <input
              className="input"
              type="number"
              min={0}
              max={1200}
              value={form.usefulLifeMonths}
              onChange={(e) => set("usefulLifeMonths")(e.target.value)}
              placeholder={category ? String(category.usefulLifeMonths) : "Category default"}
            />
          </Field>
        )}
        {method === "REDUCING_BALANCE" && (
          <Field label="Rate (% a year)">
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={form.ratePercent}
              onChange={(e) => set("ratePercent")(e.target.value)}
              placeholder={category?.ratePercent != null ? String(category.ratePercent) : ""}
            />
          </Field>
        )}
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

export function RevalueForm({ asset, onClose, onSaved }: { asset: FixedAsset; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const [form, setForm] = useState({ effectiveDate: isoDay(), fairValue: "", valuationReference: "" });
  const { busy, error, run } = useSubmit();
  const fairValue = parseAmount(form.fairValue);
  const change = Number.isFinite(fairValue) ? fairValue - asset.netBookValue : 0;
  const toPl = change > 0 ? Math.min(change, asset.revaluationLossInPl) : change < 0 ? Math.max(0, -change - asset.revaluationSurplus) : 0;
  const toReserve = Math.abs(change) - toPl;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!(fairValue >= 0) || change === 0) return;
    void run(async () => {
      await api(`/api/v1/fixed-assets/assets/${asset.id}/revalue`, {
        method: "POST",
        body: JSON.stringify({ effectiveDate: form.effectiveDate, fairValue, valuationReference: form.valuationReference.trim() || undefined }),
      });
      onSaved();
      return "Revaluation posted";
    });
  }

  return (
    <Drawer title={`Revalue ${asset.number}`} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Post revaluation" formId="fa-rev" />}>
      <FormError message={error} />
      <form id="fa-rev" onSubmit={submit} className="form-grid">
        <Field label="Effective date">
          <input className="input" type="date" required value={form.effectiveDate} onChange={(e) => setForm((f) => ({ ...f, effectiveDate: e.target.value }))} />
        </Field>
        <Field label="Fair value">
          <MoneyInput value={form.fairValue} onChange={(v) => setForm((f) => ({ ...f, fairValue: v }))} required />
        </Field>
        <Field label="Valuation reference" className="span-2">
          <input className="input" value={form.valuationReference} onChange={(e) => setForm((f) => ({ ...f, valuationReference: e.target.value }))} placeholder="e.g. Valuer report VR-12" />
        </Field>
        <p className="muted span-2">
          Carrying amount {asset.netBookValue.toLocaleString()} · revaluation surplus {asset.revaluationSurplus.toLocaleString()}
          {asset.revaluationLossInPl > 0 ? ` · earlier losses in profit or loss ${asset.revaluationLossInPl.toLocaleString()}` : ""}
        </p>
        {change !== 0 && (
          <p className="span-2">
            {change > 0 ? "Increase" : "Decrease"} of {Math.abs(change).toLocaleString()}: {toReserve.toLocaleString()} {change > 0 ? "to" : "from"} the revaluation surplus
            {toPl > 0 ? `, ${toPl.toLocaleString()} ${change > 0 ? "reverses earlier losses in" : "charged to"} profit or loss` : ""}. Depreciation then spreads the new value over the remaining life.
          </p>
        )}
      </form>
    </Drawer>
  );
}

export function ImpairForm({ asset, onClose, onSaved }: { asset: FixedAsset; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const [form, setForm] = useState({ impairmentDate: isoDay(), recoverableAmount: "", reason: "" });
  const { busy, error, run } = useSubmit();

  function submit(e: FormEvent) {
    e.preventDefault();
    const recoverableAmount = parseAmount(form.recoverableAmount);
    if (!(recoverableAmount >= 0)) return;
    void run(async () => {
      const result = await api<FixedAsset & { approval?: { id: string } }>(`/api/v1/fixed-assets/assets/${asset.id}/impair`, {
        method: "POST",
        body: JSON.stringify({ impairmentDate: form.impairmentDate, recoverableAmount, reason: form.reason.trim() || undefined }),
      });
      onSaved();
      return result.approval ? "Impairment sent for approval; it posts once approved" : "Impairment posted";
    });
  }

  return (
    <Drawer title={`Impair ${asset.number}`} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Record impairment" formId="fa-imp" />}>
      <FormError message={error} />
      <form id="fa-imp" onSubmit={submit} className="form-grid">
        <Field label="Date">
          <input className="input" type="date" required value={form.impairmentDate} onChange={(e) => setForm((f) => ({ ...f, impairmentDate: e.target.value }))} />
        </Field>
        <Field label="Recoverable amount">
          <MoneyInput value={form.recoverableAmount} onChange={(v) => setForm((f) => ({ ...f, recoverableAmount: v }))} required />
        </Field>
        <Field label="Reason" className="span-2">
          <textarea className="input" rows={2} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
        </Field>
        <p className="muted span-2">Carrying amount {asset.netBookValue.toLocaleString()} — the difference is charged as an impairment loss.</p>
      </form>
    </Drawer>
  );
}

export function UsageForm({ asset, onClose, onSaved }: { asset: FixedAsset; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const [form, setForm] = useState({ period: currentPeriod(), units: "", notes: "" });
  const { busy, error, run } = useSubmit();
  const existing = asset.usages.find((u) => u.period === form.period);

  function submit(e: FormEvent) {
    e.preventDefault();
    const units = parseAmount(form.units);
    if (!(units >= 0)) return;
    void run(async () => {
      await api(`/api/v1/fixed-assets/assets/${asset.id}/usage`, {
        method: "PUT",
        body: JSON.stringify({ period: form.period, units, notes: form.notes.trim() || undefined }),
      });
      onSaved();
      return `Usage saved for ${form.period}`;
    });
  }

  return (
    <Drawer title={`Units used · ${asset.number}`} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Save" formId="fa-use" />}>
      <FormError message={error} />
      <form id="fa-use" onSubmit={submit} className="form-grid">
        <Field label="Period (yyyy-mm)">
          <input className="input" required pattern="\d{4}-\d{2}" value={form.period} onChange={(e) => setForm((f) => ({ ...f, period: e.target.value }))} />
        </Field>
        <Field label="Units used" hint={existing ? `Currently ${existing.units.toLocaleString()}` : undefined}>
          <input className="input" inputMode="decimal" required value={form.units} onChange={(e) => setForm((f) => ({ ...f, units: e.target.value }))} />
        </Field>
        <Field label="Notes" className="span-2">
          <input className="input" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="e.g. meter reading" />
        </Field>
        <p className="muted span-2">
          {(asset.unitsDepreciated ?? 0).toLocaleString()} of {(asset.totalUnits ?? 0).toLocaleString()} units depreciated. Usage can change until its month is depreciated.
        </p>
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
            <div style={{ display: "grid", gap: 8 }}>
              <Skeleton width="40%" />
              <Skeleton width="65%" />
              <Skeleton width="30%" />
            </div>
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
                        <span className="sub">
                          {i.name}
                          {i.units ? ` · ${i.units.toLocaleString()} units` : i.months > 1 ? ` · ${i.months} months` : ""}
                        </span>
                      </td>
                      <td className="num">{i.amount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {preview.data && preview.data.skipped.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <p className="muted small">Not depreciated this period:</p>
              {preview.data.skipped.map((s) => (
                <p key={s.assetId} className="small">
                  {s.number} {s.name} <span className="muted">· {s.reason}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      </form>
    </Drawer>
  );
}
