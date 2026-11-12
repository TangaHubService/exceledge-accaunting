import { ChevronDown, Info, Lock, LockOpen, Play } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import {
  backendTypeFor,
  COA_TAXONOMY,
  decodeReportingGroup,
  detailTypesFor,
  encodeReportingGroup,
  findAccountTypeOption,
  flagsForDetailType,
} from "../../lib/coa-taxonomy";
import type { Account, AccountType, CoaDashboard } from "../../lib/types";
import { useCompany } from "../../lib/company";
import { isoDay } from "../../lib/format";
import { useCoaSettings } from "../../lib/coa-settings";
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
  /** When set, the drawer edits this account instead of creating one. */
  account?: Account;
  onClose: () => void;
  onSaved: () => void;
};

const BALANCE_SHEET: AccountType[] = ["ASSET", "LIABILITY", "EQUITY"];
/** Receivable/payable balances belong to customers and suppliers, so QuickBooks offers no opening balance there. */
const NO_OPENING_BALANCE_DETAIL = new Set(["Accounts receivable (A/R)", "Accounts payable (A/P)"]);

const EMPTY: NewAccountValues = {
  name: "",
  code: "",
  accountTypeLabel: "",
  detailType: "",
  isSubaccount: false,
  parentId: "",
  description: "",
  locked: false,
  openingBalance: "",
  openingBalanceDate: isoDay(),
};

/** Default account-type label for a row whose reportingGroup does not carry one (legacy rows). */
function defaultLabelFor(type: AccountType) {
  for (const block of COA_TAXONOMY) {
    const hit = block.accountTypes.find((o) => o.backendType === type);
    if (hit) return hit.label;
  }
  return "";
}

function valuesFromAccount(a: Account): NewAccountValues {
  const decoded = decodeReportingGroup(a.reportingGroup);
  const label = findAccountTypeOption(decoded.accountType) ? decoded.accountType : defaultLabelFor(a.type);
  const details = detailTypesFor(label);
  return {
    ...EMPTY,
    name: a.name,
    code: a.code,
    accountTypeLabel: label,
    detailType: details.includes(decoded.detailType) ? decoded.detailType : details[0] ?? "",
    isSubaccount: Boolean(a.parentId),
    parentId: a.parentId ?? "",
    description: a.description ?? "",
    locked: !a.allowManualPost,
  };
}

function suggestCode(accounts: Account[], type: AccountType, ranges: Array<{ type: AccountType; min: number; max: number }>) {
  const range = ranges.find((r) => r.type === type);
  if (!range) return "";
  const used = new Set(accounts.map((a) => Number(a.code)).filter(Number.isFinite));
  for (let n = range.min; n <= range.max; n++) {
    if (!used.has(n)) return String(n);
  }
  return String(range.min);
}

/** QuickBooks allows subaccounts up to five levels below a top-level account. */
const MAX_SUBACCOUNT_LEVELS = 5;

function levelOf(accounts: Account[], id: string) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  let level = 0;
  for (let cur = byId.get(id)?.parentId; cur && level <= accounts.length; cur = byId.get(cur)?.parentId) level++;
  return level;
}

function levelsBelow(accounts: Account[], id: string): number {
  const kids = accounts.filter((a) => a.parentId === id);
  return kids.length ? 1 + Math.max(...kids.map((k) => levelsBelow(accounts, k.id))) : 0;
}

/** A parent must carry the same QuickBooks account type (older accounts without one only need the same category). */
function sameAccountType(parent: Account, label: string) {
  const parentLabel = decodeReportingGroup(parent.reportingGroup).accountType;
  return !parentLabel || !label || parentLabel === label;
}

/** First free number after the parent's, inside the category range — e.g. 6841 under 6840. */
function suggestSubCode(accounts: Account[], parent: Account, range: { min: number; max: number } | undefined) {
  const used = new Set(accounts.map((a) => Number(a.code)).filter(Number.isFinite));
  const start = Number(parent.code);
  if (!Number.isFinite(start)) return "";
  const max = range?.max ?? start + 999;
  for (let n = start + 1; n <= max; n++) if (!used.has(n)) return String(n);
  return "";
}

