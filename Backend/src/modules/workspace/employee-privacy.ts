import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../../config/env";

/** Kept encrypted in the database when FIELD_ENCRYPTION_KEY is set. */
const SEALED = ["nationalId", "bankName", "accountHolder", "accountNumber", "tin", "rssb"] as const;
const PREFIX = "enc:v1:";

function key() {
  if (!env.fieldEncryptionKey) return null;
  const k = Buffer.from(env.fieldEncryptionKey, "base64");
  if (k.length !== 32) throw new Error("FIELD_ENCRYPTION_KEY must be 32 bytes in base64");
  return k;
}

export function seal(text: string): string {
  const k = key();
  if (!k || text.startsWith(PREFIX)) return text;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function unseal(text: string): string {
  if (!text.startsWith(PREFIX)) return text;
  const k = key();
  if (!k) throw new Error("Pay details are encrypted and FIELD_ENCRYPTION_KEY is not set on the server");
  const raw = Buffer.from(text.slice(PREFIX.length), "base64");
  const d = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

export function sealEmployee<T extends Record<string, unknown>>(data: T): T & { basicSalaryEnc?: string | null } {
  const out: Record<string, unknown> = { ...data };
  for (const k of SEALED) if (typeof out[k] === "string" && out[k]) out[k] = seal(out[k] as string);
  if ("basicSalary" in out && env.fieldEncryptionKey) {
    out.basicSalaryEnc = out.basicSalary == null ? null : seal(String(out.basicSalary));
    out.basicSalary = null;
  } else if ("basicSalary" in out) out.basicSalaryEnc = null;
  return out as T & { basicSalaryEnc?: string | null };
}

export function openEmployee<T extends { basicSalary: unknown; basicSalaryEnc?: string | null }>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of SEALED) if (typeof out[k] === "string") out[k] = unseal(out[k] as string);
  if (row.basicSalaryEnc) out.basicSalary = unseal(row.basicSalaryEnc);
  return out as T;
}
