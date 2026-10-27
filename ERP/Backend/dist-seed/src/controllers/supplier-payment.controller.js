"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteSupplierPayment = exports.getSupplierPaymentById = exports.getSupplierPayments = exports.recordSupplierPayment = void 0;
const activity_log_middleware_1 = require("../middleware/activity-log.middleware");
const client_1 = require("@prisma/client");
const prisma_1 = require("../lib/prisma");
// SupplierPayment has no branchId column of its own — it belongs to a branch
// via its purchase order, so filtering goes through that relation.
function purchaseOrderBranchFilter(req) {
    const id = req.selectedBranchId;
    if (id !== null && id !== undefined) {
        return { purchaseOrder: { branchId: id } };
    }
    const ids = req.selectedBranchIds;
    if (ids && ids.length > 0) {
        return { purchaseOrder: { branchId: { in: ids } } };
    }
    return {};
}
/**
 * Record a supplier payment
 */
const recordSupplierPayment = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const userId = req.user?.userId;
        const { purchaseOrderId, amount, paymentMethod, paymentDate, reference, notes } = req.body;
        // Validation
        if (!purchaseOrderId || !amount || !paymentMethod || !paymentDate) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: purchaseOrderId, amount, paymentMethod, paymentDate'
            });
        }
        // Verify purchase order exists, belongs to the organization, and — for a
        // branch-restricted user — belongs to a branch they actually have access to.
        const purchaseOrder = await prisma_1.prisma.purchaseOrder.findFirst({
            where: {
                id: Number(purchaseOrderId),
                organizationId: Number(organizationId),
                ...(req.selectedBranchId !== null && req.selectedBranchId !== undefined
                    ? { branchId: req.selectedBranchId }
                    : req.selectedBranchIds && req.selectedBranchIds.length > 0
                        ? { branchId: { in: req.selectedBranchIds } }
                        : {})
            }
        });
        if (!purchaseOrder) {
            return res.status(404).json({
                success: false,
                message: 'Purchase order not found'
            });
        }
        // Read-check-create must be atomic and the PO row locked, or two concurrent
        // payment submissions can both read the same pre-payment total, both pass
        // the overpayment check, and together overpay the PO.
        let newTotal = 0;
        let totalPaid = 0;
        const payment = await prisma_1.prisma.$transaction(async (tx) => {
            const [lockedPo] = await tx.$queryRaw `
                SELECT id, "totalAmount" FROM purchase_orders
                WHERE id = ${Number(purchaseOrderId)} AND "organizationId" = ${Number(organizationId)}
                FOR UPDATE
            `;
            if (!lockedPo) {
                throw new Error('Purchase order not found');
            }
            const existingPayments = await tx.supplierPayment.aggregate({
                where: {
                    purchaseOrderId: parseInt(purchaseOrderId)
                },
                _sum: {
                    amount: true
                }
            });
            totalPaid = existingPayments._sum.amount?.toNumber() || 0;
            newTotal = totalPaid + parseFloat(amount);
            const orderTotal = Number(lockedPo.totalAmount);
            if (newTotal > orderTotal) {
                throw new Error(`Payment exceeds purchase order total. Remaining: ${orderTotal - totalPaid}`);
            }
            return tx.supplierPayment.create({
                data: {
                    purchaseOrderId: Number(purchaseOrderId),
                    organizationId: Number(organizationId),
                    amount: parseFloat(amount),
                    paymentMethod,
                    paymentDate: new Date(paymentDate),
                    reference,
                    notes,
                    recordedById: Number(userId)
                },
                include: {
                    purchaseOrder: {
                        select: {
                            orderNumber: true,
                            totalAmount: true
                        }
                    }
                }
            });
        });
        // Log activity
        await (0, activity_log_middleware_1.logManualActivity)({
            userId: Number(userId),
            organizationId: Number(organizationId),
            module: 'PURCHASE_ORDERS',
            type: client_1.ActivityType.PAYMENT_RECEIVED,
            description: `Recorded supplier payment: ${amount} for PO ${purchaseOrder.orderNumber}`,
            entityType: 'SupplierPayment',
            entityId: payment.id.toString(),
            metadata: {
                purchaseOrderId,
                amount,
                paymentMethod,
                totalPaid: newTotal,
                remaining: purchaseOrder.totalAmount.toNumber() - newTotal
            }
        });
        res.status(201).json({
            success: true,
            message: 'Supplier payment recorded successfully',
            payment,
            summary: {
                totalPaid: newTotal,
                remaining: purchaseOrder.totalAmount.toNumber() - newTotal,
                fullyPaid: newTotal >= purchaseOrder.totalAmount.toNumber()
            }
        });
    }
    catch (error) {
        console.error('Error recording supplier payment:', error);
        if (typeof error?.message === 'string' && error.message.startsWith('Payment exceeds purchase order total')) {
            return res.status(400).json({ success: false, message: error.message });
        }
        res.status(500).json({
            success: false,
            message: 'Failed to record supplier payment',
            error: error.message
        });
    }
};
exports.recordSupplierPayment = recordSupplierPayment;
/**
 * Get all supplier payments
 */
