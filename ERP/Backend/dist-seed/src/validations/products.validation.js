"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adjustStockSchema = exports.updateProductSchema = exports.createProductSchema = void 0;
const zod_1 = require("zod");
const rra_country_codes_1 = require("../constants/rra-country-codes");
const rraCountryCodeEnum = zod_1.z.enum(rra_country_codes_1.VALID_RRA_COUNTRY_CODES);
exports.createProductSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z.string().min(1, 'Product name required').max(255, 'Product name too long'),
        sku: zod_1.z.string().min(1, 'SKU required').max(50, 'SKU too long').optional(),
        quantity: zod_1.z.coerce.number().nonnegative('Quantity cannot be negative').default(0),
        unitPrice: zod_1.z.coerce.number().positive('Unit price must be positive'),
        purchasePrice: zod_1.z.coerce.number().nonnegative('Purchase price cannot be negative').optional(),
        category: zod_1.z.string().optional(),
        description: zod_1.z.string().optional(),
        minStock: zod_1.z.coerce.number().nonnegative('Minimum stock cannot be negative').default(10),
        taxCategory: zod_1.z.enum(['STANDARD', 'ZERO_RATED', 'EXEMPT']).default('STANDARD'),
        // E is reserved for RRA internal use only and must never be assignable to a product.
        taxCode: zod_1.z.enum(['A', 'B', 'C', 'D'], {
            message: 'Tax code must be one of A, B, C, or D',
        }),
        measurementUnit: zod_1.z.enum(['PCS', 'KG', 'LTR', 'MTR', 'BOX', 'PAIR', 'DOZEN', 'GRAM', 'ML', 'OTHER']).default('PCS'),
        itemType: zod_1.z.enum(['PRODUCT', 'RAW_MATERIAL', 'SERVICE']).default('PRODUCT'),
        expiryDate: zod_1.z.string().datetime().optional(),
        barcode: zod_1.z.string().optional(),
        // VSDC ItemSaveReq requires pkgUnitCd — do not invent a silent default at sync time.
        pkgUnitCd: zod_1.z.string().min(1, 'Packaging unit code (pkgUnitCd) is required').max(5),
        qtyUnitCd: zod_1.z.string().min(1).max(5).optional(),
        packagingQty: zod_1.z.coerce.number().int().positive('Packaging quantity must be positive').optional(),
        // Required for all item types including SERVICE (VSDC §3.3.4.1).
        itemClsCd: zod_1.z.string().min(1, 'RRA item classification (itemClsCd) is required').max(10),
        itemStandardName: zod_1.z.string().max(200, 'Item standard name too long').optional(),
        origin: rraCountryCodeEnum.optional(),
        useInsurance: zod_1.z.coerce.boolean().default(false),
        additionalInfo: zod_1.z.string().max(7, 'Additional info must be 7 characters or fewer').optional(),
        l1SalePrice: zod_1.z.coerce.number().nonnegative('Price tier 1 cannot be negative').optional(),
        l2SalePrice: zod_1.z.coerce.number().nonnegative('Price tier 2 cannot be negative').optional(),
        l3SalePrice: zod_1.z.coerce.number().nonnegative('Price tier 3 cannot be negative').optional(),
        l4SalePrice: zod_1.z.coerce.number().nonnegative('Price tier 4 cannot be negative').optional(),
        l5SalePrice: zod_1.z.coerce.number().nonnegative('Price tier 5 cannot be negative').optional(),
        bomComponents: zod_1.z.array(zod_1.z.object({
            componentProductId: zod_1.z.coerce.number().int().positive(),
            quantity: zod_1.z.coerce.number().positive().max(999999999999.999).refine((quantity) => Math.abs(quantity * 1000 - Math.round(quantity * 1000)) <= 1e-7, 'Quantity can have at most 3 decimal places'),
            unit: zod_1.z.string().min(1).max(20),
        })).max(50).refine((components) => new Set(components.map((component) => component.componentProductId)).size === components.length, 'Each raw material can be used only once').optional(),
    }).refine((data) => !data.bomComponents?.length || data.itemType === 'PRODUCT', {
        message: 'Bill of Materials can only be added to finished products',
        path: ['bomComponents'],
    }),
    params: zod_1.z.object({
        organizationId: zod_1.z.coerce.number().positive('Organization ID required'),
    }),
});
exports.updateProductSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z.string().min(1, 'Product name required').max(255, 'Product name too long').optional(),
        sku: zod_1.z.string().min(1, 'SKU required').max(50, 'SKU too long').optional(),
        unitPrice: zod_1.z.coerce.number().positive('Unit price must be positive').optional(),
        purchasePrice: zod_1.z.coerce.number().nonnegative('Purchase price cannot be negative').optional().nullable(),
        category: zod_1.z.string().optional(),
        description: zod_1.z.string().optional(),
        minStock: zod_1.z.coerce.number().nonnegative('Minimum stock cannot be negative').optional(),
        taxCategory: zod_1.z.enum(['STANDARD', 'ZERO_RATED', 'EXEMPT']).optional(),
        // E is reserved for RRA internal use only and must never be assignable to a product.
        taxCode: zod_1.z.enum(['A', 'B', 'C', 'D']).optional(),
        measurementUnit: zod_1.z.enum(['PCS', 'KG', 'LTR', 'MTR', 'BOX', 'PAIR', 'DOZEN', 'GRAM', 'ML', 'OTHER']).optional(),
        itemType: zod_1.z.enum(['PRODUCT', 'RAW_MATERIAL', 'SERVICE']).optional(),
        expiryDate: zod_1.z.string().datetime().optional().nullable(),
        barcode: zod_1.z.string().optional().nullable(),
        pkgUnitCd: zod_1.z.string().optional().nullable(),
        qtyUnitCd: zod_1.z.string().optional().nullable(),
        packagingQty: zod_1.z.coerce.number().int().positive('Packaging quantity must be positive').optional().nullable(),
        itemClsCd: zod_1.z.string().optional().nullable(),
        itemStandardName: zod_1.z.string().max(200, 'Item standard name too long').optional().nullable(),
        origin: rraCountryCodeEnum.optional().nullable(),
        useInsurance: zod_1.z.coerce.boolean().optional(),
        additionalInfo: zod_1.z.string().max(7, 'Additional info must be 7 characters or fewer').optional().nullable(),
        l1SalePrice: zod_1.z.coerce.number().nonnegative('Price tier 1 cannot be negative').optional().nullable(),
        l2SalePrice: zod_1.z.coerce.number().nonnegative('Price tier 2 cannot be negative').optional().nullable(),
        l3SalePrice: zod_1.z.coerce.number().nonnegative('Price tier 3 cannot be negative').optional().nullable(),
        l4SalePrice: zod_1.z.coerce.number().nonnegative('Price tier 4 cannot be negative').optional().nullable(),
        l5SalePrice: zod_1.z.coerce.number().nonnegative('Price tier 5 cannot be negative').optional().nullable(),
    }).refine((data) => {
        // Never clear a required RRA classification once set.
        if (data.itemClsCd === null || data.itemClsCd === '')
            return false;
        return true;
    }, {
        message: 'RRA item classification (itemClsCd) is required and cannot be cleared',
        path: ['itemClsCd'],
    }).refine((data) => {
        if (data.pkgUnitCd === null || data.pkgUnitCd === '')
            return false;
        return true;
    }, {
        message: 'Packaging unit code (pkgUnitCd) is required and cannot be cleared',
        path: ['pkgUnitCd'],
    }),
    params: zod_1.z.object({
        organizationId: zod_1.z.coerce.number().positive('Organization ID required'),
        id: zod_1.z.coerce.number().positive('Product ID required'),
    }),
});
exports.adjustStockSchema = zod_1.z.object({
    body: zod_1.z.object({
        quantity: zod_1.z.coerce.number().int('Quantity must be integer'),
        reason: zod_1.z.string().min(3, 'Reason must be at least 3 characters'),
        reference: zod_1.z.string().optional(),
    }),
    params: zod_1.z.object({
        organizationId: zod_1.z.coerce.number().positive('Organization ID required'),
        id: zod_1.z.coerce.number().positive('Product ID required'),
    }),
});
