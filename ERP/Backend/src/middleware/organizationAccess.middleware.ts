import type { Response, NextFunction } from "express";
import type { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthRequest } from "./auth.middleware";

export interface OrganizationAccessRequest extends AuthRequest {
  organizationRole?: UserRole;
  organizationMembership?: { role: UserRole; isOwner: boolean };
}

function normalizeJwtRole(role: unknown): string {
  if (Array.isArray(role)) return String(role[0] ?? "");
  return String(role ?? "");
}

/**
 * Verify the authenticated user is a member of the organization referenced in route params.
 * SYSTEM_OWNER bypasses (tenant APIs are not their primary surface).
 *
 * @param organizationIdParam - route param name (default `organizationId`; use `id` for `/organizations/:id`)
 */
export function requireOrganizationAccess(organizationIdParam: string = "organizationId") {
  return async (req: OrganizationAccessRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const jwtRole = normalizeJwtRole(req.user.role);
      if (jwtRole === "SYSTEM_OWNER") {
        return next();
      }

      const raw = req.params[organizationIdParam];
      if (raw === undefined || raw === null || String(raw).trim() === "") {
        return next();
      }

      const organizationId = parseInt(String(raw), 10);
      if (Number.isNaN(organizationId)) {
        return res.status(400).json({ error: "Invalid organization id" });
      }

      const userId = parseInt(String(req.user.userId), 10);
      if (Number.isNaN(userId)) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const membership = await prisma.userOrganization.findFirst({
        where: { userId, organizationId },
        select: { role: true, isOwner: true },
      });

      if (!membership) {
        return res.status(403).json({ error: "Access denied to this organization" });
      }

      req.organizationRole = membership.role;
      req.organizationMembership = membership;
      next();
    } catch (err) {
      console.error("[requireOrganizationAccess]", err);
      return res.status(500).json({ error: "Failed to verify organization access" });
    }
  };
}
