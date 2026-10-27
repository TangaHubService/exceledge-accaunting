import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'react-toastify';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter,
} from '../ui/drawer';
import { apiClient } from '../../lib/api-client';
import { parseInventoryGetProductsResponse } from '../../lib/inventory-response';
import { cn } from '../../lib/utils';

type ProformaSale = {
  id: string | number;
  saleNumber: string;
  invoiceNumber?: string | null;
  totalAmount: string | number;
  customer?: { id?: string | number; name?: string } | null;
  saleItems: Array<{
    id: string | number;
    productId?: number | null;
    product?: { name?: string } | null;
    quantity: number;
    unitPrice: string | number;
    itemType?: string | null;
    serviceName?: string | null;
  }>;
};

type Line = {
  key: string;
  productId?: number;
  name: string;
  quantity: number;
  unitPrice: number;
  itemType: 'PRODUCT' | 'RAW_MATERIAL' | 'SERVICE';
  serviceName?: string;
};

type PickerProduct = {
  id: string | number;
  name: string;
  unitPrice?: number;
  price?: number;
  quantity?: number;
  itemType?: 'PRODUCT' | 'SERVICE';
};

const money = (n: number) => `RF ${Number(n || 0).toLocaleString('en-RW', { minimumFractionDigits: 0 })}`;

