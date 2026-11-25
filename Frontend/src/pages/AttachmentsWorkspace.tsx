import { useFeedback } from "../components/feedback";
import { EmptyState, Loadable, PageHeader } from "../components/ui";
import { date, humanize } from "../lib/format";
import { useResource, useSession } from "../lib/session";

type Row = { id: string; entityType: string; fileName: string; mimeType?: string | null; sizeBytes?: number | null; storageKey?: string | null; createdAt: string };

/** Every file attached to a record the reader may see. Files are added on the record itself. */
export function AttachmentsWorkspace() {
  const { download } = useSession();
  const { toast } = useFeedback();
  const files = useResource<Row[]>("/api/v1/books/documents");
  return (
    <>
      <PageHeader title="Attachments" description="Files attached to invoices, bills, journals and other records. Add a file from the record it belongs to." />
      <Loadable resource={files}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState title="No attachments" body="Files you attach to a record appear here." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Attached to</th>
                    <th className="num">Size</th>
                    <th>Added</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <button type="button" className="btn btn-link" onClick={() => void download(`/api/v1/books/documents/${f.id}/download`, f.fileName).catch((e: Error) => toast(e.message, { error: true }))}>
                          {f.fileName}
                        </button>
                      </td>
                      <td>{humanize(f.entityType)}</td>
                      <td className="num">{f.sizeBytes ? `${Math.max(1, Math.round(f.sizeBytes / 1024)).toLocaleString("en-US")} KB` : "—"}</td>
                      <td>{date(f.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loadable>
    </>
  );
}
