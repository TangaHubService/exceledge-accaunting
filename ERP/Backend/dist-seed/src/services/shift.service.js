"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACTIVE_SHIFT_STATUSES = void 0;
exports.getActiveShift = getActiveShift;
exports.openShift = openShift;
exports.getShiftById = getShiftById;
exports.computeShiftSummary = computeShiftSummary;
exports.listShifts = listShifts;
exports.startClose = startClose;
exports.submitClose = submitClose;
exports.approveClose = approveClose;
exports.rejectClose = rejectClose;
exports.reopenShift = reopenShift;
exports.cancelShift = cancelShift;
exports.createCashMovement = createCashMovement;
exports.getShiftDetails = getShiftDetails;
exports.getDailySummary = getDailySummary;
exports.closeShift = closeShift;
const client_1 = require("@prisma/client");
const prisma_1 = require("../lib/prisma");
const organization_settings_service_1 = require("./organization-settings.service");
/**
 * A shift that can still accept transactions / be closed. REOPENED appears
 * when a submitted closing was rejected (manager decision) or an admin
 * reopened a closed shift — operations must continue as if it were OPEN.
 */
exports.ACTIVE_SHIFT_STATUSES = [client_1.ShiftStatus.OPEN, client_1.ShiftStatus.REOPENED];
/**
 * Get the caller's currently open shift, if any (a user may only have one
 * open shift at a time). REOPENED shifts remain "active" for operations.
 */
async function getActiveShift(organizationId, userId) {
    return prisma_1.prisma.shift.findFirst({
        where: { organizationId, userId, status: { in: exports.ACTIVE_SHIFT_STATUSES } },
        orderBy: { openedAt: 'desc' },
    });
}
/** Human-readable shift number, e.g. SH-2026-001. */
async function generateShiftNumber(organizationId) {
    const year = new Date().getFullYear();
    const count = await prisma_1.prisma.shift.count({
        where: { organizationId, openedAt: { gte: new Date(year, 0, 1) } },
    });
    return `SH-${year}-${String(count + 1).padStart(3, '0')}`;
}
async function openShift(params) {
    const { organizationId, branchId, userId, deviceId, openingFloat, openingMobileMoney, openingNotes } = params;
    const existing = await getActiveShift(organizationId, userId);
    if (existing) {
        throw new Error('You already have an open shift. Close it before starting a new one.');
    }
    // Business rule 13: prevent duplicate active shifts for the same register.
    if (deviceId) {
        const registerOpen = await prisma_1.prisma.shift.findFirst({
            where: { organizationId, deviceId, status: { in: exports.ACTIVE_SHIFT_STATUSES } },
        });
        if (registerOpen) {
            throw new Error('This register already has an active shift. Close it before opening a new one.');
        }
    }
    // generateShiftNumber() counts existing rows and is not atomic with the
    // create() below, so two near-simultaneous opens (double-click, two
    // registers) can compute the same number. Shift opens are low-frequency
    // enough that a bounded retry on the unique-constraint conflict is simpler
    // and safer than introducing a dedicated counter table under time pressure.
    for (let attempt = 0; attempt < 5; attempt++) {
        const shiftNumber = await generateShiftNumber(organizationId);
        try {
            return await prisma_1.prisma.shift.create({
                data: {
                    shiftNumber,
                    organizationId,
                    branchId,
                    userId,
                    deviceId,
                    openingFloat,
                    openingMobileMoney: openingMobileMoney ?? 0,
                    openingNotes,
                },
            });
        }
        catch (err) {
            const isShiftNumberConflict = err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                err.code === 'P2002' &&
                err.meta?.target?.includes('shift_number');
            if (!isShiftNumberConflict || attempt === 4) {
                throw err;
            }
        }
    }
    throw new Error('Failed to allocate a unique shift number after multiple attempts.');
}
async function getShiftById(shiftId, organizationId) {
    const shift = await prisma_1.prisma.shift.findFirst({ where: { id: shiftId, organizationId } });
    if (!shift)
        throw new Error('Shift not found');
    return shift;
}
/**
 * Cash/payment-method breakdown for a shift, computed on the fly from its
 * sales rather than persisted, so it always reflects the latest
 * sale/payment/refund/expense/movement state.
 */