/** The account itself plus every subaccount under it — none of them can become its parent. */
function selfAndDescendants(accounts: Account[], id: string) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of accounts) {
      if (a.parentId && out.has(a.parentId) && !out.has(a.id)) {
        out.add(a.id);
        grew = true;
      }
    }
  }
  return out;
}

export function NewAccountDrawer({ categories, accounts, account, onClose, onSaved }: Props) {
  const editing = Boolean(account);
  const { api } = useSession();
  const { toast, confirm } = useFeedback();
  const { currency, reload: reloadCompany } = useCompany();
  const initial = useMemo(() => (account ? valuesFromAccount(account) : EMPTY), [account]);
  const [values, setValues] = useState<NewAccountValues>(initial);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const isProtected = Boolean(account?.systemProtected);
  const isPosted = Boolean(account?.hasPostedTransactions);
  // QuickBooks: numbers can change at any time; only system accounts keep theirs.
  const codeLocked = isProtected;
  const { useAccountNumbers: numbersOn } = useCoaSettings();
  const hasChildren = Boolean(account && accounts.some((a) => a.parentId === account.id));

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
  const existingCodes = useMemo(
    () => new Set(accounts.filter((a) => a.id !== account?.id).map((a) => a.code)),
    [accounts, account?.id],
  );

  const schema = useMemo(
    () =>
      newAccountSchema({
        existingCodes,
        // A locked code is kept as is, even if it predates the numbering ranges.
        required: numbersOn && !codeLocked,
      }),
    [existingCodes, numbersOn, codeLocked],
  );

  const { showError, setField, blurField, validate, resetValidation, setErrors } = useYupForm(schema, values, setValues);

  // Once the code is fixed (posted or protected) the category is fixed too, because codes are tied to category ranges.
  const accountTypeOptions = useMemo(
    () =>
      COA_TAXONOMY.flatMap((block) =>
        block.accountTypes
          .filter((opt) => {
            if (!account) return true;
            // System accounts and parents keep their category; after postings only the same statement is allowed.
            if (isProtected || hasChildren) return opt.backendType === account.type;
            if (isPosted) return BALANCE_SHEET.includes(opt.backendType) === BALANCE_SHEET.includes(account.type);
            return true;
          })
          .map((opt) => ({ value: opt.label, label: opt.label, group: block.label })),
      ),
    [account, isProtected, isPosted, hasChildren],
  );

  const detailOptions = useMemo(
    () =>
      (values.accountTypeLabel ? detailTypesFor(values.accountTypeLabel) : []).map((d) => ({
        value: d,
        label: d,
      })),
    [values.accountTypeLabel],
  );

  const parentOptions = useMemo(() => {
    const blocked = account ? selfAndDescendants(accounts, account.id) : new Set<string>();
    const below = account ? levelsBelow(accounts, account.id) : 0;
    return accounts
      .filter(
        (a) =>
          a.isActive &&
          !blocked.has(a.id) &&
          (!backendType || a.type === backendType) &&
          sameAccountType(a, values.accountTypeLabel) &&
          levelOf(accounts, a.id) + 1 + below <= MAX_SUBACCOUNT_LEVELS,
      )
      .map((a) => ({ value: a.id, label: a.name, prefix: a.code }));
  }, [accounts, account, backendType, values.accountTypeLabel]);

  function pickParent(id: string) {
    const parent = accounts.find((a) => a.id === id);
    setField("parentId", id);
    // Like QuickBooks numbering, a new subaccount gets the next number after its parent.
    if (parent && !editing && !codeLocked) {
      const code = suggestSubCode(accounts, parent, range);
      if (code) {
        setField("code", code);
        setErrors((e) => ({ ...e, code: undefined }));
      }
    }
  }

  const showOpening =
    !editing && backendType !== undefined && BALANCE_SHEET.includes(backendType) && !NO_OPENING_BALANCE_DETAIL.has(values.detailType);

  function pickAccountType(label: string) {
    const details = detailTypesFor(label);
    const bt = backendTypeFor(label);
    setValues((prev) => {
      const prevType = prev.accountTypeLabel ? backendTypeFor(prev.accountTypeLabel) : undefined;
      const sameCategory = prevType === bt;
      return {
        ...prev,
        accountTypeLabel: label,
        detailType: details[0] ?? "",
        parentId: sameCategory && prev.parentId && sameAccountType(accounts.find((a) => a.id === prev.parentId) ?? ({} as Account), label) ? prev.parentId : "",
        // An existing account keeps its number when its type changes; a new one gets a suggestion.
        code: editing || codeLocked ? prev.code : sameCategory && prev.code ? prev.code : bt ? suggestCode(accounts.filter((a) => a.id !== account?.id), bt, ranges) : "",
      };
    });
    setErrors((e) => ({ ...e, accountTypeLabel: undefined, detailType: undefined, code: undefined }));
  }

  async function submit(e: FormEvent, andNew = false) {
    e.preventDefault();
    setFormError("");
    const ok = await validate();
    if (!ok || !backendType) return;

    setBusy(true);
    try {
      const detailChanged = !account || initial.detailType !== values.detailType || initial.accountTypeLabel !== values.accountTypeLabel;
      const f = flagsForDetailType(values.detailType);
      const flags = {
        isCashAccount: Boolean(f.isCashAccount),
        isInventoryAccount: Boolean(f.isInventoryAccount),
        isTaxAccount: Boolean(f.isTaxAccount),
        bankReconciliationRequired: Boolean(f.bankReconciliationRequired),
      };
      const common = {
        name: values.name.trim(),
        description: values.description.trim(),
        reportingGroup: encodeReportingGroup(values.accountTypeLabel, values.detailType),
        allowManualPost: !values.locked,
      };

      const finalParent = values.isSubaccount ? values.parentId || null : null;
      const nameKey = values.name.trim().toLowerCase();
      const twin = accounts.find(
        (o) => o.id !== account?.id && (o.parentId ?? null) === (isProtected ? account?.parentId ?? null : finalParent) && o.name.trim().toLowerCase() === nameKey,
      );
      if (twin) {
        const sameKind = backendType === twin.type && encodeReportingGroup(values.accountTypeLabel, values.detailType) === (twin.reportingGroup ?? "");
        // QuickBooks merge: renaming an account to a sibling's name (same type and detail type) folds it into that account.
        if (account && !isProtected && sameKind) {
          const ok = await confirm({
            title: `Merge ${account.name} into ${twin.name}?`,
            body: `That name is already used by ${numbersOn ? `${twin.code} ` : ""}${twin.name}. Merging moves all of ${account.name}'s transactions, balance and subaccounts into ${twin.name}, and ${account.name} is removed. This cannot be undone.`,
            confirmLabel: "Merge accounts",
            danger: true,
          });
          if (!ok) return;
          await api(`/api/v1/coa/${account.id}/merge`, { method: "POST", body: JSON.stringify({ targetId: twin.id }) });
          toast(`${account.name} merged into ${twin.name}`);
          reloadCompany();
          onSaved();
          return;
        }
        setErrors((e) => ({
          ...e,
          name: account && !sameKind
            ? "That name is used by an account of a different type or detail type, so they can't be merged"
            : finalParent
              ? "Another subaccount of this parent already has this name"
              : "Another account already has this name",
        }));
        return;
      }

      if (account) {
        await api(`/api/v1/coa/${account.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...common,
            ...(isProtected ? {} : { type: backendType }),
            ...(codeLocked || !numbersOn ? {} : { code: values.code.trim() }),
            ...(isProtected ? {} : { parentId: values.isSubaccount ? values.parentId || null : null }),
            ...(detailChanged && !isProtected ? flags : {}),
          }),
        });
        toast(`Account ${numbersOn ? `${values.code} ` : ""}${values.name.trim()} updated`);
        reloadCompany();
        onSaved();
        return;
      }

      const opening = showOpening ? Number(values.openingBalance.replace(/,/g, "")) || 0 : 0;
      await api("/api/v1/coa", {
        method: "POST",
        body: JSON.stringify({
          ...common,
          description: common.description || undefined,
          // With account numbers off, the server assigns one.
          code: numbersOn ? values.code.trim() || undefined : undefined,
          type: backendType,
          parentId: values.isSubaccount ? values.parentId || undefined : undefined,
          currency: currency || "RWF",
          ...(opening ? { openingBalance: opening, openingBalanceDate: values.openingBalanceDate } : {}),
          ...flags,
        }),
      });
      toast(`Account ${numbersOn ? `${values.code} ` : ""}${values.name.trim()} created`);
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

  const openingHint =
    backendType === "ASSET"
      ? "What the account held on this date. Posted against Opening Balance Equity."
      : backendType === "LIABILITY"
        ? "What you owed on this date. Posted against Opening Balance Equity."
        : "Posted against Opening Balance Equity.";

  return (
    <Drawer
      title={editing ? "Edit account" : "New account"}
      subtitle={
        isProtected
          ? "System account — its number, category and parent are fixed."
          : isPosted
            ? "This account has transactions, so its type can only change within the balance sheet or within profit and loss."
            : undefined
      }
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
                {busy ? "Saving…" : editing ? "Save" : "Save and close"}
              </button>
              {!editing && (
                <button
                  type="button"
                  className="btn btn-primary ee-coa-save-more"
                  aria-label="Save and new"
                  disabled={busy}
                  onClick={(ev) => void submit(ev as unknown as FormEvent, true)}
                  title="Save and new"
                >
                  <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
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
          <Field label="Account name" required error={showError("name")} hint={isProtected ? "System account names are fixed" : undefined}>
            <input
              className="input"
              value={values.name}
              onChange={(e) => setField("name", e.target.value)}
              onBlur={() => blurField("name")}
              disabled={isProtected}
              autoFocus
            />
          </Field>

          {numbersOn && (
            <Field
              label="Account number"
              required
              hint={!showError("code") ? (codeLocked ? "Fixed" : "Up to 7 letters or digits") : undefined}
              error={showError("code")}
            >
              <input
                className="input mono"
                value={values.code}
                onChange={(e) => setField("code", e.target.value.replace(/[^A-Za-z0-9.-]/g, "").slice(0, 7))}
                onBlur={() => blurField("code")}
                placeholder="e.g. 1100"
                disabled={codeLocked}
              />
            </Field>
          )}

          <Field
            label={
              <span className="ee-coa-label-with-info">
                Account type
                <button
                  type="button"
                  className="ee-coa-info"
                  title="Account type controls where this account appears on the balance sheet or profit and loss"
                  aria-label="About account type"
                  onClick={() => toast("Account type controls where this account appears on the balance sheet or profit and loss.")}
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

        {!isProtected && (
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
        )}

        {values.isSubaccount && !isProtected && (
          <Field
            label="Parent account"
            required
            error={showError("parentId")}
            hint={!showError("parentId") ? `Same account type as this one, up to ${MAX_SUBACCOUNT_LEVELS} levels deep.` : undefined}
          >
            <Select
              value={values.parentId}
              onChange={pickParent}
              options={parentOptions}
              placeholder="Select parent account"
              searchable
              invalid={Boolean(showError("parentId"))}
              emptyText="No matching parent accounts"
              aria-label="Parent account"
            />
          </Field>
        )}

        {showOpening && (
          <div className="ee-coa-form-grid">
            <Field label="Opening balance" error={showError("openingBalance")} hint={!showError("openingBalance") ? openingHint : undefined}>
              <input
                className="input mono"
                value={values.openingBalance}
                onChange={(e) => setField("openingBalance", e.target.value.replace(/[^\d.,-]/g, ""))}
                onBlur={() => blurField("openingBalance")}
                inputMode="decimal"
                placeholder="0"
              />
            </Field>
            <Field label="As of" error={showError("openingBalanceDate")}>
              <input
                className="input"
                type="date"
                value={values.openingBalanceDate}
                onChange={(e) => setField("openingBalanceDate", e.target.value)}
                onBlur={() => blurField("openingBalanceDate")}
              />
            </Field>
          </div>
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
          <div>
            <span className="field-label">Lock account</span>
            <div className="ee-coa-lock-state" aria-live="polite">
              {values.locked ? "Locked: manual journal entries can't post to this account." : "Unlocked: manual journal entries are allowed."}
            </div>
          </div>
          <div className="ee-coa-lock-toggle" role="group" aria-label="Lock account">
            <button
              type="button"
              className={`ee-coa-lock-btn ${!values.locked ? "on" : ""}`}
              aria-pressed={!values.locked}
              title="Unlocked — allow manual journal entries"
              onClick={() => setField("locked", false)}
            >
              <LockOpen size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`ee-coa-lock-btn ${values.locked ? "on locked" : ""}`}
              aria-pressed={values.locked}
              title="Locked — block manual journal entries"
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
