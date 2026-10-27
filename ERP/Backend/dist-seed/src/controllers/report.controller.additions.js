"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCashFlowReport = exports.getDebtPaymentsReport = void 0;
const prisma_1 = require("../lib/prisma");
// ... existing getSalesReport, getInventoryReport, getDebtorsReport, exportReport functions ...
// Paid Debt Report
const getDebtPaymentsReport = async (req, res) => {
    try {
        const organizationId = req.params.organizationId;
        const { startDate, endDate } = req.query;
        const where = {
            organizationId,
            ...(startDate && endDate && {
                paymentDate: {
                    gte: new Date(startDate),
                    lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)),
                }
            })
        };
        // Get all debt payments
        const debtPayments = await prisma_1.prisma.debtPayment.findMany({
            where,
            include: {
                customer: {
                    select: {
                        name: true,
                        phone: true,
                        balance: true
                    }
                },
                recordedBy: {
                    select: {
                        name: true
                    }
                }
            },
            orderBy: {
                paymentDate: 'desc'
            }
        });
        // Calculate summary
        const totalPaid = debtPayments.reduce((sum, payment) => sum + payment.amount.toNumber(), 0);
        const paymentsCount = debtPayments.length;
        const avgPayment = paymentsCount > 0 ? totalPaid / paymentsCount : 0;
        // Get total remaining debt from Sales
        const salesWithDebt = await prisma_1.prisma.sale.aggregate({
            where: {
                organizationId: Number(organizationId),
                debtAmount: { gt: 0 },
                status: { not: 'CANCELLED' }
            },
            _sum: {
                debtAmount: true
            }
        });
        const remainingDebt = salesWithDebt._sum.debtAmount?.toNumber() || 0;
        // Format payments
        const payments = debtPayments.map(payment => ({
            id: payment.id,
            customerName: payment.customer.name,
            customerPhone: payment.customer.phone || 'N/A',
            amountPaid: payment.amount.toNumber(),
            paymentDate: payment.paymentDate.toISOString().split('T')[0],
            paymentMethod: payment.paymentMethod,
            reference: payment.reference || 'N/A',
            notes: payment.notes || '',
            recordedBy: payment.recordedBy.name
        }));
        res.json({
            summary: {
                totalPaid,
                paymentsCount,
                avgPayment,
                remainingDebt
            },
            payments
        });
    }
    catch (error) {
        console.error('Error generating debt payments report:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate debt payments report',
            error: error.message,
        });
    }
};
exports.getDebtPaymentsReport = getDebtPaymentsReport;
// Cash Flow Report
const getCashFlowReport = async (req, res) => {
    try {
        const organizationId = req.params.organizationId;
        const { startDate, endDate } = req.query;
        const where = {
            organizationId,
            ...(startDate && endDate && {
                createdAt: {
                    gte: new Date(startDate),
                    lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)),
                }
            })
        };
        const sales = await prisma_1.prisma.sale.findMany({
            where: {
                ...where,
                status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED'] }
            },
            orderBy: { createdAt: 'asc' }
        });
        const purchaseOrders = await prisma_1.prisma.purchaseOrder.findMany({
            where: {
                ...where,
                status: 'COMPLETED'
            },
            orderBy: { createdAt: 'asc' }
        });
        const inventoryProducts = await prisma_1.prisma.product.findMany({
            where: {
                organizationId: Number(organizationId)
            },
            select: {
                quantity: true,
                unitPrice: true
            }
        });
        const openingBalance = inventoryProducts.reduce((sum, product) => {
            return sum + (product.quantity * product.unitPrice.toNumber());
        }, 0);
        const transactions = [];
        let runningBalance = openingBalance;
        sales.forEach(sale => {
            const amount = sale.cashAmount.toNumber();
            runningBalance += amount;
            transactions.push({
                date: sale.createdAt.toISOString().split('T')[0],
                description: `Sale ${sale.saleNumber}`,
                type: 'INCOME',
                category: 'Sales',
                amount: amount,
                balance: runningBalance
            });
        });
        purchaseOrders.forEach(po => {
            const amount = po.totalAmount.toNumber();
            runningBalance -= amount;
            transactions.push({
                date: po.createdAt.toISOString().split('T')[0],
                description: `Purchase Order ${po.orderNumber}`,
                type: 'EXPENSE',
                category: 'Inventory Purchase',
                amount: -amount,
                balance: runningBalance
            });
        });
        transactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        runningBalance = openingBalance;
        transactions.forEach(t => {
            runningBalance += t.amount;
            t.balance = runningBalance;
        });
        const totalIncome = sales.reduce((sum, sale) => sum + sale.cashAmount.toNumber(), 0);
        const totalExpenses = purchaseOrders.reduce((sum, po) => sum + po.totalAmount.toNumber(), 0);
        const netCashFlow = totalIncome - totalExpenses;
        const closingBalance = openingBalance + netCashFlow;
        res.json({
            summary: {
                totalIncome,
                totalExpenses,
                netCashFlow,
                openingBalance,
                closingBalance
            },
            transactions
        });
    }
    catch (error) {
        console.error('Error generating cash flow report:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate cash flow report',
            error: error.message,
        });
    }
};
exports.getCashFlowReport = getCashFlowReport;
