import { Contact, FolderOpen, MapPin, StickyNote, Wrench, type LucideIcon } from "lucide-react";
import { SUPPLIER_DRAWER_TABS, type SupplierDrawerTabId } from "../../lib/supplier-hub-dummy";

const ICONS: Record<SupplierDrawerTabId, LucideIcon> = {
  contact: Contact,
  address: MapPin,
  notes: StickyNote,
  documents: FolderOpen,
  tools: Wrench,
};

export function SupplierDrawerTabs({
  active,
  onChange,
}: {
  active: SupplierDrawerTabId;
  onChange: (id: SupplierDrawerTabId) => void;
}) {
  return (
    <div className="ee-drawer-tabs" role="tablist" aria-label="Supplier sections">
      {SUPPLIER_DRAWER_TABS.map((tab) => {
        const Icon = ICONS[tab.id];
        const on = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={on}
            className={`ee-drawer-tab ${on ? "on" : ""}`}
            onClick={() => onChange(tab.id)}
          >
            <Icon size={18} strokeWidth={1.5} aria-hidden="true" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
