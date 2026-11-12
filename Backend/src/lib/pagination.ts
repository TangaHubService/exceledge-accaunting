import { z } from "zod";

/**
 * Shared pagination for list endpoints.
 *
 *   const p = parsePage(req.query, { defaultSize: 50, maxSize: 200 });
 *   const [rows, total] = await Promise.all([prisma.x.findMany({ where, ...pageArgs(p) }), prisma.x.count({ where })]);
 *   res.json({ success: true, data: pageResult(rows, total, p) });
 *
 * Pages are 1-based. Out-of-range or missing values fall back to sensible defaults instead of failing the request.
 */
export type PageRequest = { page: number; pageSize: number };
export type Page<T> = { rows: T[]; total: number; page: number; pageSize: number; pageCount: number };

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

const positiveInt = z.coerce.number().int().positive();

/** Clamp a page request into range: page >= 1, 1 <= pageSize <= maxSize. */
export function normalizePage(
  input: { page?: unknown; pageSize?: unknown },
  opts: { defaultSize?: number; maxSize?: number } = {},
): PageRequest {
  const maxSize = opts.maxSize ?? MAX_PAGE_SIZE;
  const defaultSize = Math.min(opts.defaultSize ?? DEFAULT_PAGE_SIZE, maxSize);
  const page = positiveInt.safeParse(input.page);
  const size = positiveInt.safeParse(input.pageSize);
  return {
    page: page.success ? page.data : 1,
    pageSize: size.success ? Math.min(size.data, maxSize) : defaultSize,
  };
}

/** Read `page` and `pageSize` from an Express query object. */
export function parsePage(query: Record<string, unknown>, opts?: { defaultSize?: number; maxSize?: number }): PageRequest {
  const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  return normalizePage({ page: first(query.page), pageSize: first(query.pageSize) }, opts);
}

/** True when the caller asked for a page (so endpoints can keep returning full lists to older callers). */
export function wantsPage(query: Record<string, unknown>) {
  return query.page !== undefined || query.pageSize !== undefined;
}

/** Prisma `skip` / `take` for a page. */
export function pageArgs(p: PageRequest) {
  return { skip: (p.page - 1) * p.pageSize, take: p.pageSize };
}

/** The standard paged reply. */
export function pageResult<T>(rows: T[], total: number, p: PageRequest): Page<T> {
  return { rows, total, page: p.page, pageSize: p.pageSize, pageCount: Math.max(1, Math.ceil(total / p.pageSize)) };
}

/** Page an in-memory list (already filtered and sorted). A page past the end returns the last page. */
export function paginateArray<T>(items: T[], p: PageRequest): Page<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / p.pageSize));
  const page = Math.min(p.page, pageCount);
  const start = (page - 1) * p.pageSize;
  return { rows: items.slice(start, start + p.pageSize), total: items.length, page, pageSize: p.pageSize, pageCount };
}
