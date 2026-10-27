"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadCustomerTemplate = exports.downloadCustomerErrorFile = exports.confirmImportCustomers = exports.previewImportCustomers = exports.bulkImportCustomers = exports.deleteCustomer = exports.updateCustomer = exports.createCustomer = exports.getCustomerById = exports.getCustomers = void 0;
const branchAuth_middleware_1 = require("../middleware/branchAuth.middleware");
const auditLogger_1 = require("../utils/auditLogger");
const XLSX = __importStar(require("xlsx"));
const import_validation_service_1 = require("../services/import-validation.service");
const preview_session_service_1 = require("../services/preview-session.service");
const prisma_1 = require("../lib/prisma");
const sorting_1 = require("../utils/sorting");
const customers_validation_1 = require("../validations/customers.validation");
/**
 * Rejects a phone/TIN pair that's malformed or swapped before it ever reaches
 * the database — this is what ultimately becomes custTin/custMblNo on the
 * RRA VSDC sale payload (rra-ebm.service.ts), so garbage or crossed values
 * here would otherwise surface as a VSDC 910-class rejection at sale time.
 */
function validateCustomerContactFields(phone, tin) {
    const phoneValue = typeof phone === "string" ? phone.trim() : "";
    const tinValue = typeof tin === "string" ? tin.trim() : "";
    if (phoneValue && !(0, customers_validation_1.isValidCustomerPhone)(phoneValue)) {
        return "Invalid phone number — expected +<country code><digits> or 0XXXXXXXXX";
    }
    if (tinValue && !(0, customers_validation_1.isValidCustomerTin)(tinValue)) {
        return "TIN must be exactly 9 digits";
    }
    if (phoneValue && tinValue && phoneValue === tinValue) {
        return "Phone number and TIN cannot be the same value";
    }
    return null;
}
/** Treat browser query-string placeholders as absent values, never as filters. */
const optionalQueryValue = (value) => {
    if (typeof value !== "string")
        return undefined;
    const normalized = value.trim();
    return normalized && normalized !== "undefined" && normalized !== "null"
        ? normalized
        : undefined;
};
const getCustomers = async (req, res) => {
    try {
        const organizationId = parseInt(req.params?.organizationId);
        const { search, hasDebt, showInactive, customerType } = req.query;
        const { page = "1", limit = "50" } = req.query;
        // Apply pagination defaults and caps
        const limitNum = Math.min(Math.max(Number.parseInt(limit) || 50, 1), 500);
        const pageNum = Math.max(Number.parseInt(page) || 1, 1);
        const skip = (pageNum - 1) * limitNum;
        const where = { organizationId, deletedAt: null };
        const searchValue = optionalQueryValue(search);
        const hasDebtValue = optionalQueryValue(hasDebt);
        const showInactiveValue = optionalQueryValue(showInactive);
        const customerTypeValue = optionalQueryValue(customerType);
        if (showInactiveValue !== "true") {
            where.isActive = true;
        }
        if (searchValue) {
            where.OR = [
                { name: { contains: searchValue, mode: "insensitive" } },
                { phone: { contains: searchValue, mode: "insensitive" } },
                { email: { contains: searchValue, mode: "insensitive" } },
            ];
        }
        if (hasDebtValue === "true") {
            where.balance = { gt: 0 };
        }
        if (["INDIVIDUAL", "INSURANCE", "CORPORATE"].includes(customerTypeValue ?? "")) {
            where.customerType = customerTypeValue;
        }
        // Customers are organization-wide records (the Customer model has no
        // branchId column), so no branch filter is applied here. Filtering by
        // `sales.some({branchId})` was previously attempted, but that hid every
        // customer that had not yet made a purchase in the selected branch,
        // including newly created customers — the same root-cause bug as
        // suppliers (see supplier.controller.ts getSuppliers).
        const customers = await prisma_1.prisma.customer.findMany({
            where,
            select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                customerType: true,
                TIN: true,
                prcOrdCd: true,
                isrccCd: true,
                isrcRt: true,
                address: true,
                custPrvncNm: true,
                custDstrtNm: true,
                custSctrNm: true,
                custLocDesc: true,
                balance: true,
                isActive: true,
                _count: {
                    select: { sales: true },
                },
            },
            orderBy: (0, sorting_1.getOrderBy)(req.query, {
                name: { name: '$direction' },
                phone: { phone: '$direction' },
                email: { email: '$direction' },
                customerType: { customerType: '$direction' },
                TIN: { TIN: '$direction' },
                balance: { balance: '$direction' },
                isActive: { isActive: '$direction' },
                createdAt: { createdAt: '$direction' },
            }, 'createdAt', 'desc'),
            skip,
            take: limitNum,
        });
        const totalCustomers = await prisma_1.prisma.customer.count({ where });
        const totalPages = Math.ceil(totalCustomers / limitNum);
        res.json({
            customers,
            count: totalCustomers,
            totalPages,
            pagination: {
                total: totalCustomers,
                page: Number(page),
                limit: Number(limit),
            },
        });
    }
    catch (error) {
        console.error("[Get Customers Error]:", error);
        res.status(500).json({ error: "Failed to get customers" });
    }
};
exports.getCustomers = getCustomers;
const getCustomerById = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const organizationId = parseInt(req.params.organizationId);
        if (!organizationId) {
            return res.status(400).json({ error: "Organization ID is required" });
        }
        // Customers themselves are org-wide (see getCustomers), but their sales
        // history is branch-scoped data — a branch-restricted user must only see
        // the sales that happened in their own branch(es).
        const branchFilter = (0, branchAuth_middleware_1.buildBranchFilter)(req);
        const customer = await prisma_1.prisma.customer.findFirst({
            where: { id, organizationId, deletedAt: null },
            select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                customerType: true,
                TIN: true,
                prcOrdCd: true,
                isrccCd: true,
                isrcRt: true,
                address: true,
                custPrvncNm: true,
                custDstrtNm: true,
                custSctrNm: true,
                custLocDesc: true,
                balance: true,
                isActive: true,
                sales: {
                    where: branchFilter.branchId !== undefined ? { branchId: branchFilter.branchId } : undefined,
                    select: {
                        id: true,
                        saleNumber: true,
                        totalAmount: true,
                        status: true,
                        createdAt: true,
                        paymentType: true,
                        debtAmount: true,
                        saleItems: {
                            include: { product: true },
                        },
                    },
                    orderBy: { createdAt: "desc" },
                },
            },
        });
        if (!customer) {
            return res.status(404).json({ error: "Customer not found" });
        }
        res.json(customer);
    }
    catch (error) {
        console.error("[Get Customer Error]:", error);
        res.status(500).json({ error: "Failed to get customer" });
    }
};
exports.getCustomerById = getCustomerById;
const createCustomer = async (req, res) => {
    try {
        const organizationId = parseInt(req.params?.organizationId);
        const { name, phone, email, address, custPrvncNm, custDstrtNm, custSctrNm, custLocDesc, type, tin, TIN, prcOrdCd, balance, isrccCd, isrcRt } = req.body;
        const resolvedTin = TIN || tin || null;
        const contactError = validateCustomerContactFields(phone, resolvedTin);
        if (contactError) {
            return res.status(400).json({ error: contactError });
        }
        // Validate and map customerType
        let customerType = 'INDIVIDUAL';
        if (type === 'INSURANCE' || type === 'CORPORATE') {
            customerType = type;
        }
        if (customerType === 'INSURANCE' && !(isrccCd || '').trim()) {
            return res.status(400).json({ error: 'Insurance customers require an RRA insurance code (isrccCd)' });
        }
        const customer = await prisma_1.prisma.customer.create({
            data: {
                name,
                phone: phone || null,
                email: email || null,
                address: address || null,
                custPrvncNm: custPrvncNm || null,
                custDstrtNm: custDstrtNm || null,
                custSctrNm: custSctrNm || null,
                custLocDesc: custLocDesc || null,
                TIN: resolvedTin,
                prcOrdCd: prcOrdCd || null,
                isrccCd: customerType === 'INSURANCE' ? (isrccCd || null) : null,
                isrcRt: customerType === 'INSURANCE' && isrcRt != null ? isrcRt : null,
                customerType,
                balance: balance || 0,
                organizationId,
            },
        });
        await auditLogger_1.auditLogger.customers(req, {
            type: 'CUSTOMER_CREATE',
            description: `Customer "${customer.name}" created successfully`,
            entityType: 'Customer',
            entityId: customer.id,
            metadata: { customer }
        });
        // VSDC §3.3.3.1 — push customer master when a real TIN is present.
        const { syncCustomerToRraAsync } = await Promise.resolve().then(() => __importStar(require('../services/rra-branch-sync.service')));
        syncCustomerToRraAsync(organizationId, customer.id, {
            branchId: req.selectedBranchId ?? null,
            userId: req.user?.userId ? Number(req.user.userId) : undefined,
        });
        res.status(201).json(customer);
    }
    catch (error) {
        console.error("[Create Customer Error]:", error);
        res.status(500).json({ error: "Failed to create customer" });
    }
};
exports.createCustomer = createCustomer;
const updateCustomer = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const organizationId = parseInt(req.params.organizationId);
        const { balance, type, tin, TIN, prcOrdCd, ...rest } = req.body;
        const updateData = { ...rest };
        if (type !== undefined)
            updateData.customerType = type;
        if (TIN !== undefined)
            updateData.TIN = TIN;
        else if (tin !== undefined)
            updateData.TIN = tin;
        if (prcOrdCd !== undefined)
            updateData.prcOrdCd = prcOrdCd;
        // Clear insurance codes when demoting away from INSURANCE.
        if (type && type !== 'INSURANCE') {
            updateData.isrccCd = null;
            updateData.isrcRt = null;
        }
        const existingCustomer = await prisma_1.prisma.customer.findFirst({
            where: { id, organizationId, deletedAt: null },
        });
        if (!existingCustomer) {
            return res.status(404).json({ error: "Customer not found" });
        }
        // Validate against the *resulting* phone/TIN, not just whichever field
        // this particular request happens to touch — a request that only changes
        // one of the pair must still be checked against the other's existing value.
        const resolvedPhone = updateData.phone !== undefined ? updateData.phone : existingCustomer.phone;
        const resolvedTin = updateData.TIN !== undefined ? updateData.TIN : existingCustomer.TIN;
        const contactError = validateCustomerContactFields(resolvedPhone, resolvedTin);
        if (contactError) {
            return res.status(400).json({ error: contactError });
        }
        const customer = await prisma_1.prisma.customer.update({
            where: { id: existingCustomer.id },
            data: updateData,
        });
        await auditLogger_1.auditLogger.customers(req, {
            type: 'CUSTOMER_UPDATE',
            description: `Customer "${customer.name}" updated successfully`,
            entityType: 'Customer',
            entityId: customer.id,
            metadata: {
                previousData: existingCustomer,
                updatedData: customer,
            }
        });
        const { syncCustomerToRraAsync } = await Promise.resolve().then(() => __importStar(require('../services/rra-branch-sync.service')));
        syncCustomerToRraAsync(organizationId, customer.id, {
            branchId: req.selectedBranchId ?? null,
            userId: req.user?.userId ? Number(req.user.userId) : undefined,
        });
        res.json(customer);
    }
    catch (error) {
        console.error("[Update Customer Error]:", error);
        res.status(500).json({ error: "Failed to update customer" });
    }
};
exports.updateCustomer = updateCustomer;
const deleteCustomer = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const organizationId = parseInt(req.params?.organizationId);
        const existingCustomer = await prisma_1.prisma.customer.findFirst({
            where: { id, organizationId, deletedAt: null },
        });
        if (!existingCustomer) {
            return res.status(404).json({ error: "Customer not found" });
        }
        await prisma_1.prisma.customer.update({
            where: { id: existingCustomer.id },
            data: { isActive: false, deletedAt: new Date() },
        });
        await auditLogger_1.auditLogger.customers(req, {
            type: 'CUSTOMER_ARCHIVED',
            description: `Customer "${existingCustomer.name}" archived successfully`,
            entityType: 'Customer',
            entityId: id,
            metadata: { customer: existingCustomer }
        });
        res.json({ message: "Customer archived successfully" });
    }
    catch (error) {
        console.error("[Delete Customer Error]:", error);
        res.status(500).json({ error: "Failed to delete customer" });
    }
};
exports.deleteCustomer = deleteCustomer;
const bulkImportCustomers = async (req, res) => {
    try {
        const organizationId = parseInt(req.params?.organizationId);
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);
        const customers = [];
        const errors = [];
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            try {
                const name = row.name || row.Name || row.NAME;
                const phone = row.phone || row.Phone || row.PHONE;
                const email = row.email || row.Email || row.EMAIL;
                const type = row.type || row.Type || row.TYPE || row.customerType || row.CustomerType || "INDIVIDUAL";
                const address = row.address || row.Address || row.ADDRESS;
                const balance = parseFloat(row.balance || row.Balance || row.BALANCE || "0");
                if (!name) {
                    errors.push({
                        row: i + 2,
                        data: row,
                        error: "Missing required field: name",
                    });
                    continue;
                }
                let customerType = 'INDIVIDUAL';
                const typeUpper = String(type).toUpperCase();
                if (typeUpper === 'INSURANCE' || typeUpper === 'CORPORATE') {
                    customerType = typeUpper;
                }
                if (phone) {
                    const existing = await prisma_1.prisma.customer.findFirst({
                        where: { organizationId, phone: String(phone) },
                    });
                    if (existing) {
                        errors.push({
                            row: i + 2,
                            data: row,
                            error: `Customer with phone ${phone} already exists`,
                        });
                        continue;
                    }
                }
                const customer = await prisma_1.prisma.customer.create({
                    data: {
                        name: String(name),
                        phone: phone ? String(phone) : null,
                        email: email ? String(email) : null,
                        address: address ? String(address) : null,
                        customerType,
                        balance,
                        organizationId,
                    },
                });
                customers.push(customer);
            }
            catch (error) {
                errors.push({
                    row: i + 2,
                    data: row,
                    error: error.message || "Unknown error",
                });
            }
        }
        let errorFileBuffer = null;
        if (errors.length > 0) {
            const errorData = errors.map((e) => ({
                Row: e.row,
                Error: e.error,
                ...e.data,
            }));
            const errorWorksheet = XLSX.utils.json_to_sheet(errorData);
            const errorWorkbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(errorWorkbook, errorWorksheet, "Errors");
            errorFileBuffer = XLSX.write(errorWorkbook, { bookType: "xlsx", type: "buffer" });
        }
        await auditLogger_1.auditLogger.customers(req, {
            type: 'CUSTOMER_CREATE',
            description: `Bulk imported ${customers.length} customers${errors.length > 0 ? ` (${errors.length} errors)` : ''}`,
            entityType: 'Customer',
            entityId: 'bulk-import',
            metadata: { imported: customers.length, errors: errors.length },
        });
        res.json({
            success: true,
            imported: customers.length,
            customers,
            importErrors: errors.length > 0 ? errors : undefined,
            errorFile: errorFileBuffer
                ? `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${errorFileBuffer.toString('base64')}`
                : null,
        });
    }
    catch (error) {
        console.error("[Bulk Import Customers Error]:", error);
        res.status(500).json({ error: error.message || "Failed to import customers" });
    }
};
exports.bulkImportCustomers = bulkImportCustomers;
const previewImportCustomers = async (req, res) => {
    try {
        const organizationId = parseInt(req.params?.organizationId);
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        const validRows = [];
        const invalidRows = [];
        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            const validationResult = await (0, import_validation_service_1.validateCustomerRow)(row, i, data, organizationId);
            if (validationResult.isValid) {
                validRows.push({ ...validationResult.rowData, rowNumber: i + 2 });
            }
            else {
                invalidRows.push({
                    ...validationResult.rowData,
                    rowNumber: i + 2,
                    errors: validationResult.errors.map((e) => e.message).join("; "),
                    errorDetails: validationResult.errors,
                });
            }
        }
        const importId = (0, preview_session_service_1.createPreviewSession)(organizationId, "customer", validRows, invalidRows);
        res.json({
            importId,
            validRows,
            invalidRows,
            summary: {
                total: validRows.length + invalidRows.length,
                valid: validRows.length,
                invalid: invalidRows.length,
            },
        });
    }
    catch (error) {
        console.error("[Preview Import Customers Error]:", error);
        res.status(500).json({ error: error.message || "Failed to preview import" });
    }
};
exports.previewImportCustomers = previewImportCustomers;
const confirmImportCustomers = async (req, res) => {
    try {
        const organizationId = parseInt(req.params?.organizationId);
        const { importId } = req.body;
        const session = (0, preview_session_service_1.getPreviewSession)(importId);
        if (!session || session.organizationId !== organizationId || session.entityType !== "customer") {
            return res.status(400).json({ error: "Invalid import session" });
        }
        const savedCustomers = [];
        await prisma_1.prisma.$transaction(async (tx) => {
            for (const row of session.validRows) {
                const customer = await tx.customer.create({
                    data: {
                        name: row.name,
                        phone: row.phone,
                        email: row.email,
                        address: row.address,
                        customerType: row.customerType,
                        balance: row.balance || 0,
                        organizationId,
                    },
                });
                savedCustomers.push(customer);
            }
        });
        let errorFileBuffer = null;
        if (session.invalidRows.length > 0) {
            const errorData = session.invalidRows.map((row) => ({
                Row: row.rowNumber,
                Error: row.errors,
                ...row,
            }));
            const errorWorksheet = XLSX.utils.json_to_sheet(errorData);
            const errorWorkbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(errorWorkbook, errorWorksheet, "Errors");
            errorFileBuffer = XLSX.write(errorWorkbook, { bookType: "xlsx", type: "buffer" });
        }
        await auditLogger_1.auditLogger.customers(req, {
            type: "CUSTOMER_CREATE",
            description: `Imported ${savedCustomers.length} customers${session.invalidRows.length > 0 ? ` (${session.invalidRows.length} errors)` : ""}`,
            entityType: "Customer",
            entityId: "bulk-import",
            metadata: { imported: savedCustomers.length, errors: session.invalidRows.length, importId },
        });
        (0, preview_session_service_1.deletePreviewSession)(importId);
        res.json({
            success: true,
            imported: savedCustomers.length,
            errors: session.invalidRows.length,
            customers: savedCustomers,
            errorFile: errorFileBuffer
                ? `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${errorFileBuffer.toString("base64")}`
                : null,
        });
    }
    catch (error) {
        console.error("[Confirm Import Customers Error]:", error);
        res.status(500).json({ error: error.message || "Failed to confirm import" });
    }
};
exports.confirmImportCustomers = confirmImportCustomers;
const downloadCustomerErrorFile = async (req, res) => {
    try {
        const organizationId = parseInt(req.params?.organizationId);
        const { importId } = req.params;
        const session = (0, preview_session_service_1.getPreviewSession)(importId);
        if (!session || session.organizationId !== organizationId) {
            return res.status(404).json({ error: "Import session not found" });
        }
        const errorData = session.invalidRows.map((row) => ({
            Row: row.rowNumber,
            Error: row.errors,
            ...row,
        }));
        const worksheet = XLSX.utils.json_to_sheet(errorData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Errors");
        const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename=customer-import-errors-${importId}.xlsx`);
        res.send(buffer);
    }
    catch (error) {
        console.error("[Download Customer Error File Error]:", error);
        res.status(500).json({ error: "Failed to generate error file" });
    }
};
exports.downloadCustomerErrorFile = downloadCustomerErrorFile;
const downloadCustomerTemplate = async (req, res) => {
    try {
        const templateData = [{ name: "John Doe", phone: "+250788123456", email: "john@example.com", type: "INDIVIDUAL", address: "Kigali, Rwanda", balance: "0" }];
        const worksheet = XLSX.utils.json_to_sheet(templateData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Customers Template");
        const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", "attachment; filename=customers-import-template.xlsx");
        res.send(buffer);
    }
    catch (error) {
        console.error("[Download Customer Template Error]:", error);
        res.status(500).json({ error: "Failed to generate template" });
    }
};
exports.downloadCustomerTemplate = downloadCustomerTemplate;
