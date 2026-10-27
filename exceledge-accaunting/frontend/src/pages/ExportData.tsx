import { X } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "../components/feedback";
import { Link, navigate } from "../lib/router";
import {
  DEFAULT_EXPORT_LISTS,
  DEFAULT_EXPORT_REPORTS,
  type ExportOption,
} from "../lib/tools-dummy";

export function ExportData() {
  const { toast } = useFeedback();
  const [tab, setTab] = useState<"reports" | "lists">("reports");
  const [dateRange, setDateRange] = useState("All dates");
  const [reports, setReports] = useState<ExportOption[]>(DEFAULT_EXPORT_REPORTS);
  const [lists, setLists] = useState<ExportOption[]>(DEFAULT_EXPORT_LISTS);
  const [exporting, setExporting] = useState(false);

  function toggleReport(id: string) {
    setReports((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    );
  }

  function toggleList(id: string) {
    setLists((prev) =>
      prev.map((l) => (l.id === id ? { ...l, enabled: !l.enabled } : l)),
    );
  }

  function handleExport() {
    setExporting(true);
    const selectedReports = reports.filter((r) => r.enabled).map((r) => r.title);
    const selectedLists = lists.filter((l) => l.enabled).map((l) => l.title);
    const totalCount = selectedReports.length + selectedLists.length;

    if (totalCount === 0) {
      toast("Please select at least one report or list to export.", { error: true });
      setExporting(false);
      return;
    }

    setTimeout(() => {
      // Create a downloadable sample export summary CSV
      const content = [
        "Excel Edge ERP Data Export",
        `Date Range: ${dateRange}`,
        `Exported On: ${new Date().toLocaleString()}`,
        "",
        "--- Exported Sections ---",
        ...selectedReports.map((r) => `Report: ${r}`),
        ...selectedLists.map((l) => `List: ${l}`),
        "",
        "Summary: All requested books data has been packaged successfully.",
      ].join("\n");

      const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `excel-edge-export-${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setExporting(false);
      toast(`Export to Excel complete (${totalCount} item${totalCount > 1 ? "s" : ""}).`);
    }, 1000);
  }

  return (
    <div className="ee-export-workspace">
      {/* Header matching Mockups 74 & 75 */}
      <div className="ee-export-head">
        <h1 className="ee-export-title">Export data</h1>
        <button
          type="button"
          className="ee-export-close-btn"
          aria-label="Close"
          onClick={() => window.history.back()}
        >
          <X size={22} />
        </button>
      </div>

      <h2 className="ee-export-question">Which reports and lists do you want to export?</h2>
      <p className="ee-export-helper">
        Add or remove items and set your date range to get just what you need.
      </p>

      {/* Tabs */}
      <div className="ee-export-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "reports"}
          className={`ee-export-tab ${tab === "reports" ? "active" : ""}`}
          onClick={() => setTab("reports")}
        >
          Reports
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "lists"}
          className={`ee-export-tab ${tab === "lists" ? "active" : ""}`}
          onClick={() => setTab("lists")}
        >
          Lists
        </button>
      </div>

      {/* Controls & Date selection */}
      <div className="ee-export-controls-bar">
        <div>
          <div className="ee-export-date-label">Pre-selected date ranges</div>
          <select
            className="ee-export-date-select"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
          >
            <option value="All dates">All dates</option>
            <option value="Today">Today</option>
            <option value="This week">This week</option>
            <option value="This month">This month</option>
            <option value="This quarter">This quarter</option>
            <option value="This year">This year</option>
            <option value="Last quarter">Last quarter</option>
            <option value="Last year">Last year</option>
            <option value="Custom">Custom</option>
          </select>
        </div>

        <Link to="/reports/statements" className="ee-export-more-link">
          For more reports, visit the reports page
        </Link>
      </div>

      {/* Cards list with toggle switches */}
      {tab === "reports" && (
        <div className="ee-export-card-list">
          {reports.map((report) => (
            <div key={report.id} className="ee-export-card">
              <span className="ee-export-card-name">{report.title}</span>
              <label className="ee-switch" aria-label={`Export ${report.title}`}>
                <input
                  type="checkbox"
                  checked={report.enabled}
                  onChange={() => toggleReport(report.id)}
                />
                <span className="ee-slider" />
              </label>
            </div>
          ))}
        </div>
      )}

      {tab === "lists" && (
        <div className="ee-export-card-list">
          {lists.map((list) => (
            <div key={list.id} className="ee-export-card">
              <span className="ee-export-card-name">{list.title}</span>
              <label className="ee-switch" aria-label={`Export ${list.title}`}>
                <input
                  type="checkbox"
                  checked={list.enabled}
                  onChange={() => toggleList(list.id)}
                />
                <span className="ee-slider" />
              </label>
            </div>
          ))}
        </div>
      )}

      {/* Fixed bottom action footer */}
      <footer className="ee-export-bottom-bar">
        <button
          type="button"
          className="ee-btn-outline"
          onClick={() => window.history.back()}
        >
          Cancel
        </button>
        <button
          type="button"
          className="ee-btn-blue"
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? "Exporting to Excel..." : "Export to Excel"}
        </button>
      </footer>
    </div>
  );
}
