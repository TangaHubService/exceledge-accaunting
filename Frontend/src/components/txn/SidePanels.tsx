import { ChevronDown, ChevronUp, CornerDownRight, FolderOpen, Link2, Maximize2, Minimize2, MoreVertical, Paperclip, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCompany } from "../../lib/company";
import { amount, date, isoDay, toNumber } from "../../lib/format";
import { navigate } from "../../lib/router";
import { useResource, useSession } from "../../lib/session";
import { newId, saveLocal, TXN_LABELS, useLocalCollection, useTxnIndex } from "../../lib/txn";
import type { ArInvoiceList } from "../../lib/types";
import { MANAGE_USERS } from "../../lib/users-dummy";
import { yup } from "../../lib/validation";
import { useFeedback } from "../feedback";
import { Select } from "../Select";
import { fileSize, TField, useValidation } from "./TxnKit";

/* ── Tasks ─────────────────────────────────────────────── */

export type Task = {
  id: string;
  name: string;
  description: string;
  assignee: string;
  dueDate: string;
  priority: "" | "LOW" | "MEDIUM" | "HIGH";
  recurring: boolean;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  links: Array<{ id: string; label: string }>;
  files: Array<{ name: string; size: number }>;
  done: boolean;
  createdAt: string;
};

export function useTasks() {
  return useLocalCollection<Task>("tasks");
}

export function saveTask(t: Task) {
  saveLocal("tasks", t);
}

