"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOverviewDashboard = exports.getDetailedInventory = exports.getExecutiveDashboard = exports.topSellingProducts = exports.getNotifications = exports.getSalesTrend = exports.getDashboardStats = exports.getBranchDashboardStats = void 0;
exports.parseDateRange = parseDateRange;
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
const prisma_1 = require("../lib/prisma");
function parseDateRange(query) {
    const now = new Date();
    const endOfDay = (d) => {
        const e = new Date(d);
        e.setHours(23, 59, 59, 999);
        return e;
    };
    const startOfDay = (d) => {
        const s = new Date(d);
        s.setHours(0, 0, 0, 0);
        return s;
    };
    const endDate = endOfDay(now);
    let startDate;
    const preset = query.preset;
    const qStart = query.startDate;
    const qEnd = query.endDate;
    if (qStart && qEnd) {
        startDate = new Date(qStart);
        startDate.setHours(0, 0, 0, 0);
        const ed = new Date(qEnd);
        ed.setHours(23, 59, 59, 999);
        return { startDate, endDate: ed };
    }
    switch (preset) {
        case 'today':
            startDate = startOfDay(now);
            break;
        case 'yesterday': {
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            startDate = startOfDay(yesterday);
            endDate.setTime(endOfDay(yesterday).getTime());
            break;
        }
        case 'this_week': {
            const dayOfWeek = now.getDay();
            const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            startDate = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff));
            break;
        }
        case 'last_week': {
            const dayOfWeek = now.getDay();
            const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            const lastMon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff - 7);
            const lastSun = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff - 1);
            startDate = startOfDay(lastMon);
            endDate.setTime(endOfDay(lastSun).getTime());
            break;
        }
        case 'this_month':
            startDate = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
            break;
        case 'last_month':
            startDate = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
            endDate.setTime(endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)).getTime());
            break;
        case 'this_year':
            startDate = startOfDay(new Date(now.getFullYear(), 0, 1));
            break;
        case 'weekly': {
            const dayOfWeek = now.getDay();
            const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            startDate = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff));
            break;
        }
        case 'monthly':
            startDate = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
            break;
        default:
            // Fallback: last 30 days
            startDate = new Date(now);
            startDate.setDate(startDate.getDate() - 30);
            startDate.setHours(0, 0, 0, 0);
    }
    return { startDate, endDate };
}
// ── Per-branch dashboard stats ────────────────────────────────────────────
const getBranchDashboardStats = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { startDate, endDate } = parseDateRange(req.query);
        const branchFilter = (0, branchAuth_middleware_1.buildBranchFilter)(req);
        const branchId = typeof branchFilter.branchId === 'number' ? branchFilter.branchId : null;
        // ── Fetch active branches ──────────────────────────────────────
        const branches = await prisma_1.prisma.branch.findMany({
            where: {
                organizationId,
                status: 'ACTIVE',
                ...(branchId ? { id: branchId } : {}),
            },
            select: { id: true, name: true, code: true, location: true },
            orderBy: { name: 'asc' },
        });
        // ── Aggregate per-branch in a single pass ──────────────────────
        const branchIds = branches.map(b => b.id);
        // 1. Sales aggregation per branch
        const salesRows = branchIds.length > 0
            ? await prisma_1.prisma.sale.groupBy({
                by: ['branchId'],
                where: {
                    organizationId,
                    branchId: { in: branchIds },
                    createdAt: { gte: startDate, lte: endDate },
                    status: { not: 'CANCELLED' },
                    isProforma: false,
                },
                _sum: { totalAmount: true, cashAmount: true, debtAmount: true, insuranceAmount: true },
                _count: { id: true },
            })
            : [];
        const salesAgg = new Map(salesRows.map(r => [r.branchId, r]));
        // 2. Low stock per branch (via inventory_ledger balance)
        const ledgerBalances = branchIds.length > 0
            ? (await prisma_1.prisma.$queryRaw `
          SELECT il."branchId", il."productId",
            COALESCE(SUM(CASE WHEN il.direction = 'IN' THEN il.quantity ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN il.direction = 'OUT' THEN il.quantity ELSE 0 END), 0) AS bal
          FROM inventory_ledger il
          WHERE il."organizationId" = ${organizationId}
            AND il."branchId" = ANY(${branchIds})
          GROUP BY il."branchId", il."productId"
        `)
            : [];
        // Build per-product stock map per branch
        const stockByBranch = new Map();
        for (const row of ledgerBalances) {
            if (!stockByBranch.has(row.branchId))
                stockByBranch.set(row.branchId, new Map());
            stockByBranch.get(row.branchId).set(row.productId, Number(row.bal));
        }
        const products = await prisma_1.prisma.product.findMany({
            where: { organizationId, deletedAt: null, isActive: true },
            select: { id: true, name: true, minStock: true },
        });
        // 3. Expiring batches per branch
        const expiringBatches = branchIds.length > 0
            ? await prisma_1.prisma.batch.groupBy({
                by: ['branchId'],
                where: {
                    organizationId,
                    branchId: { in: branchIds },
                    isActive: true,
                    expiryDate: { not: null, lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), gte: new Date() },
                },
                _count: { id: true },
            }).then(rows => new Map(rows.map(r => [r.branchId, r._count.id])))
            : new Map();
        // 4. Expenses per branch
        const expenseRows = branchIds.length > 0
            ? await prisma_1.prisma.expense.groupBy({
                by: ['branchId'],
                where: {
                    organizationId,
                    branchId: { in: branchIds },
                    expenseDate: { gte: startDate, lte: endDate },
                },
                _sum: { amount: true },
            })
            : [];
        const expenseAgg = new Map(expenseRows.map(r => [r.branchId, r]));
        // ── Build response ──────────────────────────────────────────────
        const branchStats = branches.map(branch => {
            const saleRow = salesAgg.get(branch.id);
            const expenseRow = expenseAgg.get(branch.id);
            const branchStock = stockByBranch.get(branch.id) ?? new Map();
            const lowStockCount = products.filter(p => {
                const q = branchStock.get(p.id) ?? 0;
                return p.minStock > 0 && q <= p.minStock;
            }).length;
            return {
                branchId: branch.id,
                branchName: branch.name,
                branchCode: branch.code,
                location: branch.location,
                metrics: {
                    totalSales: Number(saleRow?._sum.totalAmount ?? 0),
                    transactionCount: saleRow?._count.id ?? 0,
                    cashAmount: Number(saleRow?._sum.cashAmount ?? 0),
                    debtAmount: Number(saleRow?._sum.debtAmount ?? 0),
                    insuranceAmount: Number(saleRow?._sum.insuranceAmount ?? 0),
                    totalExpenses: Number(expenseRow?._sum.amount ?? 0),
                    lowStockCount,
                    expiringSoonCount: expiringBatches.get(branch.id) ?? 0,
                },
            };
        });
        res.json({
            dateRange: {
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                preset: req.query.preset ?? 'custom',
            },
            branches: branchStats,
            totalBranches: branches.length,
        });
    }
    catch (error) {
        console.error('[Branch Dashboard Stats Error]:', error);
        res.status(500).json({ error: 'Failed to fetch branch dashboard stats' });
    }
};
exports.getBranchDashboardStats = getBranchDashboardStats;
/** Ledger net quantity per product for org, optionally scoped to one branch */
async function ledgerBalanceByProduct(organizationId, branchId) {
    const map = new Map();
    const rows = branchId != null
        ? await prisma_1.prisma.$queryRaw `
          SELECT "productId",
            COALESCE(SUM(CASE WHEN direction = 'IN' THEN quantity ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN direction = 'OUT' THEN quantity ELSE 0 END), 0) AS bal
          FROM inventory_ledger
          WHERE "organizationId" = ${organizationId}
            AND "branchId" = ${branchId}
          GROUP BY "productId"
        `
        : await prisma_1.prisma.$queryRaw `
          SELECT "productId",
            COALESCE(SUM(CASE WHEN direction = 'IN' THEN quantity ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN direction = 'OUT' THEN quantity ELSE 0 END), 0) AS bal
          FROM inventory_ledger
          WHERE "organizationId" = ${organizationId}
          GROUP BY "productId"
        `;
    for (const r of rows) {
        map.set(r.productId, Number(r.bal));
    }
    return map;
}
function effectiveQuantity(productId, cachedQuantity, ledgerMap) {
    if (!ledgerMap.has(productId))
        return cachedQuantity;
    return ledgerMap.get(productId) ?? 0;
}
const getDashboardStats = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { days: qDays } = req.query;
        let startDate;
        let endDate = new Date();
        endDate.setHours(23, 59, 59, 999);
        if (qDays !== 'all') {
            const days = Number.parseInt(qDays) || 7;
            startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            startDate.setHours(0, 0, 0, 0);
        }
        const branchFilter = (0, branchAuth_middleware_1.buildBranchFilter)(req);
        const branchId = typeof branchFilter.branchId === "number" ? branchFilter.branchId : null;
        const ledgerMap = await ledgerBalanceByProduct(organizationId, branchId);
        const allProducts = await prisma_1.prisma.product.findMany({
            where: { organizationId, deletedAt: null, isActive: true },
            select: {
                id: true,
                name: true,
                quantity: true,
                minStock: true,
                unitPrice: true,
                category: true,
            },
        });
        const lowStock = allProducts
            .map((prod) => {
            const q = effectiveQuantity(prod.id, prod.quantity, ledgerMap);
            return {
                id: prod.id,
                name: prod.name,
                quantity: q,
                minStock: prod.minStock,
                remaining: q - prod.minStock,
            };
        })
            .filter((p) => p.minStock > 0 && p.quantity <= p.minStock)
            .sort((a, b) => a.remaining - b.remaining)
            .slice(0, 3);
        const expiringProducts = await prisma_1.prisma.product.findMany({
            where: {
                organizationId,
                deletedAt: null,
                expiryDate: {
                    not: null,
                    gt: new Date(),
                },
                ...(branchId != null
                    ? {
                        batches: {
                            some: { branchId, isActive: true },
                        },
                    }
                    : {}),
            },
            select: {
                id: true,
                name: true,
                expiryDate: true,
            },
            take: 3,
            orderBy: {
                expiryDate: "asc",
            },
        });
        const productsWithRemainingDays = expiringProducts.map((prod) => {
            const today = new Date();
            const expiry = new Date(prod.expiryDate);
            const diffTime = expiry.getTime() - today.getTime();
            const remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            return {
                ...prod,
                remainingDays,
            };
        });
        const totalProducts = allProducts.length;
        let totalStock = 0;
        let totalInventoryValue = 0;
        const categoryTotals = new Map();
        for (const p of allProducts) {
            const q = effectiveQuantity(p.id, p.quantity, ledgerMap);
            totalStock += q;
            totalInventoryValue += q * p.unitPrice.toNumber();
            const cat = p.category || "Uncategorized";
            categoryTotals.set(cat, (categoryTotals.get(cat) ?? 0) + q);
        }
        const salesStats = await prisma_1.prisma.sale.aggregate({
            where: {
                organizationId,
                ...(0, branchAuth_middleware_1.buildBranchFilter)(req),
                ...(startDate && {
                    createdAt: {
                        gte: startDate,
                        lte: endDate,
                    },
                }),
                status: { not: 'CANCELLED' },
                isProforma: false,
            },
            _sum: {
                totalAmount: true
            }
        });
        const result = {
            totalProducts,
            totalStock,
            totalCategory: categoryTotals.size,
            totalInventoryValue,
            totalRevenue: Number(salesStats._sum.totalAmount || 0)
        };
        res.json({
            stockAlerts: lowStock,
            expiringProducts: productsWithRemainingDays,
            ...result,
        });
    }
    catch (error) {
        console.error("[Dashboard Stats Error]:", error);
        res.status(500).json({ error: "Failed to get dashboard stats" });
    }
};
exports.getDashboardStats = getDashboardStats;
const getSalesTrend = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { startDate: qStartDate, endDate: qEndDate, days: qDays } = req.query;
        let startDate;
        let endDate = new Date();
        if (qStartDate && qEndDate) {
            startDate = new Date(qStartDate);
            endDate = new Date(qEndDate);
            // Ensure endDate includes the full day if it's just a date string
            endDate.setHours(23, 59, 59, 999);
        }
        else if (qDays === 'all') {
            startDate = undefined;
        }
        else {
            const days = Number.parseInt(qDays) || 7;
            startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            startDate.setHours(0, 0, 0, 0);
        }
        const salesData = await prisma_1.prisma.sale.findMany({
            where: {
                organizationId,
                ...(0, branchAuth_middleware_1.buildBranchFilter)(req),
                isProforma: false,
                ...(startDate && {
                    createdAt: {
                        gte: startDate,
                        lte: endDate,
                    }
                }),
            },
            select: {
                createdAt: true,
                totalAmount: true,
            },
        });
        const salesByDate = salesData.reduce((acc, sale) => {
            const date = sale.createdAt.toISOString().split("T")[0];
            if (!acc[date])
                acc[date] = 0;
            acc[date] += Number(sale.totalAmount);
            return acc;
        }, {});
        // Fill in missing dates with 0 to ensure a continuous chart
        const result = [];
        // Determine the start point for the continuous chart
        let chartStartDate = startDate;
        if (!chartStartDate) {
            if (salesData.length > 0) {
                const dates = salesData.map(s => s.createdAt.getTime());
                chartStartDate = new Date(Math.min(...dates));
            }
            else {
                chartStartDate = new Date(endDate);
            }
        }
        const current = new Date(chartStartDate);
        current.setHours(0, 0, 0, 0);
        while (current <= endDate) {
            const dateStr = current.toISOString().split("T")[0];
            result.push({
                date: dateStr,
                totalAmount: salesByDate[dateStr] || 0,
            });
            current.setDate(current.getDate() + 1);
        }
        res.json(result);
    }
    catch (error) {
        console.error("[Sales Trend Error]:", error);
        res.status(500).json({ error: "Failed to get sales trend" });
    }
};
exports.getSalesTrend = getSalesTrend;
const getNotifications = async (req, res) => {
    try {
        const organizationId = Number(req.params.organizationId);
        const branchFilter = (0, branchAuth_middleware_1.buildBranchFilter)(req);
        const branchId = typeof branchFilter.branchId === "number" ? branchFilter.branchId : null;
        const ledgerMap = await ledgerBalanceByProduct(organizationId, branchId);
        const notifications = [];
        const expired = await prisma_1.prisma.product.findMany({
            where: {
                organizationId: Number(organizationId),
                deletedAt: null,
                expiryDate: {
                    not: null,
                    lt: new Date(),
                },
                ...(branchId != null
                    ? { batches: { some: { branchId, isActive: true } } }
                    : {}),
            },
            take: 5,
        });
        expired.forEach((prod) => {
            notifications.push({
                type: "danger",
                title: "Product Expired",
                message: `${prod.name} (Batch: ${prod.batchNumber}) has expired`,
                time: prod.expiryDate,
            });
        });
        const expiringSoon = await prisma_1.prisma.product.findMany({
            where: {
                organizationId: Number(organizationId),
                deletedAt: null,
                expiryDate: {
                    not: null,
                    gte: new Date(),
                    lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                },
                ...(branchId != null
                    ? { batches: { some: { branchId, isActive: true } } }
                    : {}),
            },
            take: 5,
        });
        expiringSoon.forEach((prod) => {
            notifications.push({
                type: "warning",
                title: "Product Expiring Soon",
                message: `${prod.name} expires in less than 7 days`,
                time: prod.expiryDate,
            });
        });
        const products = await prisma_1.prisma.product.findMany({
            where: { organizationId: Number(organizationId), deletedAt: null, isActive: true },
            select: { id: true, name: true, quantity: true, minStock: true },
        });
        const lowStock = products
            .map((p) => ({
            ...p,
            q: effectiveQuantity(p.id, p.quantity, ledgerMap),
        }))
            .filter((p) => p.minStock > 0 && p.q <= p.minStock)
            .slice(0, 5);
        lowStock.forEach((prod) => {
            notifications.push({
                type: "warning",
                title: "Low Stock Alert",
                message: `${prod.name} is running low (${prod.q} units remaining)`,
                time: new Date(),
            });
        });
        res.json(notifications);
    }
    catch (error) {
        console.error("[Notifications Error]:", error);
        res.status(500).json({ error: "Failed to get notifications" });
    }
};
exports.getNotifications = getNotifications;
const topSellingProducts = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const salesData = await prisma_1.prisma.saleItem.groupBy({
            by: ["productId"],
            _sum: {
                quantity: true,
                totalPrice: true,
            },
            orderBy: {
                _sum: { quantity: "desc" },
            },
            take: 10,
            where: {
                sale: {
                    organizationId,
                    ...(0, branchAuth_middleware_1.buildBranchFilter)(req),
                },
            },
        });
        if (!salesData.length) {
            return res.status(404).json({ message: "No sales data found." });
        }
        const productIds = salesData.map((s) => s.productId).filter((id) => id !== null);
        const products = await prisma_1.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true },
        });
        const result = salesData.map((item) => {
            const product = products.find((p) => p.id === item.productId);
            return {
                id: item.productId,
                name: product?.name || "Unknown Product",
                sold: item._sum.quantity || 0,
                revenue: Number(item._sum.totalPrice || 0),
            };
        });
        res.status(200).json({
            message: "Top selling products retrieved successfully",
            data: result,
        });
    }
    catch (error) {
        console.error("Error fetching top selling products:", error);
        res.status(500).json({
            message: "Failed to fetch top selling products",
            error: error.message,
        });
    }
};
exports.topSellingProducts = topSellingProducts;
const getExecutiveDashboard = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { startDate, endDate } = parseDateRange(req.query);
        const branchFilter = (0, branchAuth_middleware_1.buildBranchFilter)(req);
        const singleBranchId = typeof branchFilter.branchId === 'number' ? branchFilter.branchId : null;
        // Previous period: same duration immediately before current period
        const periodMs = endDate.getTime() - startDate.getTime();
        const prevEnd = new Date(startDate.getTime() - 1);
        const prevStart = new Date(prevEnd.getTime() - periodMs);
        // Active branches (optionally scoped to one branch)
        const branches = await prisma_1.prisma.branch.findMany({
            where: {
                organizationId,
                status: 'ACTIVE',
                ...(singleBranchId ? { id: singleBranchId } : {}),
            },
            select: { id: true, name: true, code: true, location: true },
            orderBy: { name: 'asc' },
        });
        const branchIds = branches.map(b => b.id);
        if (branchIds.length === 0) {
            return res.json({
                dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString(), preset: req.query.preset ?? 'custom' },
                kpis: {
                    totalRevenue: { value: 0, prevValue: 0, change: null, sparkline: [] },
                    totalOrders: { value: 0, prevValue: 0, change: null, sparkline: [] },
                    avgOrderValue: { value: 0, prevValue: 0, change: null, sparkline: [] },
                    topBranch: null,
                },
                branchTable: [],
                branchTrends: [],
                recentTransactions: [],
                alerts: [],
            });
        }
        const saleBase = (s, e) => ({
            organizationId,
            status: { not: 'CANCELLED' },
            isProforma: false,
            createdAt: { gte: s, lte: e },
            branchId: { in: branchIds },
        });
        // Date array covering the selected range (for chart x-axis)
        const allDates = [];
        const dateCursor = new Date(startDate);
        dateCursor.setHours(0, 0, 0, 0);
        while (dateCursor <= endDate) {
            allDates.push(dateCursor.toISOString().split('T')[0]);
            dateCursor.setDate(dateCursor.getDate() + 1);
        }
        // Fixed windows for sparklines and alert thresholds
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const sparkEnd = new Date(now);
        sparkEnd.setHours(23, 59, 59, 999);
        const sparkStart = new Date(now);
        sparkStart.setDate(sparkStart.getDate() - 6);
        sparkStart.setHours(0, 0, 0, 0);
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        thirtyDaysAgo.setHours(0, 0, 0, 0);
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        // Run all heavy queries in parallel
        const [currentAgg, prevAgg, branchCurrRows, branchPrevRows, sparkSales, trendSales, recentSales, histRows, todayRows, recentHourRows, lastSaleRows,] = await Promise.all([
            prisma_1.prisma.sale.aggregate({ where: saleBase(startDate, endDate), _sum: { totalAmount: true }, _count: { id: true } }),
            prisma_1.prisma.sale.aggregate({ where: saleBase(prevStart, prevEnd), _sum: { totalAmount: true }, _count: { id: true } }),
            prisma_1.prisma.sale.groupBy({ by: ['branchId'], where: saleBase(startDate, endDate), _sum: { totalAmount: true }, _count: { id: true } }),
            prisma_1.prisma.sale.groupBy({ by: ['branchId'], where: saleBase(prevStart, prevEnd), _sum: { totalAmount: true }, _count: { id: true } }),
            prisma_1.prisma.sale.findMany({ where: saleBase(sparkStart, sparkEnd), select: { createdAt: true, totalAmount: true } }),
            prisma_1.prisma.sale.findMany({ where: saleBase(startDate, endDate), select: { createdAt: true, totalAmount: true, branchId: true } }),
            prisma_1.prisma.sale.findMany({
                where: { organizationId, branchId: { in: branchIds }, isProforma: false },
                select: { id: true, saleNumber: true, totalAmount: true, status: true, createdAt: true, branchId: true, branch: { select: { name: true } } },
                orderBy: { createdAt: 'desc' },
                take: 20,
            }),
            prisma_1.prisma.sale.groupBy({ by: ['branchId'], where: { organizationId, status: { not: 'CANCELLED' }, isProforma: false, createdAt: { gte: thirtyDaysAgo }, branchId: { in: branchIds } }, _sum: { totalAmount: true }, _count: { id: true } }),
            prisma_1.prisma.sale.groupBy({ by: ['branchId'], where: { organizationId, status: { not: 'CANCELLED' }, isProforma: false, createdAt: { gte: todayStart }, branchId: { in: branchIds } }, _sum: { totalAmount: true }, _count: { id: true } }),
            prisma_1.prisma.sale.groupBy({ by: ['branchId'], where: { organizationId, status: { not: 'CANCELLED' }, isProforma: false, createdAt: { gte: twoHoursAgo }, branchId: { in: branchIds } }, _count: { id: true } }),
            prisma_1.prisma.$queryRaw `
        SELECT DISTINCT ON ("branchId") "branchId", "createdAt" AS "lastAt"
        FROM sales
        WHERE "organizationId" = ${organizationId}
          AND "branchId" = ANY(${branchIds}::int[])
          AND status != 'CANCELLED'
        ORDER BY "branchId", "createdAt" DESC
      `,
        ]);
        // ── Index maps ──────────────────────────────────────────────────
        const branchCurrMap = new Map(branchCurrRows.map(r => [r.branchId, r]));
        const branchPrevMap = new Map(branchPrevRows.map(r => [r.branchId, r]));
        const histMap = new Map(histRows.map(r => [r.branchId, r]));
        const todayMap = new Map(todayRows.map(r => [r.branchId, r]));
        const recentHourMap = new Map(recentHourRows.map(r => [r.branchId, r._count.id]));
        const lastSaleMap = new Map(lastSaleRows.map(r => [Number(r.branchId), r.lastAt]));
        // ── Sparklines (7 days, one value per day) ──────────────────────
        const sparkRevMap = new Map();
        const sparkOrdMap = new Map();
        for (const s of sparkSales) {
            const d = s.createdAt.toISOString().split('T')[0];
            sparkRevMap.set(d, (sparkRevMap.get(d) ?? 0) + Number(s.totalAmount));
            sparkOrdMap.set(d, (sparkOrdMap.get(d) ?? 0) + 1);
        }
        const revSparkline = [];
        const ordSparkline = [];
        const avgSparkline = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const ds = d.toISOString().split('T')[0];
            const rev = sparkRevMap.get(ds) ?? 0;
            const ord = sparkOrdMap.get(ds) ?? 0;
            revSparkline.push(rev);
            ordSparkline.push(ord);
            avgSparkline.push(ord > 0 ? Math.round(rev / ord) : 0);
        }
        // ── Per-branch trend data for line chart ────────────────────────
        const trendByBranch = new Map();
        for (const s of trendSales) {
            const d = s.createdAt.toISOString().split('T')[0];
            if (!trendByBranch.has(s.branchId))
                trendByBranch.set(s.branchId, new Map());
            const m = trendByBranch.get(s.branchId);
            m.set(d, (m.get(d) ?? 0) + Number(s.totalAmount));
        }
        const branchTrends = branches.map(b => ({
            branchId: b.id,
            branchName: b.name,
            data: allDates.map(d => ({ date: d, amount: trendByBranch.get(b.id)?.get(d) ?? 0 })),
        }));
        // ── KPIs ────────────────────────────────────────────────────────
        const totalRevenue = Number(currentAgg._sum.totalAmount ?? 0);
        const prevRevenue = Number(prevAgg._sum.totalAmount ?? 0);
        const totalOrders = currentAgg._count.id ?? 0;
        const prevOrders = prevAgg._count.id ?? 0;
        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const prevAvgOrderValue = prevOrders > 0 ? prevRevenue / prevOrders : 0;
        const pctChange = (curr, prev) => {
            if (prev === 0)
                return null;
            return Math.round(((curr - prev) / prev) * 1000) / 10;
        };
        let topBranch = null;
        for (const [bId, row] of branchCurrMap.entries()) {
            const rev = Number(row._sum.totalAmount ?? 0);
            const b = branches.find(x => x.id === bId);
            if (b && (!topBranch || rev > topBranch.revenue))
                topBranch = { name: b.name, revenue: rev };
        }
        // ── Branch comparison table ─────────────────────────────────────
        const hoursElapsedToday = Math.min((Date.now() - todayStart.getTime()) / (1000 * 60 * 60), 24);
        const branchTable = branches.map(b => {
            const curr = branchCurrMap.get(b.id);
            const prev = branchPrevMap.get(b.id);
            const hist = histMap.get(b.id);
            const today = todayMap.get(b.id);
            const revenue = Number(curr?._sum.totalAmount ?? 0);
            const orders = curr?._count.id ?? 0;
            const prevRev = Number(prev?._sum.totalAmount ?? 0);
            const avgOrder = orders > 0 ? revenue / orders : 0;
            const avgDailyRevenue = hist ? Number(hist._sum.totalAmount ?? 0) / 30 : 0;
            const expectedByNow = avgDailyRevenue * (hoursElapsedToday / 24);
            const todayRevenue = Number(today?._sum.totalAmount ?? 0);
            let status = 'ACTIVE';
            if (expectedByNow > 0) {
                if (todayRevenue < expectedByNow * 0.35)
                    status = 'BELOW_TARGET';
                else if (todayRevenue < expectedByNow * 0.70)
                    status = 'AT_RISK';
            }
            return { branchId: b.id, branchName: b.name, location: b.location ?? '', orders, revenue, avgOrder, vsLastPeriod: pctChange(revenue, prevRev), status };
        });
        // ── Alerts (data-derived thresholds) ───────────────────────────
        const alerts = [];
        for (const branch of branches) {
            const hist = histMap.get(branch.id);
            const todayData = todayMap.get(branch.id);
            const avgDailyRevenue = hist ? Number(hist._sum.totalAmount ?? 0) / 30 : 0;
            const avgDailyOrders = hist ? (hist._count.id ?? 0) / 30 : 0;
            const todayRevenue = Number(todayData?._sum.totalAmount ?? 0);
            const expectedByNow = avgDailyRevenue * (hoursElapsedToday / 24);
            if (expectedByNow > 0 && todayRevenue < expectedByNow * 0.5) {
                const pct = Math.round((1 - todayRevenue / expectedByNow) * 100);
                alerts.push({ type: 'danger', message: `${branch.name} is ${pct}% below today's target` });
            }
            const avg2hOrders = avgDailyOrders / 12;
            const recent2h = recentHourMap.get(branch.id) ?? 0;
            if (avg2hOrders > 0 && recent2h >= avg2hOrders * 3) {
                const multiple = Math.round(recent2h / avg2hOrders);
                alerts.push({ type: 'info', message: `${branch.name}: ${multiple}x normal volume in last 2 hours` });
            }
            const lastAt = lastSaleMap.get(branch.id);
            if (lastAt) {
                const hoursAgo = Math.floor((Date.now() - new Date(lastAt).getTime()) / (1000 * 60 * 60));
                if (hoursAgo >= 4)
                    alerts.push({ type: 'warning', message: `${branch.name}: no orders in ${hoursAgo} hours` });
            }
        }
        res.json({
            dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString(), preset: req.query.preset ?? 'custom' },
            kpis: {
                totalRevenue: { value: totalRevenue, prevValue: prevRevenue, change: pctChange(totalRevenue, prevRevenue), sparkline: revSparkline },
                totalOrders: { value: totalOrders, prevValue: prevOrders, change: pctChange(totalOrders, prevOrders), sparkline: ordSparkline },
                avgOrderValue: { value: avgOrderValue, prevValue: prevAvgOrderValue, change: pctChange(avgOrderValue, prevAvgOrderValue), sparkline: avgSparkline },
                topBranch,
            },
            branchTable,
            branchTrends,
            recentTransactions: recentSales.map(s => ({
                id: s.id,
                saleNumber: s.saleNumber,
                amount: Number(s.totalAmount),
                status: s.status,
                createdAt: s.createdAt.toISOString(),
                branchName: s.branch.name,
                branchId: s.branchId,
            })),
            alerts,
        });
    }
    catch (error) {
        console.error('[Executive Dashboard Error]:', error);
        res.status(500).json({ error: 'Failed to fetch executive dashboard' });
    }
};
exports.getExecutiveDashboard = getExecutiveDashboard;
const getDetailedInventory = async (req, res) => {
    try {
        const organizationId = Number(req.params.organizationId);
        const { search, category, status } = req.query;
        const branchFilter = (0, branchAuth_middleware_1.buildBranchFilter)(req);
        const branchId = typeof branchFilter.branchId === "number" ? branchFilter.branchId : null;
        const ledgerMap = await ledgerBalanceByProduct(organizationId, branchId);
        const where = { organizationId, deletedAt: null };
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
            ];
        }
        if (category) {
            where.category = category;
        }
        const products = await prisma_1.prisma.product.findMany({
            where,
            include: {
                saleItems: {
                    where: {
                        sale: {
                            organizationId,
                            ...(0, branchAuth_middleware_1.buildBranchFilter)(req),
                            createdAt: {
                                gte: new Date(new Date().setDate(new Date().getDate() - 30)) // Last 30 days
                            }
                        }
                    },
                    select: {
                        quantity: true,
                        unitPrice: true
                    }
                }
            },
            orderBy: { name: 'asc' }
        });
        const inventoryData = products.map(product => {
            const soldLastMonth = product.saleItems.reduce((sum, sale) => sum + sale.quantity, 0);
            const currentStock = effectiveQuantity(product.id, product.quantity, ledgerMap);
            const averageStock = (product.minStock + currentStock) / 2;
            const turnoverRate = averageStock > 0 ? soldLastMonth / averageStock : 0;
            const rowStatus = currentStock <= product.minStock ? 'critical' :
                currentStock <= product.minStock * 1.5 ? 'low' :
                    currentStock > product.minStock * 3 ? 'high' : 'normal';
            return {
                id: product.id,
                product: product.name,
                category: product.category || 'Uncategorized',
                currentStock: currentStock,
                minStock: product.minStock,
                maxStock: currentStock,
                unitPrice: product.unitPrice.toNumber(),
                soldLastMonth: soldLastMonth,
                turnoverRate: turnoverRate,
                status: rowStatus
            };
        });
        const filteredData = status
            ? inventoryData.filter(item => item.status === status)
            : inventoryData;
        res.json(filteredData);
    }
    catch (error) {
        console.error('Error fetching detailed inventory:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch detailed inventory',
            error: error.message,
        });
    }
};
exports.getDetailedInventory = getDetailedInventory;
const getOverviewDashboard = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { startDate, endDate } = parseDateRange(req.query);
        const branchFilter = (0, branchAuth_middleware_1.buildBranchFilter)(req);
        const branchIdScope = branchFilter.branchId;
        // Org info for currency
        const org = await prisma_1.prisma.organization.findUnique({
            where: { id: organizationId },
            select: { currency: true, name: true },
        });
        const currency = org?.currency || 'RWF';
        // Calculate previous period of exact same duration
        const durationMs = Math.max(endDate.getTime() - startDate.getTime(), 24 * 60 * 60 * 1000);
        const prevEndDate = new Date(startDate.getTime() - 1);
        const prevStartDate = new Date(prevEndDate.getTime() - durationMs);
        // Branch scoping
        const branches = await prisma_1.prisma.branch.findMany({
            where: {
                organizationId,
                status: 'ACTIVE',
                ...(branchIdScope ? { id: branchIdScope } : {}),
            },
            select: { id: true, name: true, code: true },
            orderBy: { name: 'asc' },
        });
        const branchIds = branches.map(b => b.id);
        const saleWhereCurrent = {
            organizationId,
            status: { not: 'CANCELLED' },
            isProforma: false,
            createdAt: { gte: startDate, lte: endDate },
            ...(branchIds.length > 0 ? { branchId: { in: branchIds } } : {}),
        };
        const saleWherePrev = {
            organizationId,
            status: { not: 'CANCELLED' },
            isProforma: false,
            createdAt: { gte: prevStartDate, lte: prevEndDate },
            ...(branchIds.length > 0 ? { branchId: { in: branchIds } } : {}),
        };
        const expenseWhereCurrent = {
            organizationId,
            expenseDate: { gte: startDate, lte: endDate },
            ...(branchIds.length > 0 ? { branchId: { in: branchIds } } : {}),
        };
        const expenseWherePrev = {
            organizationId,
            expenseDate: { gte: prevStartDate, lte: prevEndDate },
            ...(branchIds.length > 0 ? { branchId: { in: branchIds } } : {}),
        };
        const purchaseWhereCurrent = {
            organizationId,
            isActive: true,
            status: { not: 'CANCELLED' },
            orderedAt: { gte: startDate, lte: endDate },
            ...(branchIds.length > 0 ? { branchId: { in: branchIds } } : {}),
        };
        const purchaseWherePrev = {
            organizationId,
            isActive: true,
            status: { not: 'CANCELLED' },
            orderedAt: { gte: prevStartDate, lte: prevEndDate },
            ...(branchIds.length > 0 ? { branchId: { in: branchIds } } : {}),
        };
        // Parallel execution of main KPI queries
        const [salesCurrAgg, salesPrevAgg, expCurrAgg, expPrevAgg, purchaseCurrAgg, purchasePrevAgg, totalProductsCount, newProductsCount, totalCustomersCount, newCustomersCount, products, salesListCurrent, expensesListCurrent, topSaleItems, recentActivityLogs, recentSales, recentCustomers,] = await Promise.all([
            prisma_1.prisma.sale.aggregate({ where: saleWhereCurrent, _sum: { totalAmount: true }, _count: { id: true } }),
            prisma_1.prisma.sale.aggregate({ where: saleWherePrev, _sum: { totalAmount: true }, _count: { id: true } }),
            prisma_1.prisma.expense.aggregate({ where: expenseWhereCurrent, _sum: { amount: true } }),
            prisma_1.prisma.expense.aggregate({ where: expenseWherePrev, _sum: { amount: true } }),
            prisma_1.prisma.purchaseOrder.aggregate({ where: purchaseWhereCurrent, _sum: { totalAmount: true } }),
            prisma_1.prisma.purchaseOrder.aggregate({ where: purchaseWherePrev, _sum: { totalAmount: true } }),
            prisma_1.prisma.product.count({ where: { organizationId, deletedAt: null, isActive: true } }),
            prisma_1.prisma.product.count({ where: { organizationId, deletedAt: null, isActive: true, createdAt: { gte: startDate, lte: endDate } } }),
            prisma_1.prisma.customer.count({ where: { organizationId, deletedAt: null, isActive: true } }),
            prisma_1.prisma.customer.count({ where: { organizationId, deletedAt: null, isActive: true, createdAt: { gte: startDate, lte: endDate } } }),
            prisma_1.prisma.product.findMany({
                where: { organizationId, deletedAt: null, isActive: true },
                select: { id: true, name: true, quantity: true, minStock: true, expiryDate: true },
            }),
            prisma_1.prisma.sale.findMany({
                where: saleWhereCurrent,
                select: { createdAt: true, totalAmount: true, branchId: true },
            }),
            prisma_1.prisma.expense.findMany({
                where: expenseWhereCurrent,
                select: { expenseDate: true, amount: true, branchId: true },
            }),
            prisma_1.prisma.saleItem.groupBy({
                by: ['productId'],
                where: {
                    sale: saleWhereCurrent,
                },
                _sum: { quantity: true, totalPrice: true },
                orderBy: { _sum: { quantity: 'desc' } },
                take: 5,
            }),
            prisma_1.prisma.activityLog.findMany({
                where: { organizationId },
                take: 10,
                orderBy: { createdAt: 'desc' },
                include: { user: { select: { name: true } } },
            }),
            prisma_1.prisma.sale.findMany({
                where: { organizationId, isProforma: false, ...(branchIds.length > 0 ? { branchId: { in: branchIds } } : {}) },
                take: 10,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    saleNumber: true,
                    invoiceNumber: true,
                    totalAmount: true,
                    status: true,
                    paymentType: true,
                    createdAt: true,
                    user: { select: { name: true } },
                },
            }),
            prisma_1.prisma.customer.findMany({
                where: { organizationId, deletedAt: null },
                take: 5,
                orderBy: { createdAt: 'desc' },
                select: { id: true, name: true, createdAt: true },
            }),
        ]);
        // KPI Values
        const totalSalesVal = Number(salesCurrAgg._sum.totalAmount ?? 0);
        const prevSalesVal = Number(salesPrevAgg._sum.totalAmount ?? 0);
        const salesChange = prevSalesVal > 0 ? Math.round(((totalSalesVal - prevSalesVal) / prevSalesVal) * 100) : 0;
        const txnsVal = salesCurrAgg._count.id ?? 0;
        const prevTxnsVal = salesPrevAgg._count.id ?? 0;
        const txnsChange = prevTxnsVal > 0 ? Math.round(((txnsVal - prevTxnsVal) / prevTxnsVal) * 100) : 0;
        const expensesVal = Number(expCurrAgg._sum.amount ?? 0);
        const prevExpensesVal = Number(expPrevAgg._sum.amount ?? 0);
        const expensesChange = prevExpensesVal > 0 ? Math.round(((expensesVal - prevExpensesVal) / prevExpensesVal) * 100) : 0;
        const totalPurchasesVal = Number(purchaseCurrAgg._sum.totalAmount ?? 0);
        const prevPurchasesVal = Number(purchasePrevAgg._sum.totalAmount ?? 0);
        const purchasesChange = prevPurchasesVal > 0
            ? Math.round(((totalPurchasesVal - prevPurchasesVal) / prevPurchasesVal) * 100)
            : 0;
        // Stock Alerts
        let lowStockCount = 0;
        let expiredCount = 0;
        let outOfStockCount = 0;
        const now = new Date();
        for (const p of products) {
            if (p.quantity <= 0)
                outOfStockCount++;
            else if (p.minStock > 0 && p.quantity <= p.minStock)
                lowStockCount++;
            if (p.expiryDate && new Date(p.expiryDate) < now)
                expiredCount++;
        }
        const totalAlertsVal = lowStockCount + expiredCount + outOfStockCount;
        // Sparklines generation (7 intervals)
        const intervalCount = 7;
        const timeStep = durationMs / intervalCount;
        const salesSparkline = [];
        const txnsSparkline = [];
        const expensesSparkline = [];
        const alertsSparkline = [];
        for (let i = 0; i < intervalCount; i++) {
            const stepStart = new Date(startDate.getTime() + i * timeStep);
            const stepEnd = new Date(startDate.getTime() + (i + 1) * timeStep);
            const intervalSales = salesListCurrent.filter(s => s.createdAt >= stepStart && s.createdAt < stepEnd);
            const intervalExpenses = expensesListCurrent.filter(e => e.expenseDate >= stepStart && e.expenseDate < stepEnd);
            const sSum = intervalSales.reduce((acc, curr) => acc + Number(curr.totalAmount), 0);
            const sCount = intervalSales.length;
            const eSum = intervalExpenses.reduce((acc, curr) => acc + Number(curr.amount), 0);
            salesSparkline.push(sSum);
            txnsSparkline.push(sCount);
            expensesSparkline.push(eSum);
            alertsSparkline.push(totalAlertsVal);
        }
        // Sales Overview Chart Data (Daily bucket list Mon-Sun or interval dates)
        const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const salesOverviewMap = new Map();
        // Initialize 7 days
        const cursor = new Date(startDate);
        for (let i = 0; i < 7; i++) {
            const label = dayLabels[cursor.getDay()];
            const key = cursor.toISOString().split('T')[0];
            salesOverviewMap.set(key, { label, sales: 0, expenses: 0 });
            cursor.setDate(cursor.getDate() + 1);
        }
        for (const s of salesListCurrent) {
            const key = s.createdAt.toISOString().split('T')[0];
            if (salesOverviewMap.has(key)) {
                salesOverviewMap.get(key).sales += Number(s.totalAmount);
            }
        }
        for (const e of expensesListCurrent) {
            const key = e.expenseDate.toISOString().split('T')[0];
            if (salesOverviewMap.has(key)) {
                salesOverviewMap.get(key).expenses += Number(e.amount);
            }
        }
        const salesOverview = Array.from(salesOverviewMap.values());
        // Branch Performance Breakdown
        const branchPerfMap = new Map();
        for (const b of branches) {
            branchPerfMap.set(b.id, { branchId: b.id, name: b.name, sales: 0, transactions: 0, expenses: 0 });
        }
        for (const s of salesListCurrent) {
            if (branchPerfMap.has(s.branchId)) {
                const item = branchPerfMap.get(s.branchId);
                item.sales += Number(s.totalAmount);
                item.transactions += 1;
            }
        }
        for (const e of expensesListCurrent) {
            if (branchPerfMap.has(e.branchId)) {
                branchPerfMap.get(e.branchId).expenses += Number(e.amount);
            }
        }
        const branchPerformanceList = Array.from(branchPerfMap.values());
        const hasBranchActivity = branchPerformanceList.some(b => b.sales > 0 || b.transactions > 0 || b.expenses > 0);
        // Top Selling Products
        const topProdIds = topSaleItems.map(i => i.productId).filter((id) => id !== null);
        const topProdDetails = topProdIds.length > 0
            ? await prisma_1.prisma.product.findMany({
                where: { id: { in: topProdIds } },
                select: { id: true, name: true },
            })
            : [];
        const topProdMap = new Map(topProdDetails.map(p => [p.id, p.name]));
        const maxSold = Math.max(...topSaleItems.map(i => i._sum.quantity || 0), 1);
        const topSellingProductsList = topSaleItems.map(item => {
            const sold = item._sum.quantity || 0;
            const revenue = Number(item._sum.totalPrice || 0);
            const name = topProdMap.get(item.productId) || 'Unknown Product';
            const percentage = Math.round((sold / maxSold) * 100);
            return {
                id: item.productId,
                name,
                sold,
                revenue,
                percentage,
            };
        });
        // Recent Activities Stream
        let recentActivitiesList = [];
        if (recentActivityLogs.length > 0) {
            recentActivitiesList = recentActivityLogs.map(log => {
                let type = 'sale';
                if (log.type.includes('PAYMENT') || log.type.includes('EXPENSE'))
                    type = 'payment';
                else if (log.type.includes('INVENTORY') || log.type.includes('PRODUCT') || log.type.includes('STOCK'))
                    type = 'stock';
                else if (log.type.includes('USER') || log.type.includes('CUSTOMER'))
                    type = 'user';
                const date = new Date(log.createdAt);
                const timeFormatted = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return {
                    id: String(log.id),
                    title: log.description,
                    subtext: log.user?.name ? `By ${log.user.name}` : log.entityId ? `#${log.entityId}` : '',
                    timestamp: date.toISOString(),
                    timeFormatted,
                    type,
                };
            });
        }
        else {
            // Fallback combined list if activity logs are empty
            const saleActivities = recentSales.map(s => ({
                id: `sale-${s.id}`,
                title: 'New sale recorded',
                subtext: s.invoiceNumber || s.saleNumber,
                timestamp: s.createdAt.toISOString(),
                timeFormatted: new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                type: 'sale',
            }));
            const customerActivities = recentCustomers.map(c => ({
                id: `customer-${c.id}`,
                title: 'New customer added',
                subtext: `Customer: ${c.name}`,
                timestamp: c.createdAt.toISOString(),
                timeFormatted: new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                type: 'user',
            }));
            recentActivitiesList = [...saleActivities, ...customerActivities]
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                .slice(0, 4);
        }
        res.json({
            currency,
            dateRange: {
                preset: req.query.preset || 'today',
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
            },
            kpis: {
                totalSales: {
                    value: totalSalesVal,
                    prevValue: prevSalesVal,
                    changePercentage: salesChange,
                    sparkline: salesSparkline,
                },
                transactions: {
                    value: txnsVal,
                    prevValue: prevTxnsVal,
                    changePercentage: txnsChange,
                    sparkline: txnsSparkline,
                },
                totalExpenses: {
                    value: expensesVal,
                    prevValue: prevExpensesVal,
                    changePercentage: expensesChange,
                    sparkline: expensesSparkline,
                },
                totalAlerts: {
                    value: totalAlertsVal,
                    prevValue: 0,
                    changePercentage: 0,
                    sparkline: alertsSparkline,
                },
            },
            summary: {
                totalSales: { value: totalSalesVal, changePercentage: salesChange },
                totalPurchases: { value: totalPurchasesVal, changePercentage: purchasesChange },
                totalProducts: { value: totalProductsCount, newCount: newProductsCount },
                totalCustomers: { value: totalCustomersCount, newCount: newCustomersCount },
            },
            branchPerformance: {
                hasActivity: hasBranchActivity,
                branches: branchPerformanceList,
            },
            salesOverview,
            topSellingProducts: topSellingProductsList,
            stockAlerts: {
                lowStock: { count: lowStockCount, label: 'Low Stock Items', subtext: 'Items running low' },
                expired: { count: expiredCount, label: 'Expired Products', subtext: 'Products past expiry date' },
                outOfStock: { count: outOfStockCount, label: 'Out of Stock', subtext: 'Items out of stock' },
            },
            recentActivities: recentActivitiesList,
            recentTransactions: recentSales.slice(0, 5).map((sale) => ({
                id: sale.id,
                number: sale.invoiceNumber || sale.saleNumber,
                totalAmount: Number(sale.totalAmount),
                status: sale.status,
                paymentType: sale.paymentType,
                createdAt: sale.createdAt.toISOString(),
                cashier: sale.user?.name ?? null,
            })),
        });
    }
    catch (error) {
        console.error('[Overview Dashboard Error]:', error);
        res.status(500).json({ error: 'Failed to fetch overview dashboard stats' });
    }
};
exports.getOverviewDashboard = getOverviewDashboard;
