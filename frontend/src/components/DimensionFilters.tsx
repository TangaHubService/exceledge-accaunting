import { setQueryParam } from "../lib/router";
import { useResource } from "../lib/session";
import { Select } from "./Select";
import { Field } from "./ui";

type Dimension = { id: string; kind: "COST_CENTRE" | "PROJECT"; code: string; name: string; isActive: boolean };
type BranchRow = { key: string; name: string | null };

export const DIMENSION_PARAMS = ["costCentre", "project", "branchId"] as const;

/** Copies the cost centre, project and branch filters from the page's query string into `params`. */
export function addDimensionParams(params: URLSearchParams, query: URLSearchParams) {
  for (const key of DIMENSION_PARAMS) {
    const value = query.get(key);
    if (value) params.set(key, value);
  }
  return params;
}

/** Cost centre, project and branch selects kept in the page's query string. */
export function DimensionFilters({ query }: { query: URLSearchParams }) {
  const dimensions = useResource<Dimension[]>("/api/v1/books/dimensions");
  const branches = useResource<BranchRow[]>("/api/v1/books/dimensions/report?kind=BRANCH");
  const options = (kind: Dimension["kind"], all: string) => [
    { value: "", label: all },
    ...(dimensions.data ?? []).filter((d) => d.kind === kind).map((d) => ({ value: d.code, label: `${d.code} · ${d.name}` })),
  ];
  const branchOptions = [
    { value: "", label: "All branches" },
    ...(branches.data ?? []).filter((b) => b.key !== "Unassigned").map((b) => ({ value: b.key, label: b.name ?? b.key })),
  ];
  return (
    <>
      <Field label="Cost centre">
        <Select value={query.get("costCentre") ?? ""} onChange={(v) => setQueryParam("costCentre", v || null)} options={options("COST_CENTRE", "All cost centres")} style={{ minWidth: 160 }} />
      </Field>
      <Field label="Project">
        <Select value={query.get("project") ?? ""} onChange={(v) => setQueryParam("project", v || null)} options={options("PROJECT", "All projects")} style={{ minWidth: 160 }} />
      </Field>
      <Field label="Branch">
        <Select value={query.get("branchId") ?? ""} onChange={(v) => setQueryParam("branchId", v || null)} options={branchOptions} style={{ minWidth: 160 }} />
      </Field>
    </>
  );
}
