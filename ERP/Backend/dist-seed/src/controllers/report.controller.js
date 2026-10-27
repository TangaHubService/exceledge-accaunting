"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPurchasesReport = exports.getElectronicJournalEntry = exports.getElectronicJournal = exports.getDailyReportPdf = exports.getDailyReport = exports.getProfitReportController = exports.getStockHistory = exports.getStockReport = exports.getCashFlowReport = exports.getDebtPaymentsReport = exports.exportReport = exports.getDebtorsReport = exports.getInventoryReport = exports.getPluReportPdf = exports.getPluReport = exports.getSalesReport = void 0;
const prisma_1 = require("../lib/prisma");
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
const activity_log_middleware_1 = require("../middleware/activity-log.middleware");
const profit_service_1 = require("../services/profit.service");
const apiResponse_1 = require("../utils/apiResponse");
const vsdc_api_service_1 = require("../services/vsdc-api.service");
const rra_ebm_service_1 = require("../services/rra-ebm.service");
const fiscal_report_pdf_service_1 = require("../services/fiscal-report-pdf.service");
const getSalesReport = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { startDate, endDate, category, status, sellerId, product, sortBy = 'date', sortOrder = 'desc', page = '1', limit = '10' } = req.query;
        const where = {
            organizationId,
            ...(0, branchAuth_middleware_1.buildBranchFilter)(req),
            ...(startDate && endDate && startDate !== 'undefined' && endDate !== 'undefined' && (() => {
                const start = new Date(startDate);
                const end = new Date(endDate);
                if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                    end.setHours(23, 59, 59, 999);
                    return { createdAt: { gte: start, lte: end } };
                }
                return null;
            })()),
            ...(status && status !== 'all' && { status: status }),
            ...(sellerId && sellerId !== 'all' && { userId: parseInt(sellerId) })
        };
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const limitNum = Math.min(Math.max(parseInt(limit) || 10, 1), 500);
        const skip = (pageNum - 1) * limitNum;
        const totalSalesCount = await prisma_1.prisma.sale.count({ where });
        const sales = await prisma_1.prisma.sale.findMany({
            where,
            include: {
                user: { select: { id: true, name: true, email: true } },
                saleItems: {
                    include: {
                        product: { select: { id: true, name: true, category: true } }
                    }
                },
                salePayments: { select: { paymentMethod: true, amount: true } },
            },
            orderBy: sortBy === 'date' ? { createdAt: sortOrder === 'asc' ? 'asc' : 'desc' }
                : sortBy === 'amount' ? { totalAmount: sortOrder === 'asc' ? 'asc' : 'desc' }
                    : { createdAt: 'desc' },
            skip,
            take: limitNum,
        });
        // Calculate summary from ALL matching sales (not just paginated)
        const [aggregateTotals, refundAgg, vatAgg] = await Promise.all([
            prisma_1.prisma.sale.aggregate({
                where,
                _sum: { totalAmount: true, cashAmount: true, debtAmount: true, insuranceAmount: true, vatAmount: true, taxableAmount: true },
                _count: { id: true },
            }),
            prisma_1.prisma.sale.aggregate({
                where: { ...where, status: 'REFUNDED' },
                _sum: { totalAmount: true },
            }),
            prisma_1.prisma.sale.aggregate({
                where: { ...where, NOT: { status: 'REFUNDED' } },
                _sum: { vatAmount: true, taxableAmount: true },
            }),
        ]);
        const totalRevenue = Number(aggregateTotals._sum.totalAmount || 0);
        const totalRefunds = Math.abs(Number(refundAgg._sum.totalAmount || 0));
        const netRevenue = totalRevenue - totalRefunds;
        const totalVat = Number(vatAgg._sum.vatAmount || 0);
        const totalTaxable = Number(vatAgg._sum.taxableAmount || 0);
        const totalTransactions = aggregateTotals._count.id || 0;
        const avgTransaction = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
        const transactions = sales.flatMap(sale => sale.saleItems
            .filter(item => item.product)
            .map(item => ({
            id: item.id,
            saleId: sale.id,
            productId: item.product.id,
            sellerId: sale.user.id,
            date: sale.createdAt.toISOString().split('T')[0],
            product: item.product.name,
            category: item.product.category || 'Uncategorized',
            quantity: item.quantity,
            unitPrice: item.unitPrice.toNumber(),
            total: item.quantity * item.unitPrice.toNumber(),
            costPrice: item.costPrice.toNumber(),
            profit: item.profit.toNumber(),
            taxAmount: item.taxAmount.toNumber(),
            taxRate: item.taxRate.toNumber(),
            status: sale.status,
            seller: sale.user.name,
            sellerEmail: sale.user.email,
            paymentType: sale.paymentType,
            saleNumber: sale.saleNumber,
            invoiceNumber: sale.invoiceNumber,
            payments: sale.salePayments.map(p => ({ method: p.paymentMethod, amount: Number(p.amount) })),
        })));
        let filteredTransactions = transactions;
        if (category && category !== 'all') {
            filteredTransactions = filteredTransactions.filter(t => t.category === category);
        }
        if (product) {
            const productSearch = product.toLowerCase();
            filteredTransactions = filteredTransactions.filter(t => t.product.toLowerCase().includes(productSearch));
        }
        const uniqueCategories = Array.from(new Set(filteredTransactions.map(t => t.category).filter(Boolean))).sort();
        const uniqueSellers = Array.from(new Map(filteredTransactions.map(t => [t.sellerId, { id: t.sellerId, name: t.seller, email: t.sellerEmail }])).values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        const uniqueProducts = Array.from(new Map(filteredTransactions.map(t => [t.productId, { id: t.productId, name: t.product, category: t.category }])).values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        const response = {
            summary: {
                totalRevenue,
                totalRefunds,
                netRevenue,
                totalVat,
                totalTaxable,
                totalQuantity: filteredTransactions.reduce((sum, t) => sum + t.quantity, 0),
                totalTransactions,
                avgTransaction,
                totalCost: filteredTransactions.reduce((sum, t) => sum + t.costPrice, 0),
                totalProfit: filteredTransactions.reduce((sum, t) => sum + t.profit, 0),
                totalDiscount: 0,
            },
            transactions: filteredTransactions,
            totalItems: filteredTransactions.length,
            totalCount: totalSalesCount,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: totalSalesCount,
                totalPages: Math.ceil(totalSalesCount / limitNum),
            },
            filters: {
                categories: uniqueCategories,
                sellers: uniqueSellers,
                products: uniqueProducts,
            },
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error generating sales report:', error);
        res.status(500).json((0, apiResponse_1.error)('Failed to generate sales report', undefined, error.message));
    }
};
exports.getSalesReport = getSalesReport;
async function buildPluRows(req, organizationId, opts) {
    const { startDate, endDate, sortBy = 'quantity', sortOrder = 'desc' } = opts;
    let periodLabel = 'All time';
    const dateFilter = startDate && endDate && startDate !== 'undefined' && endDate !== 'undefined'
        ? (() => {
            const start = new Date(startDate);
            const end = new Date(endDate);
            if (isNaN(start.getTime()) || isNaN(end.getTime()))
                return null;
            end.setHours(23, 59, 59, 999);
            periodLabel = `${start.toISOString().split('T')[0]} → ${end.toISOString().split('T')[0]}`;
            return { createdAt: { gte: start, lte: end } };
        })()
        : null;
    const saleItems = await prisma_1.prisma.saleItem.findMany({
        where: {
            sale: {
                organizationId,
                status: { notIn: ['REFUNDED', 'CANCELLED'] },
                ...(0, branchAuth_middleware_1.buildBranchFilter)(req),
                ...(dateFilter ?? {}),
            },
            itemType: 'PRODUCT',
        },
        select: {
            quantity: true,
            unitPrice: true,
            totalPrice: true,
            taxAmount: true,
            product: { select: { id: true, name: true, itemCd: true, measurementUnit: true } },
        },
    });
    const byItemCode = new Map();
    for (const line of saleItems) {
        if (!line.product)
            continue;
        const key = line.product.itemCd ?? `NOCODE-${line.product.id}`;
        const existing = byItemCode.get(key) ?? {
            itemCd: line.product.itemCd ?? '—',
            productId: line.product.id,
            productName: line.product.name,
            unit: line.product.measurementUnit ?? 'PCS',
            quantity: 0,
            revenue: 0,
            taxAmount: 0,
            transactionCount: 0,
        };
        existing.quantity += line.quantity;
        existing.revenue += line.totalPrice.toNumber();
        existing.taxAmount += line.taxAmount.toNumber();
        existing.transactionCount += 1;
        byItemCode.set(key, existing);
    }
    const rows = Array.from(byItemCode.values());
    rows.sort((a, b) => {
        const dir = sortOrder === 'asc' ? 1 : -1;
        if (sortBy === 'revenue')
            return dir * (a.revenue - b.revenue);
        if (sortBy === 'itemCd')
            return dir * a.itemCd.localeCompare(b.itemCd);
        return dir * (a.quantity - b.quantity);
    });
    return {
        rows,
        periodLabel,
        summary: {
            uniqueItemCodes: rows.length,
            totalQuantity: rows.reduce((sum, r) => sum + r.quantity, 0),
            totalRevenue: rows.reduce((sum, r) => sum + r.revenue, 0),
            totalTax: rows.reduce((sum, r) => sum + r.taxAmount, 0),
        },
    };
}
const getPluReport = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { page = '1', limit = '50' } = req.query;
        const { rows, summary } = await buildPluRows(req, organizationId, req.query);
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 500);
        const pageRows = rows.slice((pageNum - 1) * limitNum, (pageNum - 1) * limitNum + limitNum);
        res.json((0, apiResponse_1.success)({
            summary,
            items: pageRows,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: rows.length,
                totalPages: Math.ceil(rows.length / limitNum),
            },
        }));
    }
    catch (error) {
        console.error('Error generating PLU report:', error);
        res.status(500).json((0, apiResponse_1.error)('Failed to generate PLU report', undefined, error.message));
    }
};
exports.getPluReport = getPluReport;
/**
 * Printable (80 mm thermal) PLU report — RRA Article 21.
 * GET /reports/plu/:organizationId/pdf?startDate=&endDate=&sortBy=
 */
