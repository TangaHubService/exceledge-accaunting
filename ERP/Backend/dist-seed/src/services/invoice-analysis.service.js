"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeInvoice = analyzeInvoice;
const prisma_1 = require("../lib/prisma");
// ── Tolerances ───────────────────────────────────────────────────────────
// Same 2%-or-1-unit slack used for line-level math verification client-side —
// OCR/vision extraction and header-level rounding on the source document both
// introduce small, expected drift that shouldn't itself be flagged as a discrepancy.
const HEADER_MATH_TOLERANCE_RATIO = 0.02;
const HEADER_MATH_TOLERANCE_MIN = 1;
const PO_TOTAL_TOLERANCE_RATIO = 0.05;
// Large enough that a missing TIN is a compliance concern, not just an unregistered micro-vendor.
const LARGE_INVOICE_THRESHOLD = 100000;
function within(a, b, ratio, min) {
    const tolerance = Math.max(min, Math.abs(b) * ratio);
    return Math.abs(a - b) <= tolerance;
}
function checkHeaderMath(items, subtotal, taxAmount, discount, totalAmount) {
    const itemSum = items.reduce((sum, i) => sum + Number(i.totalPrice), 0);
    const subtotalNum = subtotal != null ? Number(subtotal) : null;
    const taxNum = taxAmount != null ? Number(taxAmount) : 0;
    const discountNum = discount != null ? Number(discount) : 0;
    const totalNum = totalAmount != null ? Number(totalAmount) : null;
    const itemSumVsSubtotal = subtotalNum != null
        ? { itemSum, subtotal: subtotalNum, delta: itemSum - subtotalNum }
        : null;
    const computed = (subtotalNum ?? itemSum) + taxNum - discountNum;
    const subtotalTaxDiscountVsTotal = totalNum != null ? { computed, stated: totalNum, delta: computed - totalNum } : null;
    const itemsReconcile = !itemSumVsSubtotal || within(itemSum, itemSumVsSubtotal.subtotal, HEADER_MATH_TOLERANCE_RATIO, HEADER_MATH_TOLERANCE_MIN);
    const totalReconciles = !subtotalTaxDiscountVsTotal || within(computed, totalNum, HEADER_MATH_TOLERANCE_RATIO, HEADER_MATH_TOLERANCE_MIN);
    return {
        verified: itemsReconcile && totalReconciles,
        itemSumVsSubtotal,
        subtotalTaxDiscountVsTotal,
    };
}
function findDuplicateLineItems(items) {
    const groups = new Map();
    for (const item of items) {
        const signature = `${item.productName.trim().toLowerCase()}|${item.quantity}|${Number(item.unitPrice).toFixed(2)}`;
        const existing = groups.get(signature) ?? [];
        existing.push(item.id);
        groups.set(signature, existing);
    }
    return [...groups.entries()]
        .filter(([, ids]) => ids.length > 1)
        .map(([signature, itemIds]) => ({ signature, itemIds }));
}
function assessFraudRisk(params) {
    const reasons = [];
    let score = 0;
    if (!params.vendorTIN && (params.totalAmount ?? 0) >= LARGE_INVOICE_THRESHOLD) {
        score += 30;
        reasons.push('No vendor TIN on a large invoice');
    }
    if (!params.headerMathVerified) {
        score += 25;
        reasons.push('Header totals do not reconcile with line items / tax / discount');
    }
    if (params.duplicateInvoiceNumberExists) {
        score += 20;
        reasons.push('Same invoice number already recorded for this supplier');
    }
    if (params.duplicateLineCount > 0) {
        score += 15;
        reasons.push(`${params.duplicateLineCount} duplicate line item(s) detected`);
    }
    return { score: Math.min(100, score), reasons };
}
async function matchPurchaseOrder(params) {
    if (params.poNumber) {
        const po = await prisma_1.prisma.purchaseOrder.findFirst({
            where: { organizationId: params.organizationId, orderNumber: params.poNumber },
        });
        if (!po) {
            return { status: 'UNMATCHED', purchaseOrderId: null, detail: `PO number "${params.poNumber}" not found` };
        }
        if (params.supplierId && po.supplierId !== params.supplierId) {
            return { status: 'MISMATCHED', purchaseOrderId: po.id, detail: 'PO found but belongs to a different supplier' };
        }
        if (params.totalAmount != null && !within(params.totalAmount, Number(po.totalAmount), PO_TOTAL_TOLERANCE_RATIO, 1)) {
            return { status: 'PARTIAL', purchaseOrderId: po.id, detail: 'PO found but totals differ beyond tolerance' };
        }
        return { status: 'MATCHED', purchaseOrderId: po.id, detail: 'PO number, supplier, and total reconcile' };
    }
    // No PO number printed on the invoice — fall back to a fuzzy match so a
    // human reviewer isn't left with zero leads. Only auto-match when exactly
    // one candidate fits; ambiguity is left UNMATCHED rather than guessed.
    if (!params.supplierId || params.totalAmount == null) {
        return { status: 'UNMATCHED', purchaseOrderId: null, detail: 'No PO number and insufficient data to fuzzy-match' };
    }
    const windowStart = params.invoiceDate ? new Date(params.invoiceDate) : new Date();
    windowStart.setDate(windowStart.getDate() - 60);
    const candidates = await prisma_1.prisma.purchaseOrder.findMany({
        where: {
            organizationId: params.organizationId,
            supplierId: params.supplierId,
            status: { in: ['APPROVED', 'COMPLETED'] },
            orderedAt: { gte: windowStart },
        },
        take: 5,
    });
    const closeMatches = candidates.filter((po) => within(params.totalAmount, Number(po.totalAmount), PO_TOTAL_TOLERANCE_RATIO, 1));
    if (closeMatches.length === 1) {
        return { status: 'MATCHED', purchaseOrderId: closeMatches[0].id, detail: 'Fuzzy-matched by supplier, date window, and total' };
    }
    if (closeMatches.length > 1) {
        return { status: 'UNMATCHED', purchaseOrderId: null, detail: `${closeMatches.length} ambiguous PO candidates — left for manual review` };
    }
    return { status: 'UNMATCHED', purchaseOrderId: null, detail: 'No PO number and no matching purchase order found' };
}
/**
 * Runs immediately after AI extraction (or manual edit) to turn raw extracted
 * data into business meaning: does the math add up, are there duplicate
 * lines, does this look like a fraud/compliance risk, and does it match a PO
 * already in the system. Writes findings back onto the invoice/items.
 */
