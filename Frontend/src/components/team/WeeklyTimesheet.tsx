import {
  BookOpen,
  ChevronDown,
  Clock,
  Download,
  HelpCircle,
  MessageSquarePlus,
  Printer,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { navigate } from "../../lib/router";
import {
  TIME_CUSTOMER_OPTIONS,
  TIME_NAME_OPTIONS,
  TIME_SERVICE_OPTIONS,
  weekDayHeaders,
  weekRangeLabel,
} from "../../lib/team-dummy";
import { useFeedback } from "../feedback";

type DayKey = string;

type Row = {
  id: string;
  customer: string;
  service: string;
  billable: boolean;
  notes: string;
  hours: Record<DayKey, string>;
};

function emptyRow(): Row {
  const days = weekDayHeaders();
  return {
    id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    customer: "",
    service: "",
    billable: false,
    notes: "",
    hours: Object.fromEntries(days.map((d) => [d.key, ""])),
  };
}

function parseMinutes(value: string) {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function formatMinutes(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function WeeklyTimesheet() {
  const { toast } = useFeedback();
  const days = useMemo(() => weekDayHeaders(), []);
  const weekLabel = useMemo(() => weekRangeLabel(), []);
  const [name, setName] = useState("");
  const [rows, setRows] = useState<Row[]>(() => [emptyRow(), emptyRow(), emptyRow()]);

  function close() {
    navigate("/employees");
  }

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function setHour(id: string, day: DayKey, value: string) {
    setRows((list) =>
      list.map((r) => (r.id === id ? { ...r, hours: { ...r.hours, [day]: value } } : r)),
    );
  }

  function rowTotal(row: Row) {
    return days.reduce((sum, d) => sum + parseMinutes(row.hours[d.key] ?? ""), 0);
  }

  function dayTotal(day: DayKey) {
    return rows.reduce((sum, r) => sum + parseMinutes(r.hours[day] ?? ""), 0);
  }

  const grandTotal = rows.reduce((sum, r) => sum + rowTotal(r), 0);

  function save(andNew: boolean) {
    toast(andNew ? "Timesheet saved — ready for another" : "Timesheet saved");
    if (andNew) {
      setRows([emptyRow(), emptyRow(), emptyRow()]);
      return;
    }
    close();
  }

  return (
    <div className="ee-time-page ee-weekly-page">
      <header className="ee-time-top">
        <div className="ee-time-brand">
          <img src="/logo.jpeg" alt="" width={28} height={28} />
          <span>Excel Edge ERP</span>
          <span className="ee-time-sep" />
          <span className="ee-time-title-icon" aria-hidden="true">
            <Clock size={18} strokeWidth={1.5} />
          </span>
          <strong>Weekly timesheet</strong>
        </div>
        <div className="ee-time-top-actions">
          <button type="button" className="ee-settings-top-link">
            <BookOpen size={15} strokeWidth={1.5} /> Learn more
          </button>
          <button type="button" className="ee-settings-top-link">
            <MessageSquarePlus size={15} strokeWidth={1.5} /> Give feedback
          </button>
          <button type="button" className="ee-icon-btn" aria-label="Settings">
            <Settings size={18} strokeWidth={1.5} />
          </button>
          <span className="ee-time-sep" />
          <button type="button" className="ee-icon-btn" aria-label="Close" onClick={close}>
            <X size={20} strokeWidth={1.5} />
          </button>
        </div>
      </header>

      <div className="ee-weekly-body">
        <div className="ee-weekly-controls">
          <label className="field">
            <span>Name</span>
            <select className="input" value={name} onChange={(e) => setName(e.target.value)}>
              {TIME_NAME_OPTIONS.map((o) => (
                <option key={o.value || "n"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Select a week</span>
            <select className="input" defaultValue={weekLabel}>
              <option value={weekLabel}>{weekLabel.replace("Oct", "Oct")}</option>
            </select>
          </label>
          <div className="ee-weekly-tools">
            <button type="button" className="ee-icon-btn" aria-label="Export">
              <Download size={16} strokeWidth={1.5} />
            </button>
            <button type="button" className="ee-icon-btn" aria-label="Print">
              <Printer size={16} strokeWidth={1.5} />
            </button>
            <button type="button" className="ee-icon-btn" aria-label="Settings">
              <Settings size={16} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        <div className="ee-weekly-grid" role="table" aria-label="Weekly timesheet">
          <div className="ee-weekly-head" role="row">
            <div className="ee-weekly-job-head">Job Details</div>
            <div className="ee-weekly-days-head">
              {days.map((d) => (
                <div key={d.key} className="ee-weekly-day-head">
                  <span>{d.label}</span>
                  <span className="ee-weekly-day-sum">{formatMinutes(dayTotal(d.key))}</span>
                </div>
              ))}
            </div>
            <div className="ee-weekly-sum-head">
              <span>Total</span>
              <span className="ee-weekly-day-sum">{formatMinutes(grandTotal)}</span>
            </div>
            <div className="ee-weekly-sum-head">
              <span>Billable</span>
              <span className="ee-weekly-day-sum">RWF 0.00</span>
            </div>
            <div className="ee-weekly-trash-col" />
          </div>

          {rows.map((row) => (
            <div key={row.id} className="ee-weekly-row" role="row">
              <div className="ee-weekly-job">
                <label className="field">
                  <span>Customer</span>
                  <select
                    className="input"
                    value={row.customer}
                    onChange={(e) => updateRow(row.id, { customer: e.target.value })}
                  >
                    {TIME_CUSTOMER_OPTIONS.map((o) => (
                      <option key={o.value || "c"} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Service</span>
                  <select
                    className="input"
                    value={row.service}
                    onChange={(e) => updateRow(row.id, { service: e.target.value })}
                  >
                    {TIME_SERVICE_OPTIONS.map((o) => (
                      <option key={o.value || "s"} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ee-time-check">
                  <input
                    type="checkbox"
                    checked={row.billable}
                    onChange={(e) => updateRow(row.id, { billable: e.target.checked })}
                  />
                  <span>Billable (per hour)</span>
                  <HelpCircle size={14} strokeWidth={1.5} className="ee-time-help" aria-hidden="true" />
                </label>
              </div>

              <div className="ee-weekly-hours">
                <div className="ee-weekly-hour-inputs">
                  {days.map((d) => (
                    <input
                      key={d.key}
                      className="input ee-weekly-hour"
                      value={row.hours[d.key] ?? ""}
                      onChange={(e) => setHour(row.id, d.key, e.target.value)}
                      placeholder="hh:mm"
                      aria-label={`${d.label} hours`}
                    />
                  ))}
                </div>
                <textarea
                  className="input ee-weekly-notes"
                  value={row.notes}
                  onChange={(e) => updateRow(row.id, { notes: e.target.value })}
                  placeholder="Notes"
                  rows={2}
                />
              </div>

              <div className="ee-weekly-row-total">{formatMinutes(rowTotal(row))}</div>
              <div className="ee-weekly-row-bill">RWF 0.00</div>
              <button
                type="button"
                className="ee-icon-btn ee-weekly-trash"
                aria-label="Delete line"
                onClick={() => setRows((list) => (list.length > 1 ? list.filter((r) => r.id !== row.id) : list))}
              >
                <Trash2 size={16} strokeWidth={1.5} />
              </button>
            </div>
          ))}
        </div>

        <div className="ee-weekly-line-actions">
          <button type="button" className="btn ee-btn-outline-blue" onClick={() => setRows((list) => [...list, emptyRow()])}>
            + Add more lines
          </button>
          <button type="button" className="btn ee-btn-outline-blue" onClick={() => setRows([emptyRow()])}>
            Clear all lines
          </button>
        </div>
      </div>

      <footer className="ee-time-foot ee-weekly-foot">
        <button type="button" className="btn ee-btn-outline-blue" onClick={close}>
          Cancel
        </button>
        <button type="button" className="ee-link-btn" onClick={() => toast("Copied last timesheet")}>
          Copy last timesheet
        </button>
        <div className="ee-time-foot-right">
          <button type="button" className="btn ee-btn-outline-blue" onClick={() => save(false)}>
            Save
          </button>
          <div className="ee-split-btn">
            <button type="button" className="btn btn-primary" onClick={() => save(true)}>
              Save and new
            </button>
            <button type="button" className="btn btn-primary ee-split-caret" aria-label="More save options">
              <ChevronDown size={16} />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
