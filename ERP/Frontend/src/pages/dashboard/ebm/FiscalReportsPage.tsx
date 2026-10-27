import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { FileText, Download, Loader2, ScrollText, ChevronRight, CheckCircle2, AlertTriangle, RefreshCw, Database, Bell, Boxes, Truck, X, Ship, Shield, Eye } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../../components/ui/tabs";
import { RraItemClassPicker } from "../../../components/inventory/RraItemClassPicker";
import { SearchableSelect } from "../../../components/ui/SearchableSelect";
import { parseInventoryGetProductsResponse } from "../../../lib/inventory-response";
import { toast } from "react-toastify";
import { apiClient } from "../../../lib/api-client";
import { useBranch } from "../../../context/BranchContext";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "../../../components/ui/drawer";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../components/ui/tooltip";

const todayIso = () => new Date().toISOString().split("T")[0];
const daysAgoIso = (n: number) => new Date(Date.now() - n * 864e5).toISOString().split("T")[0];

/**
 * Truncate for table cells without colliding into neighbors.
 * Caps characters at `max`, and also uses CSS ellipsis inside a bounded width.
 * Full text is available on hover.
 */
function TruncatedText({
  value,
  max = 50,
  className,
}: {
  value: string | null | undefined;
  max?: number;
  className?: string;
}) {
  const full = (value ?? "").trim();
  if (!full) return <span className={className}>—</span>;
  const truncated = full.length > max;
  const display = truncated ? `${full.slice(0, max)}…` : full;
  const text = (
    <span
      className={`block min-w-0 max-w-full truncate ${className ?? ""}`}
      title={truncated ? undefined : full}
    >
      {display}
    </span>
  );
  if (!truncated) return text;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="m-0 block w-full min-w-0 max-w-full cursor-default border-0 bg-transparent p-0 text-left text-inherit"
        >
          {text}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="z-[80] max-w-xs whitespace-pre-wrap break-words">
        {full}
      </TooltipContent>
    </Tooltip>
  );
}

const formatDclDe = (raw: string | null | undefined): string => {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length >= 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return raw ?? "—";
};

