import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { env } from "../../config/env";
import { autonomousPrisma as prisma } from "../../lib/prisma";

const run = promisify(execFile);
const NAME = /^exceledge-\d{8}T\d{6}Z\.dump$/;

/** Connection details go through the environment, so the password never shows in the process list. */
export function pgEnv(databaseUrl: string) {
  const u = new URL(databaseUrl);
  const ssl = u.searchParams.get("sslmode");
  return {
    PATH: process.env.PATH ?? "",
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
    ...(ssl ? { PGSSLMODE: ssl } : {}),
  };
}

async function sha256(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** What must match after a restore: every company's books, and that they balance. */
async function fingerprint(db: Pick<PrismaClient, "$queryRaw">) {
  const [row] = await db.$queryRaw<Array<Record<string, string>>>`
    SELECT (SELECT count(*) FROM companies)::text AS companies, (SELECT count(*) FROM journals)::text AS journals,
      (SELECT count(*) FROM gl_entries)::text AS entries, (SELECT count(*) FROM ar_invoices)::text AS invoices,
      (SELECT count(*) FROM ap_bills)::text AS bills, (SELECT count(*) FROM audit_events)::text AS audit,
      (SELECT coalesce(sum(debit),0)::numeric(30,2) FROM gl_entries)::text AS debit, (SELECT coalesce(sum(credit),0)::numeric(30,2) FROM gl_entries)::text AS credit`;
  return row;
}

/** Dumps the database, then restores the dump into a scratch database to prove it can be. */
export async function runBackup(dir = env.backupDir, options: { verify?: boolean; keep?: number } = {}) {
  if (!dir) throw new Error("Set BACKUP_DIR to the folder backups are written to");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const fileName = `exceledge-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}.dump`;
  const file = path.join(dir, fileName);
  const record = await prisma.backupRun.create({ data: { status: "RUNNING", fileName } });
  const pg = pgEnv(url);
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const before = await fingerprint(prisma);
    await run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", file], { env: pg });
    await chmod(file, 0o600);
    const { size } = await stat(file);
    const done = { fileName, sizeBytes: BigInt(size), sha256: await sha256(file) };
    await prisma.backupRun.update({ where: { id: record.id }, data: { ...done, status: "DONE", finishedAt: new Date() } });
    let verified = false;
    if (options.verify !== false) {
      const wrong = await verifyBackup(file, url, before);
      if (wrong) throw new Error(wrong);
      verified = true;
      await prisma.backupRun.update({ where: { id: record.id }, data: { status: "VERIFIED", verifiedAt: new Date() } });
    }
    // Old backups only go once a new one is known to be good.
    await prune(dir, options.keep ?? env.backupKeep);
    return { id: record.id, file, verified, ...done };
  } catch (e) {
    const raw = (e as { stderr?: string }).stderr?.trim().split("\n").pop() || (e as Error).message;
    const message = (pg.PGPASSWORD ? raw.split(pg.PGPASSWORD).join("***") : raw).slice(0, 300);
    await prisma.backupRun.update({ where: { id: record.id }, data: { status: "FAILED", detail: message, finishedAt: new Date() } });
    console.error(`[backup] ${message}`);
    throw new Error(message);
  }
}

/** Restores into a throwaway database and compares. Returns what is wrong, or null. */
async function verifyBackup(file: string, url: string, before: Record<string, string>) {
  const pg = pgEnv(url);
  const admin = { env: { ...pg, PGDATABASE: "postgres" } };
  const name = `restore_check_${Date.now()}`;
  await run("createdb", [name], admin);
  const copyUrl = new URL(url);
  copyUrl.pathname = `/${name}`;
  const copy = new PrismaClient({ datasources: { db: { url: copyUrl.toString() } } });
  try {
    await run("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", name, file], { env: pg });
    const restored = await fingerprint(copy);
    if (restored.debit !== restored.credit) return `The restored books don't balance: ${restored.debit} against ${restored.credit}`;
    // Work goes on during a backup, so the copy may hold more than the first count, never less.
    const short = Object.keys(before).filter((k) => Number(restored[k]) < Number(before[k]));
    return short.length ? `The restored copy is missing ${short.join(", ")}` : null;
  } finally {
    await copy.$disconnect();
    await run("dropdb", ["--if-exists", name], admin);
  }
}

async function prune(dir: string, keep: number) {
  const files = (await readdir(dir)).filter((f) => NAME.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - Math.max(1, keep)))) await unlink(path.join(dir, f));
}

export async function backupStatus() {
  const runs = await prisma.backupRun.findMany({ orderBy: { startedAt: "desc" }, take: 30 });
  return {
    scheduled: Boolean(env.backupDir),
    keep: env.backupKeep,
    runs: runs.map(({ detail: _server, ...r }) => ({ ...r, sizeBytes: r.sizeBytes == null ? null : Number(r.sizeBytes) })),
  };
}
