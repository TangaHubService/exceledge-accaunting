import { Badge, EmptyState, Loadable, PageHeader } from "../components/ui";
import { dateTime } from "../lib/format";
import { useResource } from "../lib/session";

type Run = { id: string; status: "RUNNING" | "DONE" | "VERIFIED" | "FAILED"; fileName: string | null; sizeBytes: number | null; startedAt: string };
const STATUS = { RUNNING: ["Running", "info"], DONE: ["Saved, not tested", "warning"], VERIFIED: ["Restore tested", "positive"], FAILED: ["Failed", "negative"] } as const;

export function Backups() {
  const res = useResource<{ scheduled: boolean; keep: number; runs: Run[] }>("/api/v1/workspace/backups");
  return (
    <>
      <PageHeader title="Backups" description="Each backup is restored into a scratch database to prove it works. Restoring the live books is done on the server by your administrator." />
      <Loadable resource={res}>
        {(d) => (
          <>
            <p className={d.scheduled ? "muted" : "text-warning"}>{d.scheduled ? `A backup is taken every day and the newest ${d.keep} are kept.` : "Daily backups are off. Your administrator turns them on by setting BACKUP_DIR on the server."}</p>
            {d.runs.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Started</th><th>File</th><th className="num">Size</th><th>Result</th></tr></thead>
                  <tbody>
                    {d.runs.map((r) => (
                      <tr key={r.id}>
                        <td className="nowrap">{dateTime(r.startedAt)}</td>
                        <td>{r.fileName}{r.status === "FAILED" && <span className="sub">The reason is in the server log.</span>}</td>
                        <td className="num nowrap">{r.sizeBytes == null ? "" : `${(r.sizeBytes / 1048576).toFixed(1)} MB`}</td>
                        <td><Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No backups yet" />
            )}
          </>
        )}
      </Loadable>
    </>
  );
}
