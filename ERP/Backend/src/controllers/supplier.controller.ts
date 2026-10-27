import type { Response } from "express"
import { prisma } from "../lib/prisma"
import { auditLogger } from "../utils/auditLogger"
import * as XLSX from "xlsx"
import { validateSupplierRow, validateEmail } from "../services/import-validation.service"
import { createPreviewSession, getPreviewSession, deletePreviewSession } from "../services/preview-session.service"
import type { BranchAuthRequest } from "../middleware/branchAuth.middleware"

// Get all suppliers for an organization
export const getSuppliers = async (req: BranchAuthRequest, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId)
        const { showInactive } = req.query

        // Suppliers are organization-wide records (the Supplier model has no
        // branchId column) — they are not owned by a single branch, so no
        // branch filter is applied here. Filtering by `purchaseOrders.some({branchId})`
        // was previously attempted, but that hides suppliers that have not yet
        // had a purchase order raised against them in the selected branch,
        // including every newly created supplier. Branch isolation for
        // suppliers is unnecessary since the data itself is org-scoped, not
        // branch-scoped; access is still limited to members of the organization.
        const where: any = { organizationId }
        if (showInactive !== 'true') {
            where.isActive = true
        }

        const suppliers = await prisma.supplier.findMany({
            where,
            orderBy: { createdAt: "desc" },
        })

        res.json(suppliers)
    } catch (error) {
        console.error("Error fetching suppliers:", error)
        res.status(500).json({ message: "Failed to fetch suppliers" })
    }
}

// Get single supplier
export const getSupplier = async (req: BranchAuthRequest, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId)
        const id = parseInt(req.params.id)

        // See getSuppliers: suppliers are org-scoped, not branch-scoped.
        const supplier = await prisma.supplier.findFirst({
            where: { id, organizationId },
        })

        if (!supplier) {
            return res.status(404).json({ message: "Supplier not found" })
        }

        res.json(supplier)
    } catch (error) {
        console.error("Error fetching supplier:", error)
        res.status(500).json({ message: "Failed to fetch supplier" })
    }
}

// Create supplier
export const createSupplier = async (req: BranchAuthRequest, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId)
        const { name, email, phone, address, contactPerson } = req.body

        if (!name || String(name).trim() === "") {
            return res.status(400).json({ message: "Supplier name is required" })
        }
        if (!email || String(email).trim() === "") {
            return res.status(400).json({ message: "Supplier email is required" })
        }
        const emailValidation = validateEmail(email)
        if (!emailValidation.isValid) {
            return res.status(400).json({ message: "Invalid email format" })
        }

        const supplier = await prisma.supplier.create({
            data: {
                name,
                email,
                phone,
                address,
                contactPerson,
                organizationId,
            },
        })

        await auditLogger.purchaseOrders(req, {
            type: 'SUPPLIER_CREATE',
            description: `Supplier "${supplier.name}" created successfully`,
            entityType: 'Supplier',
            entityId: supplier.id,
            metadata: { supplier }
        })

        res.status(201).json(supplier)
    } catch (error) {
        console.error("Error creating supplier:", error)
        res.status(500).json({ message: "Failed to create supplier" })
    }
}

// Update supplier
export const updateSupplier = async (req: BranchAuthRequest, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId)
        const id = parseInt(req.params.id)
        const { name, email, phone, address, contactPerson, isActive } = req.body

        const existingSupplier = await prisma.supplier.findFirst({
            where: { id, organizationId },
        })

        if (!existingSupplier) {
            return res.status(404).json({ message: "Supplier not found" })
        }

        if (email !== undefined) {
            if (String(email).trim() === "") {
                return res.status(400).json({ message: "Supplier email is required" })
            }
            const emailValidation = validateEmail(email)
            if (!emailValidation.isValid) {
                return res.status(400).json({ message: "Invalid email format" })
            }
        }

        const supplier = await prisma.supplier.update({
            where: { id: existingSupplier.id },
            data: { name, email, phone, address, contactPerson, isActive },
        })

        await auditLogger.purchaseOrders(req, {
            type: 'SUPPLIER_UPDATE',
            description: `Supplier "${supplier.name}" updated successfully`,
            entityType: 'Supplier',
            entityId: id,
            metadata: {
                previousData: existingSupplier,
                updatedData: supplier,
            }
        })

        res.json(supplier)
    } catch (error) {
        console.error("Error updating supplier:", error)
        res.status(500).json({ message: "Failed to update supplier" })
    }
}

