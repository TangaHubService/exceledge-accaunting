import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma, PrismaClient } from "@prisma/client";

const client = new PrismaClient();
const scope = new AsyncLocalStorage<Prisma.TransactionClient>();

async function runSequentially(operations: Array<PromiseLike<unknown>>) {
  const results: unknown[] = [];
  for (const operation of operations) results.push(await operation);
  return results;
}

/**
 * Inside `inTransaction`, every query made through `prisma` runs on that transaction,
 * including nested `prisma.$transaction(...)` calls, so a document, its journal and its
 * subledger rows commit or roll back together.
 */
export const prisma = new Proxy(client, {
  get(target, prop, receiver) {
    const tx = scope.getStore();
    if (!tx) return Reflect.get(target, prop, receiver);
    if (prop === "$transaction") {
      return (arg: unknown) =>
        typeof arg === "function"
          ? (arg as (t: Prisma.TransactionClient) => Promise<unknown>)(tx)
          : runSequentially(arg as Array<PromiseLike<unknown>>);
    }
    return Reflect.get(tx, prop);
  },
}) as PrismaClient;

export function inTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (scope.getStore()) return fn();
  return client.$transaction((tx) => scope.run(tx, fn), { maxWait: 10_000, timeout: 60_000 });
}
