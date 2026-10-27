"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pesapalConfig = exports.paypackConfig = void 0;
exports.paypackConfig = {
    clientId: process.env.PAYPACK_CLIENT_ID,
    clientSecret: process.env.PAYPACK_CLIENT_SECRET,
    baseUrl: process.env.PAYPACK_API_URL,
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'development'
};
if (!exports.paypackConfig.clientId || !exports.paypackConfig.clientSecret) {
    console.warn('Paypack client ID or secret not set. Paypack payments will not work.');
}
// PESAPAL_API_URL is sometimes configured with a trailing "/api" segment;
// strip it here so callers can consistently append "/api/..." paths.
const pesapalBaseUrl = (process.env.PESAPAL_API_URL ?? "").replace(/\/api\/?$/, "");
exports.pesapalConfig = {
    consumerKey: process.env.PESAPAL_CONSUMER_KEY,
    consumerSecret: process.env.PESAPAL_CONSUMER_SECRET,
    baseUrl: pesapalBaseUrl,
};
