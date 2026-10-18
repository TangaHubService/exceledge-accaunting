import { Paperclip, StickyNote } from "lucide-react";
import type { CustomerDraft } from "../../../lib/customer-hub-dummy";
import { Field } from "../../ui";
import { FormSection } from "../FormSection";

export function NotesTab({
  draft,
  set,
}: {
  draft: CustomerDraft;
  set: <K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) => void;
}) {
  return (
    <FormSection title="Notes and attachments" icon={StickyNote}>
      <Field label="Notes" className="span-2">
        <textarea
          className="input ee-notes-area"
          rows={5}
          value={draft.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Add a note about this customer…"
        />
      </Field>

      <div className="ee-attach-zone">
        <Paperclip size={16} strokeWidth={1.5} aria-hidden="true" />
        <div>
          <button type="button" className="ee-link-btn">
            Add attachment
          </button>
          <p className="muted small">Max file size: 20 MB</p>
        </div>
      </div>
    </FormSection>
  );
}
