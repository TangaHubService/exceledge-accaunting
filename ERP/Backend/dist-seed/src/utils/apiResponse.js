"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.error = exports.success = void 0;
const success = (data, message) => ({
    success: true,
    data,
    message,
});
exports.success = success;
const error = (message, code, details) => ({
    success: false,
    error: message,
    code,
    details,
});
exports.error = error;
