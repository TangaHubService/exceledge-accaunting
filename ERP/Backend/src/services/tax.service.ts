import { prisma } from '../lib/prisma';
import { TaxCategory, RraTaxCode } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

export interface TaxCalculationResult {
    taxableAmount: Decimal;
    taxAmount: Decimal;
    totalAmount: Decimal;
    taxRate: Decimal;
    taxCode: RraTaxCode;
}

export interface SaleTaxSummary {
    taxableAmount: Decimal;
    vatAmount: Decimal;
    items: Array<{
        productId: number;
        taxRate: Decimal;
        taxAmount: Decimal;
        taxCode: RraTaxCode;
        taxableAmount: Decimal;
    }>;
}

export class TaxService {
    static getTaxCode(category: TaxCategory): RraTaxCode {
        switch (category) {
            case 'STANDARD':
                return RraTaxCode.B;
            case 'ZERO_RATED':
                return RraTaxCode.C;
            case 'EXEMPT':
                return RraTaxCode.A;
            case 'NON_TAXABLE':
                return RraTaxCode.D;
            default:
                return RraTaxCode.A;
        }
    }

    /** Inverse of getTaxCode — used when persisting a product's A/B/C/D tax
     *  category so the legacy TaxCategory enum stays consistent with it. */
    static getTaxCategory(code: RraTaxCode | null | undefined): TaxCategory {
        switch (code) {
            case RraTaxCode.B:
                return 'STANDARD';
            case RraTaxCode.C:
                return 'ZERO_RATED';
            case RraTaxCode.A:
                return 'EXEMPT';
            case RraTaxCode.D:
                return 'NON_TAXABLE';
            default:
                return 'STANDARD';
        }
    }

    /**
     * Determine the effective RRA tax code for a product on a sale.
     *
     * The business's tax configuration and the product's own tax category are
     * independent concepts, applied in this order of precedence:
     *  - When the taxpayer/entity is legally tax-exempt (e.g. NGO, diplomatic
     *    mission), every line uses code A ("VAT exempt") regardless of the
     *    product's own category or VAT-registration status.
     *  - Otherwise, when the taxpayer is NOT VAT registered, every line uses
     *    code D ("Taxpayer not registered for VAT") regardless of category.
     *  - Otherwise (VAT registered, not exempt), the product's configured tax
     *    category (A = VAT exempt, B = 18% standard, C = export/zero-rated)
     *    applies. A product is never silently downgraded to D just because it
     *    has no tax-registration number of its own.
     */
    static resolveProductTaxCode(
        productTaxCode: RraTaxCode | null | undefined,
        category: TaxCategory,
        vatRegistered: boolean,
        isTaxExempt = false
    ): RraTaxCode {
        if (isTaxExempt) return RraTaxCode.A;
        if (!vatRegistered) return RraTaxCode.D;
        return productTaxCode ?? this.getTaxCode(category);
    }

    /** RRA spec: TAX_A=0% (exempt), TAX_B=18% (standard VAT), TAX_C=0% (zero-rated), TAX_D=0% (non-taxable), TAX_E=0% (tourism/export) */
    static getExpectedTaxRate(taxCode: RraTaxCode): number {
        switch (taxCode) {
            case RraTaxCode.B:
                return 18;
            case RraTaxCode.A:
            case RraTaxCode.C:
            case RraTaxCode.D:
            case RraTaxCode.E:
            default:
                return 0;
        }
    }

    /** Allowed tax codes for line items. E is reserved for internal RRA use only
     *  and must never be assigned to a product or submitted on a sale. */
    static readonly ALLOWED_TAX_CODES: ReadonlySet<RraTaxCode> = new Set([
        RraTaxCode.A, RraTaxCode.B, RraTaxCode.C, RraTaxCode.D,
    ]);

    static validateTaxRate(taxCode: RraTaxCode, taxRate: number): { valid: boolean; expectedRate: number } {
        const expectedRate = this.getExpectedTaxRate(taxCode);
        return { valid: taxRate === expectedRate, expectedRate };
    }

    static resolveTaxCode(category: TaxCategory, productTaxCode?: RraTaxCode | null): RraTaxCode {
        return productTaxCode ?? this.getTaxCode(category);
    }

    static async getVatRate(organizationId: number): Promise<Decimal> {
        const config = await prisma.taxConfiguration.findFirst({
            where: {
                organizationId,
                effectiveDate: {
                    lte: new Date(),
                },
            },
            orderBy: {
                effectiveDate: 'desc',
            },
        });

        return config ? config.vatRate : new Decimal(18);
    }

    static calculateItemTax(
        unitPrice: number | Decimal,
        quantity: number | Decimal,
        category: TaxCategory,
        standardVatRate: Decimal,
        overrideTaxCode?: RraTaxCode | null
    ): TaxCalculationResult {
        const price = unitPrice instanceof Decimal ? unitPrice : new Decimal(unitPrice);
        const qty = quantity instanceof Decimal ? quantity : new Decimal(quantity);
        const total = price.mul(qty);
        const code = overrideTaxCode ?? this.getTaxCode(category);

        const isTaxable = code === RraTaxCode.B; // Only TAX_B (18%) is taxable
        const rate = isTaxable ? standardVatRate : new Decimal(0);

        if (isTaxable) {
            const divisor = new Decimal(1).plus(rate.div(100));
            const taxableAmount = total.div(divisor);
            const taxAmount = total.minus(taxableAmount);
            return { taxableAmount, taxAmount, totalAmount: total, taxRate: rate, taxCode: code };
        }

        return {
            taxableAmount: total,
            taxAmount: new Decimal(0),
            totalAmount: total,
            taxRate: rate,
            taxCode: code,
        };
    }

    static async calculateSaleTax(
        organizationId: number,
        items: Array<{ productId: number; quantity: number; unitPrice: number }>,
        vatRegistered = true,
        isTaxExempt = false
    ): Promise<SaleTaxSummary> {
        const standardRate = await this.getVatRate(organizationId);

        const productIds = items.map(i => i.productId);
        const products = await prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, taxCategory: true, taxCode: true }
        });

        const productMap = new Map(products.map(p => [p.id, { taxCategory: p.taxCategory, taxCode: p.taxCode }]));

        let totalTaxable = new Decimal(0);
        let totalVat = new Decimal(0);
        const itemSummaries: SaleTaxSummary['items'] = [];

        for (const item of items) {
            const product = productMap.get(item.productId);
            const category = product?.taxCategory || 'STANDARD';
            // Effective code: forced to A when the entity is tax-exempt, else D
            // when the taxpayer is not VAT registered, else the product category.
            const effectiveCode = this.resolveProductTaxCode(product?.taxCode ?? null, category, vatRegistered, isTaxExempt);
            const result = this.calculateItemTax(item.unitPrice, item.quantity, category, standardRate, effectiveCode);

            totalTaxable = totalTaxable.plus(result.taxableAmount);
            totalVat = totalVat.plus(result.taxAmount);

            itemSummaries.push({
                productId: item.productId,
                taxRate: result.taxRate,
                taxAmount: result.taxAmount,
                taxCode: result.taxCode,
                taxableAmount: result.taxableAmount,
            });
        }

        return {
            taxableAmount: totalTaxable,
            vatAmount: totalVat,
            items: itemSummaries,
        };
    }
}
