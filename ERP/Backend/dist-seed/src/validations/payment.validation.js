"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPaymentSchema = void 0;
const zod_1 = require("zod");
exports.createPaymentSchema = zod_1.z.object({
    subscriptionId: zod_1.z.string().uuid('Invalid subscription ID'),
    amount: zod_1.z.number().positive('Amount must be a positive number'),
    currency: zod_1.z.string().default('USD'),
    description: zod_1.z.string().min(5, 'Description must be at least 5 characters'),
    customerEmail: zod_1.z.string().email('Invalid email address'),
    customerFirstName: zod_1.z.string().min(2, 'First name is required'),
    customerLastName: zod_1.z.string().min(2, 'Last name is required'),
    customerPhone: zod_1.z.string().optional(),
    reference: zod_1.z.string().optional(),
    redirectUrl: zod_1.z.string().url('Invalid URL').optional(),
    backUrl: zod_1.z.string().url('Invalid URL').optional(),
    metadata: zod_1.z.any().optional(),
});
