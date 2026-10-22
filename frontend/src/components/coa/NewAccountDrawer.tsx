import { ChevronDown, Info, Lock, LockOpen, Play } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import {
  backendTypeFor,
  COA_TAXONOMY,
  detailTypesFor,
  encodeReportingGroup,
  flagsForDetailType,
} from "../../lib/coa-taxonomy";
import type { Account, AccountType, CoaDashboard } from "../../lib/types";
import { useCompany } from "../../lib/company";
import { useSession } from "../../lib/session";
import {
  newAccountSchema,
  type NewAccountValues,
  useYupForm,
} from "../../lib/validation";
import { useFeedback } from "../feedback";
import { Select } from "../Select";
import { Drawer, Field } from "../ui";

type Props = {
  categories: CoaDashboard["categories"];
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
};

const EMPTY: NewAccountValues = {
  name: "",
  code: "",
  accountTypeLabel: "",
  detailType: "",
  isSubaccount: false,
  parentId: "",
  description: "",
  locked: false,
};

function suggestCode(accounts: Account[], type: AccountType, ranges: Array<{ type: AccountType; min: number; max: number }>) {
  const range = ranges.find((r) => r.type === type);
  if (!range) return "";
  const used = new Set(accounts.filter((a) => a.type === type).map((a) => Number(a.code)).filter(Number.isFinite));
  for (let n = range.min; n <= range.max; n++) {
    if (!used.has(n)) return String(n);
  }
  return String(range.min);
}

