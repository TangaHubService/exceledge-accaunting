"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateEmail = validateEmail;
exports.validatePhone = validatePhone;
exports.checkDuplicatePhonesInFile = checkDuplicatePhonesInFile;
exports.checkDuplicateEmailsInFile = checkDuplicateEmailsInFile;
exports.checkDuplicatePhoneInDB = checkDuplicatePhoneInDB;
exports.checkDuplicateEmailInDB = checkDuplicateEmailInDB;
exports.validateCustomerRow = validateCustomerRow;
exports.validateSupplierRow = validateSupplierRow;
const prisma_1 = require("../lib/prisma");
// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Phone validation - accepts various formats (international, local, with/without spaces, dashes)
const PHONE_REGEX = /^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,9}$/;
/**
 * Validate email format
 */
function validateEmail(email) {
    if (!email || email.trim() === "") {
        return { isValid: true, errors: [] }; // Email is optional
    }
    if (!EMAIL_REGEX.test(email.trim())) {
        return {
            isValid: false,
            errors: [{ field: "email", message: "Invalid email format" }],
        };
    }
    return { isValid: true, errors: [] };
}
/**
 * Validate phone number format
 */
function validatePhone(phone, isRequired = true) {
    if (!phone || phone.trim() === "") {
        if (isRequired) {
            return {
                isValid: false,
                errors: [{ field: "phone", message: "Phone number is required" }],
            };
        }
        return { isValid: true, errors: [] }; // Phone is optional
    }
    const cleanedPhone = phone.trim().replace(/[\s\-\(\)]/g, "");
    if (!PHONE_REGEX.test(phone.trim())) {
        return {
            isValid: false,
            errors: [{ field: "phone", message: "Invalid phone number format" }],
        };
    }
    return { isValid: true, errors: [] };
}
/**
 * Check for duplicate phone numbers within the file
 */
function checkDuplicatePhonesInFile(rows, currentIndex, phone) {
    if (!phone || phone.trim() === "") {
        return { isValid: true, errors: [] };
    }
    const normalizedPhone = phone.trim().toLowerCase();
    const duplicateIndex = rows.findIndex((row, index) => index < currentIndex &&
        (row.phone || row.Phone || row.PHONE) &&
        String(row.phone || row.Phone || row.PHONE).trim().toLowerCase() === normalizedPhone);
    if (duplicateIndex !== -1) {
        return {
            isValid: false,
            errors: [
                {
                    field: "phone",
                    message: `Duplicate phone number found in row ${duplicateIndex + 2}`,
                },
            ],
        };
    }
    return { isValid: true, errors: [] };
}
/**
 * Check for duplicate emails within the file
 */
function checkDuplicateEmailsInFile(rows, currentIndex, email) {
    if (!email || email.trim() === "") {
        return { isValid: true, errors: [] };
    }
    const normalizedEmail = email.trim().toLowerCase();
    const duplicateIndex = rows.findIndex((row, index) => index < currentIndex &&
        (row.email || row.Email || row.EMAIL) &&
        String(row.email || row.Email || row.EMAIL).trim().toLowerCase() === normalizedEmail);
    if (duplicateIndex !== -1) {
        return {
            isValid: false,
            errors: [
                {
                    field: "email",
                    message: `Duplicate email found in row ${duplicateIndex + 2}`,
                },
            ],
        };
    }
    return { isValid: true, errors: [] };
}
/**
 * Check if phone number already exists in database
 */
async function checkDuplicatePhoneInDB(phone, organizationId, entityType) {
    if (!phone || phone.trim() === "") {
        return { isValid: true, errors: [] };
    }
    try {
        let existing;
        if (entityType === "customer") {
            existing = await prisma_1.prisma.customer.findFirst({
                where: {
                    organizationId,
                    phone: phone.trim(),
                },
            });
        }
        else {
            existing = await prisma_1.prisma.supplier.findFirst({
                where: {
                    organizationId,
                    phone: phone.trim(),
                },
            });
        }
        if (existing) {
            return {
                isValid: false,
                errors: [
                    {
                        field: "phone",
                        message: `Phone number already exists in database`,
                    },
                ],
            };
        }
        return { isValid: true, errors: [] };
    }
    catch (error) {
        return {
            isValid: false,
            errors: [{ field: "phone", message: "Error checking phone number in database" }],
        };
    }
}
/**
 * Check if email already exists in database
 */
async function checkDuplicateEmailInDB(email, organizationId, entityType) {
    if (!email || email.trim() === "") {
        return { isValid: true, errors: [] };
    }
    try {
        let existing;
        if (entityType === "customer") {
            existing = await prisma_1.prisma.customer.findFirst({
                where: {
                    organizationId,
                    email: email.trim(),
                },
            });
        }
        else {
            existing = await prisma_1.prisma.supplier.findFirst({
                where: {
                    organizationId,
                    email: email.trim(),
                },
            });
        }
        if (existing) {
            return {
                isValid: false,
                errors: [
                    {
                        field: "email",
                        message: `Email already exists in database`,
                    },
                ],
            };
        }
        return { isValid: true, errors: [] };
    }
    catch (error) {
        return {
            isValid: false,
            errors: [{ field: "email", message: "Error checking email in database" }],
        };
    }
}
/**
 * Validate customer row
 */
