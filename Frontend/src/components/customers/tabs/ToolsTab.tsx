import { Wrench } from "lucide-react";
import { FormSection } from "../FormSection";

export function ToolsTab() {
  return (
    <FormSection title="Tools" icon={Wrench}>
      <p className="ee-form-section-sub" style={{ marginTop: 0 }}>
        Shortcuts for this customer once they are saved.
      </p>
      <ul className="ee-dummy-list">
        <li>Create invoice</li>
        <li>Receive payment</li>
        <li>Send statement</li>
        <li>Print packing slip</li>
      </ul>
    </FormSection>
  );
}
