import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { autonomousPrisma } from "../lib/prisma";
import { effectiveAccess } from "../modules/users/access.service";
import type { ErpTokenPayload } from "./auth";

const WAIT_MS = 20_000;
const POLL_MS = 150;
const KEEP_DAYS = 7;

/** Answers that show a secret once; keeping them would keep the secret. */
const SHOWS_SECRET = /^\/api\/v1\/(integration\/key|books\/api-keys|books\/webhooks)\/?(\?|$)/;

/** Organization and user of a valid token. Without one the request goes on to be refused by sign-in as usual. */
async function scopeOf(req: Request) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  try {
    const p = jwt.verify(header.slice("Bearer ".length), env.jwtSecret, { algorithms: ["HS256"] }) as ErpTokenPayload;
    const org = p.activeOrganizationId ?? (Array.isArray(p.organizationId) ? p.organizationId[0] : p.organizationId);
    if (!p.userId || !org) return null;
    const access = await effectiveAccess({ erpOrganizationId: org, erpUserId: p.userId, email: p.email, erpRole: p.role });
    const accessHash = createHash("sha256").update([...access.capabilities].sort().join(",")).digest("hex");
    return { scope: `${org}:${p.userId}`, accessHash };
  } catch {
    return null;
  }
}

/**
 * A POST sent with an `Idempotency-Key` runs once: sending it again (double click, retry after a lost answer)
 * returns the first answer. A refused request frees its key, so it can be corrected and sent again. If the server
 * died part-way the outcome is unknown, so the key stays taken rather than risk posting twice.
 */
export async function idempotency(req: Request, res: Response, next: NextFunction) {
  const key = req.header("idempotency-key")?.trim();
  if (req.method !== "POST" || !key || SHOWS_SECRET.test(req.originalUrl)) return next();
  if (!/^[\w.-]{8,100}$/.test(key)) return res.status(400).json({ success: false, error: "Idempotency-Key must be 8 to 100 letters, digits, dots, dashes or underscores" });
  const caller = await scopeOf(req);
  if (!caller) return next();
  const { scope, accessHash } = caller;
  const requestHash = createHash("sha256").update(`${req.originalUrl}\n${JSON.stringify(req.body ?? null)}`).digest("hex");
  try {
    await autonomousPrisma.idempotencyRecord.create({ data: { scope, key, requestHash, accessHash } });
  } catch (e) {
    if ((e as { code?: string }).code !== "P2002") throw e;
    return replay(res, scope, key, requestHash, accessHash);
  }

  let body: unknown;
  const json = res.json.bind(res);
  res.json = (value: unknown) => {
    body = value;
    const ok = res.statusCode >= 200 && res.statusCode < 300;
    const where = { scope_key: { scope, key } };
    // Saved before the answer goes out, so a retry that follows it at once finds it.
    const save = ok
      ? autonomousPrisma.idempotencyRecord.update({ where, data: { statusCode: res.statusCode, response: JSON.parse(JSON.stringify(body)) } })
      : autonomousPrisma.idempotencyRecord.delete({ where });
    save.catch((err) => console.error("[idempotency]", err)).finally(() => json(value));
    return res;
  };
  return next();
}

async function replay(res: Response, scope: string, key: string, requestHash: string, accessHash: string) {
  const until = Date.now() + WAIT_MS;
  for (;;) {
    const row = await autonomousPrisma.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
    if (!row) return res.status(409).json({ success: false, error: "The first attempt was refused; check the details and try again" });
    // The routes check access before doing anything; an answer saved under other access must not get round that.
    if (row.accessHash !== accessHash) return res.status(403).json({ success: false, error: "Your access changed since this was sent; check whether it was saved" });
    if (row.requestHash !== requestHash) return res.status(422).json({ success: false, error: "This Idempotency-Key was already used for a different request" });
    if (row.statusCode !== null) {
      res.setHeader("Idempotent-Replay", "true");
      return res.status(row.statusCode).json(row.response);
    }
    if (Date.now() > until) return res.status(409).json({ success: false, error: "The first attempt has not finished; check whether it was saved before trying again" });
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/** Keys are only useful around the time of the request. */
export async function purgeIdempotency(now = new Date()) {
  return (await autonomousPrisma.idempotencyRecord.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - KEEP_DAYS * 86_400_000) } } })).count;
}
