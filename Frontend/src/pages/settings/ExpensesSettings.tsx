import { SettingsLayout } from "../../components/settings/SettingsLayout";
import { SettingsSection } from "../../components/settings/SettingsSection";

export function ExpensesSettings() {
  return (
    <SettingsLayout title="Expenses" subtitle="Manage bills, purchasing and supplier communication.">
        <SettingsSection id="expenses-bills" title="Bills and expenses" rows={[
          { key: "items", label: "Show items table on expense and purchase forms", kind: "toggle", value: false, soon: true },
          { key: "tags", label: "Show Tags field on expense and purchase forms", kind: "toggle", value: true, soon: true },
          { key: "byCustomer", label: "Track expenses and items by customer", kind: "toggle", value: false, soon: true },
          { key: "billable", label: "Make expenses and items billable", kind: "toggle", value: false, soon: true },
          { key: "terms", label: "Default bill payment terms", kind: "select", value: "", options: ["", "Due on receipt", "Net 15", "Net 30", "Net 60"], soon: true },
        ]} />
      <div className="ee-settings-grid-2">
        <SettingsSection id="expenses-po" title="Purchase orders" rows={[
          { key: "use", label: "Use purchase orders", kind: "toggle", value: true, soon: true },
        ]} />
        <SettingsSection id="expenses-messages" title="Messages" rows={[
          { key: "email", label: "Default email message sent with purchase orders and bills", kind: "longtext", value: "", soon: true },
        ]} />
      </div>
    </SettingsLayout>
  );
}
