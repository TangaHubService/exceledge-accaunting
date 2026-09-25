import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useMemo, useState } from "react";

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
}) {
  const [sort, setSort] = useState<Sort | undefined>(initialSort);
  const [page, setPage] = useState(0);
  const [pagedRows, setPagedRows] = useState(rows);
  if (pagedRows !== rows) {
    setPagedRows(rows);
    setPage(0);
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

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = pages > 1 ? sorted.slice(current * pageSize, (current + 1) * pageSize) : sorted;

  function toggle(col: Column<T>) {
    setPage(0);
    setSort((s) =>
      s?.key === col.key
        ? { key: col.key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key: col.key, dir: col.numeric ? "desc" : "asc" },
    );
  }

  function onKey(e: KeyboardEvent<HTMLTableRowElement>, row: T) {
    if (e.key === "Enter" && e.target === e.currentTarget) onRowClick?.(row);
  }

  return (
    <div className="table-wrap">
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
          {visible.map((row) => (
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
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} style={{ padding: 0 }}>
                {empty}
              </td>
            </tr>
          )}
        </tbody>
        {footer && sorted.length > 0 && <tfoot>{footer}</tfoot>}
      </table>
      {pages > 1 && (
        <div className="pager">
          <span>
            {current * pageSize + 1}–{Math.min((current + 1) * pageSize, sorted.length)} of {sorted.length}
          </span>
          <button type="button" className="icon-button" onClick={() => setPage(current - 1)} disabled={current === 0} aria-label="Previous page">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" onClick={() => setPage(current + 1)} disabled={current >= pages - 1} aria-label="Next page">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
