import { z } from 'zod';

// Money columns are Decimal(15,2): at most 13 integer digits + 2 decimals.
export const MAX_SALE_AMOUNT = 9_999_999_999_999.99;
const AMOUNT_TOO_LARGE = 'Amount exceeds the maximum of 9,999,999,999,999.99 (13 digits + 2 decimals)';

const money = (negativeMessage: string) =>
  z.coerce.number().nonnegative(negativeMessage).max(MAX_SALE_AMOUNT, AMOUNT_TOO_LARGE);

// The POS sends `null` in "All Branches" mode; z.coerce would turn it into 0.
const optionalId = () =>
  z.preprocess((v) => (v === null || v === '' ? undefined : v), z.coerce.number().positive().optional());

const itemsWithinLimit = (items: Array<{ quantity: number; unitPrice: number }> | undefined) =>
  !items || items.every((i) => i.quantity * i.unitPrice <= MAX_SALE_AMOUNT)
    && items.reduce((s, i) => s + i.quantity * i.unitPrice, 0) <= MAX_SALE_AMOUNT;

const ITEMS_TOO_LARGE = {
  message: 'Line or sale total exceeds the maximum of 9,999,999,999,999.99 (13 digits + 2 decimals)',
  path: ['items'],
};

export const saleItemSchema = z.object({
  productId: z.coerce.number().positive('Product ID must be positive').optional(),
  // Quantity column is Decimal(15,3): at most 12 integer digits.
  quantity: z.coerce.number().positive('Quantity must be positive').max(999_999_999_999.999, 'Quantity exceeds the maximum of 999,999,999,999.999'),
  unitPrice: z.coerce.number().positive('Unit price must be positive').max(MAX_SALE_AMOUNT, AMOUNT_TOO_LARGE),
  discount: money('Discount cannot be negative').optional(),
  itemType: z.enum(['PRODUCT', 'RAW_MATERIAL', 'SERVICE']).default('PRODUCT'),
  serviceName: z.string().optional(),
  serviceDescription: z.string().optional(),
}).refine(
  (data) => {
    if (data.itemType !== 'SERVICE' && !data.productId) {
      return false;
    }
    return true;
  },
  { message: 'productId is required for stock-tracked items', path: ['productId'] }
);

