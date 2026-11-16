import { type FormEvent, useMemo, useState } from "react";
import { useCompany } from "../../lib/company";
import { amount, date, humanize, isoDay, toNumber } from "../../lib/format";
import { navigate } from "../../lib/router";
import { useResource, useSession } from "../../lib/session";
import type { ApBill, ApBillDetail, ApPayment, CommercialDoc, InventoryLocation, SupplierTxnDetail, SupplierTxnType } from "../../lib/types";
import { methodLabel } from "../ApForms";
import { AttachmentsPanel } from "../AttachmentsPanel";
import { PdfButton } from "../Documents";
import { useFeedback } from "../feedback";
import { Footer, FormError, SummaryRows, useSubmit } from "../forms";
import { Select } from "../Select";
import { Badge, Drawer, Field, Loadable } from "../ui";

export const SUPPLIER_TXN_LABEL: Record<SupplierTxnType, string> = {
  BILL: "Bill",
  PAYMENT: "Payment",
  CREDIT_NOTE: "Supplier credit",
  DEBIT_NOTE: "Debit note",
  ADVANCE: "Advance",
  EXPENSE: "Expense",
  PURCHASE_ORDER: "Purchase order",
  ITEM_RECEIPT: "Item receipt",
};

type Rows = Array<[string, string] | [string, string, boolean]>;

/* ── Bill ──────────────────────────────────────────────── */