export const deleteSupplier = async (req: BranchAuthRequest, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId)
        const id = parseInt(req.params.id)

        const existingSupplier = await prisma.supplier.findFirst({
            where: { id, organizationId },
        })

        if (!existingSupplier) {
            return res.status(404).json({ message: "Supplier not found" })
        }

        await prisma.supplier.update({
            where: { id: existingSupplier.id },
            data: { isActive: false }
        })

        await auditLogger.purchaseOrders(req, {
            type: 'SUPPLIER_DELETE',
            description: `Supplier "${existingSupplier.name}" archived successfully`,
            entityType: 'Supplier',
            entityId: id,
        })

        res.json({ message: "Supplier archived successfully" })
    } catch (error) {
        console.error("Error deleting supplier:", error)
        res.status(500).json({ message: "Failed to delete supplier" })
    }
}

/**
 * Bulk import suppliers from Excel file
 */
export const bulkImportSuppliers = async (req: BranchAuthRequest, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId)

        if (!req.file) {
            return res.status(400).json({ error: "Excel file is required" })
        }

        const workbook = XLSX.read(req.file.buffer, { type: "buffer" })
        const sheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[sheetName]
        const data = XLSX.utils.sheet_to_json(worksheet)

        const suppliers = []
        const errors = []

        for (let i = 0; i < data.length; i++) {
            const row = data[i] as any
            try {
                const name = row.name || row.Name || row.NAME
                const email = row.email || row.Email || row.EMAIL
                const phone = row.phone || row.Phone || row.PHONE
                const address = row.address || row.Address || row.ADDRESS
                const contactPerson = row.contactPerson || row.ContactPerson || row.CONTACT_PERSON || row["Contact Person"]

                if (!name || !email) {
                    errors.push({
                        row: i + 2,
                        data: row,
                        error: "Missing required fields: name and email",
                    })
                    continue
                }

                const existing = await prisma.supplier.findFirst({
                    where: {
                        organizationId,
                        email: String(email),
                    },
                })

                if (existing) {
                    errors.push({
                        row: i + 2,
                        data: row,
                        error: `Supplier with email ${email} already exists`,
                    })
                    continue
                }

                const supplier = await prisma.supplier.create({
                    data: {
                        name: String(name),
                        email: String(email),
                        phone: phone ? String(phone) : null,
                        address: address ? String(address) : null,
                        contactPerson: contactPerson ? String(contactPerson) : null,
                        organizationId,
                    },
                })

                suppliers.push(supplier)
            } catch (error: any) {
                errors.push({
                    row: i + 2,
                    data: row,
                    error: error.message || "Unknown error",
                })
            }
        }

        let errorFileBuffer = null
        if (errors.length > 0) {
            const errorData = errors.map((e) => ({
                Row: e.row,
                Error: e.error,
                ...e.data,
            }))
            const errorWorksheet = XLSX.utils.json_to_sheet(errorData)
            const errorWorkbook = XLSX.utils.book_new()
            XLSX.utils.book_append_sheet(errorWorkbook, errorWorksheet, "Errors")
            errorFileBuffer = XLSX.write(errorWorkbook, { bookType: "xlsx", type: "buffer" })
        }

        await auditLogger.purchaseOrders(req, {
            type: 'SUPPLIER_CREATE',
            description: `Bulk imported ${suppliers.length} suppliers${errors.length > 0 ? ` (${errors.length} errors)` : ''}`,
            entityType: 'Supplier',
            entityId: 'bulk-import',
            metadata: { imported: suppliers.length, errors: errors.length },
        })

        res.json({
            success: true,
            imported: suppliers.length,
            errors: errors.length,
            suppliers,
            importErrors: errors.length > 0 ? errors : undefined,
            errorFile: errorFileBuffer
                ? `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${errorFileBuffer.toString('base64')}`
                : null,
        })
    } catch (error: any) {
        console.error("Error bulk importing suppliers:", error)
        res.status(500).json({ error: error.message || "Failed to import suppliers" })
    }
}

/**
 * Preview supplier import - validates but does not save
 */
