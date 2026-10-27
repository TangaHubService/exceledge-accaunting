import { useEffect, useRef } from "react"
import { QrCode } from "lucide-react"
import type { EbmInvoice } from "../../../lib/invoice"
import { dashEvery4, formatDateShort, formatTime, safeText } from "./format"
import { C } from "./theme"

type EbmSectionProps = Pick<EbmInvoice, "sdcInformation" | "verification" | "invoice" | "branding">

function QrCanvas({ payload }: { payload: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!payload || !canvasRef.current) return
    import("qrcode").then(({ default: QRCode }) => {
      QRCode.toCanvas(canvasRef.current!, payload, {
        width: 100,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
        errorCorrectionLevel: "M",
      }).catch(console.error)
    })
  }, [payload])

  return <canvas ref={canvasRef} style={{ width: 100, height: 100, display: "block" }} />
}

/**
 * Official verification data. Shown after real fiscalisation — including
 * training (TS/TR) and proforma (PS) receipts, which are fiscalized through
 * the VSDC like every other receipt type. While confirmation is still pending
 * the block still appears (with blank Internal Data / Receipt Signature)
 * rather than silently disappearing.
 *
 * Layout matches the RRA thermal sample: SDC INFORMATION heading, fiscal
 * fields, bottom RECEIPT NUMBER:{vsdcInvcNo} + Date + MRC, then CIS branding.
 */
export function EBMSection({ data }: { data: EbmSectionProps }) {
  const sdc = data.sdcInformation
  const rcptLabel = (data.invoice?.rcptLabel ?? "").toUpperCase()
  const isTraining = rcptLabel === "TS" || rcptLabel === "TR"
  const isProforma = Boolean(data.invoice?.isProforma) || rcptLabel === "PS"
  const isCopy = !isTraining && !isProforma && (Boolean(data.invoice?.isCopy) || rcptLabel === "CS" || rcptLabel === "CR")
  // QR on signed receipts: NS/NR and their CS/CR copies (the original's QR, unchanged).
  const showQr = !isTraining && !isProforma
  const qrImage = showQr ? data.verification?.qrCodeImage : null
  const qrPayload = showQr ? data.verification?.qrPayload : null
  const signature = safeText(sdc?.receiptSignature)
  const internalData = safeText(sdc?.internalData)
  const hasSdc = Boolean(qrImage || qrPayload || isTraining || isProforma || isCopy || (sdc?.receiptNumber && sdc?.internalData && sdc?.receiptSignature))

  if (!hasSdc) return null

  const branding =
    safeText(sdc?.poweredBy) !== "—"
      ? safeText(sdc?.poweredBy)
      : "Excledge ERP v1.0.0 Powered by RRA VSDC EBM 2.1."

  // SDC block: the VSDC publication time (vsdcRcptPbctDate). Bottom block: the
  // CIS transaction time (cfmDt) — the same split as the backend PDF.
  const dateStr = formatDateShort(sdc?.date ?? data.invoice?.invoiceDate)
  const timeStr = formatTime(sdc?.time ?? data.invoice?.time)
  const cisDateStr = formatDateShort(data.invoice?.invoiceDate)
  const cisTimeStr = formatTime(data.invoice?.time ?? data.invoice?.invoiceDate)
  const receiptNo = safeText(sdc?.receiptNumber ?? data.invoice?.receiptNumber)
  const invoiceNo = safeText(data.invoice?.invoiceNumber)
  const internalDataDisplay = internalData !== "—" ? dashEvery4(internalData) : "—"
  const signatureDisplay = signature !== "—" ? dashEvery4(signature) : "—"
  const mrc = safeText(sdc?.mrcNo)

  const lineStyle: React.CSSProperties = {
    margin: 0,
    color: C.body,
    fontSize: 10,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontWeight: 500,
    lineHeight: 1.45,
    letterSpacing: 0.1,
  }

  return (
    <section style={{ display: "flex", marginTop: 10, border: `1.5px solid ${C.green}`, borderRadius: 8, overflow: "hidden", background: "#FFFFFF" }}>
      <div style={{ width: 194, minWidth: 194, padding: "9px 12px", borderRight: `1px solid ${C.borderStrong}`, textAlign: "center", boxSizing: "border-box" }}>
        <div style={{ color: C.green, fontSize: 10.5, fontWeight: 900, textTransform: "uppercase" }}>Verify Invoice</div>
        <div style={{ width: 110, height: 110, margin: "6px auto 0", border: `1px solid ${C.green}`, borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "#FFFFFF" }}>
          {qrImage ? (
            <img src={qrImage} alt="Invoice QR verification code" crossOrigin="anonymous" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          ) : qrPayload ? <QrCanvas payload={qrPayload} /> : (
            <QrCode style={{ width: 28, height: 28, color: C.faint }} />
          )}
        </div>
        <p style={{ margin: "5px 0 0", color: C.body, fontSize: 8.5, lineHeight: 1.28 }}>
          Scan the QR code using RRA EBMVerify app to verify the authenticity of this invoice.
        </p>
      </div>

      <div style={{ flex: 1, minWidth: 0, padding: "10px 16px 10px" }}>
        <p style={{ ...lineStyle, color: C.green, fontWeight: 800, textAlign: "center", marginBottom: 4 }}>
          SDC INFORMATION
        </p>
        <div style={{ borderTop: `1px dashed ${C.borderStrong}`, margin: "4px 0 6px" }} />

        <p style={lineStyle}>Date: {dateStr}   {timeStr}</p>
        <p style={lineStyle}>SDC ID : {safeText(sdc?.sdcId)}</p>
        <p style={lineStyle}>RECEIPT NUMBER : {receiptNo}</p>
        {/* Spec 16.1/17.1: TS/TR/PS carry no Internal Data or Receipt Signature. */}
        {!isTraining && !isProforma && (
          <>
            <p style={{ ...lineStyle, overflowWrap: "anywhere" }}>Internal Data:{internalDataDisplay}</p>
            <p style={{ ...lineStyle, overflowWrap: "anywhere" }}>Receipt Signature:{signatureDisplay}</p>
          </>
        )}

        <div style={{ borderTop: `1px dashed ${C.borderStrong}`, margin: "8px 0 6px" }} />

        {/* Bottom block — RRA sample style: RECEIPT NUMBER:{vsdcInvcNo} */}
        <p style={{ ...lineStyle, fontWeight: 800 }}>RECEIPT NUMBER:{invoiceNo}</p>
        <p style={lineStyle}>Date : {cisDateStr}   {cisTimeStr}</p>
        <p style={lineStyle}>MRC : {mrc}</p>
        <p style={{ ...lineStyle, marginTop: 8, textAlign: "center", fontSize: 9, color: C.green, fontWeight: 700 }}>
          {branding}
        </p>
      </div>
    </section>
  )
}
