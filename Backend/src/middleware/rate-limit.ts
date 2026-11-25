import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const WINDOW_MS = 60_000;

/**
 * Requests per minute for each caller (token or key, else address), counted in this process. Several API instances
 * each count their own, so the real ceiling is the limit times the instances. 0 turns it off.
 */
export function rateLimit(perMinute: number) {
  const seen = new Map<string, { start: number; count: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    if (!perMinute) return next();
    const now = Date.now();
    if (seen.size > 10_000) for (const [k, v] of seen) if (now - v.start > WINDOW_MS) seen.delete(k);
    const take = (key: string) => {
      const bucket = seen.get(key);
      const current = bucket && now - bucket.start < WINDOW_MS ? bucket : { start: now, count: 0 };
      current.count += 1;
      seen.set(key, current);
      return current;
    };
    // An office shares one address, so the address gets a wider allowance; it stops made-up tokens each getting their own.
    const address = take(`ip:${req.ip}`);
    const credential = req.headers.authorization ?? req.header("x-integration-key") ?? req.header("x-api-key");
    const current = credential ? take(`${req.ip}:${createHash("sha256").update(credential).digest("base64")}`) : address;
    const over = current.count > perMinute ? current : address.count > perMinute * 20 ? address : null;
    if (over) {
      res.setHeader("Retry-After", String(Math.ceil((over.start + WINDOW_MS - now) / 1000)));
      return res.status(429).json({ success: false, error: "Too many requests; try again in a minute" });
    }
    return next();
  };
}
