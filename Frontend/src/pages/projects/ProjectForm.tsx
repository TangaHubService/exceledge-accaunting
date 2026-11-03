import { ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, Sparkles, ThumbsDown, ThumbsUp, Trash2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { AddCustomerDrawer } from "../../components/customers/AddCustomerDrawer";
import { useFeedback } from "../../components/feedback";
import { Select } from "../../components/Select";
import { CancelButton, fileSize, Modal, PartySelect, SplitButton, TField, TxnFooter, TxnPage, useValidation, ValidationSummary } from "../../components/txn/TxnKit";
import { navigate } from "../../lib/router";
import { fileToDataUrl, getProject, nextProjectCode, type Project, PROJECT_FILE_MAX, PROJECT_STATUSES, type ProjectFile, type ProjectStatus, saveProject, useProjects } from "../../lib/projects";
import { customerOptions, emailListValid, newId, useCustomers } from "../../lib/txn";
import { yup } from "../../lib/validation";

type Form = { name: string; code: string; customerId: string; email: string; startDate: string; endDate: string; status: ProjectStatus; notes: string; customFields: Array<{ name: string; value: string }> };

export function ProjectForm({ id }: { id?: string }) {
  const { toast } = useFeedback();
  const { customers, reload } = useCustomers();
  const projects = useProjects();
  const existing = id ? getProject(id) : undefined;
  const v = useValidation();
  const blank = (): Form => ({ name: "", code: nextProjectCode(), customerId: "", email: "", startDate: "", endDate: "", status: "IN_PROGRESS", notes: "", customFields: [] });
  const [form, setForm] = useState<Form>(() =>
    existing
      ? { name: existing.name, code: existing.code, customerId: existing.customerId, email: existing.email, startDate: existing.startDate, endDate: existing.endDate, status: existing.status, notes: existing.notes, customFields: existing.customFields }
      : blank(),
  );
  const [files, setFiles] = useState<ProjectFile[]>(existing?.files ?? []);
  const [agentOpen, setAgentOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [customOpen, setCustomOpen] = useState(Boolean(existing?.customFields.length));
  const [adding, setAdding] = useState(false);
  const [about, setAbout] = useState(false);
  const [helpful, setHelpful] = useState<"" | "up" | "down">("");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Form>(k: K, val: Form[K]) => (setForm((f) => ({ ...f, [k]: val })), v.clear(k));

  const schema = yup.object({
    name: yup
      .string()
      .trim()
      .required("Enter a project name")
      .max(100, "Use 100 characters or fewer")
      .test("unique", "A project with this name already exists for this customer", function (val) {
        return !projects.some((p) => p.id !== id && p.customerId === this.parent.customerId && p.name.trim().toLowerCase() === (val ?? "").trim().toLowerCase());
      }),
    code: yup
      .string()
      .trim()
      .required("Enter a project ID")
      .max(20, "Use 20 characters or fewer")
      .test("unique", "Another project already uses this ID", (val) => !projects.some((p) => p.id !== id && p.code === (val ?? "").trim())),
    customerId: yup.string().required("Choose who the project is for"),
    email: yup.string().test("email", "Enter a valid email", (val) => !val || emailListValid(val)),
    endDate: yup.string().test("order", "End date can't be before the start date", function (val) {
      return !val || !this.parent.startDate || val >= this.parent.startDate;
    }),
    notes: yup.string().max(2000, "Use 2,000 characters or fewer"),
    customFields: yup.array().of(yup.object({ name: yup.string().trim().required("Name the field").max(40, "Use 40 characters or fewer"), value: yup.string().max(200, "Use 200 characters or fewer") })),
  });

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const added: ProjectFile[] = [];
    for (const f of Array.from(list)) {
      if (!/\.(pdf|jpe?g|png|xlsx|xls)$/i.test(f.name)) {
        toast(`${f.name}: use PDF, JPG, PNG, XLSX or XLS`, { error: true });
        continue;
      }
      if (f.size > PROJECT_FILE_MAX) {
        toast(`${f.name} is larger than ${fileSize(PROJECT_FILE_MAX)}`, { error: true });
        continue;
      }
      added.push({ id: newId(), name: f.name, size: f.size, type: f.type, dataUrl: await fileToDataUrl(f), addedAt: new Date().toISOString() });
    }
    if (added.length) {
      setFiles((cur) => [...cur, ...added]);
      toast(`${added.length} file${added.length > 1 ? "s" : ""} added — they'll be saved as project attachments`);
    }
  }

  async function save(after: "close" | "new") {
    if (!(await v.validate(schema, form))) {
      setDetailsOpen(true);
      return;
    }
    const customer = customers.find((c) => c.id === form.customerId);
    const project: Project = {
      id: existing?.id ?? newId(),
      ...form,
      name: form.name.trim(),
      code: form.code.trim(),
      customerName: customer?.name ?? existing?.customerName ?? "",
      customerAddress: customer?.physicalAddress ?? existing?.customerAddress ?? "",
      progress: existing?.progress ?? 0,
      starred: existing?.starred ?? false,
      files,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    try {
      saveProject(project);
    } catch {
      return toast("Couldn't save — browser storage is full. Remove some attachments and try again.", { error: true });
    }
    toast(existing ? `${project.name} updated` : `Project ${project.name} created`);
    if (after === "new") {
      setForm(blank());
      setFiles([]);
      return;
    }
    navigate(`/projects/${project.id}`);
  }

  return (
    <TxnPage
      title={existing ? `Edit project` : "New project"}
      brand={false}
      onClose={() => navigate(existing ? `/projects/${existing.id}` : "/projects")}
      actions={["close"]}
      left={
        agentOpen ? (
          <aside className="txn-autofill" aria-label="Project Management Agent" style={{ width: 400, background: "#fff" }}>
            <div className="txn-autofill-head" style={{ borderBottom: "1px solid #dfe7f5" }}>
              <Sparkles size={26} />
              <strong>Project Management Agent</strong>
              <span className="txn-beta">BETA</span>
              <button type="button" className="txn-icon sm" aria-label="Collapse panel" onClick={() => setAgentOpen(false)}>
                <ChevronsLeft size={18} />
              </button>
            </div>
            <p style={{ fontSize: 17, margin: "16px 0" }}>Upload files like contracts, estimates, or proposals to add project details.</p>
            <div
              className={`txn-autofill-drop ${over ? "over" : ""}`}
              style={{ flex: "none", textAlign: "left" }}
              onDragOver={(e) => (e.preventDefault(), setOver(true))}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => (e.preventDefault(), setOver(false), void addFiles(e.dataTransfer.files))}
            >
              <span>Drag and drop files here</span>
              <button type="button" className="txn-autofill-tile" onClick={() => input.current?.click()} style={{ padding: "34px 10px" }}>
                <span className="ic">
                  <Upload size={26} />
                </span>
                <span style={{ color: "#1238e6", fontSize: 19 }}>Upload from this device</span>
                <span style={{ fontWeight: 450 }}>PDF, JPG, PNG, XLSX, XLS</span>
              </button>
              <input ref={input} type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls" onChange={(e) => (void addFiles(e.target.files), (e.target.value = ""))} />
            </div>
            {files.length ? (
              <ul className="txn-attach-list">
                {files.map((f) => (
                  <li key={f.id}>
                    <span className="txn-attach-name">{f.name}</span>
                    <span className="muted">{fileSize(f.size)}</span>
                    <button type="button" className="txn-icon sm" aria-label={`Remove ${f.name}`} onClick={() => setFiles((cur) => cur.filter((x) => x.id !== f.id))}>
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <p style={{ fontSize: 16, margin: "16px 10px" }}>Files you upload will be saved as project attachments and will remain accessible for your use.</p>
            <div className="txn-autofill-foot" style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 14, justifyContent: "space-between" }}>
              <button type="button" className="txn-link" style={{ textDecoration: "underline" }} onClick={() => setAbout(true)}>
                About project assistance
              </button>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span className="muted">Is this helpful?</span>
                <button type="button" className={`txn-icon sm ${helpful === "up" ? "txn-icon-box on" : ""}`} aria-label="Helpful" aria-pressed={helpful === "up"} onClick={() => (setHelpful("up"), toast("Thanks for the feedback"))}>
                  <ThumbsUp size={18} />
                </button>
                <button type="button" className={`txn-icon sm ${helpful === "down" ? "txn-icon-box on" : ""}`} aria-label="Not helpful" aria-pressed={helpful === "down"} onClick={() => (setHelpful("down"), toast("Thanks — we'll use this to improve"))}>
                  <ThumbsDown size={18} />
                </button>
              </span>
            </div>
          </aside>
        ) : (
          <div style={{ borderRight: "1px solid #dfe7f5", padding: "14px 8px" }}>
            <button type="button" className="txn-icon txn-icon-box" aria-label="Open Project Management Agent" onClick={() => setAgentOpen(true)}>
              <ChevronsRight size={18} />
            </button>
          </div>
        )
      }
      footer={
        <TxnFooter
          left={<CancelButton onClick={() => navigate(existing ? `/projects/${existing.id}` : "/projects")} />}
          right={<SplitButton label="Save and close" onClick={() => void save("close")} items={existing ? undefined : [{ label: "Save and new", onSelect: () => void save("new") }]} />}
        />
      }
    >
      <div style={{ background: "#eef3fb", margin: "-14px -28px -32px", padding: "28px", minHeight: "100%" }}>
        <ValidationSummary count={v.count} />
        <section className="txn-doc-card" style={{ padding: "18px 30px 26px", marginBottom: 26, borderRadius: 14 }}>
          <button type="button" className="txn-collapser" onClick={() => setDetailsOpen((o) => !o)} aria-expanded={detailsOpen}>
            {detailsOpen ? <ChevronDown size={24} /> : <ChevronRight size={24} />} Project details
          </button>
          {detailsOpen ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "18px 26px", marginTop: 14 }} className="txn-label-light">
              <TField label="Project name" required error={v.errors.name}>
                <input className="txn-input" value={form.name} onChange={(e) => set("name", e.target.value)} />
              </TField>
              <TField label="Project ID" required error={v.errors.code}>
                <input className="txn-input" value={form.code} onChange={(e) => set("code", e.target.value)} />
              </TField>
              <TField label="Customer" required error={v.errors.customerId}>
                <PartySelect
                  value={form.customerId}
                  onChange={(cid) => {
                    const c = customers.find((x) => x.id === cid);
                    setForm((f) => ({ ...f, customerId: cid, email: f.email || c?.email || "" }));
                    v.clear("customerId");
                  }}
                  options={customerOptions(customers)}
                  placeholder="Who's the project for?"
                  invalid={Boolean(v.errors.customerId)}
                  addLabel="Add new customer"
                  onAdd={() => setAdding(true)}
                />
              </TField>
              <TField label="Email" error={v.errors.email}>
                <input className="txn-input" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
              </TField>
              <span />
              <span />
              <TField label="Start date">
                <input className="txn-input" type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
              </TField>
              <TField label="End date" error={v.errors.endDate}>
                <input className="txn-input" type="date" value={form.endDate} min={form.startDate || undefined} onChange={(e) => set("endDate", e.target.value)} />
              </TField>
              <TField label="Status">
                <Select value={form.status} onChange={(s) => set("status", s as ProjectStatus)} options={PROJECT_STATUSES} searchable={false} />
              </TField>
              <TField label="Notes" error={v.errors.notes} className="span-2">
                <textarea className="txn-textarea" value={form.notes} placeholder="Add details you want to remember" onChange={(e) => set("notes", e.target.value)} />
              </TField>
            </div>
          ) : null}
        </section>
        <section className="txn-doc-card" style={{ padding: "18px 30px", borderRadius: 14 }}>
          <button type="button" className="txn-collapser" onClick={() => setCustomOpen((o) => !o)} aria-expanded={customOpen}>
            {customOpen ? <ChevronDown size={24} /> : <ChevronRight size={24} />} Custom fields
          </button>
          {customOpen ? (
            <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
              {form.customFields.map((cf, i) => (
                <div key={i} className="txn-row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                  <TField label="Field name" required error={v.errors[`customFields[${i}].name`]} className="w-md">
                    <input className="txn-input" value={cf.name} onChange={(e) => set("customFields", form.customFields.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  </TField>
                  <TField label="Value" error={v.errors[`customFields[${i}].value`]} className="grow">
                    <input className="txn-input" value={cf.value} onChange={(e) => set("customFields", form.customFields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                  </TField>
                  <button type="button" className="txn-icon" style={{ marginTop: 30 }} aria-label="Remove field" onClick={() => set("customFields", form.customFields.filter((_, j) => j !== i))}>
                    <X size={18} />
                  </button>
                </div>
              ))}
              <button type="button" className="txn-link" onClick={() => set("customFields", [...form.customFields, { name: "", value: "" }])}>
                + Add custom field
              </button>
            </div>
          ) : null}
        </section>
      </div>
      {adding ? (
        <AddCustomerDrawer
          onClose={() => setAdding(false)}
          onSaved={(c) => {
            setAdding(false);
            reload();
            setForm((f) => ({ ...f, customerId: c.id, email: f.email || c.email || "" }));
          }}
        />
      ) : null}
      {about ? (
        <Modal title="About project assistance" onClose={() => setAbout(false)}>
          <p style={{ margin: 0 }}>Files you add here are kept with the project as attachments, so contracts, estimates and proposals stay in one place.</p>
          <p style={{ margin: 0 }}>Enter the project details on the right — they aren't read from the files automatically yet.</p>
        </Modal>
      ) : null}
    </TxnPage>
  );
}
