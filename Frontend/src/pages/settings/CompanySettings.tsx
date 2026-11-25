import { Store } from "lucide-react";
import { SettingsLayout } from "../../components/settings/SettingsLayout";
import { SettingsCard, SettingsSection } from "../../components/settings/SettingsSection";
import { useCompany } from "../../lib/company";
import type { Prefs } from "../../lib/preferences";
import { useResource, useSession } from "../../lib/session";

type Snapshot = { profile: Record<string, string | null> | null; businessInfo: Record<string, string | null> | null };

const PROFILE = ["industry", "tradingName", "operatingAddress", "businessEmail", "registeredName", "taxIdentificationNumber", "registeredAddress"] as const;

export function CompanySettings() {
  const { api, can } = useSession();
  const company = useCompany();
  const res = useResource<Snapshot>("/api/v1/setup/snapshot");
  const canEdit = Boolean(res.data) && can("setup:prepare");
  const values: Prefs = Object.fromEntries(PROFILE.map((k) => [k, res.data?.profile?.[k] ?? ""]));
  values.businessType = res.data?.businessInfo?.businessType ?? "";

  // Only what changed is sent, so untouched fields stay exactly as setup left them.
  async function save(next: Prefs) {
    const changed = Object.entries(next).filter(([k, v]) => v !== values[k]);
    if (changed.some(([k, v]) => (k === "registeredName" || k === "taxIdentificationNumber") && !String(v).trim())) throw new Error("The legal name and TIN can't be empty");
    const profile = Object.fromEntries(changed.filter(([k]) => k !== "businessType"));
    if (Object.keys(profile).length) await api("/api/v1/setup/profile", { method: "PUT", body: JSON.stringify(profile) });
    if (changed.some(([k]) => k === "businessType")) await api("/api/v1/setup/business-info", { method: "PUT", body: JSON.stringify({ businessType: next.businessType }) });
    res.reload();
    company.reload();
  }
  const card = { values, canEdit, onSave: save };

  return (
    <SettingsLayout title="Company" subtitle="Manage your business profile and legal information.">
      <div className="ee-settings-profile">
        <span className="ee-settings-profile-avatar" aria-hidden="true">
          <Store size={28} strokeWidth={1.5} />
        </span>
        <div className="ee-settings-profile-label">{company.name || "Company profile"}</div>
      </div>
      {res.error ? <p className="ee-settings-hint" role="alert">Couldn't load company details: {res.error}</p> : null}
      <SettingsCard {...card} title="Industry" rows={[{ key: "industry", label: "Industry", kind: "text", value: "" }]} />
      <SettingsCard {...card} title="Company info" description="Details customers and suppliers see on documents." rows={[
        { key: "tradingName", label: "Name", kind: "text", value: "" },
        { key: "operatingAddress", label: "Address", kind: "text", value: "" },
        { key: "businessEmail", label: "Email", kind: "email", value: "" },
      ]} />
      <SettingsCard {...card} title="Legal info" description="This is the information your business uses for tax purposes." rows={[
        { key: "registeredName", label: "Legal business name", kind: "text", value: "" },
        { key: "taxIdentificationNumber", label: "VAT/GST/TAX ID number", kind: "text", value: "" },
        { key: "businessType", label: "Business type", kind: "text", value: "" },
        { key: "registeredAddress", label: "Legal address", kind: "text", value: "" },
      ]} />
      <SettingsSection id="company-contact" title="Customer contact info" rows={[
        { key: "email", label: "Customer email", kind: "email", value: "" },
        { key: "address", label: "Customer address", kind: "text", value: "" },
      ]} />
    </SettingsLayout>
  );
}
