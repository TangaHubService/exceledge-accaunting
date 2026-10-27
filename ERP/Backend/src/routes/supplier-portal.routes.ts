import { Router } from "express"
import {
    getSupplierOrders,
    getSupplierOrder,
} from "../controllers/supplier-portal.controller"

const router = Router()

// Supplier portal routes - authenticated via supplier access token in the controller
router.get("/:organizationId/:supplierId/orders", getSupplierOrders)
router.get("/:organizationId/:supplierId/orders/:id", getSupplierOrder)

export default router
