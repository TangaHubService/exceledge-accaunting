"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deletePurchaseOrder = exports.updatePurchaseOrderStatus = exports.updatePurchaseOrder = exports.createPurchaseOrder = exports.getPurchaseOrder = exports.getPurchaseOrders = void 0;
const prisma_1 = require("../lib/prisma");
const email_service_1 = require("../services/email.service");
const auditLogger_1 = require("../utils/auditLogger");
const inventory_ledger_service_1 = require("../services/inventory-ledger.service");
const notification_service_1 = __importDefault(require("../services/notification.service"));
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
const notificationService = new notification_service_1.default(prisma_1.prisma);
// Get all purchase orders for an organization
const getPurchaseOrders = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const branchFilter = (0, branchAuth_middleware_1.buildBranchFilter)(req);
        const orders = await prisma_1.prisma.purchaseOrder.findMany({
            where: { organizationId, isActive: true, ...branchFilter },
            include: {
                supplier: true,
                user: { select: { name: true, email: true } },
                items: true,
            },
            orderBy: { createdAt: "desc" },
        });
        res.json(orders);
    }
    catch (error) {
        console.error("Error fetching purchase orders:", error);
        res.status(500).json({ message: "Failed to fetch purchase orders" });
    }
};
exports.getPurchaseOrders = getPurchaseOrders;
// Get single purchase order
const getPurchaseOrder = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const id = parseInt(req.params.id);
        const branchFilter = (0, branchAuth_middleware_1.buildBranchFilter)(req);
        const order = await prisma_1.prisma.purchaseOrder.findFirst({
            where: { id, organizationId, ...branchFilter },
            include: {
                supplier: true,
                user: { select: { name: true, email: true } },
                items: true,
            },
        });
        if (!order) {
            return res.status(404).json({ message: "Purchase order not found" });
        }
        res.json(order);
    }
    catch (error) {
        console.error("Error fetching purchase order:", error);
        res.status(500).json({ message: "Failed to fetch purchase order" });
    }
};
exports.getPurchaseOrder = getPurchaseOrder;
// Create purchase order
const createPurchaseOrder = async (req, res) => {
    try {
        const organizationId = parseInt(req.params.organizationId);
        const userId = req.user.userId;
        const { supplierId, items, notes, expectedDate } = req.body;
        const branchId = (0, branchAuth_middleware_1.getBranchIdForOperation)(req);
        // Cross-tenant guard: supplierId/productId are caller-supplied IDs and must
        // belong to this organization, or another tenant's records could silently
        // get attached to this PO.
        const supplier = await prisma_1.prisma.supplier.findFirst({
            where: { id: supplierId, organizationId },
            select: { id: true },
        });
        if (!supplier) {
            return res.status(400).json({ message: "Supplier not found for this organization" });
        }
        const requestedProductIds = [...new Set(items.map((item) => item.productId).filter((id) => id != null))];
        if (requestedProductIds.length > 0) {
            const ownedProducts = await prisma_1.prisma.product.findMany({
                where: { id: { in: requestedProductIds }, organizationId },
                select: { id: true },
            });
            if (ownedProducts.length !== requestedProductIds.length) {
                return res.status(400).json({ message: "One or more products do not belong to this organization" });
            }
        }
        // Calculate total amount
        const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
        // Generate order number
        const orderCount = await prisma_1.prisma.purchaseOrder.count({
            where: { organizationId },
        });
        const orderNumber = `PO-${Date.now()}-${orderCount + 1}`;
        const order = await prisma_1.prisma.purchaseOrder.create({
            data: {
                orderNumber,
                supplierId,
                organizationId,
                branchId: branchId,
                userId,
                totalAmount,
                notes,
                expectedDate: expectedDate ? new Date(expectedDate) : null,
                items: {
                    create: await Promise.all(items.map(async (item) => {
                        let taxCode;
                        let taxRate;
                        if (item.productId) {
                            const product = await prisma_1.prisma.product.findFirst({
                                where: { id: item.productId, organizationId },
                                select: { taxCode: true, taxCategory: true },
                            });
                            if (product) {
                                taxCode = product.taxCode ?? (product.taxCategory === 'STANDARD' ? 'B' :
                                    product.taxCategory === 'ZERO_RATED' ? 'C' :
                                        product.taxCategory === 'EXEMPT' ? 'A' :
                                            product.taxCategory === 'NON_TAXABLE' ? 'D' : 'A');
                                taxRate = taxCode === 'B' ? 18 : 0;
                            }
                        }
                        return {
                            productId: item.productId,
                            productName: item.productName,
                            quantity: item.quantity,
                            unitPrice: item.unitPrice,
                            totalPrice: item.quantity * item.unitPrice,
                            taxCode: item.taxCode ?? taxCode ?? 'A',
                            taxRate: item.taxRate ?? taxRate ?? 0,
                        };
                    })),
                },
            },
            include: {
                supplier: true,
                items: true,
                organization: true,
            },
        });
        const creatorEmail = req.user.email;
        try {
            const orderAny = order;
            await email_service_1.emailService.sendPurchaseOrderToSupplier(orderAny.supplier.email, orderAny.supplier.name, orderAny.organization.name, orderAny.orderNumber, orderAny.items, Number(orderAny.totalAmount), orderAny.notes || undefined, orderAny.expectedDate || undefined, creatorEmail, 'created');
        }
        catch (emailError) {
            console.error("Failed to send email to supplier:", emailError);
        }
        try {
            const orderAny = order;
            const organizationEmail = orderAny.organization.email;
            if (organizationEmail) {
                await email_service_1.emailService.sendPurchaseOrderCreatedNotification(organizationEmail, orderAny.organization.name, orderAny.orderNumber, orderAny.supplier.name, Number(orderAny.totalAmount), req.user.name || creatorEmail, orderAny.createdAt, creatorEmail);
            }
            else {
                console.warn(`Purchase order ${orderAny.orderNumber}: organization ${organizationId} has no configured email, skipping creation notification`);
            }
        }
        catch (emailError) {
            console.error("Failed to send purchase order creation notification to organization:", emailError);
        }
        await auditLogger_1.auditLogger.purchaseOrders(req, {
            type: 'PURCHASE_ORDER_CREATE',
            description: `Purchase Order ${order.orderNumber} created for supplier ${order.supplier.name}`,
            entityType: 'PurchaseOrder',
            entityId: order.id,
            metadata: {
                orderNumber: order.orderNumber,
                totalAmount: order.totalAmount,
                supplierId: order.supplierId,
            }
        });
        res.status(201).json(order);
    }
    catch (error) {
        console.error("Error creating purchase order:", error);
        res.status(500).json({ message: "Failed to create purchase order" });
    }
};
exports.createPurchaseOrder = createPurchaseOrder;
// Update purchase order (items, expected date, notes, etc.)
const updatePurchaseOrder = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const organizationId = parseInt(req.params.organizationId);
        const branchFilter = (0, branchAuth_middleware_1.buildBranchFilter)(req);
        const { items, notes, expectedDate } = req.body;
        const order = await prisma_1.prisma.purchaseOrder.findFirst({
            where: { id, organizationId, ...branchFilter },
            include: {
                supplier: true,
                items: true,
                organization: true,
                user: true,
            },
        });
        if (!order) {
            return res.status(404).json({ message: "Purchase order not found" });
        }
        if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
            return res.status(400).json({ message: `Cannot update a ${order.status.toLowerCase()} purchase order` });
        }
        const updatedOrder = await prisma_1.prisma.$transaction(async (tx) => {
            // Delete existing items
            await tx.purchaseOrderItem.deleteMany({
                where: { purchaseOrderId: id },
            });
            const totalAmount = items
                ? items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
                : order.totalAmount;
            const result = await tx.purchaseOrder.update({
                where: { id },
                data: {
                    totalAmount,
                    notes: notes !== undefined ? notes : order.notes,
                    expectedDate: expectedDate ? new Date(expectedDate) : order.expectedDate,
                    items: items ? {
                        create: await Promise.all(items.map(async (item) => {
                            let taxCode;
                            let taxRate;
                            if (item.productId) {
                                const product = await tx.product.findFirst({
                                    where: { id: item.productId, organizationId },
                                    select: { taxCode: true, taxCategory: true },
                                });
                                if (product) {
                                    taxCode = product.taxCode ?? (product.taxCategory === 'STANDARD' ? 'B' :
                                        product.taxCategory === 'ZERO_RATED' ? 'C' :
                                            product.taxCategory === 'EXEMPT' ? 'A' :
                                                product.taxCategory === 'NON_TAXABLE' ? 'D' : 'A');
                                    taxRate = taxCode === 'B' ? 18 : 0;
                                }
                            }
                            return {
                                productId: item.productId,
                                productName: item.productName,
                                quantity: item.quantity,
                                unitPrice: item.unitPrice,
                                totalPrice: item.quantity * item.unitPrice,
                                taxCode: item.taxCode ?? taxCode ?? 'A',
                                taxRate: item.taxRate ?? taxRate ?? 0,
                            };
                        })),
                    } : undefined,
                },
                include: {
                    supplier: true,
                    items: true,
                    organization: true,
                },
            });
            return result;
        });
        // Send email to supplier about the update
        try {
            const orderAny = updatedOrder;
            await email_service_1.emailService.sendPurchaseOrderToSupplier(orderAny.supplier.email, orderAny.supplier.name, orderAny.organization.name, orderAny.orderNumber, orderAny.items, Number(orderAny.totalAmount), orderAny.notes || undefined, orderAny.expectedDate || undefined, req.user.email, 'updated');
        }
        catch (emailError) {
            console.error("Failed to send update email to supplier:", emailError);
        }
        // Send email to organization
        try {
            const orderAny = updatedOrder;
            const organizationEmail = orderAny.organization.email;
            if (organizationEmail) {
                const changesSummary = items
                    ? `Items updated (${items.length} items)`
                    : notes
                        ? 'Notes updated'
                        : expectedDate
                            ? 'Expected delivery date updated'
                            : 'Purchase order updated';
                await email_service_1.emailService.sendPurchaseOrderUpdatedNotification(organizationEmail, orderAny.organization.name, orderAny.orderNumber, orderAny.supplier.name, req.user.name || req.user.email, new Date(), order.status, changesSummary, req.user.email);
            }
        }
        catch (emailError) {
            console.error("Failed to send update notification to organization:", emailError);
        }
        await auditLogger_1.auditLogger.purchaseOrders(req, {
            type: 'PURCHASE_ORDER_UPDATE',
            description: `Purchase Order ${order.orderNumber} updated`,
            entityType: 'PurchaseOrder',
            entityId: id,
            metadata: {
                orderNumber: order.orderNumber,
                itemCount: items?.length || 0,
            }
        });
        await notificationService.createNotification({
            organizationId: order.organizationId,
            title: 'Purchase Order Updated',
            message: `Purchase Order ${order.orderNumber} has been updated`,
            type: 'PURCHASE_ORDER',
            data: { orderId: id },
            recipientId: order.userId,
        });
        res.json(updatedOrder);
    }
    catch (error) {
        console.error("Error updating purchase order:", error);
        res.status(500).json({ message: "Failed to update purchase order" });
    }
};
exports.updatePurchaseOrder = updatePurchaseOrder;
// Update purchase order status with partial receiving support
const updatePurchaseOrderStatus = async (req, res) => {
    const id = parseInt(req.params.id);
    const organizationId = parseInt(req.params.organizationId);
    const branchFilter = (0, branchAuth_middleware_1.buildBranchFilter)(req);
    const { status, branchId, receivedItems } = req.body;
    const validStatuses = [
        'PENDING',
        'APPROVED',
        'REJECTED',
        'PROCESSING',
        'COMPLETED',
        'CANCELLED',
        'PARTIALLY_RECEIVED',
    ];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({
            message: 'Invalid status',
            validStatuses
        });
    }
    try {
        const order = await prisma_1.prisma.purchaseOrder.findFirst({
            where: { id, organizationId, ...branchFilter },
            include: {
                supplier: true,
                user: true,
                organization: true,
                items: true,
            },
        });
        if (!order) {
            return res.status(404).json({ message: "Purchase order not found" });
        }
        if (order.status === 'COMPLETED') {
            return res.status(400).json({ message: "This purchase order has already been completed and received" });
        }
        if (order.status === 'CANCELLED') {
            return res.status(400).json({ message: "This purchase order has been cancelled" });
        }
        const userId = req.user.userId;
        const effectiveBranchId = branchId ? parseInt(String(branchId)) : null;
        if ((status === 'COMPLETED' || status === 'PARTIALLY_RECEIVED') && !effectiveBranchId) {
            return res.status(400).json({ message: "branchId is required to receive items" });
        }
        // Track receiving history
        const receivingHistory = [];
        const updatedOrder = await prisma_1.prisma.$transaction(async (tx) => {
            const terminalStatuses = ['COMPLETED', 'CANCELLED'];
            const updateResult = await tx.purchaseOrder.updateMany({
                where: {
                    id: order.id,
                    status: { notIn: terminalStatuses },
                },
                data: {
                    status: status,
                    receivedAt: (status === 'COMPLETED' || status === 'PARTIALLY_RECEIVED') ? new Date() : order.receivedAt,
                },
            });
            if (updateResult.count === 0) {
                throw new Error("This purchase order has already been completed or cancelled");
            }
            const po = await tx.purchaseOrder.findUniqueOrThrow({
                where: { id: order.id },
                include: {
                    supplier: true,
                    items: true,
                },
            });
            // Handle receiving items (partial or full)
            if ((status === 'COMPLETED' || status === 'PARTIALLY_RECEIVED') && effectiveBranchId) {
                const branch = await tx.branch.findFirst({
                    where: { id: effectiveBranchId, organizationId: order.organizationId, status: "ACTIVE" }
                });
                if (!branch) {
                    throw new Error("Invalid or inactive branch for receiving");
                }
                for (const item of po.items) {
                    if (!item.productId)
                        continue;
                    const receivedMeta = Array.isArray(receivedItems)
                        ? receivedItems.find((ri) => parseInt(String(ri.productId)) === item.productId)
                        : null;
                    const recvQty = receivedMeta?.quantity ? parseInt(String(receivedMeta.quantity)) : item.quantity;
                    const recvUnitCost = receivedMeta?.unitCost ? Number(receivedMeta.unitCost) : Number(item.unitPrice);
                    const recvBatchNumber = receivedMeta?.batchNumber || `PO-${po.id}-P${item.productId}-${Date.now()}`;
                    const recvExpiryDate = receivedMeta?.expiryDate ? new Date(receivedMeta.expiryDate) : null;
                    await tx.batch.upsert({
                        where: {
                            productId_batchNumber_branchId: {
                                productId: item.productId,
                                batchNumber: recvBatchNumber,
                                branchId: effectiveBranchId,
                            }
                        },
                        update: {
                            quantity: { increment: recvQty },
                            unitCost: recvUnitCost,
                            expiryDate: recvExpiryDate,
                            isActive: true,
                        },
                        create: {
                            productId: item.productId,
                            organizationId: order.organizationId,
                            branchId: effectiveBranchId,
                            batchNumber: recvBatchNumber,
                            quantity: recvQty,
                            unitCost: recvUnitCost,
                            expiryDate: recvExpiryDate,
                            isActive: true,
                        }
                    });
                    await (0, inventory_ledger_service_1.addStock)({
                        organizationId: order.organizationId,
                        productId: item.productId,
                        userId,
                        quantity: recvQty,
                        movementType: 'PURCHASE',
                        branchId: effectiveBranchId,
                        unitCost: recvUnitCost,
                        batchNumber: recvBatchNumber,
                        expiryDate: recvExpiryDate || undefined,
                        reference: order.orderNumber,
                        referenceType: 'PURCHASE_ORDER',
                        note: `Purchase Order #${order.orderNumber} - ${status === 'PARTIALLY_RECEIVED' ? 'Partial' : 'Full'} receive at branch ${effectiveBranchId}`,
                        tx,
                    });
                    const newTotalReceived = (item.quantityReceived || 0) + recvQty;
                    await tx.purchaseOrderItem.update({
                        where: { id: item.id },
                        data: { quantityReceived: newTotalReceived },
                    });
                    receivingHistory.push({
                        itemId: item.id,
                        productId: item.productId,
                        productName: item.productName,
                        orderedQty: item.quantity,
                        previouslyReceivedQty: item.quantityReceived || 0,
                        newlyReceivedQty: recvQty,
                        totalReceivedQty: newTotalReceived,
                        remainingQty: item.quantity - newTotalReceived,
                        unitCost: recvUnitCost,
                        batchNumber: recvBatchNumber,
                    });
                }
                // Determine if this should be PARTIALLY_RECEIVED based on received quantities
                if (status === 'COMPLETED') {
                    const allFullyReceived = receivingHistory.every(r => r.remainingQty <= 0);
                    if (!allFullyReceived) {
                        await tx.purchaseOrder.update({
                            where: { id: po.id },
                            data: { status: 'PARTIALLY_RECEIVED' },
                        });
                    }
                }
            }
            return po;
        });
        // Send emails
        try {
            await email_service_1.emailService.sendPurchaseOrderStatusUpdate(order.user.email, order.organization.name, order.orderNumber, status, order.supplier.name);
        }
        catch (emailError) {
            console.error("Failed to send status update email:", emailError);
        }
        try {
            const organizationEmail = order.organization.email;
            if (organizationEmail) {
                await email_service_1.emailService.sendPurchaseOrderUpdatedNotification(organizationEmail, order.organization.name, order.orderNumber, order.supplier.name, req.user.name || req.user.email, new Date(), status, `Status changed from ${order.status} to ${status}${receivingHistory.length > 0 ? ` (${receivingHistory.length} items received)` : ''}`, order.user.email);
            }
            else {
                console.warn(`Purchase order ${order.orderNumber}: organization has no configured email, skipping update notification`);
            }
        }
        catch (emailError) {
            console.error("Failed to send purchase order update notification to organization:", emailError);
        }
        let activityType = 'PURCHASE_ORDER_UPDATE';
        if (status === 'APPROVED')
            activityType = 'PURCHASE_ORDER_APPROVED';
        if (status === 'REJECTED')
            activityType = 'PURCHASE_ORDER_REJECTED';
        if (status === 'COMPLETED')
            activityType = 'PURCHASE_ORDER_COMPLETED';
        if (status === 'CANCELLED')
            activityType = 'PURCHASE_ORDER_CANCELLED';
        if (status === 'PARTIALLY_RECEIVED')
            activityType = 'PURCHASE_ORDER_UPDATE';
        await auditLogger_1.auditLogger.purchaseOrders(req, {
            type: activityType,
            description: `Purchase Order ${order.orderNumber} status updated to ${status}`,
            entityType: 'PurchaseOrder',
            entityId: order.id,
            metadata: {
                status,
                orderNumber: order.orderNumber,
                receivingHistory,
            }
        });
        await notificationService.createNotification({
            organizationId: order.organizationId,
            title: 'Purchase Order Status Updated',
            message: `Purchase Order ${order.orderNumber} is now ${status}`,
            type: 'PURCHASE_ORDER',
            data: { orderId: order.id, status },
            recipientId: order.userId,
        });
        res.json(updatedOrder);
    }
    catch (error) {
        console.error("Error updating purchase order:", error);
        if (error?.message === "This purchase order has already been completed and received" ||
            error?.message === "Invalid or inactive branch for receiving" ||
            error?.message === "This purchase order has already been completed or cancelled" ||
            error?.message === "This purchase order has been cancelled") {
            return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: "Failed to update purchase order" });
    }
};
exports.updatePurchaseOrderStatus = updatePurchaseOrderStatus;
// Delete purchase order
const deletePurchaseOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const organizationId = parseInt(req.params.organizationId);
        const branchFilter = (0, branchAuth_middleware_1.buildBranchFilter)(req);
        const order = await prisma_1.prisma.purchaseOrder.findFirst({
            where: { id: parseInt(id), organizationId, ...branchFilter },
        });
        if (!order) {
            return res.status(404).json({ message: "Purchase order not found" });
        }
        await prisma_1.prisma.purchaseOrder.update({
            where: { id: order.id },
            data: { isActive: false }
        });
        await auditLogger_1.auditLogger.purchaseOrders(req, {
            type: 'PURCHASE_ORDER_ARCHIVED',
            description: `Purchase Order ${order.orderNumber} archived successfully`,
            entityType: 'PurchaseOrder',
            entityId: id,
            metadata: {
                orderNumber: order.orderNumber,
            }
        });
        res.json({ message: "Purchase order deleted successfully" });
    }
    catch (error) {
        console.error("Error deleting purchase order:", error);
        res.status(500).json({ message: "Failed to delete purchase order" });
    }
};
exports.deletePurchaseOrder = deletePurchaseOrder;
