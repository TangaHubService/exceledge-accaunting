import { useEffect, useMemo, useRef, useState } from "react";
import { useResource } from "./session";

/** Rows-per-page choices offered everywhere in the app. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const LS_PREFIX = "accounting:page-size:";

function readPageSize(key: string | undefined, fallback: number, options: number[]) {
  const safeFallback = options.includes(fallback) ? fallback : options[0];
  if (!key) return safeFallback;
  try {
    const saved = Number(localStorage.getItem(LS_PREFIX + key));
    if (options.includes(saved)) return saved;
  } catch {
    /* storage unavailable — use the default */
  }
  return safeFallback;
}

/**
 * Client pagination state with a persisted rows-per-page preference.
 *
 * - `key` scopes the persisted page size (e.g. `"customers"`).
 * - `resetKey` resets to page 1 whenever the dataset changes identity
 *   (new search text, different filter tab). Pass a stable string built
 *   from the active filters; changing page/pageSize never triggers it.
 */
export function usePagination({
  key,
  defaultPageSize = 50,
  resetKey,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
}: {
  key?: string;
  defaultPageSize?: number;
  resetKey?: string;
  /** Allowed rows-per-page values (a saved size outside them is ignored). */
  pageSizeOptions?: number[];
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(() => readPageSize(key, defaultPageSize, pageSizeOptions));
  const lastReset = useRef(resetKey);

  useEffect(() => {
    if (lastReset.current !== resetKey) {
      lastReset.current = resetKey;
      setPage(1);
    }
  }, [resetKey]);

  const setPageSize = (next: number) => {
    if (key) {
      try {
        localStorage.setItem(LS_PREFIX + key, String(next));
      } catch {
        /* ignore */
      }
    }
    setPageSizeState(next);
    setPage(1);
  };

  return { page, pageSize, setPage, setPageSize };
}

/** Clamp a 1-based page into range. */
export function clampPage(page: number, pageCount: number) {
  return Math.min(Math.max(1, page), Math.max(1, pageCount));
}

/** The standard paged reply from the API (see Backend/src/lib/pagination.ts). */
export type Paged<T> = { rows: T[]; total: number; page: number; pageSize: number; pageCount: number };

type QueryValue = string | number | boolean | null | undefined;

/** Build "?a=1&b=x", skipping empty values. */
export function toQuery(params: Record<string, QueryValue>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * Server-side pagination: loads `path?page=&pageSize=&...params` and keeps the page state.
 * Changing any filter in `params` returns to page 1. While the next page loads, the previous rows stay on screen.
 *
 *   const list = usePagedResource<Account>("/api/v1/coa/rows", { q: search }, { key: "coa" });
 *   <Pagination page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage} onPageSize={list.setPageSize} />
 */
export function usePagedResource<T>(
  path: string | null,
  params: Record<string, QueryValue> = {},
  opts: { key?: string; defaultPageSize?: number; pageSizeOptions?: number[] } = {},
) {
  const resetKey = JSON.stringify(params);
  const { page, pageSize, setPage, setPageSize } = usePagination({
    key: opts.key,
    defaultPageSize: opts.defaultPageSize,
    pageSizeOptions: opts.pageSizeOptions,
    resetKey,
  });
  // A filter change means page 1 right away, without first fetching the old page number with the new filter.
  const seenKey = useRef(resetKey);
  const effectivePage = seenKey.current === resetKey ? page : 1;
  useEffect(() => {
    seenKey.current = resetKey;
  }, [resetKey]);
  const url = useMemo(
    () => (path ? `${path}${toQuery({ ...params, page: effectivePage, pageSize })}` : null),
    [path, resetKey, effectivePage, pageSize], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const res = useResource<Paged<T>>(url);
  const last = useRef<Paged<T> | undefined>(undefined);
  if (res.data) last.current = res.data;
  const data = res.data ?? last.current;

  // The server answers a page past the end with the last page; follow it.
  useEffect(() => {
    if (res.data && res.data.page !== effectivePage) setPage(res.data.page);
  }, [res.data, effectivePage, setPage]);

  return {
    data,
    rows: data?.rows ?? [],
    total: data?.total ?? 0,
    page: effectivePage,
    pageSize,
    pageSizeOptions: opts.pageSizeOptions ?? PAGE_SIZE_OPTIONS,
    setPage,
    setPageSize,
    /** True only for the very first load (no rows to show yet). */
    loading: res.loading && !data,
    refreshing: res.loading && Boolean(data),
    error: res.error,
    reload: res.reload,
  };
}
