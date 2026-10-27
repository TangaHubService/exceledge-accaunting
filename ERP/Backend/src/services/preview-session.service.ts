import { randomUUID } from "crypto"

export interface PreviewSession {
  id: string
  organizationId: number
  entityType: "customer" | "supplier"
  validRows: any[]
  invalidRows: any[]
  summary: {
    total: number
    valid: number
    invalid: number
  }
  createdAt: Date
  expiresAt: Date
}

// In-memory storage for preview sessions
// In production, consider using Redis for distributed systems
const previewSessions = new Map<string, PreviewSession>()

const MAX_SESSIONS = 50 // hard cap to prevent unbounded heap growth

// Clean up expired sessions every 15 minutes (was 1 hour — reduces peak heap)
setInterval(() => {
  const now = new Date()
  for (const [id, session] of previewSessions.entries()) {
    if (session.expiresAt < now) {
      previewSessions.delete(id)
    }
  }
}, 15 * 60 * 1000)

/**
 * Create a new preview session
 */
export function createPreviewSession(
  organizationId: number,
  entityType: "customer" | "supplier",
  validRows: any[],
  invalidRows: any[]
): string {
  const sessionId = randomUUID()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000) // 1 hour from now

  const session: PreviewSession = {
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
  }

  // Evict oldest session when cap is reached
  if (previewSessions.size >= MAX_SESSIONS) {
    const oldest = [...previewSessions.entries()].sort(
      (a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime()
    )[0]
    previewSessions.delete(oldest[0])
  }

  previewSessions.set(sessionId, session)
  return sessionId
}

/**
 * Get a preview session by ID
 */
export function getPreviewSession(sessionId: string): PreviewSession | null {
  const session = previewSessions.get(sessionId)
  
  if (!session) {
    return null
  }

  // Check if expired
  if (session.expiresAt < new Date()) {
    previewSessions.delete(sessionId)
    return null
  }

  return session
}

/**
 * Delete a preview session
 */
export function deletePreviewSession(sessionId: string): boolean {
  return previewSessions.delete(sessionId)
}
