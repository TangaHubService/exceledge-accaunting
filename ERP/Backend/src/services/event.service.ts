import { PrismaClient } from '@prisma/client';

type EventType =
    | 'inventory:low_stock'
    | 'inventory:updated'
    | 'sale:created'
    | 'sale:updated'
    | 'user:created'
    | 'user:updated'
    | 'system:maintenance';

interface EventData {
    organizationId: string;
    type: EventType;
    data: Record<string, any>;
    recipientId?: string;
}

class EventService {
    private prisma: PrismaClient;
    private notificationService: any; // Will be initialized in constructor

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
        // Dynamically import to avoid circular dependencies
        import('./notification.service').then(module => {
            this.notificationService = new module.default(prisma);
        });
    }

    public async emit(event: EventData) {
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
        } catch (error) {
            console.error(`Error processing ${event.type} event:`, error);
            throw error;
        }
    }

    private async handleLowStock({ organizationId, data, recipientId }: EventData) {
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

    private async handleInventoryUpdated({ organizationId, data, recipientId }: EventData) {
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

    private async handleSaleCreated({ organizationId, data, recipientId }: EventData) {
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

    private async handleUserCreated({ organizationId, data, recipientId }: EventData) {
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

    private async handleSaleUpdated({ organizationId, data, recipientId }: EventData) {
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

    private async handleUserUpdated({ organizationId, data, recipientId }: EventData) {
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

    private async handleSystemMaintenance({ organizationId, data }: EventData) {
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

export default EventService;
