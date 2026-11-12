/**
 * Keeps the screens' local collections in step with the accounting API. Pages keep reading from this
 * browser's cache so they render at once; the server is the source of truth, loaded on sign-in and written
 * through on every save.
 */
type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

let api: Api | null = null;

/** Local collection → where it lives on the server. Anything not listed has no server copy. */
const WORKSPACE = new Set([
  "custom-reports",
  "management-reports",
  "report-favourites",
  "report-feedback",
  "custom-kpis",
  "kpi-hidden",
  "forecasts",
  "planner-items",
  "planner-started",
  "performance-layout",
  "recurring",
  "statement",
]);

function recordPath(collection: string, id: string) {
  const key = encodeURIComponent(id);
  if (collection === "projects") return `/api/v1/projects/${key}`;
  if (collection === "tasks") return `/api/v1/tasks/${key}`;
  if (WORKSPACE.has(collection)) return `/api/v1/workspace/records/${collection}/${key}`;
  return null;
}

const SAVE_FAILED = "ee-server-save-failed";

function report(error: unknown) {
  window.dispatchEvent(new CustomEvent(SAVE_FAILED, { detail: (error as Error).message }));
}

/** Tells the caller when something couldn't reach the server. Returns the unsubscribe. */
export function onServerSaveFailed(listener: (message: string) => void) {
  const handler = (e: Event) => listener((e as CustomEvent<string>).detail);
  window.addEventListener(SAVE_FAILED, handler);
  return () => window.removeEventListener(SAVE_FAILED, handler);
}

/** Sends a saved record to the server. The promise rejects if it was refused, for callers that wait. */
export async function pushRecord(collection: string, record: { id: string }) {
  const path = recordPath(collection, record.id);
  if (!path || !api) return;
  await api(path, { method: "PUT", body: JSON.stringify(record) });
}

export function pushRecordInBackground(collection: string, record: { id: string }) {
  pushRecord(collection, record).catch(report);
}

export function removeRecordInBackground(collection: string, id: string) {
  const path = recordPath(collection, id);
  if (path && api) api(path, { method: "DELETE" }).catch(report);
}

/** Tags a saved document to a project on the server; its income and costs then come from the GL. */
export function linkToProject(projectId: string, kind: string, sourceId: string) {
  if (api) api(`/api/v1/projects/${encodeURIComponent(projectId)}/links`, { method: "POST", body: JSON.stringify({ links: [{ kind, sourceId }] }) }).catch(report);
}

export function unlinkFromProject(projectId: string, kind: string, sourceId: string) {
  if (!api) return Promise.resolve();
  return api(`/api/v1/projects/${encodeURIComponent(projectId)}/links/${encodeURIComponent(kind)}/${encodeURIComponent(sourceId)}`, { method: "DELETE" });
}

const day = (value: unknown) => (typeof value === "string" ? value.slice(0, 10) : "");

/** Server rows in the shape the screens expect. */
const fromServer: Record<string, (row: Record<string, unknown>) => unknown> = {
  projects: (r) => ({
    ...r,
    customerId: r.customerId ?? "",
    customerName: r.customerName ?? "",
    customerAddress: r.customerAddress ?? "",
    email: r.email ?? "",
    notes: r.notes ?? "",
    startDate: day(r.startDate),
    endDate: day(r.endDate),
    budget: r.budget === null || r.budget === undefined ? null : Number(r.budget),
    customFields: r.customFields ?? [],
    files: [],
  }),
  tasks: (r) => ({
    ...r,
    description: r.description ?? "",
    assignee: r.assignee ?? "",
    priority: r.priority ?? "",
    frequency: r.frequency ?? "WEEKLY",
    dueDate: day(r.dueDate),
    links: r.links ?? [],
    files: r.files ?? [],
  }),
};

function writeCache(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or blocked cache only costs speed: the server still has the data.
  }
  window.dispatchEvent(new CustomEvent("ee-local-store", { detail: key }));
}

const MIGRATED = "ee.server-store.migrated";

/** Records saved in this browser before the server could hold them go up once, so nothing is lost. */
async function migrateLocalRecords(collections: Record<string, unknown[]>, projects: unknown[], tasks: unknown[]) {
  if (localStorage.getItem(MIGRATED)) return false;
  const known: Record<string, unknown[]> = { ...collections, projects, tasks };
  let moved = false;
  for (const collection of [...WORKSPACE, "projects", "tasks"]) {
    let local: Array<{ id: string }> = [];
    try {
      local = JSON.parse(localStorage.getItem(`ee.local.${collection}`) ?? "[]");
    } catch {
      continue;
    }
    const onServer = new Set((known[collection] ?? []).map((r) => (r as { id: string }).id));
    for (const record of local) {
      if (onServer.has(record.id)) continue;
      await pushRecord(collection, record).catch(report);
      moved = true;
    }
  }
  localStorage.setItem(MIGRATED, "1");
  return moved;
}

type Bootstrap = {
  collections: Record<string, unknown[]>;
  nextNumbers: Record<string, string>;
  projects: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  transactions: unknown[];
};

/** Loads the company's records into the cache. */
export async function hydrate() {
  if (!api) return;
  let data = await api<Bootstrap>("/api/v1/workspace/bootstrap");
  if (await migrateLocalRecords(data.collections, data.projects, data.tasks)) data = await api<Bootstrap>("/api/v1/workspace/bootstrap");
  for (const [collection, rows] of Object.entries(data.collections)) writeCache(`ee.local.${collection}`, rows);
  writeCache("ee.local.projects", data.projects.map(fromServer.projects));
  writeCache("ee.local.tasks", data.tasks.map(fromServer.tasks));
  writeCache("ee.txn.index", data.transactions);
  for (const [series, next] of Object.entries(data.nextNumbers)) writeCache(`ee.seq.${series}`, Number(next));
}

export function connectServerStore(client: Api) {
  api = client;
}

/** Nothing the company saved stays behind in this browser after signing out. */
export function clearServerCache() {
  api = null;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("ee.local.") || key.startsWith("ee.seq.") || key === "ee.txn.index") localStorage.removeItem(key);
  }
}
