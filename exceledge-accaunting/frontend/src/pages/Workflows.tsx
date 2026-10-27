import {
  ArrowUpDown,
  BarChart3,
  BookOpen,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  CreditCard,
  FileText,
  Filter,
  type LucideIcon,
  MessageSquare,
  Play,
  Plus,
  Receipt,
  Search,
  Send,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useFeedback } from "../components/feedback";
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from "../lib/ribbon-dummy";
import { INITIAL_MY_WORKFLOWS, type MyWorkflow } from "../lib/tools-dummy";

const SW = 1.5;

const ICONS: Record<WorkflowTemplate["icon"], LucideIcon> = {
  file: FileText,
  chart: BarChart3,
  clock: Clock,
  bank: Building2,
  user: UserRound,
  plane: Send,
  bill: Receipt,
  card: CreditCard,
  building: Building2,
  check: CheckCircle2,
};

type Tab = "templates" | "mine" | "history";

export function Workflows() {
  const { toast } = useFeedback();
  const [tab, setTab] = useState<Tab>("mine"); // Default to 'mine' matching Mockup 71!
  const [query, setQuery] = useState("");
  const [workflows, setWorkflows] = useState<MyWorkflow[]>(INITIAL_MY_WORKFLOWS);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [customDrawerOpen, setCustomDrawerOpen] = useState(false);
  const [filterType, setFilterType] = useState<string>("all");
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  // Custom workflow form state
  const [wfName, setWfName] = useState("");
  const [wfTxnType, setWfTxnType] = useState("Invoice");
  const [wfType, setWfType] = useState("Reminder");

  const filteredMyWorkflows = useMemo(() => {
    let list = workflows;
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (w) =>
          w.name.toLowerCase().includes(q) ||
          w.transactionType.toLowerCase().includes(q) ||
          w.workflowType.toLowerCase().includes(q),
      );
    }
    if (filterType !== "all") {
      list = list.filter((w) => w.transactionType.toLowerCase() === filterType.toLowerCase());
    }
    return list;
  }, [workflows, query, filterType]);

  const templates = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return WORKFLOW_TEMPLATES;
    return WORKFLOW_TEMPLATES.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [query]);

  function toggleWorkflow(id: string) {
    setWorkflows((prev) =>
      prev.map((w) => {
        if (w.id === id) {
          const next = !w.enabled;
          toast(`Workflow "${w.name}" ${next ? "enabled" : "disabled"}.`);
          return { ...w, enabled: next };
        }
        return w;
      }),
    );
  }

  function runWorkflow(w: MyWorkflow) {
    setActiveMenuId(null);
    toast(`Running "${w.name}"... Sent successfully.`);
  }

  function deleteWorkflow(id: string) {
    setActiveMenuId(null);
    setWorkflows((prev) => prev.filter((w) => w.id !== id));
    toast("Workflow deleted.");
  }

  function handleCreateWorkflow(e: React.FormEvent) {
    e.preventDefault();
    if (!wfName.trim()) return;
    const newWf: MyWorkflow = {
      id: `wf-${Date.now()}`,
      name: wfName.trim(),
      transactionType: wfTxnType,
      workflowType: wfType,
      createdOn: new Date().toLocaleDateString("en-US"),
      createdBy: "System Administration",
      lastUpdatedBy: "System Administration",
      updatedOn: new Date().toLocaleDateString("en-US"),
      enabled: true,
    };
    setWorkflows([newWf, ...workflows]);
    setCustomDrawerOpen(false);
    setWfName("");
    toast(`Workflow "${newWf.name}" created and activated.`);
  }

  return (
    <div className="ee-tools-page">
      {/* Header matching Mockup 71 */}
      <header className="ee-wf-header">
        <h1 className="ee-wf-title">Workflow automation</h1>
        <div className="ee-wf-header-links">
          <button
            type="button"
            className="ee-wf-link-btn"
            onClick={() => toast("Learn about workflows guide will open in documentation.")}
          >
            <BookOpen size={16} strokeWidth={SW} />
            Learn about workflows
          </button>
          <button
            type="button"
            className="ee-wf-link-btn"
            onClick={() => toast("Thank you for your feedback!")}
          >
            <MessageSquare size={16} strokeWidth={SW} />
            Give feedback
          </button>
        </div>
      </header>

      {/* Navigation tabs */}
      <div className="ee-wf-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "templates"}
          className={`ee-wf-tab ${tab === "templates" ? "active" : ""}`}
          onClick={() => setTab("templates")}
        >
          Templates
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "mine"}
          className={`ee-wf-tab ${tab === "mine" ? "active" : ""}`}
          onClick={() => setTab("mine")}
        >
          My workflows
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "history"}
          className={`ee-wf-tab ${tab === "history" ? "active" : ""}`}
          onClick={() => setTab("history")}
        >
          History
        </button>
      </div>

      {/* Toolbar */}
      <div className="ee-wf-toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="ee-wf-search-wrap">
            <Search size={16} strokeWidth={SW} className="ee-wf-search-icon" />
            <input
              type="search"
              className="ee-wf-search-input"
              placeholder={tab === "mine" ? "Search by workflow name" : "Search templates..."}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="ee-wf-filter-btn"
              title="Filter workflows"
              onClick={() => setShowFilterDropdown((prev) => !prev)}
            >
              <Filter size={16} strokeWidth={SW} />
            </button>
            {showFilterDropdown && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  marginTop: 6,
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                  padding: 8,
                  zIndex: 50,
                  minWidth: 160,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, padding: "4px 8px", color: "#64748b" }}>
                  TRANSACTION TYPE
                </div>
                {["all", "Invoice", "Bill", "Estimate"].map((t) => (
                  <button
                    key={t}
                    type="button"
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      background: filterType === t ? "#eff6ff" : "none",
                      border: "none",
                      padding: "6px 8px",
                      borderRadius: 4,
                      fontSize: 13,
                      color: filterType === t ? "#0052ff" : "#1e293b",
                      cursor: "pointer",
                    }}
                    onClick={() => {
                      setFilterType(t);
                      setShowFilterDropdown(false);
                    }}
                  >
                    {t === "all" ? "All types" : t}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          className="ee-btn-blue"
          onClick={() => setCustomDrawerOpen(true)}
        >
          <Plus size={16} strokeWidth={2.5} />
          Custom workflow
        </button>
      </div>

      {/* TAB 1: MY WORKFLOWS (Mockup 71) */}
      {tab === "mine" && (
        <div>
          <h2 className="ee-wf-section-title">My workflows</h2>

          <div className="ee-tools-table-container">
            <table className="ee-tools-table">
              <thead>
                <tr>
                  <th className="sortable">NAME ▲</th>
                  <th className="sortable">TRANSACTION TYPE ↕</th>
                  <th className="sortable">WORKFLOW TYPE ↕</th>
                  <th className="sortable">CREATED ON ↕</th>
                  <th className="sortable">CREATED BY ▲</th>
                  <th className="sortable">LAST UPDATED BY ↕</th>
                  <th className="sortable">UPDATED ON ↕</th>
                  <th style={{ textAlign: "center" }}>ON/OFF</th>
                  <th style={{ textAlign: "right" }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {filteredMyWorkflows.map((w) => (
                  <tr key={w.id}>
                    <td style={{ fontWeight: 600, color: "#0c1c38" }}>{w.name}</td>
                    <td>{w.transactionType}</td>
                    <td>{w.workflowType}</td>
                    <td style={{ color: "#64748b" }}>{w.createdOn}</td>
                    <td style={{ color: "#64748b" }}>{w.createdBy || "—"}</td>
                    <td style={{ color: "#64748b" }}>{w.lastUpdatedBy || "—"}</td>
                    <td style={{ color: "#64748b" }}>{w.updatedOn}</td>
                    <td style={{ textAlign: "center" }}>
                      <label className="ee-switch" aria-label={`Toggle ${w.name}`}>
                        <input
                          type="checkbox"
                          checked={w.enabled}
                          onChange={() => toggleWorkflow(w.id)}
                        />
                        <span className="ee-slider" />
                      </label>
                    </td>
                    <td style={{ textAlign: "right", position: "relative" }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                        <button
                          type="button"
                          className="ee-action-link"
                          onClick={() => runWorkflow(w)}
                        >
                          Run now
                        </button>
                        <button
                          type="button"
                          style={{
                            background: "none",
                            border: "none",
                            color: "#0052ff",
                            cursor: "pointer",
                            padding: 4,
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                          onClick={() => setActiveMenuId(activeMenuId === w.id ? null : w.id)}
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>

                      {activeMenuId === w.id && (
                        <div
                          style={{
                            position: "absolute",
                            right: 0,
                            top: "100%",
                            background: "#ffffff",
                            border: "1px solid #e2e8f0",
                            borderRadius: 6,
                            boxShadow: "0 6px 18px rgba(0,0,0,0.1)",
                            zIndex: 40,
                            minWidth: 130,
                            textAlign: "left",
                            padding: 4,
                          }}
                        >
                          <button
                            type="button"
                            style={{
                              display: "block",
                              width: "100%",
                              padding: "6px 12px",
                              fontSize: 13,
                              border: "none",
                              background: "none",
                              textAlign: "left",
                              cursor: "pointer",
                              color: "#1e293b",
                            }}
                            onClick={() => runWorkflow(w)}
                          >
                            Run now
                          </button>
                          <button
                            type="button"
                            style={{
                              display: "block",
                              width: "100%",
                              padding: "6px 12px",
                              fontSize: 13,
                              border: "none",
                              background: "none",
                              textAlign: "left",
                              cursor: "pointer",
                              color: "#1e293b",
                            }}
                            onClick={() => {
                              setActiveMenuId(null);
                              toast(`Edit workflow "${w.name}".`);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            style={{
                              display: "block",
                              width: "100%",
                              padding: "6px 12px",
                              fontSize: 13,
                              border: "none",
                              background: "none",
                              textAlign: "left",
                              cursor: "pointer",
                              color: "#ef4444",
                            }}
                            onClick={() => deleteWorkflow(w.id)}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: TEMPLATES */}
      {tab === "templates" && (
        <section className="ee-workflows-section" aria-label="Workflow templates">
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 16px", color: "#0c1c38" }}>
            Workflow templates <span style={{ fontSize: 14, fontWeight: 400, color: "#64748b" }}>{templates.length} templates</span>
          </h2>
          <div className="ee-workflows-grid">
            {templates.map((t) => {
              const Icon = ICONS[t.icon];
              return (
                <article key={t.id} className="ee-workflow-card">
                  <span className="ee-workflow-card-icon" aria-hidden="true">
                    <Icon size={16} strokeWidth={1.75} />
                  </span>
                  <h3>{t.title}</h3>
                  <p>{t.description}</p>
                  <div className="ee-workflow-card-foot">
                    <div className="ee-workflow-tags">
                      {t.tags.map((tag) => (
                        <span key={tag} className="ee-workflow-tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="ee-workflow-use"
                      onClick={() => {
                        const newWf: MyWorkflow = {
                          id: `wf-${Date.now()}`,
                          name: t.title,
                          transactionType: t.tags[0] || "General",
                          workflowType: t.tags[1] || "Automated",
                          createdOn: new Date().toLocaleDateString("en-US"),
                          createdBy: "System Administration",
                          lastUpdatedBy: "System Administration",
                          updatedOn: new Date().toLocaleDateString("en-US"),
                          enabled: true,
                        };
                        setWorkflows([newWf, ...workflows]);
                        setTab("mine");
                        toast(`Activated template "${t.title}".`);
                      }}
                    >
                      Use template →
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* TAB 3: HISTORY */}
      {tab === "history" && (
        <div>
          <h2 className="ee-wf-section-title">Workflow run history</h2>
          <div className="ee-tools-table-container">
            <table className="ee-tools-table">
              <thead>
                <tr>
                  <th>DATE & TIME</th>
                  <th>WORKFLOW</th>
                  <th>TRIGGER</th>
                  <th>RECIPIENT / TARGET</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>27 Oct, 09:14 am</td>
                  <td>Get unsent invoice reminder</td>
                  <td>Daily scheduled check</td>
                  <td>finance@exceledge.com</td>
                  <td><span style={{ color: "#16a34a", fontWeight: 600 }}>✓ Sent (2 reminders)</span></td>
                </tr>
                <tr>
                  <td>26 Oct, 05:00 pm</td>
                  <td>Pay vendor bill reminder</td>
                  <td>Due date approaching (&lt; 3 days)</td>
                  <td>ap@exceledge.com</td>
                  <td><span style={{ color: "#16a34a", fontWeight: 600 }}>✓ Sent (1 reminder)</span></td>
                </tr>
                <tr>
                  <td>24 Oct, 10:30 am</td>
                  <td>Send open estimate reminder</td>
                  <td>Quote aging &gt; 7 days</td>
                  <td>sales@exceledge.com</td>
                  <td><span style={{ color: "#16a34a", fontWeight: 600 }}>✓ Completed</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Custom Workflow Drawer */}
      {customDrawerOpen && (
        <>
          <div
            className="ee-backup-drawer-backdrop"
            onClick={() => setCustomDrawerOpen(false)}
          />
          <aside className="ee-backup-drawer" role="dialog" aria-modal="true">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "#0c1c38" }}>
                Create custom workflow
              </h2>
              <button
                type="button"
                style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
                onClick={() => setCustomDrawerOpen(false)}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateWorkflow} style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
              <div className="ee-input-group">
                <label className="ee-input-label">Workflow name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Follow up on high-value orders"
                  className="ee-input-field"
                  value={wfName}
                  onChange={(e) => setWfName(e.target.value)}
                />
              </div>

              <div className="ee-input-group">
                <label className="ee-input-label">Transaction type</label>
                <select
                  className="ee-input-field"
                  value={wfTxnType}
                  onChange={(e) => setWfTxnType(e.target.value)}
                >
                  <option value="Invoice">Invoice</option>
                  <option value="Bill">Bill</option>
                  <option value="Estimate">Estimate</option>
                  <option value="Purchase order">Purchase order</option>
                  <option value="Payment">Payment</option>
                  <option value="General ledger">General ledger</option>
                </select>
              </div>

              <div className="ee-input-group">
                <label className="ee-input-label">Workflow type</label>
                <select
                  className="ee-input-field"
                  value={wfType}
                  onChange={(e) => setWfType(e.target.value)}
                >
                  <option value="Reminder">Reminder</option>
                  <option value="Notification">Notification</option>
                  <option value="Approval">Approval</option>
                  <option value="Scheduled report">Scheduled report</option>
                </select>
              </div>

              <div style={{ marginTop: "auto", display: "flex", gap: 12, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="ee-btn-outline"
                  onClick={() => setCustomDrawerOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="ee-btn-blue">
                  Create workflow
                </button>
              </div>
            </form>
          </aside>
        </>
      )}
    </div>
  );
}
