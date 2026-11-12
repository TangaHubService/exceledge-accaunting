import { useMemo } from "react";
import { pushRecord } from "./server-store";
import { COST_KINDS, INCOME_KINDS, readLocal, saveLocal, type TxnIndexRow, useLocalCollection, useTxnIndex } from "./txn";

export type ProjectStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED";

export const PROJECT_STATUSES: Array<{ value: ProjectStatus; label: string }> = [
  { value: "NOT_STARTED", label: "Not started" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELED", label: "Canceled" },
];

export const statusLabel = (s: ProjectStatus) => PROJECT_STATUSES.find((x) => x.value === s)?.label ?? s;

export type ProjectFile = { id: string; name: string; size: number; type: string; dataUrl: string; addedAt: string };

export type Project = {
  id: string;
  name: string;
  code: string;
  customerId: string;
  customerName: string;
  customerAddress: string;
  email: string;
  startDate: string;
  endDate: string;
  status: ProjectStatus;
  notes: string;
  progress: number;
  starred: boolean;
  customFields: Array<{ name: string; value: string }>;
  files: ProjectFile[];
  createdAt: string;
};

/** Matches the server's document limit; attachments are stored there, not in the browser. */
export const PROJECT_FILE_MAX = 10 * 1024 * 1024;

export function useProjects() {
  return useLocalCollection<Project>("projects");
}

export function getProject(id: string) {
  return readLocal<Project>("projects").find((p) => p.id === id);
}

export function saveProject(p: Project) {
  return saveLocal<Project>("projects", p);
}

/** Saves and waits for the server, for screens that act on the project straight after. */
export async function saveProjectAndWait(p: Project) {
  await pushRecord("projects", p);
  return saveLocal<Project>("projects", p);
}

export function nextProjectCode() {
  const codes = readLocal<Project>("projects").map((p) => Number(p.code)).filter(Number.isFinite);
  return String(codes.length ? Math.max(...codes) + 1 : 1001);
}

export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Income, costs and open invoices for one project, from documents tagged to it. */
export function useProjectFigures(projectId: string) {
  const index = useTxnIndex();
  return useMemo(() => {
    const rows = index.filter((r) => r.projectId === projectId);
    const sum = (list: TxnIndexRow[]) => list.reduce((s, r) => s + r.amount, 0);
    const income = sum(rows.filter((r) => INCOME_KINDS.includes(r.kind)));
    const costs = sum(rows.filter((r) => COST_KINDS.includes(r.kind) && r.kind !== "purchase-order"));
    const estimatedIncome = sum(rows.filter((r) => r.kind === "estimate" || r.kind === "proposal"));
    const estimatedCosts = sum(rows.filter((r) => r.kind === "purchase-order"));
    const openInvoices = sum(rows.filter((r) => r.kind === "invoice"));
    const time = rows.filter((r) => r.kind === "time");
    return { rows, income, costs, estimatedIncome, estimatedCosts, openInvoices, time, profit: income - costs };
  }, [index, projectId]);
}
