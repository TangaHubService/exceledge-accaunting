import {
  Check,
  ChevronDown,
  ChevronLeft,
  Play,
  X,
} from "lucide-react";
import { useState } from "react";
import { useFeedback } from "../components/feedback";
import { Link, navigate } from "../lib/router";

const CATEGORIES = ["Customer", "Transaction", "Supplier", "Project"];

interface FormItem {
  id: string;
  label: string;
  hasPrintToggle: boolean;
}

const FORMS_LIST: FormItem[] = [
  { id: "sales-receipt", label: "Sales Receipt", hasPrintToggle: true },
  { id: "invoice", label: "Invoice", hasPrintToggle: true },
  { id: "estimate", label: "Estimate", hasPrintToggle: true },
  { id: "credit-note", label: "Credit Note", hasPrintToggle: true },
  { id: "refund-receipt", label: "Refund Receipt", hasPrintToggle: true },
  { id: "sales-order", label: "Sales Order", hasPrintToggle: true },
  { id: "purchase-order", label: "Purchase Order", hasPrintToggle: true },
  { id: "expense", label: "Expense", hasPrintToggle: false },
  { id: "bill", label: "Bill", hasPrintToggle: false },
  { id: "cheque", label: "Cheque", hasPrintToggle: false },
  { id: "supplier-credit", label: "Supplier credit", hasPrintToggle: false },
  { id: "credit-card-credit", label: "Credit card credit", hasPrintToggle: false },
];

