// src/dto/supplier-order.dto.ts
export class OrderItemDto {
    productName: string = '';
    quantity: number = 0;
    unitPrice: number = 0;
    notes: string = '';

    constructor(data?: Partial<OrderItemDto>) {
        if (data) {
            Object.assign(this, data);
        }
    }
}

export class CreateSupplierOrderDto {
    supplierId: string = '';
    expectedDate?: Date;
    notes: string = '';
    items: OrderItemDto[] = [];

    constructor(data?: Partial<CreateSupplierOrderDto>) {
        if (data) {
            Object.assign(this, data);
            if (data?.items) {
                this.items = data.items.map(item => new OrderItemDto(item));
            }
        }
    }
}

export class UpdateSupplierOrderStatusDto {
    status: 'PENDING' | 'PROCESSING' | 'APPROVED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'REJECTED' = 'PENDING';
    notes: string = '';

    constructor(data?: Partial<UpdateSupplierOrderStatusDto>) {
        if (data) {
            Object.assign(this, data);
        }
    }
}

export class UpdateOrderItemStatusDto {
    status: 'PENDING' | 'PARTIALLY_FULFILLED' | 'FULFILLED' | 'CANCELLED' = 'PENDING';
    receivedQuantity: number = 0;
    notes: string = '';

    constructor(data?: Partial<UpdateOrderItemStatusDto>) {
        if (data) {
            Object.assign(this, data);
        }
    }
}

export class SupplierOrderItemDto {
    id: string = '';
    productId: string = '';
    productName: string = '';
    quantity: number = 0;
    receivedQuantity: number = 0;
    unitPrice: number = 0;
    status: string = 'PENDING';
    notes: string = '';

    constructor(data?: Partial<SupplierOrderItemDto>) {
        if (data) {
            Object.assign(this, data);
        }
    }
}

export class SupplierOrderResponseDto {
    id: string = '';
    orderNumber: string = '';
    supplierId: string = '';
    status: string = 'PENDING';
    orderDate: Date = new Date();
    expectedDate?: Date;
    notes: string = '';
    items: SupplierOrderItemDto[] = [];
    createdBy = {
        id: '',
        name: '',
        email: ''
    };
    approvedBy?: {
        id: string;
        name: string;
        email: string;
    };
    approvedAt?: Date;
    createdAt: Date = new Date();
    updatedAt: Date = new Date();

    constructor(data?: Partial<SupplierOrderResponseDto>) {
        if (data) {
            Object.assign(this, data);
            if (data?.items) {
                this.items = data.items.map(item => new SupplierOrderItemDto(item));
            }
            if (data?.orderDate) {
                this.orderDate = new Date(data.orderDate);
            }
            if (data?.expectedDate) {
                this.expectedDate = new Date(data.expectedDate);
            }
            if (data?.approvedAt) {
                this.approvedAt = new Date(data.approvedAt);
            }
            if (data?.createdAt) {
                this.createdAt = new Date(data.createdAt);
            }
            if (data?.updatedAt) {
                this.updatedAt = new Date(data.updatedAt);
            }
        }
    }
}