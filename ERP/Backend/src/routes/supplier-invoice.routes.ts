import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import {
  uploadAndScanInvoice,
  getInvoices,
  getInvoice,
  updateInvoiceItems,
  matchProducts,
  importInvoiceProducts,
  deleteInvoice,
} from '../controllers/supplier-invoice.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { branchAuth } from '../middleware/branchAuth.middleware';
import { requireOrganizationAccess } from '../middleware/organizationAccess.middleware';
import { requireActiveSubscription } from '../middleware/feature-access.middleware';

const router = Router();
const orgAccess = requireOrganizationAccess();

// multer's diskStorage does not create the destination directory itself —
// it must already exist or every upload fails with ENOENT.
const invoiceUploadDir = path.join(process.cwd(), 'uploads', 'invoices');
fs.mkdirSync(invoiceUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, invoiceUploadDir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `invoice-${unique}${ext}`);
  },
});

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF, JPG, JPEG, and PNG files are allowed'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

router.post(
  '/:organizationId/scan',
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'),
  upload.single('invoice'),
  uploadAndScanInvoice
);

router.get(
  '/:organizationId',
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  getInvoices
);

router.get(
  '/:organizationId/:id',
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  getInvoice
);

router.put(
  '/:organizationId/:id/items',
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'),
  updateInvoiceItems
);

router.post(
  '/:organizationId/match',
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  matchProducts
);

router.post(
  '/:organizationId/:id/import',
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'),
  importInvoiceProducts
);

router.delete(
  '/:organizationId/:id',
  authenticate,
  orgAccess, requireActiveSubscription(),
  branchAuth,
  authorize('ADMIN', 'ACCOUNTANT', 'BRANCH_MANAGER'),
  deleteInvoice
);

export default router;
