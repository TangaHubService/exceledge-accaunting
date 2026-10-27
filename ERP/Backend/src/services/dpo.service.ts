import { DPOPayment, Currency } from '@kazion/dpopay-sdk';
import { config } from "../config";

interface CreatePaymentRequest {
  amount: number;
  currency: Currency;
  reference: string;
  description: string;
  redirectUrl: string;
  backUrl: string;
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    address?: string;
    city?: string;
    country?: string;
    zip?: string;
  };
}

// Define DPO configuration type
interface DPOConfig {
  companyToken: string;
  serviceType: string;
  apiUrl: string;
  paymentUrl: string;
}

// Get DPO configuration with proper typing
const getDPOConfig = (): DPOConfig => ({
  ...config.dpo,
  paymentUrl: process.env.DPO_PAYMENT_URL || 'https://secure.3gdirectpay.com/payv2.php'
});

// Initialize DPO Payment client
const dpoClient = new DPOPayment({
  companyToken: config.dpo.companyToken,
  apiVersion: 'v6',
});

export const dpoService = {
  async createPaymentToken(data: CreatePaymentRequest) {
    try {
      const dpoConfig = getDPOConfig();

      // Prepare the payment payload according to DPO SDK requirements
      const paymentData = {
        paymentAmount: data.amount,
        paymentCurrency: data.currency,
        companyRef: data.reference,
        redirectURL: data.redirectUrl,
        backURL: data.backUrl,
        customerFirstName: data.customer.firstName,
        customerLastName: data.customer.lastName,
        customerEmail: data.customer.email,
        customerPhone: data.customer.phone || '',
        customerAddress: data.customer.address || '',
        customerCity: data.customer.city || '',
        customerCountry: data.customer.country || '',
        customerZip: data.customer.zip || '',
        emailTransaction: 1 as const, // Send email receipt (1 = yes, 0 = no)
        serviceType: dpoConfig.serviceType || '5525', // Default service type
        serviceDescription: data.description,
        serviceDate: new Date().toISOString().split('T')[0],
      };

      // Use the initiatePayment method from the SDK
      const response = await dpoClient.initiatePayment({
        transaction: paymentData,
        services: [{
          serviceType: dpoConfig.serviceType || '5525',
          serviceDescription: data.description,
          serviceDate: new Date().toISOString().split('T')[0],
        }]
      });

      if (response.success) {
        return {
          success: true,
          transToken: response.transToken,
          paymentUrl: `${dpoConfig.paymentUrl}?ID=${response.transToken}`,
        };
      } else {
        throw new Error(response.error || 'Failed to create payment token');
      }
    } catch (error: any) {
      console.error("Error creating payment token:", error);
      throw new Error("Failed to create payment token: " + (error.message || 'Unknown error'));
    }
  },

  async verifyPayment(transToken: string) {
    try {
      // Use type assertion to access verifyToken which exists in runtime but not in type definitions
      const response = await (dpoClient as any).verifyToken(transToken);

      // The response structure might vary based on the SDK version
      // This is a common structure, but you might need to adjust it
      const isSuccess = response?.Result?.[0] === '000' || response?.result === '000';

      return {
        success: isSuccess,
        result: response.Result?.[0] || response.result,
        resultExplanation: response.ResultExplanation?.[0] || response.resultExplanation || 'Success',
        rawResponse: response,
      };
    } catch (error: any) {
      console.error("Error verifying payment:", error);
      throw new Error("Failed to verify payment: " + (error.message || 'Unknown error'));
    }
  },
};
