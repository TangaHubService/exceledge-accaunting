import { FileText, Plus, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "../components/feedback";
import { EmptyState, Field, PageHeader } from "../components/ui";
import { navigate } from "../lib/router";
import { FORM_TEMPLATES, type FormTemplate } from "../lib/lists-dummy";

export function SelectForms() {
  const { toast } = useFeedback();
  const [query, setQuery] = useState("");

  const filtered = FORM_TEMPLATES.filter(
    (f) =>
      f.name.toLowerCase().includes(query.toLowerCase()) ||
      f.type.toLowerCase().includes(query.toLowerCase()) ||
      f.description.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Select forms"
        description="Choose which form templates your sales and purchase documents use. Set a default for each type."
        actions={
          <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              className="input"
              placeholder="Search forms…"
              value={query}
              onChange={(e) => setQuery(e.target.value || "")}
            />
            <button type="button" className="btn btn-primary" onClick={() => toast("New form template not yet wired")}>
              <Plus size={16} aria-hidden="true" />
              New form
            </button>
          </div>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14, marginTop: 8 }}>
        {filtered.length === 0 ? (
          <div className="panel">
            <EmptyState title="No forms match" body="Try a different search term." />
          </div>
        ) : (
          filtered.map((f) => (
            <div key={f.id} className="ee-cf-card">
              <div className="ee-cf-card-head">
                <div>
                  <h3 className="ee-cf-name">{f.name}</h3>
                  <p className="ee-cf-applies">{f.type} · Default for {f.defaultFor}</p>
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#2f6fed" }}>{f.type}</span>
              </div>
              <p style={{ fontSize: 12.5, color: "#667085", margin: "8px 0 0" }}>{f.description}</p>
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <button type="button" className="btn btn-quiet" onClick={() => toast(`Editing ${f.name}…`)}>
                  Edit
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => toast(`${f.name} set as default for ${f.defaultFor}`)}>
                  Set default
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10, color: "#667085", fontSize: 12.5 }}>
        <FileText size={14} strokeWidth={1.5} />
        <span>
          Forms appear on invoices, estimates, sales receipts, sales orders, bills and purchase orders. You can customise each template under Settings &gt; Form styles.
        </span>
      </div>
    </>
  );
}
