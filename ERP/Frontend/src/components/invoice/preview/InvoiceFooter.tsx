import { ShoppingCart } from "lucide-react"
import type { EbmInvoice } from "../../../lib/invoice"
import { safeText } from "./format"
import { C } from "./theme"

export function InvoiceFooter({ data }: { data: Pick<EbmInvoice, "footer" | "branding"> }) {
  const rawMessage = safeText(data.footer?.message)
  const rawNote = safeText(data.footer?.note)
  const message = rawMessage === "—" ? "Thank you for your business!" : rawMessage
  const note = rawNote === "—" ? "Goods once sold are not returnable." : rawNote
  const poweredBy = safeText(data.branding?.poweredBy)

  return (
    <footer style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 10, borderRadius: 9, background: "#EDF3FF", padding: "9px 18px" }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 41, height: 41, border: `1px solid ${C.navy}`, borderRadius: "50%", color: C.navy, flexShrink: 0 }}>
        <ShoppingCart style={{ width: 24, height: 24 }} />
      </span>
      <div style={{ textAlign: "center" }}>
        <div style={{ color: C.navy, fontSize: 13.5, fontWeight: 900, letterSpacing: 0.45, textTransform: "uppercase" }}>{message}</div>
        <div style={{ color: C.body, fontSize: 9.5, marginTop: 2, textTransform: "uppercase" }}>{note}</div>
        <div style={{ color: C.body, fontSize: 9.5, marginTop: 4 }}>
          Powered by <span style={{ color: C.navy, fontSize: 11, fontWeight: 900, letterSpacing: 0.35, textTransform: "uppercase" }}>{poweredBy}</span>
        </div>
      </div>
    </footer>
  )
}
