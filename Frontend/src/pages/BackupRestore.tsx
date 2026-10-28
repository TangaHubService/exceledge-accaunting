import {
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  HelpCircle,
  MessageSquare,
  RefreshCw,
  Sliders,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useFeedback } from "../components/feedback";
import { INITIAL_BACKUPS, type BackupItem } from "../lib/tools-dummy";

export function BackupRestore() {
  const { toast } = useFeedback();
  const [tab, setTab] = useState<"Backups" | "Restore" | "Copy" | "Personal cloud archive">("Backups");
  const [backups, setBackups] = useState<BackupItem[]>(INITIAL_BACKUPS);
  const [noteFilter, setNoteFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [expiringFilter, setExpiringFilter] = useState(false);
  const [manualDrawerOpen, setManualDrawerOpen] = useState(false);
  const [selectedBackupType, setSelectedBackupType] = useState<"Incremental" | "Full" | "Complete">("Incremental");
  const [backingUp, setBackingUp] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const filteredBackups = useMemo(() => {
    return backups.filter((b) => {
      if (typeFilter !== "all" && b.type.toLowerCase() !== typeFilter.toLowerCase()) return false;
      return true;
    });
  }, [backups, typeFilter]);

  function handleRunManualBackup() {
    setBackingUp(true);
    setTimeout(() => {
      const now = new Date();
      const dateStr =
        now.toLocaleDateString("en-GB") +
        " " +
        now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }).toLowerCase();
      const expDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      const expStr =
        expDate.toLocaleDateString("en-GB") +
        " " +
        expDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }).toLowerCase();

      const newBackup: BackupItem = {
        id: `bak-${Date.now()}`,
        date: dateStr,
        type: "Manual",
        kind: selectedBackupType,
        status: "Success",
        expiration: expStr,
      };

      setBackups([newBackup, ...backups]);
      setBackingUp(false);
      setManualDrawerOpen(false);
      toast(`Manual backup (${selectedBackupType}) completed successfully.`);
    }, 1200);
  }

  function restoreFromBackup(b: BackupItem) {
    setActiveMenuId(null);
    toast(`Restoration from snapshot (${b.date}) initiated.`);
  }

  function downloadBackup(b: BackupItem) {
    setActiveMenuId(null);
    const content = `Excel Edge ERP Company Backup Archive\nID: ${b.id}\nSnapshot Date: ${b.date}\nStatus: Verified\n`;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `company-backup-${b.id}.zip`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast(`Downloaded backup archive for ${b.date}.`);
  }

  return (
    <div className="ee-tools-page">
      {/* Header matching Mockup 83 */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 700, color: "#0c1c38", margin: 0, letterSpacing: "-0.02em" }}>
            Backup and Restore
          </h1>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
          <button
            type="button"
            className="ee-btn-blue"
            onClick={() => setManualDrawerOpen(true)}
          >
            Run manual backup
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button
              type="button"
              style={{ background: "none", border: "none", color: "#0052ff", fontSize: 13.5, cursor: "pointer", padding: 0 }}
              onClick={() => toast("Backup settings opened.")}
            >
              Change backup settings
            </button>
            <span style={{ color: "#cbd5e1" }}>|</span>
            <button
              type="button"
              style={{ background: "none", border: "none", color: "#0052ff", fontSize: 13.5, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, padding: 0 }}
              onClick={() => toast("Thank you for sharing your feedback!")}
            >
              <MessageSquare size={14} /> Feedback
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="ee-wf-tabs" role="tablist">
        {(["Backups", "Restore", "Copy", "Personal cloud archive"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`ee-wf-tab ${tab === t ? "active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Backups" && (
        <>
          {/* Filters Bar matching Mockup 83 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <input
                type="text"
                placeholder="Note"
                className="ee-input-field"
                style={{ width: 220, height: 38 }}
                value={noteFilter}
                onChange={(e) => setNoteFilter(e.target.value)}
              />
              <select
                className="ee-input-field"
                style={{ width: 200, height: 38 }}
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="all">Backup type</option>
                <option value="Auto">Auto</option>
                <option value="Manual">Manual</option>
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13.5, color: "#1e293b", fontWeight: 500 }}>
                Show only backups expiring within 30 days
              </span>
              <label className="ee-switch" aria-label="Show only backups expiring within 30 days">
                <input
                  type="checkbox"
                  checked={expiringFilter}
                  onChange={(e) => setExpiringFilter(e.target.checked)}
                />
                <span className="ee-slider" />
              </label>
            </div>
          </div>

          {/* Table matching Mockup 83 */}
          <div className="ee-tools-table-container">
            <table className="ee-tools-table">
              <thead>
                <tr>
                  <th>DATE</th>
                  <th>TYPE</th>
                  <th>STATUS</th>
                  <th>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      EXPIRATION <HelpCircle size={14} color="#64748b" />
                    </span>
                  </th>
                  <th style={{ textAlign: "right" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      ACTIONS <HelpCircle size={14} color="#64748b" />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredBackups.map((b) => (
                  <tr key={b.id}>
                    <td style={{ color: "#1e293b", fontWeight: 500 }}>{b.date}</td>
                    <td style={{ color: "#475569" }}>
                      {b.type} {b.kind ? `(${b.kind})` : ""}
                    </td>
                    <td>
                      <span className="ee-backup-status-badge">
                        <CheckCircle2 size={16} fill="#16a34a" color="#ffffff" />
                        Success
                      </span>
                    </td>
                    <td style={{ color: "#475569" }}>{b.expiration}</td>
                    <td style={{ textAlign: "right", position: "relative" }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                        <button
                          type="button"
                          className="ee-action-link"
                          onClick={() => toast(`Viewing snapshot ${b.date}`)}
                        >
                          View
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
                          onClick={() => setActiveMenuId(activeMenuId === b.id ? null : b.id)}
                        >
                          <ChevronDown size={14} />
                        </button>
                      </div>

                      {activeMenuId === b.id && (
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
                            minWidth: 150,
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
                            onClick={() => restoreFromBackup(b)}
                          >
                            Restore from this
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
                            onClick={() => downloadBackup(b)}
                          >
                            Download archive
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab !== "Backups" && (
        <div className="ee-tools-table-container" style={{ padding: 48, textAlign: "center" }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: "#0c1c38", margin: "0 0 8px" }}>
            {tab}
          </h3>
          <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>
            {tab === "Restore" && "Point-in-time recovery tools and historical restoration jobs."}
            {tab === "Copy" && "Copy company ledger or duplicate sandbox environment for testing."}
            {tab === "Personal cloud archive" && "Sync automated company snapshots to Google Drive or OneDrive."}
          </p>
        </div>
      )}

      {/* Manual Backup Drawer matching Mockup 84 */}
      {manualDrawerOpen && (
        <>
          <div
            className="ee-backup-drawer-backdrop"
            onClick={() => setManualDrawerOpen(false)}
          />
          <aside className="ee-backup-drawer" role="dialog" aria-modal="true">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h2 style={{ fontSize: 24, fontWeight: 800, color: "#0c1c38", margin: 0 }}>
                Run manual backup
              </h2>
              <button
                type="button"
                style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
                onClick={() => setManualDrawerOpen(false)}
              >
                <X size={22} />
              </button>
            </div>

            <p style={{ fontSize: 14, color: "#475569", margin: "0 0 24px" }}>
              Select the kind of backup you need.
            </p>

            {/* 3 Radio choices */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Incremental */}
              <label
                className={`ee-backup-choice-card ${selectedBackupType === "Incremental" ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="backupType"
                  checked={selectedBackupType === "Incremental"}
                  onChange={() => setSelectedBackupType("Incremental")}
                  style={{ marginTop: 3 }}
                />
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#0c1c38", marginBottom: 6 }}>
                    Incremental
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "#475569", lineHeight: 1.5 }}>
                    <li>Backs up any data that has changed since last backup</li>
                    <li>Fastest option</li>
                  </ul>
                </div>
              </label>

              {/* Full */}
              <label
                className={`ee-backup-choice-card ${selectedBackupType === "Full" ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="backupType"
                  checked={selectedBackupType === "Full"}
                  onChange={() => setSelectedBackupType("Full")}
                  style={{ marginTop: 3 }}
                />
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#0c1c38", marginBottom: 6 }}>
                    Full
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "#475569", lineHeight: 1.5 }}>
                    <li>Backs up any data that Excel Edge ERP has marked as changed</li>
                    <li>Takes less time than a complete backup</li>
                  </ul>
                </div>
              </label>

              {/* Complete */}
              <label
                className={`ee-backup-choice-card ${selectedBackupType === "Complete" ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="backupType"
                  checked={selectedBackupType === "Complete"}
                  onChange={() => setSelectedBackupType("Complete")}
                  style={{ marginTop: 3 }}
                />
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#0c1c38", marginBottom: 6 }}>
                    Complete
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "#475569", lineHeight: 1.5 }}>
                    <li>Backs up all company data after a thorough search for changes</li>
                    <li>Takes the longest time to complete</li>
                  </ul>
                </div>
              </label>
            </div>

            {/* Footer */}
            <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 20 }}>
              <button
                type="button"
                style={{ background: "none", border: "none", color: "#0052ff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                onClick={() => setManualDrawerOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ee-btn-blue"
                disabled={backingUp}
                onClick={handleRunManualBackup}
              >
                {backingUp ? "Backing up..." : "Back up"}
              </button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
