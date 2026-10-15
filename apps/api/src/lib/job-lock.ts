import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

async function acquire(key: string, holder: string, ttlMs: number) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  try {
    await prisma.jobLock.create({ data: { key, holder, expiresAt } });
    return true;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
  const taken = await prisma.jobLock.updateMany({ where: { key, expiresAt: { lt: now } }, data: { holder, expiresAt } });
  return taken.count > 0;
}

/**
 * Runs `fn` only if this process can take the lease on `key`; returns `null` otherwise.
 * A lease left behind by a crashed process is taken over once it expires.
 */
export async function withJobLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
  const holder = randomUUID();
  if (!(await acquire(key, holder, ttlMs))) return null;
  try {
    return await fn();
  } finally {
    await prisma.jobLock.deleteMany({ where: { key, holder } });
  }
}

/** Claims `key` until it expires and never releases it early; true for the first caller only. */
export async function claimOnce(key: string, ttlMs: number): Promise<boolean> {
  return acquire(key, randomUUID(), ttlMs);
}