/** A bill with its lines, what paid or credited it, and its files. Pay and void hand back to the profile's forms. */
export function BillDrawer({
  id,
  manage,
  onClose,
  onPay,
  onVoid,
  onOpenPurchaseOrder,
}: {
  id: string;
  manage: boolean;
  onClose: () => void;
  onPay: (billId: string) => void;
  onVoid: (bill: ApBill) => void;
  onOpenPurchaseOrder?: (id: string) => void;
}) {
  const bill = useResource<ApBillDetail>(`/api/v1/ap/bills/${id}`);
  const b = bill.data;
  // Bills from a purchase order carry its number; find the order to link back to it.
  const po = useResource<CommercialDoc[]>(
    b?.poReference && onOpenPurchaseOrder ? `/api/v1/commercial/purchase-order?supplierId=${b.supplierId}&q=${encodeURIComponent(b.poReference)}` : null,
  );
  const poId = po.data?.find((o) => o.number === b?.poReference)?.id;
  const paid = b ? toNumber(b.amountPaid) : 0;
  const credited = b ? toNumber(b.amountCredited) : 0;
  const posted = b?.status === "POSTED";
  const overdue = Boolean(b && posted && b.outstanding > 0.005 && b.dueDate.slice(0, 10) < isoDay());
  const voidable = Boolean(manage && b && posted && b.sourceModule === "AP" && paid === 0 && credited === 0 && b.sourceDocumentType !== "SupplierOpening");
  const opening = b?.sourceDocumentType === "SupplierOpening";

  // VoidBillForm takes the list shape of a bill.
  const asListBill = (x: ApBillDetail): ApBill => ({
    id: x.id,
    billNumber: x.billNumber,
    supplierInvoiceNumber: x.supplierInvoiceNumber,
    supplierId: x.supplierId,
    supplierCode: x.supplier.code,
    supplierName: x.supplier.name,
    billDate: x.billDate,
    dueDate: x.dueDate,
    poReference: x.poReference,
    grnReference: x.grnReference,
    net: toNumber(x.net),
    tax: toNumber(x.tax),
    gross: toNumber(x.gross),
    paid,
    credited,
    outstanding: x.outstanding,
    description: x.description,
    sourceModule: x.sourceModule,
  });

  return (
    <Drawer
      title={b ? `${opening ? "Opening balance" : "Bill"} ${b.billNumber}` : "Bill"}
      subtitle={b && `${b.supplier.name} · ${date(b.billDate)}${b.supplierInvoiceNumber ? ` · supplier invoice ${b.supplierInvoiceNumber}` : ""}`}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          {voidable && (
            <button type="button" className="btn btn-quiet" onClick={() => onVoid(asListBill(b!))}>
              Void bill
            </button>
          )}
          {manage && b && posted && b.outstanding > 0.005 && (
            <button type="button" className="btn btn-primary" onClick={() => onPay(b.id)}>
              Pay bill
            </button>
          )}
        </>
      }
    >
      <Loadable resource={bill}>
        {(x) => (
          <>
            <p className="sup-drawer-status">
              <Badge tone={x.status === "REVERSED" ? "neutral" : x.outstanding <= 0.005 ? "positive" : overdue ? "negative" : "warning"}>
                {x.status === "REVERSED"
                  ? "Void"
                  : x.status === "PENDING_APPROVAL"
                    ? "Awaiting approval"
                    : x.outstanding <= 0.005
                      ? "Paid"
                      : overdue
                        ? "Overdue"
                        : paid + credited > 0
                          ? "Partly paid"
                          : "Unpaid"}
              </Badge>
              <span className="muted small">Due {date(x.dueDate)}</span>
              {x.poReference &&
                (onOpenPurchaseOrder && poId ? (
                  <button type="button" className="link-button small" onClick={() => onOpenPurchaseOrder(poId)}>
                    From PO {x.poReference}
                  </button>
                ) : (
                  <span className="muted small">PO {x.poReference}</span>
                ))}
            </p>
            {x.status === "REVERSED" && x.voidReason && <p className="notice-inline">Voided: {x.voidReason}</p>}
            {x.lines.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th className="num">Qty</th>
                      <th className="num">Rate</th>
                      <th className="num hide-sm">Tax</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {x.lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.description}</td>
                        <td className="num">{toNumber(l.quantity)}</td>
                        <td className="num">{amount(l.unitPrice, 2)}</td>
                        <td className="num hide-sm">{toNumber(l.tax) ? amount(l.tax, 2) : <span className="subtle">—</span>}</td>
                        <td className="num">{amount(l.net, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <SummaryRows
              rows={[
                ["Amount before tax", amount(x.net, 2)],
                ["Tax", amount(x.tax, 2)],
                ...(toNumber(x.discount) ? ([["Discount", `−${amount(x.discount, 2)}`]] as Rows) : []),
                [`Total (${x.currency})`, amount(x.gross, 2), true],
                ...(paid ? ([["Paid", `−${amount(paid, 2)}`]] as Rows) : []),
                ...(credited ? ([["Credited", `−${amount(credited, 2)}`]] as Rows) : []),
                ["Balance due", amount(x.outstanding, 2), true],
              ]}
            />
            {x.description && <p className="small">{x.description}</p>}
            {x.allocations.length > 0 && (
              <>
                <h3 className="cust-subhead">Payments</h3>
                <ul className="cust-mini">
                  {x.allocations.map((a) => (
                    <li key={a.id}>
                      <div className="cust-mini-row">
                        <span className="cust-mini-main">
                          <span className="strong">Payment {a.payment.paymentNumber}</span>
                          <span className="sub">
                            {date(a.payment.paymentDate)}
                            {a.payment.status === "REVERSED" ? " · reversed" : ""}
                          </span>
                        </span>
                        <span className={`num strong ${a.payment.status === "REVERSED" ? "strike muted" : ""}`}>{amount(a.amount, 2)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="cust-attachments">
              <AttachmentsPanel entityType="ApBill" entityId={x.id} title="Supplier invoice and other files" />
            </div>
          </>
        )}
      </Loadable>
    </Drawer>
  );
}

/* ── Payment, supplier credit, debit note, advance, expense, item receipt ─ */

export function SupplierTxnDrawer({
  type,
  id,
  manage,
  onClose,
  onOpenBill,
  onOpen,
  onReverse,
  onApplyAdvance,
  onRefundAdvance,
}: {
  type: Exclude<SupplierTxnType, "BILL" | "PURCHASE_ORDER">;
  id: string;
  manage: boolean;
  onClose: () => void;
  onOpenBill: (billId: string) => void;
  onOpen: (r: { type: SupplierTxnType; id: string }) => void;
  onReverse: (p: ApPayment) => void;
  onApplyAdvance: (advanceId: string) => void;
  onRefundAdvance: (advanceId: string) => void;
}) {
  const { currency } = useCompany();
  const detail = useResource<SupplierTxnDetail>(`/api/v1/ap/transactions/${type}/${id}`);
  const d = detail.data;
  const reversible = Boolean(manage && d && type === "PAYMENT" && d.status === "POSTED" && d.sourceModule === "AP");

  // ReversePaymentForm takes the list shape of a payment.
  const asListPayment = (x: SupplierTxnDetail): ApPayment =>
    ({
      id: x.id,
      paymentNumber: x.number,
      paymentDate: x.date,
      supplierId: x.supplier.id,
      supplierCode: x.supplier.code,
      supplierName: x.supplier.name,
      method: (x.method ?? "BANK") as ApPayment["method"],
      amount: x.paid ?? x.total,
      withholdingTax: x.withholdingTax ?? 0,
      unallocated: x.open,
      status: x.status as ApPayment["status"],
      reference: x.reference,
      sourceModule: x.sourceModule ?? null,
      bills: x.applications.map((a) => ({ billNumber: a.billNumber, amount: a.amount })),
    }) as ApPayment;

  const notApplied = type === "ADVANCE" ? "Not yet used" : type === "DEBIT_NOTE" ? "Still owed" : "Not yet applied";

  return (
    <Drawer
      title={d ? `${SUPPLIER_TXN_LABEL[type]} ${d.number}` : SUPPLIER_TXN_LABEL[type]}
      subtitle={d && `${d.supplier.name} · ${date(d.date)}${d.status === "REVERSED" ? " · reversed" : ""}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          {d && type === "PAYMENT" && <PdfButton path={`/api/v1/ap/payments/${d.id}/remittance.pdf`} filename={`remittance-${d.number}.pdf`} label="Remittance advice" className="btn" />}
          {reversible && (
            <button type="button" className="btn btn-danger" onClick={() => onReverse(asListPayment(d!))}>
              Reverse payment
            </button>
          )}
          {manage && d && type === "ADVANCE" && d.status === "POSTED" && d.open > 0.005 && (
            <>
              <button type="button" className="btn" onClick={() => onRefundAdvance(d.id)}>
                Refund
              </button>
              <button type="button" className="btn btn-primary" onClick={() => onApplyAdvance(d.id)}>
                Apply to a bill
              </button>
            </>
          )}
          {d && type === "EXPENSE" && (
            <button type="button" className="btn" onClick={() => navigate(`/expenses/list?q=${encodeURIComponent(d.number)}`)}>
              Open in Expenses
            </button>
          )}
        </>
      }
    >
      <Loadable resource={detail}>
        {(t) => (
          <>
            <SummaryRows
              rows={[
                ...(t.method ? ([["Method", methodLabel(t.method)]] as Rows) : []),
                ...(t.account ? ([["Paid from", t.account]] as Rows) : []),
                ...(t.category ? ([["Category", t.category]] as Rows) : []),
                ...(t.paymentMode ? ([["Paid", t.paymentMode === "ON_ACCOUNT" ? "On account" : humanize(t.paymentMode)]] as Rows) : []),
                ...(t.reference ? ([[type === "CREDIT_NOTE" || type === "DEBIT_NOTE" ? "Supplier reference" : "Reference", t.reference]] as Rows) : []),
                ...(t.dueDate ? ([["Due", date(t.dueDate)]] as Rows) : []),
                ...(t.net !== undefined ? ([["Amount before tax", amount(t.net, 2)], ["Tax", amount(t.tax ?? 0, 2)]] as Rows) : []),
                ...(t.withholdingTax ? ([["Paid in cash", amount(t.paid ?? 0, 2)], ["Withholding tax", amount(t.withholdingTax, 2)]] as Rows) : []),
                [`Total (${currency})`, amount(t.total, 2), true],
                ...(["PAYMENT", "CREDIT_NOTE", "ADVANCE", "DEBIT_NOTE"].includes(type) && t.status === "POSTED" ? ([[notApplied, amount(t.open, 2)]] as Rows) : []),
                ...(t.refunded ? ([["Refunded", amount(t.refunded, 2)]] as Rows) : []),
              ]}
            />
            {t.description && <p className="small">{t.description}</p>}

            {type === "ITEM_RECEIPT" && t.lines && (
              <>
                <p className="small">
                  {t.purchaseOrder && (
                    <>
                      Received against{" "}
                      <button type="button" className="link-button" onClick={() => onOpen({ type: "PURCHASE_ORDER", id: t.purchaseOrder!.id })}>
                        purchase order {t.purchaseOrder.number}
                      </button>
                      .{" "}
                    </>
                  )}
                  {t.bill ? (
                    <>
                      Billed on{" "}
                      <button type="button" className="link-button" onClick={() => onOpenBill(t.bill!.id)}>
                        bill {t.bill.billNumber}
                      </button>
                      .
                    </>
                  ) : (
                    "Not billed yet: its value sits in goods received not invoiced until the supplier's bill arrives."
                  )}
                </p>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th className="num">Qty</th>
                        <th className="num">Unit cost</th>
                        <th className="num">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.lines.map((l, i) => (
                        <tr key={i}>
                          <td>
                            {l.description}
                            {l.sku && <span className="sub">{l.sku}</span>}
                          </td>
                          <td className="num">{l.quantity}</td>
                          <td className="num">{amount(l.unitCost, 2)}</td>
                          <td className="num">{amount(l.value, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {type === "DEBIT_NOTE" && (
              <>
                <h3 className="cust-subhead">Payments</h3>
                {t.payments?.length ? (
                  <ul className="cust-mini">
                    {t.payments.map((p) => (
                      <li key={p.paymentId}>
                        <button type="button" onClick={() => onOpen({ type: "PAYMENT", id: p.paymentId })}>
                          <span className="cust-mini-main">
                            <span className="strong">Payment {p.paymentNumber}</span>
                            <span className="sub">{date(p.date)}</span>
                          </span>
                          <span className="num strong">{amount(p.amount, 2)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">Not paid yet. Pay it from Pay bills like any other bill.</p>
                )}
              </>
            )}

            {["PAYMENT", "CREDIT_NOTE", "ADVANCE"].includes(type) && (
              <>
                <h3 className="cust-subhead">Applied to</h3>
                {t.applications.length ? (
                  <ul className="cust-mini">
                    {t.applications.map((a, i) => (
                      <li key={`${a.billId}-${i}`}>
                        <button type="button" onClick={() => onOpenBill(a.billId)}>
                          <span className="cust-mini-main">
                            <span className="strong">Bill {a.billNumber}</span>
                            <span className="sub">{[a.reference && `Inv. ${a.reference}`, date(a.date)].filter(Boolean).join(" · ")}</span>
                          </span>
                          <span className="num strong">{amount(a.amount, 2)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">Not applied to any bill yet.</p>
                )}
              </>
            )}
          </>
        )}
      </Loadable>
    </Drawer>
  );
}

/* ── Purchase order ────────────────────────────────────── */

const PO_STATUS: Record<string, { label: string; tone: "positive" | "negative" | "warning" | "neutral" }> = {
  PENDING_APPROVAL: { label: "Awaiting approval", tone: "warning" },
  OPEN: { label: "Open", tone: "warning" },
  PARTIALLY_RECEIVED: { label: "Partly received", tone: "warning" },
  RECEIVED: { label: "Received", tone: "positive" },
  CONVERTED: { label: "Billed", tone: "positive" },
  CLOSED: { label: "Closed", tone: "neutral" },
  VOID: { label: "Cancelled", tone: "neutral" },
};

export function poStatus(status: string) {
  return PO_STATUS[status] ?? { label: humanize(status), tone: "neutral" as const };
}

/** Ordered, received and billed per line, with the receive / bill / close actions of the purchase order workflow. */
export function PurchaseOrderDrawer({
  id,
  manage,
  canReceive,
  onClose,
  onOpenBill,
  onChanged,
}: {
  id: string;
  manage: boolean;
  canReceive: boolean;
  onClose: () => void;
  onOpenBill: (billId: string) => void;
  onChanged: () => void;
}) {
  const { api } = useSession();
  const { toast, confirm } = useFeedback();
  const doc = useResource<CommercialDoc>(`/api/v1/commercial/documents/${id}`);
  const [receiving, setReceiving] = useState(false);
  const [billing, setBilling] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = doc.data;

  const lines = d?.lines ?? [];
  const received = lines.reduce((s, l) => s + toNumber(l.receivedQuantity ?? 0), 0);
  const billed = lines.reduce((s, l) => s + toNumber(l.billedQuantity ?? 0), 0);
  const receivable = lines.some((l) => l.itemId && toNumber(l.quantity) - toNumber(l.receivedQuantity ?? 0) > 0.0001);
  const live = d && ["OPEN", "PARTIALLY_RECEIVED", "RECEIVED"].includes(d.status);
  // Something to bill: received stock not billed yet, or service lines not billed yet.
  const billable = lines.some((l) => (l.itemId ? toNumber(l.receivedQuantity ?? 0) : toNumber(l.quantity)) - toNumber(l.billedQuantity ?? 0) > 0.0001);

  async function setStatus(status: "CLOSED" | "VOID") {
    if (!d) return;
    const ok = await confirm({
      title: status === "VOID" ? `Cancel purchase order ${d.number}?` : `Close purchase order ${d.number}?`,
      body:
        status === "VOID"
          ? "The order is kept for the record but can no longer be received or billed."
          : "Nothing more will be received or billed against it. You can reopen it later.",
      confirmLabel: status === "VOID" ? "Cancel order" : "Mark as closed",
      danger: status === "VOID",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/api/v1/commercial/documents/${d.id}/status`, { method: "POST", body: JSON.stringify({ status }) });
      toast(status === "VOID" ? `Purchase order ${d.number} cancelled` : `Purchase order ${d.number} closed`);
      doc.reload();
      onChanged();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy(false);
    }
  }

  const st = d ? poStatus(d.status) : null;
  return (
    <>
      <Drawer
        title={d ? `Purchase order ${d.number}` : "Purchase order"}
        subtitle={d && `${d.partyName} · ${date(d.docDate)}${d.dueDate ? ` · expected ${date(d.dueDate)}` : ""}`}
        wide
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
            {manage && d && d.status === "OPEN" && received === 0 && billed === 0 && (
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void setStatus("VOID")}>
                Cancel order
              </button>
            )}
            {manage && live && (
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void setStatus("CLOSED")}>
                Mark as closed
              </button>
            )}
            {manage && canReceive && d && ["OPEN", "PARTIALLY_RECEIVED"].includes(d.status) && receivable && (
              <button type="button" className="btn" onClick={() => setReceiving(true)}>
                Receive goods
              </button>
            )}
            {manage && live && billable && (
              <button type="button" className="btn btn-primary" onClick={() => setBilling(true)}>
                Create bill
              </button>
            )}
          </>
        }
      >
        <Loadable resource={doc}>
          {(x) => (
            <>
              <p className="sup-drawer-status">
                <Badge tone={st!.tone}>{st!.label}</Badge>
                <span className="muted small">Purchase orders don't change what you owe until they're billed.</span>
              </p>
              {x.convertedToType === "ApBill" && x.convertedToId && (
                <p className="small">
                  Last billed on{" "}
                  <button type="button" className="link-button" onClick={() => onOpenBill(x.convertedToId!)}>
                    bill {x.convertedToNumber}
                  </button>
                  .
                </p>
              )}
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th className="num">Ordered</th>
                      <th className="num">Received</th>
                      <th className="num">Billed</th>
                      <th className="num hide-sm">Rate</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {x.lines.map((l) => {
                      const q = toNumber(l.quantity);
                      const r = toNumber(l.receivedQuantity ?? 0);
                      return (
                        <tr key={l.id}>
                          <td>
                            {l.description}
                            {!l.itemId && <span className="sub">Service: billed without receiving</span>}
                          </td>
                          <td className="num">{q}</td>
                          <td className={`num ${l.itemId && r > 0 && r < q ? "text-warning" : ""}`}>{l.itemId ? r : <span className="subtle">—</span>}</td>
                          <td className="num">{toNumber(l.billedQuantity ?? 0)}</td>
                          <td className="num hide-sm">{amount(l.unitPrice, 2)}</td>
                          <td className="num">{amount(l.net, 2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <SummaryRows
                rows={[
                  ["Amount before tax", amount(x.net, 2)],
                  ["Tax", amount(x.tax, 2)],
                  [`Total (${x.currency})`, amount(x.total, 2), true],
                ]}
              />
              {(x.memo || x.note) && <p className="small muted">{x.note || x.memo}</p>}
            </>
          )}
        </Loadable>
      </Drawer>
      {receiving && d && (
        <ReceiveGoodsDrawer
          order={d}
          onClose={() => setReceiving(false)}
          onSaved={() => {
            setReceiving(false);
            doc.reload();
            onChanged();
          }}
        />
      )}
      {billing && d && (
        <BillOrderDrawer
          order={d}
          onClose={() => setBilling(false)}
          onSaved={(billId) => {
            setBilling(false);
            doc.reload();
            onChanged();
            onOpenBill(billId);
          }}
        />
      )}
    </>
  );
}

/** Receives stock against a purchase order through POST /inventory/item-receipts (the same endpoint as Item receipt). */
function ReceiveGoodsDrawer({ order, onClose, onSaved }: { order: CommercialDoc; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const locations = useResource<InventoryLocation[]>("/api/v1/inventory/locations");
  const open = useMemo(
    () => order.lines.filter((l) => l.itemId && toNumber(l.quantity) - toNumber(l.receivedQuantity ?? 0) > 0.0001),
    [order.lines],
  );
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(open.map((l) => [l.id, String(toNumber(l.quantity) - toNumber(l.receivedQuantity ?? 0))])));
  const [locationId, setLocationId] = useState("");
  const [day, setDay] = useState(isoDay());
  const { busy, error, setError, run } = useSubmit();
  const location = locationId || locations.data?.[0]?.id || "";

  function submit(e: FormEvent) {
    e.preventDefault();
    const lines = open
      .map((l) => ({ l, q: Number(qty[l.id]) }))
      .filter(({ q }) => Number.isFinite(q) && q > 0)
      .map(({ l, q }) => ({ itemId: l.itemId!, purchaseOrderLineId: l.id, locationId: location || undefined, quantity: q, unitCost: toNumber(l.unitPrice), taxCode: l.taxCode ?? undefined }));
    const tooMany = open.find((l) => Number(qty[l.id]) > toNumber(l.quantity) - toNumber(l.receivedQuantity ?? 0) + 0.0001);
    if (tooMany) return setError(`More than is still on order for ${tooMany.description}`);
    if (!lines.length) return setError("Enter a quantity for at least one line");
    void run(async () => {
      await api("/api/v1/inventory/item-receipts", {
        method: "POST",
        body: JSON.stringify({ supplierId: order.supplierId, purchaseOrderId: order.id, date: day, lines }),
      });
      onSaved();
      return `Goods received against purchase order ${order.number}`;
    });
  }

  return (
    <Drawer
      title={`Receive goods · PO ${order.number}`}
      subtitle="Stock goes up at the order price, against goods received not invoiced, until the bill arrives."
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label="Receive goods" formId="receive-form" />}
    >
      <form id="receive-form" onSubmit={submit} noValidate>
        <FormError message={error} />
        <div className="form-grid">
          <Field label="Date received">
            <input className="input" type="date" max={isoDay()} value={day} onChange={(e) => setDay(e.target.value)} required />
          </Field>
          <Field label="Location">
            <Select
              value={location}
              onChange={setLocationId}
              searchable={false}
              placeholder={locations.loading ? "Loading…" : "Default location"}
              options={(locations.data ?? []).map((l) => ({ value: l.id, label: l.name }))}
            />
          </Field>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Still on order</th>
                <th className="num" style={{ width: 120 }}>
                  Receiving
                </th>
              </tr>
            </thead>
            <tbody>
              {open.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td className="num">{toNumber(l.quantity) - toNumber(l.receivedQuantity ?? 0)}</td>
                  <td className="num">
                    <input
                      className="input num"
                      inputMode="decimal"
                      aria-label={`Quantity received for ${l.description}`}
                      value={qty[l.id] ?? ""}
                      onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </form>
    </Drawer>
  );
}

/** Bills what has been received on the order (and its service lines) through the existing convert endpoint. */
function BillOrderDrawer({ order, onClose, onSaved }: { order: CommercialDoc; onClose: () => void; onSaved: (billId: string) => void }) {
  const { api } = useSession();
  const [day, setDay] = useState(isoDay());
  const [dueDate, setDueDate] = useState("");
  const [invoice, setInvoice] = useState("");
  const { busy, error, run } = useSubmit();

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const res = await api<{ converted: { id: string; number: string } }>(`/api/v1/commercial/documents/${order.id}/convert`, {
        method: "POST",
        body: JSON.stringify({ target: "BILL", date: day, dueDate: dueDate || undefined, supplierInvoiceNumber: invoice.trim() || undefined }),
      });
      onSaved(res.converted.id);
      return `Bill ${res.converted.number} created from purchase order ${order.number}`;
    });
  }

  return (
    <Drawer
      title={`Create bill · PO ${order.number}`}
      subtitle="Bills the goods received and any service lines not billed yet. Goods still to arrive are billed when they're received."
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label="Create bill" formId="bill-po-form" />}
    >
      <form id="bill-po-form" onSubmit={submit} noValidate>
        <FormError message={error} />
        <div className="form-grid">
          <Field label="Supplier invoice number" hint="Recorded once per supplier, so the same invoice can't be entered twice">
            <input className="input" value={invoice} onChange={(e) => setInvoice(e.target.value)} maxLength={60} />
          </Field>
          <div />
          <Field label="Bill date">
            <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
          </Field>
          <Field label="Due date" hint="Leave empty to use the supplier's terms">
            <input className="input" type="date" min={day} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
      </form>
    </Drawer>
  );
}
