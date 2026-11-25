import { SettingsSection } from "../../components/settings/SettingsSection";
import { PageHeader } from "../../components/ui";

export function FormStyles() {
  return (
    <>
      <PageHeader title="Form styles" description="How your invoices read when they are printed or emailed." />
      <SettingsSection id="form-style" title="Invoice" rows={[
        { key: "heading", label: "Heading", kind: "text", value: "", empty: "Tax invoice", hint: "The word before the invoice number." },
        { key: "message", label: "Message to the customer", kind: "longtext", value: "", empty: "None" },
        { key: "footer", label: "Footer", kind: "text", value: "", empty: "Invoice number only" },
        { key: "hideDiscount", label: "Leave out the discount column when there is no discount", kind: "toggle", value: false },
        { key: "hideCustomerTin", label: "Leave out the customer's TIN", kind: "toggle", value: false },
      ]} />
      <SettingsSection id="sales-payments" title="Payment" rows={[{ key: "instructions", label: "Payment instructions", kind: "longtext", value: "", empty: "None", hint: "Printed under the totals." }]} />
    </>
  );
}
