import {
  Building2,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Info,
  MessageSquarePlus,
  Minus,
  Plus,
  Printer,
  Sparkles,
  Type,
  X,
} from "lucide-react";
import { useState } from "react";
import { navigate, useLocation } from "../lib/router";
import { INVOICE_STYLE_MENU } from "../lib/users-dummy";

const ICONS = {
  template: FileText,
  logo: ImageIcon,
  colours: Sparkles,
  font: Type,
  bank: Building2,
  print: Printer,
  stamp: Sparkles,
} as const;

export function EditInvoiceStyle() {
  const { query } = useLocation();
  const type = query.get("type") ?? "Invoice";
  const [tab, setTab] = useState<"design" | "content" | "emails">("design");
  const [name, setName] = useState(`My ${type.toUpperCase()} Template - 10-17 (4172)`);
  const [zoom, setZoom] = useState(100);

  return (
    <div className="ee-style-editor">
      <header className="ee-style-editor-top">
        <div className="ee-style-editor-brand">
          <img src="/logo.jpeg" alt="" width={28} height={28} />
          <span>Excel Edge ERP</span>
          <span className="ee-style-editor-sep" />
          <strong>Edit invoice style</strong>
        </div>
        <div className="ee-style-editor-top-actions">
          <button type="button" className="ee-settings-top-link">
            <MessageSquarePlus size={16} strokeWidth={1.5} /> Give feedback
          </button>
          <button type="button" className="ee-icon-btn" aria-label="Close" onClick={() => navigate("/settings/form-styles")}>
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      <div className="ee-style-editor-body">
        <aside className="ee-style-editor-side">
          <nav className="ee-style-editor-tabs">
            {(["design", "content", "emails"] as const).map((t) => (
              <button key={t} type="button" className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                {t[0]!.toUpperCase() + t.slice(1)}
              </button>
            ))}
          </nav>

          {tab === "design" && (
            <>
              <label className="ee-style-editor-field">
                Template name
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <ul className="ee-style-editor-menu">
                {INVOICE_STYLE_MENU.map((item) => {
                  const Icon = ICONS[item.id as keyof typeof ICONS] ?? FileText;
                  return (
                    <li key={item.id}>
                      <button type="button">
                        <span className={`ee-style-editor-icon tone-${item.tone}`}>
                          <Icon size={18} strokeWidth={1.5} />
                        </span>
                        <span>
                          <strong>
                            {item.title}
                            {"badge" in item && item.badge ? <span className="ee-settings-new">{item.badge}</span> : null}
                          </strong>
                          <em>{item.subtitle}</em>
                        </span>
                        <ChevronRight size={16} strokeWidth={1.5} />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="ee-style-editor-note">
                <Info size={14} strokeWidth={1.75} aria-hidden="true" />
                Images and signatures included on shared invoices may be visible to recipients and others with access.
              </p>
            </>
          )}

          {tab !== "design" && (
            <p className="ee-settings-hint" style={{ padding: "12px 4px" }}>
              {tab === "content" ? "Content options for this template will appear here." : "Email options for this template will appear here."}
            </p>
          )}
        </aside>

        <section className="ee-style-editor-preview">
          <div className="ee-style-editor-preview-head">
            <h2>Live preview</h2>
            <div className="ee-style-editor-zoom">
              <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(50, z - 10))}>
                <Minus size={14} />
              </button>
              <span>{zoom}%</span>
              <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(150, z + 10))}>
                <Plus size={14} />
              </button>
            </div>
          </div>
          <div className="ee-style-editor-paper-wrap">
            <article className="ee-style-editor-paper" style={{ transform: `scale(${zoom / 100})` }}>
              <header>
                <div>
                  <strong>EXCEL EDGE CPA</strong>
                  <div>Kigali, Rwanda</div>
                  <div>+250 788 000 000</div>
                  <div>hello@exceledgecpa.com</div>
                  <div>TIN 122714026</div>
                </div>
                <div className="ee-style-editor-inv-title">INVOICE</div>
              </header>
              <div className="ee-style-editor-meta">
                <div>
                  <div className="label">Bill to</div>
                  <strong>Sample customer</strong>
                  <div>Kigali, Rwanda</div>
                </div>
                <dl>
                  <div>
                    <dt>Invoice</dt>
                    <dd>INV-001</dd>
                  </div>
                  <div>
                    <dt>Date</dt>
                    <dd>17 Oct 2026</dd>
                  </div>
                  <div>
                    <dt>Terms</dt>
                    <dd>Net 30</dd>
                  </div>
                  <div>
                    <dt>Due date</dt>
                    <dd>16 Nov 2026</dd>
                  </div>
                </dl>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Activity</th>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Rate</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>17 Oct 2026</td>
                    <td>Consulting</td>
                    <td>Advisory services</td>
                    <td>10</td>
                    <td>45,000</td>
                    <td>450,000</td>
                  </tr>
                  <tr>
                    <td>17 Oct 2026</td>
                    <td>Training</td>
                    <td>Team workshop</td>
                    <td>5</td>
                    <td>45,000</td>
                    <td>225,000</td>
                  </tr>
                </tbody>
              </table>
              <div className="ee-style-editor-due">
                <span>Balance due</span>
                <strong>RWF 675,000</strong>
              </div>
              <footer>
                <span>Sample preview</span>
                <span>Page 1 of 1</span>
              </footer>
            </article>
          </div>
        </section>
      </div>

      <footer className="ee-style-editor-foot">
        <button type="button" className="btn ee-btn-outline-blue" onClick={() => navigate("/settings/form-styles")}>
          Cancel
        </button>
        <div className="ee-style-editor-foot-right">
          <button type="button" className="btn ee-btn-outline-blue">
            Preview PDF
          </button>
          <button type="button" className="btn btn-primary" onClick={() => navigate("/settings/form-styles")}>
            Done
          </button>
        </div>
      </footer>
    </div>
  );
}
