import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowRight,
  Banknote,
  BookOpen,
  Boxes,
  Building,
  Calculator,
  Check,
  ChevronDown,
  ClipboardList,
  Clock,
  Coins,
  CreditCard,
  Database,
  FileCheck,
  FileSpreadsheet,
  FileText,
  GitFork,
  HelpCircle,
  Landmark,
  type LucideIcon,
  MapPin,
  Package,
  Receipt,
  RotateCcw,
  ShoppingCart,
  Store,
  Undo2,
  Upload,
  User,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { useFeedback } from "../components/feedback";
import { navigate } from "../lib/router";
import { IMPORT_CATALOG_ITEMS, type ImportCatalogItem } from "../lib/tools-dummy";

const SW = 1.5;

function getImportIcon(iconName: string): LucideIcon {
  switch (iconName) {
    case "landmark":
      return Landmark;
    case "users":
      return Users;
    case "store":
      return Store;
    case "file-text":
      return FileText;
    case "package":
      return Package;
    case "file-check":
      return FileCheck;
    case "file-percent":
      return FileSpreadsheet;
    case "receipt":
      return Receipt;
    case "clipboard-list":
      return ClipboardList;
    case "database-arrow-right":
      return Database;
    case "banknote":
      return Banknote;
    case "user":
      return User;
    case "git-fork":
      return GitFork;
    case "credit-card":
      return CreditCard;
    case "credit-card-arrow-left":
      return CreditCard;
    case "database-arrow-down":
      return Database;
    case "calculator":
      return Calculator;
    case "book-open":
      return BookOpen;
    case "map-pin":
      return MapPin;
    case "file-plus":
      return FileCheck;
    case "shopping-cart":
      return ShoppingCart;
    case "hand-coins":
      return Coins;
    case "receipt-refund":
      return RotateCcw;
    case "clock":
      return Clock;
    case "arrow-left-right":
      return ArrowLeftRight;
    case "undo-2":
      return Undo2;
    case "boxes":
      return Boxes;
    default:
      return FileText;
  }
}

