"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initiatePesapalPayment = exports.checkTransactionStatus = exports.cancelOrder = exports.requestRefund = exports.pesapalOrderRequest = exports.pesapalIpnController = void 0;
const getAcessToken_1 = require("../utils/getAcessToken");
const axios_1 = __importDefault(require("axios"));
const prisma_1 = require("../lib/prisma");
const currencyConverter_1 = require("../utils/currencyConverter");
const paypack_1 = require("../lib/paypack");
const subscription_service_1 = require("../services/subscription.service");
const config_1 = require("../config");
const PESAPAL_API_URL = paypack_1.pesapalConfig.baseUrl;
const subscriptionService = new subscription_service_1.SubscriptionService(prisma_1.prisma);
// Helper function to get transaction status
const getTransactionStatus = async (orderTrackingId) => {
    try {
        const tokenData = await (0, getAcessToken_1.pesapalToken)();
        const response = await axios_1.default.get(`${PESAPAL_API_URL}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`, {
            headers: {
                "Accept": "application/json",
                "Authorization": `Bearer ${tokenData.token}`
            }
        });
        return response.data;
    }
    catch (error) {
        console.error("Error getting transaction status:", error);
        throw error;
    }
};
const pesapalIpnController = async (req, res) => {
    try {
        const { OrderTrackingId, OrderNotificationType, OrderMerchantReference } = req.body;
        if (OrderNotificationType === 'IPNCHANGE') {
            // Get transaction status
            const transaction = await getTransactionStatus(OrderTrackingId);
            // Update subscription based on payment status. Look up by the merchant
            // reference stored on the subscription (same as the browser callback
            // handler) rather than by organizationId/planId + status:'ACTIVE' —
            // that older lookup could never find a brand-new PENDING subscription,
            // so a purchase confirmed only via IPN (no browser callback) would
            // never activate.
            if (transaction.payment_status_description === 'Completed') {
                const subscription = await prisma_1.prisma.subscription.findFirst({
                    where: {
                        paymentDetails: {
                            path: ['ref'],
                            equals: OrderMerchantReference,
                        },
                    },
                });
                if (subscription) {
                    await subscriptionService.finalizeSubscriptionPurchase({
                        subscriptionId: subscription.id,
                        paymentId: OrderTrackingId,
                        amount: transaction.amount,
                        currency: transaction.currency,
                        paymentMethod: 'PESAPA',
                        metadata: {
                            payment_method: transaction.payment_method,
                            confirmation_code: transaction.confirmation_code,
                        },
                        processedAt: new Date(transaction.created_date),
                    });
                }
                else {
                    console.warn('No subscription found for merchant reference:', OrderMerchantReference);
                }
            }
            // Acknowledge IPN
            return res.status(200).json({
                orderNotificationType: "IPNCHANGE",
                orderTrackingId: OrderTrackingId,
                orderMerchantReference: OrderMerchantReference,
                status: 200
            });
        }
        res.status(200).send("IPN received");
    }
    catch (error) {
        console.error("Error processing Pesapal IPN:", error);
        res.status(500).send("Internal Server Error");
    }
};
exports.pesapalIpnController = pesapalIpnController;
const pesapalOrderRequest = async (req, res) => {
    try {
        const tokenData = await (0, getAcessToken_1.pesapalToken)();
        const token = tokenData.token;
        const planId = Number(req.body.planId);
        const organizationId = Number(req.body.organizationId);
        const { user, months, billingMode } = req.body;
        //@ts-ignore
        const userId = req.user?.userId ? Number(req.user.userId) : undefined;
        const { subscription, totalAmount, ref: pesapalUniqueRef } = await subscriptionService.preparePurchase({
            organizationId,
            planId,
            months: months !== undefined ? Number(months) : 1,
            billingMode: billingMode === 'YEARLY' ? 'YEARLY' : 'MONTHLY',
            userId,
        });
        await prisma_1.prisma.subscription.update({
            where: { id: subscription.id },
            data: { paymentMethod: 'PESAPA' },
        });
        const plan = await prisma_1.prisma.subscriptionPlan.findUnique({ where: { id: planId } });
        // Prepare order data for PesaPal
        let amountInRwf = totalAmount;
        if (plan.currency.toUpperCase() === 'USD') {
            amountInRwf = await (0, currencyConverter_1.convertUsdToRwf)(totalAmount);
        }
        const ipnId = process.env.PESAPAL_IPN_ID;
        const lastTenPhoneDigits = user.phoneNumber
            ? String(user.phoneNumber).replace(/\D/g, "").slice(-10)
            : undefined;
        const orderData = {
            id: pesapalUniqueRef,
            currency: "RWF",
            amount: Math.round(amountInRwf),
            description: `Subscription for ${plan.name} (${months || 1} month${(months || 1) === 1 ? '' : 's'})`,
            callback_url: `${config_1.config.primaryFrontendUrl}/subscription/callback?planId=${planId}`,
            billing_address: {
                email_address: user.email,
                ...(lastTenPhoneDigits ? { phone_number: lastTenPhoneDigits } : {}),
                first_name: user.firstName,
            }
        };
        if (ipnId && !ipnId.startsWith('your_')) {
            orderData.notification_id = ipnId;
        }
        const response = await axios_1.default.post(`${PESAPAL_API_URL}/api/Transactions/SubmitOrderRequest`, orderData, {
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": `Bearer ${token}`
            }
        });
        res.status(200).json({
            success: true,
            message: "Pesapal order created successfully",
            data: {
                ...response.data,
                subscriptionId: subscription.id
            }
        });
    }
    catch (error) {
        if (!error.response && typeof error.message === 'string') {
            const status = /not found or inactive/i.test(error.message) ? 404
                : /months must|billingMode must|requires months/i.test(error.message) ? 400
                    : 500;
            return res.status(status).json({ success: false, message: error.message });
        }
        const errorDetail = error.response?.data || error;
        console.error("Error creating Pesapal order:", errorDetail);
        const pesapalError = errorDetail?.error || errorDetail;
        res.status(error.response?.status || 500).json({
            success: false,
            message: pesapalError?.message || "Failed to create Pesapal order",
            error: errorDetail
        });
    }
};
exports.pesapalOrderRequest = pesapalOrderRequest;
const requestRefund = async (req, res) => {
    try {
        const { transactionId, amount, reason } = req.body;
        const { token } = await (0, getAcessToken_1.pesapalToken)();
        const response = await axios_1.default.post(`${PESAPAL_API_URL}/api/Transactions/RefundRequest`, {
            confirmation_code: transactionId,
            amount: amount.toString(),
            username: req.user?.email || 'Admin',
            remarks: reason || 'Refund requested by admin'
        }, {
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": `Bearer ${token}`
            }
        });
        res.status(200).json({
            success: true,
            message: "Refund request submitted successfully",
            data: response.data
        });
    }
    catch (error) {
        const errorDetail = error.response?.data || error;
        const pesapalError = errorDetail?.error || errorDetail;
        console.error("Error requesting refund:", errorDetail);
        res.status(error.response?.status || 500).json({
            success: false,
            message: pesapalError?.message || "Failed to process refund request",
            error: errorDetail
        });
    }
};
exports.requestRefund = requestRefund;
const cancelOrder = async (req, res) => {
    try {
        const { orderTrackingId } = req.params;
        const tokenData = await (0, getAcessToken_1.pesapalToken)();
        const token = tokenData.token;
        const response = await axios_1.default.post(`${PESAPAL_API_URL}/api/Transactions/CancelOrder`, { order_tracking_id: orderTrackingId }, {
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Authorization": `Bearer ${token}`
            }
        });
        res.status(200).json({
            success: true,
            message: "Order cancelled successfully",
            data: response.data
        });
    }
    catch (error) {
        const errorDetail = error.response?.data || error;
        const pesapalError = errorDetail?.error || errorDetail;
        console.error("Error cancelling order:", errorDetail);
        res.status(error.response?.status || 500).json({
            success: false,
            message: pesapalError?.message || "Failed to cancel order",
            error: errorDetail
        });
    }
};
exports.cancelOrder = cancelOrder;
const checkTransactionStatus = async (req, res) => {
    try {
        const orderTrackingId = req.params.orderTrackingId;
        const organizationId = Number(req.params.organizationId);
        const planId = Number(req.params.planId);
        if (!orderTrackingId) {
            return res.status(400).json({
                success: false,
                message: 'Order tracking ID is required'
            });
        }
        const transaction = await getTransactionStatus(orderTrackingId);
        // Reduced logging - this endpoint is called frequently by frontend
        console.log(`Transaction status check: ${orderTrackingId} - ${transaction.payment_status_description}`);
        return res.status(200).json({
            success: true,
            data: transaction
        });
    }
    catch (error) {
        console.error('Error checking transaction status:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to process transaction status',
            error: error.message || 'An unknown error occurred'
        });
    }
};
exports.checkTransactionStatus = checkTransactionStatus;
const initiatePesapalPayment = async (req, res) => {
    try {
        const organizationId = Number(req.params.organizationId);
        const planId = Number(req.params.planId);
        //@ts-ignore
        const userId = req.user.userId;
        // Get user and organization
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: Number(userId) },
            include: { userOrganizations: true }
        });
        if (!user || !user.userOrganizations) {
            return res.status(400).json({
                success: false,
                message: "User organization not found"
            });
        }
        // Call the existing pesapalOrderRequest with the necessary data
        req.body.organizationId = organizationId;
        req.body.planId = planId;
        req.body.user = {
            email: user.email,
            phoneNumber: user.phone,
            firstName: user.name,
            lastName: user.name
        };
        return (0, exports.pesapalOrderRequest)(req, res);
    }
    catch (error) {
        console.error("Error initiating PesaPal payment:", error);
        res.status(500).json({
            success: false,
            message: "Failed to initiate PesaPal payment",
            error: error.message
        });
    }
};
exports.initiatePesapalPayment = initiatePesapalPayment;
