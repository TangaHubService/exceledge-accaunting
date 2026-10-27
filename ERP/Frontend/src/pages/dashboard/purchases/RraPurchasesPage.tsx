import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Truck, X } from "lucide-react";
import { SearchableSelect } from "../../../components/ui/SearchableSelect";
import { parseInventoryGetProductsResponse } from "../../../lib/inventory-response";
import { toast } from "react-toastify";
import { apiClient } from "../../../lib/api-client";
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
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "../../../components/ui/drawer";

interface RraPurchaseItem {
  id: number;
  itemSeq: number;
  itemCd?: string | null;
  itemNm?: string | null;
  qty?: number | string | null;
  qtyUnitCd?: string | null;
  prc?: number | string | null;
  taxTyCd?: string | null;
  taxAmt?: number | string | null;
  totAmt?: number | string | null;
}

interface RraPurchase {
  id: number;
  spplrTin?: string | null;
  spplrNm?: string | null;
  spplrInvcNo: string | number;
  salesDt?: string | null;
  pmtTyCd?: string | null;
  totItemCnt?: number | null;
  totTaxblAmt?: number | string | null;
  totTaxAmt?: number | string | null;
  totAmt?: number | string | null;
  status: "PENDING" | "CONFIRMED" | "REJECTED";
  prcOrdCd?: string | null;
  remark?: string | null;
  items: RraPurchaseItem[];
}

const PMT_LABEL: Record<string, string> = {
  "01": "Cash",
  "02": "Credit",
  "03": "Cash/Credit",
  "04": "Bank Check",
  "05": "Card",
  "06": "Mobile money",
  "07": "Other",
};

interface CatalogProduct {
  id: number;
  name: string;
  itemCd?: string | null;
  sku?: string | null;
  unitPrice?: number | string | null;
  itemType?: string | null;
}

interface LineEdit {
  localNm: string;
  linkProductId: string;
  sellingPrice: string;
  expiryDate: string;
}

/** Matches VSDC §3.3.7.1 sample / backend PURCHASES_DEFAULT_LAST_REQ_DT. */
const PURCHASES_DEFAULT_LAST_REQ = "20190524000000";

