"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerProvider = registerProvider;
exports.getProvider = getProvider;
exports.getAllProviders = getAllProviders;
exports.getAvailableMethods = getAvailableMethods;
const cash_provider_1 = require("./cash.provider");
const paypack_provider_1 = require("./paypack.provider");
const mtn_momo_provider_1 = require("./mtn-momo.provider");
const providers = new Map();
function registerProvider(provider) {
    providers.set(provider.name, provider);
}
function getProvider(name) {
    return providers.get(name);
}
function getAllProviders() {
    return Array.from(providers.values());
}
function getAvailableMethods() {
    return Array.from(providers.keys());
}
// Register default providers
registerProvider(new cash_provider_1.CashPaymentProvider());
registerProvider(new paypack_provider_1.PaypackPaymentProvider());
registerProvider(new mtn_momo_provider_1.MtnMoMoPaymentProvider());
// Stripe provider can be added when Stripe is configured
// Flutterwave provider can be added when Flutterwave is configured
// Bank Transfer is handled as a manual method
