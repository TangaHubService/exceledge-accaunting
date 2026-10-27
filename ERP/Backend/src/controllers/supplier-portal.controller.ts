import type { Response } from "express"
import { prisma } from "../lib/prisma"
import crypto from "crypto"

interface SupplierPortalRequest {
    supplierId: number;
    organizationId: number;
}

function getSupplierFromToken(req: any): SupplierPortalRequest | null {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null
    const token = authHeader.substring(7)
    return { supplierId: parseInt(req.params.supplierId), organizationId: parseInt(req.params.organizationId) }
}

export const getSupplierOrders = async (req: any, res: Response) => {
    try {
        const supplierId = parseInt(req.params.supplierId)
        const organizationId = parseInt(req.params.organizationId)

        const orders = await prisma.purchaseOrder.findMany({
            where: { supplierId, organizationId, isActive: true },
            include: {
                items: true,
                organization: { select: { name: true, email: true, phone: true } },
            },
            orderBy: { createdAt: "desc" },
        })

        res.json(orders)
    } catch (error) {
        console.error("Error fetching supplier orders:", error)
        res.status(500).json({ message: "Failed to fetch orders" })
    }
}

export const getSupplierOrder = async (req: any, res: Response) => {
    try {
        const id = parseInt(req.params.id)
        const supplierId = parseInt(req.params.supplierId)
        const organizationId = parseInt(req.params.organizationId)

        const order = await prisma.purchaseOrder.findFirst({
            where: { id, supplierId, organizationId, isActive: true },
            include: {
                items: true,
                organization: { select: { name: true, email: true, phone: true, address: true } },
            },
        })

        if (!order) {
            return res.status(404).json({ message: "Purchase order not found" })
        }

        res.json(order)
    } catch (error) {
        console.error("Error fetching supplier order:", error)
        res.status(500).json({ message: "Failed to fetch order" })
    }
}
