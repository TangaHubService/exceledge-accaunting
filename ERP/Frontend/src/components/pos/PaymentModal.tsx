import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from '../common/ConfirmDialog';
import {
  Loader2, Check, Plus, X, Shield, Smartphone, CreditCard,
  FileText, Wallet, Lock,
} from 'lucide-react';

interface PaymentEntry {
  id: string;
  method: string;
  amount: number;
  reference?: string;
}

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalAmount: number;
  onProcessPayment: (payments: PaymentEntry[]) => Promise<void>;
  isProcessing?: boolean;
}

const PAYMENT_METHODS = [
  { value: 'CASH',         label: 'Cash',         icon: Wallet     },
  { value: 'MOBILE_MONEY', label: 'Mobile Money',  icon: Smartphone },
  { value: 'CREDIT_CARD',  label: 'Card',          icon: CreditCard },
  { value: 'DEBT',         label: 'Debt',          icon: FileText   },
  { value: 'BANK_CHECK',   label: 'Bank Check',    icon: FileText   },
  { value: 'INSURANCE',    label: 'Insurance',     icon: Shield     },
];

const QUICK_AMOUNTS_EXTRA = [10000, 5000, 1000];

export function PaymentModal({
  isOpen,
  onClose,
  totalAmount,
  onProcessPayment,
  isProcessing = false,
}: PaymentModalProps) {
  const { t } = useTranslation();
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const pendingPaymentsRef = useRef<PaymentEntry[]>([]);

  /* ── reset on open ─────────────────────────────────────────────── */
  useEffect(() => {
    if (isOpen) {
      setPayments([{ id: Date.now().toString(), method: 'CASH', amount: 0 }]);
      setCurrentIndex(0);
    }
  }, [isOpen]);

  /* ── helpers ───────────────────────────────────────────────────── */
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const remaining = totalAmount - totalPaid;
  const current   = payments[currentIndex] ?? payments[0];

  const update = (idx: number, field: keyof PaymentEntry, value: string | number) => {
    setPayments(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const selectMethod = (method: string) => {
    if (!current) return;
    const otherPaid = payments.reduce((s, p, i) => i === currentIndex ? s : s + (p.amount || 0), 0);
    const due = Math.max(0, totalAmount - otherPaid);
    update(currentIndex, 'method', method);
    update(currentIndex, 'amount', due);
  };

  const setAmount = (val: number) => {
    const otherPaid = payments.reduce((s, p, i) => i === currentIndex ? s : s + (p.amount || 0), 0);
    const max = totalAmount - otherPaid;
    update(currentIndex, 'amount', Math.max(0, Math.min(val, max)));
  };

  const addPaymentMethod = () => {
    if (totalPaid >= totalAmount) return;
    const due = Math.max(0, totalAmount - totalPaid);
    const newEntry: PaymentEntry = { id: Date.now().toString(), method: 'CASH', amount: due };
    setPayments(prev => [...prev, newEntry]);
    setCurrentIndex(payments.length);
  };

  const removePayment = (idx: number) => {
    setPayments(prev => prev.filter((_, i) => i !== idx));
    setCurrentIndex(prev => Math.max(0, prev - 1));
  };

  const handleProcess = async () => {
    if (submittingRef.current || isProcessing) return;
    submittingRef.current = true;
    try {
      const valid = payments.filter(p => p.amount > 0);
      const paid  = valid.reduce((s, p) => s + p.amount, 0);
      const rem   = totalAmount - paid;
      if (Math.abs(rem) > 0.01) {
        const msg = rem > 0
          ? t('pos.confirmPartialPayment') || `Amount is incomplete (${rem.toLocaleString()} RWF remaining). Continue?`
          : t('pos.confirmOverpayment')    || `Amount exceeds total. Continue?`;
        pendingPaymentsRef.current = valid;
        setConfirmMsg(msg);
        return;
      }
      await onProcessPayment(valid);
    } finally {
      submittingRef.current = false;
    }
  };

  const handleConfirmProcess = async () => {
    setConfirmMsg(null);
    submittingRef.current = true;
    try {
      await onProcessPayment(pendingPaymentsRef.current);
    } finally {
      submittingRef.current = false;
    }
  };

  if (!isOpen) return null;

  /* ── quick amounts: total + extras ────────────────────────────── */
  const quickAmounts = [totalAmount, ...QUICK_AMOUNTS_EXTRA].filter(
    (v, i, arr) => arr.indexOf(v) === i && v > 0,
  );

  /* ── render ────────────────────────────────────────────────────── */
  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end"
      onClick={onClose}
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
    >
      {/* Panel */}
      <div
        className="relative flex flex-col bg-white h-full w-full max-w-[420px] shadow-2xl overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >

        {/* ── Header ────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <h2 className="text-lg font-bold text-gray-900">Process Payment</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Total / Paid / Remaining bar ──────────────────────── */}
        <div className="mx-6 mb-6 grid grid-cols-3 divide-x divide-gray-100 rounded-2xl border border-gray-100 bg-gray-50 overflow-hidden">
          <div className="flex flex-col items-center py-4 px-2">
            <p className="text-[11px] font-medium text-gray-400 mb-1">Total</p>
            <p className="text-base font-bold text-gray-900 tabular-nums">
              {totalAmount.toLocaleString()}
              <span className="ml-1 text-xs font-normal text-gray-400">RWF</span>
            </p>
          </div>
          <div className="flex flex-col items-center py-4 px-2">
            <p className="text-[11px] font-medium text-gray-400 mb-1">Paid</p>
            <p className="text-base font-bold text-emerald-600 tabular-nums">
              {totalPaid.toLocaleString()}
              <span className="ml-1 text-xs font-normal text-gray-400">RWF</span>
            </p>
          </div>
          <div className="flex flex-col items-center py-4 px-2">
            <p className="text-[11px] font-medium text-gray-400 mb-1">Remaining</p>
            <p className={`text-base font-bold tabular-nums ${remaining > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
              {remaining.toLocaleString()}
              <span className="ml-1 text-xs font-normal text-gray-400">RWF</span>
            </p>
          </div>
        </div>

        {/* ── Multi-payment tabs (if >1) ────────────────────────── */}
        {payments.length > 1 && (
          <div className="mx-6 mb-4 flex items-center gap-2 flex-wrap">
            {payments.map((p, idx) => {
              const M = PAYMENT_METHODS.find(m => m.value === p.method);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setCurrentIndex(idx)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    idx === currentIndex
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-gray-100 text-gray-600 border-gray-200 hover:border-blue-300'
                  }`}
                >
                  {M && <M.icon className="h-3 w-3" />}
                  {M?.label} · {p.amount.toLocaleString()}
                  {payments.length > 1 && (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); removePayment(idx); }}
                      className="ml-1 opacity-60 hover:opacity-100"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* ── Payment Method label ──────────────────────────────── */}
        <div className="px-6 mb-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Payment Method {payments.length > 1 ? `(${currentIndex + 1}/${payments.length})` : ''}
          </p>
        </div>

        {/* ── Method grid ──────────────────────────────────────── */}
        <div className="px-6 mb-5 grid grid-cols-2 gap-3">
          {PAYMENT_METHODS.slice(0, 4).map(m => {
            const selected = current?.method === m.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => selectMethod(m.value)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                  selected
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:bg-blue-50/50'
                }`}
              >
                <span className={`p-1.5 rounded-lg ${selected ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                  <m.icon className="h-4 w-4" />
                </span>
                {m.label}
              </button>
            );
          })}
          {/* Insurance — full-width row */}
          {(() => {
            const m = PAYMENT_METHODS[4];
            const selected = current?.method === m.value;
            return (
              <button
                type="button"
                onClick={() => selectMethod(m.value)}
                className={`col-span-2 flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                  selected
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300 hover:bg-blue-50/50'
                }`}
              >
                <span className={`p-1.5 rounded-lg ${selected ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                  <m.icon className="h-4 w-4" />
                </span>
                {m.label}
              </button>
            );
          })()}
        </div>

        {/* ── Amount input ──────────────────────────────────────── */}
        <div className="px-6 mb-4">
          <label className="block text-xs font-semibold text-gray-500 mb-2">
            Amount ({PAYMENT_METHODS.find(m => m.value === current?.method)?.label ?? 'Cash'})
          </label>
          <div className="relative">
            <input
              type="number"
              min="0"
              value={current?.amount || ''}
              onChange={e => setAmount(parseFloat(e.target.value) || 0)}
              placeholder="0"
              className="w-full h-12 pl-4 pr-16 rounded-xl border-2 border-gray-200 text-gray-900 text-sm font-bold focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all bg-white"
              autoFocus
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400">
              RWF
            </span>
          </div>

          {/* Reference (for mobile, card, debt) */}
          {(current?.method === 'MOBILE_MONEY' || current?.method === 'CREDIT_CARD' || current?.method === 'DEBT') && (
            <input
              type="text"
              value={current?.reference || ''}
              onChange={e => update(currentIndex, 'reference', e.target.value)}
              placeholder={t('pos.referencePlaceholder') || 'Transaction reference (optional)'}
              className="mt-2 w-full h-10 px-4 rounded-xl border border-gray-200 text-sm text-gray-700 focus:outline-none focus:border-blue-400 transition-all bg-gray-50"
            />
          )}
        </div>

        {/* ── Quick Amounts ─────────────────────────────────────── */}
        <div className="px-6 mb-4">
          <p className="text-xs font-semibold text-gray-500 mb-2">Quick Amounts</p>
          <div className="flex flex-wrap gap-2">
            {quickAmounts.map(amt => (
              <button
                key={amt}
                type="button"
                onClick={() => setAmount(amt)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                  current?.amount === amt
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-500/30'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-blue-400 hover:text-blue-600'
                }`}
              >
                {amt.toLocaleString()}
              </button>
            ))}
          </div>
        </div>

        {/* ── Add Another Payment Method ────────────────────────── */}
        <div className="px-6 mb-5">
          <button
            type="button"
            onClick={addPaymentMethod}
            disabled={totalPaid >= totalAmount}
            className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Another Payment Method
          </button>
        </div>

        {/* ── Remaining pill ────────────────────────────────────── */}
        <div className="mx-6 mb-6 flex items-center justify-between px-5 py-3.5 rounded-xl bg-indigo-50 border border-indigo-100">
          <span className="text-sm font-semibold text-indigo-700">Remaining</span>
          <span className={`text-base font-extrabold tabular-nums ${remaining > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
            {remaining.toLocaleString()} RWF
          </span>
        </div>

        {/* ── Footer buttons ────────────────────────────────────── */}
        <div className="mt-auto px-6 pb-6 space-y-3">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isProcessing}
              className="flex-1 h-11 rounded-xl border-2 border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleProcess}
              disabled={isProcessing || totalPaid <= 0}
              className="flex-1 h-11 flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition-all shadow-md shadow-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</>
              ) : (
                <>Process Payment <Check className="h-4 w-4" /></>
              )}
            </button>
          </div>

          {/* Secure note */}
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-gray-400">
            <Lock className="h-3 w-3" />
            Payments are secure and encrypted
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmMsg !== null}
        onClose={() => setConfirmMsg(null)}
        onConfirm={handleConfirmProcess}
        title={t('pos.confirmPaymentTitle') || 'Confirm Payment'}
        message={confirmMsg ?? ''}
        confirmText={t('pos.continue') || 'Continue'}
        variant="warning"
      />
    </div>
  );
}
