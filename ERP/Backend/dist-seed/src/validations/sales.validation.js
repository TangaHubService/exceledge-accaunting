"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refundSaleSchema = exports.cancelSaleSchema = exports.convertProformaSchema = exports.updateProformaSchema = exports.createSaleSchema = exports.saleItemSchema = void 0;
const zod_1 = require("zod");
exports.saleItemSchema = zod_1.z.object({
    productId: zod_1.z.coerce.number().positive('Product ID must be positive').optional(),
    quantity: zod_1.z.coerce.number().positive('Quantity must be positive'),
    unitPrice: zod_1.z.coerce.number().positive('Unit price must be positive'),
    discount: zod_1.z.coerce.number().nonnegative('Discount cannot be negative').optional(),
    itemType: zod_1.z.enum(['PRODUCT', 'RAW_MATERIAL', 'SERVICE']).default('PRODUCT'),
    serviceName: zod_1.z.string().optional(),
    serviceDescription: zod_1.z.string().optional(),
}).refine((data) => {
    if (data.itemType !== 'SERVICE' && !data.productId) {
        return false;
    }
    return true;
}, { message: 'productId is required for stock-tracked items', path: ['productId'] });
const salePaymentSchema = zod_1.z.object({
    paymentMethod: zod_1.z.enum(['CASH', 'BANK', 'CARD', 'PAYPACK', 'MTN_MOMO', 'AIRTEL_MONEY', 'WALLET', 'GIFT_CARD', 'STORE_CREDIT']),
    amount: zod_1.z.coerce.number().positive('Payment amount must be positive'),
    reference: zod_1.z.string().max(200).nullish(),
    metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
});
exports.createSaleSchema = zod_1.z.object({
    body: zod_1.z.object({
        customerId: zod_1.z.coerce.number().positive('Customer ID required'),
        items: zod_1.z.array(exports.saleItemSchema).min(1, 'Sale must have at least one item'),
        // Optional: a PROFORMA quote collects no payment, so the frontend sends
        // debtAmount/cashAmount/insuranceAmount without a paymentType — the
        // controller derives finalPaymentType from those amounts when omitted.
        paymentType: zod_1.z.enum(['CASH', 'DEBT', 'INSURANCE', 'MIXED', 'MOBILE_MONEY', 'CREDIT_CARD']).optional(),
        cashAmount: zod_1.z.coerce.number().nonnegative('Cash amount cannot be negative').optional(),
        debtAmount: zod_1.z.coerce.number().nonnegative('Debt amount cannot be negative').optional(),
        insuranceAmount: zod_1.z.coerce.number().nonnegative('Insurance amount cannot be negative').optional(),
        notes: zod_1.z.string().optional(),
        shiftId: zod_1.z.coerce.number().positive().optional(),
        branchId: zod_1.z.coerce.number().positive().optional(),
        payments: zod_1.z.array(salePaymentSchema).optional(),
    }),
    params: zod_1.z.object({
        organizationId: zod_1.z.coerce.number().positive('Organization ID required'),
    }),
});
exports.updateProformaSchema = zod_1.z.object({
    body: zod_1.z.object({
        customerId: zod_1.z.coerce.number().positive().optional(),
        items: zod_1.z.array(exports.saleItemSchema).min(1, 'A proforma must have at least one item'),
    }),
    params: zod_1.z.object({
        organizationId: zod_1.z.coerce.number().positive('Organization ID required'),
        saleId: zod_1.z.coerce.number().positive('Sale ID required'),
    }),
});
exports.convertProformaSchema = zod_1.z.object({
    body: zod_1.z.object({
        customerId: zod_1.z.coerce.number().positive().optional(),
        items: zod_1.z.array(exports.saleItemSchema).min(1).optional(),
        paymentType: zod_1.z.enum(['CASH', 'DEBT', 'INSURANCE', 'MIXED', 'MOBILE_MONEY', 'CREDIT_CARD']).optional(),
        cashAmount: zod_1.z.coerce.number().nonnegative().optional(),
        debtAmount: zod_1.z.coerce.number().nonnegative().optional(),
        insuranceAmount: zod_1.z.coerce.number().nonnegative().optional(),
        shiftId: zod_1.z.coerce.number().positive().optional(),
        payments: zod_1.z.array(salePaymentSchema).optional(),
    }),
    params: zod_1.z.object({
        organizationId: zod_1.z.coerce.number().positive('Organization ID required'),
        saleId: zod_1.z.coerce.number().positive('Sale ID required'),
    }),
});
exports.cancelSaleSchema = zod_1.z.object({
    body: zod_1.z.object({
        reason: zod_1.z.string().min(5, 'Cancellation reason must be at least 5 characters'),
    }),
    params: zod_1.z.object({
        organizationId: zod_1.z.coerce.number().positive('Organization ID required'),
        saleId: zod_1.z.coerce.number().positive('Sale ID required'),
    }),
});
exports.refundSaleSchema = zod_1.z.object({
    body: zod_1.z.object({
        reason: zod_1.z.string().min(1, 'Refund reason is required').max(500).optional(),
        // RRA refund reason code (VSDC code class 32, sent as rfdRsnCd). Optional
        // for backwards compatibility — the controller defaults it to '06 Refund'.
        rfdRsnCd: zod_1.z.string().regex(/^\d{2}$/, 'Refund reason code must be two digits').optional(),
        items: zod_1.z.array(zod_1.z.object({
            saleItemId: zod_1.z.coerce.number().positive().optional(),
            quantity: zod_1.z.coerce.number().positive().optional(),
        })).optional(),
    }),
    params: zod_1.z.object({
        id: zod_1.z.coerce.number().positive('Sale ID required'),
        organizationId: zod_1.z.coerce.number().positive('Organization ID required'),
    }),
});
