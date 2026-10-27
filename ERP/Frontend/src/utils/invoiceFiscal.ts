/** EBM/VSDC rows returned with sale detail (from API). */
export interface SaleEbmTransaction {
    id?: string | number;
    operation?: string | null;
    submissionStatus?: string;
    ebmInvoiceNumber?: string | null;
    errorMessage?: string | null;
    // Dedicated SDC columns — sdcRcptNo/totalRcptNo are the "A"/"B" halves of the
    // required A/B RT receipt counter (CIS spec §7.24.4/7.25).
    sdcRcptNo?: number | null;
    totalRcptNo?: number | null;
    sdcId?: string | null;
    internalData?: string | null;
    receiptSignature?: string | null;
    rcptLabel?: string | null;
    sdcDateTime?: string | null;
    responseData?: {
        normalized?: {
            ebmInvoiceNumber?: string;
            verificationCode?: string;
            sdcDateTime?: string;
            intrlData?: string;
            vsdcSignature?: string;
        };
    } | null;
}

export function fiscalBlockFromSale(sale: { rcptLabel?: string | null; ebmTransactions?: SaleEbmTransaction[] }) {
    const txs = sale.ebmTransactions ?? [];
    const saleTxs = txs.filter((t) => !t.operation || t.operation === 'SALE');
    const success = saleTxs.find((t) => t.submissionStatus === 'SUCCESS');
    const pending = saleTxs.find((t) =>
        ['PENDING', 'SUBMITTED', 'RETRYING'].includes(t.submissionStatus ?? ''),
    );
    const failed = saleTxs.find((t) => t.submissionStatus === 'FAILED');
    const norm = success?.responseData?.normalized;

    // Prefer dedicated columns, fall back to responseData JSON blob
    return {
        success,
        pending,
        failed,
        ebmInvoiceNumber: success?.ebmInvoiceNumber ?? norm?.ebmInvoiceNumber,
        sdcRcptNo:        success?.sdcRcptNo ?? null,
        totalRcptNo:      success?.totalRcptNo ?? null,
        sdcId:            success?.sdcId ?? null,
        internalData:     success?.internalData ?? norm?.intrlData ?? null,
        receiptSignature: success?.receiptSignature ?? norm?.vsdcSignature ?? norm?.verificationCode ?? null,
        sdcDateTime:      success?.sdcDateTime ?? norm?.sdcDateTime ?? null,
        rcptLabel:        success?.rcptLabel ?? sale.rcptLabel ?? null,
    };
}
