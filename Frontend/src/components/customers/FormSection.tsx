import { ChevronDown, type LucideIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

/** Collapsible form block used inside the Add customer drawer. */
export function FormSection({
  title,
  icon: Icon,
  defaultOpen = true,
  children,
  subtitle,
}: {
  title: string;
  icon?: LucideIcon;
  defaultOpen?: boolean;
  children: ReactNode;
  subtitle?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`ee-form-section ${open ? "open" : ""}`}>
      <button type="button" className="ee-form-section-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="ee-form-section-title">
          {Icon && <Icon size={16} strokeWidth={1.5} aria-hidden="true" />}
          {title}
        </span>
        <ChevronDown size={16} strokeWidth={1.5} className="ee-form-section-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="ee-form-section-body">
          {subtitle && <p className="ee-form-section-sub">{subtitle}</p>}
          {children}
        </div>
      )}
    </section>
  );
}