export function AddTaskDrawer({ onClose }: { onClose: () => void }) {
  const { toast } = useFeedback();
  const index = useTxnIndex();
  const v = useValidation();
  const [form, setForm] = useState({ name: "", description: "", assignee: "", dueDate: isoDay(), priority: "" as Task["priority"], recurring: false, frequency: "WEEKLY" as Task["frequency"] });
  const [links, setLinks] = useState<Task["links"]>([]);
  const [files, setFiles] = useState<Task["files"]>([]);
  const [linksOpen, setLinksOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(true);
  const [picking, setPicking] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof typeof form>(k: K, val: (typeof form)[K]) => (setForm((f) => ({ ...f, [k]: val })), v.clear(k));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const schema = yup.object({
    name: yup.string().trim().required("Give the task a name").max(120, "Use 120 characters or fewer"),
    description: yup.string().max(2000, "Use 2,000 characters or fewer"),
    dueDate: yup
      .string()
      .required("Choose a due date")
      .test("past", "Due date can't be in the past", (val) => !val || val >= isoDay()),
  });

  async function save() {
    if (!(await v.validate(schema, form))) return;
    saveTask({ id: newId(), ...form, name: form.name.trim(), links, files, done: false, createdAt: new Date().toISOString() });
    toast(`Task "${form.name.trim()}" added`);
    onClose();
  }

  const recordOptions = useMemo(() => index.slice(0, 200).map((r) => ({ value: r.id, label: `${TXN_LABELS[r.kind]} ${r.number ? `#${r.number}` : ""} · ${r.party || "—"}`, hint: date(r.date) })), [index]);

  return createPortal(
    <>
      <div className="side-panel-backdrop" onClick={onClose} />
      <aside className="side-panel" role="dialog" aria-modal="true" aria-label="Add task">
        <div className="side-panel-head">
          <h2>Add task</h2>
          <button type="button" className="txn-icon" aria-label="Close" onClick={onClose}>
            <X size={24} />
          </button>
        </div>
        <div className="side-panel-body">
          <TField label="Task name" required error={v.errors.name}>
            <input className="txn-input" value={form.name} autoFocus onChange={(e) => set("name", e.target.value)} />
          </TField>
          <TField label="Description" error={v.errors.description}>
            <textarea className="txn-textarea" rows={4} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </TField>
          <TField label="Assign to" className="w-md">
            <Select value={form.assignee} onChange={(a) => set("assignee", a)} options={MANAGE_USERS.map((u) => ({ value: u.email, label: u.name }))} placeholder="Select one" />
          </TField>
          <TField label="Due date" required error={v.errors.dueDate} className="w-md">
            <input className="txn-input" type="date" min={isoDay()} value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
          </TField>
          <TField label="Priority" className="w-md">
            <Select
              value={form.priority}
              onChange={(p) => set("priority", p as Task["priority"])}
              searchable={false}
              options={[
                { value: "", label: "-" },
                { value: "LOW", label: "Low" },
                { value: "MEDIUM", label: "Medium" },
                { value: "HIGH", label: "High" },
              ]}
            />
          </TField>
          <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 17 }}>
            Recurring task
            <button type="button" role="switch" aria-checked={form.recurring} aria-label="Recurring task" className={`txn-toggle ${form.recurring ? "on" : ""}`} onClick={() => set("recurring", !form.recurring)} />
          </div>
          {form.recurring ? (
            <TField label="Repeats" className="w-md">
              <Select
                value={form.frequency}
                onChange={(f) => set("frequency", f as Task["frequency"])}
                searchable={false}
                options={[
                  { value: "DAILY", label: "Daily" },
                  { value: "WEEKLY", label: "Weekly" },
                  { value: "MONTHLY", label: "Monthly" },
                ]}
              />
            </TField>
          ) : null}
          <section className="side-panel-section">
            <button type="button" className="side-sec-toggle" onClick={() => setLinksOpen((o) => !o)} aria-expanded={linksOpen}>
              Linked records ({links.length}) {linksOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
            {linksOpen ? (
              <>
                {links.length ? (
                  <ul className="task-links" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {links.map((l) => (
                      <li key={l.id}>
                        {l.label}
                        <button type="button" className="txn-icon sm" aria-label={`Unlink ${l.label}`} onClick={() => setLinks((ls) => ls.filter((x) => x.id !== l.id))}>
                          <X size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {picking ? (
                  <Select
                    value=""
                    onChange={(id) => {
                      const o = recordOptions.find((r) => r.value === id);
                      if (o && !links.some((l) => l.id === id)) setLinks((ls) => [...ls, { id, label: o.label }]);
                      setPicking(false);
                    }}
                    options={recordOptions}
                    placeholder="Find a transaction"
                    searchable
                    emptyText="No saved transactions yet"
                  />
                ) : (
                  <button type="button" className="txn-link" style={{ fontSize: 19 }} onClick={() => setPicking(true)}>
                    <Link2 size={22} /> Link a record
                  </button>
                )}
              </>
            ) : null}
          </section>
          <section className="side-panel-section">
            <button type="button" className="side-sec-toggle" onClick={() => setFilesOpen((o) => !o)} aria-expanded={filesOpen}>
              Attachments ({files.length}) {filesOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
            {filesOpen ? (
              <>
                {files.length ? (
                  <ul className="task-links" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {files.map((f) => (
                      <li key={f.name}>
                        <span>
                          <Paperclip size={14} /> {f.name} <span className="muted">{fileSize(f.size)}</span>
                        </span>
                        <button type="button" className="txn-icon sm" aria-label={`Remove ${f.name}`} onClick={() => setFiles((fs) => fs.filter((x) => x.name !== f.name))}>
                          <Trash2 size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="task-empty">
                    <span className="prj-folder" style={{ width: 110, height: 104 }}>
                      <FolderOpen size={56} />
                    </span>
                    <h3>Nothing to see here yet</h3>
                    <p style={{ margin: 0, fontSize: 17 }}>Upload a document to get started</p>
                  </div>
                )}
                <button type="button" className="txn-link" style={{ fontSize: 19 }} onClick={() => fileInput.current?.click()}>
                  <Paperclip size={22} /> Add a document
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    const list = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    const big = list.filter((f) => f.size > 20 * 1024 * 1024);
                    if (big.length) toast(`${big.map((f) => f.name).join(", ")} is larger than 20 MB`, { error: true });
                    setFiles((fs) => [...fs, ...list.filter((f) => f.size <= 20 * 1024 * 1024 && !fs.some((x) => x.name === f.name)).map((f) => ({ name: f.name, size: f.size }))]);
                  }}
                />
              </>
            ) : null}
          </section>
        </div>
        <div className="side-panel-foot">
          <button type="button" className="txn-btn-primary" style={{ fontSize: 19, fontWeight: 750 }} onClick={() => void save()}>
            Save
          </button>
        </div>
      </aside>
    </>,
    document.body,
  );
}

/* ── AI assistant ──────────────────────────────────────── */

type Msg = { from: "user" | "bot"; text: string; links?: Array<{ label: string; to: string }> };

const ROUTES: Array<{ words: string[]; label: string; to: string }> = [
  { words: ["invoice", "bill a customer", "charge"], label: "Create an invoice", to: "/sales/invoice/new" },
  { words: ["payment", "paid", "receive"], label: "Receive a payment", to: "/sales/receive-payment/new" },
  { words: ["estimate", "quote"], label: "Create an estimate", to: "/sales/estimate/new" },
  { words: ["bill", "supplier invoice"], label: "Enter a bill", to: "/expenses/bill/new" },
  { words: ["pay bills", "pay supplier"], label: "Pay bills", to: "/expenses/pay-bills" },
  { words: ["journal"], label: "Make a journal entry", to: "/accounting/journal-entry/new" },
  { words: ["transfer"], label: "Transfer between accounts", to: "/banking/transfer/new" },
  { words: ["deposit"], label: "Record a bank deposit", to: "/banking/deposit/new" },
  { words: ["project"], label: "Projects", to: "/projects" },
  { words: ["reconcile", "reconciliation"], label: "Reconcile an account", to: "/banking/reconciliation" },
  { words: ["rule"], label: "Bank rules", to: "/banking/rules" },
  { words: ["tax", "vat"], label: "VAT returns", to: "/tax/vat" },
  { words: ["report", "profit", "balance sheet", "statement"], label: "Financial statements", to: "/reports/statements" },
  { words: ["customer"], label: "Customers", to: "/customers" },
  { words: ["supplier", "vendor"], label: "Suppliers", to: "/suppliers" },
];

export function AIAssistantPanel({ onClose }: { onClose: () => void }) {
  const { can } = useSession();
  const { currency } = useCompany();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [wide, setWide] = useState(false);
  const [menu, setMenu] = useState(false);
  const overdue = useResource<ArInvoiceList>(can("ar:view") ? "/api/v1/ar/invoices?status=OVERDUE&pageSize=1" : null);
  const open = useResource<ArInvoiceList>(can("ar:view") ? "/api/v1/ar/invoices?status=OPEN&pageSize=1" : null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function answer(q: string): Msg {
    const s = q.toLowerCase();
    if (/ways to use|what can you/.test(s))
      return {
        from: "bot",
        text: "I can point you to the right screen and summarise what's in your books right now. Try asking:\n• How are my books looking?\n• How do I send an invoice?\n• Where do I record a bill?",
      };
    if (/books looking|health|overview|how are (we|my)/.test(s)) {
      const o = open.data;
      const od = overdue.data;
      if (!o) return { from: "bot", text: "I couldn't load your receivables just now. Open the dashboard for the full picture.", links: [{ label: "Home dashboard", to: "/" }] };
      return {
        from: "bot",
        text: `Here's a quick check:\n• Open invoices: ${o.total}, worth ${currency} ${amount(toNumber(o.totals.outstanding), 2)} still to collect.\n• Overdue: ${od?.total ?? 0} invoice${od?.total === 1 ? "" : "s"}, ${currency} ${amount(toNumber(od?.totals.outstanding ?? 0), 2)}.\n${od?.total ? "Following up on overdue invoices is the quickest win." : "Nothing is overdue — nice work."}`,
        links: od?.total ? [{ label: "See overdue invoices", to: "/invoices?show=overdue" }] : [{ label: "Open invoices", to: "/invoices" }],
      };
    }
    if (/send.*invoice|track.*invoice/.test(s))
      return {
        from: "bot",
        text: "Create the invoice, then choose Review and send. You'll see the email before it goes, and you can share a link or send by WhatsApp from the arrow next to it. Track what's paid under Sales → Invoices.",
        links: [
          { label: "Create an invoice", to: "/sales/invoice/new" },
          { label: "Invoices list", to: "/invoices" },
        ],
      };
    const hits = ROUTES.filter((r) => r.words.some((w) => s.includes(w))).slice(0, 3);
    if (hits.length) return { from: "bot", text: "These should help:", links: hits.map((h) => ({ label: h.label, to: h.to })) };
    return { from: "bot", text: "I'm not sure about that one yet. I can help you find screens (invoices, bills, journals, projects, reports) and give a quick health check of your books.", links: [{ label: "Help centre", to: "/" }] };
  }

  function ask(q: string) {
    const clean = q.trim();
    if (!clean) return;
    if (clean.length > 1000) return;
    setMsgs((m) => [...m, { from: "user", text: clean }, answer(clean)]);
    setText("");
  }

  return createPortal(
    <aside className={`side-panel ai-panel ${wide ? "wide" : ""}`} role="dialog" aria-label="AI Assistant">
      <div className="side-panel-head">
        <h2>AI Assistant</h2>
        <span className="txn-beta" style={{ background: "#1238e6" }}>
          BETA
        </span>
        <div className="ai-head-actions">
          <button type="button" className="txn-icon" aria-label={wide ? "Exit full screen" : "Full screen"} onClick={() => setWide((w) => !w)}>
            {wide ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
          </button>
          <span style={{ position: "relative" }}>
            <button type="button" className="txn-icon" aria-label="More options" onClick={() => setMenu((m) => !m)}>
              <MoreVertical size={20} />
            </button>
            {menu ? (
              <div className="prj-menu" style={{ right: 0, left: "auto" }}>
                <button type="button" onClick={() => { setMsgs([]); setMenu(false); }}>
                  New chat
                </button>
              </div>
            ) : null}
          </span>
          <button type="button" className="txn-icon" aria-label="Close" onClick={onClose}>
            <X size={22} />
          </button>
        </div>
      </div>
      <div className="side-panel-body">
        {msgs.length === 0 ? (
          <div className="ai-hero">
            <Sparkles size={34} color="#1238e6" />
            <h3>The power of AI and trusted human experts, working for you</h3>
            <p>Get insights and answers to help you make confident business decisions.</p>
            <button type="button" className="ai-chip" onClick={() => ask("Ways to use AI Assistant")}>
              <CornerDownRight size={18} /> Ways to use AI Assistant
            </button>
            <p>Stay on top of your business finances with a quick health check.</p>
            <button type="button" className="ai-chip" onClick={() => ask("How are my books looking?")}>
              <CornerDownRight size={18} /> How are my books looking?
            </button>
            <p>Make day-to-day sales management smooth.</p>
            <button type="button" className="ai-chip" onClick={() => ask("How to send and track invoices")}>
              <CornerDownRight size={18} /> How to send and track invoices
            </button>
          </div>
        ) : (
          <div className="ai-msgs">
            {msgs.map((m, i) => (
              <div key={i} className={`ai-msg ${m.from}`}>
                {m.text}
                {m.links?.length ? (
                  <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
                    {m.links.map((l) => (
                      <button key={l.to} type="button" className="txn-link" onClick={() => navigate(l.to)}>
                        → {l.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            <div ref={bottom} />
          </div>
        )}
      </div>
      <form
        className="ai-input"
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
      >
        <textarea
          rows={2}
          value={text}
          maxLength={1000}
          placeholder="Ask anything"
          aria-label="Ask anything"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(text);
            }
          }}
        />
        <div className="ai-input-row">
          <button type="button" className="txn-icon sm" aria-label="Start a new chat" onClick={() => setMsgs(() => [])}>
            <Plus size={20} />
          </button>
          <button type="submit" className="txn-icon sm" aria-label="Send" disabled={!text.trim()}>
            <Send size={18} />
          </button>
        </div>
      </form>
      <p className="ai-foot">
        AI can make mistakes. Review important information.{" "}
        <button type="button" className="txn-link" style={{ fontSize: 12.5, fontWeight: 700 }} onClick={() => navigate("/settings/advanced")}>
          How we use AI.
        </button>
      </p>
    </aside>,
    document.body,
  );
}
