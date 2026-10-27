/** Shared currency/date formatting helpers for the printable invoice. */

export function formatAmount(value: number | string | null | undefined): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return "0.00"
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatInteger(value: number | string | null | undefined): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return "0"
  return Math.round(n).toLocaleString("en-US")
}

export function formatQuantity(value: number | string | null | undefined): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return "0"
  const abs = Math.abs(n)
  return n.toLocaleString("en-US", { maximumFractionDigits: abs % 1 === 0 ? 0 : 2 })
}

/** Receipt clock: Kigali wall time, matching the backend PDF and VSDC — never the viewer's zone. */
function kigaliParts(d: Date): Record<"year" | "month" | "day" | "hour" | "minute" | "second", string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Kigali",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00"
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") === "24" ? "00" : get("hour"), minute: get("minute"), second: get("second") }
}

export function formatDateShort(iso?: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const k = kigaliParts(d)
  return `${k.day}/${k.month}/${k.year}`
}

export function formatTime(value?: string | null): string {
  if (!value) return "—"
  // Already a wall-clock time from the backend ("16:04:09").
  if (/^\d{2}:\d{2}:\d{2}$/.test(value.trim())) return value.trim()
  const d = new Date(value)
  if (!Number.isNaN(d.getTime())) {
    const k = kigaliParts(d)
    return `${k.hour}:${k.minute}:${k.second}`
  }
  return value.trim() || "—"
}

/** Breaks a long hex/signature string into dash-separated 4-char groups. */
export function dashEvery4(value?: string | null): string {
  const text = (value ?? "").replace(/\s+/g, "").trim()
  if (!text) return "—"
  return text.replace(/.{4}/g, (m) => `${m} `).trim()
}

export function safeText(value?: string | null): string {
  const text = (value ?? "").toString().trim()
  return text || "—"
}