import { Info, Upload } from "lucide-react";

const ZONES = [
  {
    title: "Employment contract (optional)",
    hint: "Click to upload or drag and drop.",
    formats: "PDF, DOCX • Max 20 MB",
  },
  {
    title: "Identification document (optional)",
    hint: "Upload national ID or passport.",
    formats: "PDF, JPG, PNG • Max 20 MB",
  },
  {
    title: "Other supporting documents (optional)",
    hint: "Add certificates or other documents.",
    formats: "PDF, DOCX, JPG, PNG • Max 20 MB per file.",
  },
] as const;

export function EmployeeDocumentsStep() {
  return (
    <div className="ee-team-step">
      <h3 className="ee-team-step-title">Employee documents</h3>
      <p className="ee-team-step-lead">Upload supporting documents to complete the employee record.</p>

      <div className="ee-team-doc-zones">
        {ZONES.map((z) => (
          <div key={z.title} className="ee-team-doc-card">
            <div className="ee-team-doc-card-title">{z.title}</div>
            <button type="button" className="ee-team-doc-drop">
              <Upload size={22} strokeWidth={1.5} aria-hidden="true" />
              <span>{z.hint}</span>
              <span className="muted small">{z.formats}</span>
            </button>
          </div>
        ))}
      </div>

      <div className="ee-comm-note ee-team-doc-note">
        <Info size={16} strokeWidth={1.5} aria-hidden="true" />
        <p>Documents can also be added later from the employee profile.</p>
      </div>
    </div>
  );
}
