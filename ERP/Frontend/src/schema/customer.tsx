import * as yup from 'yup';

// A phone always comes out of PhoneInputWithCountryCode as "+<countrycode><digits>",
// and a bulk-imported/legacy number may be the plain local "0XXXXXXXX(X)" form —
// but it never looks like a bare 9-digit TIN, so the two fields can't be
// mistaken for each other by shape alone.
const PHONE_PATTERN = /^(\+\d{9,15}|0\d{8,9})$/;
// RRA TIN: exactly 9 digits (same shape the "Verify with RRA" lookup requires).
const TIN_PATTERN = /^\d{9}$/;

export const customerSchema = yup.object().shape({
    name: yup.string().required('Name is required'),
    email: yup.string().email('Invalid email address').notRequired().nullable(),
    phone: yup.string().notRequired().nullable()
        .test('phone-format', 'Enter a valid phone number (e.g. +250788123456)', (value) => !value || PHONE_PATTERN.test(value)),
    tin: yup.string().nullable()
        .transform((v) => (v == null || String(v).trim() === '' ? null : String(v).trim()))
        .when('type', {
            is: (type: string) => type === 'CORPORATE' || type === 'INSURANCE',
            then: (schema) =>
                schema
                    .required('TIN is required for corporate and insurance customers')
                    .matches(TIN_PATTERN, 'TIN must be exactly 9 digits'),
            // Walk-in / individual customers do not need a TIN.
            otherwise: (schema) =>
                schema
                    .notRequired()
                    .test('tin-format', 'TIN must be exactly 9 digits', (value) => !value || TIN_PATTERN.test(value)),
        }),
    address: yup.string().max(500).notRequired().nullable(),
    custPrvncNm: yup.string().max(120).notRequired().nullable(),
    custDstrtNm: yup.string().max(120).notRequired().nullable(),
    custSctrNm: yup.string().max(120).notRequired().nullable(),
    custLocDesc: yup.string().max(255).notRequired().nullable(),
    type: yup
        .string()
        .required('Customer type is required'),
    balance: yup
        .number()
        .typeError('Balance must be a number')
        .min(0, 'Balance cannot be negative')
        .required('Balance is required'),
    isrccCd: yup.string().max(10).notRequired().nullable()
        .when('type', {
            is: 'INSURANCE',
            then: (schema) => schema.required('Insurance code (isrccCd) is required for insurance customers'),
        }),
    isrcRt: yup.number().min(0).max(100).notRequired().nullable(),
});