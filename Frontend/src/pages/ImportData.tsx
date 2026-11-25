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

/** Imports that really load data; the rest of the catalogue shows as not available. */
const IMPORTERS: Record<string, string> = {
  "bank-data": "/banking",
  customers: "/customers/import",
  suppliers: "/suppliers/import",
  "chart-of-accounts": "/import-data/chart-of-accounts",
  "products-services": "/products-services/import",
  "journal-entries": "/journal-import",
  invoices: "/import-data/open-invoices",
  bills: "/import-data/open-bills",
};

export function ImportData() {
  return (
    <div className="ee-tools-page">
      <header className="ee-import-header">
        <div>
          <h1 className="ee-import-title">Import data</h1>
          <p className="ee-import-subtitle">Bring your existing data into Excel Edge ERP. Bank statements are imported from the bank account's page.</p>
        </div>
      </header>
      <div className="ee-import-grid">
        {[...IMPORT_CATALOG_ITEMS].sort((a, b) => Number(b.id in IMPORTERS) - Number(a.id in IMPORTERS)).map((item) => {
          const IconComponent = getImportIcon(item.iconName);
          const to = IMPORTERS[item.id];
          return (
            <button key={item.id} type="button" className="ee-import-tile" disabled={!to} style={to ? undefined : { opacity: 0.5, cursor: "not-allowed" }} onClick={() => navigate(to)}>
              <span className="ee-import-icon-circle">
                <IconComponent size={28} strokeWidth={SW} />
              </span>
              <span className="ee-import-tile-title">{item.title}</span>
              {to ? null : <span className="muted small">Not available yet</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
