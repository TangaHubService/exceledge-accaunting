import { type ComponentType, type KeyboardEvent, useState } from "react";
import { useFeedback } from "../components/feedback";
import {
  ApprovalsForm,
  BankingForm,
  BusinessInfoForm,
  CurrencyForm,
  DefaultAccountsForm,
  FinancialYearsForm,
  type FullSnapshot,
  InventorySettingsForm,
  LocalizationForm,
  NumberingForm,
  OpeningBalancesForm,
  PartyDefaultsForm,
  PoliciesForm,
  ProfileForm,
  type SectionProps,
} from "../components/SetupForms";
import { Badge, ErrorState, PageHeader, SkeletonRows } from "../components/ui";
import { useCompany } from "../lib/company";
import { calendarDate, date, dateTime, humanize } from "../lib/format";
import { setQueryParam, useLocation } from "../lib/router";
import { useSession } from "../lib/session";

const SECTION_LABELS: Record<string, string> = {
  COMPANY_PROFILE: "Company profile",
  BUSINESS_ACCOUNTING_INFO: "Business type and accounting basis",
  FINANCIAL_YEAR_PERIODS: "Financial year and periods",
  CURRENCY: "Currency",
  ACCOUNTING_POLICIES: "Accounting policies",
  LOCALIZATION: "Tax and localisation",
  DEFAULT_POSTING_ACCOUNTS: "Default posting accounts",
  INVENTORY_SETTINGS: "Inventory accounting",
  PARTY_DEFAULTS: "Customer and supplier defaults",
  BANKING_PAYMENT: "Banking and payment methods",
  TRANSACTION_NUMBERING: "Document numbering",
  APPROVAL_POSTING_CONTROLS: "Approvals and posting controls",
  OPENING_BALANCES: "Opening balances",
  REVIEW_ACTIVATION: "Review and activate",
};

const SECTION_FORMS: Record<string, ComponentType<SectionProps>> = {
  COMPANY_PROFILE: ProfileForm,
  BUSINESS_ACCOUNTING_INFO: BusinessInfoForm,
  FINANCIAL_YEAR_PERIODS: FinancialYearsForm,
  CURRENCY: CurrencyForm,
  ACCOUNTING_POLICIES: PoliciesForm,
  LOCALIZATION: LocalizationForm,
  DEFAULT_POSTING_ACCOUNTS: DefaultAccountsForm,
  INVENTORY_SETTINGS: InventorySettingsForm,
  PARTY_DEFAULTS: PartyDefaultsForm,
  BANKING_PAYMENT: BankingForm,
  TRANSACTION_NUMBERING: NumberingForm,
  APPROVAL_POSTING_CONTROLS: ApprovalsForm,
  OPENING_BALANCES: OpeningBalancesForm,
};

type Gate = { canActivate: boolean; status: string; missing: string[]; errors: string[] };

function sectionState(status: string) {
  if (status === "COMPLETED" || status === "APPROVED") return { tick: "done", badge: <span className="muted small">{humanize(status)}</span> };
  if (status === "CONFIGURATION_ERROR") return { tick: "error", badge: <Badge tone="negative">Needs fixing</Badge> };
  if (status === "REQUIRES_REVIEW") return { tick: "review", badge: <Badge tone="warning">Needs review</Badge> };
  if (status === "IN_PROGRESS") return { tick: "review", badge: <Badge tone="info">In progress</Badge> };
  return { tick: "", badge: <span className="subtle small">Not started</span> };
}