const money = (n: number | null | undefined) =>
  (Number(n ?? 0)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatInt = (n: number | null | undefined) => (Number(n ?? 0)).toLocaleString("en-US");

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

function unwrapApiData(res: unknown): any {
  let cur: any = res;
  if (cur?.success === true && cur.data != null) cur = cur.data;
  const looksLikeDomainPayload =
    cur?.purchases != null
    || cur?.counts != null
    || Array.isArray(cur?.pending)
    || Array.isArray(cur?.failures);
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

function pickLastReqDt(pdata: any): string {
  if (!pdata || typeof pdata !== "object") return PURCHASES_DEFAULT_LAST_REQ;
  const raw =
    pdata.lastRequestDate
    ?? pdata.lastReqDt
    ?? pdata.last_request_date
    ?? pdata.cursor?.lastReqDt
    ?? null;
  const s = raw != null && String(raw).trim() ? String(raw).trim() : "";
  return s || PURCHASES_DEFAULT_LAST_REQ;
}

const priceOf = (p?: CatalogProduct) => (p?.unitPrice != null ? String(Number(p.unitPrice)) : "");

type RraPurchaseStatusFilter = "ALL" | "PENDING" | "CONFIRMED" | "REJECTED";

/**
 * VSDC B2B purchases (§70 / §71): pull selectTrnsPurchaseSales, confirm/reject savePurchases.
 * Import declarations stay on Fiscal Reports → Imports.
 */
export function RraPurchasesPage() {
  const [purchases, setPurchases] = useState<RraPurchase[]>([]);
  const [purchasesLastReq, setPurchasesLastReq] = useState<string>(PURCHASES_DEFAULT_LAST_REQ);
  const [purchaseStatusFilter, setPurchaseStatusFilter] = useState<RraPurchaseStatusFilter>("PENDING");
  const [purchasePendingCount, setPurchasePendingCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [selected, setSelected] = useState<RraPurchase | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [prcOrdCd, setPrcOrdCd] = useState("");
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [lineEdits, setLineEdits] = useState<Record<number, LineEdit>>({});

  const applyPurchasesPayload = useCallback((pdata: any, opts?: { replaceList?: boolean }) => {
    if (!pdata || typeof pdata !== "object") return;
    const replaceList = opts?.replaceList !== false;
    if (replaceList && Array.isArray(pdata.purchases)) {
      setPurchases(pdata.purchases as RraPurchase[]);
    }
    if (pdata.pending != null) setPurchasePendingCount(Number(pdata.pending) || 0);
    setPurchasesLastReq(pickLastReqDt(pdata));
  }, []);

  const load = useCallback(async () => {
    try {
      const statusArg = purchaseStatusFilter === "ALL" ? undefined : purchaseStatusFilter;
      const [p, statusRes] = await Promise.all([
        apiClient.listRraPurchases(statusArg),
        apiClient.getRraMasterDataStatus().catch(() => null),
      ]);
      const pdata = unwrapApiData(p);
      applyPurchasesPayload(pdata);

      const hasListCursor = Boolean(pdata?.lastRequestDate ?? pdata?.lastReqDt);
      if (!hasListCursor && statusRes) {
        const st = unwrapApiData(statusRes);
        const cursors = st?.cursors ?? st?.syncCursors ?? [];
        const purchasesCursor = Array.isArray(cursors)
          ? cursors.find((c: any) => c?.resource === "purchases")
          : null;
        if (purchasesCursor?.lastReqDt) {
          setPurchasesLastReq(String(purchasesCursor.lastReqDt));
        }
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load purchases");
      setPurchasesLastReq(PURCHASES_DEFAULT_LAST_REQ);
    }
  }, [applyPurchasesPayload, purchaseStatusFilter]);

  useEffect(() => { load(); }, [load]);

  const syncPurchases = async () => {
    setBusy(true);
    try {
      const res = await apiClient.syncRraPurchases();
      const out = unwrapApiData(res);
      applyPurchasesPayload(out, { replaceList: false });
      toast.success(`Pulled ${out?.cached ?? 0} purchase(s) from RRA`);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Purchase pull failed");
    } finally {
      setBusy(false);
    }
  };

  const openDetail = (p: RraPurchase) => {
    setSelected(p);
    setRejecting(false);
    setRejectReason("");
    setPrcOrdCd((p.prcOrdCd ?? "").trim());
    setLineEdits(Object.fromEntries(
      p.items.map((it) => [it.id, { localNm: it.itemNm ?? "", linkProductId: "__new__", sellingPrice: "", expiryDate: "" }]),
    ));
    if (p.status === "PENDING") {
      apiClient.getProducts({ page: 1, limit: 500 })
        .then((res) => {
          const items = parseInventoryGetProductsResponse(res).items as CatalogProduct[];
          setCatalog(items);
          setLineEdits((prev) => {
            const next = { ...prev };
            for (const it of p.items) {
              const cur = next[it.id];
              if (!cur || (cur.linkProductId && cur.linkProductId !== "__new__")) continue;
              const supplierNm = (it.itemNm ?? "").trim().toLowerCase();
              const match = items.find((prod) =>
                (it.itemCd && prod.itemCd === it.itemCd)
                || (!!supplierNm && prod.name.trim().toLowerCase() === supplierNm),
              );
              if (match) {
                next[it.id] = {
                  ...cur,
                  localNm: cur.localNm || match.name,
                  linkProductId: String(match.id),
                  sellingPrice: cur.sellingPrice || priceOf(match),
                };
              }
            }
            return next;
          });
        })
        .catch(() => setCatalog([]));
    }
  };

  const setLine = (itemId: number, patch: Partial<LineEdit>) => {
    setLineEdits((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  };

  const action = async (id: number, reject: boolean) => {
    setRowBusy(id);
    try {
      const items = !reject && selected
        ? selected.items.map((it) => {
            const edit = lineEdits[it.id];
            const linkId = edit?.linkProductId && edit.linkProductId !== "__new__"
              ? Number(edit.linkProductId)
              : undefined;
            const sellingPrice = Number(edit?.sellingPrice);
            return {
              itemId: it.id,
              itemSeq: it.itemSeq,
              itemNm: edit?.localNm?.trim() || it.itemNm || undefined,
              linkProductId: linkId && Number.isFinite(linkId) ? linkId : undefined,
              sellingPrice: Number.isFinite(sellingPrice) && sellingPrice > 0 ? sellingPrice : undefined,
              expiryDate: edit?.expiryDate || undefined,
            };
          })
        : undefined;
      const code = prcOrdCd.trim();
      await apiClient.confirmRraPurchase(id, reject, {
        items,
        prcOrdCd: code || undefined,
        remark: reject ? (rejectReason.trim() || undefined) : undefined,
      });
      toast.success(reject ? "Purchase rejected" : "Purchase approved with RRA");
      setSelected(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Action failed");
    } finally {
      setRowBusy(null);
    }
  };

  return (
    <div className="space-y-5 p-4 md:p-6">
      <div>
        <h1 className="text-h1 font-semibold">Purchases</h1>
        <p className="text-body-sm text-muted-foreground">
          Pull B2B sales issued to your TIN from VSDC, then confirm or reject each purchase with RRA.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="size-4" /> Received purchases (RRA)
          </CardTitle>
          <CardDescription>
            Uses <span className="font-mono text-xs">selectTrnsPurchaseSales</span> to pull and{" "}
            <span className="font-mono text-xs">savePurchases</span> to confirm (02) or reject (04).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Status</Label>
                <Select
                  value={purchaseStatusFilter}
                  onValueChange={(v) => setPurchaseStatusFilter(v as RraPurchaseStatusFilter)}
                >
                  <SelectTrigger className="h-9 w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All</SelectItem>
                    <SelectItem value="PENDING">
                      Pending{purchasePendingCount > 0 ? ` (${purchasePendingCount})` : ""}
                    </SelectItem>
                    <SelectItem value="CONFIRMED">Approved</SelectItem>
                    <SelectItem value="REJECTED">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="inline-flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm text-sky-950 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-100">
                <span className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">Last request</span>
                <span className="font-mono font-semibold tabular-nums" title={purchasesLastReq}>
                  {formatLastReqDt(purchasesLastReq || PURCHASES_DEFAULT_LAST_REQ)}
                </span>
              </div>
            </div>
            <Button size="sm" onClick={syncPurchases} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Pull from RRA
            </Button>
          </div>

          <div className="text-sm text-muted-foreground">
            Showing <b className="text-foreground tabular-nums">{purchases.length}</b>
            {purchaseStatusFilter === "PENDING"
              ? " pending"
              : purchaseStatusFilter === "CONFIRMED"
                ? " approved"
                : purchaseStatusFilter === "REJECTED"
                  ? " rejected"
                  : ""}{" "}
            purchase(s)
            {purchasePendingCount > 0 && purchaseStatusFilter !== "PENDING" ? (
              <> · <b className="text-amber-600 tabular-nums">{purchasePendingCount}</b> still pending</>
            ) : null}
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchases.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                      {purchaseStatusFilter === "ALL"
                        ? "No purchases pulled from RRA yet. Press “Pull from RRA”."
                        : purchaseStatusFilter === "PENDING"
                          ? "No pending purchases."
                          : purchaseStatusFilter === "CONFIRMED"
                            ? "No approved purchases."
                            : "No rejected purchases."}
                    </TableCell>
                  </TableRow>
                )}
                {purchases.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => openDetail(p)}>
                    <TableCell>{p.spplrNm ?? p.spplrTin}</TableCell>
                    <TableCell className="font-mono text-xs">{String(p.spplrInvcNo)}</TableCell>
                    <TableCell>{p.salesDt ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.totItemCnt ?? p.items.length}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(Number(p.totAmt))}</TableCell>
                    <TableCell>
                      <span className={
                        p.status === "CONFIRMED"
                          ? "text-emerald-600"
                          : p.status === "REJECTED"
                            ? "text-muted-foreground"
                            : "text-amber-600"
                      }>
                        {p.status === "CONFIRMED" ? "APPROVED" : p.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {p.status === "PENDING" ? "Review" : "View"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Drawer open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <DrawerContent className="sm:max-w-2xl">
          <DrawerHeader className="px-0 pt-0">
            <DrawerTitle>Purchase invoice {selected ? String(selected.spplrInvcNo) : ""}</DrawerTitle>
          </DrawerHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <div><span className="text-muted-foreground">Supplier</span><div>{selected.spplrNm ?? "—"}</div></div>
                <div><span className="text-muted-foreground">Supplier TIN</span><div className="font-mono">{selected.spplrTin}</div></div>
                <div><span className="text-muted-foreground">Invoice no.</span><div className="font-mono">{String(selected.spplrInvcNo)}</div></div>
                <div><span className="text-muted-foreground">Date</span><div>{selected.salesDt ?? "—"}</div></div>
                <div><span className="text-muted-foreground">Payment</span><div>{PMT_LABEL[selected.pmtTyCd ?? ""] ?? selected.pmtTyCd ?? "—"}</div></div>
                <div><span className="text-muted-foreground">Status</span><div>{selected.status}</div></div>
                <div><span className="text-muted-foreground">Purchase code</span><div className="font-mono">{selected.prcOrdCd?.trim() || "—"}</div></div>
                {selected.remark && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Remark</span>
                    <div>{selected.remark}</div>
                  </div>
                )}
              </div>

              {selected.status === "PENDING" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="pchs-prc-ord">
                      Purchase code (prcOrdCd){" "}
                      <span className="text-muted-foreground">(optional if already on the sale)</span>
                    </Label>
                    <Input
                      id="pchs-prc-ord"
                      value={prcOrdCd}
                      onChange={(e) => setPrcOrdCd(e.target.value.toUpperCase())}
                      placeholder="6-character RRA purchase code"
                      maxLength={6}
                      className="font-mono uppercase"
                    />
                  </div>
                  <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    You can rename each item for your inventory and set its selling price. The supplier&apos;s name is kept for RRA. Leave unmatched to create a new product, or link an existing one.
                  </p>
                </>
              )}

              <div className="max-h-[28rem] space-y-3 overflow-auto">
                {selected.items.map((it) => {
                  const edit = lineEdits[it.id] ?? {
                    localNm: it.itemNm ?? "",
                    linkProductId: "__new__",
                    sellingPrice: "",
                    expiryDate: "",
                  };
                  return (
                    <div key={it.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                        <div>
                          <span className="mr-2 text-muted-foreground">#{it.itemSeq}</span>
                          <span className="font-medium">{it.itemNm ?? "Item"}</span>
                          {it.itemCd && <span className="ml-1 font-mono text-xs text-muted-foreground">{it.itemCd}</span>}
                        </div>
                        <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                          <span>Qty {formatInt(Number(it.qty))} {it.qtyUnitCd ?? ""}</span>
                          <span>Unit {money(Number(it.prc))}</span>
                          <span>Tax {it.taxTyCd ?? "—"} {money(Number(it.taxAmt))}</span>
                          <span className="font-medium text-foreground">Total {money(Number(it.totAmt))}</span>
                        </div>
                      </div>
                      {selected.status === "PENDING" && (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1">
                            <Label htmlFor={`local-nm-${it.id}`}>Name in your inventory</Label>
                            <Input
                              id={`local-nm-${it.id}`}
                              value={edit.localNm}
                              onChange={(e) => setLine(it.id, { localNm: e.target.value })}
                              placeholder={it.itemNm ?? "Item name"}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>Match existing product</Label>
                            <SearchableSelect
                              value={edit.linkProductId}
                              onChange={(value) => {
                                const prod = catalog.find((p) => String(p.id) === value);
                                setLine(it.id, {
                                  linkProductId: value,
                                  localNm: value !== "__new__" && prod ? prod.name : edit.localNm,
                                  sellingPrice: value !== "__new__" && prod ? priceOf(prod) : edit.sellingPrice,
                                });
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
                          <div className="space-y-1">
                            <Label htmlFor={`sell-price-${it.id}`}>Selling price</Label>
                            <Input
                              id={`sell-price-${it.id}`}
                              type="number"
                              min="0"
                              step="0.01"
                              inputMode="decimal"
                              value={edit.sellingPrice}
                              onChange={(e) => setLine(it.id, { sellingPrice: e.target.value })}
                              placeholder={`Cost ${money(Number(it.prc))}`}
                            />
                            {Number(edit.sellingPrice) > 0 && Number(edit.sellingPrice) < Number(it.prc) && (
                              <p className="text-xs text-amber-600">Below the purchase cost of {money(Number(it.prc))}.</p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`expiry-${it.id}`}>Expiry date (optional)</Label>
                            <Input
                              id={`expiry-${it.id}`}
                              type="date"
                              value={edit.expiryDate}
                              onChange={(e) => setLine(it.id, { expiryDate: e.target.value })}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col items-end gap-0.5 text-sm">
                <div>
                  <span className="mr-3 text-muted-foreground">Taxable</span>
                  <span className="tabular-nums">{money(Number(selected.totTaxblAmt))}</span>
                </div>
                <div>
                  <span className="mr-3 text-muted-foreground">Tax</span>
                  <span className="tabular-nums">{money(Number(selected.totTaxAmt))}</span>
                </div>
                <div className="font-semibold">
                  <span className="mr-3 text-muted-foreground">Total</span>
                  <span className="tabular-nums">{money(Number(selected.totAmt))}</span>
                </div>
              </div>

              {selected.status === "PENDING" && (
                rejecting ? (
                  <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-950/30">
                    <p className="text-sm font-medium text-red-700 dark:text-red-400">Reject this purchase?</p>
                    <p className="text-xs text-red-700/80 dark:text-red-400/80">
                      It will be marked as not accepted and no stock will be recorded. This can&apos;t be undone from here.
                    </p>
                    <Input
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Reason (optional)"
                      className="bg-background"
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setRejecting(false)}>Back</Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={rowBusy === selected.id}
                        onClick={() => action(selected.id, true)}
                      >
                        {rowBusy === selected.id ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} Reject purchase
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between gap-2 border-t pt-3">
                    <Button variant="ghost" onClick={() => setRejecting(true)} disabled={rowBusy === selected.id}>
                      <X className="size-4" /> Reject
                    </Button>
                    <Button onClick={() => action(selected.id, false)} disabled={rowBusy === selected.id}>
                      {rowBusy === selected.id ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Confirm with RRA
                    </Button>
                  </div>
                )
              )}
            </div>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}

export default RraPurchasesPage;