export function ImportData() {
  const { toast } = useFeedback();
  const [selectedItem, setSelectedItem] = useState<ImportCatalogItem | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [importStep, setImportStep] = useState<"file" | "map" | "complete">("file");
  const [importing, setImporting] = useState(false);

  function openImport(item: ImportCatalogItem) {
    setSelectedItem(item);
    setSelectedFileName(null);
    setImportStep("file");
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) {
      setSelectedFileName(e.dataTransfer.files[0].name);
      setImportStep("map");
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.[0]) {
      setSelectedFileName(e.target.files[0].name);
      setImportStep("map");
    }
  }

  function runImport() {
    if (!selectedItem) return;
    setImporting(true);
    setTimeout(() => {
      setImporting(false);
      setImportStep("complete");
      toast(`Successfully imported data for ${selectedItem.title}.`);
    }, 1200);
  }

  function downloadSampleCsv() {
    if (!selectedItem) return;
    const header = selectedItem.sampleColumns.join(",") + "\n";
    const sampleRow = selectedItem.sampleColumns.map((c) => `Sample ${c}`).join(",") + "\n";
    const blob = new Blob([header + sampleRow], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${selectedItem.id}-template.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast(`Sample template downloaded for ${selectedItem.title}.`);
  }

  return (
    <div className="ee-tools-page">
      {/* Header matching Mockup 72 & 73 */}
      <header className="ee-import-header">
        <div>
          <h1 className="ee-import-title">Import data</h1>
          <p className="ee-import-subtitle">Bring your existing data into Excel Edge ERP.</p>
        </div>
        <button
          type="button"
          className="ee-btn-outline"
          onClick={() => toast("Thank you for sharing your feedback!")}
        >
          Feedback
        </button>
      </header>

      {/* 27-Tile Catalog Grid (Mockups 72 & 73) */}
      <div className="ee-import-grid">
        {IMPORT_CATALOG_ITEMS.map((item) => {
          const IconComponent = getImportIcon(item.iconName);
          return (
            <div
              key={item.id}
              className="ee-import-tile"
              onClick={() => openImport(item)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") openImport(item);
              }}
            >
              <div className="ee-import-icon-circle">
                <IconComponent size={28} strokeWidth={SW} />
              </div>
              <div className="ee-import-tile-title">{item.title}</div>
            </div>
          );
        })}
      </div>

      <div className="ee-import-scroll-hint">
        <span>All import options displayed.</span>
      </div>

      {/* Interactive Import Drawer/Modal */}
      {selectedItem && (
        <>
          <div
            className="ee-backup-drawer-backdrop"
            onClick={() => setSelectedItem(null)}
          />
          <aside className="ee-backup-drawer" style={{ width: 520 }} role="dialog" aria-modal="true">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "#0c1c38" }}>
                  Import {selectedItem.title}
                </h2>
                <span style={{ fontSize: 13, color: "#64748b" }}>
                  {importStep === "file" && "Step 1: Select CSV or Excel file"}
                  {importStep === "map" && "Step 2: Map columns & verify preview"}
                  {importStep === "complete" && "Import finished"}
                </span>
              </div>
              <button
                type="button"
                style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
                onClick={() => setSelectedItem(null)}
              >
                <X size={20} />
              </button>
            </div>

            {importStep === "file" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 20, flex: 1 }}>
                <p style={{ fontSize: 14, color: "#475569", margin: 0, lineHeight: 1.5 }}>
                  {selectedItem.description}
                </p>

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleFileDrop}
                  style={{
                    border: dragActive ? "2px dashed #0052ff" : "2px dashed #cbd5e1",
                    backgroundColor: dragActive ? "#eff6ff" : "#f8fafc",
                    borderRadius: 12,
                    padding: "36px 20px",
                    textAlign: "center",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <Upload size={36} color="#0052ff" style={{ margin: "0 auto 12px" }} />
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#0c1c38", marginBottom: 6 }}>
                    Drag & drop your file here, or browse
                  </div>
                  <div style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>
                    Supports CSV, XLS, XLSX (up to 10MB)
                  </div>
                  <label className="ee-btn-blue" style={{ display: "inline-flex", cursor: "pointer" }}>
                    Browse files
                    <input
                      type="file"
                      accept=".csv, .xls, .xlsx"
                      style={{ display: "none" }}
                      onChange={handleFileSelect}
                    />
                  </label>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 10 }}>
                  <button
                    type="button"
                    onClick={downloadSampleCsv}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#0052ff",
                      fontSize: 13.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <ArrowDownToLine size={16} />
                    Download sample CSV template
                  </button>
                </div>

                <div style={{ marginTop: "auto", display: "flex", gap: 12, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="ee-btn-outline"
                    onClick={() => setSelectedItem(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {importStep === "map" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "10px 14px", borderRadius: 6, fontSize: 13.5, color: "#166534" }}>
                  File selected: <strong>{selectedFileName}</strong>
                </div>

                <div style={{ fontSize: 14, fontWeight: 600, color: "#0c1c38" }}>
                  Match columns with Excel Edge ERP fields:
                </div>

                <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, paddingRight: 4 }}>
                  {selectedItem.sampleColumns.map((col, idx) => (
                    <div
                      key={col}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 12px",
                        background: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        borderRadius: 6,
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>{col}</span>
                      <span style={{ fontSize: 12, color: "#0052ff", display: "flex", alignItems: "center", gap: 4 }}>
                        <Check size={14} /> Mapped to Column {idx + 1}
                      </span>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: "auto", display: "flex", gap: 12, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="ee-btn-outline"
                    onClick={() => setImportStep("file")}
                    disabled={importing}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className="ee-btn-blue"
                    onClick={runImport}
                    disabled={importing}
                  >
                    {importing ? "Importing records..." : "Import now"}
                  </button>
                </div>
              </div>
            )}

            {importStep === "complete" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, flex: 1, textAlign: "center" }}>
                <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#dcfce7", color: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Check size={36} />
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "#0c1c38" }}>
                  Import complete!
                </h3>
                <p style={{ fontSize: 14, color: "#475569", margin: 0, maxWidth: 320 }}>
                  All records for <strong>{selectedItem.title}</strong> were successfully verified and added to your books.
                </p>

                <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
                  <button
                    type="button"
                    className="ee-btn-blue"
                    onClick={() => setSelectedItem(null)}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
