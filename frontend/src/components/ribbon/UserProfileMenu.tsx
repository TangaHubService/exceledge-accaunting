import { LogOut } from "lucide-react";
import { type CSSProperties, type RefObject, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { erpLinks } from "../../lib/config";
import { humanize } from "../../lib/format";
import { useSession } from "../../lib/session";

const SW = 1.5;

type Props = {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
};

function displayName(email: string | undefined) {
  const local = (email ?? "").split("@")[0] || "User";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

function initials(email: string | undefined) {
  const local = (email ?? "").split("@")[0];
  const parts = local.split(/[._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function UserProfileMenu({ open, onClose, anchorRef }: Props) {
  const { email, role, signOut } = useSession();
  const panelRef = useRef<HTMLDivElement>(null);
  const name = useMemo(() => displayName(email), [email]);
  const badge = role ? humanize(role) : "Administrator";

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const anchor = anchorRef.current?.getBoundingClientRect();
  const style: CSSProperties = anchor
    ? {
        top: Math.round(anchor.bottom + 8),
        right: Math.max(12, Math.round(window.innerWidth - anchor.right)),
      }
    : { top: 56, right: 16 };

  return createPortal(
    <div
      ref={panelRef}
      className="ee-profile-menu"
      style={style}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ee-profile-name"
    >
      <div className="ee-profile-avatar" aria-hidden="true">
        {initials(email)}
      </div>
      <div id="ee-profile-name" className="ee-profile-name">
        {name}
      </div>
      <div className="ee-profile-email">{email ?? ""}</div>
      <span className="ee-profile-badge">{badge === "Admin" ? "Administrator" : badge}</span>
      <a
        className="ee-profile-manage"
        href={erpLinks.home}
        onClick={(e) => {
          e.preventDefault();
          onClose();
          window.location.assign(erpLinks.home);
        }}
      >
        Manage your Excel Edge account
      </a>
      <div className="ee-profile-divider" />
      <button
        type="button"
        className="ee-profile-signout"
        onClick={() => {
          onClose();
          signOut();
        }}
      >
        <LogOut size={16} strokeWidth={SW} />
        Sign out
      </button>
    </div>,
    document.body,
  );
}