async function computeShiftSummary(shiftId, organizationId) {
    const shift = await getShiftById(shiftId, organizationId);
    const sales = await prisma_1.prisma.sale.findMany({
        where: { shiftId, organizationId },
        select: {
            totalAmount: true,
            cashAmount: true,
            debtAmount: true,
            status: true,
            salePayments: { select: { amount: true, paymentMethod: true } },
            saleItems: { select: { dcAmt: true } },
        },
    });
    let grossSales = 0;
    let returns = 0;
    let discounts = 0;
    let creditSales = 0;
    let cashSales = 0;
    let mobileMoneySales = 0;
    let cardSales = 0;
    for (const sale of sales) {
        if (sale.status === client_1.SaleStatus.CANCELLED)
            continue;
        const amount = Number(sale.totalAmount);
        if (sale.status === client_1.SaleStatus.REFUNDED || sale.status === client_1.SaleStatus.PARTIALLY_REFUNDED) {
            // Refund sale rows are stored as negative totals. Keep `returns` as a
            // positive deduction so expected cash and UI summaries do not add it.
            returns += Math.abs(amount);
        }
        else {
            grossSales += amount;
        }
        creditSales += Number(sale.debtAmount);
        discounts += sale.saleItems.reduce((sum, item) => sum + Number(item.dcAmt), 0);
        if (sale.salePayments.length > 0) {
            for (const payment of sale.salePayments) {
                const paid = Number(payment.amount);
                if (payment.paymentMethod === 'CASH')
                    cashSales += paid;
                else if (payment.paymentMethod === 'MTN_MOMO' || payment.paymentMethod === 'AIRTEL_MONEY')
                    mobileMoneySales += paid;
                else if (payment.paymentMethod === 'CARD' || payment.paymentMethod === 'BANK')
                    cardSales += paid;
            }
        }
        else {
            // Legacy sales recorded cash directly on the Sale row instead of via SalePayment.
            cashSales += Number(sale.cashAmount);
        }
    }
    const [movements, expenses] = await Promise.all([
        prisma_1.prisma.cashMovement.groupBy({
            by: ['type'],
            where: { shiftId, organizationId },
            _sum: { amount: true },
        }),
        prisma_1.prisma.expense.findMany({
            where: { shiftId, organizationId },
            select: { amount: true, paymentMethod: true },
        }),
    ]);
    const cashIn = movements.find((m) => m.type === client_1.CashMovementType.CASH_IN)?._sum.amount?.toNumber() ?? 0;
    const cashOut = movements.find((m) => m.type === client_1.CashMovementType.CASH_OUT)?._sum.amount?.toNumber() ?? 0;
    const expenseTotal = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const expenseCash = expenses
        .filter((e) => e.paymentMethod === 'CASH')
        .reduce((sum, e) => sum + Number(e.amount), 0);
    // Cash drawer math: float + cash sales + cash in − cash out − refunds − cash expenses.
    const expectedCash = Number(shift.openingFloat) + cashSales + cashIn - cashOut - returns - expenseCash;
    const expectedMobileMoney = Number(shift.openingMobileMoney ?? 0) + mobileMoneySales;
    return {
        shiftNumber: shift.shiftNumber,
        openingFloat: Number(shift.openingFloat),
        openingMobileMoney: Number(shift.openingMobileMoney ?? 0),
        expectedMobileMoney,
        grossSales,
        netSales: grossSales - Math.abs(returns),
        cashSales,
        mobileMoneySales,
        cardSales,
        creditSales,
        returns,
        discounts,
        cashIn,
        cashOut,
        expenseTotal,
        expenseCash,
        expectedCash,
    };
}
/**
 * Paginated shift history with role-safe filters. The controller passes a
 * `where` already scoped by branch access + explicit filters; this service
 * only adds pagination, sorting and the include graph.
 */
async function listShifts(organizationId, where, filters) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
        prisma_1.prisma.shift.findMany({
            where,
            include: {
                user: { select: { id: true, name: true } },
                branch: { select: { id: true, name: true } },
                device: { select: { id: true, name: true, platform: true } },
                closedBy: { select: { id: true, name: true } },
                approvedBy: { select: { id: true, name: true } },
                _count: { select: { sales: true, cashMovements: true, expenses: true } },
            },
            orderBy: { openedAt: 'desc' },
            skip,
            take: limit,
        }),
        prisma_1.prisma.shift.count({ where }),
    ]);
    return { items, pagination: { totalItems: total, totalPages: Math.ceil(total / limit), page, limit } };
}
/** Mark a shift as CLOSING and return the reconciliation data. */
async function startClose(shiftId, organizationId, userId) {
    const shift = await getShiftById(shiftId, organizationId);
    if (!exports.ACTIVE_SHIFT_STATUSES.includes(shift.status)) {
        throw new Error(`Cannot start closing a shift in status ${shift.status}`);
    }
    const summary = await computeShiftSummary(shiftId, organizationId);
    const updated = await prisma_1.prisma.shift.update({
        where: { id: shiftId },
        data: { status: client_1.ShiftStatus.CLOSING, closingStartedAt: new Date(), closedById: userId },
    });
    return { shift: updated, summary };
}
/**
 * Submit the reconciliation. Sets the shift to PENDING_APPROVAL when the
 * business requires approval, or when the variance exceeds the configured
 * threshold; otherwise it closes immediately.
 */
