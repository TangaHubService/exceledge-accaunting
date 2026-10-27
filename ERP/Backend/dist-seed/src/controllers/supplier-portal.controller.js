"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSupplierOrder = exports.getSupplierOrders = void 0;
const prisma_1 = require("../lib/prisma");
function getSupplierFromToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer '))
        return null;
    const token = authHeader.substring(7);
    return { supplierId: parseInt(req.params.supplierId), organizationId: parseInt(req.params.organizationId) };
}
const getSupplierOrders = async (req, res) => {
    try {
        const supplierId = parseInt(req.params.supplierId);
        const organizationId = parseInt(req.params.organizationId);
        const orders = await prisma_1.prisma.purchaseOrder.findMany({
            where: { supplierId, organizationId, isActive: true },
            include: {
                items: true,
                organization: { select: { name: true, email: true, phone: true } },
            },
            orderBy: { createdAt: "desc" },
        });
        res.json(orders);
    }
    catch (error) {
        console.error("Error fetching supplier orders:", error);
        res.status(500).json({ message: "Failed to fetch orders" });
    }
};
exports.getSupplierOrders = getSupplierOrders;
const getSupplierOrder = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const supplierId = parseInt(req.params.supplierId);
        const organizationId = parseInt(req.params.organizationId);
        const order = await prisma_1.prisma.purchaseOrder.findFirst({
            where: { id, supplierId, organizationId, isActive: true },
            include: {
                items: true,
                organization: { select: { name: true, email: true, phone: true, address: true } },
            },
        });
        if (!order) {
            return res.status(404).json({ message: "Purchase order not found" });
        }
        res.json(order);
    }
    catch (error) {
        console.error("Error fetching supplier order:", error);
        res.status(500).json({ message: "Failed to fetch order" });
    }
};
exports.getSupplierOrder = getSupplierOrder;
