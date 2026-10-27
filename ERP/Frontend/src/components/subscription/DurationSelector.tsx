import { useEffect, useMemo, useState } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

export type BillingMode = 'MONTHLY' | 'YEARLY';

export interface DurationValue {
    months: number;
    billingMode: BillingMode;
}

interface DurationSelectorProps {
    monthlyPrice: number;
    currency?: string;
    value: DurationValue;
    onChange: (value: DurationValue) => void;
    /**
     * For a renewal of a still-active subscription, its current end date —
     * shown as "Current Expiry -> New Expiry" instead of "Start -> End".
     * Pass null/undefined for a brand-new purchase, or when the current
     * subscription has already lapsed (the server starts those fresh from
     * today, same rule this preview follows).
     */
    currentExpiryDate?: Date | null;
    yearlyDiscountPercent?: number;
    disabled?: boolean;
}

const formatCurrency = (amount: number, currency: string) =>
    new Intl.NumberFormat('en-RW', {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);

const formatDate = (date: Date) =>
    new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);

/** Client-side preview of the server-authoritative total (see calculateTotal in subscription.service.ts). */
export const calculateDurationTotal = ({
    monthlyPrice,
    months,
    billingMode,
    yearlyDiscountPercent = 20,
}: {
    monthlyPrice: number;
    months: number;
    billingMode: BillingMode;
    yearlyDiscountPercent?: number;
}): number => {
    if (billingMode === 'YEARLY') {
        const years = months / 12;
        const pricePerYear = monthlyPrice * 12 * (1 - yearlyDiscountPercent / 100);
        return Math.round(pricePerYear * years * 100) / 100;
    }
    return Math.round(monthlyPrice * months * 100) / 100;
};

/**
 * Billing-mode toggle + duration input with a live, client-side preview of
 * price/dates. This is presentation only — the server independently
 * recomputes the total and validity window and never trusts these numbers.
 */
export const DurationSelector = ({
    monthlyPrice,
    currency = 'RWF',
    value,
    onChange,
    currentExpiryDate = null,
    yearlyDiscountPercent = 20,
    disabled = false,
}: DurationSelectorProps) => {
    const isYearly = value.billingMode === 'YEARLY';
    const units = isYearly ? Math.max(1, Math.round(value.months / 12)) : Math.max(1, value.months);

    // Local draft text for the units input, separate from the derived numeric
    // `units` above. This lets the field go empty while the user is clearing
    // the default to type a new number, instead of a controlled value that
    // snaps back to "1" on every keystroke that isn't yet a valid number >= 1.
    const [draftUnits, setDraftUnits] = useState(String(units));

    useEffect(() => {
        setDraftUnits(String(units));
    }, [units]);

    const setBillingMode = (mode: BillingMode) => {
        if (mode === value.billingMode) return;
        onChange({ billingMode: mode, months: mode === 'YEARLY' ? 12 : 1 });
    };

    const handleUnitsChange = (raw: string) => {
        setDraftUnits(raw);
        if (raw === '') return;
        const parsed = Math.floor(Number(raw));
        if (Number.isFinite(parsed) && parsed >= 1) {
            onChange({ billingMode: value.billingMode, months: isYearly ? parsed * 12 : parsed });
        }
    };

    const handleUnitsBlur = () => {
        const parsed = Math.floor(Number(draftUnits));
        if (!Number.isFinite(parsed) || parsed < 1) {
            setDraftUnits(String(units));
        } else {
            setDraftUnits(String(parsed));
        }
    };

    const total = useMemo(
        () => calculateDurationTotal({ monthlyPrice, months: value.months, billingMode: value.billingMode, yearlyDiscountPercent }),
        [monthlyPrice, value.months, value.billingMode, yearlyDiscountPercent]
    );

    const isRenewalExtend = !!currentExpiryDate && currentExpiryDate.getTime() > Date.now();

    const { startDate, endDate } = useMemo(() => {
        const base = isRenewalExtend ? currentExpiryDate! : new Date();
        const end = new Date(base);
        end.setMonth(end.getMonth() + value.months);
        return { startDate: isRenewalExtend ? null : new Date(), endDate: end };
    }, [isRenewalExtend, currentExpiryDate, value.months]);

    return (
        <div className="space-y-4">
            <div>
                <Label className="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                    Billing
                </Label>
                <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-1 bg-gray-50 dark:bg-gray-800">
                    {(['MONTHLY', 'YEARLY'] as BillingMode[]).map((mode) => (
                        <button
                            key={mode}
                            type="button"
                            disabled={disabled}
                            onClick={() => setBillingMode(mode)}
                            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                value.billingMode === mode
                                    ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                            }`}
                        >
                            {mode === 'MONTHLY' ? 'Monthly' : `Yearly (${yearlyDiscountPercent}% off)`}
                        </button>
                    ))}
                </div>
            </div>

            <div>
                <Label htmlFor="duration-units" className="mb-2 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                    {isYearly ? 'Number of Years' : 'Number of Months'}
                </Label>
                <Input
                    id="duration-units"
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={draftUnits}
                    disabled={disabled}
                    onChange={(e) => handleUnitsChange(e.target.value)}
                    onBlur={handleUnitsBlur}
                    className="max-w-[140px]"
                />
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Monthly Price</span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(monthlyPrice, currency)}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">{isYearly ? 'Years' : 'Months'}</span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{units}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">{startDate ? 'Start Date' : 'Current Expiry'}</span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                        {formatDate(startDate ?? currentExpiryDate!)}
                    </span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">{startDate ? 'End Date' : 'New Expiry'}</span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{formatDate(endDate)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">Total Amount</span>
                    <span className="font-bold text-indigo-600 dark:text-indigo-400 text-base">{formatCurrency(total, currency)}</span>
                </div>
            </div>
        </div>
    );
};
