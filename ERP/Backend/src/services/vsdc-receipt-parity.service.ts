/**
 * Parity between what was sent to / returned by VSDC (`/trnsSales/saveSales`)
 * and what the CIS prints on the receipt (80mm, A4/A5, HTML).
 *
 * The fiscal truth is the persisted EbmTransaction.responseData:
 *   { raw: <VSDC reply>, normalized: <parsed reply>, requestPayload: <TrnsSalesSaveWrReq> }
 * Catalog rows (product name/itemCd), customer rows and tax-rate settings can
 * change after a sale; a reprint or copy must still print exactly what VSDC
 * holds, so the printed values are read back from this record.
 *
 * Pure functions only (no DB) so the rules are unit-testable.
 */
import { formatInvoiceAmount, groupFiscalValue, kigaliWallParts } from "./invoice-format.service"
import { isCopyDocument, isProformaDocument, isTrainingDocument, taxGroups } from "./invoice-pdf.service"
import type { RenderInvoicePayload } from "./invoice-render.service"

type Obj = Record<string, unknown>

export interface VsdcRecordItem {
  itemSeq: number | null
  itemCd: string | null
  itemNm: string | null
  qty: number | null
  prc: number | null
  totAmt: number | null
  taxTyCd: string | null
}

export interface VsdcRecord {
  /** The TrnsSalesSaveWrReq body that was submitted, when stored. */
  request: Obj | null
  /** The `data` block of the VSDC reply (rcptNo, totRcptNo, intrlData, rcptSign, sdcId, mrcNo, vsdcRcptPbctDate). */
  response: Obj | null
}

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v)
const str = (v: unknown): string | null => (v == null ? null : String(v).trim() || null)
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const posInt = (v: unknown): number | null => {
  const n = num(v)
  return n != null && Number.isInteger(n) && n > 0 ? n : null
}

export function readVsdcRecord(responseData: unknown): VsdcRecord {
  if (!isObj(responseData)) return { request: null, response: null }
  const request = isObj(responseData.requestPayload) ? responseData.requestPayload : null
  const raw = responseData.raw
  const response = isObj(raw) ? (isObj(raw.data) ? raw.data : raw) : null
  return { request, response }
}

/** `yyyyMMddHHmmss` Kigali wall time → ISO instant; null when malformed. */
export function vsdcCompactToIso(compact: unknown): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(compact ?? ""))
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+02:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Instant → `yyyyMMddHHmmss` in Kigali wall time. */
export function toKigaliCompact(value: string | Date | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const k = kigaliWallParts(date)
  return `${k.year}${k.month}${k.day}${k.hour}${k.minute}${k.second}`
}

export function vsdcItems(record: VsdcRecord): VsdcRecordItem[] | null {
  const list = record.request?.itemList
  if (!Array.isArray(list)) return null
  return list.map((raw) => {
    const it = isObj(raw) ? raw : {}
    return {
      itemSeq: posInt(it.itemSeq),
      itemCd: str(it.itemCd),
      itemNm: str(it.itemNm),
      qty: num(it.qty),
      prc: num(it.prc),
      totAmt: num(it.totAmt),
      taxTyCd: str(it.taxTyCd)?.toUpperCase() ?? null,
    }
  })
}

/** Item submitted for printed line `index` (0-based), matched by itemSeq; only when the line counts agree. */
export function vsdcItemForLine(items: VsdcRecordItem[] | null, lineCount: number, index: number): VsdcRecordItem | null {
  if (!items || items.length !== lineCount) return null
  return items.find((it) => it.itemSeq === index + 1) ?? items[index] ?? null
}

/** A/B/C/D rates that were submitted (taxRtA..D), when all four are present. */
export function vsdcTaxRates(record: VsdcRecord): [number, number, number, number] | null {
  const r = record.request
  if (!r) return null
  const rates = [num(r.taxRtA), num(r.taxRtB), num(r.taxRtC), num(r.taxRtD)]
  return rates.every((v) => v != null) ? (rates as [number, number, number, number]) : null
}

export function vsdcInvoiceNumber(record: VsdcRecord): number | null {
  return posInt(record.request?.invcNo)
}

export function vsdcOriginalInvoiceNumber(record: VsdcRecord): number | null {
  return posInt(record.request?.orgInvcNo)
}

/** Buyer name/TIN exactly as submitted (`custNm`, `receipt.custTin`). */
export function vsdcBuyer(record: VsdcRecord): { name: string | null; tin: string | null; hasTin: boolean } | null {
  const r = record.request
  if (!r) return null
  const receipt = isObj(r.receipt) ? r.receipt : null
  return {
    name: str(r.custNm),
    tin: receipt ? str(receipt.custTin) : null,
    hasTin: !!receipt && "custTin" in receipt,
  }
}

