/**
 * Utility functions for parsing IDs from request parameters and query strings
 * Handles conversion from string to integer for migrated ID fields
 */

export function parseId(id: string | undefined): number | null {
  if (!id) return null;
  const parsed = parseInt(id, 10);
  return isNaN(parsed) ? null : parsed;
}

export function parseIdRequired(id: string | undefined, fieldName: string = 'id'): number {
  if (!id) {
    throw new Error(`${fieldName} is required`);
  }
  const parsed = parseInt(id, 10);
  if (isNaN(parsed)) {
    throw new Error(`Invalid ${fieldName}: ${id}`);
  }
  return parsed;
}

export function parseIdOrAll(id: string | undefined): number | 'all' {
  if (!id || id === 'all') return 'all';
  const parsed = parseInt(id, 10);
  return isNaN(parsed) ? 'all' : parsed;
}
