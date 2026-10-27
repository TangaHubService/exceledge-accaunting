import {
  Check,
  ChevronDown,
  HelpCircle,
  List,
  Search,
  Settings,
  X,
} from "lucide-react";
import { useState } from "react";
import { useFeedback } from "../components/feedback";
import { Link } from "../lib/router";

export function BankingRules() {
  const { toast } = useFeedback();
  const [activeTab, setActiveTab] = useState<"bank" | "integration">("bank");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [ruleTypeFilter, setRuleTypeFilter] = useState("All rules");

  // Drawer form state matching mockup 70
  const [priority, setPriority] = useState("1");
  const [autoPost, setAutoPost] = useState(true);
  const [txnType, setTxnType] = useState("Expense");
  const [category, setCategory] = useState("");
  const [payee, setPayee] = useState("");
  const [bankMemo, setBankMemo] = useState("");
  const [keepExistingMemo, setKeepExistingMemo] = useState(false);

  function handleSaveRule() {
    toast("Bank rule saved successfully");
    setDrawerOpen(false);
  }

  return (
    <div className="ee-rules-container">
      {/* Top breadcrumb matching mockup 69 */}
      <div className="ee-rules-top-bar">
        <span>Accounting</span>
        <span style={{ margin: "0 6px" }}>/</span>
        <span style={{ color: "#0c1c38", fontWeight: 500 }}>Rules</span>
      </div>

      {/* Header row */}
      <div className="ee-rules-header-row">
        <h1 className="ee-lists-title" style={{ margin: 0 }}>
          Rules
        </h1>

        <div className="ee-rules-header-right">
          <a
            href="#learn-more"
            onClick={(e) => {
              e.preventDefault();
              toast("Opening rules guide…");
            }}
            className="ee-rules-learn-more"
          >
            Learn more
          </a>

          <div className="ee-split-btn">
            <button
              type="button"
              className="ee-split-btn-main"
              onClick={() => setDrawerOpen(true)}
            >
              New rule
            </button>
            <button
              type="button"
              className="ee-split-btn-caret"
              onClick={() => setDrawerOpen(true)}
              aria-label="New rule options"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Tabs matching mockup 69 */}
      <div className="ee-rules-tabs">
        <button
          type="button"
          className={`ee-rules-tab ${activeTab === "bank" ? "active" : ""}`}
          onClick={() => setActiveTab("bank")}
        >
          Bank rules
        </button>
        <button
          type="button"
          className={`ee-rules-tab ${activeTab === "integration" ? "active" : ""}`}
          onClick={() => setActiveTab("integration")}
        >
          Integration rules
        </button>
      </div>

      {/* Filter toolbar matching mockup 69 */}
      <div className="ee-table-toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="ee-search-input-wrap">
            <Search size={16} className="ee-search-icon" />
            <input
              type="text"
              className="ee-search-input"
              placeholder="Search by name or conditions"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: 340 }}
            />
          </div>

          <div style={{ position: "relative" }}>
            <select
              className="ee-input-select"
              style={{ height: 38, width: 140, padding: "6px 12px", fontSize: 14 }}
              value={ruleTypeFilter}
              onChange={(e) => setRuleTypeFilter(e.target.value)}
            >
              <option value="All rules">All rules</option>
              <option value="Money in">Money in</option>
              <option value="Money out">Money out</option>
              <option value="Active">Active</option>
              <option value="Disabled">Disabled</option>
            </select>
          </div>
        </div>

        <button
          type="button"
          className="ee-icon-btn"
          onClick={() => toast("Rules table display settings")}
          title="Table settings"
        >
          <Settings size={18} />
        </button>
      </div>

      {/* Table matching mockup 69 */}
      <div className="ee-mockup-table-wrap">
        <table className="ee-mockup-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <input type="checkbox" aria-label="Select all rules" />
              </th>
              <th>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span>Priority</span>
                  <HelpCircle size={13} color="#64748b" />
                  <span style={{ fontSize: 10 }}>▲</span>
                </div>
              </th>
              <th>Rule name</th>
              <th>Applied to</th>
              <th>Conditions</th>
              <th>Settings</th>
              <th>Auto-post</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr className="ee-table-empty-row">
              <td colSpan={9}>
                We couldn&apos;t find rules that match your search. Expand your search and try again.
              </td>
            </tr>
          </tbody>
        </table>

        <div className="ee-table-pagination">
          <span>0–0 of 0 items</span>
          <button type="button" className="ee-page-btn" disabled>
            &lt;
          </button>
          <div className="ee-page-number-box">1</div>
          <button type="button" className="ee-page-btn" disabled>
            &gt;
          </button>
        </div>
      </div>

      {/* Drawer: Create rule matching mockup 70 */}
      {drawerOpen && (
        <>
          <div className="ee-drawer-backdrop" onClick={() => setDrawerOpen(false)} />
          <div className="ee-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="rule-drawer-title">
            <div className="ee-drawer-header">
              <h2 id="rule-drawer-title" className="ee-drawer-title">Create rule</h2>
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
              {/* Top actions matching mockup 70 */}
              <div className="ee-rule-drawer-top-actions">
                <a
                  href="#add-condition"
                  onClick={(e) => {
                    e.preventDefault();
                    toast("Condition added");
                  }}
                  style={{ color: "#0052ff", fontSize: 14, fontWeight: 500, textDecoration: "none" }}
                >
                  + Add a condition
                </a>

                <button
                  type="button"
                  className="ee-btn-test-rule"
                  onClick={() => toast("Testing rule against recent transactions…")}
                >
                  Test rule
                </button>
              </div>

              {/* Priority row matching mockup 70 */}
              <div className="ee-priority-row">
                <div style={{ display: "flex", alignItems: "center", fontSize: 14, color: "#1e293b", fontWeight: 600 }}>
                  <span>Priority</span>
                  <input
                    type="number"
                    className="ee-priority-input"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  />
                  <span>of 1</span>
                </div>

                <a
                  href="#preview"
                  onClick={(e) => {
                    e.preventDefault();
                    toast("Previewing matching transactions…");
                  }}
                  className="ee-preview-link"
                >
                  <List size={16} />
                  <span>Preview</span>
                </a>
              </div>

              {/* Criteria section matching mockup 70 */}
              <h3 className="ee-criteria-section-title">
                For transactions that meet these criteria...
              </h3>

              <div className="ee-criteria-auto-row">
                <select
                  className="ee-input-select"
                  style={{ width: "auto", minWidth: 160 }}
                  defaultValue=""
                >
                  <option value="">Add attributes</option>
                  <option value="amount">Amount</option>
                  <option value="bank-account">Bank account</option>
                  <option value="reference">Reference</option>
                </select>

                <span style={{ fontSize: 14, color: "#475569" }}>and</span>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: "#1e293b" }}>Auto-post</span>
                  <button
                    type="button"
                    className={`ee-switch-toggle ${autoPost ? "on" : ""}`}
                    onClick={() => setAutoPost((p) => !p)}
                    role="switch"
                    aria-checked={autoPost}
                  >
                    <div className="ee-switch-toggle-knob" />
                  </button>
                </div>
              </div>

              {/* Transaction type */}
              <div style={{ marginBottom: 18 }}>
                <label className="ee-field-label">Transaction type</label>
                <select
                  className="ee-input-select"
                  value={txnType}
                  onChange={(e) => setTxnType(e.target.value)}
                >
                  <option value="Expense">Expense</option>
                  <option value="Deposit">Deposit</option>
                  <option value="Transfer">Transfer</option>
                </select>
              </div>

              {/* Category */}
              <div style={{ marginBottom: 18 }}>
                <label className="ee-field-label">Category</label>
                <select
                  className="ee-input-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">Select a category</option>
                  <option value="Advertising">Advertising</option>
                  <option value="Office Supplies">Office Supplies</option>
                  <option value="Rent">Rent</option>
                  <option value="Meals & Entertainment">Meals &amp; Entertainment</option>
                  <option value="Travel">Travel</option>
                  <option value="Utilities">Utilities</option>
                </select>
                <div style={{ marginTop: 6 }}>
                  <a
                    href="#add-split"
                    onClick={(e) => {
                      e.preventDefault();
                      toast("Split row added");
                    }}
                    style={{ color: "#0052ff", fontSize: 13, textDecoration: "none", fontWeight: 500 }}
                  >
                    + Add a split
                  </a>
                </div>
              </div>

              {/* Payee */}
              <div style={{ marginBottom: 18 }}>
                <label className="ee-field-label">Payee</label>
                <select
                  className="ee-input-select"
                  value={payee}
                  onChange={(e) => setPayee(e.target.value)}
                >
                  <option value="">(Recommended)</option>
                  <option value="MTN Rwanda">MTN Rwanda</option>
                  <option value="Airtel Rwanda">Airtel Rwanda</option>
                  <option value="RRA Tax Authority">RRA Tax Authority</option>
                  <option value="Bank of Kigali Charges">Bank of Kigali Charges</option>
                  <option value="Office World Kigali">Office World Kigali</option>
                </select>
              </div>

              {/* Replace bank memo */}
              <div style={{ marginBottom: 20 }}>
                <label className="ee-field-label">Replace bank memo</label>
                <input
                  type="text"
                  className="ee-input-text"
                  placeholder="(Optional)"
                  value={bankMemo}
                  onChange={(e) => setBankMemo(e.target.value)}
                />
                <div style={{ marginTop: 10 }}>
                  <label
                    className="ee-checkbox-row"
                    onClick={() => setKeepExistingMemo((k) => !k)}
                    style={{ fontSize: 13.5 }}
                  >
                    <div className={`ee-checkbox-box ${keepExistingMemo ? "checked" : ""}`}>
                      {keepExistingMemo && <Check size={14} strokeWidth={3} />}
                    </div>
                    <span>Also keep existing bank memo.</span>
                  </label>
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
                onClick={handleSaveRule}
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
