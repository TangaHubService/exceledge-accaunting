import { z } from 'zod';

// A phone always comes out of the frontend's PhoneInputWithCountryCode as
// "+<countrycode><digits>"; a bulk-imported/legacy number may be the plain
// local "0XXXXXXXX(X)" form — but neither shape overlaps a bare 9-digit TIN,
// so a value that got put in the wrong field is rejected instead of silently
// stored (and later sent to the RRA VSDC as the wrong one of custTin/custMblNo).
export const PHONE_PATTERN = /^(\+\d{9,15}|0\d{8,9})$/;
// RRA TIN: exactly 9 digits — same shape the RRA-taxpayer-lookup endpoint requires.
export const TIN_PATTERN = /^\d{9}$/;

export const isValidCustomerPhone = (value: string): boolean => PHONE_PATTERN.test(value);
export const isValidCustomerTin = (value: string): boolean => TIN_PATTERN.test(value);

// Both fields are optional in the UI, and the form always submits '' rather
// than omitting the key — treat blank the same as "not provided" so walk-in
// customers without a phone/TIN aren't rejected, while any non-blank value
// still has to match the real shape.
const phoneField = z.union([z.literal(''), z.string().regex(PHONE_PATTERN, 'Invalid phone number — expected +<country code><digits> or 0XXXXXXXXX')]).optional().nullable();
const tinField = z.union([z.literal(''), z.string().regex(TIN_PATTERN, 'TIN must be exactly 9 digits')]).optional().nullable();

// The controller accepts the TIN under either casing (`TIN` from the public
// API contract, `tin` — what the customer form actually sends); validate
// whichever is present so neither path skips the format/swap check.
const tinNotPhone = (data: { phone?: string | null; TIN?: string | null; tin?: string | null }) => {
  const tinValue = data.TIN ?? data.tin;
  return !data.phone || !tinValue || data.phone !== tinValue;
};
const tinNotPhoneIssue = {
  message: 'Phone number and TIN cannot be the same value',
  path: ['TIN'],
};

// Structured RRA buyer-address parts (province / district / sector /
// street-or-cell). Free-text, optional, capped at sane lengths.
const addressPartField = z.string().max(120).optional().nullable();

export const createCustomerSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Customer name required').max(255, 'Customer name too long'),
    phone: phoneField,
    email: z.string().email('Invalid email address').optional(),
    address: z.string().max(500).optional(),
    custPrvncNm: addressPartField,
    custDstrtNm: addressPartField,
    custSctrNm: addressPartField,
    custLocDesc: z.string().max(255).optional().nullable(),
    customerType: z.enum(['INDIVIDUAL', 'CORPORATE', 'INSURANCE']).default('INDIVIDUAL'),
    TIN: tinField,
    tin: tinField,
    prcOrdCd: z.string().min(1, 'Purchase order code too short').optional(),
    isrccCd: z.string().max(10, 'Insurance code max 10 characters').optional().nullable(),
    isrcRt: z.coerce.number().min(0).max(100).optional().nullable(),
  })
    .refine(tinNotPhone, tinNotPhoneIssue)
    .superRefine((data, ctx) => {
      // Walk-in / individual customers do not need a TIN. Business buyers do.
      if (data.customerType === 'INDIVIDUAL') return;
      const tinValue = (data.TIN ?? data.tin ?? '').toString().trim();
      if (!TIN_PATTERN.test(tinValue)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'TIN is required for corporate and insurance customers',
          path: ['TIN'],
        });
      }
    }),
  params: z.object({
    organizationId: z.coerce.number().positive('Organization ID required'),
  }),
});

export const updateCustomerSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Customer name required').max(255, 'Customer name too long').optional(),
    phone: phoneField,
    email: z.string().email('Invalid email address').optional(),
    address: z.string().max(500).optional(),
    custPrvncNm: addressPartField,
    custDstrtNm: addressPartField,
    custSctrNm: addressPartField,
    custLocDesc: z.string().max(255).optional().nullable(),
    customerType: z.enum(['INDIVIDUAL', 'CORPORATE', 'INSURANCE']).optional(),
    TIN: tinField,
    tin: tinField,
    prcOrdCd: z.string().optional(),
    isrccCd: z.string().max(10, 'Insurance code max 10 characters').optional().nullable(),
    isrcRt: z.coerce.number().min(0).max(100).optional().nullable(),
  })
    .refine(tinNotPhone, tinNotPhoneIssue)
    .superRefine((data, ctx) => {
      if (data.customerType !== 'CORPORATE' && data.customerType !== 'INSURANCE') return;
      const tinValue = (data.TIN ?? data.tin ?? '').toString().trim();
      if (!TIN_PATTERN.test(tinValue)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'TIN is required for corporate and insurance customers',
          path: ['TIN'],
        });
      }
    }),
  params: z.object({
    organizationId: z.coerce.number().positive('Organization ID required'),
    id: z.coerce.number().positive('Customer ID required'),
  }),
});

export const recordDebtPaymentSchema = z.object({
  body: z.object({
    amount: z.coerce.number().positive('Amount must be positive'),
    paymentDate: z.string().datetime().optional(),
    paymentMethod: z.string().default('CASH'),
    reference: z.string().optional(),
    notes: z.string().optional(),
  }),
  params: z.object({
    organizationId: z.coerce.number().positive('Organization ID required'),
    saleId: z.coerce.number().positive('Sale ID required'),
  }),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type RecordDebtPaymentInput = z.infer<typeof recordDebtPaymentSchema>;
