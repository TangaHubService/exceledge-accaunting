import { Download } from "lucide-react";
import { useState } from "react";
import { useSession } from "../lib/session";
import { useFeedback } from "./feedback";

const FORMATS = [
  { format: "csv", label: "CSV" },
  { format: "xlsx", label: "Excel" },
  { format: "pdf", label: "PDF" },
] as const;

/** Downloads `path` (a report endpoint) with `format=csv|xlsx|pdf` added, using the signed-in session. */
export function ExportButtons({ path, filename }: { path: string; filename: string }) {
  const { download } = useSession();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState<string | null>(null);
  const href = (format: string) => `${path}${path.includes("?") ? "&" : "?"}format=${format}`;
  return (
    <div className="no-print" style={{ display: "inline-flex", gap: 6 }} role="group" aria-label="Export">
      {FORMATS.map(({ format, label }) => (
        <button
          key={format}
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() => {
            setBusy(format);
            download(href(format), `${filename}.${format}`)
              .catch((err: Error) => toast(err.message, { error: true }))
              .finally(() => setBusy(null));
          }}
        >
          <Download size={14} aria-hidden="true" />
          {busy === format ? "Preparing…" : label}
        </button>
      ))}
    </div>
  );
}
