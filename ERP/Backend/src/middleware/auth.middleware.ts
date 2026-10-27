import type { Request, Response, NextFunction } from "express"
import jwt from "jsonwebtoken"
import { prisma } from "../lib/prisma"

export interface JwtPayload {
  userId: string | number  // Can be string (from old tokens) or number (from new tokens)
  email: string
  role?: string
  name?: string
  organizationId?: string | number  // Can be string (from old tokens) or number (from new tokens)
  activeOrganizationId?: number
  organizationIds?: number[]
  activeBranchId?: number | null
  branchIds?: number[]
  isVerified?: boolean
}

export interface AuthRequest extends Request {
  user?: {
    userId: any;
    email: string;
    role: string;
    name: string;
    organizationId: any;
    activeOrganizationId?: number;
    organizationIds?: number[];
    activeBranchId?: number | null;
    branchIds?: number[];
    isVerified?: boolean;
    isActive?: boolean;
  };
}

export const authenticate = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET as string
    ) as any;
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    // Per-organization role from requireOrganizationAccess (authoritative for :organizationId routes)
    const orgRole = (req as { organizationRole?: string }).organizationRole;
    const effectiveRole = orgRole ?? req.user.role;
    const userRoles = Array.isArray(effectiveRole)
      ? effectiveRole
      : [effectiveRole];
    const hasRole = userRoles.some((role) => roles.includes(role));

    if (!hasRole) {
      return res
        .status(403)
        .json({ error: "Forbidden: You dont have permissions to perform this action" });
    }
    next();
  };
};

/**
 * Deny-list middleware — blocks the request if the user's role is in the
 * provided list. Use this for "everyone EXCEPT these roles" scenarios.
 *
 * Respects per-organization role from requireOrganizationAccess just like
 * authorize() does.
 *
 * @example
 * router.get("/subscriptions", authenticate, restrictRoles("SELLER"), ...);
 */
export const restrictRoles = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const orgRole = (req as { organizationRole?: string }).organizationRole;
    const effectiveRole = orgRole ?? req.user.role;

    if (roles.includes(effectiveRole)) {
      return res.status(403).json({
        error: "Forbidden: You do not have permission to access this resource",
      });
    }
    next();
  };
};

export const requireSystemOwner = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.user.role !== "SYSTEM_OWNER") {
    return res
      .status(403)
      .json({ error: "Forbidden: System owner access required" });
  }

  next();
};
