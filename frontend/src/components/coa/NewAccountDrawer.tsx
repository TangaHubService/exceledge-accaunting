import { ChevronDown, Lock, LockOpen, Play } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_ACCOUNT_TYPE_LABELS,
  backendTypeFor,
  COA_TAXONOMY,
  detailTypesFor,
  encodeReportingGroup,
  flagsForDetailType,
} from "../../lib/coa-taxonomy";
import type { Account, AccountType, CoaDashboard } from "../../lib/types";
import { useCompany } from "../../lib/company";
import { useSession } from "../../lib/session";
import { useFeedback } from "../feedback";
import { Drawer, Field } from "../ui";

type Props = {
  categories: CoaDashboard["categories"];
  accounts: Account[];
  onClose: () => void;
  onSaved: () => void;
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
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [accountTypeLabel, setAccountTypeLabel] = useState("");
  const [detailType, setDetailType] = useState("");
  const [isSubaccount, setIsSubaccount] = useState(false);
  const [parentId, setParentId] = useState("");
  const [description, setDescription] = useState("");
  const [locked, setLocked] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const typeBtnRef = useRef<HTMLButtonElement>(null);
  const typeMenuRef = useRef<HTMLDivElement>(null);

  const ranges = useMemo(
    () =>
      categories.map((c) => {
        const [min, max] = c.range.split("-").map(Number);
        return { type: c.type, min, max };
      }),
    [categories],
  );

  const backendType = accountTypeLabel ? backendTypeFor(accountTypeLabel) : undefined;
  const detailOptions = accountTypeLabel ? detailTypesFor(accountTypeLabel) : [];
  const parents = accounts.filter((a) => a.isActive && (!backendType || a.type === backendType));
  const duplicate = code !== "" && accounts.some((a) => a.code === code);
  const codeNumber = Number(code);
  const range = backendType ? ranges.find((r) => r.type === backendType) : undefined;
  const outOfRange =
    code !== "" && range != null && (!Number.isFinite(codeNumber) || codeNumber < range.min || codeNumber > range.max);

  useEffect(() => {
    if (!typeMenuOpen) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (typeMenuRef.current?.contains(t) || typeBtnRef.current?.contains(t)) return;
      setTypeMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [typeMenuOpen]);

  function pickAccountType(label: string) {
    setAccountTypeLabel(label);
    const details = detailTypesFor(label);
    setDetailType(details[0] ?? "");
    setTypeMenuOpen(false);
    setParentId("");
    const bt = backendTypeFor(label);
    if (bt && !code) setCode(suggestCode(accounts, bt, ranges));
  }

  async function submit(e: FormEvent, andNew = false) {
    e.preventDefault();
    if (!name.trim() || !accountTypeLabel || !detailType || !backendType) {
      setError("Account name, account type and detail type are required.");
      return;
    }
    if (!code.trim()) {
      setError("Account number is required for posting.");
      return;
    }
    if (outOfRange || duplicate) return;
    if (isSubaccount && !parentId) {
      setError("Select a parent account for the subaccount.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const flags = flagsForDetailType(detailType);
      await api("/api/v1/coa", {
        method: "POST",
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          type: backendType,
          parentId: isSubaccount ? parentId || undefined : undefined,
          description: description.trim() || undefined,
          reportingGroup: encodeReportingGroup(accountTypeLabel, detailType),
          currency: currency || "RWF",
          allowManualPost: !locked,
          ...flags,
        }),
      });
      toast(`Account ${code} ${name.trim()} created`);
      reloadCompany();
      if (andNew) {
        setName("");
        setDescription("");
        setCode(suggestCode([...accounts, { code, type: backendType } as Account], backendType, ranges));
        setIsSubaccount(false);
        setParentId("");
      } else {
        onSaved();
      }
    } catch (err) {
      setError((err as Error).message);
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
      <form id="new-account-form" className="ee-coa-form" onSubmit={(e) => void submit(e)}>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}

        <Field label="Account name" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </Field>

        <Field label="Account number" hint={range ? `Suggested range ${range.min}–${range.max}` : undefined} error={duplicate ? "Code already exists" : outOfRange ? `Use codes ${range!.min}–${range!.max}` : null}>
          <input
            className={`input mono ${outOfRange || duplicate ? "invalid" : ""}`}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            placeholder="e.g. 1100"
          />
        </Field>

        <Field label="Account type" required>
          <div className="ee-coa-type-wrap">
            <button
              ref={typeBtnRef}
              type="button"
              className={`ee-coa-type-btn ${!accountTypeLabel ? "placeholder" : ""}`}
              aria-haspopup="listbox"
              aria-expanded={typeMenuOpen}
              onClick={() => setTypeMenuOpen((v) => !v)}
            >
              <span>{accountTypeLabel || "Select account type"}</span>
              <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
            {typeMenuOpen && (
              <div ref={typeMenuRef} className="ee-coa-type-menu" role="listbox" aria-label="Account types">
                {COA_TAXONOMY.map((block) => (
                  <div key={block.group} className="ee-coa-type-group">
                    <div className="ee-coa-type-group-label">{block.label}</div>
                    {block.accountTypes.map((opt) => (
                      <button
                        key={opt.label}
                        type="button"
                        role="option"
                        aria-selected={accountTypeLabel === opt.label}
                        className={`ee-coa-type-option ${accountTypeLabel === opt.label ? "on" : ""}`}
                        onClick={() => pickAccountType(opt.label)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Field>

        <Field label="Detail type" required>
          <select
            className="input"
            value={detailType}
            disabled={!accountTypeLabel}
            onChange={(e) => setDetailType(e.target.value)}
            required
          >
            <option value="">{accountTypeLabel ? "Select detail type" : "Select account type first"}</option>
            {detailOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>

        <label className="ee-coa-check">
          <input type="checkbox" checked={isSubaccount} onChange={(e) => setIsSubaccount(e.target.checked)} />
          Make this a subaccount
        </label>

        {isSubaccount && (
          <Field label="Parent account" required>
            <select className="input" value={parentId} onChange={(e) => setParentId(e.target.value)} required>
              <option value="">Select parent account</option>
              {parents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Description">
          <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <div className="ee-coa-lock">
          <span className="field-label">Lock account</span>
          <div className="ee-coa-lock-toggle" role="group" aria-label="Lock account">
            <button
              type="button"
              className={`ee-coa-lock-btn ${!locked ? "on" : ""}`}
              aria-pressed={!locked}
              title="Unlocked — allow manual posting"
              onClick={() => setLocked(false)}
            >
              <LockOpen size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`ee-coa-lock-btn ${locked ? "on locked" : ""}`}
              aria-pressed={locked}
              title="Locked — block manual posting"
              onClick={() => setLocked(true)}
            >
              <Lock size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Keep taxonomy list discoverable for filters */}
        <datalist id="coa-account-types">
          {ALL_ACCOUNT_TYPE_LABELS.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      </form>
    </Drawer>
  );
}
