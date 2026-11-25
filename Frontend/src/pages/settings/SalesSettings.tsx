import { SettingsLayout } from "../../components/settings/SettingsLayout";
import { SettingsSection } from "../../components/settings/SettingsSection";

export function SalesSettings() {
  return (
    <SettingsLayout title="Sales" subtitle="Manage sales forms, payments and product preferences.">
      <div className="ee-settings-grid-2">
        <SettingsSection id="sales-form" title="Sales form content" description="Customize the information and fields that appear on your sales forms." rows={[
          { key: "terms", label: "Preferred invoice terms", kind: "select", value: "Net 30", options: ["Due on receipt", "Net 15", "Net 30", "Net 60"] },
          { key: "delivery", label: "Preferred delivery method", kind: "select", value: "None", options: ["None", "Print later", "Send later"], soon: true },
          { key: "shipping", label: "Shipping", kind: "toggle", value: false, soon: true },
          { key: "customFields", label: "Custom fields", kind: "link", value: "Manage fields", to: "/settings/custom-fields" },
          { key: "customNumbers", label: "Custom transaction numbers", kind: "toggle", value: true, soon: true },
          { key: "serviceDate", label: "Service date", kind: "toggle", value: true },
          { key: "discount", label: "Discount", kind: "toggle", value: false, soon: true },
          { key: "deposit", label: "Deposit", kind: "toggle", value: false, soon: true },
          { key: "tags", label: "Tags", kind: "toggle", value: true, soon: true },
        ]} />
        <SettingsSection id="sales-products" title="Products and services" description="Manage how products and services appear and are tracked on your sales forms." rows={[
          { key: "column", label: "Show Product/Service column on sales forms", kind: "toggle", value: true, soon: true },
          { key: "sku", label: "Show SKU column", kind: "toggle", value: false },
          { key: "priceRules", label: "Turn on price rules", kind: "toggle", value: false, soon: true },
          { key: "quantity", label: "Track quantity and price/rate", kind: "toggle", value: true, soon: true },
          { key: "onHand", label: "Track inventory quantity on hand", kind: "toggle", value: true, soon: true },
          { key: "valuation", label: "Inventory valuation method", kind: "link", value: "Open company setup", to: "/setup" },
          { key: "receiving", label: "Inventory receiving method", kind: "select", value: "Bills and expenses", options: ["Bills and expenses", "Item receipts"], badge: "NEW", soon: true },
          { key: "revenue", label: "Revenue recognition", kind: "toggle", value: true, soon: true },
        ]} />
        <SettingsSection id="sales-payments" title="Invoice payments" description="Manage how your customers can pay and what appears on your invoices." rows={[
          { key: "instructions", label: "Payment instructions", kind: "longtext", value: "", empty: "No custom payment instructions added" },
        ]}>
          <div className="ee-settings-row">
            <div>
              <div className="ee-settings-row-label">Accept online payments</div>
              <div className="ee-settings-hint">Needs a payment provider, which isn't connected yet.</div>
            </div>
            <button type="button" className="btn ee-btn-outline-blue btn-sm" disabled>
              Activate
            </button>
          </div>
        </SettingsSection>
        <SettingsSection id="sales-progress" title="Progress invoicing" description="Manage options for creating and tracking progress invoices." rows={[
          { key: "partial", label: "Create multiple partial invoices from a single estimate", kind: "toggle", value: false, soon: true },
          { key: "completed", label: "Show completely billed products and services on progress invoices", kind: "toggle", value: false, soon: true },
        ]} />
        <SettingsSection id="sales-messages" title="Messages" description="Manage the default email message sent with sales forms." rows={[
          { key: "email", label: "Default email message sent with sales forms", kind: "longtext", value: "" },
        ]} />
        <SettingsSection id="sales-feedback" title="Post-invoice / Feedback survey" description="Collect work requests, reviews and referrals from your customers." rows={[
          { key: "work", label: "Ask for a work request", kind: "toggle", value: false, soon: true },
          { key: "review", label: "Ask for a review, feedback or testimonials", kind: "toggle", value: false, soon: true },
          { key: "referral", label: "Ask for a referral", kind: "toggle", value: false, soon: true },
          { key: "frequency", label: "Frequency", kind: "select", value: "90 days", options: ["30 days", "60 days", "90 days"], soon: true },
        ]} />
        <SettingsSection id="sales-reminders" title="Reminders and late fees" description="Sent and charged once a day by the server, only within a week of each due day. Reminders go by email to customers who have an address." rows={[
          { key: "enabled", label: "Email payment reminders automatically", kind: "toggle", value: false },
          { key: "days", label: "Days after the due date", kind: "text", value: "3, 10, 30", hint: "Use a minus for days before, such as -3" },
          { key: "message", label: "Reminder message", kind: "longtext", value: "", empty: "Standard wording" },
          { key: "lateFee", label: "Charge a late fee automatically", kind: "toggle", value: false, hint: "Raises one invoice without VAT per overdue invoice; check with your accountant first" },
          { key: "lateFeeType", label: "Fee is a", kind: "select", value: "Percent of balance", options: ["Percent of balance", "Fixed amount"] },
          { key: "lateFeeValue", label: "Percent or amount", kind: "text", value: "" },
          { key: "lateFeeGrace", label: "Days overdue before charging", kind: "text", value: "30" },
        ]} />
        <SettingsSection id="sales-delivery" title="Online delivery" description="Manage email options for all sales forms." rows={[
          { key: "format", label: "Email options for all sales forms", kind: "select", value: "Link and PDF", options: ["Link and PDF", "PDF attachment", "Link only"], soon: true },
        ]} />
        <SettingsSection id="sales-ai" title="Customer AI" description="Manage AI insights and email digests for your sales activity." rows={[
          { key: "digest", label: "Daily email digest", kind: "toggle", value: true, soon: true },
        ]} />
        <SettingsSection id="sales-statements" title="Statements" description="Manage statement layout and presentation options." rows={[
          { key: "ageing", label: "Show ageing table at bottom of statement", kind: "toggle", value: true, soon: true },
        ]} />
      </div>
    </SettingsLayout>
  );
}
