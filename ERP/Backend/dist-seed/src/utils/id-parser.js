"use strict";
/**
 * Utility functions for parsing IDs from request parameters and query strings
 * Handles conversion from string to integer for migrated ID fields
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseId = parseId;
exports.parseIdRequired = parseIdRequired;
exports.parseIdOrAll = parseIdOrAll;
function parseId(id) {
    if (!id)
        return null;
    const parsed = parseInt(id, 10);
    return isNaN(parsed) ? null : parsed;
}
function parseIdRequired(id, fieldName = 'id') {
    if (!id) {
        throw new Error(`${fieldName} is required`);
    }
    const parsed = parseInt(id, 10);
    if (isNaN(parsed)) {
        throw new Error(`Invalid ${fieldName}: ${id}`);
    }
    return parsed;
}
function parseIdOrAll(id) {
    if (!id || id === 'all')
        return 'all';
    const parsed = parseInt(id, 10);
    return isNaN(parsed) ? 'all' : parsed;
}
