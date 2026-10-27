import { CalendarDays, CreditCard, FileText, Hash, Receipt, UserRound } from "lucide-react"
import type { EbmInvoice } from "../../../lib/invoice"
import { formatDateShort, formatTime, safeText } from "./format"
import { C } from "./theme"

type Detail = {
  label: string
  value: string
  Icon?: typeof FileText
  /** Always show this row's label, even when there's no value to show (blank instead of "—"). */
  required?: boolean
}

function DetailList({ rows, withIcons = false }: { rows: Detail[]; withIcons?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 11 }}>
      {rows.filter((row) => row.required || row.value !== "—").map(({ label, value, Icon, required }) => (
        <div key={label} style={{ display: "grid", gridTemplateColumns: withIcons ? "20px 104px 14px minmax(0, 1fr)" : "104px 14px minmax(0, 1fr)", alignItems: "start", columnGap: 4, fontSize: 11 }}>
          {withIcons ? <span style={{ lineHeight: 1 }}>{Icon ? <Icon style={{ width: 14, height: 14, color: C.navy }} /> : null}</span> : null}
          <span style={{ color: C.body, fontWeight: 500, lineHeight: 1.25 }}>{label}</span>
          <span style={{ color: C.body, fontWeight: 700, textAlign: "center", lineHeight: 1.25 }}>:</span>
          <span style={{ color: C.ink, fontWeight: 600, lineHeight: 1.25, overflowWrap: "anywhere" }}>{required && value === "—" ? "" : value}</span>
        </div>
      ))}
    </div>
  )
}

/** Client and invoice facts in one card, matching the supplied RRA invoice reference. */
export function CustomerCard({ data }: { data: Pick<EbmInvoice, "customer" | "invoice"> }) {
  const customer = data.customer
  const invoice = data.invoice
  const clientRows: Detail[] = [
    { label: "Client Name", value: safeText(customer?.name), required: true },
    { label: "TIN", value: safeText(customer?.tin ?? customer?.vatNo), required: true },
    { label: "Phone", value: safeText(customer?.phone), required: true },
    { label: "Address", value: safeText(customer?.address) },
  ]
  const isProforma = !!invoice?.isProforma || invoice?.rcptLabel === "PS"
  const invoiceRows: Detail[] = [
    { label: "Invoice No", value: safeText(invoice?.invoiceNumber), Icon: FileText },
    { label: "Receipt No", value: safeText(invoice?.receiptNumber), Icon: Hash },
    { label: "Date", value: formatDateShort(invoice?.invoiceDate), Icon: CalendarDays },
    { label: "Time", value: formatTime(invoice?.time), Icon: Receipt },
    ...(isProforma ? [] : [{ label: "Payment Method", value: safeText(invoice?.paymentMethod), Icon: CreditCard }]),
    { label: "Cashier", value: safeText(invoice?.cashier), Icon: UserRound },
  ]

  return (
    <section style={{ display: "flex", marginTop: 14, border: `1px solid ${C.borderStrong}`, borderRadius: 9, overflow: "hidden", background: "#FFFFFF" }}>
      <div style={{ flex: 1.16, minWidth: 0, padding: "14px 18px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, border: `1px solid ${C.navy}`, borderRadius: "50%", color: C.navy, flexShrink: 0 }}>
            <UserRound style={{ width: 21, height: 21 }} />
          </span>
          <span style={{ color: C.navy, fontWeight: 900, fontSize: 12, textTransform: "uppercase" }}>Client Information</span>
        </div>
        <DetailList rows={clientRows} />
      </div>

      <div style={{ flex: 0.94, minWidth: 0, borderLeft: `1px solid ${C.borderStrong}`, padding: "14px 18px 16px" }}>
        <DetailList rows={invoiceRows} withIcons />
      </div>
    </section>
  )
}