/** SDC `rcptNo` VSDC returned (the per-type "A" counter). */
export function vsdcReceiptNumber(record: VsdcRecord): number | null {
  return posInt(record.response?.rcptNo)
}

export function vsdcMrcNo(record: VsdcRecord): string | null {
  return str(record.response?.mrcNo)
}

export function vsdcSdcId(record: VsdcRecord): string | null {
  return str(record.response?.sdcId)
}

const money = (n: number) => Math.round(Math.abs(n) * 100) / 100
const sameMoney = (a: number | null, b: number) => a != null && money(a) === money(b)

/**
 * Every printed value that has a counterpart in the persisted VSDC
 * request/response, compared field by field. Returns human-readable
 * mismatches; empty means the printout agrees with the fiscal record.
 * Fields absent from the record are not compared.
 *
 * Refunds: VSDC receives positive magnitudes (the sandbox rejects negative
 * supply amounts) while the CIS receipt prints them negative, so amounts are
 * compared by magnitude and the sign is checked separately.
 */
export function vsdcReceiptParityErrors(
  payload: RenderInvoicePayload,
  record: VsdcRecord,
  /** For a refund: the stored VSDC record of the sale it refunds. */
  originalRecord?: VsdcRecord | null,
): string[] {
  const errors: string[] = []
  const req = record.request
  const res = record.response
  const sdc = payload.sdcInformation

  if (res) {
    const rcptNo = posInt(res.rcptNo)
    const totRcptNo = posInt(res.totRcptNo)
    if (rcptNo != null) {
      const expected = `${rcptNo}/${totRcptNo ?? rcptNo}`
      const printed = String(sdc.receiptNumber ?? "").split(" ")[0]
      if (printed !== expected) errors.push(`SDC receipt number printed "${sdc.receiptNumber}" ≠ VSDC rcptNo/totRcptNo ${expected}`)
    }
    const pairs: Array<[string, unknown, unknown]> = [
      ["sdcId", res.sdcId, sdc.sdcId],
      ["intrlData", res.intrlData, sdc.internalData],
      ["rcptSign", res.rcptSign, sdc.receiptSignature],
    ]
    for (const [field, sent, printed] of pairs) {
      const s = str(sent)
      // Training/proforma receipts deliberately print no intrlData/rcptSign.
      if (s && (field === "intrlData" || field === "rcptSign") && printed == null) continue
      if (s && s !== str(printed)) errors.push(`${field} printed "${printed ?? ""}" ≠ VSDC ${s}`)
    }
    const pbct = str(res.vsdcRcptPbctDate)
    if (pbct) {
      const printed = toKigaliCompact(sdc.date ?? sdc.sdcDateTime ?? null)
      if (printed !== pbct) errors.push(`SDC date/time printed ${printed ?? "(none)"} ≠ vsdcRcptPbctDate ${pbct}`)
      const t = `${pbct.slice(8, 10)}:${pbct.slice(10, 12)}:${pbct.slice(12, 14)}`
      if (sdc.time && sdc.time !== t) errors.push(`SDC time printed ${sdc.time} ≠ vsdcRcptPbctDate ${t}`)
    }
  }

  if (!req) return errors

  const invcNo = posInt(req.invcNo)
  if (invcNo != null && String(payload.invoice.invoiceNumber) !== String(invcNo)) {
    errors.push(`bottom RECEIPT NUMBER printed "${payload.invoice.invoiceNumber}" ≠ invcNo ${invcNo}`)
  }

  const cfmDt = str(req.cfmDt)
  if (cfmDt) {
    const printed = toKigaliCompact(payload.invoice.invoiceDate)
    if (printed !== cfmDt) errors.push(`CIS date/time printed ${printed ?? "(none)"} ≠ cfmDt ${cfmDt}`)
    const t = `${cfmDt.slice(8, 10)}:${cfmDt.slice(10, 12)}:${cfmDt.slice(12, 14)}`
    if (payload.invoice.time && payload.invoice.time !== t) errors.push(`CIS time printed ${payload.invoice.time} ≠ cfmDt ${t}`)
  }
  const salesDt = str(req.salesDt)
  if (salesDt && cfmDt && !cfmDt.startsWith(salesDt)) errors.push(`salesDt ${salesDt} is not the date of cfmDt ${cfmDt}`)

  const isRefund = req.rcptTyCd === "R"
  const orgInvcNo = posInt(req.orgInvcNo)
  if (isRefund) {
    if (orgInvcNo == null) errors.push("refund was sent without orgInvcNo")
    else if (String(payload.invoice.originalInvoiceNumber ?? "") !== String(orgInvcNo)) {
      errors.push(`refund references original invoice ${payload.invoice.originalInvoiceNumber ?? "(none)"} ≠ orgInvcNo ${orgInvcNo}`)
    }
    const printedRef = str(payload.invoice.originalReceiptNumber)
    if (!printedRef) errors.push("refund prints no REF. NORMAL RECEIPT#")
    if (originalRecord) {
      const origInvcNo = vsdcInvoiceNumber(originalRecord)
      if (orgInvcNo != null && origInvcNo != null && origInvcNo !== orgInvcNo) {
        errors.push(`orgInvcNo ${orgInvcNo} ≠ original sale invcNo ${origInvcNo}`)
      }
    }
    if (printedRef && orgInvcNo != null && printedRef !== String(orgInvcNo)) {
      errors.push(`REF. NORMAL RECEIPT# printed "${printedRef}" ≠ orgInvcNo ${orgInvcNo}`)
    }
    if (payload.totals.grandTotal > 0) errors.push(`refund total prints positive (${payload.totals.grandTotal})`)
  } else if (payload.totals.grandTotal < 0) {
    errors.push(`sale total prints negative (${payload.totals.grandTotal})`)
  }

  const custNm = str(req.custNm)
  if (custNm && custNm !== str(payload.customer.name)) errors.push(`client name printed "${payload.customer.name}" ≠ custNm "${custNm}"`)
  const buyer = vsdcBuyer(record)
  if (buyer?.hasTin && (buyer.tin ?? "") !== (str(payload.customer.tin) ?? "")) {
    errors.push(`client TIN printed "${payload.customer.tin ?? ""}" ≠ receipt.custTin "${buyer.tin ?? ""}"`)
  }

  const totItemCnt = num(req.totItemCnt)
  if (totItemCnt != null && totItemCnt !== payload.items.length) errors.push(`ITEMS NUMBER printed ${payload.items.length} ≠ totItemCnt ${totItemCnt}`)

  const items = vsdcItems(record)
  if (items) {
    if (items.length !== payload.items.length) errors.push(`printed ${payload.items.length} item lines ≠ itemList.length ${items.length}`)
    payload.items.forEach((line, i) => {
      const sent = vsdcItemForLine(items, payload.items.length, i)
      if (!sent) return
      const at = `item ${i + 1}`
      if (sent.itemCd && sent.itemCd !== str(line.code)) errors.push(`${at} code printed "${line.code}" ≠ itemCd "${sent.itemCd}"`)
      if (sent.itemNm && sent.itemNm !== str(line.description)) errors.push(`${at} name printed "${line.description}" ≠ itemNm "${sent.itemNm}"`)
      if (sent.qty != null && Math.abs(sent.qty) !== Math.abs(line.quantity)) errors.push(`${at} qty printed ${line.quantity} ≠ qty ${sent.qty}`)
      if (sent.prc != null && !sameMoney(sent.prc, line.unitPrice)) errors.push(`${at} price printed ${line.unitPrice} ≠ prc ${sent.prc}`)
      if (sent.totAmt != null && !sameMoney(sent.totAmt, line.total)) errors.push(`${at} total printed ${line.total} ≠ totAmt ${sent.totAmt}`)
      if (sent.taxTyCd && sent.taxTyCd !== str(line.taxCode)?.toUpperCase()) errors.push(`${at} tax type printed ${line.taxCode} ≠ taxTyCd ${sent.taxTyCd}`)
      if (isRefund && line.total > 0) errors.push(`${at} total prints positive on a refund`)
    })
  }

  const rates = vsdcTaxRates(record)
  if (rates && payload.taxRates && rates.some((r, i) => r !== payload.taxRates![i])) {
    errors.push(`printed tax rates ${payload.taxRates.join("/")} ≠ taxRtA..D ${rates.join("/")}`)
  }

  const groups = new Map(taxGroups(payload).map((g) => [g.code, g]))
  let printedTax = 0
  for (const code of ["A", "B", "C", "D"]) {
    const g = groups.get(code)
    printedTax += g?.tax ?? 0
    const taxbl = num(req[`taxblAmt${code}`])
    const tax = num(req[`taxAmt${code}`])
    if (taxbl != null && !sameMoney(taxbl, g?.total ?? 0)) errors.push(`TOTAL ${code} printed ${g?.total ?? 0} ≠ taxblAmt${code} ${taxbl}`)
    if (tax != null && !sameMoney(tax, g?.tax ?? 0)) errors.push(`TOTAL TAX ${code} printed ${g?.tax ?? 0} ≠ taxAmt${code} ${tax}`)
  }
  const totTaxAmt = num(req.totTaxAmt)
  if (totTaxAmt != null && !sameMoney(totTaxAmt, printedTax)) errors.push(`TOTAL TAX printed ${printedTax} ≠ totTaxAmt ${totTaxAmt}`)
  const totAmt = num(req.totAmt)
  if (totAmt != null && !sameMoney(totAmt, payload.totals.grandTotal)) errors.push(`TOTAL printed ${payload.totals.grandTotal} ≠ totAmt ${totAmt}`)

  return errors
}