export default function ProformaConvertDialog({
  sale, branchId, open, onClose, onConverted,
}: {
  sale: ProformaSale | null;
  branchId?: number | null;
  open: boolean;
  onClose: () => void;
  /** Called with the freshly created NS sale after a successful conversion. */
  onConverted: (newSale: any) => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [savingQuote, setSavingQuote] = useState(false);
  const [converting, setConverting] = useState(false);
  const [dirty, setDirty] = useState(false);

  // product picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<PickerProduct[]>([]);
  const [searching, setSearching] = useState(false);

  // payment
  const [payMethod, setPayMethod] = useState<'CASH' | 'MOBILE_MONEY' | 'CREDIT_CARD' | 'INSURANCE' | 'DEBT'>('CASH');
  const [amountPaid, setAmountPaid] = useState<number>(0);

  useEffect(() => {
    if (!sale || !open) return;
    setLines(
      sale.saleItems.map((si, i) => ({
        key: `l-${si.id ?? i}`,
        productId: si.productId ?? undefined,
        name: si.serviceName || si.product?.name || 'Item',
        quantity: Number(si.quantity) || 1,
        unitPrice: Number(si.unitPrice) || 0,
        itemType: (si.itemType as 'PRODUCT' | 'SERVICE') || 'PRODUCT',
        serviceName: si.serviceName || undefined,
      })),
    );
    setDirty(false);
    setPickerOpen(false);
    setSearch('');
    setPayMethod('CASH');
  }, [sale, open]);

  const total = useMemo(
    () => lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0),
    [lines],
  );

  useEffect(() => { setAmountPaid(total); }, [total]);

  useEffect(() => {
    if (!pickerOpen) return;
    const id = setTimeout(async () => {
      try {
        setSearching(true);
        const res = await apiClient.getProducts({ page: 1, limit: 50, search, branchId: branchId ?? undefined });
        setResults(parseInventoryGetProductsResponse(res).items as PickerProduct[]);
      } catch {
        toast.error('Could not load products');
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [search, pickerOpen, branchId]);

  const patchLine = (key: string, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setDirty(true);
  };
  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
    setDirty(true);
  };
  const addProduct = (p: PickerProduct) => {
    const pid = Number(p.id);
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === pid);
      if (existing) {
        return prev.map((l) => (l.productId === pid ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...prev,
        {
          key: `l-new-${pid}-${Date.now()}`,
          productId: pid,
          name: p.name,
          quantity: 1,
          unitPrice: Number(p.unitPrice ?? p.price ?? 0),
          itemType: (p.itemType as 'PRODUCT' | 'SERVICE') || 'PRODUCT',
        },
      ];
    });
    setDirty(true);
    setPickerOpen(false);
    setSearch('');
  };

  const toItemsPayload = () =>
    lines.map((l) => ({
      productId: l.itemType === 'SERVICE' ? undefined : l.productId,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      itemType: l.itemType,
      serviceName: l.itemType === 'SERVICE' ? l.serviceName || l.name : undefined,
    }));

  const validate = (): string | null => {
    if (lines.length === 0) return 'Add at least one item';
    for (const l of lines) {
      if (l.quantity <= 0) return `Quantity for "${l.name}" must be greater than 0`;
      if (l.unitPrice <= 0) return `Price for "${l.name}" must be greater than 0`;
      if (l.itemType === 'PRODUCT' && !l.productId) return `"${l.name}" is missing a product link`;
    }
    return null;
  };

  const saveQuote = async () => {
    if (!sale) return;
    const err = validate();
    if (err) { toast.error(err); return; }
    try {
      setSavingQuote(true);
      await apiClient.updateProforma(sale.id, { items: toItemsPayload() });
      toast.success('Proforma updated');
      setDirty(false);
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e?.message || 'Failed to update proforma');
    } finally {
      setSavingQuote(false);
    }
  };

  const convert = async () => {
    if (!sale) return;
    const err = validate();
    if (err) { toast.error(err); return; }

    const cashAmount = payMethod === 'INSURANCE' ? 0 : payMethod === 'DEBT' ? 0 : amountPaid;
    const insuranceAmount = payMethod === 'INSURANCE' ? amountPaid : 0;
    const debtAmount = Math.max(0, total - cashAmount - insuranceAmount);

    try {
      setConverting(true);
      const resp = await apiClient.convertProforma(sale.id, {
        items: toItemsPayload(),
        paymentType: payMethod,
        cashAmount,
        insuranceAmount,
        debtAmount,
      });
      const newSale = (resp as any)?.data ?? resp;
      onConverted(newSale);
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || e?.message || 'Failed to convert proforma');
    } finally {
      setConverting(false);
    }
  };

  const busy = savingQuote || converting;

  return (
    <Drawer open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DrawerContent className="bg-white sm:max-w-2xl">
        <DrawerHeader>
          <DrawerTitle>Convert proforma {sale?.invoiceNumber ? `#${sale.invoiceNumber}` : sale?.saleNumber}</DrawerTitle>
          <DrawerDescription>
            Edit the lines if needed, then take payment to raise the real fiscal invoice.
            The proforma is kept and marked converted.
          </DrawerDescription>
        </DrawerHeader>

        <div className="max-h-[62vh] space-y-4 overflow-y-auto px-5 py-2">
          {/* line editor */}
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">Item</th>
                  <th className="w-20 px-2 py-2.5 text-center">Qty</th>
                  <th className="w-32 px-2 py-2.5 text-right">Unit price</th>
                  <th className="w-28 px-3 py-2.5 text-right">Total</th>
                  <th className="w-10 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td className="px-3 py-2 font-medium text-slate-800">{l.name}</td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min={1}
                        value={l.quantity}
                        onChange={(e) => patchLine(l.key, { quantity: Math.max(0, Number(e.target.value)) })}
                        className="h-8 w-full rounded-md border border-slate-200 px-2 text-center tabular-nums focus:border-blue-400 focus:outline-none"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min={0}
                        value={l.unitPrice}
                        onChange={(e) => patchLine(l.key, { unitPrice: Math.max(0, Number(e.target.value)) })}
                        className="h-8 w-full rounded-md border border-slate-200 px-2 text-right tabular-nums focus:border-blue-400 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">
                      {money(l.quantity * l.unitPrice)}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        onClick={() => removeLine(l.key)}
                        className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        title="Remove"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-400">No items</td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="border-t border-slate-100 p-2">
              {pickerOpen ? (
                <div className="rounded-lg border border-slate-200">
                  <div className="flex items-center gap-2 border-b border-slate-100 px-2">
                    <Search className="h-4 w-4 text-slate-400" />
                    <input
                      autoFocus
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search products…"
                      className="h-9 flex-1 bg-transparent text-sm focus:outline-none"
                    />
                    <button onClick={() => setPickerOpen(false)} className="p-1 text-slate-400 hover:text-slate-700">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="max-h-44 overflow-y-auto">
                    {searching && <div className="px-3 py-3 text-sm text-slate-400">Searching…</div>}
                    {!searching && results.length === 0 && (
                      <div className="px-3 py-3 text-sm text-slate-400">No matches</div>
                    )}
                    {results.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => addProduct(p)}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                      >
                        <span className="font-medium text-slate-700">{p.name}</span>
                        <span className="tabular-nums text-slate-500">{money(Number(p.unitPrice ?? p.price ?? 0))}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setPickerOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50"
                >
                  <Plus className="h-4 w-4" /> Add item
                </button>
              )}
            </div>
          </div>

          {/* payment */}
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-800">Payment</span>
              <span className="text-base font-bold text-blue-700">{money(total)}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {(['CASH', 'MOBILE_MONEY', 'CREDIT_CARD', 'INSURANCE', 'DEBT'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPayMethod(m)}
                  className={cn(
                    'rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors',
                    payMethod === m
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-500 hover:bg-slate-50',
                  )}
                >
                  {m.replace('_', ' ')}
                </button>
              ))}
            </div>
            {payMethod !== 'DEBT' && (
              <label className="mt-3 block text-xs font-medium text-slate-500">
                {payMethod === 'INSURANCE' ? 'Insurance amount' : 'Amount received'}
                <input
                  type="number"
                  min={0}
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(Math.max(0, Number(e.target.value)))}
                  className="mt-1 h-9 w-full rounded-md border border-slate-200 px-2 text-right tabular-nums focus:border-blue-400 focus:outline-none"
                />
              </label>
            )}
            {total - amountPaid > 0.01 && payMethod !== 'DEBT' && (
              <p className="mt-2 text-xs text-rose-600">
                {money(total - amountPaid)} will be recorded as outstanding debt.
              </p>
            )}
          </div>
        </div>

        <DrawerFooter className="flex-row flex-wrap items-center gap-2 border-t border-slate-200 px-5 py-4">
          <button
            onClick={onClose}
            disabled={busy}
            className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-600 hover:bg-white disabled:opacity-50"
          >
            Close
          </button>
          <button
            onClick={saveQuote}
            disabled={busy || !dirty}
            className="h-10 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {savingQuote ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save quote'}
          </button>
          <button
            onClick={convert}
            disabled={busy}
            className="flex-1 h-10 rounded-xl bg-[#1d57c8] text-sm font-semibold text-white hover:bg-[#1748b3] disabled:opacity-50"
          >
            {converting ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : `Convert to sale · ${money(total)}`}
          </button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
