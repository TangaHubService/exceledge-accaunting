import {
  Check,
  ChevronDown,
  ChevronRight,
  Edit2,
  HelpCircle,
  Pencil,
  Printer,
  Search,
  Settings,
  Share2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useFeedback } from "../feedback";
import { INITIAL_BUDGET_ROWS, type BudgetEditorRow } from "../../lib/tools-dummy";

const MONTH_NAMES = [
  "Jan 2026",
  "Feb 2026",
  "Mar 2026",
  "Apr 2026",
  "May 2026",
  "Jun 2026",
  "Jul 2026",
  "Aug 2026",
  "Sep 2026",
  "Oct 2026",
  "Nov 2026",
  "Dec 2026",
];

type Props = {
  onClose: () => void;
  onOpenSpreadsheetSync: () => void;
};

export function BudgetEditor({ onClose, onOpenSpreadsheetSync }: Props) {
  const { toast } = useFeedback();
  const [budgetName, setBudgetName] = useState("Budget_FY26_P&L");
  const [isEditingName, setIsEditingName] = useState(false);
  const [period, setPeriod] = useState("FY 2026 (Jan 2026 - Dec 2026)");
  const [compareRef, setCompareRef] = useState(true);
  const [refData, setRefData] = useState("Actuals 2026 (YTD)");
  const [interval, setInterval] = useState<"Yearly" | "Quarterly" | "Monthly">("Monthly");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<BudgetEditorRow[]>(INITIAL_BUDGET_ROWS);
  const [incomeExpanded, setIncomeExpanded] = useState(true);
  const [cogsExpanded, setCogsExpanded] = useState(true);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());

  // Filtered rows
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, search]);

  const incomeRows = filteredRows.filter((r) => r.category === "Income");
  const cogsRows = filteredRows.filter((r) => r.category === "Cost Of Goods Sold");

  function updateMonthValue(rowId: string, monthIdx: number, valStr: string) {
    const val = parseFloat(valStr) || 0;
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        const nextMonths = [...r.months];
        nextMonths[monthIdx] = val;
        return { ...r, months: nextMonths };
      }),
    );
  }

  function spreadTotalEvenly(rowId: string, totalValStr: string) {
    const totalVal = parseFloat(totalValStr) || 0;
    const monthlyVal = Math.round((totalVal / 12) * 100) / 100;
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        return { ...r, months: Array(12).fill(monthlyVal) };
      }),
    );
    toast("Total spread across all 12 months.");
  }

  const totalIncomeYtd = incomeRows.reduce((s, r) => s + r.actualsYtd, 0);
  const totalIncomeBudget = incomeRows.reduce((s, r) => s + r.months.reduce((a, b) => a + b, 0), 0);

  function handleSave() {
    toast(`Budget "${budgetName}" saved successfully.`);
    onClose();
  }

  function handleExport() {
    const header = ["Category", "Account", "Actuals 2026 (YTD)", "Budget Total", ...MONTH_NAMES].join(",");
    const csvRows = rows.map((r) => {
      const budgetTotal = r.months.reduce((a, b) => a + b, 0);
      return [r.category, `"${r.name}"`, r.actualsYtd, budgetTotal, ...r.months].join(",");
    });
    const blob = new Blob([[header, ...csvRows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${budgetName}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast(`Exported ${budgetName}.csv`);
  }

  return (
    <div className="ee-budget-editor-wrap">
      {/* Top Header Row matching Mockup 81 */}
      <div className="ee-budget-top-bar">
        <div className="ee-budget-title-row">
          {isEditingName ? (
            <input
              type="text"
              autoFocus
              className="ee-budget-title-input"
              value={budgetName}
              onChange={(e) => setBudgetName(e.target.value)}
              onBlur={() => setIsEditingName(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setIsEditingName(false);
              }}
            />
          ) : (
            <h1
              className="ee-budget-title-input"
              style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}
              onClick={() => setIsEditingName(true)}
            >
              {budgetName}
              <Pencil size={18} color="#64748b" />
            </h1>
          )}
        </div>

        <button
          type="button"
          className="ee-export-close-btn"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={22} />
        </button>
      </div>

      {/* Top Controls Row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* Period */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>Period</span>
            <select
              className="ee-input-field"
              style={{ height: 36, minWidth: 220 }}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option value="FY 2026 (Jan 2026 - Dec 2026)">FY 2026 (Jan 2026 - Dec 2026)</option>
              <option value="FY 2025 (Jan 2025 - Dec 2025)">FY 2025 (Jan 2025 - Dec 2025)</option>
            </select>
          </div>

          {/* Compare reference data switch */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
            <span style={{ fontSize: 13.5, color: "#1e293b", fontWeight: 500 }}>
              Compare reference data
            </span>
            <label className="ee-switch" aria-label="Compare reference data">
              <input
                type="checkbox"
                checked={compareRef}
                onChange={(e) => setCompareRef(e.target.checked)}
              />
              <span className="ee-slider" />
            </label>
          </div>

          {/* Reference data dropdown */}
          {compareRef && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>Reference data</span>
              <select
                className="ee-input-field"
                style={{ height: 36, minWidth: 180 }}
                value={refData}
                onChange={(e) => setRefData(e.target.value)}
              >
                <option value="Actuals 2026 (YTD)">Actuals 2026 (YTD)</option>
                <option value="Actuals 2025">Actuals 2025</option>
                <option value="Budget FY 2025">Budget FY 2025</option>
              </select>
            </div>
          )}
        </div>

        {/* Segmented Control: Yearly | Quarterly | Monthly */}
        <div style={{ display: "inline-flex", background: "#f1f5f9", borderRadius: 6, padding: 3 }}>
          {(["Yearly", "Quarterly", "Monthly"] as const).map((seg) => (
            <button
              key={seg}
              type="button"
              style={{
                border: "none",
                background: interval === seg ? "#0052ff" : "none",
                color: interval === seg ? "#ffffff" : "#475569",
                fontSize: 13,
                fontWeight: 600,
                padding: "6px 16px",
                borderRadius: 4,
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
              onClick={() => setInterval(seg)}
            >
              {seg}
            </button>
          ))}
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="ee-budget-filters-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            className="ee-btn-outline"
            style={{ height: 36, fontSize: 13, padding: "0 14px" }}
            onClick={() => toast("Batch action applied to selected rows.")}
          >
            Batch actions <ChevronDown size={14} />
          </button>
          <HelpCircle size={16} color="#64748b" />

          <div style={{ position: "relative", width: 280 }}>
            <Search size={15} color="#64748b" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
            <input
              type="search"
              className="ee-input-field"
              style={{ height: 36, paddingLeft: 32, width: "100%", fontSize: 13 }}
              placeholder="Find by account name or number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#16a34a", fontWeight: 600 }}>
            <Check size={16} /> Autosave on
          </div>
          <button
            type="button"
            className="ee-btn-outline"
            style={{ height: 36, fontSize: 13, padding: "0 12px" }}
            onClick={() => toast("Showing all reference data columns.")}
          >
            Show all reference data
          </button>
          <button
            type="button"
            className="ee-btn-outline"
            style={{ height: 36, fontSize: 13, padding: "0 12px" }}
            onClick={handleExport}
          >
            Export/Print <ChevronDown size={14} />
          </button>
          <button
            type="button"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
            onClick={() => toast("Table display settings.")}
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      {/* Spreadsheet Matrix Table */}
      <div style={{ overflowX: "auto", border: "1px solid #cbd5e1", borderRadius: 8, background: "#ffffff" }}>
        <table className="ee-budget-matrix-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <input
                  type="checkbox"
                  onChange={(e) => {
                    if (e.target.checked) setSelectedRowIds(new Set(rows.map((r) => r.id)));
                    else setSelectedRowIds(new Set());
                  }}
                />
              </th>
              <th style={{ textAlign: "left", minWidth: 220 }}>^ Accounts</th>
              {compareRef && (
                <th style={{ background: "#e0f2fe", color: "#0369a1", minWidth: 110 }}>
                  Actuals 2026 (YTD)
                </th>
              )}
              <th style={{ minWidth: 120 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  ◀ Budget totals ▶
                </span>
              </th>
              {MONTH_NAMES.map((m) => (
                <th key={m} style={{ minWidth: 100 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                    ◀ {m} ▶
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Category: Income */}
            <tr style={{ background: "#f8fafc", fontWeight: 700 }}>
              <td />
              <td
                colSpan={compareRef ? 15 : 14}
                style={{ cursor: "pointer", userSelect: "none" }}
                onClick={() => setIncomeExpanded(!incomeExpanded)}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {incomeExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  Income
                </span>
              </td>
            </tr>

            {incomeExpanded &&
              incomeRows.map((row) => {
                const total = row.months.reduce((a, b) => a + b, 0);
                return (
                  <tr key={row.id}>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={selectedRowIds.has(row.id)}
                        onChange={() => {
                          const next = new Set(selectedRowIds);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          setSelectedRowIds(next);
                        }}
                      />
                    </td>
                    <td style={{ paddingLeft: 28, color: "#1e293b", fontWeight: 500 }}>
                      {row.name}
                    </td>
                    {compareRef && (
                      <td style={{ textAlign: "right", color: "#475569", background: "#f8fafc" }}>
                        {row.actualsYtd.toFixed(2)}
                      </td>
                    )}
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <input
                          type="number"
                          step="0.01"
                          className="ee-budget-cell-input"
                          style={{ borderColor: "#0052ff", fontWeight: 600 }}
                          value={total === 0 ? "0.00" : total.toFixed(2)}
                          onChange={(e) => spreadTotalEvenly(row.id, e.target.value)}
                        />
                        <button
                          type="button"
                          title="Spread total evenly across 12 months"
                          style={{ background: "#0052ff", border: "none", color: "#fff", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                          onClick={() => spreadTotalEvenly(row.id, String(total))}
                        >
                          <Share2 size={10} />
                        </button>
                      </div>
                    </td>
                    {row.months.map((val, mIdx) => (
                      <td key={mIdx}>
                        <input
                          type="number"
                          step="0.01"
                          className="ee-budget-cell-input"
                          value={val === 0 ? "" : val}
                          placeholder="0.00"
                          onChange={(e) => updateMonthValue(row.id, mIdx, e.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}

            {/* Total Income Row */}
            <tr style={{ background: "#f1f5f9", fontWeight: 700 }}>
              <td />
              <td style={{ paddingLeft: 28 }}>Total Income</td>
              {compareRef && (
                <td style={{ textAlign: "right" }}>{totalIncomeYtd.toFixed(2)}</td>
              )}
              <td style={{ textAlign: "right", fontWeight: 700, color: "#0c1c38" }}>
                {totalIncomeBudget.toFixed(2)}
              </td>
              {MONTH_NAMES.map((_, mIdx) => {
                const monthSum = incomeRows.reduce((s, r) => s + (r.months[mIdx] || 0), 0);
                return (
                  <td key={mIdx} style={{ textAlign: "right", color: "#475569" }}>
                    {monthSum.toFixed(2)}
                  </td>
                );
              })}
            </tr>

            {/* Category: Cost Of Goods Sold */}
            <tr style={{ background: "#f8fafc", fontWeight: 700 }}>
              <td />
              <td
                colSpan={compareRef ? 15 : 14}
                style={{ cursor: "pointer", userSelect: "none" }}
                onClick={() => setCogsExpanded(!cogsExpanded)}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {cogsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  Cost Of Goods Sold
                </span>
              </td>
            </tr>

            {cogsExpanded &&
              cogsRows.map((row) => {
                const total = row.months.reduce((a, b) => a + b, 0);
                return (
                  <tr key={row.id}>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={selectedRowIds.has(row.id)}
                        onChange={() => {
                          const next = new Set(selectedRowIds);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          setSelectedRowIds(next);
                        }}
                      />
                    </td>
                    <td style={{ paddingLeft: 28, color: "#1e293b", fontWeight: 500 }}>
                      {row.name}
                    </td>
                    {compareRef && (
                      <td style={{ textAlign: "right", color: "#475569", background: "#f8fafc" }}>
                        {row.actualsYtd.toFixed(2)}
                      </td>
                    )}
                    <td style={{ textAlign: "right" }}>
                      <input
                        type="number"
                        step="0.01"
                        className="ee-budget-cell-input"
                        value={total === 0 ? "0.00" : total.toFixed(2)}
                        onChange={(e) => spreadTotalEvenly(row.id, e.target.value)}
                      />
                    </td>
                    {row.months.map((val, mIdx) => (
                      <td key={mIdx}>
                        <input
                          type="number"
                          step="0.01"
                          className="ee-budget-cell-input"
                          value={val === 0 ? "" : val}
                          placeholder="0.00"
                          onChange={(e) => updateMonthValue(row.id, mIdx, e.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Bottom Bar matching Mockup 81 */}
      <div style={{ marginTop: 24, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12 }}>
        <button
          type="button"
          className="ee-btn-outline"
          onClick={onOpenSpreadsheetSync}
        >
          Edit in spreadsheet
        </button>
        <button
          type="button"
          className="ee-btn-blue"
          onClick={handleSave}
        >
          Save <ChevronDown size={14} />
        </button>
      </div>
    </div>
  );
}
