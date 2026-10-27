import {
  CalendarDays,
  Clock,
  CreditCard,
  FileText,
  Hash,
  Receipt,
  UserRound,
} from "lucide-react"
import type { EbmInvoice } from "../../../lib/invoice"
import { formatDateShort, formatTime, safeText } from "./format"
import { C } from "./theme"

export function InvoiceInfoCard({ data }: { data: Pick<EbmInvoice, "invoice"> }) {
  const inv = data.invoice
  const isProforma = !!inv?.isProforma || inv?.rcptLabel === "PS"
  const rows = [
    { icon: FileText, label: "Invoice No", value: safeText(inv?.invoiceNumber) },
    { icon: Hash, label: "Receipt No", value: safeText(inv?.receiptNumber) },
    { icon: CalendarDays, label: "Date", value: formatDateShort(inv?.invoiceDate) },
    { icon: Clock, label: "Time", value: formatTime(inv?.time) },
    { icon: CreditCard, label: "Payment", value: isProforma ? "" : safeText(inv?.paymentMethod) },
    { icon: UserRound, label: "Cashier", value: safeText(inv?.cashier) },
  ].filter((r) => r.value && r.value !== "—")

  return (
    <div style={{
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      overflow: "hidden",
      background: "#FFFFFF",
      height: "100%",
      boxSizing: "border-box",
    }}>
      {/* Card header */}
      <div style={{
        background: C.tint,
        borderBottom: `1px solid ${C.border}`,
        padding: "7px 14px",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}>
        <span style={{
          width: 26, height: 26,
          borderRadius: 7,
          background: "#FFFFFF",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: C.navy, flexShrink: 0,
          border: `1px solid ${C.border}`,
        }}>
          <Receipt style={{ width: 13, height: 13 }} />
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: C.deep, textTransform: "uppercase", letterSpacing: 1 }}>
          Invoice Information
        </span>
      </div>

      {/* Card body */}
      <div style={{ padding: "11px 14px 7px" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
          <tbody>
            {rows.map((r) => {
              const Icon = r.icon
              return (
                <tr key={r.label}>
                  <td style={{ paddingBottom: 6, verticalAlign: "top", width: 20 }}>
                    <Icon style={{ width: 13, height: 13, color: C.navy, marginTop: 1 }} />
                  </td>
                  <td style={{ paddingBottom: 6, color: C.muted, fontWeight: 500, whiteSpace: "nowrap", verticalAlign: "top", width: 96 }}>
                    {r.label}
                  </td>
                  <td style={{ paddingBottom: 6, color: C.body, fontWeight: 700, textAlign: "right", width: 12, verticalAlign: "top" }}>:</td>
                  <td style={{ paddingBottom: 6, color: C.ink, fontWeight: 600, verticalAlign: "top", paddingLeft: 2 }}>
                    {r.value}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}