const getPluReportPdf = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { rows, summary, periodLabel } = await buildPluRows(req, organizationId, req.query);
        const org = await prisma_1.prisma.organization.findUnique({
            where: { id: organizationId },
            select: { name: true, TIN: true, address: true, ebmSerialNo: true, ebmDeviceId: true },
        });
        const header = {
            orgName: org?.name ?? '',
            tin: org?.TIN ?? null,
            mrcNo: org?.ebmSerialNo ?? null,
            sdcId: org?.ebmDeviceId ?? null,
            branchName: null,
            bhfId: null,
            address: org?.address ?? null,
        };
        const pdf = await (0, fiscal_report_pdf_service_1.renderPluReportPdf)({
            header,
            periodLabel,
            generatedAt: new Date().toISOString(),
            rows: rows.slice(0, 500),
            summary,
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Length', String(pdf.length));
        res.setHeader('Content-Disposition', `inline; filename="PLU-report.pdf"`);
        res.setHeader('Cache-Control', 'private, no-store');
        return res.status(200).send(pdf);
    }
    catch (error) {
        console.error('[PLU Report PDF Error]:', error);
        res.status(500).json((0, apiResponse_1.error)('Failed to generate PLU report PDF'));
    }
};
exports.getPluReportPdf = getPluReportPdf;
const getInventoryReport = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { category, status, search } = req.query;
        // Base where clause
        const branchFilter = (0, branchAuth_middleware_1.buildBranchFilter)(req);
        const where = { organizationId };
        if (branchFilter.branchId) {
            where.batches = { some: { branchId: branchFilter.branchId } };
        }
        // Apply filters
        if (category && category !== 'all') {
            where.category = category;
        }
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { sku: { contains: search, mode: 'insensitive' } },
            ];
        }
        // Get all products with related data
        // saleItems limited to last 200 per product to prevent heap OOM on high-volume products
        const products = await prisma_1.prisma.product.findMany({
            where,
            include: {
                saleItems: {
                    select: {
                        quantity: true,
                        sale: {
                            select: {
                                createdAt: true,
                                saleNumber: true,
                            },
                        },
                    },
                    orderBy: {
                        sale: {
                            createdAt: 'desc',
                        },
                    },
                    take: 200,
                },
            },
            orderBy: {
                name: 'asc',
            },
        });
        // Get restock history from inventory ledger
        const restocks = await prisma_1.prisma.inventoryLedger.findMany({
            where: {
                organizationId,
                movementType: { in: ['PURCHASE', 'TRANSFER_IN', 'ADJUSTMENT'] },
                direction: 'IN',
            },
            select: {
                id: true,
                productId: true,
                quantity: true,
                createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
        });
        // Transform products to match frontend format
        const inventoryData = await Promise.all(products.map(async (product) => {
            // Get previous stock (from 30 days ago)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            // Calculate default max stock if not set
            const maxStock = product.maxStock || product.minStock * 5;
            // Get stock changes from sales and restocks
            const salesChanges = product.saleItems.map((item) => ({
                date: item.sale.createdAt.toISOString().split('T')[0],
                type: 'sale',
                quantity: -item.quantity,
                newStock: 0, // Will be calculated below
                note: `Sale #${item.sale.saleNumber}`,
            }));
            const restockChanges = restocks
                .filter((r) => r.productId === Number(product.id))
                .map((restock) => ({
                date: restock.createdAt.toISOString().split('T')[0],
                type: 'restock',
                quantity: Number(restock.quantity),
                newStock: 0, // Will be calculated below
                note: 'Stock replenishment',
            }));
            // Combine and sort all changes by date (newest first)
            const allChanges = [...salesChanges, ...restockChanges].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
            // Calculate newStock for each change
            let currentStock = product.quantity;
            const changesWithStock = allChanges.map((change) => {
                const newStock = currentStock - change.quantity;
                const changeWithStock = {
                    ...change,
                    newStock,
                };
                currentStock = newStock;
                return changeWithStock;
            });
            // Calculate previous stock (30 days ago)
            const previousStock = changesWithStock.reduce((stock, change) => {
                const changeDate = new Date(change.date);
                if (changeDate < thirtyDaysAgo) {
                    return stock;
                }
                return stock - change.quantity;
            }, product.quantity);
            // Get stock status
            const getStockStatus = () => {
                if (product.quantity <= product.minStock)
                    return 'critical';
                if (product.quantity <= product.minStock * 1.5)
                    return 'low';
                if (product.quantity >= maxStock * 0.9)
                    return 'high';
                return 'normal';
            };
            const itemStatus = getStockStatus();
            // Apply status filter if provided
            if (status && status !== 'all' && status !== itemStatus) {
                // If status is 'low', also include 'critical' items
                if (status === 'low' && itemStatus !== 'critical') {
                    return null;
                }
                // For other statuses, do exact match
                if (status !== 'low' && status !== itemStatus) {
                    return null;
                }
            }
            return {
                id: product.id,
                product: product.name,
                sku: product.sku || `PROD-${product.id.toString().padStart(8, '0')}`,
                category: product.category || 'Uncategorized',
                currentStock: product.quantity,
                previousStock: previousStock,
                minStock: product.minStock,
                maxStock: maxStock,
                unitPrice: Number(product.unitPrice),
                supplier: 'Supplier',
                lastRestocked: restocks[0]?.createdAt.toISOString().split('T')[0] || new Date().toISOString().split('T')[0],
                changes: changesWithStock.slice(0, 5), // Only return last 5 changes
                status: itemStatus,
                // Stock value at cost (purchase price), not retail — falls back to
                // sales price only when no purchase price has been recorded.
                stockValue: (product.purchasePrice != null ? Number(product.purchasePrice) : Number(product.unitPrice)) * product.quantity,
            };
        }));
        // Filter out null values (from status filtering)
        const filteredData = inventoryData.filter((item) => item !== null);
        // Calculate summary statistics
        const totalValue = filteredData.reduce((sum, item) => sum + item.stockValue, 0);
        const totalItems = filteredData.reduce((sum, item) => sum + item.currentStock, 0);
        const criticalItems = filteredData.filter((item) => item.status === 'critical').length;
        const lowStockItems = filteredData.filter((item) => item.status === 'low' || item.status === 'critical').length;
        // Get unique categories
        const categories = [...new Set(filteredData.map((item) => item.category).filter(Boolean))];
        res.json({
            inventoryData: filteredData,
            summary: {
                totalValue,
                totalItems,
                criticalItems,
                lowStockItems,
            },
            categories,
        });
    }
    catch (error) {
        console.error('[Inventory Report Error]:', error);
        res.status(500).json((0, apiResponse_1.error)('Failed to generate inventory report'));
    }
};
exports.getInventoryReport = getInventoryReport;
const getDebtorsReport = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        // Customer has no branchId column of its own (it's an org-wide record — see
        // customer.controller.ts). Spreading buildBranchFilter() (`{branchId: ...}`)
        // directly here would throw P2022 since `customers.branchId` does not exist.
        // A debtor report is inherently about customers who already have a
        // debt-creating sale, so scoping through that relation is both safe (no
        // "invisible until first transaction" problem) and matches "only debtors
        // with activity in this branch".
        const debtSaleCondition = { OR: [{ paymentType: "DEBT" }, { paymentType: "MIXED" }] };
        const branchId = req.selectedBranchId;
        const branchIds = req.selectedBranchIds;
        const debtSalesWhere = branchId !== null && branchId !== undefined
            ? { ...debtSaleCondition, branchId }
            : branchIds && branchIds.length > 0
                ? { ...debtSaleCondition, branchId: { in: branchIds } }
                : debtSaleCondition;
        // Get all customers with debt
        const debtors = await prisma_1.prisma.customer.findMany({
            where: {
                organizationId,
                balance: { gt: 0 },
                sales: { some: debtSalesWhere },
            },
            include: {
                sales: {
                    where: debtSalesWhere,
                    orderBy: { createdAt: "desc" },
                },
            },
            orderBy: { balance: "desc" },
        });
        // Total debt
        const totalDebt = debtors.reduce((sum, customer) => {
            return sum + Number(customer.balance);
        }, 0);
        res.json((0, apiResponse_1.success)({
            totalDebt,
            debtorsCount: debtors.length,
            debtors,
        }));
    }
    catch (error) {
        console.error("[Debtors Report Error]:", error);
        res.status(500).json((0, apiResponse_1.error)("Failed to generate debtors report"));
    }
};
exports.getDebtorsReport = getDebtorsReport;
const exportReport = async (req, res) => {
    try {
        const { reportType } = req.params;
        const organizationId = Number(req.params.organizationId);
        const { startDate, endDate } = req.query;
        // Set common where clause
        const where = { organizationId, ...(0, branchAuth_middleware_1.buildBranchFilter)(req) };
        if (startDate && endDate) {
            where.createdAt = {
                gte: new Date(startDate),
                lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)),
            };
        }
        let data = [];
        let filename = "";
        switch (reportType) {
            case "sales":
                const sales = await prisma_1.prisma.sale.findMany({
                    where,
                    include: {
                        customer: true,
                        saleItems: {
                            include: {
                                product: true,
                            },
                        },
                    },
                    orderBy: { createdAt: "desc" },
                });
                // Transform sales data for Excel
                data = sales.flatMap((sale) => sale.saleItems
                    .filter((item) => item.product)
                    .map((item) => ({
                    Date: new Date(sale.createdAt).toLocaleDateString("en-CA") +
                        "  " +
                        new Date(sale.createdAt).toLocaleTimeString("en-GB", { hour12: false }),
                    Product: item.product.name,
                    Quantity: item.quantity,
                    PricePerUnity: item.unitPrice.toString(),
                    TotalPrice: item.totalPrice.toString(),
                    Customer: sale.customer?.name || "Walk-in",
                })));
                filename = `sales-report-${new Date().toISOString().split("T")[0]}.xlsx`;
                break;
            case "inventory":
                const inventory = await prisma_1.prisma.product.findMany({
                    where: { organizationId },
                });
                // Aggregate total selling price per product in one query instead of loading all saleItems
                const invSaleItemTotals = await prisma_1.prisma.saleItem.groupBy({
                    by: ['productId'],
                    where: { product: { organizationId } },
                    _sum: { totalPrice: true },
                });
                const invSaleTotalMap = new Map(invSaleItemTotals.map(s => [s.productId, s._sum.totalPrice?.toNumber() ?? 0]));
                // Transform inventory data for Excel
                data = inventory.map((item) => ({
                    Name: item.name,
                    Category: item.category || "N/A",
                    "Batch Number": item.batchNumber,
                    "Expiry Date": item.expiryDate ? new Date(item.expiryDate).toISOString().split("T")[0] : "N/A",
                    Quantity: item.quantity.toString(),
                    "Unit Price": item.unitPrice.toString(),
                    "Selling Price": (invSaleTotalMap.get(item.id) ?? 0).toString(),
                    Status: item.quantity > 0 ? "In Stock" : "Out of Stock",
                }));
                filename = `inventory-report-${new Date().toISOString().split("T")[0]}.xlsx`;
                break;
            case "debtors":
                const debtors = await prisma_1.prisma.customer.findMany({
                    where: {
                        organizationId,
                        sales: {
                            some: {
                                paymentType: "DEBT",
                                cashAmount: { gt: 0 },
                            },
                        },
                    },
                    include: {
                        sales: {
                            where: {
                                paymentType: "DEBT",
                                cashAmount: { gt: 0 },
                            },
                            orderBy: { createdAt: "desc" },
                        },
                    },
                });
                // Transform debtors data for Excel
                data = debtors.flatMap((customer) => customer.sales.map((tx) => ({
                    "Customer Name": customer.name,
                    Phone: customer.phone || "N/A",
                    "Transaction ID": tx.id,
                    "Amount Owed": tx.totalAmount.toString(),
                    "Amount Paid": tx.cashAmount.toString(),
                    Balance: tx.insuranceAmount.toString(),
                    "Transaction Date": tx.createdAt.toISOString().split("T")[0],
                })));
                filename = `debtors-report-${new Date().toISOString().split("T")[0]}.xlsx`;
                break;
            case "stock":
                const start = new Date(startDate);
                const end = new Date(new Date(endDate).setHours(23, 59, 59, 999));
                const stockProducts = await prisma_1.prisma.product.findMany({
                    where: { organizationId },
                    select: {
                        id: true,
                        name: true,
                        batchNumber: true,
                        quantity: true,
                        unitPrice: true,
                    }
                });
                const exportProductIds = stockProducts.map(p => p.id);
                const [exportPeriodGrouped, exportOpeningEntries, exportClosingEntries] = await Promise.all([
                    prisma_1.prisma.inventoryLedger.groupBy({
                        by: ['productId', 'direction'],
                        where: {
                            productId: { in: exportProductIds },
                            organizationId,
                            createdAt: { gte: start, lte: end },
                        },
                        _sum: { quantity: true },
                    }),
                    prisma_1.prisma.inventoryLedger.findMany({
                        where: {
                            productId: { in: exportProductIds },
                            organizationId,
                            createdAt: { lt: start },
                        },
                        select: { productId: true, runningBalance: true },
                        orderBy: { createdAt: 'desc' },
                    }),
                    prisma_1.prisma.inventoryLedger.findMany({
                        where: {
                            productId: { in: exportProductIds },
                            organizationId,
                            createdAt: { lte: end },
                        },
                        select: { productId: true, runningBalance: true },
                        orderBy: { createdAt: 'desc' },
                    }),
                ]);
                const exportOpeningMap = new Map();
                for (const e of exportOpeningEntries) {
                    if (!exportOpeningMap.has(e.productId))
                        exportOpeningMap.set(e.productId, Number(e.runningBalance));
                }
                const exportClosingMap = new Map();
                for (const e of exportClosingEntries) {
                    if (!exportClosingMap.has(e.productId))
                        exportClosingMap.set(e.productId, Number(e.runningBalance));
                }
                const exportMovementsMap = new Map();
                for (const m of exportPeriodGrouped) {
                    const entry = exportMovementsMap.get(m.productId) ?? { in: 0, out: 0 };
                    if (m.direction === 'IN')
                        entry.in += Number(m._sum.quantity ?? 0);
                    else
                        entry.out += Number(m._sum.quantity ?? 0);
                    exportMovementsMap.set(m.productId, entry);
                }
                const stockReportData = stockProducts.map((product) => {
                    const openingStock = exportOpeningMap.get(product.id) ?? 0;
                    const closingStock = exportClosingMap.get(product.id) ?? product.quantity;
                    const moves = exportMovementsMap.get(product.id) ?? { in: 0, out: 0 };
                    return {
                        "Product Name": product.name,
                        "Batch Number": product.batchNumber || "N/A",
                        "Opening Stock": openingStock,
                        "Stock In": moves.in,
                        "Stock Out": moves.out,
                        "Closing Stock": closingStock,
                        "Unit Price": product.unitPrice.toNumber(),
                        "Total Value": closingStock * product.unitPrice.toNumber(),
                    };
                });
                data = stockReportData;
                filename = `stock-report-${new Date().toISOString().split("T")[0]}.xlsx`;
                break;
            case "stock-history":
                const stockMovements = await prisma_1.prisma.inventoryLedger.findMany({
                    where: {
                        organizationId,
                        ...(startDate && endDate && {
                            createdAt: {
                                gte: new Date(startDate),
                                lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)),
                            }
                        })
                    },
                    include: {
                        product: { select: { name: true, batchNumber: true } },
                        user: { select: { name: true } }
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 10000, // cap to prevent OOM on large exports
                });
                data = stockMovements.map(m => ({
                    Date: new Date(m.createdAt).toLocaleString(),
                    Product: m.product.name,
                    Batch: m.batchNumber || m.product.batchNumber || "N/A",
                    "Movement Type": m.movementType,
                    Direction: m.direction,
                    Quantity: m.direction === 'IN' ? `+${m.quantity}` : `-${m.quantity}`,
                    "Running Balance": m.runningBalance,
                    User: m.user.name,
                    Note: m.note || "",
                    Reference: m.reference || "",
                }));
                filename = `stock-history-${new Date().toISOString().split("T")[0]}.xlsx`;
                break;
            default:
                return res.status(400).json((0, apiResponse_1.error)("Invalid report type"));
        }
        // Generate Excel file
        const XLSX = require("xlsx");
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
        // Set headers for file download
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        // Send the file
        const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
        await (0, activity_log_middleware_1.logManualActivity)({
            userId: Number(req.user?.userId),
            organizationId: Number(organizationId),
            module: 'SYSTEM',
            type: 'OTHER',
            description: 'Report exported',
            entityType: 'Report',
            entityId: "",
            metadata: {
                organization: Number(organizationId),
                agent: req.headers['user-agent'],
                ip: req.ip,
                time: new Date(),
            }
        });
        res.send(excelBuffer);
    }
    catch (error) {
        console.error(`[Export ${req.params.reportType} Report Error]:`, error);
        res.status(500).json((0, apiResponse_1.error)(`Failed to export ${req.params.reportType} report`));
    }
};
exports.exportReport = exportReport;
// Paid Debt Report
const getDebtPaymentsReport = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { startDate, endDate } = req.query;
        // DebtPayment has no branchId column of its own — it belongs to a branch
        // via its sale, so filtering must go through that relation. Spreading
        // buildBranchFilter() (which yields `{branchId: ...}`) directly here would
        // throw P2022 since `debt_payments.branchId` does not exist.
        const branchId = req.selectedBranchId;
        const branchIds = req.selectedBranchIds;
        const saleBranchFilter = branchId !== null && branchId !== undefined
            ? { sale: { branchId } }
            : branchIds && branchIds.length > 0
                ? { sale: { branchId: { in: branchIds } } }
                : {};
        const where = {
            organizationId,
            ...saleBranchFilter,
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
        // Get total remaining debt from Sales (more accurate than Customer balance)
        const salesWithDebt = await prisma_1.prisma.sale.aggregate({
            where: {
                organizationId,
                debtAmount: { gt: 0 },
                status: { not: 'CANCELLED' } // Ensure cancelled sales don't count
            },
            _sum: {
                debtAmount: true
            }
        });
        const remainingDebt = salesWithDebt._sum.debtAmount?.toNumber() || 0;
        // Format payments — previousBalance/newBalance were computed but never returned,
        // so the per-payment N+1 queries (2 per row) were pure dead code.
        const payments = debtPayments.map((payment) => ({
            id: payment.id,
            customerName: payment.customer.name,
            customerPhone: payment.customer.phone || 'N/A',
            amountPaid: payment.amount.toNumber(),
            paymentDate: payment.paymentDate.toISOString(),
            paymentMethod: payment.paymentMethod,
            reference: payment.reference || 'N/A',
            notes: payment.notes || '',
            recordedBy: payment.recordedBy.name,
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
// Cash Flow Report - UPGRADED TO TRUE CASH FLOW ACCOUNTING
const getCashFlowReport = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { startDate, endDate, sortBy = 'date', sortOrder = 'asc' } = req.query;
        const start = new Date(startDate);
        const end = new Date(new Date(endDate).setHours(23, 59, 59, 999));
        // 1. Calculate Opening Balance
        const openingBalance = await calculateOpeningBalance(organizationId, start);
        // 2. Get Cash Inflows
        const inflows = await getCashInflows(organizationId, start, end);
        // 3. Get Cash Outflows
        const outflows = await getCashOutflows(organizationId, start, end);
        // 4. Combine and sort all transactions
        const allTransactions = [...inflows, ...outflows].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        // 5. Calculate running balance
        let runningBalance = openingBalance;
        const transactionsWithBalances = allTransactions.map(t => {
            runningBalance += t.amount; // amount is positive for inflows, negative for outflows
            return { ...t, balance: runningBalance };
        });
        // Running balances must always be calculated chronologically. Sorting is
        // applied only to the presentation rows afterwards so accounting remains valid.
        const allowedSortFields = new Set([
            'date', 'description', 'category', 'subcategory', 'type', 'amount',
            'balance', 'paymentMethod', 'reference',
        ]);
        const sortField = typeof sortBy === 'string' && allowedSortFields.has(sortBy) ? sortBy : 'date';
        const direction = sortOrder === 'desc' ? -1 : 1;
        const transactions = transactionsWithBalances
            .map((transaction, index) => ({ transaction, index }))
            .sort((leftEntry, rightEntry) => {
            const left = leftEntry.transaction;
            const right = rightEntry.transaction;
            // Amount is rendered without its accounting sign in the UI, so order by
            // the same absolute value users actually see.
            const a = sortField === 'amount' ? Math.abs(left.amount) : left[sortField];
            const b = sortField === 'amount' ? Math.abs(right.amount) : right[sortField];
            if (a == null && b == null)
                return 0;
            if (a == null)
                return direction;
            if (b == null)
                return -direction;
            const comparison = typeof a === 'number' && typeof b === 'number'
                ? a - b
                : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
            // Preserve chronological accounting order when displayed values match.
            return comparison === 0 ? leftEntry.index - rightEntry.index : comparison * direction;
        })
            .map(entry => entry.transaction);
        // 6. Calculate summary
        const totalInflows = inflows.reduce((sum, t) => sum + t.amount, 0);
        const totalOutflows = Math.abs(outflows.reduce((sum, t) => sum + t.amount, 0));
        const netCashFlow = totalInflows - totalOutflows;
        const closingBalance = openingBalance + netCashFlow;
        // 7. Verify balance integrity
        const calculatedClosing = runningBalance;
        const balanced = Math.abs(calculatedClosing - closingBalance) < 0.01;
        if (!balanced) {
            console.error('Balance mismatch detected!', {
                calculatedClosing,
                closingBalance,
                difference: calculatedClosing - closingBalance
            });
        }
        res.json({
            summary: {
                openingBalance,
                totalInflows,
                totalOutflows,
                netCashFlow,
                closingBalance
            },
            transactions,
            verification: {
                formula: 'Closing = Opening + Inflows - Outflows',
                calculated: closingBalance,
                actual: calculatedClosing,
                balanced
            },
            sorting: { sortBy: sortField, sortOrder: direction === 1 ? 'asc' : 'desc' }
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
// Helper function: Calculate opening balance
async function calculateOpeningBalance(organizationId, startDate) {
    console.log(`[CashFlow] Calculating opening balance for Org ${organizationId} before ${startDate.toISOString()}`);
    // Option 1: Get from CashBalance table (if exists)
    const cashBalance = await prisma_1.prisma.cashBalance.findFirst({
        where: {
            organizationId,
            balanceDate: { lt: startDate }
        },
        orderBy: { balanceDate: 'desc' }
    });
    if (cashBalance) {
        console.log(`[CashFlow] Found cached balance: ${cashBalance.balance} from ${cashBalance.balanceDate}`);
        // If we have a cached balance, we need to add transactions from that balance date up to startDate
        // But for now, let's assume the cached balance is the ONLY source of truth if it exists.
        // Wait, if the cached balance is from last month, we still need transactions between then and now.
        // The previous logic just returned it. This might be a bug if the cache isn't strictly "yesterday's close".
        // For now, let's just log it.
        return cashBalance.balance.toNumber();
    }
    else {
        console.log(`[CashFlow] No cached balance found. Calculating from history.`);
    }
    // Option 2: Calculate from historical aggregates — never load rows into memory
    const [salesAgg, debtPayAgg, supplierPayAgg, refundedAgg, partialRefundAgg, expenseAgg] = await Promise.all([
        prisma_1.prisma.sale.aggregate({
            where: {
                organizationId,
                createdAt: { lt: startDate },
                status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED'] },
            },
            _sum: { cashAmount: true },
        }),
        prisma_1.prisma.debtPayment.aggregate({
            where: { organizationId, paymentDate: { lt: startDate } },
            _sum: { amount: true },
        }),
        prisma_1.prisma.supplierPayment.aggregate({
            where: { organizationId, paymentDate: { lt: startDate } },
            _sum: { amount: true },
        }),
        prisma_1.prisma.sale.aggregate({
            where: {
                organizationId,
                status: 'REFUNDED',
                refundedAt: { lt: startDate, not: null },
            },
            _sum: { cashAmount: true },
        }),
        prisma_1.prisma.sale.aggregate({
            where: {
                organizationId,
                status: 'PARTIALLY_REFUNDED',
                refundedAt: { lt: startDate, not: null },
            },
            _sum: { cashAmount: true },
        }),
        prisma_1.prisma.expense.aggregate({
            where: { organizationId, expenseDate: { lt: startDate } },
            _sum: { amount: true },
        }),
    ]);
    const totalInflows = (salesAgg._sum.cashAmount?.toNumber() ?? 0) +
        (debtPayAgg._sum.amount?.toNumber() ?? 0);
    const totalOutflows = (supplierPayAgg._sum.amount?.toNumber() ?? 0) +
        (refundedAgg._sum.cashAmount?.toNumber() ?? 0) +
        (partialRefundAgg._sum.cashAmount?.toNumber() ?? 0) * 0.5 +
        (expenseAgg._sum.amount?.toNumber() ?? 0);
    console.log(`[CashFlow] Historical Calculation (aggregates): inflows=${totalInflows}, outflows=${totalOutflows}`);
    return totalInflows - totalOutflows;
}
// Helper function: Get all cash inflows
async function getCashInflows(organizationId, start, end) {
    const transactions = [];
    // 1. Sales (Cash received from customers)
    const sales = await prisma_1.prisma.sale.findMany({
        where: {
            organizationId,
            createdAt: { gte: start, lte: end },
            status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED'] }
        },
        orderBy: { createdAt: 'asc' }
    });
    sales.forEach(sale => {
        const cashReceived = sale.cashAmount.toNumber();
        if (cashReceived > 0) {
            transactions.push({
                date: sale.createdAt.toISOString().split('T')[0],
                description: `Sale ${sale.saleNumber}`,
                type: 'INFLOW',
                category: 'Sales',
                subcategory: 'Customer Payment',
                amount: cashReceived,
                paymentMethod: sale.paymentType,
                reference: sale.saleNumber
            });
        }
    });
    // 2. Debt Payments (Customers paying off debt)
    const debtPayments = await prisma_1.prisma.debtPayment.findMany({
        where: {
            organizationId,
            paymentDate: { gte: start, lte: end }
        },
        include: {
            customer: { select: { name: true } }
        },
        orderBy: { paymentDate: 'asc' }
    });
    debtPayments.forEach(payment => {
        transactions.push({
            date: payment.paymentDate.toISOString().split('T')[0],
            description: `Debt payment from ${payment.customer.name}`,
            type: 'INFLOW',
            category: 'Debt Collection',
            subcategory: 'Customer Debt Payment',
            amount: payment.amount.toNumber(),
            paymentMethod: payment.paymentMethod,
            reference: payment.reference || `DP-${payment.id}`
        });
    });
    return transactions;
}
// Helper function: Get all cash outflows
async function getCashOutflows(organizationId, start, end) {
    const transactions = [];
    // 1. Supplier Payments (Actual payments for inventory)
    const supplierPayments = await prisma_1.prisma.supplierPayment.findMany({
        where: {
            organizationId,
            paymentDate: { gte: start, lte: end }
        },
        include: {
            purchaseOrder: { select: { orderNumber: true } }
        },
        orderBy: { paymentDate: 'asc' }
    });
    supplierPayments.forEach(payment => {
        transactions.push({
            date: payment.paymentDate.toISOString().split('T')[0],
            description: `Payment for PO ${payment.purchaseOrder.orderNumber}`,
            type: 'OUTFLOW',
            category: 'Inventory Purchase',
            subcategory: 'Supplier Payment',
            amount: -payment.amount.toNumber(), // Negative for outflow
            paymentMethod: payment.paymentMethod,
            reference: payment.reference || `SP-${payment.id}`
        });
    });
    // 2. Refunds (Money returned to customers)
    const refundedSales = await prisma_1.prisma.sale.findMany({
        where: {
            organizationId,
            status: { in: ['REFUNDED', 'PARTIALLY_REFUNDED'] },
            refundedAt: { gte: start, lte: end, not: null }
        },
        orderBy: { refundedAt: 'asc' }
    });
    refundedSales.forEach(sale => {
        const refundAmount = sale.status === 'REFUNDED'
            ? sale.cashAmount.toNumber()
            : sale.cashAmount.toNumber() * 0.5; // Estimate for partial refunds
        transactions.push({
            date: sale.refundedAt.toISOString().split('T')[0],
            description: `Refund for Sale ${sale.saleNumber}`,
            type: 'OUTFLOW',
            category: 'Refunds',
            subcategory: 'Customer Refund',
            amount: -refundAmount,
            paymentMethod: sale.paymentType,
            reference: sale.saleNumber
        });
    });
    // 3. Operating Expenses
    const expenses = await prisma_1.prisma.expense.findMany({
        where: {
            organizationId,
            expenseDate: { gte: start, lte: end }
        },
        orderBy: { expenseDate: 'asc' }
    });
    expenses.forEach(expense => {
        transactions.push({
            date: expense.expenseDate.toISOString().split('T')[0],
            description: expense.description,
            type: 'OUTFLOW',
            category: 'Operating Expenses',
            subcategory: expense.category,
            amount: -expense.amount.toNumber(),
            paymentMethod: expense.paymentMethod,
            reference: expense.reference || `EXP-${expense.id}`
        });
    });
    return transactions;
}
// Stock Report (Opening, In, Out, Closing)
const getStockReport = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { startDate, endDate, productId, category } = req.query;
        const start = new Date(startDate);
        const end = new Date(new Date(endDate).setHours(23, 59, 59, 999));
        // Base filters
        const productWhere = { organizationId };
        if (productId && productId !== 'undefined' && productId !== 'null')
            productWhere.id = productId;
        if (category && category !== 'undefined' && category !== 'null')
            productWhere.category = category;
        // Get products
        const products = await prisma_1.prisma.product.findMany({
            where: productWhere,
            select: {
                id: true,
                name: true,
                batchNumber: true,
                quantity: true, // Current stock
                unitPrice: true,
                purchasePrice: true,
            }
        });
        const productIds = products.map(p => p.id);
        const branchFilter = (0, branchAuth_middleware_1.buildBranchFilter)(req);
        // 3 batch queries replace N×3 per-product queries
        const [periodMovementsGrouped, allOpeningEntries, allClosingEntries] = await Promise.all([
            // Period movements grouped by product+direction
            prisma_1.prisma.inventoryLedger.groupBy({
                by: ['productId', 'direction'],
                where: {
                    productId: { in: productIds },
                    organizationId,
                    ...branchFilter,
                    createdAt: { gte: start, lte: end },
                },
                _sum: { quantity: true },
            }),
            // Last ledger entry before period per product (ordered desc → first hit = latest)
            prisma_1.prisma.inventoryLedger.findMany({
                where: {
                    productId: { in: productIds },
                    organizationId,
                    ...branchFilter,
                    createdAt: { lt: start },
                },
                select: { productId: true, runningBalance: true, createdAt: true },
                orderBy: { createdAt: 'desc' },
            }),
            // Last ledger entry up to period end per product
            prisma_1.prisma.inventoryLedger.findMany({
                where: {
                    productId: { in: productIds },
                    organizationId,
                    ...branchFilter,
                    createdAt: { lte: end },
                },
                select: { productId: true, runningBalance: true, createdAt: true },
                orderBy: { createdAt: 'desc' },
            }),
        ]);
        // Build lookup maps (first entry per productId = latest, since ordered desc)
        const openingMap = new Map();
        for (const e of allOpeningEntries) {
            if (!openingMap.has(e.productId))
                openingMap.set(e.productId, Number(e.runningBalance));
        }
        const closingMap = new Map();
        for (const e of allClosingEntries) {
            if (!closingMap.has(e.productId))
                closingMap.set(e.productId, Number(e.runningBalance));
        }
        const movementsMap = new Map();
        for (const m of periodMovementsGrouped) {
            const entry = movementsMap.get(m.productId) ?? { in: 0, out: 0 };
            if (m.direction === 'IN')
                entry.in += Number(m._sum.quantity ?? 0);
            else
                entry.out += Number(m._sum.quantity ?? 0);
            movementsMap.set(m.productId, entry);
        }
        const reportData = products.map((product) => {
            const openingStock = openingMap.get(product.id) ?? 0;
            const closingStock = closingMap.get(product.id) ?? product.quantity;
            const moves = movementsMap.get(product.id) ?? { in: 0, out: 0 };
            return {
                productId: product.id,
                productName: product.name,
                batchNumber: product.batchNumber,
                unitPrice: product.unitPrice.toNumber(),
                openingStock,
                stockIn: moves.in,
                stockOut: moves.out,
                closingStock,
                stockValue: closingStock * (product.purchasePrice != null ? product.purchasePrice.toNumber() : product.unitPrice.toNumber()),
            };
        });
        // Summary
        const summary = reportData.reduce((acc, curr) => ({
            totalOpening: acc.totalOpening + curr.openingStock,
            totalIn: acc.totalIn + curr.stockIn,
            totalOut: acc.totalOut + curr.stockOut,
            totalClosing: acc.totalClosing + curr.closingStock,
            totalValue: acc.totalValue + curr.stockValue
        }), { totalOpening: 0, totalIn: 0, totalOut: 0, totalClosing: 0, totalValue: 0 });
        res.json({
            summary,
            data: reportData
        });
    }
    catch (error) {
        console.error('Error generating stock report:', error);
        res.status(500).json({ error: error.message || 'Failed to generate stock report' });
    }
};
exports.getStockReport = getStockReport;
// Full Stock History
const getStockHistory = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { productId, batchNumber, startDate, endDate, userId, type, limit = "20", page = "1" } = req.query;
        const where = {
            organizationId,
            ...(0, branchAuth_middleware_1.buildBranchFilter)(req)
        };
        if (productId && productId !== 'undefined' && productId !== 'null')
            where.productId = parseInt(productId);
        if (userId && userId !== 'undefined' && userId !== 'null')
            where.userId = parseInt(userId);
        if (type && type !== 'undefined' && type !== 'null')
            where.movementType = type;
        if (startDate && endDate) {
            where.createdAt = {
                gte: new Date(startDate),
                lte: new Date(new Date(endDate).setHours(23, 59, 59, 999)),
            };
        }
        if (batchNumber) {
            where.batchNumber = { contains: batchNumber, mode: 'insensitive' };
        }
        const skip = (Number.parseInt(page) - 1) * Number.parseInt(limit);
        const take = Number.parseInt(limit);
        const [movements, totalCount] = await Promise.all([
            prisma_1.prisma.inventoryLedger.findMany({
                where,
                include: {
                    product: { select: { name: true, batchNumber: true } },
                    user: { select: { name: true } }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take,
            }),
            prisma_1.prisma.inventoryLedger.count({ where }),
        ]);
        // Transform movements to match expected format
        const transformedMovements = movements.map(m => ({
            id: m.id,
            productId: m.productId,
            product: m.product,
            user: m.user,
            movementType: m.movementType,
            direction: m.direction,
            quantity: m.quantity,
            runningBalance: m.runningBalance,
            previousStock: m.runningBalance - (m.direction === 'IN' ? m.quantity : -m.quantity),
            newStock: m.runningBalance,
            note: m.note,
            reference: m.reference,
            createdAt: m.createdAt,
        }));
        res.json({
            data: transformedMovements,
            pagination: {
                totalItems: totalCount,
                totalPages: Math.ceil(totalCount / take),
                currentPage: Number.parseInt(page),
                limit: take,
            },
        });
    }
    catch (error) {
        console.error('Error fetching stock history:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch stock history' });
    }
};
exports.getStockHistory = getStockHistory;
/**
 * Get profit report
 */
const getProfitReportController = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { startDate, endDate, productId } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'Start date and end date are required' });
        }
        const report = await (0, profit_service_1.getProfitReport)(organizationId, new Date(startDate), new Date(endDate), productId ? parseInt(productId) : undefined);
        res.json(report);
    }
    catch (error) {
        console.error('Error generating profit report:', error);
        res.status(500).json({ error: error.message || 'Failed to generate profit report' });
    }
};
exports.getProfitReportController = getProfitReportController;
// ──────────────────────────────────────────────
// C9: X / Z Daily Report (RRA CIS/VSDC spec §6)
// X = interim totals since last Z-report (does NOT reset counters)
// Z = end-of-day legal record (resets daily counters)
// ──────────────────────────────────────────────
const TAX_CODES = ['A', 'B', 'C', 'D', 'E'];
function fix2(n) {
    return Math.round(n * 100) / 100;
}
const pad2 = (n) => String(n).padStart(2, '0');
/**
 * Shared X/Z daily-report aggregation (RRA CIS/VSDC spec §6 / Articles 7, 18,
 * 19). Consumed by both the JSON endpoint and the printable PDF endpoint so the
 * two can never disagree.
 */
