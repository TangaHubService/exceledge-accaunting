import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter } from '../../components/ui/drawer';
import { useEffect, useState } from 'react';
import { ChevronDown, ShieldCheck, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import PhoneInputWithCountryCode from '../../components/PhoneInputWithCountryCode';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { yupResolver } from '@hookform/resolvers/yup';
import { apiClient } from '../../lib/api-client';

import type { CustomerFormData } from '../../types/customer';
import { customerSchema } from '../../schema/customer';

interface CustomerFormProps {
    initialData: Partial<CustomerFormData>;
    onSubmit: (data: CustomerFormData) => void;
    onClose: () => void;
    isLoading: boolean;
}

export function CustomerForm({
    initialData,
    onSubmit,
    onClose,
    isLoading,
}: CustomerFormProps) {
    const { t } = useTranslation();

    const [rraCheck, setRraCheck] = useState<{ state: 'idle' | 'loading' | 'ok' | 'error'; message?: string }>({ state: 'idle' });

    const {
        register,
        handleSubmit,
        setValue,
        reset,
        formState: { errors: formErrors },
        watch,
    } = useForm<CustomerFormData>({
        resolver: yupResolver(customerSchema) as any,
        defaultValues: {
            name: '',
            email: '',
            phone: '',
            tin: '',
            address: '',
            custPrvncNm: '',
            custDstrtNm: '',
            custSctrNm: '',
            custLocDesc: '',
            type: 'INDIVIDUAL',
            balance: 0,
            isrccCd: '',
            isrcRt: undefined,
        },
    });

    const customerType = watch('type');

    useEffect(() => {
        if (initialData) {
            const formData = {
                name: initialData.name || '',
                email: initialData.email || '',
                phone: initialData.phone || '',
                tin: initialData.tin || '',
                address: (initialData as any).address || '',
                custPrvncNm: (initialData as any).custPrvncNm || '',
                custDstrtNm: (initialData as any).custDstrtNm || '',
                custSctrNm: (initialData as any).custSctrNm || '',
                custLocDesc: (initialData as any).custLocDesc || '',
                type: initialData.type || 'INDIVIDUAL',
                balance: initialData.balance || 0,
                isrccCd: (initialData as any).isrccCd || '',
                isrcRt: (initialData as any).isrcRt ?? undefined,
            };
            reset(formData);
        } else {
            reset({
                name: '',
                email: '',
                phone: '',
                tin: '',
                address: '',
                custPrvncNm: '',
                custDstrtNm: '',
                custSctrNm: '',
                custLocDesc: '',
                type: 'INDIVIDUAL',
                balance: 0,
                isrccCd: '',
                isrcRt: undefined,
            });
        }
    }, [initialData, reset]);

    const phoneValue = watch('phone');



    const handleFormSubmit = (data: CustomerFormData) => {
        // A TIN may be stored for every customer type — individuals may hold a
        // real RRA TIN too, and when present it is used on the fiscal receipt
        // (sent to RRA) instead of a walk-in placeholder. Blank stays blank.
        onSubmit({ ...data, tin: (data.tin || '').trim() });
    };

    return (
        <Drawer open={true} onOpenChange={onClose}>
      <DrawerContent
        className="sm:max-w-[680px] bg-white border-gray-200"
      >
        <DrawerHeader>
          <DrawerTitle className="text-xl font-semibold mb-2">
            {initialData?.id ? t('customers.editCustomer') : t('customers.addNewCustomer')}
          </DrawerTitle>
        </DrawerHeader>


                <div className="px-6 pb-6">
                    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-5 space-y-5">
                        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
                            <div>
                                <label
                                    htmlFor="name"
                                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                                >
                                    {t('customers.fullName')} *
                                </label>

                                <input
                                    id="name"
                                    type="text"
                                    className={`w-full rounded-md border bg-white dark:bg-gray-700 ${formErrors.name ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'} px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white`}
                                    {...register('name')}
                                />
                                {formErrors.name && (
                                    <p className="mt-1 text-sm text-red-600">{formErrors.name.message}</p>
                                )}
                            </div>

                            <div>
                                <label
                                    htmlFor="email"
                                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                                >
                                    {t('common.email')}
                                </label>

                                <input
                                    id="email"
                                    type="email"
                                    className={`w-full rounded-md border bg-white dark:bg-gray-700 ${formErrors.email ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'} px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white`}
                                    {...register('email')}
                                />

                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    {t('customers.phoneNumber')} <span className="text-gray-400 font-normal text-xs">({t('common.optional') || 'optional'})</span>
                                </label>
                                <PhoneInputWithCountryCode
                                    value={phoneValue ?? undefined}
                                    onChange={(value: string) => setValue('phone', value, { shouldValidate: false })}
                                    className={`w-full ${formErrors.phone ? 'border-red-500' : ''}`}
                                    placeholder="e.g. 788123456"
                                    disabled={isLoading}
                                    error={formErrors.phone ? String(formErrors.phone.message) : ''}
                                />
                            </div>

                            <div>
                                <label
                                    htmlFor="tin"
                                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                                >
                                    {t('customers.tinNumber')}{' '}
                                    {customerType !== 'INDIVIDUAL' ? (
                                        <span className="text-red-500">*</span>
                                    ) : (
                                        <span className="text-gray-400 font-normal text-xs">({t('common.optional') || 'optional'})</span>
                                    )}
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        id="tin"
                                        type="text"
                                        inputMode="numeric"
                                        maxLength={9}
                                        placeholder="e.g. 123456789"
                                        className={`w-full rounded-md border bg-white dark:bg-gray-700 ${formErrors.tin ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'} px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white`}
                                        {...register('tin')}
                                        onChange={(e) => {
                                            // TIN is a 9-digit RRA number, never the phone field's "+countrycode"
                                            // shape — strip anything but digits so the two can't get swapped.
                                            const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 9);
                                            setValue('tin', digitsOnly, { shouldValidate: true });
                                            setRraCheck({ state: 'idle' });
                                        }}
                                    />
                                    <button
                                        type="button"
                                        disabled={rraCheck.state === 'loading' || !/^\d{9}$/.test((watch('tin') || '').trim())}
                                        onClick={async () => {
                                            const tin = (watch('tin') || '').trim();
                                            setRraCheck({ state: 'loading' });
                                            try {
                                                const res = await apiClient.verifyCustomerWithRra(tin, (initialData as any)?.id);
                                                const data = (res as any)?.data ?? res;
                                                if (data?.found) {
                                                    if (data.taxprNm && !watch('name')) setValue('name', data.taxprNm, { shouldValidate: true });
                                                    setRraCheck({ state: 'ok', message: `RRA: ${data.taxprNm ?? 'registered'}${data.taxprSttsCd ? ` (status ${data.taxprSttsCd})` : ''}` });
                                                    const customerId = (initialData as any)?.id;
                                                    if (customerId) {
                                                        try {
                                                            await apiClient.syncCustomerToRra(customerId);
                                                        } catch {
                                                            /* push is best-effort after verify */
                                                        }
                                                    }
                                                } else {
                                                    setRraCheck({ state: 'error', message: 'RRA has no taxpayer for this TIN' });
                                                }
                                            } catch (err: any) {
                                                setRraCheck({ state: 'error', message: err?.message ?? 'RRA verification failed' });
                                            }
                                        }}
                                        className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-gray-300 dark:border-gray-600 px-3 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                                    >
                                        {rraCheck.state === 'loading' ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                                        Verify
                                    </button>
                                </div>
                                {formErrors.tin && (
                                    <p className="mt-1 text-sm text-red-600">{formErrors.tin.message}</p>
                                )}
                                {rraCheck.state === 'ok' && (
                                    <p className="mt-1 flex items-center gap-1.5 text-sm text-emerald-600"><CheckCircle2 className="size-4" />{rraCheck.message}</p>
                                )}
                                {rraCheck.state === 'error' && (
                                    <p className="mt-1 flex items-center gap-1.5 text-sm text-amber-600"><AlertTriangle className="size-4" />{rraCheck.message}</p>
                                )}
                            </div>
                            {customerType === 'INDIVIDUAL' && (
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                Optional — when the individual has a real RRA TIN it is printed on the fiscal receipt and sent to RRA.
                              </p>
                            )}

                            <div>
                                <label
                                    htmlFor="address"
                                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                                >
                                    {t('customers.address')} <span className="text-gray-400 font-normal text-xs">({t('common.optional') || 'optional'})</span>
                                </label>
                                <input
                                    id="address"
                                    type="text"
                                    placeholder={t('customers.addressPlaceholder') || 'e.g. KG 7 Ave, Kigali'}
                                    className={`w-full rounded-md border bg-white dark:bg-gray-700 ${formErrors.address ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'} px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white`}
                                    {...register('address')}
                                />
                                {formErrors.address && (
                                    <p className="mt-1 text-sm text-red-600">{formErrors.address.message}</p>
                                )}
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label htmlFor="custPrvncNm" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        {t('customers.province')} <span className="text-gray-400 font-normal text-xs">({t('common.optional') || 'optional'})</span>
                                    </label>
                                    <input id="custPrvncNm" type="text" placeholder="e.g. Kigali City"
                                        className="w-full rounded-md border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"
                                        {...register('custPrvncNm')} />
                                </div>
                                <div>
                                    <label htmlFor="custDstrtNm" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        {t('customers.district')} <span className="text-gray-400 font-normal text-xs">({t('common.optional') || 'optional'})</span>
                                    </label>
                                    <input id="custDstrtNm" type="text" placeholder="e.g. Gasabo"
                                        className="w-full rounded-md border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"
                                        {...register('custDstrtNm')} />
                                </div>
                                <div>
                                    <label htmlFor="custSctrNm" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        {t('customers.sector')} <span className="text-gray-400 font-normal text-xs">({t('common.optional') || 'optional'})</span>
                                    </label>
                                    <input id="custSctrNm" type="text" placeholder="e.g. Remera"
                                        className="w-full rounded-md border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"
                                        {...register('custSctrNm')} />
                                </div>
                                <div>
                                    <label htmlFor="custLocDesc" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        {t('customers.streetCell')} <span className="text-gray-400 font-normal text-xs">({t('common.optional') || 'optional'})</span>
                                    </label>
                                    <input id="custLocDesc" type="text" placeholder="e.g. KG 7 Ave"
                                        className="w-full rounded-md border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"
                                        {...register('custLocDesc')} />
                                </div>
                            </div>

                            <div>
                                <label
                                    htmlFor="type"
                                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                                >
                                    {t('customers.customerType')} *
                                </label>

                                <div className="relative w-full">
                                    <select
                                        id="type"
                                        className={`w-full appearance-none rounded-md border bg-white dark:bg-gray-700 ${formErrors.type ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'} px-3 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white`}
                                        {...register('type')}
                                    >
                                        <option value="INDIVIDUAL">{t('customers.individual')}</option>
                                        <option value="CORPORATE">{t('customers.corporate')}</option>
                                        <option value="INSURANCE">{t('customers.insurance')}</option>
                                    </select>
                                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
                                </div>

                                {formErrors.type && (
                                    <p className="mt-1 text-sm text-red-600">{formErrors.type.message}</p>
                                )}
                            </div>

                            {customerType === 'INSURANCE' && (
                                <>
                                    <div>
                                        <label
                                            htmlFor="isrccCd"
                                            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                                        >
                                            Insurance code (isrccCd) *
                                        </label>
                                        <input
                                            id="isrccCd"
                                            type="text"
                                            maxLength={10}
                                            placeholder="ISRCC01"
                                            className={`w-full rounded-md border bg-white dark:bg-gray-700 ${formErrors.isrccCd ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'} px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white`}
                                            {...register('isrccCd')}
                                        />
                                        {formErrors.isrccCd && (
                                            <p className="mt-1 text-sm text-red-600">{formErrors.isrccCd.message}</p>
                                        )}
                                        <p className="mt-1 text-xs text-gray-500">RRA insurance company code pushed via saveBrancheInsurances.</p>
                                    </div>
                                    <div>
                                        <label
                                            htmlFor="isrcRt"
                                            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                                        >
                                            Premium rate (%)
                                        </label>
                                        <input
                                            id="isrcRt"
                                            type="number"
                                            step="0.01"
                                            min={0}
                                            max={100}
                                            className={`w-full rounded-md border bg-white dark:bg-gray-700 ${formErrors.isrcRt ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'} px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white`}
                                            {...register('isrcRt')}
                                        />
                                        {formErrors.isrcRt && (
                                            <p className="mt-1 text-sm text-red-600">{formErrors.isrcRt.message}</p>
                                        )}
                                    </div>
                                </>
                            )}

                            <div>
                                <label
                                    htmlFor="balance"
                                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                                >
                                    {t('common.total')} *
                                </label>

                                <input
                                    id="balance"
                                    type="number"
                                    step="0.01"
                                    className={`w-full rounded-md border bg-white dark:bg-gray-700 ${formErrors.balance ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'} px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white ${initialData?.id ? 'bg-gray-100 dark:bg-gray-600 cursor-not-allowed' : ''}`}
                                    {...register('balance')}
                                    readOnly={!!initialData?.id}
                                    disabled={!!initialData?.id}
                                />
                                {formErrors.balance && (
                                    <p className="mt-1 text-sm text-red-600">{formErrors.balance.message}</p>
                                )}
                            </div>

                            <DrawerFooter className="flex justify-end space-x-3 pt-4 px-0">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                                    disabled={isLoading}
                                >
                                    {t('common.cancel')}
                                </button>

                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isLoading ? (
                                        <span className="flex items-center">
                                            <svg
                                                className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                                                xmlns="http://www.w3.org/2000/svg"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                            >
                                                <circle
                                                    className="opacity-25"
                                                    cx="12"
                                                    cy="12"
                                                    r="10"
                                                    stroke="currentColor"
                                                    strokeWidth="4"
                                                ></circle>
                                                <path
                                                    className="opacity-75"
                                                    fill="currentColor"
                                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                                ></path>
                                            </svg>
                                            {initialData?.id ? t('common.updating') : t('common.creating')}
                                        </span>
                                    ) : initialData?.id ? (
                                        t('customers.updateCustomer')
                                    ) : (
                                        t('customers.createCustomer')
                                    )}

                                </button>
                            </DrawerFooter>
                        </form>
                    </div>
                </div>
            </DrawerContent>
        </Drawer>
    );
}