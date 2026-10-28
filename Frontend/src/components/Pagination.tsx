import { ChevronLeft, ChevronRight } from "lucide-react";
import { PAGE_SIZE_OPTIONS } from "../lib/pagination";

type Item = number | "gap";

function pageItems(page: number, pageCount: number): Item[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const wanted = new Set([1, 2, page - 1, page, page + 1, pageCount - 1, pageCount]);
  const nums = [...wanted].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
  const out: Item[] = [];
  let prev = 0;
  for (const n of nums) {
    if (n - prev > 1) out.push("gap");
    out.push(n);
    prev = n;
  }
  return out;
}

/**
 * The app's single pagination bar, for client- and server-paginated tables.
 * `page` is 1-based. Renders nothing when there is nothing to page through.
 *
 *   Showing 1–25 of 248     Rows per page: [25]     ‹ 1 2 3 … 10 ›
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  label = "Pagination",
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  /** When provided, a rows-per-page selector is shown. */
  onPageSize?: (size: number) => void;
  pageSizeOptions?: number[];
  label?: string;
}) {
  if (total <= 0) return null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);

  return (
    <div className="pagination">
      <span className="pagination-range" role="status">
        Showing {from}–{to} of {total}
      </span>
      {onPageSize && (
        <label className="pagination-size">
          <span aria-hidden="true">Rows per page:</span>
          <select
            aria-label="Rows per page"
            value={pageSizeOptions.includes(pageSize) ? pageSize : ""}
            onChange={(e) => onPageSize(Number(e.target.value))}
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
      {pageCount > 1 && (
        <nav className="page-nav" aria-label={label}>
          <button
            type="button"
            className="page-btn"
            onClick={() => onPage(current - 1)}
            disabled={current <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          {pageItems(current, pageCount).map((item, i) =>
            item === "gap" ? (
              <span key={`gap-${i}`} className="page-ellipsis" aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                className="page-btn"
                aria-label={`Go to page ${item}`}
                aria-current={item === current ? "page" : undefined}
                onClick={() => onPage(item)}
              >
                {item}
              </button>
            ),
          )}
          <button
            type="button"
            className="page-btn"
            onClick={() => onPage(current + 1)}
            disabled={current >= pageCount}
            aria-label="Next page"
          >
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </nav>
      )}
    </div>
  );
}
