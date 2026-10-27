"use strict";
// src/controllers/webhook.controller.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleStripeWebhook = void 0;
const stripe_1 = __importDefault(require("stripe"));
const stripe_service_1 = require("../services/stripe.service");
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-11-17.clover',
});
/**
 * Handle Stripe webhook events
 * IMPORTANT: This endpoint must use raw body, not JSON parsed body
 */
const handleStripeWebhook = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    if (!sig) {
        console.error('No Stripe signature found in headers');
        return res.status(400).json({
            success: false,
            message: 'No signature found',
        });
    }
    let event;
    try {
        // Verify webhook signature
        // Note: req.body should be raw body buffer, not parsed JSON
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
        console.log(`Webhook received: ${event.type}`);
    }
    catch (err) {
        console.error('Webhook signature verification failed:', err);
        return res.status(400).json({
            success: false,
            message: `Webhook Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        });
    }
    // Handle the event asynchronously
    try {
        await (0, stripe_service_1.handleWebhook)(event);
        console.log(`Successfully processed webhook: ${event.type}`);
        return res.json({
            success: true,
            received: true,
            eventType: event.type,
        });
    }
    catch (error) {
        console.error('Error processing webhook:', error);
        // Still return 200 to acknowledge receipt
        // Stripe will retry failed webhooks
        return res.status(200).json({
            success: false,
            received: true,
            message: 'Webhook received but processing failed',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};
exports.handleStripeWebhook = handleStripeWebhook;
