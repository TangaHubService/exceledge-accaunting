import { Pencil } from "lucide-react";
import { useFeedback } from "../feedback";

/** Shared Settings “Edit” control — opens the section for changes (toast until edit drawers ship). */
export function SettingsEditButton({ section }: { section: string }) {
  const { toast } = useFeedback();
  return (
    <button
      type="button"
      className="ee-link-btn"
      onClick={() => toast(`Edit ${section} — change the fields below, then save when prompted.`)}
    >
      <Pencil size={14} strokeWidth={1.5} aria-hidden="true" /> Edit
    </button>
  );
}
