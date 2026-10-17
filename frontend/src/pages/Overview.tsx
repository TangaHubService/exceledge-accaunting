import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  BookOpen,
  Calendar,
  ChevronRight,
  Clock3,
  Eye,
  EyeOff,
  FileText,
  FolderKanban,
  GripVertical,
  Info,
  Landmark,
  MoreHorizontal,
  Pencil,
  PieChart,
  Plus,
  Receipt,
  Settings2,
  Smartphone,
  TrendingUp,
  Users,
  Wallet,
  Warehouse,
  X,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { DASHBOARD_WIDGETS, DUMMY, MODULES, QUICK_ACTIONS } from "../lib/dashboard-dummy";
import { Link, navigate } from "../lib/router";
import { useSession } from "../lib/session";

const ICON = 1.5;

const MODULE_ICONS: Record<string, LucideIcon> = {
  accounting: BookOpen,
  expenses: Receipt,
  sales: TrendingUp,
  customers: Users,
  team: Users,
  projects: FolderKanban,
  inventory: Warehouse,
  tax: PieChart,
};

const QUICK_ICONS: Record<string, LucideIcon> = {
  invoice: FileText,
  expense: Receipt,
  deposit: Landmark,
  cheque: FileText,
};

const BANK_ICONS = {
  main: Landmark,
  mobile: Smartphone,
  cashhand: Banknote,
} as const;

const BANK_COLORS = {
  main: "#2f6fed",
  mobile: "#0f766e",
  cashhand: "#ea580c",
} as const;

const KPI_ICONS: Record<string, LucideIcon> = {
  income: TrendingUp,
  expenses: Receipt,
  profit: PieChart,
  cash: Wallet,
};

type WidgetKey = (typeof DASHBOARD_WIDGETS)[number]["key"];

function defaultEnabled(): Record<WidgetKey, boolean> {
  const map = {} as Record<WidgetKey, boolean>;
  for (const w of DASHBOARD_WIDGETS) map[w.key] = w.defaultOn;
  return map;
}

function formatMoney(n: number) {
  return `${n.toLocaleString("en-US")} ${DUMMY.currency}`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 72;
  const h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg className="ee-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={pts} />
    </svg>
  );
}

function IncomeExpenseChart() {
  const max = 5;
  return (
    <div className="ee-bar-chart ee-bar-chart-tall" role="img" aria-label="Income vs expenses by week">
      <div className="ee-bar-y" aria-hidden="true">
        <span>5M</span>
        <span>2.5M</span>
        <span>0</span>
      </div>
      <div className="ee-bar-plot">
        {DUMMY.weekly.map((w) => (
          <div className="ee-bar-group" key={w.week}>
            <div className="ee-bars">
              <div className="ee-bar income" style={{ height: `${(w.income / max) * 100}%` }} title={`Income ${w.income}M`} />
              <div className="ee-bar expense" style={{ height: `${(w.expenses / max) * 100}%` }} title={`Expenses ${w.expenses}M`} />
            </div>
            <span className="ee-bar-label">{w.week}</span>
          </div>
        ))}
      </div>
      <div className="ee-bar-legend">
        <span>
          <i className="dot income" /> Income
        </span>
        <span>
          <i className="dot expense" /> Expenses
        </span>
      </div>
    </div>
  );
}

function statusClass(status: string) {
  if (status === "Paid" || status === "Completed") return "ok";
  if (status === "Unpaid") return "bad";
  return "";
}

function typeTone(type: string) {
  if (type === "Invoice" || type === "Payment") return "ok";
  if (type === "Bill" || type === "Expense") return "bad";
  return "info";
}

function EditChrome({
  editing,
  onRemove,
  children,
  className = "",
}: {
  editing: boolean;
  onRemove?: () => void;
  children: ReactNode;
  className?: string;
}) {
  if (!editing) return <div className={className}>{children}</div>;
  return (
    <div className={`ee-edit-wrap ${className}`}>
      <span className="ee-edit-grip" aria-hidden="true">
        <GripVertical size={16} strokeWidth={ICON} />
      </span>
      {onRemove && (
        <button type="button" className="ee-edit-remove" aria-label="Remove widget" onClick={onRemove}>
          <X size={14} strokeWidth={2} />
        </button>
      )}
      <span className="ee-edit-resize" aria-hidden="true" />
      {children}
    </div>
  );
}