const formatLastReqDt = (raw: string | null | undefined): string => {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  if (d.length >= 14) {
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)} ${d.slice(8, 10)}:${d.slice(10, 12)}:${d.slice(12, 14)}`;
  }
  if (d.length >= 8) {
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }
  return raw;
};

const money = (n: number | null | undefined) =>
  (Number(n ?? 0)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatInt = (n: number | null | undefined) => (Number(n ?? 0)).toLocaleString("en-US");

async function openPdf(fetcher: () => Promise<Response>, filename: string) {
  const res = await fetcher();
  if (!res.ok) {
    let msg = "Report generation failed";
    try {
      const j = await res.json();
      msg = j?.error ?? j?.message ?? msg;
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (!w) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

interface DailyReport {
  reportType: "X" | "Z";
  reportDate: string;
  header: { orgName: string; tin: string | null; mrcNo: string | null; sdcId: string | null; branchName: string | null };
  counters: { firstRcptNo: number | null; lastRcptNo: number | null; lastTotalRcptNo: number | null; receiptCount: number; itemCount: number };
  summary: {
    normalSalesCount: number; normalRefundsCount: number; grossSalesAmt: number; grossRefundAmt: number;
    netSalesAmt: number; totalTaxAmt: number; trainingCount: number; trainingAmt: number; copyCount: number; copyAmt: number;
    openingDeposit?: number; proformaCount?: number; proformaAmt?: number;
    discountTotal?: number; otherReductionsAmt?: number; incompleteSalesCount?: number;
  };
  taxBands: Record<string, { taxableAmt: number; taxAmt: number; salesAmt: number }>;
  taxRates: Record<string, number>;
  paymentBreakdown: Record<string, number>;
  vsdcConfirmation: { checked: boolean; rptDe?: string; error?: string } | null;
}

interface EjEntry {
  id: number;
  saleId: number | null;
  invoiceNumber: string | null;
  ebmInvoiceNumber: string | null;
  rcptLabel: string | null;
  sdcRcptNo: number | null;
  totalRcptNo: number | null;
  sdcDateTime: string | null;
  ejSent: boolean;
  journalText: string | null;
  createdAt: string;
}

function DailyReportCard() {
  const { userBranches, selectedBranchId } = useBranch();
  const [type, setType] = useState<"X" | "Z">("X");
  const [date, setDate] = useState(todayIso());
  const [branchId, setBranchId] = useState<string>(selectedBranchId ? String(selectedBranchId) : "");
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.getDailyFiscalReport({ type, date, branchId: branchId || undefined });
      setReport((res?.data ?? res) as DailyReport);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load the report");
    } finally {
      setLoading(false);
    }
  }, [type, date, branchId]);

  // Auto-load, debounced — a Z report also fires a live VSDC cross-check, so
  // wait for the operator to stop changing the filters before running it.
  useEffect(() => {
    const t = setTimeout(() => { load(); }, 500);
    return () => clearTimeout(t);
  }, [load]);

  const download = async () => {
    setDownloading(true);
    try {
      await openPdf(
        () => apiClient.getDailyFiscalReportPdf({ type, date, branchId: branchId || undefined }),
        `${type}-report-${date}.pdf`,
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to generate the PDF");
    } finally {
      setDownloading(false);
    }
  };

  const taxRows = useMemo(() => {
    if (!report) return [];
    return ["A", "B", "C", "D"]
      .map((code) => ({ code, band: report.taxBands[code] ?? { taxableAmt: 0, taxAmt: 0, salesAmt: 0 }, rate: report.taxRates[code] ?? 0 }))
      .filter(({ code, band }) => code === "B" || band.salesAmt !== 0 || band.taxAmt !== 0);
  }, [report]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-4" /> Daily X / Z report
        </CardTitle>
        <CardDescription>
          X is an interim read of the day's totals; Z is the end-of-day closing record and is cross-checked with the VSDC.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="fr-type">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as "X" | "Z")}>
              <SelectTrigger id="fr-type" className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="X">X — interim</SelectItem>
                <SelectItem value="Z">Z — closing</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="fr-date">Date</Label>
            <Input id="fr-date" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} className="w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="fr-branch">Branch</Label>
            <Select value={branchId || "all"} onValueChange={(v) => setBranchId(v === "all" ? "" : v)}>
              <SelectTrigger id="fr-branch" className="w-48"><SelectValue placeholder="All branches" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {userBranches.map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={download} disabled={downloading}>
            {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Download PDF
          </Button>
          {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>

        {type === "Z" && (
          <p className="text-xs text-muted-foreground">
            The Z cross-check with the VSDC only runs when a single branch is selected (the device is registered per branch).
          </p>
        )}

        {report && (
          <div className="grid gap-4 rounded-lg border p-4 text-sm md:grid-cols-2">
            <div className="space-y-1.5">
              <div className="text-overline uppercase tracking-wide text-muted-foreground">Counters</div>
              <Row label="First / last receipt no." value={`${report.counters.firstRcptNo ?? "—"} / ${report.counters.lastRcptNo ?? "—"}`} />
              <Row label="Total receipts (B)" value={report.counters.lastTotalRcptNo ?? "—"} />
              <Row label="Receipts this report" value={report.counters.receiptCount} />
              <Row label="Item lines sold" value={report.counters.itemCount} />
            </div>
            <div className="space-y-1.5">
              <div className="text-overline uppercase tracking-wide text-muted-foreground">Sales</div>
              <Row label={`Normal sales (${report.summary.normalSalesCount})`} value={money(report.summary.grossSalesAmt)} />
              <Row label={`Normal refunds (${report.summary.normalRefundsCount})`} value={`-${money(report.summary.grossRefundAmt)}`} />
              <Row label="Net sales" value={money(report.summary.netSalesAmt)} strong />
              <Row label="Total tax" value={money(report.summary.totalTaxAmt)} strong />
            </div>
            <div className="space-y-1.5">
              <div className="text-overline uppercase tracking-wide text-muted-foreground">Tax bands</div>
              {taxRows.map(({ code, band, rate }) => (
                <Row key={code} label={`${code} — ${rate}% (taxable / tax)`} value={`${money(band.taxableAmt)} / ${money(band.taxAmt)}`} />
              ))}
            </div>
            <div className="space-y-1.5">
              <div className="text-overline uppercase tracking-wide text-muted-foreground">Payments & non-fiscal</div>
              {Object.entries(report.paymentBreakdown).map(([m, amt]) => (
                <Row key={m} label={m} value={money(amt)} />
              ))}
              <Row label={`Training receipts (${report.summary.trainingCount})`} value={money(report.summary.trainingAmt)} />
              <Row label={`Copy receipts (${report.summary.copyCount})`} value={money(report.summary.copyAmt)} />
              <Row label="Opening deposit" value={money(report.summary.openingDeposit ?? 0)} />
              <Row label={`Proforma receipts (${report.summary.proformaCount ?? 0})`} value={money(report.summary.proformaAmt ?? 0)} />
              <Row label="All discounts" value={money(report.summary.discountTotal ?? 0)} />
              <Row label="Other reductions (voids)" value={money(report.summary.otherReductionsAmt ?? 0)} />
              <Row label="Incomplete sales" value={report.summary.incompleteSalesCount ?? 0} />
            </div>
            {report.reportType === "Z" && (
              <div className="md:col-span-2 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs">
                {report.vsdcConfirmation?.checked && !report.vsdcConfirmation.error ? (
                  <><CheckCircle2 className="size-4 text-emerald-600" /> VSDC confirmed the Z-report for {report.vsdcConfirmation.rptDe}.</>
                ) : (
                  <><AlertTriangle className="size-4 text-amber-600" /> {report.vsdcConfirmation?.error ?? "VSDC confirmation not available."}</>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{value}</span>
    </div>
  );
}

interface PluRow {
  itemCd: string; productName: string; unit: string; quantity: number;
  revenue: number; taxAmount: number; transactionCount: number;
  unitPrice: number; taxRate: number; remainingQty: number;
}

function PluCard() {
  const [start, setStart] = useState(daysAgoIso(30));
  const [end, setEnd] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<PluRow[] | null>(null);
  const [summary, setSummary] = useState<{ uniqueItemCodes: number; totalQuantity: number; totalRevenue: number; totalTax: number } | null>(null);

  const view = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.getPluReport({ startDate: start, endDate: end, limit: 500 });
      const data = (res as any)?.data ?? res;
      setRows((data?.items ?? []) as PluRow[]);
      setSummary(data?.summary ?? null);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load the PLU report");
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => {
    const t = setTimeout(() => { view(); }, 400);
    return () => clearTimeout(t);
  }, [view]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileText className="size-4" /> PLU report</CardTitle>
        <CardDescription>Quantity and revenue per item code, over a date range.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="plu-start">From</Label>
            <Input id="plu-start" type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} className="w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="plu-end">To</Label>
            <Input id="plu-end" type="date" value={end} max={todayIso()} onChange={(e) => setEnd(e.target.value)} className="w-40" />
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await openPdf(() => apiClient.getPluReportPdf({ startDate: start, endDate: end }), "PLU-report.pdf");
              } catch (e: any) {
                toast.error(e?.message ?? "Failed to generate the PLU report");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Download PDF
          </Button>
          {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>

        {rows && (
          <>
            {summary && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                <span><b className="text-foreground tabular-nums">{summary.uniqueItemCodes}</b> item codes</span>
                <span><b className="text-foreground tabular-nums">{formatInt(summary.totalQuantity)}</b> units</span>
                <span><b className="text-foreground tabular-nums">{money(summary.totalRevenue)}</b> revenue</span>
                <span><b className="text-foreground tabular-nums">{money(summary.totalTax)}</b> tax</span>
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item code</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="text-right">Tax rate</TableHead>
                    <TableHead className="text-right">Qty sold</TableHead>
                    <TableHead className="text-right">In stock</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">No sales in this period.</TableCell></TableRow>
                  )}
                  {rows.map((r) => (
                    <TableRow key={r.itemCd}>
                      <TableCell className="font-mono text-xs">{r.itemCd}</TableCell>
                      <TableCell>{r.productName}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.unitPrice ?? 0)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.taxRate ?? 0}%</TableCell>
                      <TableCell className="text-right tabular-nums">{formatInt(r.quantity)} {r.unit}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatInt(r.remainingQty ?? 0)} {r.unit}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.revenue)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(r.taxAmount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ElectronicJournalCard() {
  const [start, setStart] = useState(daysAgoIso(7));
  const [end, setEnd] = useState(todayIso());
  const [entries, setEntries] = useState<EjEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<{ entry: EjEntry; detail: any } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.getElectronicJournal({ startDate: start, endDate: end, limit: 100 });
      const data = res?.data ?? res;
      setEntries((data?.entries ?? []) as EjEntry[]);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load the electronic journal");
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => { load(); }, [load]);

  const openEntry = async (entry: EjEntry) => {
    if (entry.saleId == null) return;
    setDetailLoading(true);
    setSelected({ entry, detail: null });
    try {
      const res = await apiClient.getElectronicJournalEntry(entry.saleId);
      setSelected({ entry, detail: res?.data ?? res });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load the journal entry");
      setSelected(null);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ScrollText className="size-4" /> Electronic journal</CardTitle>
        <CardDescription>
          The journal is issued with every fiscal receipt and holds the same data as the printed slip — open an entry to compare them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="ej-start">From</Label>
            <Input id="ej-start" type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} className="w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ej-end">To</Label>
            <Input id="ej-end" type="date" value={end} max={todayIso()} onChange={(e) => setEnd(e.target.value)} className="w-40" />
          </div>
          <Button onClick={load} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <ScrollText className="size-4" />} Refresh
          </Button>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date / time</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Receipt no.</TableHead>
                <TableHead className="text-center">EJ sent</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No journal entries for this period.</TableCell></TableRow>
              )}
              {entries.map((e) => (
                <TableRow key={e.id} className="cursor-pointer" onClick={() => openEntry(e)}>
                  <TableCell className="whitespace-nowrap">{e.sdcDateTime ? new Date(e.sdcDateTime).toLocaleString() : new Date(e.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{e.invoiceNumber ?? e.ebmInvoiceNumber ?? "—"}</TableCell>
                  <TableCell>{e.rcptLabel ?? "NS"}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.sdcRcptNo ?? "—"} / {e.totalRcptNo ?? "—"}</TableCell>
                  <TableCell className="text-center">{e.ejSent ? <CheckCircle2 className="mx-auto size-4 text-emerald-600" /> : <AlertTriangle className="mx-auto size-4 text-amber-600" />}</TableCell>
                  <TableCell className="text-right"><ChevronRight className="size-4 text-muted-foreground" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Electronic journal — {selected?.entry.invoiceNumber ?? selected?.entry.saleId}</DialogTitle>
          </DialogHeader>
          {detailLoading || !selected?.detail ? (
            <div className="flex justify-center py-10"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 text-overline uppercase tracking-wide text-muted-foreground">Journal (EJ_DATA)</div>
                <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed">{selected.detail.journal?.text}</pre>
              </div>
              <div>
                <div className="mb-1 text-overline uppercase tracking-wide text-muted-foreground">Printed slip</div>
                <div className="max-h-80 space-y-1 overflow-auto rounded-md border p-3 text-xs">
                  {(selected.detail.slip?.items ?? []).map((it: any, i: number) => (
                    <div key={i} className="flex justify-between gap-3">
                      <span>{it.name} ×{it.quantity} [{it.taxCode ?? "A"}]</span>
                      <span className="tabular-nums">{money(it.totalPrice)}</span>
                    </div>
                  ))}
                  <div className="mt-2 flex justify-between border-t pt-2 font-semibold">
                    <span>TOTAL</span><span className="tabular-nums">{money(selected.detail.slip?.totalAmount)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>VAT</span><span className="tabular-nums">{money(selected.detail.slip?.vatAmount)}</span>
                  </div>
                </div>
                <div className={`mt-2 flex items-center gap-2 rounded-md px-3 py-2 text-xs ${selected.detail.checks?.journalTotalMatchesSlip ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"}`}>
                  {selected.detail.checks?.journalTotalMatchesSlip
                    ? <><CheckCircle2 className="size-4" /> Journal total matches the printed slip.</>
                    : <><AlertTriangle className="size-4" /> Could not confirm the journal total against the slip.</>}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

interface MasterDataStatus {
  counts: { codes: number; itemClasses: number; notices: number; unreadNotices: number };
  cursors: Array<{ resource: string; lastRunAt: string | null; lastResult: string | null }>;
}
interface RraNotice {
  id: number; noticeNo: number; title: string | null; cont: string | null; dtlUrl: string | null;
  regrNm: string | null; regDt: string | null; readAt: string | null;
}

interface ReconcileDetails {
  rraOnly: Array<{ itemCd: string; itemNm?: string; itemClsCd?: string; taxTyCd?: string }>;
  localOnly: Array<{ id: number; name: string; itemCd: string | null; ebmSyncStatus: string | null }>;
  mismatched: Array<{ productId: number; productName: string; itemCd: string; field: string; rra: string | number | null; local: string | number | null }>;
}

function MasterDataCard() {
  const [status, setStatus] = useState<MasterDataStatus | null>(null);
  const [notices, setNotices] = useState<RraNotice[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, n] = await Promise.all([apiClient.getRraMasterDataStatus(), apiClient.listRraNotices()]);
      setStatus(((s as any)?.data ?? s) as MasterDataStatus);
      setNotices((((n as any)?.data ?? n)?.notices ?? []) as RraNotice[]);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load RRA master-data status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const syncAll = async () => {
    setSyncing(true);
    try {
      await apiClient.syncAllRraMasterData();
      toast.success("Synced codes, classifications and notices from RRA");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "RRA sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const [reconciling, setReconciling] = useState(false);
  const [diff, setDiff] = useState<ReconcileDetails | null>(null);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const reconcile = async () => {
    setReconciling(true);
    setDiff(null);
    try {
      const res = await apiClient.reconcileRraItems();
      const out = (res as any)?.data ?? res;
      setDiff(out?.details ?? null);
      toast.success(`Pulled ${out?.pulled ?? 0} item(s) from RRA`);
    } catch (e: any) {
      toast.error(e?.message ?? "Item reconciliation failed");
    } finally {
      setReconciling(false);
    }
  };

  /** Register a local product with RRA — optionally applying RRA's value on a mismatch first. */
  const pushProduct = async (productId: number, label: string, overrides?: { itemClsCd?: string; taxCode?: string }) => {
    setRowBusy(productId);
    try {
      await apiClient.syncOneProductToRra(productId, overrides ?? {});
      toast.success(`"${label}" registered with RRA`);
      setDiff((d) => d && ({
        ...d,
        localOnly: d.localOnly.filter((x) => x.id !== productId),
        mismatched: d.mismatched.filter((x) => x.productId !== productId),
      }));
    } catch (e: any) {
      toast.error(e?.message ?? "Product sync failed");
    } finally {
      setRowBusy(null);
    }
  };

  const markRead = async (noticeNo: number) => {
    try {
      await apiClient.markRraNoticeRead(noticeNo);
      setNotices((prev) => prev.map((x) => (x.noticeNo === noticeNo ? { ...x, readAt: new Date().toISOString() } : x)));
      setStatus((s) => (s ? { ...s, counts: { ...s.counts, unreadNotices: Math.max(0, s.counts.unreadNotices - 1) } } : s));
    } catch { /* ignore */ }
  };

  const c = status?.counts;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Database className="size-4" /> RRA master data</CardTitle>
        <CardDescription>
          Codes, item classifications (UNSPSC) and notices — pulled from the VSDC and cached locally. Syncs nightly; run it on demand here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={syncAll} disabled={syncing}>
            {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Sync now
          </Button>
          <Button variant="outline" onClick={reconcile} disabled={reconciling}>
            {reconciling ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />} Reconcile items with RRA
          </Button>
          <Button
            variant="outline"
            disabled={syncing}
            onClick={async () => {
              setSyncing(true);
              try {
                const res = await apiClient.syncRraBranches();
                const out = (res as any)?.data ?? res;
                toast.success(`Branches: ${out?.fetched ?? 0} from RRA, ${out?.matched ?? 0} matched locally`);
                await load();
              } catch (e: any) {
                toast.error(e?.message ?? "Branch sync failed");
              } finally {
                setSyncing(false);
              }
            }}
          >
            Sync branches
          </Button>
          {loading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : c ? (
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
              <span><b className="text-foreground tabular-nums">{c.codes}</b> codes</span>
              <span><b className="text-foreground tabular-nums">{c.itemClasses}</b> classifications</span>
              <span><b className="text-foreground tabular-nums">{c.notices}</b> notices ({c.unreadNotices} unread)</span>
            </div>
          ) : null}
        </div>

        {diff && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              <b className="text-foreground">{diff.localOnly.length}</b> local item(s) not yet at RRA ·{" "}
              <b className="text-foreground">{diff.mismatched.length}</b> mismatch(es) ·{" "}
              <b className="text-foreground">{diff.rraOnly.length}</b> at RRA only
            </p>
            {diff.localOnly.length + diff.mismatched.length + diff.rraOnly.length === 0 ? (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                Everything is in sync with RRA.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Item code</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {diff.localOnly.map((it) => (
                      <TableRow key={`l-${it.id}`}>
                        <TableCell>{it.name}</TableCell>
                        <TableCell className="font-mono text-xs">{it.itemCd ?? "—"}</TableCell>
                        <TableCell>
                          <span className={it.ebmSyncStatus === "FAILED" ? "text-red-600" : "text-amber-600"}>
                            {it.ebmSyncStatus === "FAILED" ? "Sync failed" : "Not at RRA"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" disabled={rowBusy === it.id} onClick={() => pushProduct(it.id, it.name)}>
                            {rowBusy === it.id ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Sync to RRA
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {diff.mismatched.map((m, i) => (
                      <TableRow key={`m-${m.productId}-${m.field}-${i}`}>
                        <TableCell>{m.productName}</TableCell>
                        <TableCell className="font-mono text-xs">{m.itemCd}</TableCell>
                        <TableCell className="text-amber-600">
                          {m.field}: <span className="font-mono">{String(m.local ?? "—")}</span> → RRA <span className="font-mono">{String(m.rra ?? "—")}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={rowBusy === m.productId}
                            onClick={() => pushProduct(m.productId, m.productName, m.field === "itemClsCd"
                              ? { itemClsCd: String(m.rra ?? "") }
                              : { taxCode: String(m.rra ?? "") })}
                          >
                            {rowBusy === m.productId ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />} Use RRA value
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {diff.rraOnly.map((it) => (
                      <TableRow key={`r-${it.itemCd}`}>
                        <TableCell>{it.itemNm ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{it.itemCd}</TableCell>
                        <TableCell className="text-muted-foreground">At RRA only — add it to the catalog manually</TableCell>
                        <TableCell />
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {notices.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-overline uppercase tracking-wide text-muted-foreground">
              <Bell className="size-3.5" /> Notices
            </div>
            <div className="divide-y rounded-lg border">
              {notices.slice(0, 8).map((n) => (
                <div key={n.id} className={`flex items-start justify-between gap-3 p-3 text-sm ${n.readAt ? "" : "bg-muted/40"}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {!n.readAt && <span className="size-2 shrink-0 rounded-full bg-blue-600" />}
                      <span className="font-medium">#{n.noticeNo} — {n.title ?? "(untitled)"}</span>
                    </div>
                    {n.cont && <p className="mt-0.5 line-clamp-2 text-muted-foreground">{n.cont}</p>}
                    <p className="mt-0.5 text-xs text-muted-foreground">{n.regDt ?? ""}{n.regrNm ? ` · ${n.regrNm}` : ""}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {n.dtlUrl && (
                      <a href={n.dtlUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">Open</a>
                    )}
                    {!n.readAt && (
                      <button type="button" onClick={() => markRead(n.noticeNo)} className="text-xs text-muted-foreground hover:text-foreground">Mark read</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface CatalogProduct {
  id: number;
  name: string;
  itemCd?: string | null;
  sku?: string | null;
  unitPrice?: number | string | null;
  itemType?: string | null;
}

const priceOf = (p?: CatalogProduct) => (p?.unitPrice != null ? String(Number(p.unitPrice)) : "");

function unwrapApiData(res: unknown): any {
  let cur: any = res;
  if (cur?.success === true && cur.data != null) cur = cur.data;
  // Some proxies double-wrap: { success, data: { data: {...} } }.
  // Do not unwrap again when this already looks like a stock-status payload.
  const looksLikeDomainPayload =
    cur?.counts != null
    || Array.isArray(cur?.pending)
    || Array.isArray(cur?.failures)
    || cur?.imports != null;
  if (
    !looksLikeDomainPayload
    && cur?.data != null
    && typeof cur.data === "object"
    && !Array.isArray(cur.data)
  ) {
    cur = cur.data;
  }
  return cur;
}

type StockLedgerRow = {
  id: number;
  movementType: string;
  quantity: number;
  direction: string;
  reference?: string | null;
  referenceType?: string | null;
  ebmError?: string | null;
  ebmSyncStatus?: string | null;
  createdAt: string;
  product?: { name?: string | null; itemCd?: string | null } | null;
};

function stockPendingReason(row: StockLedgerRow): string {
  if (row.movementType === "SALE") {
    return row.reference
      ? `Waiting for sale ${row.reference} to be fiscalized`
      : "Waiting for the linked sale to be fiscalized";
  }
  return row.ebmError?.trim() || "Queued for VSDC";
}

function StockSyncCard() {
  const [stock, setStock] = useState<{
    counts: Record<string, number>;
    failures: StockLedgerRow[];
    pending?: StockLedgerRow[];
  } | null>(null);
  const [busy, setBusy] = useState<null | "stock" | "moves">(null);

  const load = useCallback(async () => {
    try {
      const s = await apiClient.getRraStockStatus();
      const stockData = unwrapApiData(s);
      setStock({
        counts: (stockData?.counts && typeof stockData.counts === "object") ? stockData.counts : {},
        failures: Array.isArray(stockData?.failures) ? stockData.failures : [],
        pending: Array.isArray(stockData?.pending) ? stockData.pending : [],
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load stock status");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const syncStock = async () => {
    setBusy("stock");
    try {
      const res = await apiClient.syncRraStock();
      const out = (res as any)?.data ?? res;
      toast.success(
        `Stock sync: ${out?.succeeded ?? 0} sent, ${out?.failed ?? 0} failed`
          + (out?.deferred ? `, ${out.deferred} waiting for their sale invoice` : ""),
      );
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Stock sync failed");
    } finally { setBusy(null); }
  };

  const syncStockMoves = async () => {
    setBusy("moves");
    try {
      const res = await apiClient.syncRraStockMoves();
      const out = (res as any)?.data ?? res;
      toast.success(`Pulled ${out?.fetched ?? 0} stock movement(s) from RRA — ${out?.applied ?? 0} line(s) added to stock`);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Stock-move pull failed");
    } finally { setBusy(null); }
  };

  const sc = stock?.counts ?? {};

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Boxes className="size-4" /> Stock sync</CardTitle>
        <CardDescription>
          Every stock movement, sales included, is reported to the VSDC as stock in/out.
          B2B purchases are managed under <span className="font-medium text-foreground">Purchases</span> in the sidebar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={syncStock} disabled={busy === "stock"}>
            {busy === "stock" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Sync stock now
          </Button>
          <Button variant="outline" onClick={syncStockMoves} disabled={busy === "moves"}>
            {busy === "moves" ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />} Pull stock moves
          </Button>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span title="Inventory ledger rows waiting to be sent to VSDC">
              <b className="text-amber-600 tabular-nums">{sc.PENDING ?? 0}</b> pending sync
            </span>
            <span><b className="text-emerald-600 tabular-nums">{sc.SYNCED ?? 0}</b> synced</span>
            <span><b className="text-amber-600 tabular-nums">{sc.FAILED ?? 0}</b> failed</span>
          </div>
        </div>

        {(sc.PENDING ?? 0) > 0 ? (
          <div className="space-y-2">
            <div className="text-sm font-medium text-amber-800 dark:text-amber-300">
              Pending stock sync ({sc.PENDING}) — SALE rows wait until their invoice is fiscalized; other rows send when you press “Sync stock now”
            </div>
            {(stock?.pending?.length ?? 0) > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-amber-200 dark:border-amber-900/50">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead>When</TableHead>
                      <TableHead>Why waiting</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(stock?.pending ?? []).map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">
                          <div>{row.product?.name ?? `#${row.id}`}</div>
                          {row.product?.itemCd ? (
                            <div className="font-mono text-[10px] text-muted-foreground">{row.product.itemCd}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>{row.movementType}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.direction === "OUT" ? "−" : "+"}
                          {formatInt(Number(row.quantity))}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                          {new Date(row.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="max-w-[18rem] text-sm text-amber-700 dark:text-amber-400">
                          {stockPendingReason(row)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-400">
                {sc.PENDING} ledger row(s) are PENDING, but details could not be loaded. Refresh the page or press “Sync stock now”.
              </p>
            )}
          </div>
        ) : null}

        {stock?.failures?.length ? (
          <div className="max-h-48 space-y-1 overflow-auto rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
            <div className="font-medium">Stock movements RRA rejected ({sc.FAILED ?? stock.failures.length}) — fix the cause, then press “Sync stock now”:</div>
            {stock.failures.map((f) => (
              <div key={f.id}>
                <span className="font-medium">{f.product?.name ?? `#${f.id}`}</span>
                {" · "}{f.movementType} {f.direction === "OUT" ? "−" : "+"}{formatInt(Number(f.quantity))}
                {" · "}{new Date(f.createdAt).toLocaleString()} — {f.ebmError}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

type RraImportStatus = "PENDING" | "APPROVED" | "REJECTED";
type RraImportStatusFilter = "ALL" | RraImportStatus;

interface RraImport {
  id: number;
  taskCd: string;
  dclNo: string | null;
  dclDe: string;
  itemSeq: number;
  hsCd: string | null;
  itemNm: string | null;
  orgnNatCd: string | null;
  exptNatCd: string | null;
  spplrNm: string | null;
  agntNm: string | null;
  pkg: string | number | null;
  pkgUnitCd: string | null;
  qty: string | number | null;
  qtyUnitCd: string | null;
  totWt: string | number | null;
  netWt: string | number | null;
  invcFcurAmt: string | number | null;
  invcFcurCd: string | null;
  invcFcurExcrt: string | number | null;
  itemCd: string | null;
  itemClsCd: string | null;
  status: RraImportStatus;
  remark: string | null;
  actionedAt: string | null;
  linkedProductId: number | null;
}

function ImportDetailRows({ line }: { line: RraImport }) {
  const qty = line.qty != null ? `${Number(line.qty).toLocaleString()} ${line.qtyUnitCd ?? ""}`.trim() : "—";
  const pkg = line.pkg != null ? `${Number(line.pkg).toLocaleString()} ${line.pkgUnitCd ?? ""}`.trim() : "—";
  const invoice = line.invcFcurAmt != null
    ? `${Number(line.invcFcurAmt).toLocaleString()} ${line.invcFcurCd ?? ""}`.trim()
    : "—";
  const rows: Array<{ label: string; value: ReactNode; wide?: boolean }> = [
    { label: "Declaration no.", value: line.dclNo ?? "—" },
    { label: "Declaration date", value: formatDclDe(line.dclDe) },
    { label: "Task code", value: <span className="font-mono text-xs">{line.taskCd}</span> },
    { label: "Line", value: line.itemSeq },
    { label: "Supplier", value: line.spplrNm?.trim() || "—", wide: true },
    { label: "Agent", value: line.agntNm?.trim() || "—", wide: true },
    { label: "Item name", value: line.itemNm?.trim() || "—", wide: true },
    { label: "HS code", value: <span className="font-mono text-xs">{line.hsCd ?? "—"}</span> },
    { label: "Origin nation", value: line.orgnNatCd ?? "—" },
    { label: "Export nation", value: line.exptNatCd ?? "—" },
    { label: "Quantity", value: qty },
    { label: "Package", value: pkg },
    { label: "Total weight", value: line.totWt != null ? Number(line.totWt).toLocaleString() : "—" },
    { label: "Net weight", value: line.netWt != null ? Number(line.netWt).toLocaleString() : "—" },
    { label: "Invoice amount", value: invoice },
    { label: "Exchange rate", value: line.invcFcurExcrt != null ? Number(line.invcFcurExcrt).toLocaleString() : "—" },
    { label: "Item code", value: <span className="font-mono text-xs">{line.itemCd ?? "—"}</span> },
    { label: "Item class", value: <span className="font-mono text-xs">{line.itemClsCd ?? "—"}</span> },
    { label: "Status", value: line.status },
    { label: "Actioned at", value: line.actionedAt ? new Date(line.actionedAt).toLocaleString() : "—" },
    { label: "Remark", value: line.remark?.trim() || "—", wide: true },
  ];
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      {rows.map((r) => (
        <div key={r.label} className={r.wide ? "col-span-2" : undefined}>
          <div className="text-xs text-muted-foreground">{r.label}</div>
          <div className="break-words">{r.value}</div>
        </div>
      ))}
    </div>
  );
}

function ImportDeclarationsCard() {
  const [imports, setImports] = useState<RraImport[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState<RraImportStatusFilter>("PENDING");
  const [lastReq, setLastReq] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<RraImport | null>(null);
  const [action, setAction] = useState<null | { line: RraImport; kind: "approve" | "reject" }>(null);
  const [clsCd, setClsCd] = useState("");
  const [remark, setRemark] = useState("");
  const [rowBusy, setRowBusy] = useState(false);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [linkProductId, setLinkProductId] = useState("__new__");
  const [itemNm, setItemNm] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiClient.listRraImports(statusFilter === "ALL" ? undefined : statusFilter);
      const data = (res as any)?.data ?? res;
      setImports((data?.imports ?? []) as RraImport[]);
      setPendingCount(Number(data?.pending ?? 0));
      setLastReq(data?.lastRequestDate ?? null);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load import declarations");
    }
  }, [statusFilter]);
  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setBusy(true);
    try {
      const res = await apiClient.syncRraImports();
      const out = (res as any)?.data ?? res;
      const pulled = Number(out?.cached ?? 0);
      toast.success(`Pulled ${pulled} import line(s) from RRA`);
      await load();
      if (out?.lastReqDt) setLastReq(String(out.lastReqDt));
    } catch (e: any) {
      toast.error(e?.message ?? "Import pull failed");
    } finally { setBusy(false); }
  };

  const openAction = (line: RraImport, kind: "approve" | "reject") => {
    setAction({ line, kind });
    setClsCd(line.itemClsCd ?? "");
    setRemark("");
    setLinkProductId("__new__");
    setItemNm(line.itemNm ?? "");
    setSellingPrice("");
    setExpiryDate("");
    if (kind === "approve") {
      apiClient.getProducts({ page: 1, limit: 500 })
        .then((res) => {
          const items = parseInventoryGetProductsResponse(res).items as CatalogProduct[];
          setCatalog(items);
          const nm = (line.itemNm ?? "").trim().toLowerCase();
          const match = nm ? items.find((p) => p.name.trim().toLowerCase() === nm) : undefined;
          if (match) {
            setLinkProductId(String(match.id));
            setSellingPrice(priceOf(match));
            setItemNm(match.name);
          }
        })
        .catch(() => setCatalog([]));
    }
  };

  const submitAction = async () => {
    if (!action) return;
    const approve = action.kind === "approve";
    const createNew = linkProductId === "__new__";
    const linkId = createNew ? NaN : Number(linkProductId);
    const price = Number(sellingPrice);
    if (approve && !clsCd && createNew && !action.line.itemClsCd) {
      toast.error("Pick an RRA item classification to create the product");
      return;
    }
    if (approve && !action.line.hsCd?.trim()) {
      toast.error("This declaration has no HS code from RRA — it cannot be approved");
      return;
    }
    setRowBusy(true);
    try {
      const res = await apiClient.actionRraImport(action.line.id, action.kind, {
        itemClsCd: approve ? clsCd || undefined : undefined,
        remark: remark || undefined,
        linkProductId: approve && linkId > 0 ? linkId : undefined,
        createProduct: approve && createNew ? true : undefined,
        itemNm: approve && createNew ? (itemNm.trim() || undefined) : undefined,
        sellingPrice: approve && price > 0 ? price : undefined,
        expiryDate: approve && expiryDate ? expiryDate : undefined,
      });
      const out = (res as any)?.data ?? res;
      if (out?.warning) toast.warn(String(out.warning));
      else toast.success(action.kind === "approve" ? "Import line approved with RRA" : "Import line rejected");
      setAction(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Action failed");
    } finally { setRowBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Ship className="size-4" /> Import declarations</CardTitle>
        <CardDescription>
          Import declaration lines pulled from RRA. Classify and approve or reject each one — an approval books the stock-in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={sync} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Pull from RRA
          </Button>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as RraImportStatusFilter)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="PENDING">Pending{pendingCount > 0 ? ` (${pendingCount})` : ""}</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="inline-flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm text-sky-950">
            <span className="text-xs font-semibold uppercase tracking-wide text-sky-700">Last request</span>
            <span className="font-mono font-semibold tabular-nums">
              {lastReq ? formatLastReqDt(lastReq) : "—"}
            </span>
          </div>
          <div className="text-sm text-muted-foreground">
            Showing <b className="text-foreground tabular-nums">{imports.length}</b>
            {statusFilter !== "ALL" ? ` ${statusFilter.toLowerCase()}` : ""} line(s)
            {pendingCount > 0 && statusFilter !== "PENDING" ? (
              <> · <b className="text-amber-600 tabular-nums">{pendingCount}</b> pending overall</>
            ) : null}
          </div>
        </div>

        <TooltipProvider>
          <div className="overflow-x-auto rounded-lg border">
            <Table className="table-fixed w-full min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[9.5rem]">Declaration</TableHead>
                  <TableHead className="w-[14rem]">Supplier</TableHead>
                  <TableHead className="w-[14rem]">Item</TableHead>
                  <TableHead className="w-[7rem] text-right">Qty</TableHead>
                  <TableHead className="w-[8rem] text-right">Invoice</TableHead>
                  <TableHead className="w-[6.5rem]">Status</TableHead>
                  <TableHead className="w-[13rem] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {imports.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                      {statusFilter === "ALL"
                        ? "No import declarations pulled from RRA."
                        : `No ${statusFilter.toLowerCase()} import lines.`}
                    </TableCell>
                  </TableRow>
                )}
                {imports.map((im) => (
                  <TableRow key={im.id}>
                    <TableCell className="overflow-hidden whitespace-nowrap font-mono text-xs">
                      <div className="truncate">{im.dclNo ?? im.taskCd}</div>
                      <div className="truncate text-muted-foreground">{formatDclDe(im.dclDe)} · line {im.itemSeq}</div>
                    </TableCell>
                    <TableCell className="overflow-hidden">
                      <div className="min-w-0 max-w-full">
                        <TruncatedText value={im.spplrNm} max={50} />
                      </div>
                    </TableCell>
                    <TableCell className="overflow-hidden">
                      <div className="min-w-0 max-w-full">
                        <TruncatedText value={im.itemNm} max={50} />
                      </div>
                    </TableCell>
                    <TableCell className="overflow-hidden text-right tabular-nums whitespace-nowrap">
                      <span className="block truncate">
                        {im.qty != null ? `${Number(im.qty).toLocaleString()} ${im.qtyUnitCd ?? ""}`.trim() : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="overflow-hidden text-right tabular-nums whitespace-nowrap">
                      <span className="block truncate">
                        {im.invcFcurAmt != null
                          ? `${Number(im.invcFcurAmt).toLocaleString()} ${im.invcFcurCd ?? ""}`.trim()
                          : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="overflow-hidden">
                      <span className={im.status === "APPROVED" ? "text-emerald-600" : im.status === "REJECTED" ? "text-muted-foreground" : "text-amber-600"}>
                        {im.status}
                      </span>
                    </TableCell>
                    <TableCell className="overflow-hidden text-right">
                      <div className="flex flex-nowrap justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setDetail(im)}>
                          <Eye className="size-3.5" /> View details
                        </Button>
                        {im.status === "PENDING" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => openAction(im, "approve")}>
                              <CheckCircle2 className="size-3.5" /> Approve
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openAction(im, "reject")}>
                              <X className="size-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TooltipProvider>
      </CardContent>

      <Drawer open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DrawerContent className="sm:max-w-lg">
          <DrawerHeader className="px-0 pt-0">
            <DrawerTitle>Import line details</DrawerTitle>
          </DrawerHeader>
          {detail && (
            <div className="space-y-4">
              <ImportDetailRows line={detail} />
              {detail.status === "PENDING" && (
                <div className="flex justify-end gap-2 border-t pt-3">
                  <Button variant="ghost" onClick={() => { setDetail(null); openAction(detail, "reject"); }}>
                    <X className="size-4" /> Reject
                  </Button>
                  <Button onClick={() => { setDetail(null); openAction(detail, "approve"); }}>
                    <CheckCircle2 className="size-4" /> Approve
                  </Button>
                </div>
              )}
            </div>
          )}
        </DrawerContent>
      </Drawer>

      <Dialog open={!!action} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{action?.kind === "approve" ? "Approve import line" : "Reject import line"}</DialogTitle>
          </DialogHeader>
          {action && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {action.kind === "approve" ? "Approve" : "Reject"}{" "}
                <span className="font-medium text-foreground">{action.line.itemNm?.trim() || "this line"}</span>
                {" "}({action.line.dclNo ?? action.line.taskCd}, line {action.line.itemSeq}).
              </p>
              {action.kind === "approve" && (
                <>
                  {!action.line.hsCd?.trim() && (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-400">
                      This line has no HS code from RRA. Approval is blocked until RRA supplies one.
                    </p>
                  )}
                  <RraItemClassPicker
                    value={clsCd}
                    onChange={setClsCd}
                    required={linkProductId === "__new__" && !action.line.itemClsCd}
                  />
                  {linkProductId !== "__new__" && !clsCd && (
                    <p className="text-xs text-muted-foreground">Left empty, the receiving product&apos;s RRA classification is used.</p>
                  )}
                  <div className="space-y-1.5">
                    <Label>Receive into product</Label>
                    <SearchableSelect
                      value={linkProductId}
                      onChange={(value) => {
                        setLinkProductId(value);
                        const prod = catalog.find((p) => String(p.id) === value);
                        if (prod) {
                          setSellingPrice(priceOf(prod));
                          setItemNm(prod.name);
                        } else if (value === "__new__") {
                          setItemNm(action.line.itemNm ?? "");
                        }
                      }}
                      placeholder="Create as a new product"
                      searchPlaceholder="Search your products..."
                      emptyText="No matching products."
                      options={[
                        { value: "__new__", label: "Create as a new product", emphasized: true },
                        ...catalog.filter((p) => p.itemType !== "SERVICE").map((p) => ({
                          value: String(p.id),
                          label: p.name,
                          sublabel: p.itemCd ?? p.sku ?? undefined,
                        })),
                      ]}
                    />
                  </div>
                  {linkProductId === "__new__" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="imp-item-nm">Name in your inventory</Label>
                      <Input
                        id="imp-item-nm"
                        value={itemNm}
                        onChange={(e) => setItemNm(e.target.value)}
                        placeholder={action.line.itemNm ?? "Imported item"}
                      />
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="imp-sell-price">Selling price</Label>
                      <Input
                        id="imp-sell-price"
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={sellingPrice}
                        onChange={(e) => setSellingPrice(e.target.value)}
                        placeholder="Set selling price"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="imp-expiry">Expiry date <span className="text-muted-foreground">(optional)</span></Label>
                      <Input id="imp-expiry" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
                    </div>
                  </div>
                </>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="imp-remark">Remark <span className="text-muted-foreground">(optional)</span></Label>
                <Input id="imp-remark" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Reason / note" />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setAction(null)}>Cancel</Button>
                <Button onClick={submitAction} disabled={rowBusy}>
                  {rowBusy ? <Loader2 className="size-4 animate-spin" /> : action.kind === "approve" ? <CheckCircle2 className="size-4" /> : <X className="size-4" />}
                  {action.kind === "approve" ? "Approve with RRA" : "Reject"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function PurchasesImportDetailReportCard() {
  const [start, setStart] = useState(daysAgoIso(30));
  const [end, setEnd] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<any>(null);

  const load = async () => {
    setBusy(true);
    try {
      const res = await apiClient.getPurchasesReport({ startDate: start, endDate: end });
      setData((res as any)?.data ?? res);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load purchases / importation report");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = data?.summary;
  const importation = data?.importation;
  const orders = (data?.orders ?? []) as any[];
  const importItems = (importation?.items ?? []) as any[];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Truck className="size-4" /> Purchases &amp; importation</CardTitle>
        <CardDescription>
          Detailed purchases and importation report (RRA checklist §25) — local purchase orders plus RRA import declaration lines.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-40" />
          </div>
          <Button onClick={load} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Load report
          </Button>
        </div>

        {summary && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <span><b className="text-foreground tabular-nums">{summary.orderCount ?? 0}</b> purchase orders</span>
            <span><b className="text-foreground tabular-nums">{money(summary.totalPurchases)}</b> total</span>
            <span><b className="text-foreground tabular-nums">{money(summary.totalTax)}</b> tax</span>
            {importation?.summary && (
              <>
                <span><b className="text-foreground tabular-nums">{importation.summary.lines ?? 0}</b> import lines</span>
                <span className="text-amber-600"><b className="tabular-nums">{importation.summary.PENDING ?? 0}</b> pending</span>
                <span className="text-emerald-600"><b className="tabular-nums">{importation.summary.APPROVED ?? 0}</b> approved</span>
              </>
            )}
          </div>
        )}

        <div className="space-y-2">
          <div className="text-overline uppercase tracking-wide text-muted-foreground">Purchase orders</div>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Ordered</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No purchase orders in this range.</TableCell></TableRow>
                )}
                {orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-xs">{o.orderNumber}</TableCell>
                    <TableCell>{o.supplierName || "—"}</TableCell>
                    <TableCell>{o.orderedAt}</TableCell>
                    <TableCell>{o.status}</TableCell>
                    <TableCell className="text-right tabular-nums">{o.itemCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(o.totalAmount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-overline uppercase tracking-wide text-muted-foreground">Importation</div>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Declaration</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>HS</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {importItems.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No import declaration lines in this range.</TableCell></TableRow>
                )}
                {importItems.map((i, idx) => (
                  <TableRow key={`${i.taskCd}-${i.dclDe}-${i.itemSeq}-${idx}`}>
                    <TableCell className="font-mono text-xs">{i.dclNo ?? i.taskCd}<span className="text-muted-foreground"> · {i.dclDe}</span></TableCell>
                    <TableCell>{i.supplier || "—"}</TableCell>
                    <TableCell>{i.itemNm ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{i.hsCd ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.qty != null ? Number(i.qty) : "—"}</TableCell>
                    <TableCell>
                      <span className={i.status === "APPROVED" ? "text-emerald-600" : i.status === "REJECTED" ? "text-muted-foreground" : "text-amber-600"}>{i.status}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AuditorOverviewCard() {
  const { selectedBranchId } = useBranch();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.getRraAuditOverview(selectedBranchId ?? undefined);
      setData((res as any)?.data ?? res);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load auditor overview");
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId]);

  useEffect(() => { load(); }, [load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="size-4" /> Auditor overview
        </CardTitle>
        <CardDescription>
          CIS §7.26 — software settings, device registration, sync cursors, and outbox health for competent auditors.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh
        </Button>
        {data && (
          <div className="grid gap-4 text-sm md:grid-cols-2">
            <div className="space-y-1.5 rounded-lg border p-3">
              <div className="text-overline uppercase tracking-wide text-muted-foreground">CIS software</div>
              <Row label="App" value={data.cis?.appName ?? "—"} />
              <Row label="EBM enabled" value={data.cis?.ebmEnabled ? "Yes" : "No"} />
              <Row label="Protocol" value={data.cis?.ebmProtocol ?? "—"} />
              <Row label="Environment" value={data.cis?.environment ?? "—"} />
              <Row label="VSDC timeout (ms)" value={data.cis?.requestTimeoutMs ?? "—"} />
            </div>
            <div className="space-y-1.5 rounded-lg border p-3">
              <div className="text-overline uppercase tracking-wide text-muted-foreground">Organization</div>
              <Row label="Name" value={data.organization?.name ?? "—"} />
              <Row label="TIN" value={data.organization?.TIN ?? "—"} />
              <Row label="Training mode" value={data.organization?.trainingMode ? "On" : "Off"} />
              <Row label="Last VSDC contact" value={data.organization?.lastSuccessfulVdsContact ? new Date(data.organization.lastSuccessfulVdsContact).toLocaleString() : "—"} />
              <Row label="VAT registered" value={data.settings?.vatRegistered ? "Yes" : "No"} />
            </div>
            <div className="space-y-1.5 rounded-lg border p-3 md:col-span-2">
              <div className="text-overline uppercase tracking-wide text-muted-foreground">Branches / devices</div>
              {(data.branches ?? []).length === 0 ? (
                <p className="text-muted-foreground">No active branches.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Branch</TableHead>
                      <TableHead>bhfId</TableHead>
                      <TableHead>SDC</TableHead>
                      <TableHead>MRC</TableHead>
                      <TableHead>Initialized</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data.branches ?? []).map((b: any) => (
                      <TableRow key={b.id}>
                        <TableCell>{b.name}</TableCell>
                        <TableCell>{b.bhfId ?? "—"}</TableCell>
                        <TableCell>{b.ebmDeviceId ?? "—"}</TableCell>
                        <TableCell>{b.ebmSerialNo ?? "—"}</TableCell>
                        <TableCell>{b.ebmInitializedAt ? new Date(b.ebmInitializedAt).toLocaleString() : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
            <div className="space-y-1.5 rounded-lg border p-3">
              <div className="text-overline uppercase tracking-wide text-muted-foreground">Outbox</div>
              {Object.entries(data.outboxByStatus ?? {}).map(([status, count]) => (
                <Row key={status} label={status} value={String(count)} />
              ))}
            </div>
            <div className="space-y-1.5 rounded-lg border p-3">
              <div className="text-overline uppercase tracking-wide text-muted-foreground">Last fiscal sale</div>
              {data.lastFiscalSale ? (
                <>
                  <Row label="Sale #" value={data.lastFiscalSale.saleNumber} />
                  <Row label="Invoice" value={data.lastFiscalSale.invoiceNumber ?? "—"} />
                  <Row label="Label" value={data.lastFiscalSale.rcptLabel ?? "—"} />
                  <Row label="When" value={new Date(data.lastFiscalSale.createdAt).toLocaleString()} />
                </>
              ) : (
                <p className="text-muted-foreground">No fiscal sales yet.</p>
              )}
            </div>
            <div className="space-y-1.5 rounded-lg border p-3 md:col-span-2">
              <div className="text-overline uppercase tracking-wide text-muted-foreground">Sync cursors</div>
              {(data.syncCursors ?? []).length === 0 ? (
                <p className="text-muted-foreground">No cursors recorded.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Resource</TableHead>
                      <TableHead>lastReqDt</TableHead>
                      <TableHead>Last run</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data.syncCursors ?? []).map((c: any) => (
                      <TableRow key={c.resource}>
                        <TableCell>{c.resource}</TableCell>
                        <TableCell className="font-mono text-xs">{formatLastReqDt(c.lastReqDt)}</TableCell>
                        <TableCell>{c.lastRunAt ? new Date(c.lastRunAt).toLocaleString() : "—"}</TableCell>
                        <TableCell className="max-w-[240px] truncate">{c.lastResult ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const TABS = [
  { value: "daily", label: "Daily X / Z", icon: FileText },
  { value: "plu", label: "PLU", icon: FileText },
  { value: "journal", label: "Journal", icon: ScrollText },
  { value: "masterdata", label: "Master data", icon: Database },
  { value: "stock", label: "Stock sync", icon: Boxes },
  { value: "imports", label: "Imports", icon: Ship },
  { value: "detail", label: "Purchases report", icon: Truck },
  { value: "audit", label: "Auditor", icon: Shield },
] as const;

const TAB_STORAGE_KEY = "fiscal-reports-tab";

export function FiscalReportsPage() {
  const [tab, setTab] = useState<string>(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("tab");
      if (fromUrl && TABS.some((t) => t.value === fromUrl)) return fromUrl;
      const saved = localStorage.getItem(TAB_STORAGE_KEY);
      if (saved && TABS.some((t) => t.value === saved)) return saved;
    } catch { /* ignore */ }
    return "daily";
  });

  // Small attention signals shown as a dot on the relevant tab.
  const [signals, setSignals] = useState<{ notices: number; imports: number }>({ notices: 0, imports: 0 });
  useEffect(() => {
    (async () => {
      try {
        const [md, imp] = await Promise.all([
          apiClient.getRraMasterDataStatus().catch(() => null),
          apiClient.listRraImports("PENDING").catch(() => null),
        ]);
        setSignals({
          notices: ((md as any)?.data ?? md)?.counts?.unreadNotices ?? 0,
          imports: (((imp as any)?.data ?? imp)?.imports ?? []).length,
        });
      } catch { /* ignore */ }
    })();
  }, []);

  const changeTab = (v: string) => {
    setTab(v);
    try { localStorage.setItem(TAB_STORAGE_KEY, v); } catch { /* ignore */ }
  };

  const dotFor = (v: string) => {
    if (v === "masterdata" && signals.notices > 0) return true;
    if (v === "imports" && signals.imports > 0) return true;
    return false;
  };

  return (
    <div className="space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-h1 font-semibold">Fiscal reports</h1>
        <p className="text-body-sm text-muted-foreground">
          RRA CIS/VSDC daily X/Z reports, the PLU report, the electronic journal, RRA master data, stock sync, and import declarations. B2B purchases live under Purchases in the sidebar.
        </p>
      </div>

      <Tabs value={tab} onValueChange={changeTab}>
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <TabsList className="h-auto w-max min-w-full flex-nowrap justify-start gap-1">
            {TABS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value} className="flex-none gap-1.5 px-3 py-1.5">
                <Icon className="size-4" />
                {label}
                {dotFor(value) && <span className="ml-0.5 size-1.5 rounded-full bg-blue-600" aria-hidden="true" />}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="daily" className="mt-4"><DailyReportCard /></TabsContent>
        <TabsContent value="plu" className="mt-4"><PluCard /></TabsContent>
        <TabsContent value="journal" className="mt-4"><ElectronicJournalCard /></TabsContent>
        <TabsContent value="masterdata" className="mt-4"><MasterDataCard /></TabsContent>
        <TabsContent value="stock" className="mt-4"><StockSyncCard /></TabsContent>
        <TabsContent value="imports" className="mt-4"><ImportDeclarationsCard /></TabsContent>
        <TabsContent value="detail" className="mt-4"><PurchasesImportDetailReportCard /></TabsContent>
        <TabsContent value="audit" className="mt-4"><AuditorOverviewCard /></TabsContent>
      </Tabs>
    </div>
  );
}

export default FiscalReportsPage;
