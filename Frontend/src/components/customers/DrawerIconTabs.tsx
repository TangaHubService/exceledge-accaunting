import {
  Contact,
  FileText,
  FolderOpen,
  Link2,
  MapPin,
  StickyNote,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { DRAWER_TABS, type DrawerTabId } from "../../lib/customer-hub-dummy";

const ICONS: Record<DrawerTabId, LucideIcon> = {
  contact: Contact,
  address: MapPin,
  notes: StickyNote,
  payment: FileText,
  documents: FolderOpen,
  tools: Wrench,
  relationships: Link2,
};

export function DrawerIconTabs({
  active,
  onChange,
}: {
  active: DrawerTabId;
  onChange: (id: DrawerTabId) => void;
}) {
  return (
    <div className="ee-drawer-tabs" role="tablist" aria-label="Customer sections">
      {DRAWER_TABS.map((tab) => {
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
