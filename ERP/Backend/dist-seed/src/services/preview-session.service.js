"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPreviewSession = createPreviewSession;
exports.getPreviewSession = getPreviewSession;
exports.deletePreviewSession = deletePreviewSession;
const crypto_1 = require("crypto");
// In-memory storage for preview sessions
// In production, consider using Redis for distributed systems
const previewSessions = new Map();
const MAX_SESSIONS = 50; // hard cap to prevent unbounded heap growth
// Clean up expired sessions every 15 minutes (was 1 hour — reduces peak heap)
setInterval(() => {
    const now = new Date();
    for (const [id, session] of previewSessions.entries()) {
        if (session.expiresAt < now) {
            previewSessions.delete(id);
        }
    }
}, 15 * 60 * 1000);
/**
 * Create a new preview session
 */
function createPreviewSession(organizationId, entityType, validRows, invalidRows) {
    const sessionId = (0, crypto_1.randomUUID)();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now
    const session = {
        id: sessionId,
        organizationId,
        entityType,
        validRows,
        invalidRows,
        summary: {
            total: validRows.length + invalidRows.length,
            valid: validRows.length,
            invalid: invalidRows.length,
        },
        createdAt: now,
        expiresAt,
    };
    // Evict oldest session when cap is reached
    if (previewSessions.size >= MAX_SESSIONS) {
        const oldest = [...previewSessions.entries()].sort((a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime())[0];
        previewSessions.delete(oldest[0]);
    }
    previewSessions.set(sessionId, session);
    return sessionId;
}
/**
 * Get a preview session by ID
 */
function getPreviewSession(sessionId) {
    const session = previewSessions.get(sessionId);
    if (!session) {
        return null;
    }
    // Check if expired
    if (session.expiresAt < new Date()) {
        previewSessions.delete(sessionId);
        return null;
    }
    return session;
}
/**
 * Delete a preview session
 */
function deletePreviewSession(sessionId) {
    return previewSessions.delete(sessionId);
}
