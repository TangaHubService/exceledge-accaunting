import { renderToFile } from '@react-pdf/renderer';
import React from 'react';
import InvoicePDF, { type BillingPayment } from '../src/components/invoice/InvoicePDF';
import type { Profile } from '../src/types';

const payment: BillingPayment = {
    id: 'pm_3JkLx2Test-7841289-abc',
    amount: 150000,
    currency: 'RWF',
    status: 'SUCCEEDED',
    paymentMethod: 'CARD',
    createdAt: new Date().toISOString(),
    metadata: {
        provider: 'dpopay',
        payment_method: 'CARD',
        paymentId: 'GTX-88912',
        processedAt: new Date().toISOString(),
    },
    subscription: {
        plan: { name: 'Enterprise', price: 150000, currency: 'RWF' },
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 30 * 86400000).toISOString(),
        autoRenew: true,
        organization: {
            id: 34,
            name: 'Test Customer Biz',
            TIN: '123456789',
            address: 'Kigali, Rwanda',
        },
    },
    invoiceNumber: 'INV-6789-B34-2026-000042',
    ebmInvoiceNumber: '99990001234',
    submissionStatus: 'SUCCESS',
    submittedAt: new Date().toISOString(),
    sdcDateTime: new Date().toISOString(),
    sdcId: 'SDC12345678',
    sdcRcptNo: 42,
    totalRcptNo: 1234,
    internalData: 'INT-ABCDEFGH1234',
    receiptSignature: 'SIG-7F3A9C2E1B8D4F6A0C5E9B1D7F3A9C2E',
    qrPayload: '',
    rcptLabel: 'NS',
    errorMessage: null,
};

const profile = {
    id: 42,
    name: 'Test Customer Biz',
    phone: '+250 788 000 000',
    email: 'customer@example.com',
} as Profile;

async function main() {
    const out = `${__dirname}/test-invoice-output.pdf`;
    await renderToFile(React.createElement(InvoicePDF, { payment, profile }), out);
    console.log('PDF written to', out);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});