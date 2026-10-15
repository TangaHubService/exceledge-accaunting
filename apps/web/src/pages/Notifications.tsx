import { useState } from "react";
import { useFeedback } from "../components/feedback";
import { Badge, EmptyState, Loadable, PageHeader, type Tone } from "../components/ui";
import { type AppNotification, entityHref, NOTIFICATIONS_CHANGED } from "../lib/approvals";
import { dateTime, humanize } from "../lib/format";
import { Link } from "../lib/router";
import { useResource, useSession } from "../lib/session";

const SEVERITY_TONE: Record<AppNotification["severity"], Tone> = { INFO: "info", WARNING: "warning", CRITICAL: "negative" };

export function Notifications() {
  const { api } = useSession();
  const { toast } = useFeedback();
  const notes = useResource<AppNotification[]>("/api/v1/books/notifications");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  async function act(path: string, message?: string) {
    setBusy(true);
    try {
      await api(path, { method: "POST", body: "{}" });
      if (message) toast(message);
      notes.reload();
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy(false);
    }
  }

  const unread = (notes.data ?? []).filter((n) => !n.read).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Alerts addressed to you or your role: approvals waiting, returned journals and other things that need attention."
        actions={
          unread > 0 && (
            <button type="button" className="btn" disabled={busy} onClick={() => void act("/api/v1/books/notifications/read-all", "All notifications marked as read")}>
              Mark all as read
            </button>
          )
        }
      />

      <div className="filter-bar">
        <div className="segmented" role="group" aria-label="Filter notifications">
          <button type="button" className={!unreadOnly ? "on" : ""} onClick={() => setUnreadOnly(false)}>
            All
          </button>
          <button type="button" className={unreadOnly ? "on" : ""} onClick={() => setUnreadOnly(true)}>
            Unread<span className="count">{unread}</span>
          </button>
        </div>
      </div>

      <Loadable resource={notes}>
        {(all) => {
          const rows = unreadOnly ? all.filter((n) => !n.read) : all;
          if (rows.length === 0) {
            return (
              <div className="panel">
                <EmptyState title={unreadOnly ? "You're all caught up" : "No notifications yet"} />
              </div>
            );
          }
          return (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {rows.map((n) => {
                    const href = entityHref(n.entityType, n.entityId);
                    return (
                      <tr key={n.id} className={n.read ? "row-inactive" : undefined}>
                        <td className="nowrap" style={{ width: 170 }}>
                          {dateTime(n.createdAt)}
                          {n.read && n.readAt && <span className="sub">Read {dateTime(n.readAt)}</span>}
                        </td>
                        <td style={{ width: 100 }}>
                          <Badge tone={SEVERITY_TONE[n.severity] ?? "neutral"}>{humanize(n.severity)}</Badge>
                        </td>
                        <td>
                          {n.read ? n.title : <strong>{n.title}</strong>}
                          <span className="sub">{n.body}</span>
                          {href && (
                            <span className="sub">
                              <Link to={href} onClick={() => !n.read && void act(`/api/v1/books/notifications/${n.id}/read`)}>
                                Open
                              </Link>
                            </span>
                          )}
                        </td>
                        <td className="num nowrap">
                          {!n.read && (
                            <button type="button" className="btn" disabled={busy} onClick={() => void act(`/api/v1/books/notifications/${n.id}/read`)}>
                              Mark read
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        }}
      </Loadable>
    </>
  );
}
