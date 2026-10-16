import { useState } from "react";
import { useFeedback } from "../components/feedback";
import { Badge, ErrorState, PageHeader, SkeletonRows } from "../components/ui";
import { useCompany } from "../lib/company";
import { date, dateTime, humanize } from "../lib/format";
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

type Gate = { canActivate: boolean; status: string; missing: string[]; errors: string[] };

/** Steps the guided quick setup has always run: standard Rwandan retail defaults and sample company details. */
const QUICK_SETUP_STEPS: Array<[string, RequestInit]> = [
  ["/api/v1/setup/profile", { method: "PUT", body: JSON.stringify({ registeredName: "Excel Edge Demo Co", taxIdentificationNumber: "999999999", country: "RW", businessEmail: "accounts@exceledge.demo" }) }],
  ["/api/v1/setup/business-info", { method: "PUT", body: JSON.stringify({ businessType: "RETAIL", accountingBasis: "ACCRUAL", reportingFramework: "IFRS_SME" }) }],
  ["/api/v1/setup/financial-years", { method: "POST", body: JSON.stringify({ name: "FY 2026", startDate: "2026-01-01", endDate: "2026-12-31", periodFrequency: "MONTHLY" }) }],
  ["/api/v1/setup/currency", { method: "PUT", body: JSON.stringify({ functionalCurrency: "RWF", decimalPrecision: 0 }) }],
  ["/api/v1/setup/policies", { method: "PUT", body: JSON.stringify({ accountingBasis: "ACCRUAL", inventoryValuationMethod: "WEIGHTED_AVERAGE" }) }],
  ["/api/v1/setup/localization", { method: "PUT", body: JSON.stringify({ countryOfRegistration: "RW", localizationPackage: "RW", taxAuthority: "RRA", electronicInvoicingRequired: true }) }],
  ["/api/v1/setup/default-accounts/ensure", { method: "POST" }],
  ["/api/v1/setup/inventory-settings", { method: "PUT", body: JSON.stringify({ automaticCogsPosting: true }) }],
  ["/api/v1/setup/party-defaults", { method: "PUT", body: JSON.stringify({ customerPaymentTerms: "NET30" }) }],
  ["/api/v1/setup/banking", { method: "PUT", body: JSON.stringify({ defaultReceiptMethod: "CASH", defaultPaymentMethod: "MOBILE_MONEY" }) }],
  ["/api/v1/setup/numbering/ensure", { method: "POST" }],
  ["/api/v1/setup/approvals", { method: "PUT", body: JSON.stringify({ approvalWorkflowEnabled: true, approvalLevels: 1, periodLockEnforcement: true }) }],
];

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
  const [gate, setGate] = useState<Gate | null>(null);
  const [busy, setBusy] = useState<"" | "check" | "activate" | "quick">("");

  const d = company.dashboard;
  const snap = company.snapshot;

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
      body: "Once active, sales and purchases from Excel Edge start posting to the general ledger, and the financial year settings are locked in.",
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

  async function quickSetup() {
    const ok = await confirm({
      title: "Run quick setup?",
      body: "This fills every section with standard Rwandan retail defaults and sample company details (Excel Edge Demo Co, TIN 999999999), then activates accounting. Use it for demos and testing, not for a real company.",
      confirmLabel: "Run quick setup",
    });
    if (!ok) return;
    setBusy("quick");
    try {
      for (const [path, init] of QUICK_SETUP_STEPS) await api(path, init);
      for (const key of ["FINANCIAL_YEAR_PERIODS", "CURRENCY", "ACCOUNTING_POLICIES"]) {
        await api(`/api/v1/setup/sections/${key}/approve`, { method: "POST" });
      }
      const res = await apiWithMessage("/api/v1/setup/activation/activate", { method: "POST" });
      toast(res.message ?? "Accounting activated");
      company.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
      company.reload();
    } finally {
      setBusy("");
    }
  }

  if (!d) {
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
  const year = snap?.years.find((y) => y.isCurrent) ?? snap?.years[0];

  return (
    <>
      <PageHeader
        title="Company setup"
        description={
          activated
            ? `Accounting is active${d.activatedAt ? ` since ${date(d.activatedAt)}` : ""}.`
            : "Complete these sections, then activate accounting to start posting."
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

      {d.activationStatus === "CONFIGURATION_ERROR" && (
        <div className="notice error">Some sections have configuration errors. Fix them before activating.</div>
      )}
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

      <div className="overview-grid" style={{ marginTop: 0 }}>
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
            <ul className="checklist">
              {d.sections.map((s) => {
                const st = sectionState(s.status);
                return (
                  <li key={s.key}>
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
          <div className="section-head">
            <h2 className="section-title">Company details</h2>
          </div>
          <div className="panel panel-body">
            <dl className="dl">
              <dt>Registered name</dt>
              <dd>{snap?.profile?.registeredName ?? <span className="muted">Not set</span>}</dd>
              <dt>TIN</dt>
              <dd>{snap?.profile?.taxIdentificationNumber ?? <span className="muted">Not set</span>}</dd>
              <dt>Country</dt>
              <dd>{d.country ? (d.country === "RW" ? "Rwanda" : d.country) : <span className="muted">Not set</span>}</dd>
              <dt>Currency</dt>
              <dd>{d.functionalCurrency ?? <span className="muted">Not set</span>}</dd>
              <dt>Tax authority</dt>
              <dd>
                {snap?.localization?.taxAuthority ?? <span className="muted">Not set</span>}
                {snap?.localization?.electronicInvoicingRequired && <span className="muted"> · EBM e-invoicing required</span>}
              </dd>
              <dt>Financial year</dt>
              <dd>{year ? `${year.name} (${date(year.startDate)} – ${date(year.endDate)})` : <span className="muted">Not set</span>}</dd>
              <dt>Open period</dt>
              <dd>{d.currentOpenPeriod?.name ?? <span className="muted">None open</span>}</dd>
              <dt>ERP organisation</dt>
              <dd className="muted">#{d.externalErpOrganizationId}</dd>
            </dl>
          </div>

          {!activated && can("setup:prepare") && can("setup:approve") && can("setup:activate") && (
            <div className="panel panel-body" style={{ marginTop: 16 }}>
              <h3 className="section-title">Quick setup for demos</h3>
              <p className="muted small" style={{ margin: "4px 0 12px" }}>
                Fills every section with standard Rwandan retail defaults and sample company details, then activates. Not for real companies.
              </p>
              <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void quickSetup()}>
                {busy === "quick" ? "Running setup…" : "Run quick setup"}
              </button>
            </div>
          )}
          {activated && d.activatedAt && <p className="muted small" style={{ marginTop: 10 }}>Activated {dateTime(d.activatedAt)}</p>}
        </section>
      </div>
    </>
  );
}
