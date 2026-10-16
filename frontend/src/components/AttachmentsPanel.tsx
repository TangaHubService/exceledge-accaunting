import type { AccountingCapability } from "@exceledge/accounting-domain";
import { Download, Paperclip, Trash2 } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { dateTime } from "../lib/format";
import { useResource, useSession } from "../lib/session";
import { useFeedback } from "./feedback";
import { Loadable } from "./ui";

export type AttachableType = "Journal" | "ApBill" | "ArInvoice" | "Expense" | "FixedAsset" | "BankReconciliation" | "ControlTest";

const CAPABILITIES: Record<AttachableType, { view: AccountingCapability; attach: AccountingCapability }> = {
  Journal: { view: "journal:view", attach: "journal:create" },
  ApBill: { view: "ap:view", attach: "ap:manage" },
  ArInvoice: { view: "ar:view", attach: "ar:manage" },
  Expense: { view: "expense:view", attach: "expense:manage" },
  FixedAsset: { view: "fa:view", attach: "fa:manage" },
  BankReconciliation: { view: "bank:view", attach: "bank:manage" },
  ControlTest: { view: "control:view", attach: "control:manage" },
};

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.csv,.xlsx,.docx,.txt";
const MAX_BYTES = 10 * 1024 * 1024;

export type Attachment = {
  id: string;
  fileName: string;
  note: string | null;
  storageKey: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdByErpUserId: number | null;
  createdAt: string;
};

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Files attached to one record: list, upload, download and remove. `locked` explains why files
 * can no longer be removed (e.g. the record is posted); the server enforces the same rules.
 */
export function AttachmentsPanel({
  entityType,
  entityId,
  title = "Attachments",
  required = false,
  locked,
  onChange,
}: {
  entityType: AttachableType;
  entityId: string;
  title?: string;
  required?: boolean;
  locked?: string | null;
  onChange?: () => void;
}) {
  const { api, can, download } = useSession();
  const { toast, confirm } = useFeedback();
  const caps = CAPABILITIES[entityType];
  const docs = useResource<Attachment[]>(can(caps.view) ? `/api/v1/books/documents?${new URLSearchParams({ entityType, entityId })}` : null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const canAttach = can(caps.attach);
  const canRemove = !locked && (canAttach || can("platform:manage"));

  if (!can(caps.view)) return null;

  function changed() {
    docs.reload();
    onChange?.();
  }

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast(`${file.name} is larger than ${fileSize(MAX_BYTES)}`, { error: true });
      return;
    }
    const form = new FormData();
    form.append("entityType", entityType);
    form.append("entityId", entityId);
    if (note.trim()) form.append("note", note.trim());
    form.append("file", file);
    setBusy(true);
    try {
      await api("/api/v1/books/documents/upload", { method: "POST", body: form });
      toast(`${file.name} attached`);
      setNote("");
      changed();
    } catch (err) {
      toast((err as Error).message, { error: true });
    } finally {
      setBusy(false);
    }
  }

  async function remove(d: Attachment) {
    const ok = await confirm({ title: `Remove ${d.fileName}?`, body: "The file is deleted from storage. The removal is recorded in the audit log.", confirmLabel: "Remove", danger: true });
    if (!ok) return;
    try {
      await api(`/api/v1/books/documents/${d.id}`, { method: "DELETE" });
      toast("Attachment removed");
      changed();
    } catch (err) {
      toast((err as Error).message, { error: true });
    }
  }

  async function save(d: Attachment) {
    try {
      await download(`/api/v1/books/documents/${d.id}/download`, d.fileName);
    } catch (err) {
      toast((err as Error).message, { error: true });
    }
  }

  return (
    <>
      <div className="form-section-title" style={{ marginTop: 22 }}>
        {title}
      </div>
      <Loadable resource={docs}>
        {(rows) =>
          rows.length === 0 ? (
            <p className={required ? "text-warning" : "muted"}>{required ? "None attached yet. This entry can't be posted until one is added." : "None attached."}</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id}>
                      <td>
                        {d.fileName}
                        {d.note && <span className="sub">{d.note}</span>}
                        {!d.storageKey && <span className="sub">Reference only, no file uploaded</span>}
                      </td>
                      <td className="num nowrap muted">{d.sizeBytes != null ? fileSize(d.sizeBytes) : ""}</td>
                      <td className="num nowrap muted">{dateTime(d.createdAt)}</td>
                      <td className="num nowrap">
                        {d.storageKey && (
                          <button type="button" className="btn btn-sm" onClick={() => void save(d)} aria-label={`Download ${d.fileName}`}>
                            <Download size={14} aria-hidden="true" />
                          </button>
                        )}
                        {canRemove && (
                          <button type="button" className="btn btn-sm" onClick={() => void remove(d)} aria-label={`Remove ${d.fileName}`} style={{ marginLeft: 6 }}>
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loadable>
      {locked && (docs.data?.length ?? 0) > 0 && <p className="muted">Files can't be removed because {locked}.</p>}
      {canAttach && (
        <div className="filter-bar" style={{ marginTop: 10 }}>
          <input className="input grow" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Attachment note" maxLength={500} />
          <input ref={input} type="file" accept={ACCEPT} onChange={(e) => void upload(e)} hidden />
          <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>
            <Paperclip size={16} aria-hidden="true" />
            {busy ? "Uploading…" : "Attach file"}
          </button>
        </div>
      )}
      {canAttach && <p className="muted">PDF, images, CSV, Excel, Word or text, up to {fileSize(MAX_BYTES)}.</p>}
    </>
  );
}
