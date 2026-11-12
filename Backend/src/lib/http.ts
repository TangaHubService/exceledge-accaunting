import { Prisma } from "@prisma/client";
import type { RequestHandler, Response } from "express";
import { z } from "zod";
import { type AuthedRequest, getRequestMeta } from "../middleware/auth";

/** A failure with a specific status; plain `Error`s from services are business-rule refusals (400). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} does not exist`);

export function sendError(res: Response, e: unknown) {
  if (e instanceof HttpError) return res.status(e.status).json({ success: false, error: e.message });
  if (e instanceof z.ZodError) {
    return res.status(400).json({ success: false, error: e.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("; ") });
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return res.status(409).json({ success: false, error: "That number or code is already in use" });
  }
  // Database and programming faults are ours: log them and don't leak their text.
  if (e instanceof Prisma.PrismaClientKnownRequestError || e instanceof Prisma.PrismaClientUnknownRequestError || e instanceof Prisma.PrismaClientValidationError || e instanceof TypeError) {
    console.error(e);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
  return res.status(400).json({ success: false, error: (e as Error).message });
}

export function handle<T>(fn: (req: AuthedRequest) => Promise<T>, status = 200): RequestHandler {
  return async (req, res) => {
    try {
      res.status(status).json({ success: true, data: await fn(req as AuthedRequest) });
    } catch (e) {
      sendError(res, e);
    }
  };
}

export type Actor = { erpUserId?: number; erpRole?: string; meta?: { ipAddress?: string; userAgent?: string } };

export function actorOf(req: AuthedRequest): Actor {
  return { erpUserId: req.erpUser!.userId, erpRole: req.organizationRole ?? req.erpUser?.role, meta: getRequestMeta(req) };
}

export const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "Use a yyyy-mm-dd date");
export const optionalDay = z.union([isoDay, z.literal("")]).nullish().transform((v) => v || null);
export const optionalText = (max = 500) => z.string().trim().max(max).nullish().transform((v) => v || null);
/** Ids the browser generates so saves can be retried safely. */
export const clientId = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/, "Invalid id");
export const toDate = (day: string | null | undefined) => (day ? new Date(day.length === 10 ? `${day}T12:00:00Z` : day) : null);
