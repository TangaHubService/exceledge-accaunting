"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupplierOrderResponseDto = exports.SupplierOrderItemDto = exports.UpdateOrderItemStatusDto = exports.UpdateSupplierOrderStatusDto = exports.CreateSupplierOrderDto = exports.OrderItemDto = void 0;
// src/dto/supplier-order.dto.ts
class OrderItemDto {
    constructor(data) {
        this.productName = '';
        this.quantity = 0;
        this.unitPrice = 0;
        this.notes = '';
        if (data) {
            Object.assign(this, data);
        }
    }
}
exports.OrderItemDto = OrderItemDto;
class CreateSupplierOrderDto {
    constructor(data) {
        this.supplierId = '';
        this.notes = '';
        this.items = [];
        if (data) {
            Object.assign(this, data);
            if (data?.items) {
                this.items = data.items.map(item => new OrderItemDto(item));
            }
        }
    }
}
exports.CreateSupplierOrderDto = CreateSupplierOrderDto;
class UpdateSupplierOrderStatusDto {
    constructor(data) {
        this.status = 'PENDING';
        this.notes = '';
        if (data) {
            Object.assign(this, data);
        }
    }
}
exports.UpdateSupplierOrderStatusDto = UpdateSupplierOrderStatusDto;
class UpdateOrderItemStatusDto {
    constructor(data) {
        this.status = 'PENDING';
        this.receivedQuantity = 0;
        this.notes = '';
        if (data) {
            Object.assign(this, data);
        }
    }
}
exports.UpdateOrderItemStatusDto = UpdateOrderItemStatusDto;
class SupplierOrderItemDto {
    constructor(data) {
        this.id = '';
        this.productId = '';
        this.productName = '';
        this.quantity = 0;
        this.receivedQuantity = 0;
        this.unitPrice = 0;
        this.status = 'PENDING';
        this.notes = '';
        if (data) {
            Object.assign(this, data);
        }
    }
}
exports.SupplierOrderItemDto = SupplierOrderItemDto;
class SupplierOrderResponseDto {
    constructor(data) {
        this.id = '';
        this.orderNumber = '';
        this.supplierId = '';
        this.status = 'PENDING';
        this.orderDate = new Date();
        this.notes = '';
        this.items = [];
        this.createdBy = {
            id: '',
            name: '',
            email: ''
        };
        this.createdAt = new Date();
        this.updatedAt = new Date();
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
exports.SupplierOrderResponseDto = SupplierOrderResponseDto;
