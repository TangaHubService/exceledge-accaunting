"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const supplier_portal_controller_1 = require("../controllers/supplier-portal.controller");
const router = (0, express_1.Router)();
// Supplier portal routes - authenticated via supplier access token in the controller
router.get("/:organizationId/:supplierId/orders", supplier_portal_controller_1.getSupplierOrders);
router.get("/:organizationId/:supplierId/orders/:id", supplier_portal_controller_1.getSupplierOrder);
exports.default = router;