export const previewImportSuppliers = async (req: BranchAuthRequest, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId)
        const workbook = XLSX.read(req.file!.buffer, { type: "buffer" })
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]])

        const validRows: any[] = []
        const invalidRows: any[] = []

        for (let i = 0; i < data.length; i++) {
            const row = data[i] as any
            const validationResult = await validateSupplierRow(row, i, data, organizationId)

            if (validationResult.isValid) {
                validRows.push({ ...validationResult.rowData, rowNumber: i + 2 })
            } else {
                invalidRows.push({
                    ...validationResult.rowData,
                    rowNumber: i + 2,
                    errors: validationResult.errors.map((e) => e.message).join("; "),
                    errorDetails: validationResult.errors,
                })
            }
        }

        const importId = createPreviewSession(organizationId, "supplier", validRows, invalidRows)

        res.json({
            importId,
            validRows,
            invalidRows,
            summary: {
                total: validRows.length + invalidRows.length,
                valid: validRows.length,
                invalid: invalidRows.length,
            },
        })
    } catch (error: any) {
        console.error("[Preview Import Suppliers Error]:", error)
        res.status(500).json({ error: error.message || "Failed to preview import" })
    }
}

/**
 * Confirm supplier import - saves valid records
 */
export const confirmImportSuppliers = async (req: BranchAuthRequest, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId)
        const { importId } = req.body
        const session = getPreviewSession(importId)

        if (!session || session.organizationId !== organizationId || session.entityType !== "supplier") {
            return res.status(400).json({ error: "Invalid import session" })
        }

        const savedSuppliers: any[] = []
        await prisma.$transaction(async (tx) => {
            for (const row of session.validRows) {
                const supplier = await tx.supplier.create({
                    data: {
                        name: row.name,
                        email: row.email,
                        phone: row.phone,
                        address: row.address,
                        contactPerson: row.contactPerson,
                        organizationId,
                    },
                })
                savedSuppliers.push(supplier)
            }
        })

        let errorFileBuffer = null
        if (session.invalidRows.length > 0) {
            const errorData = session.invalidRows.map((row) => ({
                Row: row.rowNumber,
                Error: row.errors,
                ...row,
            }))
            const errorWorksheet = XLSX.utils.json_to_sheet(errorData)
            const errorWorkbook = XLSX.utils.book_new()
            XLSX.utils.book_append_sheet(errorWorkbook, errorWorksheet, "Errors")
            errorFileBuffer = XLSX.write(errorWorkbook, { bookType: "xlsx", type: "buffer" })
        }

        await auditLogger.purchaseOrders(req, {
            type: "SUPPLIER_CREATE",
            description: `Imported ${savedSuppliers.length} suppliers${session.invalidRows.length > 0 ? ` (${session.invalidRows.length} errors)` : ""}`,
            entityType: "Supplier",
            entityId: "bulk-import",
            metadata: { imported: savedSuppliers.length, errors: session.invalidRows.length, importId },
        })

        deletePreviewSession(importId)

        res.json({
            success: true,
            imported: savedSuppliers.length,
            errors: session.invalidRows.length,
            suppliers: savedSuppliers,
            errorFile: errorFileBuffer
                ? `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${errorFileBuffer.toString("base64")}`
                : null,
        })
    } catch (error: any) {
        console.error("[Confirm Import Suppliers Error]:", error)
        res.status(500).json({ error: error.message || "Failed to confirm import" })
    }
}

export const downloadSupplierErrorFile = async (req: BranchAuthRequest, res: Response) => {
    try {
        const organizationId = parseInt(req.params.organizationId)
        const { importId } = req.params
        const session = getPreviewSession(importId)

        if (!session || session.organizationId !== organizationId) {
            return res.status(404).json({ error: "Import session not found" })
        }

        const errorData = session.invalidRows.map((row) => ({
            Row: row.rowNumber,
            Error: row.errors,
            ...row,
        }))

        const worksheet = XLSX.utils.json_to_sheet(errorData)
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, worksheet, "Errors")
        const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" })

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        res.setHeader("Content-Disposition", `attachment; filename=supplier-import-errors-${importId}.xlsx`)
        res.send(buffer)
    } catch (error: any) {
        console.error("Error downloading error file:", error)
        res.status(500).json({ error: "Failed to download error file" })
    }
}

export const downloadSupplierTemplate = async (req: BranchAuthRequest, res: Response) => {
    try {
        const templateData = [{ name: "ABC Suppliers Ltd", email: "contact@abcsuppliers.com", phone: "+250788123456", address: "Kigali, Rwanda", contactPerson: "John Smith" }]
        const worksheet = XLSX.utils.json_to_sheet(templateData)
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, worksheet, "Suppliers Template")
        const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" })

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        res.setHeader("Content-Disposition", "attachment; filename=suppliers-import-template.xlsx")
        res.send(buffer)
    } catch (error: any) {
        console.error("Error generating template:", error)
        res.status(500).json({ error: "Failed to generate template" })
    }
}
