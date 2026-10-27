"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTokenExpired = exports.generatePasswordResetToken = exports.generateVerificationToken = exports.generateToken = void 0;
const crypto_1 = __importDefault(require("crypto"));
const date_fns_1 = require("date-fns");
const generateToken = () => {
    return crypto_1.default.randomBytes(32).toString('hex');
};
exports.generateToken = generateToken;
const generateVerificationToken = () => {
    // Generate a 6-digit code
    const token = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = (0, date_fns_1.addHours)(new Date(), 24); // Token expires in 24 hours
    return { token, expires };
};
exports.generateVerificationToken = generateVerificationToken;
const generatePasswordResetToken = () => {
    // A cryptographically secure six-digit OTP that is easy to enter on mobile.
    // The stored value is still SHA-256 hashed by the controller.
    const token = crypto_1.default.randomInt(100000, 1000000).toString();
    const expires = (0, date_fns_1.addHours)(new Date(), 1);
    return { token, expires };
};
exports.generatePasswordResetToken = generatePasswordResetToken;
const isTokenExpired = (expiryDate) => {
    if (!expiryDate)
        return true;
    return new Date() > expiryDate;
};
exports.isTokenExpired = isTokenExpired;
