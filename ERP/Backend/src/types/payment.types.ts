export interface InitiatePaymentRequest {
  subscriptionId: string;
  amount: number;
  currency?: string;
  description: string;
  customerEmail: string;
  customerFirstName: string;
  customerLastName: string;
  customerPhone?: string;
  reference?: string;
  redirectUrl?: string;
  backUrl?: string;
  metadata?: Record<string, any>;
}