export function Setup() {
  const { api, apiWithMessage, can } = useSession();
  const { toast, confirm } = useFeedback();
  const company = useCompany();
  const { query } = useLocation();
  const [gate, setGate] = useState<Gate | null>(null);
  const [busy, setBusy] = useState<"" | "check" | "activate">("");

  const d = company.dashboard;
  const snap = company.snapshot as unknown as FullSnapshot | undefined;

  async function check() {
    setBusy("check");
    try {
      const res = await api<{ gate: Gate }>("/api/v1/setup/activation/validate");
      setGate(res.gate);
      company.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy("");
    }
  }

  async function activate() {
    const ok = await confirm({
      title: "Activate accounting?",
      body: "Once active, sales and purchases from Excel Edge start posting to the general ledger. The functional currency and inventory valuation method are locked in.",
      confirmLabel: "Activate",
    });
    if (!ok) return;
    setBusy("activate");
    try {
      const res = await apiWithMessage("/api/v1/setup/activation/activate", { method: "POST" });
      toast(res.message ?? "Accounting activated");
      setGate(null);
      company.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy("");
    }
  }

  if (!d || !snap) {
    return (
      <>
        <PageHeader title="Company setup" />
        {company.error ? (
          <div className="panel">
            <ErrorState message={company.error} onRetry={company.reload} />
          </div>
        ) : (
          <SkeletonRows rows={8} cols={2} />
        )}
      </>
    );
  }

  const activated = d.activationStatus === "ACTIVATED";
  const pct = Math.round((d.counts.completed / Math.max(1, d.counts.total)) * 100);
  const firstOpen = d.sections.find((s) => s.status !== "COMPLETED" && s.status !== "APPROVED")?.key;
  const requested = query.get("section");
  const selected = requested && SECTION_LABELS[requested] ? requested : (firstOpen ?? "COMPANY_PROFILE");
  const selectedStatus = d.sections.find((s) => s.key === selected)?.status ?? "NOT_STARTED";
  const Form = SECTION_FORMS[selected];
  const year = snap.years.find((y) => y.isCurrent) ?? snap.years[0];

  function choose(key: string) {
    setQueryParam("section", key);
  }

  function onKey(e: KeyboardEvent<HTMLLIElement>, key: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(key);
    }
  }

  return (
    <>
      <PageHeader
        title="Company setup"
        description={
          activated
            ? `Accounting is active${d.activatedAt ? ` since ${date(d.activatedAt)}` : ""}. Settings can still be adjusted; the currency and valuation method are locked.`
            : "Complete each section, then activate accounting to start posting."
        }
        actions={
          !activated && (
            <>
              <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void check()}>
                {busy === "check" ? "Checking…" : "Check readiness"}
              </button>
              {can("setup:activate") && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={Boolean(busy) || d.activationStatus !== "READY"}
                  title={d.activationStatus !== "READY" ? "Check readiness first — every required section must be complete." : undefined}
                  onClick={() => void activate()}
                >
                  {busy === "activate" ? "Activating…" : "Activate accounting"}
                </button>
              )}
            </>
          )
        }
      />

      {d.activationStatus === "CONFIGURATION_ERROR" && <div className="notice error">Some sections have configuration errors. Fix them before activating.</div>}
      {gate && !gate.canActivate && (
        <div className="notice">
          <div className="grow">
            <strong>Not ready to activate yet.</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {[...gate.errors, ...gate.missing].map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {gate?.canActivate && !activated && <div className="notice info">Everything required is in place. You can activate accounting.</div>}

      <div className="setup-grid">
        <section>
          <div className="section-head">
            <h2 className="section-title">Setup checklist</h2>
            <span className="muted small">
              {d.counts.completed} of {d.counts.total} complete
            </span>
          </div>
          <div className="panel">
            <div style={{ padding: "14px 18px 4px" }}>
              <div className="progress" aria-label={`${pct}% complete`}>
                <div style={{ width: `${pct}%` }} />
              </div>
            </div>
            <ul className="checklist" role="listbox" aria-label="Setup sections">
              {d.sections.map((s) => {
                const st = sectionState(s.status);
                const on = s.key === selected;
                return (
                  <li
                    key={s.key}
                    role="option"
                    aria-selected={on}
                    tabIndex={0}
                    className={`selectable ${on ? "on" : ""}`}
                    onClick={() => choose(s.key)}
                    onKeyDown={(e) => onKey(e, s.key)}
                  >
                    <span className={`tick ${st.tick}`} aria-hidden="true">
                      {st.tick === "done" ? "✓" : st.tick === "error" ? "!" : ""}
                    </span>
                    <span>
                      {SECTION_LABELS[s.key] ?? humanize(s.key)}
                      {s.lastError && <span className="field-error" style={{ display: "block" }}>{s.lastError}</span>}
                    </span>
                    {st.badge}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section>
          {Form ? (
            <Form key={selected} snap={snap} sectionKey={selected} status={selectedStatus} activated={activated} onSaved={company.reload} />
          ) : (
            <div className="panel panel-body">
              <h2 className="section-title">Review and activate</h2>
              <p className="muted small" style={{ margin: "4px 0 14px" }}>
                {activated
                  ? `Accounting was activated ${d.activatedAt ? dateTime(d.activatedAt) : ""}.`
                  : "Check readiness to see what is still missing. Once every required section is complete, activate accounting."}
              </p>
              <dl className="dl">
                <dt>Registered name</dt>
                <dd>{snap.profile?.registeredName ? String(snap.profile.registeredName) : <span className="muted">Not set</span>}</dd>
                <dt>TIN</dt>
                <dd>{snap.profile?.taxIdentificationNumber ? String(snap.profile.taxIdentificationNumber) : <span className="muted">Not set</span>}</dd>
                <dt>Country</dt>
                <dd>{d.country ? (d.country === "RW" ? "Rwanda" : d.country) : <span className="muted">Not set</span>}</dd>
                <dt>Currency</dt>
                <dd>{d.functionalCurrency ?? <span className="muted">Not set</span>}</dd>
                <dt>Financial year</dt>
                <dd>{year ? `${year.name} (${calendarDate(year.startDate)} – ${calendarDate(year.endDate)})` : <span className="muted">Not set</span>}</dd>
                <dt>Open period</dt>
                <dd>{d.currentOpenPeriod?.name ?? <span className="muted">None open</span>}</dd>
                <dt>ERP organisation</dt>
                <dd className="muted">#{d.externalErpOrganizationId}</dd>
              </dl>
              {!activated && (
                <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                  <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void check()}>
                    {busy === "check" ? "Checking…" : "Check readiness"}
                  </button>
                  {can("setup:activate") && (
                    <button type="button" className="btn btn-primary" disabled={Boolean(busy) || d.activationStatus !== "READY"} onClick={() => void activate()}>
                      {busy === "activate" ? "Activating…" : "Activate accounting"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
