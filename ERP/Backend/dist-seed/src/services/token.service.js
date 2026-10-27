"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateTokenPair = generateTokenPair;
exports.generateAccessToken = generateAccessToken;
exports.verifyToken = verifyToken;
exports.getRefreshTokenExpiry = getRefreshTokenExpiry;
exports.getAccessTokenExpiry = getAccessTokenExpiry;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ACCESS_EXPIRY = '15m'; // Access token expires in 15 minutes
const JWT_REFRESH_EXPIRY = '7d'; // Refresh token expires in 7 days
/**
 * Generate a pair of access and refresh tokens
 * @param payload Token payload (user info)
 * @returns Object containing both access and refresh tokens
 */
function generateTokenPair(payload) {
    const accessToken = jsonwebtoken_1.default.sign(payload, JWT_SECRET, {
        expiresIn: JWT_ACCESS_EXPIRY,
    });
    const refreshToken = jsonwebtoken_1.default.sign(payload, JWT_SECRET, {
        expiresIn: JWT_REFRESH_EXPIRY,
    });
    return { accessToken, refreshToken };
}
/**
 * Generate only a new access token from a valid refresh token
 * @param refreshToken Valid refresh token
 * @param newPayload Updated payload for access token
 * @returns New access token
 */
function generateAccessToken(refreshToken, newPayload) {
    try {
        // Verify the refresh token is still valid
        jsonwebtoken_1.default.verify(refreshToken, JWT_SECRET);
        // Generate a new access token with updated payload
        const accessToken = jsonwebtoken_1.default.sign(newPayload, JWT_SECRET, {
            expiresIn: JWT_ACCESS_EXPIRY,
        });
        return accessToken;
    }
    catch (error) {
        throw new Error('Invalid or expired refresh token');
    }
}
/**
 * Verify and decode any JWT token
 * @param token JWT token to verify
 * @returns Decoded token payload
 */
function verifyToken(token) {
    try {
        return jsonwebtoken_1.default.verify(token, JWT_SECRET);
    }
    catch (error) {
        throw new Error('Invalid or expired token');
    }
}
/**
 * Calculate the expiry date for refresh token storage
 * @returns DateTime 7 days from now
 */
function getRefreshTokenExpiry() {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 7);
    return expiry;
}
/**
 * Calculate the expiry date for access token storage (for DB record)
 * @returns DateTime 15 minutes from now
 */
function getAccessTokenExpiry() {
    const expiry = new Date();
    expiry.setMinutes(expiry.getMinutes() + 15);
    return expiry;
}
