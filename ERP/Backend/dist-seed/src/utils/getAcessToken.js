"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pesapalToken = exports.getAccessToken = void 0;
const axios_1 = __importDefault(require("axios"));
const paypack_1 = require("../lib/paypack");
const getAccessToken = async () => {
    const { data } = await axios_1.default.post(`${paypack_1.paypackConfig.baseUrl}/auth/agents/authorize`, {
        client_id: paypack_1.paypackConfig.clientId,
        client_secret: paypack_1.paypackConfig.clientSecret,
    }, { headers: { "Content-Type": "application/json", Accept: "application/json" } });
    return data;
};
exports.getAccessToken = getAccessToken;
const pesapalToken = async () => {
    if (!paypack_1.pesapalConfig.consumerKey || !paypack_1.pesapalConfig.consumerSecret) {
        throw new Error("Pesapal consumer key or secret not configured");
    }
    const { data } = await axios_1.default.post(`${paypack_1.pesapalConfig.baseUrl}/api/Auth/RequestToken`, {
        consumer_key: paypack_1.pesapalConfig.consumerKey,
        consumer_secret: paypack_1.pesapalConfig.consumerSecret,
    }, {
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
    });
    if (!data.token) {
        throw new Error(`Pesapal token request failed: ${data.error?.message || JSON.stringify(data)}`);
    }
    return data;
};
exports.pesapalToken = pesapalToken;