export function NewAccountDrawer({ categories, accounts, onClose, onSaved }: Props) {
  const { api } = useSession();
  const { toast } = useFeedback();
  const { currency, reload: reloadCompany } = useCompany();
  const [values, setValues] = useState<NewAccountValues>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const ranges = useMemo(
    () =>
      categories.map((c) => {
        const [min, max] = c.range.split("-").map(Number);
        return { type: c.type, min, max };
      }),
    [categories],
  );

  const backendType = values.accountTypeLabel ? backendTypeFor(values.accountTypeLabel) : undefined;
  const range = backendType ? ranges.find((r) => r.type === backendType) : undefined;
  const existingCodes = useMemo(() => new Set(accounts.map((a) => a.code)), [accounts]);

  const schema = useMemo(
    () => newAccountSchema({ existingCodes, range: range ? { min: range.min, max: range.max } : undefined }),
    [existingCodes, range?.min, range?.max],
  );

  const { showError, setField, blurField, validate, resetValidation, setErrors } = useYupForm(schema, values, setValues);

  const accountTypeOptions = useMemo(
    () =>
      COA_TAXONOMY.flatMap((block) =>
        block.accountTypes.map((opt) => ({
          value: opt.label,
          label: opt.label,
          group: block.label,
        })),
      ),
    [],
  );

  const detailOptions = useMemo(
    () =>
      (values.accountTypeLabel ? detailTypesFor(values.accountTypeLabel) : []).map((d) => ({
        value: d,
        label: d,
      })),
    [values.accountTypeLabel],
  );

  const parentOptions = useMemo(
    () =>
      accounts
        .filter((a) => a.isActive && (!backendType || a.type === backendType))
        .map((a) => ({ value: a.id, label: a.name, prefix: a.code })),
    [accounts, backendType],
  );

  function pickAccountType(label: string) {
    const details = detailTypesFor(label);
    const bt = backendTypeFor(label);
    setValues((prev) => ({
      ...prev,
      accountTypeLabel: label,
      detailType: details[0] ?? "",
      parentId: "",
      code: prev.code || (bt ? suggestCode(accounts, bt, ranges) : ""),
    }));
    setErrors((e) => ({ ...e, accountTypeLabel: undefined, detailType: undefined }));
  }

  async function submit(e: FormEvent, andNew = false) {
    e.preventDefault();
    setFormError("");
    const ok = await validate();
    if (!ok || !backendType) return;

    setBusy(true);
    try {
      const flags = flagsForDetailType(values.detailType);
      await api("/api/v1/coa", {
        method: "POST",
        body: JSON.stringify({
          code: values.code.trim(),
          name: values.name.trim(),
          type: backendType,
          parentId: values.isSubaccount ? values.parentId || undefined : undefined,
          description: values.description.trim() || undefined,
          reportingGroup: encodeReportingGroup(values.accountTypeLabel, values.detailType),
          currency: currency || "RWF",
          allowManualPost: !values.locked,
          ...flags,
        }),
      });
      toast(`Account ${values.code} ${values.name.trim()} created`);
      reloadCompany();
      if (andNew) {
        setValues({
          ...EMPTY,
          accountTypeLabel: values.accountTypeLabel,
          detailType: values.detailType,
          code: suggestCode([...accounts, { code: values.code, type: backendType } as Account], backendType, ranges),
        });
        resetValidation();
      } else {
        onSaved();
      }
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      title="New account"
      wide
      onClose={onClose}
      footer={
        <div className="ee-coa-drawer-foot">
          <a className="ee-coa-video" href="https://erp.exceledgecpa.com" target="_blank" rel="noreferrer">
            <Play size={14} strokeWidth={1.75} aria-hidden="true" />
            Video tutorials
          </a>
          <div className="ee-coa-drawer-actions">
            <button type="button" className="btn ee-btn-outline-blue" onClick={onClose}>
              Cancel
            </button>
            <div className="ee-coa-save-split">
              <button type="submit" form="new-account-form" className="btn btn-primary" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="btn btn-primary ee-coa-save-more"
                aria-label="More save options"
                disabled={busy}
                onClick={(ev) => void submit(ev as unknown as FormEvent, true)}
                title="Save and new"
              >
                <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      }
    >
      <form id="new-account-form" className="ee-coa-form" onSubmit={(e) => void submit(e)} noValidate>
        {formError && (
          <div className="notice error ee-coa-form-error" role="alert">
            {formError}
          </div>
        )}

        <div className="ee-coa-form-grid">
          <Field label="Account name" required error={showError("name")}>
            <input
              className="input"
              value={values.name}
              onChange={(e) => setField("name", e.target.value)}
              onBlur={() => blurField("name")}
              autoFocus
            />
          </Field>

          <Field
            label="Account number"
            required
            hint={!showError("code") && range ? `Suggested range ${range.min}–${range.max}` : undefined}
            error={showError("code")}
          >
            <input
              className="input mono"
              value={values.code}
              onChange={(e) => setField("code", e.target.value.replace(/\D/g, "").slice(0, 6))}
              onBlur={() => blurField("code")}
              inputMode="numeric"
              placeholder="e.g. 1100"
            />
          </Field>

          <Field
            label={
              <span className="ee-coa-label-with-info">
                Account type
                <button
                  type="button"
                  className="ee-coa-info"
                  title="Choose the reporting category for this account"
                  aria-label="About account type"
                  onClick={() => toast("Account type controls how this account appears on financial reports.")}
                >
                  <Info size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              </span>
            }
            required
            error={showError("accountTypeLabel")}
          >
            <Select
              value={values.accountTypeLabel}
              onChange={pickAccountType}
              options={accountTypeOptions}
              placeholder="Select account type"
              searchable
              invalid={Boolean(showError("accountTypeLabel"))}
              aria-label="Account type"
            />
          </Field>

          <Field label="Detail type" required error={showError("detailType")}>
            <Select
              value={values.detailType}
              onChange={(v) => setField("detailType", v)}
              options={detailOptions}
              placeholder={values.accountTypeLabel ? "Select detail type" : "Select account type first"}
              disabled={!values.accountTypeLabel}
              searchable={detailOptions.length > 8}
              invalid={Boolean(showError("detailType"))}
              emptyText="Select an account type first"
              aria-label="Detail type"
            />
          </Field>
        </div>

        <label className="ee-coa-check">
          <input
            type="checkbox"
            checked={values.isSubaccount}
            onChange={(e) => {
              setField("isSubaccount", e.target.checked);
              if (!e.target.checked) setField("parentId", "");
            }}
          />
          Make this a subaccount
        </label>

        {values.isSubaccount && (
          <Field label="Parent account" required error={showError("parentId")}>
            <Select
              value={values.parentId}
              onChange={(v) => setField("parentId", v)}
              options={parentOptions}
              placeholder="Select parent account"
              searchable
              invalid={Boolean(showError("parentId"))}
              emptyText="No matching parent accounts"
              aria-label="Parent account"
            />
          </Field>
        )}

        <Field label="Description" error={showError("description")}>
          <textarea
            className="input ee-coa-desc"
            rows={4}
            value={values.description}
            onChange={(e) => setField("description", e.target.value)}
            onBlur={() => blurField("description")}
          />
        </Field>

        <div className="ee-coa-lock">
          <span className="field-label">Lock account</span>
          <div className="ee-coa-lock-toggle" role="group" aria-label="Lock account">
            <button
              type="button"
              className={`ee-coa-lock-btn ${!values.locked ? "on" : ""}`}
              aria-pressed={!values.locked}
              title="Unlocked — allow manual posting"
              onClick={() => setField("locked", false)}
            >
              <LockOpen size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`ee-coa-lock-btn ${values.locked ? "on locked" : ""}`}
              aria-pressed={values.locked}
              title="Locked — block manual posting"
              onClick={() => setField("locked", true)}
            >
              <Lock size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </div>
      </form>
    </Drawer>
  );
}