const compactDate = (c: string) => `${c.slice(6, 8)}/${c.slice(4, 6)}/${c.slice(0, 4)}`
const compactTime = (c: string) => `${c.slice(8, 10)}:${c.slice(10, 12)}:${c.slice(12, 14)}`

/**
 * Checks the text a renderer actually drew (80mm / A4 / A5 PDF) against the
 * stored VSDC exchange and the EBM spec receipt samples (13.1 NS, 14.1 NR,
 * 15.1 CR, 16.1 TS, 17.1 PS): every VSDC value must appear verbatim, and the
 * designation lines must match the receipt type. `originalRecord` is the
 * refunded sale's record (refunds only).
 */
export function vsdcPrintedTextErrors(
  text: string,
  payload: RenderInvoicePayload,
  record: VsdcRecord,
  originalRecord?: VsdcRecord | null,
): string[] {
  const errors: string[] = []
  const need = (what: string, s: string) => {
    if (!text.includes(s)) errors.push(`${what}: "${s}" not printed`)
  }
  const forbid = (what: string, s: string) => {
    if (text.includes(s)) errors.push(`${what}: "${s}" must not be printed`)
  }
  const req = record.request
  const res = record.response
  const copy = isCopyDocument(payload)
  const training = isTrainingDocument(payload)
  const proforma = isProformaDocument(payload)

  if (res) {
    const rcptNo = posInt(res.rcptNo)
    const totRcptNo = posInt(res.totRcptNo)
    const type = req ? `${str(req.salesTyCd) ?? ""}${str(req.rcptTyCd) ?? ""}` : ""
    if (rcptNo != null) need("SDC receipt number", `RECEIPT NUMBER: ${rcptNo}/${totRcptNo ?? rcptNo}${/^[NTP][SR]$/.test(type) ? ` ${type}` : ""}`)
    const sdcId = str(res.sdcId)
    if (sdcId) need("SDC ID", `SDC ID: ${sdcId}`)
    // The device MRC configured in the CIS prints in preference to the one VSDC echoes.
    const mrc = str(payload.sdcInformation.mrcNo) ?? str(res.mrcNo)
    if (mrc) need("MRC", `MRC: ${mrc}`)
    const pbct = str(res.vsdcRcptPbctDate)
    if (pbct) need("SDC date/time", `Date: ${compactDate(pbct)} Time: ${compactTime(pbct)}`)
    const intrl = str(res.intrlData)
    const sign = str(res.rcptSign)
    if (training || proforma) {
      forbid("TS/TR/PS internal data", "Internal Data")
      forbid("TS/TR/PS signature", "Receipt Signature")
    } else {
      if (intrl) need("Internal Data", `Internal Data:${groupFiscalValue(intrl)}`)
      if (sign) need("Receipt Signature", `Receipt Signature:${groupFiscalValue(sign)}`)
    }
  }

  if (req) {
    const invcNo = posInt(req.invcNo)
    if (invcNo != null) need("CIS receipt number", `RECEIPT NUMBER: ${invcNo}`)
    const cfmDt = str(req.cfmDt)
    if (cfmDt) need("CIS date/time", `DATE: ${compactDate(cfmDt)} TIME: ${compactTime(cfmDt)}`)
    const totAmt = num(req.totAmt)
    const refund = req.rcptTyCd === "R"
    if (totAmt != null) need("TOTAL", formatInvoiceAmount(refund ? -Math.abs(totAmt) : totAmt))
    for (const it of vsdcItems(record) ?? []) if (it.itemNm) need("item name", it.itemNm)
    if (refund) {
      need("refund title", "REFUND")
      need("refund notice", "REFUND IS APPROVED ONLY FOR ORIGINAL SALES RECEIPT")
      const orgInvcNo = posInt(req.orgInvcNo)
      if (orgInvcNo != null) need("REF. NORMAL RECEIPT#", `REF. NORMAL RECEIPT#: ${orgInvcNo}`)
      else if (!text.includes("REF. NORMAL RECEIPT#: ")) errors.push("REF. NORMAL RECEIPT# not printed")
    }
  }

  const notice = "THIS IS NOT AN OFFICIAL RECEIPT"
  if (training || proforma) need("notice", notice)
  else if (payload.certification.isCertified) forbid(copy ? "CS/CR notice" : "NS/NR notice", notice)
  const designation = copy ? "COPY" : training ? "TRAINING MODE" : proforma ? "PROFORMA" : null
  if (designation) {
    const n = text.split("\n").filter((l) => l.trim() === designation).length
    // COPY / TRAINING MODE / PROFORMA: header title only.
    if (n < 1) errors.push(`${designation} printed ${n}× — it must print as the header title`)
  }
  return errors
}
