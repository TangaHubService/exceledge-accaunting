const TIME_ZONE = "Africa/Kigali";

const moneyFormatters = new Map<number, Intl.NumberFormat>();

function moneyFormatter(decimals: number) {
  let f = moneyFormatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat("en-RW", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    moneyFormatters.set(decimals, f);
  }
  return f;
}

/** Prisma decimals arrive as strings; everything else as numbers. */
export function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Amount without currency, for table cells where the currency is in the header. */
export function amount(value: number | string | null | undefined, decimals = 0): string {
  const n = toNumber(value);
  const text = moneyFormatter(decimals).format(Math.abs(n));
  return n < 0 ? `−${text}` : text;
}

export function money(value: number | string | null | undefined, currency = "RWF", decimals = 0): string {
  return `${currency} ${amount(value, decimals)}`;
}

/** Debit-positive balance shown the way accountants read it: "1,200 Dr" / "450 Cr". */
export function drCr(value: number | string | null | undefined): string {
  const n = toNumber(value);
  if (Math.abs(n) < 0.005) return "0";
  return `${moneyFormatter(0).format(Math.abs(n))} ${n > 0 ? "Dr" : "Cr"}`;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: TIME_ZONE });
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIME_ZONE,
});

export function date(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? "—" : dateFormat.format(d);
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFormat.format(d);
}

/** yyyy-mm-dd in Kigali time, for date inputs and API payloads. */
export function isoDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(d);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string | Date, to: string | Date = new Date()): number {
  const a = new Date(isoDay(new Date(from))).getTime();
  const b = new Date(isoDay(new Date(to))).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** "WALK_IN" → "Walk in" */
export function humanize(value: string | null | undefined): string {
  if (!value) return "";
  const s = value.replaceAll("_", " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const MODULE_LABELS: Record<string, string> = { AR: "Receivables", AP: "Payables", GL: "General ledger", POS: "Point of sale", TAX: "Tax", BANK: "Banking" };

/** Source module codes on journals ("AR", "SALES") as words. */
export function moduleLabel(code: string | null | undefined): string {
  if (!code) return "";
  return MODULE_LABELS[code.toUpperCase()] ?? humanize(code);
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
