import { ArrowDown, ArrowUp } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useMemo, useState } from "react";
import { clampPage, usePagination } from "../lib/pagination";
import { Pagination } from "./Pagination";

export type Column<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Provide to make the column sortable. */
  sortValue?: (row: T) => string | number;
  numeric?: boolean;
  className?: string;
  width?: number | string;
};

type Sort = { key: string; dir: "asc" | "desc" };

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  initialSort,
  empty,
  footer,
  rowClassName,
  pageSize = 50,
  loading = false,
  paginationKey,
  showPagination = true,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  initialSort?: Sort;
  empty?: ReactNode;
  footer?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
  pageSize?: number;
  /**
   * Show skeleton rows in place (header and footer layout kept, so page
   * changes and pagination don't shift the layout). Ignored once rows exist.
   */
  loading?: boolean;
  /** Scopes the persisted rows-per-page preference. Defaults to shared. */
  paginationKey?: string;
  /** Set false when the parent pages on the server and renders its own bar. */
  showPagination?: boolean;
}) {
  const [sort, setSort] = useState<Sort | undefined>(initialSort);
  const { page, pageSize: size, setPage, setPageSize } = usePagination({ key: paginationKey ?? "datatable", defaultPageSize: pageSize });
  const [pagedRows, setPagedRows] = useState(rows);
  if (pagedRows !== rows) {
    setPagedRows(rows);
    setPage(1);
  }

  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!sort || !col?.sortValue) return rows;
    const get = col.sortValue;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (typeof x === "number" && typeof y === "number") return (x - y) * factor;
      return String(x).localeCompare(String(y), undefined, { numeric: true }) * factor;
    });
  }, [rows, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / size));
  const current = clampPage(page, pageCount);
  const visible = pageCount > 1 ? sorted.slice((current - 1) * size, current * size) : sorted;

  function toggle(col: Column<T>) {
    setPage(1);
    setSort((s) =>
      s?.key === col.key
        ? { key: col.key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key: col.key, dir: col.numeric ? "desc" : "asc" },
    );
  }

  function onKey(e: KeyboardEvent<HTMLTableRowElement>, row: T) {
    if (e.key === "Enter" && e.target === e.currentTarget) onRowClick?.(row);
  }

  const showSkeleton = loading && sorted.length === 0;
  const skeletonRows = Math.min(size, 8);

  return (
    <div className="table-wrap" aria-busy={showSkeleton || undefined} aria-label={showSkeleton ? "Loading table" : undefined}>
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`${c.numeric ? "num" : ""} ${c.className ?? ""}`}
                style={c.width ? { width: c.width } : undefined}
                aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
              >
                {c.sortValue ? (
                  <button type="button" onClick={() => toggle(c)}>
                    {c.header}
                    {sort?.key === c.key &&
                      (sort.dir === "asc" ? (
                        <ArrowUp size={12} className="sort" aria-hidden="true" />
                      ) : (
                        <ArrowDown size={12} className="sort" aria-hidden="true" />
                      ))}
                  </button>
                ) : (
                  c.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {showSkeleton &&
            Array.from({ length: skeletonRows }, (_, r) => (
              <tr key={`sk-${r}`} aria-hidden="true">
                {columns.map((c, cIdx) => (
                  <td key={c.key} className={`${c.numeric ? "num" : ""} ${c.className ?? ""}`}>
                    <span className="skeleton" style={{ width: `${[60, 45, 75, 55, 65, 40][(r + cIdx) % 6]}%` }} />
                  </td>
                ))}
              </tr>
            ))}
          {!showSkeleton &&
            visible.map((row) => (
            <tr
              key={rowKey(row)}
              className={`${onRowClick ? "clickable" : ""} ${rowClassName?.(row) ?? ""}`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => onKey(e, row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={`${c.numeric ? "num" : ""} ${c.className ?? ""}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
          {!showSkeleton && sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} style={{ padding: 0 }}>
                {empty}
              </td>
            </tr>
          )}
        </tbody>
        {footer && sorted.length > 0 && <tfoot>{footer}</tfoot>}
      </table>
      {showPagination && sorted.length > 10 && (
        <Pagination page={current} pageSize={size} total={sorted.length} onPage={setPage} onPageSize={setPageSize} />
      )}
    </div>
  );
}
