import {
  Check,
  ChevronDown,
  ExternalLink,
  List,
  Maximize2,
  Printer,
  Search,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Menu } from "../components/ui";
import { useFeedback } from "../components/feedback";
import { amount, date } from "../lib/format";
import { navigate } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import { type RecurringTemplate, TXN_LABELS, type TxnKind } from "../lib/txn";

/** Each type opens its form; "Make recurring" there saves the template with the form's contents. */
const FORMS: Record<string, string> = {
  Bill: "/expenses/bill/new",
  "Non-Posting Charge": "/sales/delayed-charge/new",
  Cheque: "/expenses/cheque/new",
  "Non-Posting Credit": "/sales/delayed-credit/new",
  "Credit Card Credit": "/expenses/credit-card-credit/new",
  "Credit Note": "/sales/credit-note/new",
  Deposit: "/banking/deposit/new",
  Invoice: "/sales/invoice/new",
  "Journal Entry": "/accounting/journal-entry/new",
  Refund: "/sales/refund-receipt/new",
  "Sales Receipt": "/sales/sales-receipt/new",
  Transfer: "/banking/transfer/new",
};
const TRANSACTION_TYPES = Object.keys(FORMS);
const UNIT = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" } as const;
const FORM_OF: Partial<Record<TxnKind, string>> = { cheque: FORMS.Cheque, transfer: FORMS.Transfer, journal: FORMS["Journal Entry"], "bank-deposit": FORMS.Deposit, "credit-note": FORMS["Credit Note"], "refund-receipt": FORMS.Refund, "sales-receipt": FORMS["Sales Receipt"], "delayed-charge": FORMS["Non-Posting Charge"], "delayed-credit": FORMS["Non-Posting Credit"], "credit-card-credit": FORMS["Credit Card Credit"], "supplier-credit": "/expenses/supplier-credit/new", "purchase-order": "/expenses/purchase-order/new", invoice: FORMS.Invoice, bill: FORMS.Bill };

const intervalText = (t: RecurringTemplate) => (t.mode === "UNSCHEDULED" ? "Unscheduled" : `Every ${t.every > 1 ? `${t.every} ${UNIT[t.interval]}s` : UNIT[t.interval]}`);