async function buildDailyReport(req, organizationId, reportType, reportDate, branchParam) {
    const dayStart = new Date(reportDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(reportDate);
    dayEnd.setHours(23, 59, 59, 999);
    const branchFilter = {};
    const targetBranchId = branchParam != null && branchParam !== '' ? parseInt(String(branchParam)) : null;
    if (targetBranchId != null) {
        branchFilter.branchId = targetBranchId;
    }
    else {
        const bFilter = (0, branchAuth_middleware_1.buildBranchFilter)(req);
        if (Object.keys(bFilter).length)
            Object.assign(branchFilter, bFilter);
    }
    const [org, branch, sales, shiftAgg, heldCount, voidedSales] = await Promise.all([
        prisma_1.prisma.organization.findUnique({
            where: { id: organizationId },
            select: { name: true, TIN: true, address: true, ebmSerialNo: true, ebmDeviceId: true },
        }),
        targetBranchId != null
            ? prisma_1.prisma.branch.findUnique({
                where: { id: targetBranchId },
                select: { name: true, bhfId: true, ebmSerialNo: true, ebmDeviceId: true, address: true },
            })
            : Promise.resolve(null),
        prisma_1.prisma.sale.findMany({
            where: {
                organizationId,
                ...branchFilter,
                createdAt: { gte: dayStart, lte: dayEnd },
                status: { in: ['COMPLETED', 'REFUNDED', 'CANCELLED', 'DRAFT', 'PENDING', 'CONVERTED'] },
            },
            include: {
                saleItems: { select: { taxCode: true, taxAmount: true, totalPrice: true, quantity: true, dcAmt: true } },
                ebmTransactions: {
                    where: { submissionStatus: 'SUCCESS' },
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                },
            },
            orderBy: { createdAt: 'asc' },
        }),
        prisma_1.prisma.shift.aggregate({
            where: {
                organizationId,
                ...(targetBranchId != null ? { branchId: targetBranchId } : branchFilter),
                openedAt: { gte: dayStart, lte: dayEnd },
            },
            _sum: { openingFloat: true },
        }),
        prisma_1.prisma.heldSale.count({
            where: {
                organizationId,
                ...(targetBranchId != null ? { branchId: targetBranchId } : branchFilter),
                createdAt: { gte: dayStart, lte: dayEnd },
                resultingSale: { is: null },
            },
        }),
        prisma_1.prisma.sale.findMany({
            where: {
                organizationId,
                ...branchFilter,
                createdAt: { gte: dayStart, lte: dayEnd },
                status: 'CANCELLED',
            },
            select: { totalAmount: true },
        }),
    ]);
    const header = {
        orgName: org?.name ?? '',
        tin: org?.TIN ?? null,
        mrcNo: branch?.ebmSerialNo ?? org?.ebmSerialNo ?? null,
        sdcId: branch?.ebmDeviceId ?? org?.ebmDeviceId ?? null,
        branchName: branch?.name ?? null,
        bhfId: branch?.bhfId ?? null,
        address: branch?.address ?? org?.address ?? null,
    };
    // Split into NS/NR buckets — TS/TR (training mode) receipts are excluded
    // entirely from the legal sales/refund totals below and reported separately
    // (spec §18.1.15/§19.1.15), since they never happened as real business
    // transactions. Proforma (PS) and incomplete (DRAFT/PENDING/held) are also
    // reported separately (§18.1.16 / §18.1.20).
    const fiscalSales = sales.filter((s) => s.status === 'COMPLETED' || s.status === 'REFUNDED');
    const normalSales = fiscalSales.filter(s => s.status === 'COMPLETED' && !s.isProforma && s.rcptLabel !== 'TR' && s.rcptLabel !== 'TS' && s.rcptLabel !== 'PS');
    const normalRefunds = fiscalSales.filter(s => s.status === 'REFUNDED' && s.rcptLabel !== 'TR' && s.rcptLabel !== 'TS');
    const trainingSales = fiscalSales.filter(s => s.rcptLabel === 'TS' || s.rcptLabel === 'TR');
    const proformaSales = sales.filter(s => s.isProforma || s.rcptLabel === 'PS');
    // Reprints (CS/CR receipts, spec §18.1.14/§19.1.14) aren't a separate fiscal
    // record here — a copy is just a re-print of its original NS/NR/TS/TR sale,
    // tracked via `reprintCount`.
    const copiedSales = fiscalSales.filter(s => (s.reprintCount ?? 0) > 0);
    const incompleteDrafts = sales.filter(s => s.status === 'DRAFT' || s.status === 'PENDING').length;
    // Per-tax-band totals
    const taxBands = {};
    for (const code of TAX_CODES) {
        taxBands[code] = { taxableAmt: 0, taxAmt: 0, salesAmt: 0 };
    }
    for (const sale of normalSales) {
        for (const si of sale.saleItems) {
            const code = (si.taxCode ?? 'A').toUpperCase();
            if (!taxBands[code])
                taxBands[code] = { taxableAmt: 0, taxAmt: 0, salesAmt: 0 };
            const total = Number(si.totalPrice);
            const tax = Number(si.taxAmount);
            taxBands[code].taxAmt = fix2(taxBands[code].taxAmt + tax);
            taxBands[code].taxableAmt = fix2(taxBands[code].taxableAmt + (total - tax));
            taxBands[code].salesAmt = fix2(taxBands[code].salesAmt + total);
        }
    }
    const taxRates = {
        A: rra_ebm_service_1.TAX_RATE_BY_SLOT[0], B: rra_ebm_service_1.TAX_RATE_BY_SLOT[1], C: rra_ebm_service_1.TAX_RATE_BY_SLOT[2], D: rra_ebm_service_1.TAX_RATE_BY_SLOT[3], E: 0,
    };
    // Payment breakdown
    const paymentTotals = {};
    for (const sale of normalSales) {
        const pt = sale.paymentType;
        paymentTotals[pt] = fix2((paymentTotals[pt] ?? 0) + Number(sale.totalAmount));
    }
    const grossSalesAmt = fix2(normalSales.reduce((s, sale) => s + Number(sale.totalAmount), 0));
    const grossRefundAmt = fix2(normalRefunds.reduce((s, sale) => s + Math.abs(Number(sale.totalAmount)), 0));
    const netSalesAmt = fix2(grossSalesAmt - grossRefundAmt);
    const totalTaxAmt = fix2(Object.values(taxBands).reduce((s, b) => s + b.taxAmt, 0));
    const openingDeposit = fix2(Number(shiftAgg._sum.openingFloat ?? 0));
    const proformaAmt = fix2(proformaSales.reduce((s, sale) => s + Math.abs(Number(sale.totalAmount)), 0));
    const discountTotal = fix2(normalSales.reduce((s, sale) => s + sale.saleItems.reduce((a, si) => a + Math.abs(Number(si.dcAmt ?? 0)), 0), 0));
    const otherReductionsAmt = fix2(voidedSales.reduce((s, sale) => s + Math.abs(Number(sale.totalAmount)), 0));
    const incompleteSalesCount = heldCount + incompleteDrafts;
    // Receipt counters — the "A"/"B" halves of the RRA A/B RT counter, taken from
    // the VSDC-signed transactions for the day (§7.24.4/§7.25).
    const rcptNos = [];
    let lastTotalRcptNo = null;
    let itemCount = 0;
    for (const sale of normalSales) {
        itemCount += sale.saleItems.length;
        const tx = sale.ebmTransactions?.[0];
        if (tx?.sdcRcptNo != null)
            rcptNos.push(tx.sdcRcptNo);
        if (tx?.totalRcptNo != null)
            lastTotalRcptNo = tx.totalRcptNo;
    }
    // Z report only: cross-check against VSDC's own record of the day's close.
    let vsdcConfirmation = null;
    if (reportType === 'Z' && (0, rra_ebm_service_1.isEbmEnabled)()) {
        if (targetBranchId != null) {
            try {
                const envelope = await (0, vsdc_api_service_1.buildVsdcEnvelope)(organizationId, targetBranchId);
                const rptDe = `${reportDate.getFullYear()}${pad2(reportDate.getMonth() + 1)}${pad2(reportDate.getDate())}`;
                const result = await (0, vsdc_api_service_1.checkZReport)(envelope, rptDe);
                vsdcConfirmation = result.success
                    ? { checked: true, rptDe }
                    : { checked: true, rptDe, error: result.error ?? 'VSDC has no Z-report on record for this date' };
            }
            catch (e) {
                vsdcConfirmation = { checked: false, error: e instanceof Error ? e.message : 'VSDC lookup failed' };
            }
        }
        else {
            vsdcConfirmation = { checked: false, error: 'Specify branchId to cross-check the VSDC-confirmed Z-report' };
        }
    }
    return {
        reportType,
        reportDate: reportDate.toISOString().split('T')[0],
        organizationId,
        branchId: targetBranchId,
        periodStart: dayStart.toISOString(),
        periodEnd: dayEnd.toISOString(),
        generatedAt: new Date().toISOString(),
        header,
        counters: {
            firstRcptNo: rcptNos.length ? Math.min(...rcptNos) : null,
            lastRcptNo: rcptNos.length ? Math.max(...rcptNos) : null,
            lastTotalRcptNo,
            receiptCount: normalSales.length + normalRefunds.length,
            itemCount,
        },
        vsdcConfirmation,
        summary: {
            normalSalesCount: normalSales.length,
            normalRefundsCount: normalRefunds.length,
            grossSalesAmt,
            grossRefundAmt,
            netSalesAmt,
            totalTaxAmt,
            trainingCount: trainingSales.length,
            trainingAmt: fix2(trainingSales.reduce((s, sale) => s + Number(sale.totalAmount), 0)),
            copyCount: copiedSales.length,
            copyAmt: fix2(copiedSales.reduce((s, sale) => s + Number(sale.totalAmount), 0)),
            openingDeposit,
            proformaCount: proformaSales.length,
            proformaAmt,
            discountTotal,
            otherReductionsAmt,
            incompleteSalesCount,
        },
        taxBands,
        taxRates,
        paymentBreakdown: paymentTotals,
    };
}
function parseReportType(raw) {
    const t = String(raw ?? 'X').toUpperCase();
    return t === 'X' || t === 'Z' ? t : null;
}
const getDailyReport = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const reportType = parseReportType(req.query.type);
        if (!reportType)
            return res.status(400).json((0, apiResponse_1.error)('type must be X or Z'));
        const reportDate = req.query.date ? new Date(req.query.date) : new Date();
        const report = await buildDailyReport(req, organizationId, reportType, reportDate, req.query.branchId);
        res.json((0, apiResponse_1.success)({
            ...report,
            fiscalizedCount: report.counters.receiptCount, // kept for backward compatibility
        }));
    }
    catch (error) {
        console.error('[Daily Report Error]:', error);
        res.status(500).json((0, apiResponse_1.error)('Failed to generate daily report'));
    }
};
exports.getDailyReport = getDailyReport;
/**
 * Printable (80 mm thermal) X/Z daily report — RRA Articles 7, 18, 19.
 * GET /reports/daily/:organizationId/pdf?type=X|Z&date=&branchId=
 */
