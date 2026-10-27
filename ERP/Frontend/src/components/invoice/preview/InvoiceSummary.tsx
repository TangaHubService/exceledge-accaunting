import type { EbmInvoice } from "../../../lib/invoice"
import { calculateInvoiceTotals } from "../../../lib/invoice"
import { formatAmount } from "./format"
import { C } from "./theme"

/** Lower totals block in the same order as the supplied invoice layout. */
export function InvoiceSummary({ data }: { data: EbmInvoice }) {
  const items = Array.isArray(data.items) ? data.items : []
  const totals = data.charges ? calculateInvoiceTotals(items, data.charges) : data.totals
  const grandTotal = Number(totals?.grandTotal ?? 0)
  const hasTax = Number(totals?.vat ?? 0) > 0 || Number(totals?.tax ?? 0) > 0 || items.some((item) => Number(item.taxAmount) > 0)
  const bandOrder = ["A", "B", "C", "D"]
  const bandTotals = new Map<string, number>()
  for (const item of items) {
    const code = String((item as { taxCode?: unknown }).taxCode ?? "").toUpperCase() || "B"
    bandTotals.set(code, (bandTotals.get(code) ?? 0) + Number(item.total ?? 0))
  }
  const bandRows = [...bandTotals.entries()]
    .filter(([, total]) => Math.abs(total) > 0)
    .sort(([a], [b]) => {
      const ai = bandOrder.indexOf(a)
      const bi = bandOrder.indexOf(b)
      if (ai >= 0 || bi >= 0) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
      return a.localeCompare(b)
    })
    .map(([code, total]) => ({ label: `TOTAL ${code}`, value: total }))
  const rows = [
    { label: "SUBTOTAL (VAT INCL.)", value: grandTotal },
    ...bandRows,
    { label: "DISCOUNT", value: Number(totals?.discount ?? 0) },
    { label: "VAT", value: Number(totals?.vat ?? 0) },
    { label: "TAX", value: Number(totals?.tax ?? 0) },
    { label: "SHIPPING", value: Number(totals?.shipping ?? 0) },
    { label: "PAID", value: Number(totals?.paid ?? 0) },
    { label: "BALANCE", value: Number(totals?.balance ?? 0) },
  ]

  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginTop: 10 }}>
      <div style={{ flex: 1, padding: "5px 0 0 12px", color: C.body, fontSize: 11, fontWeight: 500 }}>
        {hasTax ? "Taxable Supplies" : "Exempt Supplies"}
      </div>

      <div style={{ width: 418, minWidth: 418, border: `1px solid ${C.borderStrong}`, borderRadius: 7, overflow: "hidden", background: "#FFFFFF" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td style={{ padding: "4px 14px", width: "68%", color: C.ink, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.1 }}>{row.label}</td>
                <td style={{ width: 14, padding: "4px 0", color: C.muted, fontSize: 10.5, fontWeight: 700, textAlign: "center" }}>:</td>
                <td style={{ padding: "4px 14px 4px 5px", color: C.ink, fontSize: 10.5, fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{formatAmount(row.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", alignItems: "stretch", borderTop: `1px solid ${C.borderStrong}` }}>
          <div style={{ flex: 1, padding: "9px 14px", color: "#FFFFFF", fontSize: 15, fontWeight: 900, letterSpacing: 0.25, textTransform: "uppercase", background: `linear-gradient(90deg, #0757D6, ${C.deep})` }}>Grand Total</div>
          <div style={{ width: "43%", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 9, padding: "7px 14px", background: `linear-gradient(90deg, #0757D6, ${C.deep})`, color: "#FFFFFF", borderLeft: "1px solid rgba(255,255,255,0.28)" }}>
            <span style={{ fontSize: 14, fontWeight: 800 }}>:</span>
            <span style={{ fontSize: 21, fontWeight: 900, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{formatAmount(grandTotal)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
