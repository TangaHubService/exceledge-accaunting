import type { EbmInvoice } from "../../../lib/invoice"
import { formatAmount, formatQuantity, safeText } from "./format"
import { C } from "./theme"

type Col = { label: string; align: "left" | "center" | "right"; key: string; width: string }

const COLS: Col[] = [
  { label: "#", align: "center", key: "line", width: "5%" },
  { label: "Item Code", align: "left", key: "code", width: "11%" },
  { label: "Description", align: "left", key: "description", width: "19%" },
  { label: "Qty", align: "center", key: "quantity", width: "7.5%" },
  { label: "Unit", align: "center", key: "unit", width: "8%" },
  { label: "Unit Price", align: "right", key: "price", width: "13%" },
  { label: "Discount", align: "right", key: "discount", width: "10%" },
  { label: "VAT %", align: "center", key: "vat", width: "7.5%" },
  { label: "Tax", align: "right", key: "tax", width: "7%" },
  { label: "Subtotal", align: "right", key: "total", width: "12%" },
]

/** Standard RRA receipt line table. The same component feeds preview and PDF. */
export function InvoiceTable({ data }: { data: Pick<EbmInvoice, "items"> }) {
  const items = Array.isArray(data.items) ? data.items : []
  const th: React.CSSProperties = {
    background: `linear-gradient(180deg, #0757D6 0%, ${C.deep} 100%)`,
    color: "#FFFFFF",
    padding: "9px 6px",
    fontSize: 9.5,
    fontWeight: 900,
    textTransform: "uppercase",
    borderRight: "1px solid rgba(255,255,255,0.28)",
    whiteSpace: "nowrap",
  }
  const td: React.CSSProperties = {
    padding: "9px 6px",
    fontSize: 10.5,
    borderRight: `1px solid ${C.border}`,
    borderBottom: `1px solid ${C.border}`,
    color: C.body,
    verticalAlign: "middle",
  }

  return (
    <div style={{ border: `1px solid ${C.borderStrong}`, borderRadius: 8, overflow: "hidden", marginTop: 16, background: "#FFFFFF" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <thead>
          <tr>
            {COLS.map((column, index) => (
              <th key={column.key} style={{ ...th, width: column.width, textAlign: column.align, borderRight: index === COLS.length - 1 ? "none" : th.borderRight }}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={COLS.length} style={{ ...td, borderRight: "none", textAlign: "center", padding: 30, color: C.muted }}>No line items on this invoice.</td>
            </tr>
          ) : items.map((item, index) => (
            <tr key={item.id ?? index} style={{ background: index % 2 ? "#FCFDFF" : "#FFFFFF" }}>
              <td style={{ ...td, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{item.line || index + 1}</td>
              <td style={{ ...td, overflowWrap: "anywhere" }}>{safeText(item.code)}</td>
              <td style={{ ...td, fontWeight: 600, color: C.ink, overflowWrap: "anywhere" }}>{safeText(item.description)}</td>
              <td style={{ ...td, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{formatQuantity(item.quantity)}</td>
              <td style={{ ...td, textAlign: "center", textTransform: "capitalize" }}>{safeText(item.unit)}</td>
              <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatAmount(item.unitPrice)}</td>
              <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatAmount(item.discountAmt)}</td>
              <td style={{ ...td, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{Number(item.vatPct || 0)}%</td>
              <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatAmount(item.taxAmount)}</td>
              <td style={{ ...td, borderRight: "none", textAlign: "right", color: C.ink, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{formatAmount(item.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