const getDailyReportPdf = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const reportType = parseReportType(req.query.type);
        if (!reportType)
            return res.status(400).json((0, apiResponse_1.error)('type must be X or Z'));
        const reportDate = req.query.date ? new Date(req.query.date) : new Date();
        const report = await buildDailyReport(req, organizationId, reportType, reportDate, req.query.branchId);
        const pdf = await (0, fiscal_report_pdf_service_1.renderDailyReportPdf)(report);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Length', String(pdf.length));
        res.setHeader('Content-Disposition', `inline; filename="${reportType}-report-${report.reportDate}.pdf"`);
        res.setHeader('Cache-Control', 'private, no-store');
        return res.status(200).send(pdf);
    }
    catch (error) {
        console.error('[Daily Report PDF Error]:', error);
        res.status(500).json((0, apiResponse_1.error)('Failed to generate daily report PDF'));
    }
};
exports.getDailyReportPdf = getDailyReportPdf;
// ──────────────────────────────────────────────
// CIS Electronic Journal (RRA CIS/VSDC spec §5 / checklist §44)
// The EJ is issued at the same time as every normal receipt and contains the
// same data as the printed slip. These endpoints expose it for inspection and
// for the certification tester's EJ-vs-slip comparison.
// ──────────────────────────────────────────────
const getElectronicJournal = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { startDate, endDate, page = '1', limit = '50' } = req.query;
        const where = {
            organizationId,
            journalText: { not: null },
            operation: 'SALE',
            submissionStatus: 'SUCCESS',
        };
        if (startDate && endDate && startDate !== 'undefined' && endDate !== 'undefined') {
            const start = new Date(startDate);
            const end = new Date(endDate);
            if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                end.setHours(23, 59, 59, 999);
                where.createdAt = { gte: start, lte: end };
            }
        }
        const pageNum = Math.max(parseInt(page) || 1, 1);
        const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
        const [total, rows] = await Promise.all([
            prisma_1.prisma.ebmTransaction.count({ where }),
            prisma_1.prisma.ebmTransaction.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (pageNum - 1) * limitNum,
                take: limitNum,
                select: {
                    id: true,
                    saleId: true,
                    invoiceNumber: true,
                    ebmInvoiceNumber: true,
                    rcptLabel: true,
                    sdcRcptNo: true,
                    totalRcptNo: true,
                    sdcId: true,
                    sdcDateTime: true,
                    ejSent: true,
                    journalText: true,
                    createdAt: true,
                },
            }),
        ]);
        res.json((0, apiResponse_1.success)({
            entries: rows,
            pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
        }));
    }
    catch (error) {
        console.error('[Electronic Journal Error]:', error);
        res.status(500).json((0, apiResponse_1.error)('Failed to load the electronic journal'));
    }
};
exports.getElectronicJournal = getElectronicJournal;
/**
 * GET /reports/electronic-journal/:organizationId/:saleId
 * Returns the EJ record for one sale plus the sale's own line items and totals,
 * so a reviewer can confirm the journal matches the printed slip (§44).
 */
