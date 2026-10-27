import { forwardRef, type ReactNode } from "react"
import type { EbmInvoice } from "../../../lib/invoice"
import { documentTitle, InvoiceHeader, refundReferenceLine } from "./InvoiceHeader"
import { CustomerCard } from "./CustomerCard"
import { InvoiceTable } from "./InvoiceTable"
import { InvoiceSummary } from "./InvoiceSummary"
import { EBMSection } from "./EBMSection"
import { InvoiceFooter } from "./InvoiceFooter"

export interface InvoicePreviewProps {
  data: EbmInvoice
  className?: string
  children?: ReactNode
}

/** Full A4 invoice. Uses 100% inline styles so it works both on-screen and inside
 *  the off-screen html2canvas capture stage (Tailwind classes are not applied there). */
export const InvoicePreview = forwardRef<HTMLDivElement, InvoicePreviewProps>(
  function InvoicePreview({ data, children }, ref) {
    return (
      <div
        ref={ref}
        style={{
          fontFamily: "Arial, Helvetica, sans-serif",
          background: "#ffffff",
          color: "#111827",
          padding: "28px 24px 24px",
          width: "100%",
          maxWidth: 860,
          margin: "0 auto",
          boxSizing: "border-box",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <InvoiceHeader data={data} title={documentTitle(data.invoice)} reference={refundReferenceLine(data.invoice)} />

        {/* Client and fiscal invoice details */}
        <CustomerCard data={data} />

        {/* Items table */}
        <InvoiceTable data={data} />

        {/* Summary */}
        <InvoiceSummary data={data} />

        {/* EBM / SDC section */}
        <EBMSection data={data} />

        {/* Footer */}
        <InvoiceFooter data={data} />

        {children}
      </div>
    )
  },
)

export default InvoicePreview
