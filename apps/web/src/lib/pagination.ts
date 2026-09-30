import { useEffect, useRef, useState } from "react";

/** Rows-per-page choices offered everywhere in the app. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const LS_PREFIX = "accounting:page-size:";

function readPageSize(key: string | undefined, fallback: number) {
  if (!key) return fallback;
  try {
    const saved = Number(localStorage.getItem(LS_PREFIX + key));
    if (PAGE_SIZE_OPTIONS.includes(saved)) return saved;
  } catch {
    /* storage unavailable — use the default */
  }
  return PAGE_SIZE_OPTIONS.includes(fallback) ? fallback : 50;
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
}: {
  key?: string;
  defaultPageSize?: number;
  resetKey?: string;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(() => readPageSize(key, defaultPageSize));
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
