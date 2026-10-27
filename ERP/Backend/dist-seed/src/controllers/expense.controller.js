"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getExpenseById = exports.deleteExpense = exports.updateExpense = exports.getExpenses = exports.createExpense = void 0;
const client_1 = require("@prisma/client");
const prisma_1 = require("../lib/prisma");
const sorting_1 = require("../utils/sorting");
const activity_log_middleware_1 = require("../middleware/activity-log.middleware");
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
/**
 * Create a new expense
 */
const createExpense = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const userId = req.user?.userId;
        const { category, amount, paymentMethod, description, reference, expenseDate, notes } = req.body;
        const branchId = (0, branchAuth_middleware_1.getBranchIdForOperation)(req);
        if (!branchId) {
            return res.status(400).json({
                success: false,
                message: 'Branch ID is required for expense creation'
            });
        }
        // Validation
        if (!category || !amount || !paymentMethod || !description || !expenseDate) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: category, amount, paymentMethod, description, expenseDate'
            });
        }
        // Create expense
        const expense = await prisma_1.prisma.expense.create({
            data: {
                organizationId: Number(organizationId),
                userId: Number(userId),
                branchId: Number(branchId),
                category,
                amount,
                paymentMethod,
                description,
                reference,
                expenseDate: new Date(expenseDate),
                notes,
                // Business rule: expenses are linked to the active shift so the
                // shift reconciliation can deduct cash-paid expenses from the float.
                shiftId: req.body.shiftId ? Number(req.body.shiftId) : (await prisma_1.prisma.shift.findFirst({
                    where: { organizationId: Number(organizationId), userId: Number(userId), status: { in: ['OPEN', 'REOPENED'] } },
                    orderBy: { openedAt: 'desc' },
                    select: { id: true },
                }))?.id,
            }
        });
        // Log activity
        await (0, activity_log_middleware_1.logManualActivity)({
            userId: Number(userId),
            organizationId: Number(organizationId),
            module: 'SYSTEM',
            type: client_1.ActivityType.OTHER,
            description: `Created expense: ${description} - ${amount}`,
            entityType: 'Expense',
            entityId: expense.id.toString(),
            metadata: {
                category,
                amount,
                paymentMethod
            }
        });
        res.status(201).json({
            success: true,
            message: 'Expense created successfully',
            expense
        });
    }
    catch (error) {
        console.error('Error creating expense:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create expense',
            error: error.message
        });
    }
};
exports.createExpense = createExpense;
/**
 * Get all expenses for an organization
 */
const getExpenses = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { startDate, endDate, category, paymentMethod, limit = '50', page = '1' } = req.query;
        const where = {
            organizationId,
            ...(0, branchAuth_middleware_1.buildBranchFilter)(req)
        };
        // Date filter
        if (startDate && endDate) {
            where.expenseDate = {
                gte: new Date(startDate),
                lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
            };
        }
        // Category filter
        if (category && category !== 'ALL') {
            where.category = category;
        }
        // Payment method filter
        if (paymentMethod && paymentMethod !== 'ALL') {
            where.paymentMethod = paymentMethod;
        }
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);
        const [expenses, totalCount] = await Promise.all([
            prisma_1.prisma.expense.findMany({
                where,
                include: {
                    user: {
                        select: {
                            name: true,
                            email: true
                        }
                    }
                },
                orderBy: (0, sorting_1.getOrderBy)(req.query, {
                    expenseDate: { expenseDate: '$direction' },
                    category: { category: '$direction' },
                    description: { description: '$direction' },
                    paymentMethod: { paymentMethod: '$direction' },
                    amount: { amount: '$direction' },
                    user: { user: { name: '$direction' } },
                    createdAt: { createdAt: '$direction' }
                }, 'expenseDate', 'desc'),
                skip,
                take
            }),
            prisma_1.prisma.expense.count({ where })
        ]);
        // Calculate summary
        const summary = await prisma_1.prisma.expense.aggregate({
            where,
            _sum: { amount: true },
            _count: true
        });
        res.json({
            success: true,
            expenses,
            summary: {
                totalExpenses: summary._sum.amount?.toNumber() || 0,
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
        console.error('Error fetching expenses:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch expenses',
            error: error.message
        });
    }
};
exports.getExpenses = getExpenses;
/**
 * Update an expense
 */
const updateExpense = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const expenseId = parseInt(req.params.expenseId);
        const userId = req.user?.userId;
        const updateData = req.body;
        // Verify expense belongs to organization
        const existingExpense = await prisma_1.prisma.expense.findFirst({
            where: {
                id: Number(expenseId),
                organizationId: Number(organizationId)
            }
        });
        if (!existingExpense) {
            return res.status(404).json({
                success: false,
                message: 'Expense not found'
            });
        }
        // Update expense
        const expense = await prisma_1.prisma.expense.update({
            where: { id: Number(expenseId) },
            data: {
                ...updateData,
                expenseDate: updateData.expenseDate ? new Date(updateData.expenseDate) : undefined
            }
        });
        // Log activity
        await (0, activity_log_middleware_1.logManualActivity)({
            userId: Number(userId),
            organizationId: Number(organizationId),
            module: 'SYSTEM',
            type: client_1.ActivityType.OTHER,
            description: `Updated expense: ${expense.description}`,
            entityType: 'Expense',
            entityId: expense.id.toString(),
            metadata: { updateData }
        });
        res.json({
            success: true,
            message: 'Expense updated successfully',
            expense
        });
    }
    catch (error) {
        console.error('Error updating expense:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update expense',
            error: error.message
        });
    }
};
exports.updateExpense = updateExpense;
/**
 * Delete an expense
 */
const deleteExpense = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const expenseId = parseInt(req.params.expenseId);
        const userId = req.user?.userId;
        // Verify expense belongs to organization
        const existingExpense = await prisma_1.prisma.expense.findFirst({
            where: {
                id: expenseId,
                organizationId
            }
        });
        if (!existingExpense) {
            return res.status(404).json({
                success: false,
                message: 'Expense not found'
            });
        }
        // Delete expense
        await prisma_1.prisma.expense.delete({
            where: { id: Number(expenseId) }
        });
        // Log activity
        await (0, activity_log_middleware_1.logManualActivity)({
            userId: Number(userId),
            organizationId: Number(organizationId),
            module: 'SYSTEM',
            type: client_1.ActivityType.OTHER,
            description: `Deleted expense: ${existingExpense.description}`,
            entityType: 'Expense',
            entityId: expenseId.toString(),
            metadata: { deletedExpense: existingExpense }
        });
        res.json({
            success: true,
            message: 'Expense deleted successfully'
        });
    }
    catch (error) {
        console.error('Error deleting expense:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete expense',
            error: error.message
        });
    }
};
exports.deleteExpense = deleteExpense;
/**
 * Get expense by ID
 */
const getExpenseById = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const expenseId = parseInt(req.params.expenseId);
        const expense = await prisma_1.prisma.expense.findFirst({
            where: {
                id: Number(expenseId),
                organizationId: Number(organizationId)
            },
            include: {
                user: {
                    select: {
                        name: true,
                        email: true
                    }
                }
            }
        });
        if (!expense) {
            return res.status(404).json({
                success: false,
                message: 'Expense not found'
            });
        }
        res.json({
            success: true,
            expense
        });
    }
    catch (error) {
        console.error('Error fetching expense:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch expense',
            error: error.message
        });
    }
};
exports.getExpenseById = getExpenseById;
