import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware';
import type { BranchAuthRequest } from '../middleware/branchAuth.middleware';
import { logManualActivity } from '../middleware/activity-log.middleware';
import { ActivityType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { enqueueSupplierPaymentAccountingEvent, withdrawSupplierPaymentAccountingEvent } from '../services/accounting-outbox.service';

// SupplierPayment has no branchId column of its own — it belongs to a branch
// via its purchase order, so filtering goes through that relation.
function purchaseOrderBranchFilter(req: BranchAuthRequest) {
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
export const recordSupplierPayment = async (req: BranchAuthRequest, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const userId = req.user?.userId!;
        const {
            purchaseOrderId,
            amount,
            paymentMethod,
            paymentDate,
            reference,
            notes
        } = req.body;

        // Validation
        if (!purchaseOrderId || !amount || !paymentMethod || !paymentDate) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: purchaseOrderId, amount, paymentMethod, paymentDate'
            });
        }
        if (!(parseFloat(amount) > 0) || Number.isNaN(new Date(paymentDate).getTime())) {
            return res.status(400).json({
                success: false,
                message: 'Amount must be a positive number and paymentDate a valid date'
            });
        }

        // Verify purchase order exists, belongs to the organization, and — for a
        // branch-restricted user — belongs to a branch they actually have access to.
        const purchaseOrder = await prisma.purchaseOrder.findFirst({
            where: {
                id: Number(purchaseOrderId),
                organizationId: Number(organizationId),
                ...(req.selectedBranchId !== null && req.selectedBranchId !== undefined
                    ? { branchId: req.selectedBranchId }
                    : req.selectedBranchIds && req.selectedBranchIds.length > 0
                        ? { branchId: { in: req.selectedBranchIds } }
                        : {})
            },
            include: { supplier: { select: { name: true } } }
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
        const payment = await prisma.$transaction(async (tx) => {
            const [lockedPo] = await tx.$queryRaw<Array<{ id: number; totalAmount: string }>>`
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

            const created = await tx.supplierPayment.create({
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
            await enqueueSupplierPaymentAccountingEvent(tx, {
                organizationId: Number(organizationId),
                branchId: purchaseOrder.branchId,
                paymentId: created.id,
                supplierId: purchaseOrder.supplierId,
                supplierName: purchaseOrder.supplier?.name,
                purchaseOrderNumber: purchaseOrder.orderNumber,
                amount: Number(created.amount),
                paymentMethod: String(paymentMethod),
                paymentDate: created.paymentDate,
                reference,
            });
            return created;
        });

        // Log activity
        await logManualActivity({
            userId: Number(userId),
            organizationId: Number(organizationId),
            module: 'PURCHASE_ORDERS',
            type: ActivityType.PAYMENT_RECEIVED,
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
    } catch (error: any) {
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

/**
 * Get all supplier payments
 */
export const getSupplierPayments = async (req: BranchAuthRequest, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { startDate, endDate, purchaseOrderId, paymentMethod, limit = '50', page = '1' } = req.query;

        const where: any = { organizationId, ...purchaseOrderBranchFilter(req) };

        // Date filter
        if (startDate && endDate) {
            where.paymentDate = {
                gte: new Date(startDate as string),
                lte: new Date(new Date(endDate as string).setHours(23, 59, 59, 999))
            };
        }

        // Purchase order filter
        if (purchaseOrderId) {
            where.purchaseOrderId = parseInt(purchaseOrderId as string);
        }

        // Payment method filter
        if (paymentMethod && paymentMethod !== 'ALL') {
            where.paymentMethod = paymentMethod;
        }

        const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
        const take = parseInt(limit as string);

        const [payments, totalCount] = await Promise.all([
            prisma.supplierPayment.findMany({
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
            prisma.supplierPayment.count({ where })
        ]);

        // Calculate summary
        const summary = await prisma.supplierPayment.aggregate({
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
                currentPage: parseInt(page as string),
                limit: take
            }
        });
    } catch (error: any) {
        console.error('Error fetching supplier payments:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch supplier payments',
            error: error.message
        });
    }
};

/**
 * Get supplier payment by ID
 */
export const getSupplierPaymentById = async (req: BranchAuthRequest, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const paymentId = parseInt(req.params.paymentId);

        const payment = await prisma.supplierPayment.findFirst({
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
        const allPayments = await prisma.supplierPayment.aggregate({
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
    } catch (error: any) {
        console.error('Error fetching supplier payment:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch supplier payment',
            error: error.message
        });
    }
};

/**
 * Delete a supplier payment
 */
export const deleteSupplierPayment = async (req: AuthRequest, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const paymentId = parseInt(req.params.paymentId);
        const userId = req.user?.userId!;

        // Verify payment belongs to organization
        const existingPayment = await prisma.supplierPayment.findFirst({
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

        // Delete payment, unless Accounting may already have posted it
        const PAYMENT_IN_BOOKS = 'PAYMENT_IN_BOOKS';
        try {
            await prisma.$transaction(async (tx) => {
                const withdrawn = await withdrawSupplierPaymentAccountingEvent(tx, {
                    organizationId: Number(organizationId),
                    paymentId: Number(paymentId),
                });
                if (!withdrawn) throw new Error(PAYMENT_IN_BOOKS);
                await tx.supplierPayment.delete({
                    where: { id: Number(paymentId) }
                });
            });
        } catch (e) {
            if ((e as Error).message !== PAYMENT_IN_BOOKS) throw e;
            return res.status(409).json({
                success: false,
                message: 'This payment has already been sent to Accounting and cannot be deleted; record a correction there instead'
            });
        }

        // Log activity
        await logManualActivity({
            userId: Number(userId),
            organizationId: Number(organizationId),
            module: 'PURCHASE_ORDERS',
            type: ActivityType.OTHER,
            description: `Deleted supplier payment for PO ${existingPayment.purchaseOrder.orderNumber}`,
            entityType: 'SupplierPayment',
            entityId: paymentId.toString(),
            metadata: { deletedPayment: existingPayment }
        });

        res.json({
            success: true,
            message: 'Supplier payment deleted successfully'
        });
    } catch (error: any) {
        console.error('Error deleting supplier payment:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete supplier payment',
            error: error.message
        });
    }
};
