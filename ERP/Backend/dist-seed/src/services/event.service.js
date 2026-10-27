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
class EventService {
    constructor(prisma) {
        this.prisma = prisma;
        // Dynamically import to avoid circular dependencies
        Promise.resolve().then(() => __importStar(require('./notification.service'))).then(module => {
            this.notificationService = new module.default(prisma);
        });
    }
    async emit(event) {
        try {
            // Handle the event based on its type
            switch (event.type) {
                case 'inventory:low_stock':
                    return this.handleLowStock(event);
                case 'inventory:updated':
                    return this.handleInventoryUpdated(event);
                case 'sale:created':
                    return this.handleSaleCreated(event);
                case 'sale:updated':
                    return this.handleSaleUpdated(event);
                case 'user:created':
                    return this.handleUserCreated(event);
                case 'user:updated':
                    return this.handleUserUpdated(event);
                case 'system:maintenance':
                    return this.handleSystemMaintenance(event);
                default:
                    console.warn(`Unhandled event type: ${event.type}`);
            }
        }
        catch (error) {
            console.error(`Error processing ${event.type} event:`, error);
            throw error;
        }
    }
    async handleLowStock({ organizationId, data, recipientId }) {
        if (!this.notificationService) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return this.notificationService.createNotification({
            organizationId,
            title: 'Low Stock Alert',
            message: `${data.productName} is running low. Current stock: ${data.currentStock} (Threshold: ${data.threshold})`,
            type: 'WARNING',
            data: {
                itemId: data.itemId,
                productName: data.productName,
                currentStock: data.currentStock,
                threshold: data.threshold
            },
            recipientId
        });
    }
    async handleInventoryUpdated({ organizationId, data, recipientId }) {
        if (!this.notificationService) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        const action = data.quantity < 0 ? 'decreased' : 'increased';
        const quantity = Math.abs(data.quantity);
        return this.notificationService.createNotification({
            organizationId,
            title: 'Inventory Updated',
            message: `Stock for ${data.productName} has been ${action} by ${quantity}. New stock: ${data.newStock}`,
            type: 'INFO',
            data: {
                productId: data.productId,
                productName: data.productName,
                quantity: data.quantity,
                newStock: data.newStock
            },
            recipientId
        });
    }
    async handleSaleCreated({ organizationId, data, recipientId }) {
        if (!this.notificationService) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return this.notificationService.createNotification({
            organizationId,
            title: 'New Sale',
            message: `New sale #${data.saleId} to ${data.customerName} for $${data.totalAmount}`,
            type: 'SALE',
            data: {
                saleId: data.saleId,
                customerName: data.customerName,
                totalAmount: data.totalAmount,
                itemCount: data.itemCount
            },
            recipientId
        });
    }
    async handleUserCreated({ organizationId, data, recipientId }) {
        if (!this.notificationService) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return this.notificationService.createNotification({
            organizationId,
            title: 'New User Added',
            message: `${data.email} has been added as ${data.role}`,
            type: 'INFO',
            data: {
                userId: data.userId,
                email: data.email,
                role: data.role
            },
            recipientId: recipientId || undefined
        });
    }
    async handleSaleUpdated({ organizationId, data, recipientId }) {
        if (!this.notificationService) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return this.notificationService.createNotification({
            organizationId,
            title: 'Sale Updated',
            message: `Sale #${data.saleId} has been updated`,
            type: 'SALE',
            data: {
                saleId: data.saleId,
                status: data.status,
                updatedFields: data.updatedFields
            },
            recipientId
        });
    }
    async handleUserUpdated({ organizationId, data, recipientId }) {
        if (!this.notificationService) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return this.notificationService.createNotification({
            organizationId,
            title: 'User Profile Updated',
            message: `User ${data.email}'s profile has been updated`,
            type: 'INFO',
            data: {
                userId: data.userId,
                email: data.email,
                updatedFields: data.updatedFields
            },
            recipientId: recipientId || undefined
        });
    }
    async handleSystemMaintenance({ organizationId, data }) {
        if (!this.notificationService) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return this.notificationService.createNotification({
            organizationId,
            title: data.title || 'System Maintenance',
            message: data.message || 'Scheduled system maintenance is about to begin.',
            type: 'SYSTEM',
            data: data.additionalData || {}
        });
    }
}
exports.default = EventService;
