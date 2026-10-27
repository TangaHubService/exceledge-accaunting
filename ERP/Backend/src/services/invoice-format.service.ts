/**
 * RRA CIS/VSDC Art. 7.5: amounts print with 2 decimals and a dot separator.
 * Thousands grouping is deliberately OFF (useGrouping: false) — "1180.00",
 * never "1,180.00" — so the printed receipt matches the fiscal record byte
 * for byte regardless of server locale.
 */
export function formatInvoiceAmount(value: number | string | null | undefined): string {
  const amount = Number(value ?? 0)
  if (!Number.isFinite(amount)) return "0.00"
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  })
}

/**
 * Item quantity on a fiscal receipt (CIS §24.4.1, §16 samples "x 1.00",
 * "x 0.200"): at least 2 decimals, up to 3, dot separator, no grouping.
 */
export function formatReceiptQuantity(value: number | string | null | undefined): string {
  const quantity = Number(value ?? 0)
  if (!Number.isFinite(quantity)) return "0.00"
  return quantity.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
    useGrouping: false,
  })
}

/** Item tax label as printed on CIS receipts: exempt band A is "A-EX" (§16 samples). */
export function formatItemTaxLabel(taxCode: string | null | undefined): string {
  const code = String(taxCode ?? "").trim().toUpperCase()
  return code === "A" ? "A-EX" : code
}

export function formatInvoiceQuantity(value: number | string | null | undefined): string {
  const quantity = Number(value ?? 0)
  if (!Number.isFinite(quantity)) return "0"
  return quantity.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(quantity) ? 0 : 2,
    maximumFractionDigits: 3,
  })
}

/** IANA zone for every timestamp printed on a fiscal document or sent to VSDC. */
export const RRA_TIME_ZONE = "Africa/Kigali"

/**
 * Wall-clock parts of `date` in Africa/Kigali, independent of the server's
 * own timezone. Receipt dates, QR timestamps and VSDC date fields must all
 * agree with each other (and with the taxpayer's wall clock), so they all go
 * through here instead of the Date get*() accessors.
 */
export function kigaliWallParts(date: Date): {
  year: string
  month: string
  day: string
  hour: string
  minute: string
  second: string
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: RRA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00"
  // en-GB hour12:false can yield "24" for midnight — normalize to "00".
  const hour = get("hour") === "24" ? "00" : get("hour")
  return { year: get("year"), month: get("month"), day: get("day"), hour, minute: get("minute"), second: get("second") }
}

export function formatInvoiceDateTime(value?: string | Date | null): { date: string; time: string } {
  if (!value) return { date: "", time: "" }
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) return { date: String(value), time: "" }
  const p = kigaliWallParts(parsed)
  // R6: receipt dates are DD/MM/YYYY (slashes, not dashes).
  return {
    date: `${p.day}/${p.month}/${p.year}`,
    time: `${p.hour}:${p.minute}:${p.second}`,
  }
}

export function groupFiscalValue(value?: string | null): string {
  const compact = value?.replace(/[-\s]/g, "") ?? ""
  return compact.match(/.{1,4}/g)?.join("-") ?? ""
}
