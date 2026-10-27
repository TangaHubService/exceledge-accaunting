import type { ParsedQs } from 'qs'

export type SortDirection = 'asc' | 'desc'
export type SortMap = Record<string, Record<string, unknown>>

/**
 * Builds a Prisma orderBy value from public query parameters using an explicit
 * allowlist. Unknown fields fall back to the endpoint default instead of being
 * passed to Prisma.
 */
export function getOrderBy(
  query: ParsedQs,
  allowed: SortMap,
  defaultField: string,
  defaultDirection: SortDirection = 'desc',
): Record<string, unknown> {
  const requestedField = typeof query.sortBy === 'string' ? query.sortBy : defaultField
  const field = Object.prototype.hasOwnProperty.call(allowed, requestedField)
    ? requestedField
    : defaultField
  const direction: SortDirection = query.sortOrder === 'asc'
    ? 'asc'
    : query.sortOrder === 'desc'
      ? 'desc'
      : defaultDirection

  const template = allowed[field]
  return replaceDirection(template, direction) as Record<string, unknown>
}

function replaceDirection(value: unknown, direction: SortDirection): unknown {
  if (value === '$direction') return direction
  if (Array.isArray(value)) return value.map(item => replaceDirection(item, direction))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, replaceDirection(child, direction)]),
    )
  }
  return value
}