async function submitClose(params) {
    const { shiftId, organizationId, userId, actualCash, actualMobileMoney, varianceReason, closingNotes, denominationCounts } = params;
    const shift = await getShiftById(shiftId, organizationId);
    if (shift.status === client_1.ShiftStatus.CLOSED || shift.status === client_1.ShiftStatus.CANCELLED) {
        throw new Error('Shift is already closed');
    }
    if (shift.status === client_1.ShiftStatus.PENDING_APPROVAL) {
        throw new Error('Shift closing is already pending approval');
    }
    const summary = await computeShiftSummary(shiftId, organizationId);
    const difference = actualCash - summary.expectedCash;
    const orgSettings = await (0, organization_settings_service_1.getOrganizationSettings)(organizationId);
    const shiftConfig = orgSettings.preferences.shiftConfig ?? {
        approvalRequired: false,
        denominationsEnabled: false,
        varianceThreshold: 0,
    };
    const needsApproval = shiftConfig.approvalRequired ||
        (shiftConfig.varianceThreshold > 0 && Math.abs(difference) > shiftConfig.varianceThreshold);
    const now = new Date();
    const finalStatus = needsApproval ? client_1.ShiftStatus.PENDING_APPROVAL : client_1.ShiftStatus.CLOSED;
    const closed = await prisma_1.prisma.shift.update({
        where: { id: shiftId },
        data: {
            status: finalStatus,
            closingStartedAt: shift.closingStartedAt ?? now,
            closingSubmittedAt: now,
            expectedCash: summary.expectedCash,
            actualCash,
            actualMobileMoney: actualMobileMoney ?? 0,
            difference,
            cashIn: summary.cashIn,
            cashOut: summary.cashOut,
            expenseTotal: summary.expenseTotal,
            denominationCounts: denominationCounts && Object.keys(denominationCounts).length > 0
                ? denominationCounts
                : undefined,
            varianceReason: difference !== 0 ? varianceReason : undefined,
            closingNotes,
            closedById: userId,
            closedAt: needsApproval ? null : now,
        },
    });
    return { shift: closed, summary: { ...summary, actualCash, difference }, needsApproval };
}
/**
 * Manager approves a pending closing. PENDING_APPROVAL → CLOSED.
 * Recorded for audit: who, when, and why.
 */
async function approveClose(shiftId, organizationId, approverId, reason) {
    const shift = await getShiftById(shiftId, organizationId);
    if (shift.status !== client_1.ShiftStatus.PENDING_APPROVAL) {
        throw new Error('Only a pending-approval closing can be approved');
    }
    const closed = await prisma_1.prisma.shift.update({
        where: { id: shiftId },
        data: {
            status: client_1.ShiftStatus.CLOSED,
            approvedById: approverId,
            approvedAt: new Date(),
            approvalDecision: 'APPROVED',
            approvalReason: reason,
            closedAt: shift.closedAt ?? new Date(),
            closedById: shift.closedById ?? approverId,
        },
    });
    return closed;
}
/**
 * Manager rejects a pending closing. PENDING_APPROVAL → REOPENED so the
 * cashier can correct the count and resubmit. Recorded for audit.
 */
