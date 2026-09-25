import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import {
  type AccountingCapability,
  hasCapability,
} from "@exceledge/accounting-domain";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";

export interface ErpTokenPayload {
  userId: number;
  email: string;
  role?: string;
  activeOrganizationId?: number;
  organizationIds?: number[];
  organizationId?: number | number[];
  activeBranchId?: number | null;
  branchIds?: number[];
}

export interface AuthedRequest extends Request {
  erpUser?: ErpTokenPayload;
  organizationRole?: string;
  companyId?: string;
}

export function authenticateErpJwt(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, error: "Missing Bearer token" });
  }
  try {
    const token = header.slice("Bearer ".length);
    const payload = jwt.verify(token, env.jwtSecret) as ErpTokenPayload;
    if (!payload.userId) {
      return res.status(401).json({ success: false, error: "Invalid token payload" });
    }
    req.erpUser = payload;
    req.organizationRole = payload.role;
    return next();
  } catch {
    return res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
}

export function requireCapability(capability: AccountingCapability) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const role = req.organizationRole ?? req.erpUser?.role;
    if (!hasCapability(role, capability)) {
      return res.status(403).json({
        success: false,
        error: `Missing capability: ${capability}`,
      });
    }
    return next();
  };
}

/** Resolve or create Accounting company for ERP activeOrganizationId */
export async function resolveCompany(req: AuthedRequest, res: Response, next: NextFunction) {
  const orgId = req.erpUser?.activeOrganizationId ?? normalizeOrgId(req.erpUser?.organizationId);
  if (!orgId) {
    return res.status(400).json({
      success: false,
      error: "activeOrganizationId required in ERP JWT",
    });
  }

  const externalId = String(orgId);
  let company = await prisma.company.findUnique({
    where: { externalErpOrganizationId: externalId },
  });

  if (!company) {
    company = await prisma.company.create({
      data: {
        externalErpOrganizationId: externalId,
        name: `ERP Org ${externalId}`,
        activation: { create: {} },
        sectionStatuses: {
          create: [
            "COMPANY_PROFILE",
            "BUSINESS_ACCOUNTING_INFO",
            "FINANCIAL_YEAR_PERIODS",
            "CURRENCY",
            "ACCOUNTING_POLICIES",
            "LOCALIZATION",
            "DEFAULT_POSTING_ACCOUNTS",
            "INVENTORY_SETTINGS",
            "PARTY_DEFAULTS",
            "BANKING_PAYMENT",
            "TRANSACTION_NUMBERING",
            "APPROVAL_POSTING_CONTROLS",
            "OPENING_BALANCES",
            "REVIEW_ACTIVATION",
          ].map((sectionKey) => ({ sectionKey: sectionKey as never })),
        },
      },
    });
  }

  req.companyId = company.id;
  return next();
}

function normalizeOrgId(value: number | number[] | undefined): number | undefined {
  if (typeof value === "number") return value;
  if (Array.isArray(value) && value.length) return value[0];
  return undefined;
}

export function getRequestMeta(req: Request) {
  return {
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? undefined,
  };
}