async function validateCustomerRow(row, rowIndex, allRows, organizationId) {
    const errors = [];
    // Extract fields (case-insensitive)
    const name = row.name || row.Name || row.NAME;
    const phone = row.phone || row.Phone || row.PHONE;
    const email = row.email || row.Email || row.EMAIL;
    const customerType = row.type || row.Type || row.TYPE || row.customerType || row.CustomerType || "INDIVIDUAL";
    const address = row.address || row.Address || row.ADDRESS;
    const balance = row.balance || row.Balance || row.BALANCE || "0";
    // Required field validation
    if (!name || String(name).trim() === "") {
        errors.push({ field: "name", message: "Name is required" });
    }
    // Phone validation
    const phoneValidation = validatePhone(phone, true);
    if (!phoneValidation.isValid) {
        errors.push(...phoneValidation.errors);
    }
    // Email validation (optional)
    if (email) {
        const emailValidation = validateEmail(email);
        if (!emailValidation.isValid) {
            errors.push(...emailValidation.errors);
        }
    }
    // Customer type validation
    const validTypes = ["INDIVIDUAL", "INSURANCE", "CORPORATE"];
    const typeUpper = String(customerType).toUpperCase();
    if (!validTypes.includes(typeUpper)) {
        errors.push({
            field: "type",
            message: `Invalid customer type. Must be one of: ${validTypes.join(", ")}`,
        });
    }
    // Balance validation
    if (balance) {
        const balanceNum = parseFloat(String(balance));
        if (isNaN(balanceNum)) {
            errors.push({ field: "balance", message: "Balance must be a valid number" });
        }
    }
    // Duplicate checks within file
    if (phone) {
        const duplicatePhoneInFile = checkDuplicatePhonesInFile(allRows, rowIndex, phone);
        if (!duplicatePhoneInFile.isValid) {
            errors.push(...duplicatePhoneInFile.errors);
        }
    }
    if (email) {
        const duplicateEmailInFile = checkDuplicateEmailsInFile(allRows, rowIndex, email);
        if (!duplicateEmailInFile.isValid) {
            errors.push(...duplicateEmailInFile.errors);
        }
    }
    // Duplicate checks against database
    if (phone && phoneValidation.isValid) {
        const duplicatePhoneInDB = await checkDuplicatePhoneInDB(String(phone), organizationId, "customer");
        if (!duplicatePhoneInDB.isValid) {
            errors.push(...duplicatePhoneInDB.errors);
        }
    }
    if (email && email.trim() !== "") {
        const emailValidation = validateEmail(email);
        if (emailValidation.isValid) {
            const duplicateEmailInDB = await checkDuplicateEmailInDB(String(email), organizationId, "customer");
            if (!duplicateEmailInDB.isValid) {
                errors.push(...duplicateEmailInDB.errors);
            }
        }
    }
    return {
        rowIndex,
        rowData: {
            name: name ? String(name).trim() : "",
            phone: phone ? String(phone).trim() : "",
            email: email ? String(email).trim() : null,
            address: address ? String(address).trim() : null,
            customerType: typeUpper,
            balance: balance ? parseFloat(String(balance)) : 0,
        },
        isValid: errors.length === 0,
        errors,
    };
}
/**
 * Validate supplier row
 */
async function validateSupplierRow(row, rowIndex, allRows, organizationId) {
    const errors = [];
    // Extract fields (case-insensitive)
    const name = row.name || row.Name || row.NAME;
    const email = row.email || row.Email || row.EMAIL;
    const phone = row.phone || row.Phone || row.PHONE;
    const address = row.address || row.Address || row.ADDRESS;
    const contactPerson = row.contactPerson || row.ContactPerson || row.CONTACT_PERSON || row["Contact Person"];
    // Required field validation
    if (!name || String(name).trim() === "") {
        errors.push({ field: "name", message: "Name is required" });
    }
    if (!email || String(email).trim() === "") {
        errors.push({ field: "email", message: "Email is required" });
    }
    // Email validation (required)
    if (email) {
        const emailValidation = validateEmail(email);
        if (!emailValidation.isValid) {
            errors.push(...emailValidation.errors);
        }
    }
    // Phone validation (optional)
    if (phone) {
        const phoneValidation = validatePhone(phone, false);
        if (!phoneValidation.isValid) {
            errors.push(...phoneValidation.errors);
        }
    }
    // Duplicate checks within file
    if (email) {
        const duplicateEmailInFile = checkDuplicateEmailsInFile(allRows, rowIndex, email);
        if (!duplicateEmailInFile.isValid) {
            errors.push(...duplicateEmailInFile.errors);
        }
    }
    if (phone) {
        const duplicatePhoneInFile = checkDuplicatePhonesInFile(allRows, rowIndex, phone);
        if (!duplicatePhoneInFile.isValid) {
            errors.push(...duplicatePhoneInFile.errors);
        }
    }
    // Duplicate checks against database
    if (email && email.trim() !== "") {
        const emailValidation = validateEmail(email);
        if (emailValidation.isValid) {
            const duplicateEmailInDB = await checkDuplicateEmailInDB(String(email), organizationId, "supplier");
            if (!duplicateEmailInDB.isValid) {
                errors.push(...duplicateEmailInDB.errors);
            }
        }
    }
    if (phone && phone.trim() !== "") {
        const phoneValidation = validatePhone(phone, false);
        if (phoneValidation.isValid) {
            const duplicatePhoneInDB = await checkDuplicatePhoneInDB(String(phone), organizationId, "supplier");
            if (!duplicatePhoneInDB.isValid) {
                errors.push(...duplicatePhoneInDB.errors);
            }
        }
    }
    return {
        rowIndex,
        rowData: {
            name: name ? String(name).trim() : "",
            email: email ? String(email).trim() : "",
            phone: phone ? String(phone).trim() : null,
            address: address ? String(address).trim() : null,
            contactPerson: contactPerson ? String(contactPerson).trim() : null,
        },
        isValid: errors.length === 0,
        errors,
    };
}
