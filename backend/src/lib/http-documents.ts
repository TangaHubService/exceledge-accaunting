import type { Response } from "express";
import { z } from "zod";

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use yyyy-mm-dd dates");

/** `?from=yyyy-mm-dd&to=yyyy-mm-dd` for period statements and reports. */
export const periodQuery = z.object({ from: isoDay.optional(), to: isoDay.optional() });

/** Invoice or bill line items as posted by the screens. */
export const documentLines = z
  .array(
    z.object({
      description: z.string().trim().min(1).max(500),
      quantity: z.number().positive(),
      unitPrice: z.number().min(0),
      discount: z.number().min(0).optional(),
      taxCode: z.string().trim().max(40).nullable().optional(),
      accountId: z.string().nullable().optional(),
    }),
  )
  .min(1)
  .max(200);

/** 404 when a document or party is missing (or belongs to another company), else 400. */
export function notFoundStatus(e: unknown) {
  return e instanceof Error && /does not exist/.test(e.message) ? 404 : 400;
}

export function sendPdf(res: Response, doc: { filename: string; pdf: Buffer }) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${doc.filename.replace(/"/g, "")}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(doc.pdf);
}