const getSupplierPayments = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { startDate, endDate, purchaseOrderId, paymentMethod, limit = '50', page = '1' } = req.query;
        const where = { organizationId, ...purchaseOrderBranchFilter(req) };
        // Date filter
        if (startDate && endDate) {
            where.paymentDate = {
                gte: new Date(startDate),
                lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
            };
        }
        // Purchase order filter
        if (purchaseOrderId) {
            where.purchaseOrderId = parseInt(purchaseOrderId);
        }
        // Payment method filter
        if (paymentMethod && paymentMethod !== 'ALL') {
            where.paymentMethod = paymentMethod;
        }
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);
        const [payments, totalCount] = await Promise.all([
            prisma_1.prisma.supplierPayment.findMany({
                where,
                include: {
                    purchaseOrder: {
                        select: {
                            orderNumber: true,
                            totalAmount: true,
                            supplier: {
                                select: {
                                    name: true
                                }
                            }
                        }
                    },
                    recordedBy: {
                        select: {
                            name: true,
                            email: true
                        }
                    }
                },
                orderBy: { paymentDate: 'desc' },
                skip,
                take
            }),
            prisma_1.prisma.supplierPayment.count({ where })
        ]);
        // Calculate summary
        const summary = await prisma_1.prisma.supplierPayment.aggregate({
            where,
            _sum: { amount: true },
            _count: true
        });
        res.json({
            success: true,
            payments,
            summary: {
                totalPayments: summary._sum.amount?.toNumber() || 0,
                count: summary._count
            },
            pagination: {
                totalItems: totalCount,
                totalPages: Math.ceil(totalCount / take),
                currentPage: parseInt(page),
                limit: take
            }
        });
    }
    catch (error) {
        console.error('Error fetching supplier payments:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch supplier payments',
            error: error.message
        });
    }
};
exports.getSupplierPayments = getSupplierPayments;
/**
 * Get supplier payment by ID
 */
const getSupplierPaymentById = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const paymentId = parseInt(req.params.paymentId);
        const payment = await prisma_1.prisma.supplierPayment.findFirst({
            where: {
                id: Number(paymentId),
                organizationId: Number(organizationId),
                ...purchaseOrderBranchFilter(req)
            },
            include: {
                purchaseOrder: {
                    select: {
                        orderNumber: true,
                        totalAmount: true,
                        supplier: {
                            select: {
                                name: true,
                                email: true,
                                phone: true
                            }
                        }
                    }
                },
                recordedBy: {
                    select: {
                        name: true,
                        email: true
                    }
                }
            }
        });
        if (!payment) {
            return res.status(404).json({
                success: false,
                message: 'Supplier payment not found'
            });
        }
        // Get all payments for this purchase order
        const allPayments = await prisma_1.prisma.supplierPayment.aggregate({
            where: {
                purchaseOrderId: payment.purchaseOrderId
            },
            _sum: {
                amount: true
            }
        });
        const totalPaid = allPayments._sum.amount?.toNumber() || 0;
        res.json({
            success: true,
            payment,
            summary: {
                totalPaid,
                remaining: payment.purchaseOrder.totalAmount.toNumber() - totalPaid,
                fullyPaid: totalPaid >= payment.purchaseOrder.totalAmount.toNumber()
            }
        });
    }
    catch (error) {
        console.error('Error fetching supplier payment:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch supplier payment',
            error: error.message
        });
    }
};
exports.getSupplierPaymentById = getSupplierPaymentById;
/**
 * Delete a supplier payment
 */
const deleteSupplierPayment = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const paymentId = parseInt(req.params.paymentId);
        const userId = req.user?.userId;
        // Verify payment belongs to organization
        const existingPayment = await prisma_1.prisma.supplierPayment.findFirst({
            where: {
                id: Number(paymentId),
                organizationId: Number(organizationId)
            },
            include: {
                purchaseOrder: {
                    select: {
                        orderNumber: true
                    }
                }
            }
        });
        if (!existingPayment) {
            return res.status(404).json({
                success: false,
                message: 'Supplier payment not found'
            });
        }
        // Delete payment
        await prisma_1.prisma.supplierPayment.delete({
            where: { id: Number(paymentId) }
        });
        // Log activity
        await (0, activity_log_middleware_1.logManualActivity)({
            userId: Number(userId),
            organizationId: Number(organizationId),
            module: 'PURCHASE_ORDERS',
            type: client_1.ActivityType.OTHER,
            description: `Deleted supplier payment for PO ${existingPayment.purchaseOrder.orderNumber}`,
            entityType: 'SupplierPayment',
            entityId: paymentId.toString(),
            metadata: { deletedPayment: existingPayment }
        });
        res.json({
            success: true,
            message: 'Supplier payment deleted successfully'
        });
    }
    catch (error) {
        console.error('Error deleting supplier payment:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete supplier payment',
            error: error.message
        });
    }
};
exports.deleteSupplierPayment = deleteSupplierPayment;
