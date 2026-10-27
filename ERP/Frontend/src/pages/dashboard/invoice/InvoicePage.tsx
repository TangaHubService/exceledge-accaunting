import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, Copy, FileDown, Loader2, Printer, RefreshCw, ReceiptText, Share2 } from "lucide-react"
import { toast } from "react-toastify"
import { apiClient } from "../../../lib/api-client"
import { getInvoiceFilename, unwrapInvoice } from "../../../lib/invoice"
import {
  canCopyReceipt,
  downloadInvoicePdf,
  getInvoicePdfBlob,
  issueInvoicePdfBlob,
  printPdfBlob,
  printReceiptCopy,
  shareInvoicePdf,
  type InvoicePdfFormat,
} from "../../../lib/invoice-pdf"
import { Button } from "../../../components/ui/button"
import { Skeleton } from "../../../components/ui/skeleton"
import { cn } from "../../../lib/utils"

const FORMAT_OPTIONS: Array<{ value: InvoicePdfFormat; label: string }> = [
  { value: "A4", label: "A4" },
  { value: "A5", label: "A5" },
  { value: "80mm", label: "80mm" },
]

function InvoiceSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[210mm] space-y-4">
      <Skeleton className="h-16 rounded-xl" />
      <Skeleton className="aspect-[210/297] w-full rounded-xl" />
    </div>
  )
}

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [isPdfGenerating, setIsPdfGenerating] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)
  const [isPrintingCopy, setIsPrintingCopy] = useState(false)
  const [format, setFormat] = useState<InvoicePdfFormat>("A4")

  const invoiceQuery = useQuery({
    queryKey: ["invoice", id],
    queryFn: async () => unwrapInvoice(await apiClient.getInvoice(id!, { allowPending: true })),
    enabled: !!id,
    retry: 1,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  })
  const pdfQuery = useQuery({
    queryKey: ["invoice-pdf", id, format],
    queryFn: () => getInvoicePdfBlob(id!, format),
    enabled: !!id,
    retry: 1,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  })
  const data = invoiceQuery.data

  useEffect(() => {
    if (!pdfQuery.data) {
      setPdfUrl(null)
      return
    }
    const url = URL.createObjectURL(pdfQuery.data)
    setPdfUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pdfQuery.data])

  const refresh = () => {
    void invoiceQuery.refetch()
    void pdfQuery.refetch()
  }

  /**
   * CIS/VSDC spec §7.18/§15: "print only one original receipt. Reprint shall
   * have a watermark with mention Copy." downloadInvoicePdf registers each
   * download with the backend itself, so the first download of this invoice
   * comes back original and every one after renders watermarked COPY —
   * there's no separate copy action to trigger by hand.
   */
  const handlePdfDownload = async () => {
    if (!data || !id) return
    try {
      setIsPdfGenerating(true)
      await downloadInvoicePdf(id, getInvoiceFilename(data, id, format), format)
      toast.success("PDF downloaded")
    } catch (error) {
      console.error("PDF download failed:", error)
      toast.error("Failed to download the invoice PDF")
    } finally {
      setIsPdfGenerating(false)
    }
  }

  const handleShare = async () => {
    if (!data || !id) return
    try {
      setIsSharing(true)
      const shared = await shareInvoicePdf(id, getInvoiceFilename(data, id, format), format)
      toast.success(shared ? "Invoice ready to share" : "Your browser downloaded the invoice instead")
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return
      console.error("Invoice share failed:", error)
      toast.error("Failed to prepare invoice sharing")
    } finally {
      setIsSharing(false)
    }
  }

  // Printing issues a receipt, so it registers like a download: the preview
  // above is never printed directly (that would hand out repeat originals).
  const handlePrint = async () => {
    if (!id) return
    try {
      setIsPrinting(true)
      if (!printPdfBlob(await issueInvoicePdfBlob(id, format))) toast.error("Allow pop-ups to open the invoice print view")
      refresh()
    } catch (error) {
      console.error("Invoice print failed:", error)
      toast.error(error instanceof Error ? error.message : "Failed to print the invoice")
    } finally {
      setIsPrinting(false)
    }
  }

  const handlePrintCopy = async () => {
    if (!id) return
    try {
      setIsPrintingCopy(true)
      const label = await printReceiptCopy(id, format)
      toast.success(`${label ?? "Copy"} receipt sent to the printer`)
      refresh()
    } catch (error) {
      console.error("Receipt copy failed:", error)
      toast.error(error instanceof Error ? error.message : "Failed to print the receipt copy")
    } finally {
      setIsPrintingCopy(false)
    }
  }

  const isLoading = invoiceQuery.isLoading || pdfQuery.isLoading
  const isError = invoiceQuery.isError || pdfQuery.isError
  const isFetching = invoiceQuery.isFetching || pdfQuery.isFetching

  return (
    <div className="min-h-screen bg-slate-100 py-6 dark:bg-slate-950">
      <div className="mx-auto max-w-5xl px-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft className="size-4" /> Back
            </Button>
            <div>
              <h1 className="text-sm font-bold text-slate-900">EBM Invoice</h1>
              <p className="text-[11px] text-slate-500">
                {data ? `${data.invoice.invoiceNumber} · ${data.invoice.paymentMethod || "—"}` : "Loading invoice…"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-slate-200 p-0.5">
              {FORMAT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFormat(option.value)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                    format === option.value
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={refresh} disabled={isFetching}>
              {isFetching ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handlePdfDownload} disabled={isPdfGenerating || !data}>
              {isPdfGenerating ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
              PDF
            </Button>
            <Button variant="outline" size="sm" onClick={handleShare} disabled={isSharing || !data}>
              {isSharing ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />}
              Share
            </Button>
            {data && canCopyReceipt(data.invoice) ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrintCopy}
                disabled={isPrintingCopy}
                title="Reprint this receipt as a COPY (CS for a sale, CR for a refund) with its original fiscal data"
              >
                {isPrintingCopy ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
                Print copy
              </Button>
            ) : null}
            <Button size="sm" onClick={handlePrint} disabled={!data || isPrinting}>
              {isPrinting ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />} Print
            </Button>
          </div>
        </div>

        {isLoading ? (
          <InvoiceSkeleton />
        ) : isError ? (
          <div className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
            <ReceiptText className="h-10 w-10 text-red-500" />
            <h2 className="text-base font-bold text-slate-900">Could not load the invoice</h2>
            <p className="text-sm text-slate-500">The authoritative PDF could not be fetched from the server.</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate("/dashboard/sales")}>Go to Sales</Button>
              <Button size="sm" onClick={refresh}><RefreshCw className="size-4" /> Retry</Button>
            </div>
          </div>
        ) : !data || !pdfUrl ? (
          <div className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
            <ReceiptText className="h-10 w-10 text-slate-300" />
            <h2 className="text-base font-bold text-slate-900">No invoice found</h2>
          </div>
        ) : (
          <div className="space-y-2">
            {data.invoice.notFiscalized ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
                <strong className="font-bold">NOT FISCALISED.</strong>{" "}
                {data.invoice.notFiscalized === "failed"
                  ? "This sale could not be confirmed by RRA VSDC. "
                  : "This sale has not been confirmed by RRA VSDC yet. "}
                The document below is provisional — it carries no SDC signature, receipt number or QR and is not a valid tax receipt.
              </div>
            ) : null}
            <div className="overflow-hidden rounded-xl border border-slate-300 bg-slate-200 p-2 shadow-sm sm:p-4">
              <iframe
                title={`Invoice ${data.invoice.invoiceNumber}`}
                src={pdfUrl}
                className={cn(
                  "mx-auto block min-h-[75vh] bg-white",
                  format === "80mm"
                    ? "w-full max-w-[80mm]"
                    : format === "A5"
                      ? "aspect-[148/210] w-full max-w-[148mm]"
                      : "aspect-[210/297] w-full max-w-[210mm]",
                )}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
