export interface PaymentRequest {
    amount: number;
    currency: string;
    reference: string;
    description?: string;
    metadata?: Record<string, any>;
}

export interface PaymentResponse {
    success: boolean;
    transactionId: string;
    reference: string;
    status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
    message?: string;
    data?: Record<string, any>;
}

export interface PaymentStatusResponse {
    status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
    transactionId: string;
    amount?: number;
    currency?: string;
    message?: string;
    data?: Record<string, any>;
}

export interface PaymentProvider {
    name: string;
    initiatePayment(request: PaymentRequest): Promise<PaymentResponse>;
    checkStatus(transactionId: string): Promise<PaymentStatusResponse>;
    cancelPayment(transactionId: string): Promise<PaymentResponse>;
    refundPayment(transactionId: string, amount?: number): Promise<PaymentResponse>;
    processWebhook(payload: any): Promise<PaymentResponse>;
}
