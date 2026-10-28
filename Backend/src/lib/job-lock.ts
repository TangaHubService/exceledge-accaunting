import { randomUUID } from "node:crypto";
import { autonomousPrisma as db } from "./prisma";

async function acquire(key: string, holder: string, ttlMs: number) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const created = await db.jobLock.createMany({ data: [{ key, holder, expiresAt }], skipDuplicates: true });
  if (created.count) return true;
  const taken = await db.jobLock.updateMany({ where: { key, expiresAt: { lt: now } }, data: { holder, expiresAt } });
  return taken.count > 0;
}

/**
 * Runs `fn` only if this process can take the lease on `key`; returns `null` otherwise.
 * A lease left behind by a crashed process is taken over once it expires.
 *
 * Leases are written outside any open transaction so other instances see them immediately. Call
 * this outside the transaction that does the work: the lease is released when `fn` returns, which
 * must not be before that work commits.
 *
 * With `renew`, the lease is extended every third of `ttlMs` while `fn` runs, so long work keeps
 * it and only a crashed holder's lease expires.
 */
export async function withJobLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  opts: { renew?: boolean } = {},
): Promise<T | null> {
  const holder = randomUUID();
  if (!(await acquire(key, holder, ttlMs))) return null;
  const timer = opts.renew
    ? setInterval(() => {
        db.jobLock
          .updateMany({ where: { key, holder }, data: { expiresAt: new Date(Date.now() + ttlMs) } })
          .then((r) => {
            if (!r.count) console.warn(`[job-lock] lost lease ${key}`);
          })
          .catch((e) => console.error(`[job-lock] renewing ${key}`, e));
      }, Math.max(Math.floor(ttlMs / 3), 1)).unref()
    : null;
  try {
    return await fn();
  } finally {
    if (timer) clearInterval(timer);
    await db.jobLock.deleteMany({ where: { key, holder } });
  }
}

/** Claims `key` until it expires and never releases it early; true for the first caller only. */
export async function claimOnce(key: string, ttlMs: number): Promise<boolean> {
  return acquire(key, randomUUID(), ttlMs);
}