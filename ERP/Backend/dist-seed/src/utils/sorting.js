"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrderBy = getOrderBy;
/**
 * Builds a Prisma orderBy value from public query parameters using an explicit
 * allowlist. Unknown fields fall back to the endpoint default instead of being
 * passed to Prisma.
 */
function getOrderBy(query, allowed, defaultField, defaultDirection = 'desc') {
    const requestedField = typeof query.sortBy === 'string' ? query.sortBy : defaultField;
    const field = Object.prototype.hasOwnProperty.call(allowed, requestedField)
        ? requestedField
        : defaultField;
    const direction = query.sortOrder === 'asc'
        ? 'asc'
        : query.sortOrder === 'desc'
            ? 'desc'
            : defaultDirection;
    const template = allowed[field];
    return replaceDirection(template, direction);
}
function replaceDirection(value, direction) {
    if (value === '$direction')
        return direction;
    if (Array.isArray(value))
        return value.map(item => replaceDirection(item, direction));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceDirection(child, direction)]));
    }
    return value;
}
