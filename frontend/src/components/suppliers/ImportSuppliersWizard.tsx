import { Download, Eye, HelpCircle, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { useFeedback } from "../feedback";
import { navigate } from "../../lib/router";

type Step = 1 | 2 | 3;

export function ImportSuppliersWizard({ onClose }: { onClose?: () => void }) {
  const { toast } = useFeedback();
  const [step, setStep] = useState<Step>(1);
  const [fileName, setFileName] = useState("");
  const [sheetConnected, setSheetConnected] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canNext = Boolean(fileName) || sheetConnected;

  function close() {
    if (onClose) onClose();
    else navigate("/suppliers");
  }

  return (
    <div className="ee-import">
      <header className="ee-import-top">
        <div className="ee-import-brand">
          <img src="/logo.jpeg" alt="" width={28} height={28} />
          <span>Excel Edge ERP</span>
          <span className="ee-style-editor-sep" />
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

      <nav className="ee-import-steps" aria-label="Import steps">
        {(
          [
            [1, "Upload"],
            [2, "Map data"],
            [3, "Import"],
          ] as const
        ).map(([n, label]) => (
          <div key={n} className={`ee-import-step ${step === n ? "on" : ""} ${step > n ? "done" : ""}`}>
            <span className="ee-import-step-num">{n}</span>
            <span>{label}</span>
          </div>
        ))}
      </nav>

      <main className="ee-import-main">
        {step === 1 && (
          <>
            <div className="ee-import-intro">
              <div>
                <h2>First time importing suppliers?</h2>
                <ul>
                  <li>All supplier information must be in one file.</li>
                  <li>The top row of the file must contain a header title for each column.</li>
                  <li>
                    <strong>Supplier name</strong> is the only required field.
                  </li>
                </ul>
              </div>
              <button type="button" className="btn ee-btn-outline-blue btn-sm" onClick={() => toast("Thanks for your feedback")}>
                Feedback
              </button>
            </div>

            <div className="ee-import-cards">
              <section className="ee-import-card">
                <div className="ee-import-card-icon upload">
                  <Upload size={22} strokeWidth={1.5} />
                </div>
                <h3>Upload from your computer</h3>
                <div className="ee-import-file-row">
                  <input className="input" readOnly value={fileName} placeholder="" aria-label="Selected file" />
                  <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()}>
                    Browse
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setFileName(f.name);
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="ee-link-btn"
                  onClick={() => toast("Sample supplier CSV downloaded (preview)")}
                >
                  <Download size={14} strokeWidth={1.5} aria-hidden="true" /> Download a sample file
                </button>
              </section>

              <section className="ee-import-card">
                <div className="ee-import-card-icon sheets">
                  <span aria-hidden="true">Sheets</span>
                </div>
                <h3>Select Google Sheet</h3>
                <div className="ee-import-file-row">
                  <input
                    className="input"
                    readOnly
                    value={sheetConnected ? "Connected · Sample suppliers" : ""}
                    placeholder="Connect Google Sheets"
                    aria-label="Google Sheet"
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setSheetConnected(true);
                      toast("Google Sheets connected (preview)");
                    }}
                  >
                    Connect
                  </button>
                </div>
                <button type="button" className="ee-link-btn" onClick={() => toast("Opening sample preview")}>
                  <Eye size={14} strokeWidth={1.5} aria-hidden="true" /> Preview a sample
                </button>
              </section>
            </div>
          </>
        )}

        {step === 2 && (
          <div className="ee-import-map">
            <h2>Map your columns</h2>
            <p className="ee-settings-hint">Match each column in your file to a supplier field.</p>
            <table className="ee-manage-table">
              <thead>
                <tr>
                  <th>Your column</th>
                  <th>Maps to</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Supplier name", "Supplier display name"],
                  ["Email", "Email"],
                  ["Phone", "Phone number"],
                  ["Address", "Street address 1"],
                ].map(([from, to]) => (
                  <tr key={from}>
                    <td>{from}</td>
                    <td>
                      <strong>{to}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {step === 3 && (
          <div className="ee-import-map">
            <h2>Ready to import</h2>
            <p className="ee-settings-hint">
              {fileName || "Google Sheet"} will create supplier records. You can review them on the Suppliers list when
              done.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                toast("Suppliers imported (preview)");
                close();
              }}
            >
              Import suppliers
            </button>
          </div>
        )}
      </main>

      <footer className="ee-import-foot">
        <button type="button" className="btn ee-btn-outline-blue" onClick={close}>
          Cancel
        </button>
        <div className="ee-import-foot-right">
          {step > 1 && (
            <button type="button" className="btn ee-btn-outline-blue" onClick={() => setStep((s) => (s - 1) as Step)}>
              Back
            </button>
          )}
          {step < 3 && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={step === 1 && !canNext}
              onClick={() => setStep((s) => (s + 1) as Step)}
            >
              Next →
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