const salePaymentSchema = z.object({
  paymentMethod: z.enum(['CASH', 'BANK', 'BANK_CHECK', 'CARD', 'PAYPACK', 'MTN_MOMO', 'AIRTEL_MONEY', 'WALLET', 'GIFT_CARD', 'STORE_CREDIT']),
  amount: z.coerce.number().positive('Payment amount must be positive').max(MAX_SALE_AMOUNT, AMOUNT_TOO_LARGE),
  reference: z.string().max(200).nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const createSaleSchema = z.object({
  body: z.object({
    customerId: z.coerce.number().positive('Customer ID required'),
    items: z.array(saleItemSchema).min(1, 'Sale must have at least one item'),
    // Optional: a PROFORMA quote collects no payment, so the frontend sends
    // debtAmount/cashAmount/insuranceAmount without a paymentType — the
    // controller derives finalPaymentType from those amounts when omitted.
    paymentType: z.enum(['CASH', 'DEBT', 'INSURANCE', 'MIXED', 'MOBILE_MONEY', 'CREDIT_CARD', 'BANK_CHECK']).optional(),
    cashAmount: money('Cash amount cannot be negative').optional(),
    debtAmount: money('Debt amount cannot be negative').optional(),
    insuranceAmount: money('Insurance amount cannot be negative').optional(),
    notes: z.string().optional(),
    shiftId: optionalId(),
    branchId: optionalId(),
    payments: z.array(salePaymentSchema).optional(),
    // Mode the POS was showing; the sale is refused (409) if the org switched.
    receiptMode: z.enum(['TRAINING', 'NORMAL']).optional(),
  }).refine((b) => itemsWithinLimit(b.items), ITEMS_TOO_LARGE),
  params: z.object({
    organizationId: z.coerce.number().positive('Organization ID required'),
  }),
});

export const updateProformaSchema = z.object({
  body: z.object({
    customerId: z.coerce.number().positive().optional(),
    items: z.array(saleItemSchema).min(1, 'A proforma must have at least one item'),
  }).refine((b) => itemsWithinLimit(b.items), ITEMS_TOO_LARGE),
  params: z.object({
    organizationId: z.coerce.number().positive('Organization ID required'),
    saleId: z.coerce.number().positive('Sale ID required'),
  }),
});

export const convertProformaSchema = z.object({
  body: z.object({
    customerId: z.coerce.number().positive().optional(),
    items: z.array(saleItemSchema).min(1).optional(),
    paymentType: z.enum(['CASH', 'DEBT', 'INSURANCE', 'MIXED', 'MOBILE_MONEY', 'CREDIT_CARD', 'BANK_CHECK']).optional(),
    cashAmount: money('Cash amount cannot be negative').optional(),
    debtAmount: money('Debt amount cannot be negative').optional(),
    insuranceAmount: money('Insurance amount cannot be negative').optional(),
    shiftId: z.coerce.number().positive().optional(),
    payments: z.array(salePaymentSchema).optional(),
  }).refine((b) => itemsWithinLimit(b.items), ITEMS_TOO_LARGE),
  params: z.object({
    organizationId: z.coerce.number().positive('Organization ID required'),
    saleId: z.coerce.number().positive('Sale ID required'),
  }),
});

export const cancelSaleSchema = z.object({
  body: z.object({
    reason: z.string().min(5, 'Cancellation reason must be at least 5 characters'),
  }),
  params: z.object({
    organizationId: z.coerce.number().positive('Organization ID required'),
    saleId: z.coerce.number().positive('Sale ID required'),
  }),
});

export const refundSaleSchema = z.object({
  body: z.object({
    // Human justification for the refund — always required (an NR without a
    // recorded reason is rejected). Code 13 ("Other reason") additionally
    // needs a real explanation (min 5 chars, enforced in the controller).
    reason: z.string().min(1, 'Refund reason is required').max(500),
    // RRA refund reason code (VSDC code class 32, sent as rfdRsnCd). Optional
    // for backwards compatibility — the controller defaults it to '06 Refund'.
    rfdRsnCd: z.string().regex(/^\d{2}$/, 'Refund reason code must be two digits').optional(),
    // Partial refund selection. Omitted (or empty) = full refund of every
    // remaining line. Each entry refunds part of ONE original sale item and
    // must stay within that line's remaining refundable quantity.
    items: z.array(z.object({
      saleItemId: z.coerce.number().positive('Sale item ID required'),
      quantity: z.coerce.number().positive('Refund quantity must be positive'),
    })).optional(),
    // Person receiving the refund. Defaults to the original customer name.
    recipientName: z.string().max(200).optional(),
    receiptMode: z.enum(['TRAINING', 'NORMAL']).optional(),
  }),
  params: z.object({
    id: z.coerce.number().positive('Sale ID required'),
    organizationId: z.coerce.number().positive('Organization ID required'),
  }),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type CancelSaleInput = z.infer<typeof cancelSaleSchema>;
export type RefundSaleInput = z.infer<typeof refundSaleSchema>;
export type UpdateProformaInput = z.infer<typeof updateProformaSchema>;
export type ConvertProformaInput = z.infer<typeof convertProformaSchema>;

/**
 * Pre-approval correction (2018 spec Art. 12): fix a COMPLETED sale that the
 * VSDC has NOT yet confirmed, replacing it with a corrected sale that
 * references the cancelled original. Only unfiscalized sales qualify — once
 * VSDC has approved (SUCCEEDED), the receipt is immutable and only a
 * refund/void may follow.
 */
export const correctSaleSchema = z.object({
  body: z.object({
    customerId: z.coerce.number().positive().optional(),
    items: z.array(saleItemSchema).min(1, 'Corrected sale must have at least one item'),
    reason: z.string().min(5, 'Correction reason must be at least 5 characters'),
    paymentType: z.enum(['CASH', 'DEBT', 'INSURANCE', 'MIXED', 'MOBILE_MONEY', 'CREDIT_CARD', 'BANK_CHECK']).optional(),
    cashAmount: z.coerce.number().nonnegative('Cash amount cannot be negative').optional(),
    debtAmount: z.coerce.number().nonnegative('Debt amount cannot be negative').optional(),
    insuranceAmount: z.coerce.number().nonnegative('Insurance amount cannot be negative').optional(),
    shiftId: z.coerce.number().positive().optional(),
    payments: z.array(salePaymentSchema).optional(),
  }),
  params: z.object({
    organizationId: z.coerce.number().positive('Organization ID required'),
    saleId: z.coerce.number().positive('Sale ID required'),
  }),
});

export type CorrectSaleInput = z.infer<typeof correctSaleSchema>;
