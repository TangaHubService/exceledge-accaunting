import { createHash, timingSafeEqual } from "node:crypto";
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

/** Read-only capabilities an API key may carry. */
export const API_KEY_SCOPES = ["report:view", "gl:view", "ar:view", "ap:view"] as const satisfies readonly AccountingCapability[];
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export interface AuthedRequest extends Request {
  erpUser?: ErpTokenPayload;
  organizationRole?: string;
  companyId?: string;
  apiKey?: { id: string; scopes: string[] };
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest();
}

function presentedApiKey(req: Request) {
  const header = req.header("x-api-key");
  if (header) return header.trim();
  const auth = req.headers.authorization;
  return auth?.startsWith("ApiKey ") ? auth.slice("ApiKey ".length).trim() : undefined;
}

/** Accepts an ERP user token, or a company API key on read-only (GET) requests. */
export async function authenticate(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = presentedApiKey(req);
  if (!token) return authenticateErpJwt(req, res, next);
  if (req.method !== "GET") {
    return res.status(403).json({ success: false, error: "API keys are read-only" });
  }
  const candidates = await prisma.apiCredential.findMany({ where: { prefix: token.slice(0, 8) } });
  const presented = sha256(token);
  const match = candidates.find((c) => {
    const stored = Buffer.from(c.tokenHash, "hex");
    return stored.length === presented.length && timingSafeEqual(stored, presented);
  });
  if (!match || match.revokedAt || (match.expiresAt && match.expiresAt <= new Date())) {
    return res.status(401).json({ success: false, error: "Invalid, revoked or expired API key" });
  }
  const now = new Date();
  const usage = await prisma.apiKeyUsage.create({
    data: { credentialId: match.id, companyId: match.companyId, method: req.method, path: req.originalUrl.split("?")[0].slice(0, 300), ipAddress: req.ip },
  });
  const recent = await prisma.apiKeyUsage.count({ where: { credentialId: match.id, createdAt: { gt: new Date(now.getTime() - 60_000) } } });
  if (recent > match.rateLimitPerMinute) {
    await prisma.apiKeyUsage.update({ where: { id: usage.id }, data: { status: 429 } });
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ success: false, error: `Rate limit of ${match.rateLimitPerMinute} requests per minute exceeded` });
  }
  res.setHeader("X-RateLimit-Limit", String(match.rateLimitPerMinute));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, match.rateLimitPerMinute - recent)));
  res.on("finish", () => {
    prisma.apiKeyUsage.update({ where: { id: usage.id }, data: { status: res.statusCode } }).catch(() => undefined);
  });
  await prisma.apiCredential.update({ where: { id: match.id }, data: { lastUsedAt: now } });
  req.apiKey = { id: match.id, scopes: match.scopes };
  req.companyId = match.companyId;
  return next();
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
  const check = (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (req.apiKey) {
      if (!req.apiKey.scopes.includes(capability)) {
        return res.status(403).json({ success: false, error: `API key lacks scope: ${capability}` });
      }
      return next();
    }
    const role = req.organizationRole ?? req.erpUser?.role;
    if (!hasCapability(role, capability)) {
      return res.status(403).json({
        success: false,
        error: `Missing capability: ${capability}`,
      });
    }
    return next();
  };
  return Object.assign(check, { capability });
}

/** Resolve or create Accounting company for ERP activeOrganizationId */
export async function resolveCompany(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.apiKey) return next();
  const orgId = req.erpUser?.activeOrganizationId ?? normalizeOrgId(req.erpUser?.organizationId);
  if (!orgId) {
    return res.status(400).json({
      success: false,
      error: "activeOrganizationId required in ERP JWT",
    });
  }

  const externalId = String(orgId);
  // Use upsert: the overview page fires ~8 requests in parallel on first login,
  // and findUnique-then-create races (P2002 on externalErpOrganizationId).
  // Upsert narrows the race; the P2002 catch covers two simultaneous first-time inserts.
  let company;
  try {
    company = await prisma.company.upsert({
      where: { externalErpOrganizationId: externalId },
      update: {},
      create: {
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
  } catch (e: unknown) {
    if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002") {
      const existing = await prisma.company.findUnique({ where: { externalErpOrganizationId: externalId } });
      if (!existing) throw e;
      company = existing;
    } else {
      throw e;
    }
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