export function Overview() {
  const { email } = useSession();
  const [privacy, setPrivacy] = useState(false);
  const [module, setModule] = useState("accounting");
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [draft, setDraft] = useState(defaultEnabled);
  const name = useMemo(() => {
    const local = (email ?? "").split("@")[0];
    const first = local.split(/[._-]+/).filter(Boolean)[0];
    return first ? first[0]!.toUpperCase() + first.slice(1) : DUMMY.greetingName;
  }, [email]);

  const mask = (n: number) => (privacy ? "••••••" : formatMoney(n));
  const on = editing ? draft : enabled;

  function startEdit() {
    setDraft({ ...enabled });
    setEditing(true);
    setAddOpen(false);
  }

  function cancelEdit() {
    setDraft({ ...enabled });
    setEditing(false);
    setAddOpen(false);
  }

  function saveLayout() {
    setEnabled({ ...draft });
    setEditing(false);
    setAddOpen(false);
  }

  function removeWidget(key: WidgetKey) {
    setDraft((d) => ({ ...d, [key]: false }));
  }

  function toggleDraft(key: WidgetKey) {
    setDraft((d) => ({ ...d, [key]: !d[key] }));
  }

  return (
    <div className={`ee-dash ${editing ? "editing" : ""}`}>
      <div className="ee-dash-head">
        <div className="ee-dash-intro">
          {editing ? (
            <>
              <h1>Customise your dashboard</h1>
              <p className="ee-dash-sub">Arrange your workspace the way you work.</p>
            </>
          ) : (
            <h1>
              {greeting()}, {name}!
            </h1>
          )}
        </div>
        <div className="ee-dash-tools">
          {editing ? (
            <>
              <span className="ee-editing-pill">
                <Settings2 size={14} strokeWidth={ICON} />
                Editing layout
              </span>
              <button type="button" className="ee-btn-ghost" onClick={cancelEdit}>
                Cancel
              </button>
              <button type="button" className="ee-btn-outline" onClick={() => setAddOpen(true)}>
                <Plus size={15} strokeWidth={2} />
                Add widgets
              </button>
              <button type="button" className="ee-btn-primary" onClick={saveLayout}>
                Save layout
              </button>
            </>
          ) : (
            <>
              <button type="button" className={`ee-privacy ${privacy ? "on" : ""}`} onClick={() => setPrivacy((v) => !v)}>
                {privacy ? <EyeOff size={16} strokeWidth={ICON} /> : <Eye size={16} strokeWidth={ICON} />}
                Privacy
              </button>
              <button type="button" className="ee-period">
                <Calendar size={16} strokeWidth={ICON} />
                {DUMMY.periodLabel}
              </button>
              <button type="button" className="ee-privacy" onClick={startEdit} title="Customise dashboard">
                <Pencil size={15} strokeWidth={ICON} />
                Edit layout
              </button>
            </>
          )}
        </div>
      </div>

      {on.modules && (
        <EditChrome editing={editing} onRemove={() => removeWidget("modules")}>
          <div className="ee-modules" role="tablist" aria-label="Modules">
            {MODULES.map((m) => {
              const MIcon = MODULE_ICONS[m.icon] ?? BookOpen;
              return (
                <button
                  key={m.key}
                  type="button"
                  role="tab"
                  aria-selected={module === m.key}
                  className={`ee-module ${module === m.key ? "active" : ""}`}
                  onClick={() => {
                    if (editing) return;
                    setModule(m.key);
                    if (m.key !== "accounting") navigate(m.to);
                  }}
                >
                  <span className="ee-module-icon" style={{ background: m.color }}>
                    <MIcon size={16} strokeWidth={1.75} color="#fff" />
                  </span>
                  <span className="ee-module-label">{m.label}</span>
                </button>
              );
            })}
            {editing && (
              <button type="button" className="ee-module ee-module-more" aria-label="More modules">
                <MoreHorizontal size={18} strokeWidth={ICON} />
              </button>
            )}
          </div>
        </EditChrome>
      )}

      {on.quick && (
        <EditChrome editing={editing} onRemove={() => removeWidget("quick")}>
          <div className="ee-quick">
            <span className="ee-quick-label">Quick actions</span>
            <div className="ee-quick-row">
              {QUICK_ACTIONS.map((a) => {
                const QIcon = QUICK_ICONS[a.icon] ?? FileText;
                return (
                  <button
                    key={a.label}
                    type="button"
                    className="ee-quick-btn"
                    onClick={() => {
                      if (!editing) navigate(a.to);
                    }}
                  >
                    <QIcon size={14} strokeWidth={ICON} />
                    {a.label}
                  </button>
                );
              })}
              <button type="button" className="ee-linkish" onClick={() => !editing && navigate("/journals/new")}>
                Show all
              </button>
            </div>
          </div>
        </EditChrome>
      )}

      {editing && (
        <div className="ee-edit-banner" role="status">
          <Info size={15} strokeWidth={ICON} />
          Drag widgets to rearrange. Use the corner handles to resize.
        </div>
      )}

      {on.glance && (
        <EditChrome editing={editing} onRemove={() => removeWidget("glance")} className="ee-section">
          <h2>Business at a glance</h2>
          <div className="ee-glance">
            {DUMMY.kpis.map((kpi) => {
              const KIcon = KPI_ICONS[kpi.key] ?? TrendingUp;
              const DeltaIcon = kpi.tone === "up" ? ArrowUpRight : ArrowDownRight;
              return (
                <article className="ee-kpi" key={kpi.key}>
                  <div className="ee-kpi-top">
                    <span className="ee-kpi-icon" style={{ background: kpi.color }}>
                      <KIcon size={14} strokeWidth={1.75} />
                    </span>
                    <span className="ee-kpi-label">{kpi.label}</span>
                  </div>
                  <div className="ee-kpi-value">{mask(kpi.value)}</div>
                  <div className="ee-kpi-foot">
                    <span className={`ee-delta ${kpi.tone}`}>
                      <DeltaIcon size={14} strokeWidth={2} />
                      {kpi.delta}% vs last month
                    </span>
                    <Sparkline values={kpi.spark} color={kpi.color} />
                  </div>
                </article>
              );
            })}
          </div>
        </EditChrome>
      )}

      {(on.chart || on.banks) && (
        <div className="ee-mid">
          {on.chart && (
            <EditChrome editing={editing} onRemove={() => removeWidget("chart")}>
              <section className="ee-card">
                <div className="ee-card-head">
                  <h3>Income vs Expenses</h3>
                  <span className="muted small">This month · RWF</span>
                </div>
                <IncomeExpenseChart />
              </section>
            </EditChrome>
          )}
          {on.banks && (
            <EditChrome editing={editing} onRemove={() => removeWidget("banks")}>
              <section className="ee-card">
                <div className="ee-card-head">
                  <h3>Bank accounts</h3>
                  <Link to="/banking" className="ee-view-all" onClick={(e) => editing && e.preventDefault()}>
                    View all
                  </Link>
                </div>
                <ul className="ee-bank-list">
                  {DUMMY.banks.map((b) => {
                    const BIcon = BANK_ICONS[b.tone] ?? Wallet;
                    const color = BANK_COLORS[b.tone] ?? "#2f6fed";
                    return (
                      <li key={b.name}>
                        <button type="button" className="ee-bank-row" onClick={() => !editing && navigate("/banking")}>
                          <span className="ee-bank-icon" style={{ background: `${color}18`, color }}>
                            <BIcon size={16} strokeWidth={ICON} />
                          </span>
                          <span className="ee-bank-meta">
                            <strong>{b.name}</strong>
                            <small>{b.updated}</small>
                          </span>
                          <strong className="ee-bank-bal">{mask(b.balance)}</strong>
                          <ChevronRight size={16} strokeWidth={ICON} className="muted" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </EditChrome>
          )}
        </div>
      )}

      {(on.invoices || on.bills) && (
        <div className="ee-mid">
          {on.invoices && (
            <EditChrome editing={editing} onRemove={() => removeWidget("invoices")}>
              <section className="ee-card">
                <div className="ee-card-head">
                  <h3>Invoices & payments</h3>
                  <Link to="/invoices" className="ee-view-all" onClick={(e) => editing && e.preventDefault()}>
                    View all
                  </Link>
                </div>
                <div className="ee-split">
                  <div className="ee-split-item">
                    <span className="ee-split-icon info">
                      <FileText size={16} strokeWidth={ICON} />
                    </span>
                    <div>
                      <div className="muted small">Outstanding invoices</div>
                      <strong>{mask(DUMMY.invoices.outstanding.amount)}</strong>
                      <div className="muted small">{DUMMY.invoices.outstanding.count} invoices</div>
                    </div>
                  </div>
                  <div className="ee-split-item">
                    <span className="ee-split-icon bad">
                      <Clock3 size={16} strokeWidth={ICON} />
                    </span>
                    <div>
                      <div className="muted small">Overdue invoices</div>
                      <strong>{mask(DUMMY.invoices.overdue.amount)}</strong>
                      <div className="muted small">{DUMMY.invoices.overdue.count} invoices</div>
                    </div>
                  </div>
                </div>
              </section>
            </EditChrome>
          )}
          {on.bills && (
            <EditChrome editing={editing} onRemove={() => removeWidget("bills")}>
              <section className="ee-card">
                <div className="ee-card-head">
                  <h3>Expenses & bills</h3>
                  <Link to="/bills" className="ee-view-all" onClick={(e) => editing && e.preventDefault()}>
                    View all
                  </Link>
                </div>
                <div className="ee-split">
                  <div className="ee-split-item">
                    <span className="ee-split-icon info">
                      <Receipt size={16} strokeWidth={ICON} />
                    </span>
                    <div>
                      <div className="muted small">Unpaid bills</div>
                      <strong>{mask(DUMMY.bills.unpaid.amount)}</strong>
                      <div className="muted small">{DUMMY.bills.unpaid.count} bills</div>
                    </div>
                  </div>
                  <div className="ee-split-item">
                    <span className="ee-split-icon bad">
                      <Clock3 size={16} strokeWidth={ICON} />
                    </span>
                    <div>
                      <div className="muted small">Due this week</div>
                      <strong>{mask(DUMMY.bills.dueThisWeek.amount)}</strong>
                      <div className="muted small">{DUMMY.bills.dueThisWeek.count} bills</div>
                    </div>
                  </div>
                </div>
              </section>
            </EditChrome>
          )}
        </div>
      )}

      {on.activity && (
        <EditChrome editing={editing} onRemove={() => removeWidget("activity")}>
          <section className="ee-card ee-activity">
            <div className="ee-card-head">
              <h3>Recent activity</h3>
              <span className="muted small">Sample data · RWF</span>
            </div>
            <div className="ee-table-wrap">
              <table className="ee-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Number</th>
                    <th>Contact / Description</th>
                    <th className="num">Amount (RWF)</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {DUMMY.activity.map((row) => (
                    <tr key={row.number}>
                      <td>{row.date}</td>
                      <td>
                        <span className={`ee-type ${typeTone(row.type)}`}>
                          <FileText size={14} strokeWidth={ICON} />
                          {row.type}
                        </span>
                      </td>
                      <td className="mono">{row.number}</td>
                      <td>{row.contact}</td>
                      <td className="num">{privacy ? "••••" : row.amount.toLocaleString("en-US")}</td>
                      <td>
                        <span className={`ee-status ${statusClass(row.status)}`}>{row.status}</span>
                      </td>
                      <td>
                        <button type="button" className="ee-linkish">
                          View
                        </button>
                        <button type="button" className="ee-icon-btn sm" aria-label="More">
                          <MoreHorizontal size={16} strokeWidth={ICON} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </EditChrome>
      )}

      {addOpen && (
        <div className="ee-add-widgets-root" role="presentation">
          <button type="button" className="ee-add-widgets-scrim" aria-label="Close" onClick={() => setAddOpen(false)} />
          <aside className="ee-add-widgets" role="dialog" aria-label="Add widgets">
            <header className="ee-add-widgets-head">
              <div>
                <h2>Add widgets</h2>
                <p>Select widgets for your dashboard</p>
              </div>
              <button type="button" className="ee-customise-close" onClick={() => setAddOpen(false)} aria-label="Close">
                <X size={18} strokeWidth={ICON} />
              </button>
            </header>
            <div className="ee-add-widgets-body">
              <h3>Operational</h3>
              <ul className="ee-add-widgets-list">
                {DASHBOARD_WIDGETS.filter((w) => w.group === "operational").map((w) => (
                  <li key={w.key}>
                    <label className="ee-add-widgets-row">
                      <span className="ee-customise-check">
                        <input type="checkbox" checked={!!draft[w.key]} onChange={() => toggleDraft(w.key)} />
                        <span className="ee-customise-box" />
                      </span>
                      {w.label}
                    </label>
                  </li>
                ))}
              </ul>
              <h3>All widgets</h3>
              <ul className="ee-add-widgets-list">
                {DASHBOARD_WIDGETS.filter((w) => w.group === "all").map((w) => (
                  <li key={w.key}>
                    <label className="ee-add-widgets-row">
                      <span className="ee-customise-check">
                        <input type="checkbox" checked={!!draft[w.key]} onChange={() => toggleDraft(w.key)} />
                        <span className="ee-customise-box" />
                      </span>
                      {w.label}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
            <footer className="ee-add-widgets-foot">
              <button type="button" className="ee-btn-outline" onClick={() => setAddOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="ee-btn-primary"
                onClick={() => {
                  setAddOpen(false);
                }}
              >
                Save
              </button>
            </footer>
          </aside>
        </div>
      )}
    </div>
  );
}