async function rejectClose(shiftId, organizationId, reviewerId, reason) {
    const shift = await getShiftById(shiftId, organizationId);
    if (shift.status !== client_1.ShiftStatus.PENDING_APPROVAL) {
        throw new Error('Only a pending-approval closing can be rejected');
    }
    return prisma_1.prisma.shift.update({
        where: { id: shiftId },
        data: {
            status: client_1.ShiftStatus.REOPENED,
            approvedById: reviewerId,
            approvedAt: new Date(),
            approvalDecision: 'REJECTED',
            approvalReason: reason,
            closingSubmittedAt: null,
            closedAt: null,
        },
    });
}
/** Admin reopens a closed shift. Requires permission; audited by the caller. */
async function reopenShift(shiftId, organizationId) {
    const shift = await getShiftById(shiftId, organizationId);
    if (shift.status !== client_1.ShiftStatus.CLOSED && shift.status !== client_1.ShiftStatus.CANCELLED) {
        throw new Error('Only a closed or cancelled shift can be reopened');
    }
    return prisma_1.prisma.shift.update({
        where: { id: shiftId },
        data: {
            status: client_1.ShiftStatus.REOPENED,
            closingStartedAt: null,
            closingSubmittedAt: null,
            approvedAt: null,
            closedAt: null,
        },
    });
}
/** Cancel an empty OPEN shift (admin only, audited by the caller). */
async function cancelShift(shiftId, organizationId) {
    const shift = await getShiftById(shiftId, organizationId);
    if (!exports.ACTIVE_SHIFT_STATUSES.includes(shift.status)) {
        throw new Error('Only an open shift can be cancelled');
    }
    const saleCount = await prisma_1.prisma.sale.count({ where: { shiftId, organizationId } });
    if (saleCount > 0) {
        throw new Error('A shift with transactions cannot be cancelled');
    }
    return prisma_1.prisma.shift.update({
        where: { id: shiftId },
        data: { status: client_1.ShiftStatus.CANCELLED, closedAt: new Date() },
    });
}
async function createCashMovement(params) {
    const { organizationId, branchId, shiftId, userId, type, amount, reason, reference } = params;
    if (!amount || amount <= 0)
        throw new Error('A positive amount is required');
    const shift = await getShiftById(shiftId, organizationId);
    if (!exports.ACTIVE_SHIFT_STATUSES.includes(shift.status)) {
        throw new Error('Cash movements can only be recorded against an open shift');
    }
    return prisma_1.prisma.cashMovement.create({
        data: { organizationId, branchId, shiftId, userId, type, amount, reason, reference },
    });
}
/** Complete audit trail for a shift: info + summary + transactions + movements + expenses. */
async function getShiftDetails(shiftId, organizationId) {
    const shift = await prisma_1.prisma.shift.findFirst({
        where: { id: shiftId, organizationId },
        include: {
            user: { select: { id: true, name: true, email: true } },
            branch: { select: { id: true, name: true, code: true } },
            device: { select: { id: true, name: true, platform: true } },
            closedBy: { select: { id: true, name: true } },
            approvedBy: { select: { id: true, name: true } },
        },
    });
    if (!shift)
        throw new Error('Shift not found');
    const [summary, transactions, cashMovements, expenses] = await Promise.all([
        computeShiftSummary(shiftId, organizationId),
        prisma_1.prisma.sale.findMany({
            where: { shiftId, organizationId },
            include: {
                customer: { select: { id: true, name: true, phone: true } },
                salePayments: { select: { amount: true, paymentMethod: true } },
            },
            orderBy: { createdAt: 'desc' },
        }),
        prisma_1.prisma.cashMovement.findMany({
            where: { shiftId, organizationId },
            orderBy: { createdAt: 'desc' },
        }),
        prisma_1.prisma.expense.findMany({
            where: { shiftId, organizationId },
            orderBy: { createdAt: 'desc' },
        }),
    ]);
    return { shift, summary, transactions, cashMovements, expenses };
}
/** Aggregate a branch's closed shifts for a business day into a daily summary. */
async function getDailySummary(organizationId, branchId, date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    const shifts = await prisma_1.prisma.shift.findMany({
        where: {
            organizationId,
            branchId,
            status: { in: [client_1.ShiftStatus.CLOSED] },
            closedAt: { gte: start, lte: end },
        },
        select: { id: true },
    });
    let totalSales = 0;
    let cashSales = 0;
    let mobileMoneySales = 0;
    let cardSales = 0;
    let creditSales = 0;
    let expenses = 0;
    let returns = 0;
    let cashIn = 0;
    let cashOut = 0;
    let expectedCash = 0;
    let actualCash = 0;
    let variance = 0;
    for (const shift of shifts) {
        const summary = await computeShiftSummary(shift.id, organizationId);
        const closed = await prisma_1.prisma.shift.findUnique({ where: { id: shift.id }, select: { actualCash: true, difference: true } });
        totalSales += summary.grossSales;
        cashSales += summary.cashSales;
        mobileMoneySales += summary.mobileMoneySales;
        cardSales += summary.cardSales;
        creditSales += summary.creditSales;
        expenses += summary.expenseTotal;
        returns += Math.abs(summary.returns);
        cashIn += summary.cashIn;
        cashOut += summary.cashOut;
        expectedCash += summary.expectedCash;
        actualCash += Number(closed?.actualCash ?? 0);
        variance += Number(closed?.difference ?? 0);
    }
    return {
        date: start,
        branchId,
        shiftCount: shifts.length,
        totalSales,
        cashSales,
        mobileMoneySales,
        cardSales,
        creditSales,
        expenses,
        returns,
        cashIn,
        cashOut,
        expectedCash,
        actualCash,
        variance,
    };
}
async function closeShift(params) {
    const result = await submitClose({ ...params });
    return result;
}
