import { z } from 'zod';

export const createProductSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Product name required').max(255, 'Product name too long'),
    sku: z.string().min(1, 'SKU required').max(50, 'SKU too long').optional(),
    quantity: z.coerce.number().nonnegative('Quantity cannot be negative').default(0),
    unitPrice: z.coerce.number().positive('Unit price must be positive'),
    purchasePrice: z.coerce.number().nonnegative('Purchase price cannot be negative').optional(),
    category: z.string().optional(),
    description: z.string().optional(),
    minStock: z.coerce.number().nonnegative('Minimum stock cannot be negative').default(10),
    taxCategory: z.enum(['STANDARD', 'ZERO_RATED', 'EXEMPT']).default('STANDARD'),
    taxCode: z.string().min(1, 'Tax code is required').max(5),
    measurementUnit: z.enum(['PCS', 'KG', 'LTR', 'MTR', 'BOX', 'PAIR', 'DOZEN', 'GRAM', 'ML', 'OTHER']).default('PCS'),
    itemType: z.enum(['PRODUCT', 'RAW_MATERIAL', 'SERVICE']).default('PRODUCT'),
    expiryDate: z.string().datetime().optional(),
    barcode: z.string().optional(),
    pkgUnitCd: z.string().min(1, 'Packaging unit code (pkgUnitCd) is required').max(5),
    qtyUnitCd: z.string().min(1).max(5).optional(),
    packagingQty: z.coerce.number().int().positive('Packaging quantity must be positive').optional(),
    itemClsCd: z.string().min(1, 'RRA item classification (itemClsCd) is required').max(10),
    itemStandardName: z.string().max(200, 'Item standard name too long').optional(),
    origin: z.string().regex(/^[A-Za-z]{2}$/, 'Origin must be a 2-letter RRA country code').optional(),
    useInsurance: z.coerce.boolean().default(false),
    additionalInfo: z.string().max(7, 'Additional info must be 7 characters or fewer').optional(),
    l1SalePrice: z.coerce.number().nonnegative('Price tier 1 cannot be negative').optional(),
    l2SalePrice: z.coerce.number().nonnegative('Price tier 2 cannot be negative').optional(),
    l3SalePrice: z.coerce.number().nonnegative('Price tier 3 cannot be negative').optional(),
    l4SalePrice: z.coerce.number().nonnegative('Price tier 4 cannot be negative').optional(),
    l5SalePrice: z.coerce.number().nonnegative('Price tier 5 cannot be negative').optional(),
    bomComponents: z.array(z.object({
      componentProductId: z.coerce.number().int().positive(),
      quantity: z.coerce.number().positive().max(999999999999.999).refine(
        (quantity) => Math.abs(quantity * 1000 - Math.round(quantity * 1000)) <= 1e-7,
        'Quantity can have at most 3 decimal places',
      ),
      unit: z.string().min(1).max(20),
    })).max(50).refine(
      (components) => new Set(components.map((component) => component.componentProductId)).size === components.length,
      'Each raw material can be used only once',
    ).optional(),
  }).refine((data) => !data.bomComponents?.length || data.itemType === 'PRODUCT', {
    message: 'Bill of Materials can only be added to finished products',
    path: ['bomComponents'],
  }),
  params: z.object({
    organizationId: z.coerce.number().positive('Organization ID required'),
  }),
});

export const updateProductSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Product name required').max(255, 'Product name too long').optional(),
    sku: z.string().min(1, 'SKU required').max(50, 'SKU too long').optional(),
    unitPrice: z.coerce.number().positive('Unit price must be positive').optional(),
    purchasePrice: z.coerce.number().nonnegative('Purchase price cannot be negative').optional().nullable(),
    category: z.string().optional(),
    description: z.string().optional(),
    minStock: z.coerce.number().nonnegative('Minimum stock cannot be negative').optional(),
    taxCategory: z.enum(['STANDARD', 'ZERO_RATED', 'EXEMPT']).optional(),
    // E is reserved for RRA internal use only and must never be assignable to a product.
    taxCode: z.string().min(1).max(5).optional(),
    measurementUnit: z.enum(['PCS', 'KG', 'LTR', 'MTR', 'BOX', 'PAIR', 'DOZEN', 'GRAM', 'ML', 'OTHER']).optional(),
    itemType: z.enum(['PRODUCT', 'RAW_MATERIAL', 'SERVICE']).optional(),
    expiryDate: z.string().datetime().optional().nullable(),
    barcode: z.string().optional().nullable(),
    pkgUnitCd: z.string().optional().nullable(),
    qtyUnitCd: z.string().optional().nullable(),
    packagingQty: z.coerce.number().int().positive('Packaging quantity must be positive').optional().nullable(),
    itemClsCd: z.string().optional().nullable(),
    itemStandardName: z.string().max(200, 'Item standard name too long').optional().nullable(),
    origin: z.string().regex(/^[A-Za-z]{2}$/, 'Origin must be a 2-letter RRA country code').optional().nullable(),
    useInsurance: z.coerce.boolean().optional(),
    additionalInfo: z.string().max(7, 'Additional info must be 7 characters or fewer').optional().nullable(),
    l1SalePrice: z.coerce.number().nonnegative('Price tier 1 cannot be negative').optional().nullable(),
    l2SalePrice: z.coerce.number().nonnegative('Price tier 2 cannot be negative').optional().nullable(),
    l3SalePrice: z.coerce.number().nonnegative('Price tier 3 cannot be negative').optional().nullable(),
    l4SalePrice: z.coerce.number().nonnegative('Price tier 4 cannot be negative').optional().nullable(),
    l5SalePrice: z.coerce.number().nonnegative('Price tier 5 cannot be negative').optional().nullable(),
  }).refine((data) => {
    // Never clear a required RRA classification once set.
    if (data.itemClsCd === null || data.itemClsCd === '') return false;
    return true;
  }, {
    message: 'RRA item classification (itemClsCd) is required and cannot be cleared',
    path: ['itemClsCd'],
  }).refine((data) => {
    if (data.pkgUnitCd === null || data.pkgUnitCd === '') return false;
    return true;
  }, {
    message: 'Packaging unit code (pkgUnitCd) is required and cannot be cleared',
    path: ['pkgUnitCd'],
  }),
  params: z.object({
    organizationId: z.coerce.number().positive('Organization ID required'),
    id: z.coerce.number().positive('Product ID required'),
  }),
});

export const adjustStockSchema = z.object({
  body: z.object({
    quantity: z.coerce.number().int('Quantity must be integer'),
    reason: z.string().min(3, 'Reason must be at least 3 characters'),
    reference: z.string().optional(),
  }),
  params: z.object({
    organizationId: z.coerce.number().positive('Organization ID required'),
    id: z.coerce.number().positive('Product ID required'),
  }),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
