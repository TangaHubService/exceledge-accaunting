import { BookOpen, ChevronDown, Clock, HelpCircle, MessageSquarePlus, Settings, X } from "lucide-react";
import { useMemo, useState } from "react";
import { navigate } from "../../lib/router";
import { useResource, useSession } from "../../lib/session";
import { employeeFromServer, TIME_SERVICE_OPTIONS } from "../../lib/team-dummy";
import { useCustomers } from "../../lib/txn";
import { useFeedback } from "../feedback";

export function SingleTimeActivity() {
  const { toast } = useFeedback();
  const { api, can } = useSession();
  const { customers } = useCustomers();
  const staff = useResource<Array<Record<string, unknown>>>(can("team:view") ? "/api/v1/team/employees" : null);
  const nameOptions = useMemo(() => [{ value: "", label: "Choose name" }, ...(staff.data ?? []).map(employeeFromServer).map((e) => ({ value: e.id, label: e.displayName }))], [staff.data]);
  const customerChoices = useMemo(() => [{ value: "", label: "Choose customer" }, ...customers.map((c) => ({ value: c.id, label: c.name }))], [customers]);
  const [name, setName] = useState("");
  const [customer, setCustomer] = useState("");
  const [service, setService] = useState("");
  const [billable, setBillable] = useState(false);
  const [setTimes, setSetTimes] = useState(false);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");

  function close() {
    navigate("/employees");
  }

  async function save(andNew: boolean) {
    const match = /^(\d{1,2})(?::(\d{2}))?$/.exec(duration.trim());
    const durationMinutes = match ? Number(match[1]) * 60 + Number(match[2] ?? 0) : 0;
    if (!name) return toast("Choose who did the work", { error: true });
    if (!durationMinutes) return toast("Enter the duration as hh:mm", { error: true });
    try {
      await api("/api/v1/team/time", {
        method: "POST",
        body: JSON.stringify({ employeeId: name, customerId: customer || null, service: TIME_SERVICE_OPTIONS.find((o) => o.value === service)?.label ?? service, billable, date: startDate, durationMinutes, notes }),
      });
    } catch (error) {
      return toast((error as Error).message, { error: true });
    }
    toast(andNew ? "Time activity saved — ready for another" : "Time activity saved");
    if (andNew) {
      setCustomer("");
      setService("");
      setBillable(false);
      setDuration("");
      setNotes("");
      return;
    }
    close();
  }

  return (
    <div className="ee-time-page">
      <header className="ee-time-top">
        <div className="ee-time-brand">
          <img src="/logo.jpeg" alt="" width={28} height={28} />
          <span>Excel Edge ERP</span>
          <span className="ee-time-sep" />
          <span className="ee-time-title-icon" aria-hidden="true">
            <Clock size={18} strokeWidth={1.5} />
          </span>
          <div>
            <strong>Single time activity</strong>
            <div className="ee-time-sub">Single day entry</div>
          </div>
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

      <div className="ee-time-body">
        <form
          className="ee-time-card"
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          <div className="ee-time-cols">
            <div className="ee-time-col">
              <label className="field">
                <span>Name</span>
                <select className="input" value={name} onChange={(e) => setName(e.target.value)}>
                  {nameOptions.map((o) => (
                    <option key={o.value || "n"} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Customer</span>
                <select className="input" value={customer} onChange={(e) => setCustomer(e.target.value)}>
                  {customerChoices.map((o) => (
                    <option key={o.value || "c"} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Service</span>
                <select className="input" value={service} onChange={(e) => setService(e.target.value)}>
                  {TIME_SERVICE_OPTIONS.map((o) => (
                    <option key={o.value || "s"} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ee-time-check">
                <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
                <span>Billable (per hour)</span>
                <HelpCircle size={14} strokeWidth={1.5} className="ee-time-help" aria-hidden="true" />
              </label>
            </div>

            <div className="ee-time-col">
              <label className="ee-time-toggle">
                <span>Set start and end time</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={setTimes}
                  className={`ee-switch ${setTimes ? "on" : ""}`}
                  onClick={() => setSetTimes((v) => !v)}
                >
                  <span className="ee-switch-knob" />
                </button>
              </label>
              <label className="field">
                <span>Start date</span>
                <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </label>
              <label className="field">
                <span>Duration (hh:mm)</span>
                <input className="input" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="hh:mm" />
              </label>
              <label className="field">
                <span>Notes</span>
                <textarea className="input ee-time-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} />
              </label>
            </div>
          </div>
        </form>
      </div>

      <footer className="ee-time-foot">
        <button type="button" className="btn ee-btn-outline-blue" onClick={close}>
          Cancel
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
