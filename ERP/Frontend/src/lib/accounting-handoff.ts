const ACCOUNTING_ORIGIN = (
  import.meta.env.VITE_ACCOUNTING_URL || "http://localhost:5174"
).replace(/\/$/, "");

/** Only the accounting app may receive the ERP access token. */
export function safeAccountingHandoffPath(next: string | null): string | null {
  if (!next || !next.startsWith("/accounting-handoff?")) return null;
  const query = next.slice("/accounting-handoff?".length);
  const ret = new URLSearchParams(query).get("return");
  if (!ret) return null;
  try {
    if (new URL(ret).origin !== new URL(ACCOUNTING_ORIGIN).origin) return null;
    return `/accounting-handoff?return=${encodeURIComponent(ret)}`;
  } catch {
    return null;
  }
}
