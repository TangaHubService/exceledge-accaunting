"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const multer_1 = __importDefault(require("multer"));
const supplier_invoice_controller_1 = require("../controllers/supplier-invoice.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
const organizationAccess_middleware_1 = require("../middleware/organizationAccess.middleware");
const feature_access_middleware_1 = require("../middleware/feature-access.middleware");
const router = (0, express_1.Router)();
const orgAccess = (0, organizationAccess_middleware_1.requireOrganizationAccess)();
// multer's diskStorage does not create the destination directory itself —
// it must already exist or every upload fails with ENOENT.
const invoiceUploadDir = path_1.default.join(process.cwd(), 'uploads', 'invoices');
fs_1.default.mkdirSync(invoiceUploadDir, { recursive: true });
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, invoiceUploadDir);
    },
    filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        const ext = path_1.default.extname(file.originalname);
        cb(null, `invoice-${unique}${ext}`);
    },
});
const fileFilter = (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
        cb(null, true);
    }
    else {
        cb(new Error('Only PDF, JPG, JPEG, and PNG files are allowed'));
    }
};
const upload = (0, multer_1.default)({
    storage,
    fileFilter,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});
router.post('/:organizationId/scan', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'), upload.single('invoice'), supplier_invoice_controller_1.uploadAndScanInvoice);
router.get('/:organizationId', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, supplier_invoice_controller_1.getInvoices);
router.get('/:organizationId/:id', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, supplier_invoice_controller_1.getInvoice);
router.put('/:organizationId/:id/items', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'), supplier_invoice_controller_1.updateInvoiceItems);
router.post('/:organizationId/match', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, supplier_invoice_controller_1.matchProducts);
router.post('/:organizationId/:id/import', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'), supplier_invoice_controller_1.importInvoiceProducts);
router.delete('/:organizationId/:id', auth_middleware_1.authenticate, orgAccess, (0, feature_access_middleware_1.requireActiveSubscription)(), branchAuth_middleware_1.branchAuth, (0, auth_middleware_1.authorize)('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'), supplier_invoice_controller_1.deleteInvoice);
exports.default = router;
