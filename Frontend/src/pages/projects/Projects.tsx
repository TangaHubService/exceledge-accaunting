import {
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Mail,
  NotebookPen,
  PieChart,
  Plus,
  Receipt,
  RefreshCw,
  Star,
  Trash2,
  UploadCloud,
  UserRound,
  Wallet,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useFeedback } from "../../components/feedback";
import { Select } from "../../components/Select";
import { fileSize, Modal, TField } from "../../components/txn/TxnKit";
import { amount, date, isoDay } from "../../lib/format";
import { Link, navigate } from "../../lib/router";
import { fileToDataUrl, type Project, PROJECT_FILE_MAX, PROJECT_STATUSES, type ProjectStatus, saveProject, statusLabel, useProjectFigures, useProjects } from "../../lib/projects";
import { COST_KINDS, INCOME_KINDS, monthsAgo, newId, removeLocal, TXN_LABELS, type TxnIndexRow, type TxnKind, useTxnIndex } from "../../lib/txn";

const money = (n: number) => `RWF${amount(n, 2)}`;

/* ── Projects list / empty state (154) ─────────────────── */

export function ProjectsPage() {
  const projects = useProjects();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const list = projects.filter((p) => (!status || p.status === status) && (!q || `${p.name} ${p.customerName} ${p.code}`.toLowerCase().includes(q.toLowerCase())));

  if (!projects.length) {
    return (
      <div className="prj-page">
        <h1 className="prj-title">Projects</h1>
        <div className="prj-empty">
          <PuzzleArt />
          <h2>See all the pieces fit together</h2>
          <p>Get a better picture of your project when you tag transactions to that project and run related reports.</p>
          <button type="button" className="prj-primary" onClick={() => navigate("/projects/new")}>
            Add your first project
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="prj-page">
      <div className="prj-list-head">
        <h1 className="prj-title">Projects</h1>
        <button type="button" className="prj-primary sm" onClick={() => navigate("/projects/new")}>
          <Plus size={18} /> New project
        </button>
      </div>
      <div className="prj-filters">
        <input className="input" placeholder="Search projects, customers or IDs" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
        <Select value={status} onChange={setStatus} searchable={false} options={[{ value: "", label: "All statuses" }, ...PROJECT_STATUSES]} />
      </div>
      <div className="prj-cards">
        {list.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
        {!list.length ? <p className="muted">No projects match these filters.</p> : null}
      </div>
    </div>
  );
}

function ProjectCard({ project: p }: { project: Project }) {
  const f = useProjectFigures(p.id);
  return (
    <Link to={`/projects/${p.id}`} className="prj-card">
      <div className="prj-card-top">
        <strong>{p.name}</strong>
        {p.starred ? <Star size={16} fill="currentColor" className="prj-star" /> : null}
      </div>
      <span className="muted">
        {p.customerName} · ID {p.code}
      </span>
      <span className={`prj-status s-${p.status}`}>{statusLabel(p.status)}</span>
      <div className="prj-card-figs">
        <span>
          Income <strong>{money(f.income)}</strong>
        </span>
        <span>
          Costs <strong>{money(f.costs)}</strong>
        </span>
        <span>
          Progress <strong>{p.progress}%</strong>
        </span>
      </div>
    </Link>
  );
}

function PuzzleArt() {
  return (
    <svg width="460" height="160" viewBox="0 0 460 160" aria-hidden="true">
      <path d="M40 40l46-8 4 22c8-6 22-2 22 10s-12 18-20 12l4 24-46 8-4-22c-8 6-22 2-22-10s14-16 20-10z" fill="#1238e6" />
      <path d="M118 84c40 40 90 10 120-10s70-24 90-6" fill="none" stroke="#2c4fd6" strokeWidth="2.5" strokeDasharray="2 6" strokeLinecap="round" />
      <rect x="330" y="12" width="128" height="134" rx="8" fill="#eef3ff" stroke="#1238e6" strokeWidth="3" />
      <path d="M394 12v40c-10-6-22 2-22 12s12 18 22 12v70M330 78h40c-6 10 2 22 12 22s18-12 12-22h64" fill="none" stroke="#1238e6" strokeWidth="3" />
    </svg>
  );
}

/* ── Project detail (156–162) ──────────────────────────── */

const TABS = ["Summary", "Transactions", "Time Activity", "Project Reports", "Project Details", "Attachments"] as const;
type Tab = (typeof TABS)[number];

const TOUR = [
  ["Your project at a glance", "The header shows the customer, status and how far along the project is."],
  ["Change the status", "Use the status menu to mark the project as started, finished or cancelled."],
  ["Track progress", "Select the pencil next to Project progress to update the percentage complete."],
  ["Summary", "Income, costs and profit are worked out from the transactions tagged to this project."],
  ["Transactions", "Every estimate, invoice, bill or expense you add from here is tagged to the project."],
  ["Reports", "Project reports show profitability, unbilled time and estimates versus actuals."],
  ["Keep organised", "See all the pieces of your project in one place. Add an estimate, an invoice, a bill, or expense."],
];

const ADD_TO_PROJECT: Array<{ label: string; to: string }> = [
  { label: "Estimate", to: "/sales/estimate/new" },
  { label: "Invoice", to: "/sales/invoice/new" },
  { label: "Sales receipt", to: "/sales/sales-receipt/new" },
  { label: "Bill", to: "/expenses/bill/new" },
  { label: "Purchase order", to: "/expenses/purchase-order/new" },
  { label: "Cheque", to: "/expenses/cheque/new" },
  { label: "Time activity", to: "/time/single" },
];

export function ProjectDetail({ id }: { id: string }) {
  const projects = useProjects();
  const project = projects.find((p) => p.id === id);
  const { toast } = useFeedback();
  const [tab, setTab] = useState<Tab>("Summary");
  const [statusOpen, setStatusOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [progressEdit, setProgressEdit] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [tour, setTour] = useState<number | null>(() => {
    try {
      return localStorage.getItem("ee.projects.tourDone") ? null : 0;
    } catch {
      return null;
    }
  });
  const [txnFilter, setTxnFilter] = useState("ALL");

  if (!project) {
    return (
      <div className="prj-page">
        <Link to="/projects" className="prj-back">
          <ChevronLeft size={20} /> All projects
        </Link>
        <p className="muted">This project doesn't exist in this browser.</p>
      </div>
    );
  }
  const p = project;
  const update = (patch: Partial<Project>) => saveProject({ ...p, ...patch });
  const qs = `project=${p.id}&customer=${p.customerId}`;

  function finishTour() {
    setTour(null);
    try {
      localStorage.setItem("ee.projects.tourDone", "1");
    } catch {
      // Tour shows again next time.
    }
  }

  return (
    <div className="prj-page">
      <Link to="/projects" className="prj-back">
        <ChevronLeft size={20} /> All projects
      </Link>
      <div className="prj-head">
        <div>
          <div className="prj-head-line">
            <h1>{p.name}</h1>
            <span className="prj-vsep" />
            <span className="prj-pop">
              <button type="button" className="prj-status-btn" onClick={() => setStatusOpen((o) => !o)} aria-expanded={statusOpen}>
                {statusLabel(p.status)} <ChevronDown size={18} />
              </button>
              {statusOpen ? (
                <div className="prj-menu">
                  {PROJECT_STATUSES.map((s) => (
                    <button key={s.value} type="button" onClick={() => (update({ status: s.value }), setStatusOpen(false), toast(`Status changed to ${s.label}`))}>
                      {s.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </span>
            <span className="prj-vsep" />
            <span className="prj-progress">
              Project progress: {p.progress}%
              <button type="button" className="txn-icon sm" aria-label="Edit project progress" onClick={() => setProgressEdit(true)}>
                <NotebookPen size={18} />
              </button>
            </span>
          </div>
          <div className="prj-sub">
            <Link to={`/customers/${p.customerId}`}>{p.customerName}</Link>
            <span className="prj-vsep sm" />
            <span>Project ID: {p.code}</span>
            <span className="prj-vsep sm" />
            <span className="prj-pop">
              <button type="button" className="txn-icon sm" aria-label="Project notes" onClick={() => setNotesOpen((o) => !o)}>
                <FileText size={19} />
              </button>
              {notesOpen ? (
                <div className="prj-menu" style={{ width: 300, padding: 14 }}>
                  <strong>Notes</strong>
                  <p style={{ margin: "6px 0 0", whiteSpace: "pre-line" }}>{p.notes || "No notes yet. Use Edit to add some."}</p>
                </div>
              ) : null}
            </span>
            <button type="button" className="txn-icon sm" aria-label={p.starred ? "Remove from favourites" : "Add to favourites"} aria-pressed={p.starred} onClick={() => update({ starred: !p.starred })}>
              <Star size={20} fill={p.starred ? "currentColor" : "none"} />
            </button>
          </div>
        </div>
        <div className="prj-actions">
          <button type="button" className="prj-outline" onClick={() => navigate(`/projects/${p.id}/edit`)}>
            Edit
          </button>
          <span className="prj-pop">
            <button type="button" className="prj-primary sm" onClick={() => setAddOpen((o) => !o)} aria-expanded={addOpen}>
              Add to project <ChevronDown size={18} />
            </button>
            {addOpen ? (
              <div className="prj-menu" style={{ right: 0 }}>
                {ADD_TO_PROJECT.map((a) => (
                  <button key={a.label} type="button" onClick={() => navigate(`${a.to}?${qs}`)}>
                    {a.label}
                  </button>
                ))}
              </div>
            ) : null}
          </span>
        </div>
        {tour !== null ? (
          <div className="prj-tour" role="dialog" aria-label="Project tour">
            <div className="txn-popover-head">
              <strong>{TOUR[tour][0]}</strong>
              <button type="button" className="txn-icon sm" aria-label="Close tour" onClick={finishTour}>
                <X size={18} />
              </button>
            </div>
            <p>{TOUR[tour][1]}</p>
            <div className="prj-tour-foot">
              <span>
                {tour + 1} of {TOUR.length}
              </span>
              <span style={{ flex: 1 }} />
              {tour > 0 ? (
                <button type="button" className="prj-outline sm" onClick={() => setTour(tour - 1)}>
                  Back
                </button>
              ) : null}
              <button type="button" className="prj-primary xs" onClick={() => (tour + 1 < TOUR.length ? setTour(tour + 1) : finishTour())}>
                {tour + 1 < TOUR.length ? "Next" : "Done"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <nav className="prj-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>

      {tab === "Summary" ? <SummaryTab project={p} onViewInvoices={() => (setTxnFilter("invoice"), setTab("Transactions"))} /> : null}
      {tab === "Transactions" ? <TransactionsTab project={p} type={txnFilter} setType={setTxnFilter} /> : null}
      {tab === "Time Activity" ? <TimeTab project={p} /> : null}
      {tab === "Project Reports" ? <ReportsTab project={p} /> : null}
      {tab === "Project Details" ? <DetailsTab project={p} update={update} /> : null}
      {tab === "Attachments" ? <AttachmentsTab project={p} update={update} /> : null}

      {progressEdit ? <ProgressModal value={p.progress} onClose={() => setProgressEdit(false)} onSave={(n) => (update({ progress: n }), setProgressEdit(false), toast(`Progress set to ${n}%`))} /> : null}
    </div>
  );
}

function ProgressModal({ value, onClose, onSave }: { value: number; onClose: () => void; onSave: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const n = Number(text);
  const error = text === "" || !Number.isInteger(n) || n < 0 || n > 100 ? "Enter a whole number from 0 to 100" : "";
  return (
    <Modal
      title="Project progress"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="txn-btn-outline blue" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="txn-btn-primary" disabled={Boolean(error)} onClick={() => onSave(n)}>
            Save
          </button>
        </>
      }
    >
      <TField label="Percent complete" error={error || undefined}>
        <input className="txn-input" type="number" min={0} max={100} value={text} onChange={(e) => setText(e.target.value)} />
      </TField>
      <input type="range" min={0} max={100} value={Number.isFinite(n) ? n : 0} onChange={(e) => setText(e.target.value)} aria-label="Percent complete" />
    </Modal>
  );
}

function SummaryTab({ project, onViewInvoices }: { project: Project; onViewInvoices: () => void }) {
  const f = useProjectFigures(project.id);
  const [basis, setBasis] = useState("HOURLY");
  const qs = `project=${project.id}&customer=${project.customerId}`;
  const hasData = f.income > 0 || f.costs > 0;
  const bar = (actual: number, est: number) => (est > 0 ? Math.min(100, (actual / est) * 100) : actual > 0 ? 100 : 0);
  return (
    <div className="prj-tab">
      <TField label="See info based on" className="w-md txn-label-light">
        <Select
          value={basis}
          onChange={setBasis}
          searchable={false}
          options={[
            { value: "HOURLY", label: "Hourly Costs" },
            { value: "ACTUAL", label: "Actual costs only" },
          ]}
        />
      </TField>
      <h2 className="prj-h2">Project balance summary</h2>
      <div className="prj-summary">
        <div className="prj-tile">
          <span className="prj-tile-k">INCOME</span>
          <strong className="prj-tile-v">{money(f.income)}</strong>
          <div className="prj-tile-row">
            <span>
              Actual
              <br />
              {money(f.income)}
            </span>
            <span className="right">
              Estimated
              <br />
              {money(f.estimatedIncome)}
            </span>
          </div>
          <div className="prj-bar">
            <span style={{ width: `${bar(f.income, f.estimatedIncome)}%` }} />
          </div>
          <button type="button" className="prj-outline wide" onClick={() => navigate(`/sales/estimate/new?${qs}`)}>
            Create estimate
          </button>
        </div>
        <span className="prj-op">−</span>
        <div className="prj-tile">
          <span className="prj-tile-k">COSTS</span>
          <strong className="prj-tile-v">{money(f.costs)}</strong>
          <div className="prj-tile-row">
            <span>
              Actual
              <br />
              {money(f.costs)}
            </span>
            <span className="right">
              Estimated
              <br />
              {money(f.estimatedCosts)}
            </span>
          </div>
          <div className="prj-bar cost">
            <span style={{ width: `${bar(f.costs, f.estimatedCosts)}%` }} />
          </div>
          <button type="button" className="prj-outline wide" onClick={() => navigate(`/expenses/purchase-order/new?${qs}`)}>
            Create estimate
          </button>
        </div>
        <span className="prj-op">=</span>
        <div className="prj-tile">
          <span className="prj-tile-k">PROFIT</span>
          <strong className="prj-tile-v">{hasData ? money(f.profit) : "--"}</strong>
          <div className="prj-tile-row">
            <span>{hasData && f.income ? `${Math.round((f.profit / f.income) * 100)}% margin` : "--"}</span>
            <span className="right">--</span>
          </div>
          {hasData ? (
            <div className="prj-mini-chart" aria-label="Income versus costs">
              <span style={{ height: `${(f.income / Math.max(f.income, f.costs)) * 100}%` }} title={`Income ${money(f.income)}`} />
              <span className="cost" style={{ height: `${(f.costs / Math.max(f.income, f.costs)) * 100}%` }} title={`Costs ${money(f.costs)}`} />
            </div>
          ) : (
            <>
              <div className="prj-bar" />
              <p className="muted center">Chart appears once data is available.</p>
            </>
          )}
        </div>
      </div>
      <div className="prj-tile small">
        <strong className="prj-tile-v">{money(f.openInvoices)}</strong>
        <span>Open invoices</span>
        <button type="button" className="txn-link" onClick={onViewInvoices}>
          View all
        </button>
      </div>
      {basis === "HOURLY" && f.time.length === 0 ? <p className="muted">No time has been tracked on this project yet, so costs only include bills and expenses.</p> : null}
    </div>
  );
}

const DATE_FILTERS = [
  { value: "ALL", label: "All" },
  { value: "30", label: "Last 30 days" },
  { value: "MONTH", label: "This month" },
  { value: "YEAR", label: "This year" },
];

function TransactionsTab({ project, type, setType }: { project: Project; type: string; setType: (t: string) => void }) {
  const { toast, confirm } = useFeedback();
  const index = useTxnIndex();
  const [when, setWhen] = useState("ALL");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [batch, setBatch] = useState(false);
  const [page, setPage] = useState(1);
  const [desc, setDesc] = useState(true);
  const qs = `project=${project.id}&customer=${project.customerId}`;
  const today = isoDay();
  const from = when === "30" ? monthsAgo(today, 1) : when === "MONTH" ? `${today.slice(0, 7)}-01` : when === "YEAR" ? `${today.slice(0, 4)}-01-01` : "";
  const rows = index
    .filter((r) => r.projectId === project.id && (type === "ALL" || r.kind === type) && (!from || r.date >= from))
    .sort((a, b) => (desc ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
  const pageRows = rows.slice((page - 1) * 10, page * 10);
  const kinds = [...new Set(index.filter((r) => r.projectId === project.id).map((r) => r.kind))];

  function exportCsv() {
    const chosen = rows.filter((r) => sel.has(r.id));
    const csv = ["Date,Type,No.,From/To,Memo,Amount,Status", ...chosen.map((r) => [r.date, TXN_LABELS[r.kind], r.number, r.party, r.memo, r.amount, r.status].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${project.name}-transactions.csv`;
    a.click();
    setBatch(false);
  }
  async function untag() {
    if (!(await confirm({ title: `Remove ${sel.size} transaction${sel.size > 1 ? "s" : ""} from this project?`, body: "The transactions stay in your books; they just won't be tagged to this project.", confirmLabel: "Remove" }))) return;
    try {
      const all = JSON.parse(localStorage.getItem("ee.txn.index") ?? "[]") as TxnIndexRow[];
      localStorage.setItem("ee.txn.index", JSON.stringify(all.map((r) => (sel.has(r.id) ? { ...r, projectId: undefined } : r))));
      window.dispatchEvent(new CustomEvent("ee-local-store", { detail: "ee.txn.index" }));
      toast("Removed from project");
    } catch {
      toast("Couldn't update this browser's storage", { error: true });
    }
    setSel(new Set());
    setBatch(false);
  }

  return (
    <div className="prj-tab">
      <div className="prj-filter-row">
        <span className="prj-pop">
          <button type="button" className="prj-outline" disabled={!sel.size} onClick={() => setBatch((b) => !b)}>
            Batch actions <ChevronDown size={16} />
          </button>
          {batch ? (
            <div className="prj-menu">
              <button type="button" onClick={exportCsv}>
                Export to CSV
              </button>
              <button type="button" onClick={() => void untag()}>
                Remove from project
              </button>
            </div>
          ) : null}
        </span>
        <TField label="Type" className="w-sm txn-label-light">
          <Select value={type} onChange={(t) => (setType(t), setPage(1))} searchable={false} options={[{ value: "ALL", label: "All transactions" }, ...kinds.map((k) => ({ value: k, label: TXN_LABELS[k] }))]} />
        </TField>
        <TField label="Date" className="w-sm txn-label-light">
          <Select value={when} onChange={(w) => (setWhen(w), setPage(1))} searchable={false} options={DATE_FILTERS} />
        </TField>
        <Link to="/accounting/recurring-transactions" className="txn-link" style={{ alignSelf: "flex-end", paddingBottom: 10 }}>
          View Recurring Templates
        </Link>
      </div>
      <table className="prj-table">
        <thead>
          <tr>
            <th style={{ width: 40 }}>
              <input type="checkbox" aria-label="Select all" checked={pageRows.length > 0 && pageRows.every((r) => sel.has(r.id))} onChange={(e) => setSel(e.target.checked ? new Set(pageRows.map((r) => r.id)) : new Set())} />
            </th>
            <th>
              <button type="button" className="prj-sort" onClick={() => setDesc((d) => !d)}>
                DATE {desc ? "▼" : "▲"}
              </button>
            </th>
            <th>TYPE</th>
            <th>NO.</th>
            <th>FROM / TO</th>
            <th>MEMO</th>
            <th className="right">AMOUNT</th>
            <th>STATUS</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((r) => (
            <tr key={r.id}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Select ${TXN_LABELS[r.kind]} ${r.number}`}
                  checked={sel.has(r.id)}
                  onChange={(e) =>
                    setSel((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(r.id);
                      else n.delete(r.id);
                      return n;
                    })
                  }
                />
              </td>
              <td>{date(r.date)}</td>
              <td>{TXN_LABELS[r.kind]}</td>
              <td>{r.number}</td>
              <td>{r.party}</td>
              <td className="prj-ellipsis">{r.memo}</td>
              <td className="right">{amount(r.amount, 2)}</td>
              <td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? (
        <div className="prj-quick">
          <div>
            <h3>See where you're making money</h3>
            <QuickCard icon={<ClipboardList size={40} />} title="Project estimates" body="Send a proposal and get customer's approval." to={`/sales/estimate/new?${qs}`} />
            <QuickCard icon={<FileSpreadsheet size={40} />} title="Invoices" body="Request money for your product or services." to={`/sales/invoice/new?${qs}`} />
          </div>
          <div>
            <h3>See where you're spending money</h3>
            <QuickCard icon={<Wallet size={40} />} title="Expenses" body="Track what you've spent on this project." to={`/expenses/cheque/new?${qs}`} />
            <QuickCard icon={<Mail size={40} />} title="Bills" body="Add anything you purchase from suppliers." to={`/expenses/bill/new?${qs}`} />
          </div>
        </div>
      ) : null}
      <div className="prj-pager">
        <button type="button" className="txn-link" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>
          Previous
        </button>
        <span>
          {rows.length ? `${(page - 1) * 10 + 1}-${Math.min(page * 10, rows.length)}` : 0} of {rows.length}
        </span>
        <button type="button" className="txn-link" disabled={page * 10 >= rows.length} onClick={() => setPage((x) => x + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

function QuickCard({ icon, title, body, to }: { icon: ReactNode; title: string; body: string; to: string }) {
  return (
    <Link to={to} className="prj-quick-card">
      <span className="prj-quick-icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <span>{body}</span>
      </span>
    </Link>
  );
}

function TimeTab({ project }: { project: Project }) {
  const f = useProjectFigures(project.id);
  const today = isoDay();
  const ranges = [
    { value: "12", label: `${date(monthsAgo(today, 12))} - ${date(today)}` },
    { value: "3", label: `${date(monthsAgo(today, 3))} - ${date(today)}` },
    { value: "1", label: `${date(monthsAgo(today, 1))} - ${date(today)}` },
  ];
  const [range, setRange] = useState("12");
  const [group, setGroup] = useState("EMPLOYEE");
  const rows = f.time.filter((r) => r.date >= monthsAgo(today, Number(range)));
  return (
    <div className="prj-tab">
      <div className="prj-filter-row">
        <TField label="Date range:" className="w-md txn-label-light">
          <Select value={range} onChange={setRange} searchable={false} options={ranges} />
        </TField>
        <TField label="Group by:" className="w-md txn-label-light">
          <Select value={group} onChange={setGroup} searchable={false} options={[{ value: "EMPLOYEE", label: "Employee" }, { value: "SERVICE", label: "Service" }, { value: "DATE", label: "Date" }]} />
        </TField>
      </div>
      <table className="prj-table">
        <thead>
          <tr>
            <th>EMPLOYEE/SUPPLIER</th>
            <th>SERVICE</th>
            <th>DATE</th>
            <th className="right">TOTAL TIME</th>
            <th className="right">TOTAL COST</th>
            <th className="right">BILLABLE TIME</th>
            <th className="right">BILLABLE AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.party}</td>
              <td>{r.memo}</td>
              <td>{date(r.date)}</td>
              <td className="right">{r.number}</td>
              <td className="right">{amount(r.amount, 2)}</td>
              <td className="right">—</td>
              <td className="right">—</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? (
        <div className="prj-empty-block">
          <h2>Your time is valuable</h2>
          <p>Understand how you spend your time and what it cost on a project.</p>
          <button type="button" className="prj-outline" onClick={() => navigate(`/time/single?project=${project.id}`)}>
            Track time
          </button>
        </div>
      ) : null}
    </div>
  );
}

type ReportKey = "profitability" | "time" | "unbilled" | "estimates" | "all-estimates" | "all-profit" | "all-po";

function ReportsTab({ project }: { project: Project }) {
  const [open, setOpen] = useState<ReportKey | null>(null);
  const item = (key: ReportKey, icon: ReactNode, title: string, body: string, isNew = false) => (
    <div className="prj-report">
      <span className="prj-report-icon">{icon}</span>
      <div>
        <strong>
          {title} {isNew ? <span className="prj-new">NEW</span> : null}
        </strong>
        <span>{body}</span>
      </div>
      <button type="button" className="txn-link prj-view" onClick={() => setOpen(key)}>
        View
      </button>
    </div>
  );
  return (
    <div className="prj-tab">
      <h2 className="prj-h2">Reports for {project.name}</h2>
      {item("profitability", <BarChart3 size={44} />, "Project profitability", "Check how much you're earning on this project.")}
      {item("time", <UserRound size={44} />, "Time cost by employee or supplier", "See how much you're paying employees or suppliers on this project.")}
      {item("unbilled", <PieChart size={44} />, "Unbilled time and expenses", "Find expenses and time you haven't added to an invoice.")}
      {item("estimates", <ClipboardList size={44} />, "Estimates vs. actuals", "Compare your estimated vs. actual profitability for this project.")}
      <h2 className="prj-h2">Reports for all projects</h2>
      {item("all-estimates", <FileSpreadsheet size={44} />, "Estimates & progress invoicing summary by project", "Compare invoiced amounts with estimated revenue for all projects.")}
      {item("all-profit", <Receipt size={44} />, "Project profitability summary", "Understand how profitable your projects are with the Project Profitability Summary. This report gathers income and expense data to show the financial success of each project.")}
      {item("all-po", <FolderOpen size={44} />, "Open purchase order by project", "Track purchase orders across your projects to manage supplier commitments and spending.", true)}
      {open ? <ProjectReport report={open} project={project} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function ProjectReport({ report, project, onClose }: { report: ReportKey; project: Project; onClose: () => void }) {
  const index = useTxnIndex();
  const projects = useProjects();
  const forProject = (pid: string) => index.filter((r) => r.projectId === pid);
  const sum = (rows: TxnIndexRow[], kinds: TxnKind[]) => rows.filter((r) => kinds.includes(r.kind)).reduce((s, r) => s + r.amount, 0);
  const mine = forProject(project.id);

  let title = "";
  let head: string[] = [];
  let body: Array<Array<string>> = [];
  switch (report) {
    case "profitability": {
      title = `Project profitability — ${project.name}`;
      head = ["Type", "Amount"];
      const inc = sum(mine, INCOME_KINDS);
      const cost = sum(mine, COST_KINDS.filter((k) => k !== "purchase-order"));
      body = [...INCOME_KINDS.map((k) => [`Income · ${TXN_LABELS[k]}`, amount(sum(mine, [k]), 2)]), ...COST_KINDS.filter((k) => k !== "purchase-order").map((k) => [`Cost · ${TXN_LABELS[k]}`, amount(sum(mine, [k]), 2)]), ["Gross profit", amount(inc - cost, 2)]];
      break;
    }
    case "time":
      title = "Time cost by employee or supplier";
      head = ["Employee/supplier", "Cost"];
      body = mine.filter((r) => r.kind === "time").map((r) => [r.party, amount(r.amount, 2)]);
      break;
    case "unbilled":
      title = "Unbilled time and expenses";
      head = ["Date", "Type", "From/To", "Amount"];
      body = mine.filter((r) => r.kind === "time" || r.kind === "expense" || r.kind === "cheque").map((r) => [date(r.date), TXN_LABELS[r.kind], r.party, amount(r.amount, 2)]);
      break;
    case "estimates":
      title = "Estimates vs. actuals";
      head = ["", "Estimated", "Actual", "Difference"];
      {
        const ei = sum(mine, ["estimate", "proposal"]);
        const ai = sum(mine, INCOME_KINDS);
        const ec = sum(mine, ["purchase-order"]);
        const ac = sum(mine, COST_KINDS.filter((k) => k !== "purchase-order"));
        body = [
          ["Income", amount(ei, 2), amount(ai, 2), amount(ai - ei, 2)],
          ["Costs", amount(ec, 2), amount(ac, 2), amount(ac - ec, 2)],
          ["Profit", amount(ei - ec, 2), amount(ai - ac, 2), amount(ai - ac - (ei - ec), 2)],
        ];
      }
      break;
    case "all-estimates":
      title = "Estimates & progress invoicing summary by project";
      head = ["Project", "Estimated", "Invoiced", "% invoiced"];
      body = projects.map((p) => {
        const rows = forProject(p.id);
        const est = sum(rows, ["estimate", "proposal"]);
        const inv = sum(rows, ["invoice"]);
        return [p.name, amount(est, 2), amount(inv, 2), est ? `${Math.round((inv / est) * 100)}%` : "—"];
      });
      break;
    case "all-profit":
      title = "Project profitability summary";
      head = ["Project", "Income", "Costs", "Profit"];
      body = projects.map((p) => {
        const rows = forProject(p.id);
        const inc = sum(rows, INCOME_KINDS);
        const cost = sum(rows, COST_KINDS.filter((k) => k !== "purchase-order"));
        return [p.name, amount(inc, 2), amount(cost, 2), amount(inc - cost, 2)];
      });
      break;
    case "all-po":
      title = "Open purchase order by project";
      head = ["Project", "P.O. no.", "Supplier", "Amount"];
      body = index.filter((r) => r.kind === "purchase-order" && r.projectId && r.status !== "CLOSED").map((r) => [projects.find((p) => p.id === r.projectId)?.name ?? "—", r.number, r.party, amount(r.amount, 2)]);
      break;
  }

  function download() {
    const csv = [head, ...body].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${title}.csv`;
    a.click();
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      width={820}
      footer={
        <button type="button" className="txn-btn-outline blue" onClick={download}>
          <Download size={16} style={{ verticalAlign: "-2px", marginRight: 6 }} /> Export CSV
        </button>
      }
    >
      <table className="txn-table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h || i} className={i ? "right" : ""}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.length ? (
            body.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className={j ? "right" : ""}>
                    {c}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={head.length} className="muted">
                Nothing to report yet. Add transactions to the project to see figures here.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Modal>
  );
}

function DetailsTab({ project: p, update }: { project: Project; update: (patch: Partial<Project>) => void }) {
  const { toast } = useFeedback();
  const [adding, setAdding] = useState(false);
  const [field, setField] = useState({ name: "", value: "" });
  const [error, setError] = useState("");
  const rows: Array<[string, string]> = [
    ["Project name", p.name],
    ["Project ID", p.code],
    ["Customer", p.customerName],
    ["Email", p.email || "-"],
    ["Start date", p.startDate ? date(p.startDate) : "-"],
    ["End date", p.endDate ? date(p.endDate) : "-"],
    ["Notes", p.notes || "-"],
    ["Project Progress", `${p.progress} %`],
    ["Status", statusLabel(p.status)],
  ];
  function addField() {
    if (!field.name.trim()) return setError("Name the field");
    if (field.name.trim().length > 40) return setError("Use 40 characters or fewer");
    if (p.customFields.some((c) => c.name.toLowerCase() === field.name.trim().toLowerCase())) return setError("This field already exists");
    update({ customFields: [...p.customFields, { name: field.name.trim(), value: field.value.trim() }] });
    setField({ name: "", value: "" });
    setAdding(false);
    toast("Custom field added");
  }
  return (
    <div className="prj-tab prj-details">
      <section>
        <div className="prj-sec-head">
          <h2 className="prj-h2">Project details</h2>
          <button type="button" className="txn-link" onClick={() => navigate(`/projects/${p.id}/edit`)}>
            Edit
          </button>
        </div>
        <table className="prj-kv">
          <tbody>
            {rows.map(([k, val]) => (
              <tr key={k}>
                <th>{k}</th>
                <td className="pre">{val}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2 className="prj-h2">Address for this project</h2>
        <table className="prj-kv">
          <tbody>
            <tr>
              <th>Billing address</th>
              <td className="pre">{p.customerAddress || "-"}</td>
            </tr>
            <tr>
              <th>Shipping address</th>
              <td>-</td>
            </tr>
          </tbody>
        </table>
        <div className="prj-sec-head" style={{ marginTop: 40 }}>
          <h2 className="prj-h2">Custom fields</h2>
          <Link to="/settings/custom-fields" className="txn-link">
            Manage custom fields
          </Link>
        </div>
        {p.customFields.length ? (
          <table className="prj-kv">
            <tbody>
              {p.customFields.map((c) => (
                <tr key={c.name}>
                  <th>{c.name}</th>
                  <td>
                    {c.value || "-"}
                    <button type="button" className="txn-icon sm" style={{ float: "right" }} aria-label={`Remove ${c.name}`} onClick={() => update({ customFields: p.customFields.filter((x) => x.name !== c.name) })}>
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {adding ? (
          <div className="txn-row" style={{ marginTop: 14, alignItems: "flex-start" }}>
            <TField label="Field name" required error={error || undefined} className="w-sm">
              <input className="txn-input" value={field.name} autoFocus onChange={(e) => (setField((f) => ({ ...f, name: e.target.value })), setError(""))} />
            </TField>
            <TField label="Value" className="w-sm">
              <input className="txn-input" value={field.value} maxLength={200} onChange={(e) => setField((f) => ({ ...f, value: e.target.value }))} />
            </TField>
            <button type="button" className="txn-btn-primary" style={{ marginTop: 28 }} onClick={addField}>
              Add
            </button>
            <button type="button" className="txn-btn-outline blue" style={{ marginTop: 28 }} onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="txn-link" style={{ marginTop: 18, fontSize: 18 }} onClick={() => setAdding(true)}>
            + Add custom field
          </button>
        )}
      </section>
    </div>
  );
}

function AttachmentsTab({ project: p, update }: { project: Project; update: (patch: Partial<Project>) => void }) {
  const { toast, confirm } = useFeedback();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [spin, setSpin] = useState(false);
  useEffect(() => {
    if (!spin) return;
    const t = setTimeout(() => setSpin(false), 600);
    return () => clearTimeout(t);
  }, [spin]);

  async function add(list: FileList | null) {
    if (!list) return;
    const added = [];
    for (const f of Array.from(list)) {
      if (f.size > PROJECT_FILE_MAX) {
        toast(`${f.name} is larger than ${fileSize(PROJECT_FILE_MAX)}`, { error: true });
        continue;
      }
      added.push({ id: newId(), name: f.name, size: f.size, type: f.type, dataUrl: await fileToDataUrl(f), addedAt: new Date().toISOString() });
    }
    if (!added.length) return;
    try {
      update({ files: [...p.files, ...added] });
      toast(`${added.length} file${added.length > 1 ? "s" : ""} uploaded`);
    } catch {
      toast("Browser storage is full — remove some files first", { error: true });
    }
  }

  const sorted = useMemo(() => [...p.files].sort((a, b) => b.addedAt.localeCompare(a.addedAt)), [p.files]);
  return (
    <div className="prj-tab">
      <div
        className={`prj-drop ${over ? "over" : ""}`}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => (e.preventDefault(), setOver(false), void add(e.dataTransfer.files))}
      >
        <UploadCloud size={26} />
        <div>
          <p>Drop documents here or select files from computer to upload</p>
          <button type="button" className="prj-primary xs" onClick={() => input.current?.click()}>
            Upload
          </button>
        </div>
        <input ref={input} type="file" multiple hidden onChange={(e) => (void add(e.target.files), (e.target.value = ""))} />
      </div>
      <div className="prj-files">
        <button type="button" className={`txn-icon ${spin ? "prj-spin" : ""}`} aria-label="Refresh" onClick={() => setSpin(true)}>
          <RefreshCw size={22} />
        </button>
        {sorted.length ? (
          <table className="prj-table">
            <thead>
              <tr>
                <th>NAME</th>
                <th>SIZE</th>
                <th>ADDED</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((f) => (
                <tr key={f.id}>
                  <td>
                    <a href={f.dataUrl} download={f.name} className="txn-link">
                      {f.name}
                    </a>
                  </td>
                  <td>{fileSize(f.size)}</td>
                  <td>{date(f.addedAt)}</td>
                  <td className="right">
                    <button
                      type="button"
                      className="txn-icon sm"
                      aria-label={`Delete ${f.name}`}
                      onClick={async () => {
                        if (await confirm({ title: `Delete ${f.name}?`, confirmLabel: "Delete", danger: true })) update({ files: p.files.filter((x) => x.id !== f.id) });
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="prj-empty-block">
            <span className="prj-folder">
              <FolderOpen size={64} />
            </span>
            <h2>Nothing to see here yet</h2>
            <p>Upload a document to get started</p>
          </div>
        )}
      </div>
      <p className="muted">Each file can be up to {fileSize(PROJECT_FILE_MAX)}. Attachments are stored in this browser.</p>
    </div>
  );
}

export function deleteProject(id: string) {
  removeLocal("projects", id);
}


