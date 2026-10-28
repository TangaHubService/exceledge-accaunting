import {
  Check,
  ChevronDown,
  ExternalLink,
  List,
  Maximize2,
  MessageSquare,
  Printer,
  Search,
  Settings,
  X,
} from "lucide-react";
import { useState } from "react";
import { useFeedback } from "../components/feedback";
import { Link, navigate } from "../lib/router";

const TRANSACTION_TYPES = [
  "Bill",
  "Non-Posting Charge",
  "Cheque",
  "Non-Posting Credit",
  "Credit Card Credit",
  "Credit Note",
  "Deposit",
  "Estimate",
  "Expense",
  "Invoice",
  "Journal Entry",
  "Refund",
  "Sales Receipt",
  "Transfer",
];

export function RecurringTxnTypes() {
  const { toast } = useFeedback();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedType, setSelectedType] = useState("Bill");
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");

  function handleCreateTemplate() {
    setModalOpen(false);
    toast(`Creating recurring template for ${selectedType}…`);
  }

  return (
    <div className="ee-rec-container">
      {/* Top breadcrumb & quick links matching mockup 63 & 64 */}
      <div className="ee-rec-top-bar">
        <div style={{ fontSize: 14, color: "#64748b" }}>
          <span>Accounting</span>
          <span style={{ margin: "0 6px" }}>/</span>
          <span style={{ color: "#0c1c38", fontWeight: 500 }}>Recurring transactions</span>
        </div>

        <div className="ee-rec-top-actions">
          <a
            href="/lists"
            onClick={(e) => {
              e.preventDefault();
              navigate("/lists");
            }}
            className="ee-rec-top-link"
          >
            <List size={15} />
            <span>All lists</span>
          </a>

          <button
            type="button"
            className="ee-rec-top-link"
            style={{ background: "none", border: "none", padding: 0 }}
            onClick={() => toast("Feedback dialog opened")}
          >
            <MessageSquare size={15} />
            <span>Feedback</span>
          </button>

          <button
            type="button"
            className="ee-icon-btn"
            style={{ padding: 2 }}
            onClick={() => window.open(window.location.href, "_blank")}
            title="Open in new window"
          >
            <ExternalLink size={15} />
          </button>

          <button
            type="button"
            className="ee-icon-btn"
            style={{ padding: 2 }}
            onClick={() => {
              if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
              } else {
                document.exitFullscreen().catch(() => {});
              }
            }}
            title="Fullscreen"
          >
            <Maximize2 size={15} />
          </button>
        </div>
      </div>

      {/* Header row */}
      <div className="ee-rec-header-row">
        <h1 className="ee-lists-title" style={{ margin: 0 }}>
          Recurring transactions
        </h1>

        <div className="ee-rec-header-actions">
          <button
            type="button"
            className="ee-btn-reminder-list"
            onClick={() => toast("Reminder list filter options")}
          >
            <span>Reminder list</span>
            <ChevronDown size={14} />
          </button>

          <button
            type="button"
            className="ee-btn-primary-blue"
            onClick={() => setModalOpen(true)}
          >
            New
          </button>
        </div>
      </div>

      {/* Toolbar row with search & settings */}
      <div className="ee-table-toolbar">
        <div className="ee-search-input-wrap">
          <Search size={16} className="ee-search-icon" />
          <input
            type="text"
            className="ee-search-input"
            placeholder="Filter by name"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
        </div>

        <div className="ee-toolbar-icons">
          <button
            type="button"
            className="ee-icon-btn"
            onClick={() => window.print()}
            title="Print"
          >
            <Printer size={18} />
          </button>
          <button
            type="button"
            className="ee-icon-btn"
            onClick={() => toast("Table display settings")}
            title="Table settings"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      {/* Table matching mockup 63 & 64 */}
      <div className="ee-mockup-table-wrap">
        <table className="ee-mockup-table">
          <thead>
            <tr>
              <th style={{ width: "20%" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span>TEMPLATE NAME</span>
                  <span style={{ fontSize: 10 }}>▲</span>
                </div>
              </th>
              <th>TYPE</th>
              <th>INTERVAL</th>
              <th>PREVIOUS DATE</th>
              <th>NEXT DATE</th>
              <th>CUSTOMER/SUPPLIER</th>
              <th>AMOUNT</th>
              <th>ACTION</th>
            </tr>
          </thead>
          <tbody>
            <tr className="ee-table-empty-row">
              <td colSpan={8}>0 results matching the criteria.</td>
            </tr>
          </tbody>
        </table>

        <div className="ee-table-pagination">
          <span>0 results</span>
          <button type="button" className="ee-page-btn" disabled>
            &lt;
          </button>
          <button type="button" className="ee-page-btn" disabled>
            &gt;
          </button>
        </div>
      </div>

      {/* Modal dialog matching mockups 63 & 64 */}
      {modalOpen && (
        <div className="ee-modal-backdrop" onClick={() => setModalOpen(false)}>
          <div
            className="ee-modal-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="ee-modal-top">
              <h2 id="modal-title" className="ee-modal-title">
                Select transaction type
              </h2>
              <button
                type="button"
                className="ee-drawer-close-btn"
                onClick={() => setModalOpen(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <p className="ee-modal-sub">Select the type of template to create.</p>

            <div style={{ marginBottom: 6 }}>
              <label className="ee-field-label">Transaction type</label>
            </div>

            <div className="ee-modal-menu-wrap">
              <div
                className="ee-modal-select-trigger"
                onClick={() => setTypeDropdownOpen((o) => !o)}
                role="button"
                tabIndex={0}
              >
                <span>{selectedType}</span>
                <ChevronDown size={16} />
              </div>

              {typeDropdownOpen && (
                <div className="ee-modal-dropdown-list">
                  {TRANSACTION_TYPES.map((t) => (
                    <div
                      key={t}
                      className={`ee-modal-dropdown-item ${t === selectedType ? "selected" : ""}`}
                      onClick={() => {
                        setSelectedType(t);
                        setTypeDropdownOpen(false);
                      }}
                    >
                      {t === selectedType && <Check size={14} strokeWidth={3} />}
                      <span style={{ paddingLeft: t === selectedType ? 0 : 20 }}>{t}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="ee-modal-actions">
              <button
                type="button"
                className="ee-btn-ghost-cancel"
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ee-btn-primary-blue"
                onClick={handleCreateTemplate}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
