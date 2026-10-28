import { ArrowRight, Download, Printer, Search, Settings, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useFeedback } from "../components/feedback";
import { Drawer, EmptyState } from "../components/ui";
import { Link } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import { MOCKUP_AUDIT_LOG_EVENTS, type AuditLogItem } from "../lib/tools-dummy";
import type { AuditEvent } from "../lib/types";

type AuditRow = AuditEvent & { ipAddress?: string | null };

export function AuditLog() {
  const { download } = useSession();
  const { toast } = useFeedback();

  // Filter state matching Mockup 82
  const [selectedUser, setSelectedUser] = useState("All Users");
  const [dateRange, setDateRange] = useState("This Month");
  const [eventCategory, setEventCategory] = useState("All events");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewingItem, setViewingItem] = useState<AuditLogItem | null>(null);

  // Fetch backend audit events if any
  const eventsResource = useResource<AuditRow[]>("/api/v1/audit?limit=50");

  // Merge or adapt backend events into display items
  const displayItems = useMemo<AuditLogItem[]>(() => {
    const mockList = MOCKUP_AUDIT_LOG_EVENTS;
    const backendRows = eventsResource.data ?? [];

    let combined: AuditLogItem[] = [];
    if (backendRows.length > 0) {
      combined = backendRows.map((e) => ({
        id: e.id,
        dateChanged: new Date(e.createdAt).toLocaleString("en-GB", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        }) + " Central Africa Time",
        user: `User #${e.erpUserId}`,
        event: `${e.action.replace(/_/g, " ")} ${e.entityType} ${e.entityId || ""}`,
        hasViewHistory: true,
      }));
    } else {
      combined = [...mockList];
    }

    // Apply filters
    return combined.filter((item) => {
      if (selectedUser !== "All Users" && item.user !== selectedUser) return false;
      if (eventCategory !== "All events") {
        if (eventCategory === "Sign in / out" && !item.event.toLowerCase().includes("sign")) return false;
        if (eventCategory === "Accounts" && !item.event.toLowerCase().includes("account")) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          item.event.toLowerCase().includes(q) ||
          item.user.toLowerCase().includes(q) ||
          item.dateChanged.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [eventsResource.data, selectedUser, dateRange, eventCategory, searchQuery]);

  function handleExport() {
    const csvContent = [
      "Date Changed,User,Event",
      ...displayItems.map((i) => `"${i.dateChanged}","${i.user}","${i.event}"`),
    ].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `audit-log-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast("Audit log exported to CSV.");
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div className="ee-tools-page">
      {/* Header matching Mockup 82 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: "#0c1c38", margin: 0, letterSpacing: "-0.02em" }}>
          Audit Log
        </h1>
        <button
          type="button"
          className="ee-btn-outline"
          onClick={() => {
            setEventCategory("Automation");
            toast("Filtered by automation workflows audit events.");
          }}
        >
          Automation audit log <ArrowRight size={16} />
        </button>
      </div>

      {/* Filter toolbar matching Mockup 82 */}
      <div className="ee-audit-toolbar">
        <div className="ee-audit-filters">
          {/* User dropdown */}
          <div className="ee-audit-select-wrap">
            <span className="ee-audit-select-label">User</span>
            <select
              className="ee-audit-select"
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
            >
              <option value="All Users">All Users</option>
              <option value="System Administration">System Administration</option>
              <option value="Iradukunda Enock">Iradukunda Enock</option>
            </select>
          </div>

          {/* Date Changed dropdown */}
          <div className="ee-audit-select-wrap">
            <span className="ee-audit-select-label">Date Changed</span>
            <select
              className="ee-audit-select"
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
            >
              <option value="This Month">This Month</option>
              <option value="Today">Today</option>
              <option value="This Week">This Week</option>
              <option value="Last Month">Last Month</option>
              <option value="All Dates">All Dates</option>
            </select>
          </div>

          {/* Events dropdown */}
          <div className="ee-audit-select-wrap">
            <span className="ee-audit-select-label">Events</span>
            <select
              className="ee-audit-select"
              value={eventCategory}
              onChange={(e) => setEventCategory(e.target.value)}
            >
              <option value="All events">All events</option>
              <option value="Sign in / out">Sign in / out</option>
              <option value="Accounts">Accounts & Chart</option>
              <option value="Automation">Automation</option>
            </select>
          </div>

          {/* Search */}
          <div className="ee-audit-select-wrap" style={{ flex: 1, maxWidth: 360 }}>
            <span className="ee-audit-select-label">Search</span>
            <div style={{ position: "relative" }}>
              <Search size={15} color="#64748b" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
              <input
                type="search"
                className="ee-audit-select"
                style={{ width: "100%", paddingLeft: 32 }}
                placeholder="Search audit events..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Action icons on right */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            className="ee-wf-filter-btn"
            title="Export CSV"
            onClick={handleExport}
          >
            <Download size={16} />
          </button>
          <button
            type="button"
            className="ee-wf-filter-btn"
            title="Print audit log"
            onClick={handlePrint}
          >
            <Printer size={16} />
          </button>
          <button
            type="button"
            className="ee-wf-filter-btn"
            title="Settings"
            onClick={() => toast("Audit log display settings.")}
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* Table matching Mockup 82 */}
      <div className="ee-tools-table-container">
        <table className="ee-tools-table">
          <thead>
            <tr>
              <th style={{ width: 340 }}>DATE CHANGED ↓</th>
              <th style={{ width: 280 }}>USER</th>
              <th>EVENT</th>
              <th style={{ width: 100, textAlign: "right" }}>HISTORY</th>
            </tr>
          </thead>
          <tbody>
            {displayItems.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ textAlign: "center", padding: 32, color: "#64748b" }}>
                  No audit log events found matching the selected filters.
                </td>
              </tr>
            ) : (
              displayItems.map((item) => (
                <tr key={item.id}>
                  <td style={{ color: "#334155" }}>{item.dateChanged}</td>
                  <td style={{ fontWeight: 600, color: "#0c1c38" }}>{item.user}</td>
                  <td style={{ color: "#1e293b" }}>
                    {item.eventLink ? (
                      <>
                        Added account{" "}
                        <Link to={item.eventLink} style={{ color: "#0052ff", fontWeight: 600, textDecoration: "none" }}>
                          Reconciliation Discrepancies
                        </Link>
                      </>
                    ) : (
                      item.event
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {item.hasViewHistory ? (
                      <button
                        type="button"
                        style={{ background: "none", border: "none", color: "#0052ff", fontWeight: 600, cursor: "pointer", padding: "4px 8px" }}
                        onClick={() => setViewingItem(item)}
                      >
                        View
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* History Detail Drawer */}
      {viewingItem && (
        <>
          <div
            className="ee-backup-drawer-backdrop"
            onClick={() => setViewingItem(null)}
          />
          <aside className="ee-backup-drawer" role="dialog" aria-modal="true">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "#0c1c38" }}>
                Audit event history
              </h2>
              <button
                type="button"
                style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
                onClick={() => setViewingItem(null)}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>Date & Time</span>
                <div style={{ fontSize: 14, color: "#0c1c38" }}>{viewingItem.dateChanged}</div>
              </div>
              <div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>Initiated By</span>
                <div style={{ fontSize: 14, color: "#0c1c38", fontWeight: 600 }}>{viewingItem.user}</div>
              </div>
              <div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>Action Taken</span>
                <div style={{ fontSize: 14, color: "#0c1c38" }}>{viewingItem.event}</div>
              </div>

              <div style={{ marginTop: 12, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#0c1c38", display: "block", marginBottom: 8 }}>
                  Snapshot Diff
                </span>
                <div style={{ fontFamily: "monospace", fontSize: 12, color: "#166534", background: "#f0fdf4", padding: 8, borderRadius: 4 }}>
                  + Account: Reconciliation Discrepancies<br />
                  + Type: Expense / Discrepancy Adjustment<br />
                  + Created: System Setup Initializer
                </div>
              </div>
            </div>

            <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="ee-btn-blue"
                onClick={() => setViewingItem(null)}
              >
                Close
              </button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