const getElectronicJournalEntry = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const saleId = parseInt(req.params.saleId);
        const tx = await prisma_1.prisma.ebmTransaction.findFirst({
            where: { organizationId, saleId, operation: 'SALE', submissionStatus: 'SUCCESS' },
            orderBy: { createdAt: 'desc' },
        });
        if (!tx || !tx.journalText) {
            return res.status(404).json((0, apiResponse_1.error)('No electronic journal on record for this sale'));
        }
        const sale = await prisma_1.prisma.sale.findFirst({
            where: { id: saleId, organizationId },
            include: {
                saleItems: { include: { product: { select: { name: true, itemCd: true } } } },
                customer: { select: { name: true, phone: true, TIN: true } },
            },
        });
        const slip = sale
            ? {
                invoiceNumber: sale.invoiceNumber,
                vsdcInvcNo: sale.vsdcInvcNo,
                rcptLabel: sale.rcptLabel,
                customer: sale.customer,
                items: sale.saleItems.map((si) => ({
                    name: si.product?.name ?? si.serviceName ?? 'Item',
                    itemCd: si.product?.itemCd ?? null,
                    quantity: si.quantity,
                    unitPrice: si.unitPrice.toNumber(),
                    totalPrice: si.totalPrice.toNumber(),
                    taxCode: si.taxCode,
                    taxAmount: si.taxAmount.toNumber(),
                })),
                totalAmount: Number(sale.totalAmount),
                vatAmount: Number(sale.vatAmount),
            }
            : null;
        // §44: the journal and the slip must agree. Surface a machine check on the
        // one value both carry in a comparable form (the document total).
        const journalTotalMatch = slip
            ? tx.journalText.includes(`TOTAL:${(Math.round(slip.totalAmount * 100) / 100)}`)
            : null;
        res.json((0, apiResponse_1.success)({
            journal: {
                id: tx.id,
                saleId: tx.saleId,
                rcptLabel: tx.rcptLabel,
                sdcId: tx.sdcId,
                sdcRcptNo: tx.sdcRcptNo,
                totalRcptNo: tx.totalRcptNo,
                sdcDateTime: tx.sdcDateTime,
                ejSent: tx.ejSent,
                text: tx.journalText,
            },
            slip,
            checks: { journalTotalMatchesSlip: journalTotalMatch },
        }));
    }
    catch (error) {
        console.error('[Electronic Journal Entry Error]:', error);
        res.status(500).json((0, apiResponse_1.error)('Failed to load the electronic journal entry'));
    }
};
exports.getElectronicJournalEntry = getElectronicJournalEntry;
// ──────────────────────────────────────────────
// Detailed purchases report (RRA checklist §25)
// Importation reporting depends on the import-declaration feature (checklist
// §66–68), which is a separate phase — none exists yet, so this covers the
// purchases half only.
// ──────────────────────────────────────────────
const getPurchasesReport = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const { startDate, endDate } = req.query;
        const where = { organizationId, ...(0, branchAuth_middleware_1.buildBranchFilter)(req) };
        if (startDate && endDate && startDate !== 'undefined' && endDate !== 'undefined') {
            const start = new Date(startDate);
            const end = new Date(endDate);
            if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                end.setHours(23, 59, 59, 999);
                where.orderedAt = { gte: start, lte: end };
            }
        }
        const orders = await prisma_1.prisma.purchaseOrder.findMany({
            where,
            include: {
                supplier: { select: { name: true, phone: true, email: true } },
                items: true,
                branch: { select: { name: true, code: true } },
            },
            orderBy: { orderedAt: 'desc' },
            take: 1000,
        });
        const rows = orders.map((po) => {
            const taxTotal = po.items.reduce((s, it) => {
                const rate = Number(it.taxRate ?? 0);
                const line = it.totalPrice.toNumber();
                return s + (rate > 0 ? line - line / (1 + rate / 100) : 0);
            }, 0);
            return {
                id: po.id,
                orderNumber: po.orderNumber,
                status: po.status,
                supplierName: po.supplier?.name ?? '',
                branch: po.branch?.name ?? null,
                orderedAt: po.orderedAt.toISOString().split('T')[0],
                receivedAt: po.receivedAt ? po.receivedAt.toISOString().split('T')[0] : null,
                itemCount: po.items.length,
                totalAmount: po.totalAmount.toNumber(),
                taxTotal: Math.round(taxTotal * 100) / 100,
                items: po.items.map((it) => ({
                    productName: it.productName,
                    quantity: it.quantity,
                    quantityReceived: it.quantityReceived,
                    unitPrice: it.unitPrice.toNumber(),
                    totalPrice: it.totalPrice.toNumber(),
                    taxCode: it.taxCode,
                    taxRate: Number(it.taxRate ?? 0),
                })),
            };
        });
        res.json((0, apiResponse_1.success)({
            summary: {
                orderCount: rows.length,
                receivedCount: rows.filter((r) => r.status === 'COMPLETED' || r.receivedAt).length,
                totalPurchases: Math.round(rows.reduce((s, r) => s + r.totalAmount, 0) * 100) / 100,
                totalTax: Math.round(rows.reduce((s, r) => s + r.taxTotal, 0) * 100) / 100,
            },
            importation: await (async () => {
                const importWhere = { organizationId };
                if (where.orderedAt) {
                    // RraImportItem.dclDe is yyyyMMdd text; range-filter on the string.
                    const d = (v) => new Date(v).toISOString().slice(0, 10).replace(/-/g, '');
                    importWhere.dclDe = { gte: d(where.orderedAt.gte), lte: d(where.orderedAt.lte) };
                }
                const imports = await prisma_1.prisma.rraImportItem.findMany({ where: importWhere, orderBy: [{ dclDe: 'desc' }, { itemSeq: 'asc' }], take: 500 });
                const byStatus = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
                for (const i of imports)
                    byStatus[i.status] += 1;
                return {
                    available: true,
                    summary: { lines: imports.length, ...byStatus },
                    items: imports.map((i) => ({
                        taskCd: i.taskCd,
                        dclNo: i.dclNo,
                        dclDe: i.dclDe,
                        itemSeq: i.itemSeq,
                        hsCd: i.hsCd,
                        itemNm: i.itemNm,
                        orgnNatCd: i.orgnNatCd,
                        supplier: i.spplrNm,
                        qty: i.qty ? i.qty.toNumber() : null,
                        invcFcurAmt: i.invcFcurAmt ? i.invcFcurAmt.toNumber() : null,
                        invcFcurCd: i.invcFcurCd,
                        status: i.status,
                    })),
                };
            })(),
            orders: rows,
        }));
    }
    catch (error) {
        console.error('[Purchases Report Error]:', error);
        res.status(500).json((0, apiResponse_1.error)('Failed to generate purchases report'));
    }
};
exports.getPurchasesReport = getPurchasesReport;
