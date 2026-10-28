import { Download, Eye, FileSpreadsheet, HelpCircle, MessageSquarePlus, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { navigate } from "../lib/router";

const STEPS = ["Upload", "Map data", "Import"] as const;

export function ImportSuppliers() {
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState("");
  const [sheetConnected, setSheetConnected] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const canNext = step === 0 ? Boolean(fileName) || sheetConnected : true;

  function close() {
    navigate("/suppliers");
  }

  return (
    <div className="ee-import">
      <header className="ee-import-top">
        <div className="ee-import-brand">
          <img src="/logo.jpeg" alt="" width={28} height={28} />
          <span>Excel Edge ERP</span>
          <span className="ee-import-sep" />
          <strong>Import suppliers</strong>
        </div>
        <div className="ee-import-top-actions">
          <button type="button" className="ee-settings-top-link">
            <HelpCircle size={16} strokeWidth={1.5} /> Help
          </button>
          <button type="button" className="ee-icon-btn" aria-label="Close" onClick={close}>
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      <div className="ee-import-steps" aria-label="Import progress">
        {STEPS.map((label, i) => (
          <div key={label} className={`ee-import-step ${i === step ? "on" : ""} ${i < step ? "done" : ""}`}>
            {i > 0 && <span className="ee-import-step-line" aria-hidden="true" />}
            <span className="ee-import-step-num">{i + 1}</span>
            <span className="ee-import-step-label">{label}</span>
          </div>
        ))}
      </div>

      <main className="ee-import-main">
        {step === 0 && (
          <>
            <div className="ee-import-intro">
              <div>
                <h1>First time importing suppliers?</h1>
                <ul>
                  <li>All your supplier information must be in one file</li>
                  <li>The top row of your file must contain a header title for each column of information</li>
                  <li>
                    <strong>Supplier name</strong> is the only required field
                  </li>
                </ul>
              </div>
              <button type="button" className="btn ee-btn-outline-blue btn-sm">
                <MessageSquarePlus size={14} strokeWidth={1.5} /> Feedback
              </button>
            </div>

            <div className="ee-import-cards">
              <section className="ee-import-card">
                <div className="ee-import-card-icon blue">
                  <Upload size={22} strokeWidth={1.5} />
                </div>
                <h2>Upload from your computer</h2>
                <div className="ee-import-file-row">
                  <input className="input" readOnly value={fileName} placeholder="No file selected" aria-label="Selected file" />
                  <button type="button" className="btn ee-btn-outline-blue" onClick={() => inputRef.current?.click()}>
                    Browse
                  </button>
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    hidden
                    onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
                  />
                </div>
                <button type="button" className="ee-link-btn" style={{ padding: 0 }}>
                  <Download size={14} strokeWidth={1.5} /> Download a sample file
                </button>
              </section>

              <section className="ee-import-card">
                <div className="ee-import-card-icon green">
                  <FileSpreadsheet size={22} strokeWidth={1.5} />
                </div>
                <h2>Select Google Sheet</h2>
                <div className="ee-import-file-row">
                  <input
                    className="input"
                    readOnly
                    value={sheetConnected ? "Google Sheets connected" : ""}
                    placeholder="Connect Google Sheets"
                    aria-label="Google Sheets"
                  />
                  <button
                    type="button"
                    className="btn ee-btn-outline-blue"
                    onClick={() => setSheetConnected(true)}
                  >
                    Connect
                  </button>
                </div>
                <button type="button" className="ee-link-btn" style={{ padding: 0 }}>
                  <Eye size={14} strokeWidth={1.5} /> Preview a sample
                </button>
              </section>
            </div>
          </>
        )}

        {step === 1 && (
          <div className="ee-import-panel">
            <h1>Map your columns</h1>
            <p className="ee-settings-hint">Match each column in your file to a supplier field. Supplier name is required.</p>
            <table className="ee-manage-table">
              <thead>
                <tr>
                  <th>Your column</th>
                  <th>Maps to</th>
                </tr>
              </thead>
              <tbody>
                {["Name", "Email", "Phone", "Address"].map((col) => (
                  <tr key={col}>
                    <td>{col}</td>
                    <td>
                      <select className="input" defaultValue={col === "Name" ? "displayName" : ""}>
                        <option value="">Skip</option>
                        <option value="displayName">Supplier display name</option>
                        <option value="email">Email</option>
                        <option value="phone">Phone</option>
                        <option value="address">Address</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {step === 2 && (
          <div className="ee-import-panel">
            <h1>Ready to import</h1>
            <p className="ee-settings-hint">
              {fileName || (sheetConnected ? "Google Sheet" : "Your file")} will be imported into Suppliers.
            </p>
            <ul className="ee-cust-bullets">
              <li>Existing suppliers with the same name are skipped</li>
              <li>You can review results after the import finishes</li>
            </ul>
          </div>
        )}
      </main>

      <footer className="ee-import-foot">
        <button type="button" className="btn ee-btn-outline-blue" onClick={close}>
          Cancel
        </button>
        <div className="ee-import-foot-right">
          {step > 0 && (
            <button type="button" className="btn ee-btn-outline-blue" onClick={() => setStep((s) => s - 1)}>
              ← Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn-primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
              Next →
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                navigate("/suppliers");
              }}
            >
              Import
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
