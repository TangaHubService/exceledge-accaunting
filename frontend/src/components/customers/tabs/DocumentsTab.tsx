import { FolderOpen } from "lucide-react";
import { FormSection } from "../FormSection";

export function DocumentsTab() {
  return (
    <FormSection title="Documents" icon={FolderOpen}>
      <div className="ee-attach-zone">
        <div>
          <button type="button" className="ee-link-btn">
            Upload document
          </button>
          <p className="muted small">Contracts, ID and other files. Max 20 MB each.</p>
        </div>
      </div>
      <ul className="ee-dummy-list">
        <li>Acme_credit_application.pdf</li>
        <li>Jane_Doe_ID.pdf</li>
      </ul>
    </FormSection>
  );
}
