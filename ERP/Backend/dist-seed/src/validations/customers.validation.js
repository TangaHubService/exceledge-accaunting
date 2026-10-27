"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordDebtPaymentSchema = exports.updateCustomerSchema = exports.createCustomerSchema = exports.isValidCustomerTin = exports.isValidCustomerPhone = exports.TIN_PATTERN = exports.PHONE_PATTERN = void 0;
const zod_1 = require("zod");
// A phone always comes out of the frontend's PhoneInputWithCountryCode as
// "+<countrycode><digits>"; a bulk-imported/legacy number may be the plain
// local "0XXXXXXXX(X)" form — but neither shape overlaps a bare 9-digit TIN,
// so a value that got put in the wrong field is rejected instead of silently
// stored (and later sent to the RRA VSDC as the wrong one of custTin/custMblNo).
exports.PHONE_PATTERN = /^(\+\d{9,15}|0\d{8,9})$/;
// RRA TIN: exactly 9 digits — same shape the RRA-taxpayer-lookup endpoint requires.
exports.TIN_PATTERN = /^\d{9}$/;
const isValidCustomerPhone = (value) => exports.PHONE_PATTERN.test(value);
exports.isValidCustomerPhone = isValidCustomerPhone;
const isValidCustomerTin = (value) => exports.TIN_PATTERN.test(value);
exports.isValidCustomerTin = isValidCustomerTin;
// Both fields are optional in the UI, and the form always submits '' rather
// than omitting the key — treat blank the same as "not provided" so walk-in
// customers without a phone/TIN aren't rejected, while any non-blank value
// still has to match the real shape.
const phoneField = zod_1.z.union([zod_1.z.literal(''), zod_1.z.string().regex(exports.PHONE_PATTERN, 'Invalid phone number — expected +<country code><digits> or 0XXXXXXXXX')]).optional().nullable();
const tinField = zod_1.z.union([zod_1.z.literal(''), zod_1.z.string().regex(exports.TIN_PATTERN, 'TIN must be exactly 9 digits')]).optional().nullable();
// The controller accepts the TIN under either casing (`TIN` from the public
// API contract, `tin` — what the customer form actually sends); validate
// whichever is present so neither path skips the format/swap check.
const tinNotPhone = (data) => {
    const tinValue = data.TIN ?? data.tin;
    return !data.phone || !tinValue || data.phone !== tinValue;
};
const tinNotPhoneIssue = {
    message: 'Phone number and TIN cannot be the same value',
    path: ['TIN'],
};
// Structured RRA buyer-address parts (province / district / sector /
// street-or-cell). Free-text, optional, capped at sane lengths.
const addressPartField = zod_1.z.string().max(120).optional().nullable();
exports.createCustomerSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z.string().min(1, 'Customer name required').max(255, 'Customer name too long'),
        phone: phoneField,
        email: zod_1.z.string().email('Invalid email address').optional(),
        address: zod_1.z.string().max(500).optional(),
        custPrvncNm: addressPartField,
        custDstrtNm: addressPartField,
        custSctrNm: addressPartField,
        custLocDesc: zod_1.z.string().max(255).optional().nullable(),
        customerType: zod_1.z.enum(['INDIVIDUAL', 'CORPORATE', 'INSURANCE']).default('INDIVIDUAL'),
        TIN: tinField,
        tin: tinField,
        prcOrdCd: zod_1.z.string().min(1, 'Purchase order code too short').optional(),
        isrccCd: zod_1.z.string().max(10, 'Insurance code max 10 characters').optional().nullable(),
        isrcRt: zod_1.z.coerce.number().min(0).max(100).optional().nullable(),
    }).refine(tinNotPhone, tinNotPhoneIssue),
    params: zod_1.z.object({
        organizationId: zod_1.z.coerce.number().positive('Organization ID required'),
    }),
});
exports.updateCustomerSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z.string().min(1, 'Customer name required').max(255, 'Customer name too long').optional(),
        phone: phoneField,
        email: zod_1.z.string().email('Invalid email address').optional(),
        address: zod_1.z.string().max(500).optional(),
        custPrvncNm: addressPartField,
        custDstrtNm: addressPartField,
        custSctrNm: addressPartField,
        custLocDesc: zod_1.z.string().max(255).optional().nullable(),
        customerType: zod_1.z.enum(['INDIVIDUAL', 'CORPORATE', 'INSURANCE']).optional(),
        TIN: tinField,
        tin: tinField,
        prcOrdCd: zod_1.z.string().optional(),
        isrccCd: zod_1.z.string().max(10, 'Insurance code max 10 characters').optional().nullable(),
        isrcRt: zod_1.z.coerce.number().min(0).max(100).optional().nullable(),
    }).refine(tinNotPhone, tinNotPhoneIssue),
    params: zod_1.z.object({
        organizationId: zod_1.z.coerce.number().positive('Organization ID required'),
        id: zod_1.z.coerce.number().positive('Customer ID required'),
    }),
});
exports.recordDebtPaymentSchema = zod_1.z.object({
    body: zod_1.z.object({
        amount: zod_1.z.coerce.number().positive('Amount must be positive'),
        paymentDate: zod_1.z.string().datetime().optional(),
        paymentMethod: zod_1.z.string().default('CASH'),
        reference: zod_1.z.string().optional(),
        notes: zod_1.z.string().optional(),
    }),
    params: zod_1.z.object({
        organizationId: zod_1.z.coerce.number().positive('Organization ID required'),
        saleId: zod_1.z.coerce.number().positive('Sale ID required'),
    }),
});