async function analyzeInvoice(invoiceId) {
    const invoice = await prisma_1.prisma.supplierInvoice.findUnique({
        where: { id: invoiceId },
        include: { items: true },
    });
    if (!invoice)
        return;
    const headerMath = checkHeaderMath(invoice.items, invoice.subtotal, invoice.taxAmount, invoice.discount, invoice.totalAmount);
    const duplicateGroups = findDuplicateLineItems(invoice.items);
    const duplicateItemIds = new Set(duplicateGroups.flatMap((g) => g.itemIds));
    const duplicateInvoice = invoice.invoiceNumber && invoice.supplierId
        ? await prisma_1.prisma.supplierInvoice.findFirst({
            where: {
                id: { not: invoice.id },
                organizationId: invoice.organizationId,
                supplierId: invoice.supplierId,
                invoiceNumber: invoice.invoiceNumber,
            },
            select: { id: true },
        })
        : null;
    const fraud = assessFraudRisk({
        vendorTIN: invoice.vendorTIN,
        totalAmount: invoice.totalAmount != null ? Number(invoice.totalAmount) : null,
        headerMathVerified: headerMath.verified,
        duplicateLineCount: duplicateGroups.length,
        duplicateInvoiceNumberExists: !!duplicateInvoice,
    });
    const poMatch = await matchPurchaseOrder({
        organizationId: invoice.organizationId,
        supplierId: invoice.supplierId,
        poNumber: invoice.poNumber,
        totalAmount: invoice.totalAmount != null ? Number(invoice.totalAmount) : null,
        invoiceDate: invoice.invoiceDate,
    });
    await prisma_1.prisma.$transaction(async (tx) => {
        await tx.supplierInvoice.update({
            where: { id: invoice.id },
            data: {
                mathVerified: headerMath.verified,
                fraudRiskScore: fraud.score,
                poMatchStatus: poMatch.status,
                matchedPurchaseOrderId: poMatch.purchaseOrderId,
                analysisFlags: {
                    headerMath,
                    duplicateLineGroups: duplicateGroups,
                    duplicateInvoiceId: duplicateInvoice?.id ?? null,
                    fraud,
                    poMatch: { status: poMatch.status, purchaseOrderId: poMatch.purchaseOrderId, detail: poMatch.detail },
                    analyzedAt: new Date().toISOString(),
                },
            },
        });
        for (const itemId of duplicateItemIds) {
            await tx.supplierInvoiceItem.update({
                where: { id: itemId },
                data: { isDuplicate: true },
            });
        }
    });
}
