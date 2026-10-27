import type { Response } from 'express';
import { ActivityType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getOrderBy } from '../utils/sorting';
import { logManualActivity } from '../middleware/activity-log.middleware';
import type { BranchAuthRequest } from '../middleware/branchAuth.middleware';
import { buildBranchFilter, getBranchIdForOperation } from '../middleware/branchAuth.middleware';

/**
 * Create a new expense
 */
export const createExpense = async (req: BranchAuthRequest, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const userId = req.user?.userId!;
        const {
            category,
            amount,
            paymentMethod,
            description,
            reference,
            expenseDate,
            notes
        } = req.body;

        const branchId = getBranchIdForOperation(req);

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
        const expense = await prisma.expense.create({
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
                shiftId: req.body.shiftId ? Number(req.body.shiftId) : (
                    await prisma.shift.findFirst({
                        where: { organizationId: Number(organizationId), userId: Number(userId), status: { in: ['OPEN', 'REOPENED'] } },
                        orderBy: { openedAt: 'desc' },
                        select: { id: true },
                    })
                )?.id,
            }
        });

        // Log activity
        await logManualActivity({
            userId: Number(userId),
            organizationId: Number(organizationId),
            module: 'SYSTEM',
            type: ActivityType.OTHER,
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
    } catch (error: any) {
        console.error('Error creating expense:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create expense',
            error: error.message
        });
    }
};

/**
 * Get all expenses for an organization
 */
export const getExpenses = async (req: BranchAuthRequest, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { startDate, endDate, category, paymentMethod, limit = '50', page = '1' } = req.query;

        const where: any = {
            organizationId,
            ...buildBranchFilter(req)
        };

        // Date filter
        if (startDate && endDate) {
            where.expenseDate = {
                gte: new Date(startDate as string),
                lte: new Date(new Date(endDate as string).setHours(23, 59, 59, 999))
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

        const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
        const take = parseInt(limit as string);

        const [expenses, totalCount] = await Promise.all([
            prisma.expense.findMany({
                where,
                include: {
                    user: {
                        select: {
                            name: true,
                            email: true
                        }
                    }
                },
                orderBy: getOrderBy(req.query, {
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
            prisma.expense.count({ where })
        ]);

        // Calculate summary
        const summary = await prisma.expense.aggregate({
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
                currentPage: parseInt(page as string),
                limit: take
            }
        });
    } catch (error: any) {
        console.error('Error fetching expenses:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch expenses',
            error: error.message
        });
    }
};

/**
 * Update an expense
 */
export const updateExpense = async (req: BranchAuthRequest, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const expenseId = parseInt(req.params.expenseId);
        const userId = req.user?.userId!;
        const updateData = req.body;

        // Verify expense belongs to organization
        const existingExpense = await prisma.expense.findFirst({
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
        const expense = await prisma.expense.update({
            where: { id: Number(expenseId) },
            data: {
                ...updateData,
                expenseDate: updateData.expenseDate ? new Date(updateData.expenseDate) : undefined
            }
        });

        // Log activity
        await logManualActivity({
            userId: Number(userId),
            organizationId: Number(organizationId),
            module: 'SYSTEM',
            type: ActivityType.OTHER,
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
    } catch (error: any) {
        console.error('Error updating expense:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update expense',
            error: error.message
        });
    }
};

/**
 * Delete an expense
 */
export const deleteExpense = async (req: BranchAuthRequest, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const expenseId = parseInt(req.params.expenseId);
        const userId = req.user?.userId!;

        // Verify expense belongs to organization
        const existingExpense = await prisma.expense.findFirst({
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
        await prisma.expense.delete({
            where: { id: Number(expenseId) }
        });

        // Log activity
        await logManualActivity({
            userId: Number(userId),
            organizationId: Number(organizationId),
            module: 'SYSTEM',
            type: ActivityType.OTHER,
            description: `Deleted expense: ${existingExpense.description}`,
            entityType: 'Expense',
            entityId: expenseId.toString(),
            metadata: { deletedExpense: existingExpense }
        });

        res.json({
            success: true,
            message: 'Expense deleted successfully'
        });
    } catch (error: any) {
        console.error('Error deleting expense:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete expense',
            error: error.message
        });
    }
};

/**
 * Get expense by ID
 */
export const getExpenseById = async (req: BranchAuthRequest, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const expenseId = parseInt(req.params.expenseId);

        const expense = await prisma.expense.findFirst({
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
    } catch (error: any) {
        console.error('Error fetching expense:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch expense',
            error: error.message
        });
    }
};