export function CustomFields() {
  const { toast } = useFeedback();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Form states
  const [fieldName, setFieldName] = useState("");
  const [dataType, setDataType] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedForms, setSelectedForms] = useState<string[]>([]);
  const [printToggles, setPrintToggles] = useState<Record<string, boolean>>({});

  function toggleCategory(cat: string) {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  }

  function toggleForm(formId: string) {
    setSelectedForms((prev) =>
      prev.includes(formId) ? prev.filter((f) => f !== formId) : [...prev, formId],
    );
  }

  function togglePrint(formId: string) {
    setPrintToggles((prev) => ({ ...prev, [formId]: !prev[formId] }));
  }

  function handleSave() {
    if (!fieldName.trim()) {
      toast("Please enter a field name");
      return;
    }
    toast(`Custom field "${fieldName}" saved successfully`);
    setDrawerOpen(false);
  }

  return (
    <div className="ee-cf-container">
      <h1 className="ee-lists-title" style={{ margin: "0 0 14px" }}>
        Custom fields
      </h1>

      <div className="ee-cf-top-bar">
        <a
          href="/lists"
          onClick={(e) => {
            e.preventDefault();
            navigate("/lists");
          }}
          className="ee-back-link"
        >
          <ChevronLeft size={16} />
          <span>All lists</span>
        </a>

        <button
          type="button"
          className="ee-btn-outline-blue"
          style={{ padding: "6px 16px", fontSize: 13.5 }}
          onClick={() => toast("Feedback form opened")}
        >
          Give feedback
        </button>
      </div>

      {/* Hero section matching mockup 66 */}
      <div className="ee-cf-hero-layout">
        <div className="ee-cf-hero-text">
          <h2 className="ee-cf-main-headline">
            Make informed business decisions with custom fields
          </h2>

          <a
            href="#demo-video"
            onClick={(e) => {
              e.preventDefault();
              toast("Playing custom fields guide (3:03)…");
            }}
            className="ee-cf-video-link"
          >
            <div className="ee-play-circle-icon">
              <Play size={12} fill="#fff" color="#fff" style={{ marginLeft: 2 }} />
            </div>
            <span>See how it works (3:03)</span>
          </a>

          <p className="ee-cf-help-title">Custom fields help you:</p>

          <ul className="ee-cf-bullet-list">
            <li className="ee-cf-bullet-item">
              <div className="ee-cf-blue-dot" />
              <span>Customise forms to gather meaningful insights</span>
            </li>
            <li className="ee-cf-bullet-item">
              <div className="ee-cf-blue-dot" />
              <span>Create detailed reports to make better business decisions</span>
            </li>
            <li className="ee-cf-bullet-item">
              <div className="ee-cf-blue-dot" />
              <span>Track, search and filter data relevant to your business</span>
            </li>
          </ul>

          <button
            type="button"
            className="ee-btn-primary-blue"
            onClick={() => setDrawerOpen(true)}
          >
            + Add custom field
          </button>
        </div>

        <div className="ee-cf-hero-img-wrap">
          <img
            src="/illustrations/custom-fields-hero.png"
            alt="Business team discussing custom fields"
            className="ee-cf-hero-img"
          />
        </div>
      </div>

      {/* Drawer: Add custom field matching mockups 67 & 68 */}
      {drawerOpen && (
        <>
          <div className="ee-drawer-backdrop" onClick={() => setDrawerOpen(false)} />
          <div className="ee-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="cf-drawer-title">
            <div className="ee-drawer-header">
              <h2 id="cf-drawer-title" className="ee-drawer-title">Add custom field</h2>
              <button
                type="button"
                className="ee-drawer-close-btn"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <div className="ee-drawer-body">
              {/* Help tip matching mockup 67 */}
              <div style={{ marginBottom: 20 }}>
                <a
                  href="#how-it-works"
                  onClick={(e) => {
                    e.preventDefault();
                    toast("Playing video guide…");
                  }}
                  className="ee-cf-video-link"
                  style={{ fontSize: 14.5, marginBottom: 8 }}
                >
                  <div className="ee-play-circle-icon" style={{ width: 22, height: 22 }}>
                    <Play size={10} fill="#fff" color="#fff" style={{ marginLeft: 2 }} />
                  </div>
                  <span>See how it works (3:03)</span>
                </a>
                <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>
                  Learn how to create and use custom fields in Excel Edge ERP.{" "}
                  <a
                    href="#learn-more"
                    onClick={(e) => {
                      e.preventDefault();
                      toast("Custom fields documentation");
                    }}
                    style={{ color: "#0052ff", textDecoration: "none" }}
                  >
                    Learn more
                  </a>
                </p>
              </div>

              <div style={{ borderTop: "1px solid #e5eaf2", paddingTop: 20 }}>
                {/* Name & Data Type */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
                  <div>
                    <label className="ee-field-label">Name</label>
                    <input
                      type="text"
                      className="ee-input-text"
                      value={fieldName}
                      onChange={(e) => setFieldName(e.target.value)}
                      placeholder=""
                      autoFocus
                    />
                  </div>

                  <div>
                    <label className="ee-field-label">Data type</label>
                    <select
                      className="ee-input-select"
                      value={dataType}
                      onChange={(e) => setDataType(e.target.value)}
                    >
                      <option value="">Select type here</option>
                      <option value="Text and number">Text and number</option>
                      <option value="Number">Number</option>
                      <option value="Date">Date</option>
                      <option value="Dropdown list">Dropdown list</option>
                    </select>
                  </div>
                </div>

                {/* Select category */}
                <div style={{ marginBottom: 28 }}>
                  <label className="ee-field-label" style={{ fontSize: 15, marginBottom: 12 }}>
                    Select category
                  </label>
                  <div className="ee-cf-category-grid">
                    {CATEGORIES.map((cat) => {
                      const checked = selectedCategories.includes(cat);
                      return (
                        <label
                          key={cat}
                          className="ee-checkbox-row"
                          onClick={() => toggleCategory(cat)}
                        >
                          <div className={`ee-checkbox-box ${checked ? "checked" : ""}`}>
                            {checked && <Check size={14} strokeWidth={3} />}
                          </div>
                          <span>{cat}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Select forms matching mockup 68 */}
                <div>
                  <label className="ee-field-label" style={{ fontSize: 15, marginBottom: 12 }}>
                    Select forms
                  </label>

                  <div className="ee-cf-forms-list">
                    {FORMS_LIST.map((form) => {
                      const checked = selectedForms.includes(form.id);
                      const printOn = Boolean(printToggles[form.id]);

                      return (
                        <div key={form.id} className="ee-cf-form-row">
                          <label
                            className="ee-checkbox-row"
                            onClick={() => toggleForm(form.id)}
                          >
                            <div className={`ee-checkbox-box ${checked ? "checked" : ""}`}>
                              {checked && <Check size={14} strokeWidth={3} />}
                            </div>
                            <span>{form.label}</span>
                          </label>

                          {form.hasPrintToggle && (
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <button
                                type="button"
                                className={`ee-switch-toggle ${printOn ? "on" : ""}`}
                                onClick={() => togglePrint(form.id)}
                                role="switch"
                                aria-checked={printOn}
                              >
                                <div className="ee-switch-toggle-knob" />
                              </button>
                              <span style={{ fontSize: 13, color: "#64748b" }}>Print on form</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="ee-drawer-footer">
              <button
                type="button"
                className="ee-btn-ghost-cancel"
                onClick={() => setDrawerOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ee-btn-primary-blue"
                onClick={handleSave}
              >
                Save
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
