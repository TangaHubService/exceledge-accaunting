import { Download, Upload } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { useFeedback } from "../components/feedback";
import { Drawer, EmptyState, Field, Loadable, PageHeader } from "../components/ui";
import { dateTime, isoDay } from "../lib/format";
import { Link } from "../lib/router";
import { useResource, useSession } from "../lib/session";

type Item = { id: string; note: string | null; createdAt: string; files: Array<{ id: string; fileName: string; stored: boolean }> };
type Bank = { id: string; name: string; isActive: boolean };

export function ReceiptInbox() {
  const { api, can, download } = useSession();
  const { toast, confirm } = useFeedback();
  const res = useResource<Item[]>("/api/v1/expenses/inbox");
  const [busy, setBusy] = useState(false);
  const [using, setUsing] = useState<Item | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const manage = can("expense:manage");
  const problem = (e: unknown) => toast((e as Error).message, { error: true });

  async function attach(itemId: string, file: File) {
    const form = new FormData();
    form.append("entityType", "ReceiptInbox");
    form.append("entityId", itemId);
    form.append("file", file);
    await api("/api/v1/books/documents/upload", { method: "POST", body: form });
  }
  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    setBusy(true);
    let done = 0;
    for (const file of files) {
      try {
        const item = await api<{ id: string }>("/api/v1/expenses/inbox", { method: "POST", body: JSON.stringify({ note: file.name.slice(0, 200) }) });
        try {
          await attach(item.id, file);
          done += 1;
        } catch (err) {
          // An inbox entry without its file is no use.
          await api(`/api/v1/expenses/inbox/${item.id}/dismiss`, { method: "POST", body: "{}" });
          throw err;
        }
      } catch (err) {
        toast(`${file.name}: ${(err as Error).message}`, { error: true });
      }
    }
    if (done) toast(`${done} receipt${done === 1 ? "" : "s"} added`);
    setBusy(false);
    res.reload();
  }
  async function dismiss(item: Item) {
    if (!(await confirm({ title: "Remove this receipt?", body: "It leaves the inbox without becoming an expense.", confirmLabel: "Remove", danger: true }))) return;
    try {
      await api(`/api/v1/expenses/inbox/${item.id}/dismiss`, { method: "POST", body: "{}" });
      res.reload();
    } catch (e) {
      problem(e);
    }
  }
  return (
    <>
      <PageHeader
        title="Receipts"
        description="Upload receipts now and turn each one into a draft expense. Details are typed in; nothing is read from the picture."
        back={{ to: "/expenses", label: "Expenses" }}
        actions={manage ? (
          <>
            <input ref={input} type="file" hidden multiple accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => void upload(e)} />
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}><Upload size={16} aria-hidden="true" /> {busy ? "Uploading…" : "Upload receipts"}</button>
          </>
        ) : undefined}
      />
      <Loadable resource={res}>
        {(items) =>
          items.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Receipt</th><th>Added</th><th /></tr></thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        {i.files.length ? i.files.map((f) => (
                          <button key={f.id} type="button" className="ee-link-btn" disabled={!f.stored} onClick={() => void download(`/api/v1/books/documents/${f.id}/download`, f.fileName).catch(problem)}><Download size={14} aria-hidden="true" /> {f.fileName}</button>
                        )) : i.note || "No file"}
                      </td>
                      <td className="nowrap muted">{dateTime(i.createdAt)}</td>
                      <td className="num nowrap">{manage && <><button type="button" className="btn btn-sm btn-primary" onClick={() => setUsing(i)}>Create expense</button> <button type="button" className="btn btn-sm" onClick={() => void dismiss(i)}>Remove</button></>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="The inbox is empty" body={<>Receipts waiting for an expense appear here. <Link to="/expenses">See expenses</Link></>} />
          )
        }
      </Loadable>
      {using && <UseReceipt item={using} onClose={() => setUsing(null)} onDone={() => { setUsing(null); res.reload(); }} />}
    </>
  );
}

function UseReceipt({ item, onClose, onDone }: { item: Item; onClose: () => void; onDone: () => void }) {
  const { api, can } = useSession();
  const { toast } = useFeedback();
  const categories = useResource<Array<{ id: string; name: string; isActive: boolean }>>("/api/v1/expenses/categories");
  const banks = useResource<Bank[]>(can("bank:view") ? "/api/v1/banking/accounts" : null);
  const [f, setF] = useState({ expenseDate: isoDay(), categoryId: "", payeeName: "", description: "", net: "", tax: "", financialAccountId: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => setF((v) => ({ ...v, ...patch }));
  async function save() {
    if (!f.categoryId || !(Number(f.net) > 0)) return setError("Choose a category and enter the amount");
    setBusy(true);
    try {
      const made = await api<{ number: string }>(`/api/v1/expenses/inbox/${item.id}/expense`, { method: "POST", body: JSON.stringify({ expenseDate: f.expenseDate, categoryId: f.categoryId, net: Number(f.net), ...(Number(f.tax) ? { tax: Number(f.tax) } : {}), ...(f.payeeName.trim() ? { payeeName: f.payeeName.trim() } : {}), ...(f.description.trim() ? { description: f.description.trim() } : {}), ...(f.financialAccountId ? { financialAccountId: f.financialAccountId } : {}) }) });
      toast(`Draft expense ${made.number} created`);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Drawer title="Create expense" subtitle={item.files[0]?.fileName ?? item.note} onClose={onClose} footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Create draft"}</button></>}>
      {error && <p className="text-negative" role="alert">{error}</p>}
      <div className="form-grid">
        <Field label="Date" required><input className="input" type="date" value={f.expenseDate} onChange={(e) => set({ expenseDate: e.target.value })} /></Field>
        <Field label="Category" required><select className="input" value={f.categoryId} onChange={(e) => set({ categoryId: e.target.value })}><option value="">Choose</option>{(categories.data ?? []).filter((c) => c.isActive !== false).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Paid to" className="span-2"><input className="input" maxLength={160} value={f.payeeName} onChange={(e) => set({ payeeName: e.target.value })} /></Field>
        <Field label="Amount before VAT" required><input className="input" type="number" min="0" step="0.01" value={f.net} onChange={(e) => set({ net: e.target.value })} /></Field>
        <Field label="VAT"><input className="input" type="number" min="0" step="0.01" value={f.tax} onChange={(e) => set({ tax: e.target.value })} /></Field>
        <Field label="Paid from" className="span-2"><select className="input" value={f.financialAccountId} onChange={(e) => set({ financialAccountId: e.target.value })}><option value="">Company default</option>{(banks.data ?? []).filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Description" className="span-2"><input className="input" maxLength={2000} value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      </div>
    </Drawer>
  );
}
