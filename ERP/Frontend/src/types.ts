export interface Profile {
    id: string;
    name: string;
    email: string;
    // Add other profile properties as needed
    role?: string;
    pharmacy_id?: string;
    created_at?: string;
    updated_at?: string;
    phone?:string;
}

export interface Product {
    id: number;
    name: string;
    sku?: string;
    batchNumber?: string;
    quantity: number;
    unitPrice: number;
    purchasePrice?: number | null;
    expiryDate?: string;
    category?: string;
    description?: string;
    minStock: number;
    organizationId: number;
    supplierId?: number;
    imageUrl?: string;
    taxCode?: string;
    taxCategory?: string;
    itemType?: 'PRODUCT' | 'RAW_MATERIAL' | 'SERVICE';
    measurementUnit?: string;
    barcode?: string;
    pkgUnitCd?: string | null;
    qtyUnitCd?: string | null;
    packagingQty?: number | null;
    itemCd?: string | null;
    itemClsCd?: string | null;
    itemStandardName?: string | null;
    origin?: string | null;
    useInsurance?: boolean;
    additionalInfo?: string | null;
    l1SalePrice?: number | null;
    l2SalePrice?: number | null;
    l3SalePrice?: number | null;
    l4SalePrice?: number | null;
    l5SalePrice?: number | null;
    createdAt: string;
    updatedAt: string;
}

export interface StockChange {
    date: string;
    type: string;
    quantity: number;
    newStock: number;
    note: string;
}

export interface ProductsReport {
    id: number;
    product: string;
    sku: string;
    category: string;
    currentStock: number;
    previousStock: number;
    minStock: number;
    maxStock: number;
    unitPrice: number;
    supplier: string;
    lastRestocked: string;
    changes: StockChange[];
    status: string;
    stockValue: number;
}