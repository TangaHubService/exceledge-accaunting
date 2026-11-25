import type { NextFunction, Request, Response } from "express";

const INTERNAL = /Invalid `prisma|PrismaClient|\bat .*\(\/|node_modules|ECONNREFUSED|violates (foreign key|unique|check) constraint/i;

/** Text for the person who sent the request; database and program detail goes to the log instead. */
export function publicError(error: string, requestId?: string) {
  const text = error.trim();
  if (text.startsWith("[") && text.includes('"code"')) {
    try {
      const issues = JSON.parse(text) as Array<{ path?: Array<string | number>; message?: string }>;
      return issues.map((i) => `${i.path?.join(".") || "request"}: ${i.message ?? "invalid"}`).join("; ");
    } catch {
      /* not validation issues */
    }
  }
  if (!INTERNAL.test(text)) return error;
  console.error(`[${requestId ?? "-"}]`, text);
  if (/Unique constraint|P2002/i.test(text)) return "That number or code is already in use";
  if (/Invalid (value|Date)|Provided Date object is invalid|out of range|overflow/i.test(text)) return "A date or amount isn't valid";
  return "The request couldn't be completed. Quote the request id if you report it.";
}

/** Every route's errors leave through here, so none can show file paths or database text. */
export function safeErrors(req: Request, res: Response, next: NextFunction) {
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    const error = (body as { error?: unknown } | null)?.error;
    if (res.statusCode >= 400 && typeof error === "string") return json({ ...(body as object), error: publicError(error, (req as Request & { requestId?: string }).requestId) });
    return json(body);
  };
  next();
}