export function RecurringTxnTypes() {
  const { toast } = useFeedback();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedType, setSelectedType] = useState("Bill");
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");

  const { confirm } = useFeedback();
  const { api } = useSession();
  const res = useResource<RecurringTemplate[]>("/api/v1/recurring");
  const [remindersOnly, setRemindersOnly] = useState(false);
  const rows = useMemo(
    () => (res.data ?? []).filter((t) => (!remindersOnly || t.mode === "REMINDER") && t.name.toLowerCase().includes(searchFilter.trim().toLowerCase())),
    [res.data, remindersOnly, searchFilter],
  );
  const perPage = 25;
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const current = Math.min(page, pages - 1);

  function handleCreateTemplate() {
    setModalOpen(false);
    toast(`Fill in the form, then choose Make recurring`);
    navigate(FORMS[selectedType]);
  }

  async function run(action: () => Promise<string>) {
    try {
      toast(await action());
      res.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  const use = (t: RecurringTemplate) => {
    if (t.mode === "REMINDER") return navigate(FORM_OF[t.kind] ?? "/");
    return run(async () => {
      if (!(await confirm({ title: `Create from ${t.name}?`, body: `A ${TXN_LABELS[t.kind].toLowerCase()} dated today will be created now. The schedule doesn't change.`, confirmLabel: "Create" }))) return "Nothing was created";
      const made = await api<{ number: string | null }>(`/api/v1/recurring/${t.id}/use`, { method: "POST", body: "{}" });
      return `${TXN_LABELS[t.kind]} ${made.number ?? ""} created`;
    });
  };
  const toggle = (t: RecurringTemplate) =>
    run(async () => {
      const { kind, mode, name, interval, every, startDate, endDate, daysInAdvance, partyName, amount: total, payload } = t;
      await api(`/api/v1/recurring/${t.id}`, { method: "PUT", body: JSON.stringify({ kind, mode, name, interval, every, startDate, endDate, daysInAdvance, partyName, amount: total, payload, isActive: !t.isActive }) });
      return t.isActive ? `${t.name} paused` : `${t.name} resumed`;
    });
  const remove = (t: RecurringTemplate) =>
    run(async () => {
      if (!(await confirm({ title: `Delete ${t.name}?`, body: "Transactions it already created stay in the books.", confirmLabel: "Delete", danger: true }))) return "Nothing was deleted";
      await api(`/api/v1/recurring/${t.id}`, { method: "DELETE" });
      return `${t.name} deleted`;
    });

  return (
    <div className="ee-rec-container">
      {/* Top breadcrumb & quick links matching mockup 63 & 64 */}
      <div className="ee-rec-top-bar">
        <div style={{ fontSize: "var(--fs-md)", color: "#64748b" }}>
          <span>Accounting</span>
          <span style={{ margin: "0 6px" }}>/</span>
          <span style={{ color: "#0c1c38", fontWeight: 500 }}>Recurring transactions</span>
        </div>

        <div className="ee-rec-top-actions">
          <a
            href="/lists"
            onClick={(e) => {
              e.preventDefault();
              navigate("/lists");
            }}
            className="ee-rec-top-link"
          >
            <List size={15} />
            <span>All lists</span>
          </a>


          <button
            type="button"
            className="ee-icon-btn"
            style={{ padding: 2 }}
            onClick={() => window.open(window.location.href, "_blank")}
            title="Open in new window"
          >
            <ExternalLink size={15} />
          </button>

          <button
            type="button"
            className="ee-icon-btn"
            style={{ padding: 2 }}
            onClick={() => {
              if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
              } else {
                document.exitFullscreen().catch(() => {});
              }
            }}
            title="Fullscreen"
          >
            <Maximize2 size={15} />
          </button>
        </div>
      </div>

      {/* Header row */}
      <div className="ee-rec-header-row">
        <h1 className="ee-lists-title" style={{ margin: 0 }}>
          Recurring transactions
        </h1>

        <div className="ee-rec-header-actions">
          <button
            type="button"
            className="ee-btn-reminder-list"
            aria-pressed={remindersOnly}
            onClick={() => setRemindersOnly((v) => !v)}
          >
            <span>{remindersOnly ? "All templates" : "Reminder list"}</span>
            <ChevronDown size={14} />
          </button>

          <button
            type="button"
            className="ee-btn-primary-blue"
            onClick={() => setModalOpen(true)}
          >
            New
          </button>
        </div>
      </div>

      {/* Toolbar row with search & settings */}
      <div className="ee-table-toolbar">
        <div className="ee-search-input-wrap">
          <Search size={16} className="ee-search-icon" />
          <input
            type="text"
            className="ee-search-input"
            placeholder="Filter by name"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
        </div>

        <div className="ee-toolbar-icons">
          <button
            type="button"
            className="ee-icon-btn"
            onClick={() => window.print()}
            title="Print"
          >
            <Printer size={18} />
          </button>
        </div>
      </div>

      {/* Table matching mockup 63 & 64 */}
      <div className="ee-mockup-table-wrap">
        <table className="ee-mockup-table">
          <thead>
            <tr>
              <th style={{ width: "20%" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span>TEMPLATE NAME</span>
                  <span style={{ fontSize: "var(--fs-2xs)" }}>▲</span>
                </div>
              </th>
              <th>TYPE</th>
              <th>INTERVAL</th>
              <th>PREVIOUS DATE</th>
              <th>NEXT DATE</th>
              <th>CUSTOMER/SUPPLIER</th>
              <th>AMOUNT</th>
              <th>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(current * perPage, (current + 1) * perPage).map((t) => (
              <tr key={t.id}>
                <td>
                  {t.name}
                  {t.isActive ? null : <span className="muted small"> · Paused</span>}
                  {t.lastError ? <div className="text-negative small">{t.lastError}</div> : null}
                </td>
                <td>{TXN_LABELS[t.kind]}</td>
                <td>{intervalText(t)}</td>
                <td>{t.previousDate ? date(t.previousDate) : "—"}</td>
                <td>{t.isActive && t.nextDate ? date(t.nextDate) : "—"}</td>
                <td>{t.partyName ?? "—"}</td>
                <td className="num">{t.amount === null ? "—" : amount(t.amount)}</td>
                <td>
                  <Menu
                    label="Actions"
                    triggerClassName="ee-link-btn"
                    items={[
                      { label: "Use", onSelect: () => void use(t) },
                      { label: t.isActive ? "Pause" : "Resume", onSelect: () => void toggle(t) },
                      { label: "Delete", onSelect: () => void remove(t) },
                    ]}
                  />
                </td>
              </tr>
            ))}
            {rows.length ? null : (
              <tr className="ee-table-empty-row">
                <td colSpan={8}>{res.error ?? (res.loading ? "Loading…" : "0 results matching the criteria.")}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="ee-table-pagination">
          <span>{rows.length} result{rows.length === 1 ? "" : "s"}</span>
          <button type="button" className="ee-page-btn" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}>
            &lt;
          </button>
          <button type="button" className="ee-page-btn" aria-label="Next page" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            &gt;
          </button>
        </div>
      </div>

      {/* Modal dialog matching mockups 63 & 64 */}
      {modalOpen && (
        <div className="ee-modal-backdrop" onClick={() => setModalOpen(false)}>
          <div
            className="ee-modal-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="ee-modal-top">
              <h2 id="modal-title" className="ee-modal-title">
                Select transaction type
              </h2>
              <button
                type="button"
                className="ee-drawer-close-btn"
                onClick={() => setModalOpen(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <p className="ee-modal-sub">Select the type of template to create.</p>

            <div style={{ marginBottom: 6 }}>
              <label className="ee-field-label">Transaction type</label>
            </div>

            <div className="ee-modal-menu-wrap">
              <div
                className="ee-modal-select-trigger"
                onClick={() => setTypeDropdownOpen((o) => !o)}
                role="button"
                tabIndex={0}
              >
                <span>{selectedType}</span>
                <ChevronDown size={16} />
              </div>

              {typeDropdownOpen && (
                <div className="ee-modal-dropdown-list">
                  {TRANSACTION_TYPES.map((t) => (
                    <div
                      key={t}
                      className={`ee-modal-dropdown-item ${t === selectedType ? "selected" : ""}`}
                      onClick={() => {
                        setSelectedType(t);
                        setTypeDropdownOpen(false);
                      }}
                    >
                      {t === selectedType && <Check size={14} strokeWidth={3} />}
                      <span style={{ paddingLeft: t === selectedType ? 0 : 20 }}>{t}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="ee-modal-actions">
              <button
                type="button"
                className="ee-btn-ghost-cancel"
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ee-btn-primary-blue"
                onClick={handleCreateTemplate}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
